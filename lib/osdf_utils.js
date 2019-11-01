// async/each - For dealing with asynchronous programming issues more easily
// clone      - For creating deep copies of data structures
// lodash     - For various common data wrangling functions
// log4js     - For logging at various levels and debugging

var _ = require('lodash');
var clone = require('clone');
var each = require('async/each');
var fs = require('fs');
var path = require('path');
var working_dir;

var config_path = null;
var logger = null;

function set_logging(log_file) {
    var log4js = require('log4js');

    log4js.configure({
        appenders: {
            out: { type: 'stdout' },
            app: { type: 'file', filename: log_file }
        },
        categories: {
            default: { appenders: [ 'out', 'app' ], level: 'debug' }
        }
    });

    // Set the logger
    logger = log4js.getLogger('app');
}

exports.set_log_file = function(log_file_path) {
    set_logging(log_file_path);
};

exports.get_logger = function() {
    if (logger === null || logger === undefined) {
        var log_file_path =
            path.resolve(exports.get_osdf_root(), 'logs/osdf.log');

        set_logging(log_file_path);
    }
    return logger;
};

exports.get_config = function() {
    if (config_path === null || config_path === undefined) {
        config_path = path.resolve(exports.get_osdf_root(), 'conf/config.ini');
    }
    return config_path;
};

exports.set_config = function(config_file_path) {
    config_path = config_file_path;
};

exports.set_working_dir = function(directory, cb) {
    fs.stat(directory, function(err, stats) {
        if (err) {
            throw err;
        }
        if (stats.isDirectory()) {
            working_dir = directory;
            cb();
        } else {
            throw 'Configured path to working area is not a directory: ' +
                  directory;
        }
    });
};

exports.get_working_dir = function() {
    // If the working directory hasn't been set, then we use the default,
    // which is a directory called 'working' under the OSDF root.
    if (working_dir === null || typeof working_dir === 'undefined') {
        working_dir = path.resolve(exports.get_osdf_root(), 'working');
    }

    return working_dir;
};

exports.get_osdf_root = function() {
    return path.resolve(__dirname, '..');
};

exports.random_string = function(length) {
    var valid_chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZ' +
                      'abcdefghiklmnopqrstuvwxyz';
    var chars = valid_chars.split('');
    var str = '';
    var i;

    if (! length) {
        length = Math.floor(Math.random() * chars.length);
    }

    for (i = 0; i < length; i++) {
        str += chars[Math.floor(Math.random() * chars.length)];
    }
    return str;
};

// Used to retrieve the namespace names known to this OSDF instance.
// The function takes a callback that is called when the namespace scan
// is complete. The callback will be passed an array of namespace names
// as its first argument.
exports.get_namespace_names = function(callback) {
    if (! callback) {
        throw 'No callback provided.';
    }

    var namespaces = [];
    var namespace_dir = path.join(exports.get_working_dir(), 'namespaces');

    // Scan the directory containing the namespace descriptors for JSON
    // files. Do it ASYNCHRONOUSLY, so we DO NOT use the "sync" version
    // of readdir(), readDirSync().
    fs.readdir(namespace_dir, function(err, files) {
        if (err) {
            throw err;
        }

        // Reject any hidden files/directories, such as .svn directories
        files = _.reject(files, function(file) {
            return file.substr(0,1) === '.';
        });

        //async.each(files, function(file, cb) {
        each(files, function(file, cb) {
            var full_path = path.join(namespace_dir, file);

            fs.stat(full_path, function(err, stats) {
                if (err) {
                    cb(err);
                } else {
                    if (stats.isDirectory()) {
                        namespaces.push(file);
                    } else {
                        logger.debug(full_path + ' is not a directory!');
                    }
                    cb(null);
                }
            });
        },
        function(err) {
            if (err) {
                logger.error('Error when scanning namespaces. ' + err);
                callback(err, null);
            } else {
                logger.info('Returning namespaces.');
                callback(null, namespaces);
            }
        });
    });
};

// Check for white space
exports.has_white_space = function(string) {
    return (/\s/).test(string);
};

exports.fix_keys = function(data) {
    // Should not need to clone the data, but stumbled upon an apparent bug
    // with V8.
    var new_data = null;

    if (data !== null) {
        new_data = clone(data);

        new_data['id'] = data._id;

        delete new_data._id;
        delete new_data._rev;
    }

    return new_data;
};

exports.send_error = function(response, error_message, http_code) {
    response.set('X-OSDF-Error', error_message);
    response.status(http_code).send('');
};
