#!/usr/bin/node

var _ = require('lodash');
var cluster = require('cluster');
var log4js = require('log4js');
var os = require('os');
var path = require('path');

var config_path = null;
var working_path = null;
var log_file_path = null;
var logger = null;

// Flag that is consulted for whether we will attempt to spawn
// replacement workers if any should die. This will be set to
// true when we shutdown via the 'exit' handler.
var letWorkersDie = false;

// Flags to indicate whether a non-standard config file location or
// non-standard working directories were specified.
var custom_config = false;
var custom_working = false;
var custom_log_file = false;
var osdf_utils = require('osdf_utils');

configure();

function engine_start() {
    // Get the configuration.
    var config = require('config');
    config.load(config_path);

    if (cluster.isMaster) {
        start_master(config);
    } else {
        try {
            var forked_worker = require('./worker');
            forked_worker.start_worker(config, working_path);
        } catch (e) {
            process.send({'cmd': 'abort', 'reason': e.message});
        }
    }
}

function configure() {
    var commander = require('commander');

    commander.option('-c, --config <path>',
        'Specify a configuration file. Default is ' +
        '<OSDF_HOME>/conf/config.ini.')
        .option('-w, --working <path>',
            'Specify a path to the working directory where ' +
            'namespace data is stored.')
        .option('-l, --log <path>',
            'Specify the path to the log file.')
        .parse(process.argv);

    config_path = commander.config;
    working_path = commander.working;
    log_file_path = commander.log;

    if (config_path === null || typeof config_path === 'undefined') {
        config_path = osdf_utils.get_config();
    } else {
        osdf_utils.set_config(config_path);
        custom_config = true;
    }

    if (log_file_path === null || typeof log_file_path === 'undefined') {
        log_file_path = path.join(osdf_utils.get_osdf_root(), '/logs/osdf.log');
    } else {
        // Set the path to the log file and...
        osdf_utils.set_log_file(log_file_path);
        custom_log_file = true;
    }

    // ...get the logger object
    logger = osdf_utils.get_logger();

    if (working_path === null || typeof working_path === 'undefined') {
        // Nothing specified, get the default
        working_path = osdf_utils.get_working_dir();
        engine_start();
    } else {
        custom_working = true;
        osdf_utils.set_working_dir(working_path, function() {
            engine_start();
        });
    }
}

function determine_worker_count(config) {
    // HOw many workers should we start? Look a thte configruation
    // file, and if set to auto, or some non-sensical number, then
    // just use the system's CPU count.
    var cpu_count = os.cpus().length;
    var workers = config.value('global', 'workers');

    if (_.isUndefined(workers)) {
        workers = cpu_count;
    } else if (_.isString(workers)) {
        if (workers === 'auto') {
            workers = cpu_count;
        } else {
            workers = parseInt(workers, 10);
        }
    }

    if (workers <= 0) {
        logger.warn('Detected worker count of zero. Using CPU count.');
        workers = cpu_count;
    }

    return workers;
}

function start_master(config) {
    console.log('OSDF_ROOT: ' + osdf_utils.get_osdf_root());

    var workers_ready = 0;
    var worker_idx;

    var workers_array = [];

    var ready_data = {};

    var workers = determine_worker_count(config);

    if (workers === 1) {
        console.log('Running on a single CPU.');
    } else {
        console.log('Running on ' + workers + ' CPUs.');
    }

    // Fork a worker for each CPU
    for (worker_idx = 0; worker_idx < workers; worker_idx++) {
        var worker = cluster.fork();

        workers_array.push(worker);

        worker.on('message', function(msg) { // jshint ignore:line
            if (msg.hasOwnProperty('cmd') && msg['cmd'] === 'user_count') {
                ready_data['user_count'] = msg['users'];
            }

            var type;

            if (msg.hasOwnProperty('cmd') && msg['cmd'] === 'schema_change') {
                // Send messages to all the workers so that they can adjust
                // their lists of primary schemas.
                type = msg['type'];
                logger.info('Master got a schema change event of type: ' +
                            type + '. ' + 'Relay this to the workers.');

                _.each(workers_array, function(clustered_worker) {
                    clustered_worker.send(msg);
                });
            }

            if (msg.hasOwnProperty('cmd') &&
                msg['cmd'] === 'aux_schema_change') {
                // Send messages to all the workers so that they can adjust
                // their lists of auxiliary schemas.
                type = msg['type'];
                logger.info('Master got an auxiliary schema change event of ' +
                            'type: ' + type + '. Relay this to the workers.');

                _.each(workers_array, function(clustered_worker) {
                    clustered_worker.send(msg);
                });
            }

            if (msg.hasOwnProperty('cmd') && msg['cmd'] === 'abort') {
                var reason = msg['reason'];
                console.error('Aborting execution. Reason: ' + reason);
                letWorkersDie = true;
                process.exit(1);
            }

            if (msg.hasOwnProperty('cmd') && msg['cmd'] === 'init_completed') {
                workers_ready++;

                if (workers_ready === workers) {
                    // Show some details about the server after it's up and
                    // running.
                    var bind_address = config.value('global', 'bind_address');
                    var port = config.value('global', 'port');
                    var cors_enabled = config.value('global', 'cors_enabled');
                    var https_enabled = config.value('global', 'https_enabled');

                    ready_data['address'] = bind_address;
                    ready_data['port'] = port;
                    ready_data['cors_enabled'] = cors_enabled;
                    ready_data['https_enabled'] = https_enabled;
                    ready_data['worker_count'] = workers_array.length;

                    show_ready(ready_data);
                }
            }
        });
    }

    // This is for node.js .6.x, in wich the event is called 'death'.
    cluster.on('death', function(worker) {
        if (! letWorkersDie) {
            console.error('Worker ' + process.pid +
                          ' died. Starting a replacement...');
            cluster.fork();
        }
    });

    // For node 0.8.x, the 'death' event was renamed to 'exit' on the cluster
    // object. See here:
    // https://github.com/joyent/node/wiki/API-changes-between-v0.6-and-v0.8
    cluster.on('exit', function(worker) {
        if (! letWorkersDie) {
            console.error('Worker ' + process.pid +
                          ' died. Starting a replacement...');
            cluster.fork();
        }
    });

    process.on('SIGTERM', function() {
        console.error('Caught SIGTERM. Destroying workers.');
        shutdown(workers_array);
    });

    process.on('exit', function() {
        console.error('Exiting. Destroying workers.');
        shutdown(workers_array);
    });
}

function shutdown(workers) {
    // Modify the flag so that the 'death' handler does not attempt
    // to replace the workers we are about to destroy off.
    letWorkersDie = true;

    destroy_workers(workers);

    log4js.shutdown();
}

function destroy_workers(workers) {
    // Iterate through the workers, and destroy each of them.
    _.each(workers, function(worker) {
        console.error('Destroying worker ' + process.pid);
        if (worker.kill) {
            // This is for node.js 0.6.x
            worker.kill();
        } else {
            worker.destroy();
        }
    });
}

// Display server details when we have started up.
function show_ready(ready_data) {
    var user_count = ready_data['user_count'];
    var address = ready_data['address'];
    var port = ready_data['port'];
    var worker_count = ready_data['worker_count'];
    var cors_enabled = ready_data['cors_enabled'];
    var https_enabled = ready_data['https_enabled'];

    if (custom_config) {
        console.log('Configured settings file: ' + config_path);
    }

    if (custom_working) {
        console.log('Configured working area: ' + working_path);
    }

    if (custom_log_file) {
        console.log('Configured log file: ' + log_file_path);
    }

    // Configuration for CORS
    var cors = false;
    if (cors_enabled !== 'undefined' && cors_enabled !== null &&
           (cors_enabled === 'true' || cors_enabled === 'yes')) {
        cors = true;
    }

    // Configuration for encrypted operation
    var https = false;
    if (https_enabled !== 'undefined' && https_enabled !== null &&
           (https_enabled === 'true' || https_enabled === 'yes')) {
        https = true;
    }

    console.log('HTTPS enabled: ' + https);
    console.log('CORS enabled: ' + cors);
    console.log('Total number of registered OSDF users: ' + user_count);
    console.log('Running on node.js version: ' + process.version);
    console.log('Workers being used: ' + worker_count);
    console.log('Listening on server:port : ' + address + ':' + port);
    console.log('===============================================');
    console.log('Welcome to');
    console.log(
        new Buffer('ICBfX19fICBfX19fX19fICBfX19fCiAvIF9fIFwvIF9fLyBfIFwvIF9f' +
            'LwovIC9fLyAvXCBcLyAvLyAvIF8vClxfX19fL19fXy9fX19fL18vCgo=',
        'base64').toString('utf8')
    );
    console.log('Open Science Data Framework\n');
    console.log('===============================================');
}
