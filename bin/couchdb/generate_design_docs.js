#!/usr/bin/env node

// Scan the current directory for Javascript files that contain
// CouchDB design documents. Such files will have the following
// naming convention <design_doc_name>-<view_name>-map[-reduce].js.
// The files are then read, escaped, and formatted into the proper
// CouchDB design documents before being registered with the configured
// CouchDB server.

var _ = require('lodash');
var fs = require('fs');
var path = require('path');
var cradle = require('cradle');
var cli = require('commander');
var async = require('async');
var pw = require('pw');

cli.option('-a, --address <Couch IP address/name>',
    'Specify an alternate configuration file.')
    .option('-d, --database <database>',
        'Specify the name of the CouchDB database to install the design documents in.')
    .option('-u, --username <username>',
        'Specify the username of the CouchDB administrator.')
    .option('-p, --port <port number (default of 5984)>',
        'Specify the port number that CouchDB is listening on.')
    .parse(process.argv);

var couchdb_admin = cli.username;
var couchdb_address = cli.address;
var couchdb_port = cli.port;
var couchdb_db = cli.database;
var couchdb_password = null;

if (couchdb_admin === null || (typeof couchdb_admin === 'undefined')) {
    process.stderr.write('The username of the CouchDB admin must be ' +
                         'specified with -u or --username.\n');
    process.exit(2);
}

if (couchdb_address === null || (typeof couchdb_address === 'undefined')) {
    process.stderr.write('The option for -a / --address must be specified.\n');
    process.exit(2);
}

if (couchdb_db === null || (typeof couchdb_db === 'undefined')) {
    process.stderr.write('The name of the CouchDB database must be ' +
                         'specified with -d or --database.\n');
    process.exit(2);
}

if (couchdb_port === null || (typeof couchdb_port === 'undefined')) {
    console.log('Using a default port of 5984.');
    couchdb_port = 5984;
}

if (process.env.hasOwnProperty('COUCHDB_PASSWD')) {
    couchdb_password = process.env['COUCHDB_PASSWD'];
    main();
} else {
    // Request the CouchDB admin password, but do not echo the password
    // to the terminal.
    process.stdout.write('Please enter the CouchDB administrative password for ' +
                     couchdb_admin + ' (will not be shown): ');
    pw(function(password) {
        couchdb_password = password;
        main();
    });
}

function main() {
    var files = fs.readdirSync(path.dirname(__filename));

    var abs_files = [];

    var design_doc_names = [];

    for (var fileIdx = 0; fileIdx < files.length; fileIdx++) {
        var file = path.join(__dirname, files[fileIdx]);
        abs_files.push(file);

        if ((path.extname(file) === '.js') && strEndsWith(file, '-map.js')) {
            var base = path.basename(file, '-map.js');
            var pieces = base.split('-');

            var name = pieces[0];

            design_doc_names.push(name);
        }
    }

    // Okay, we have the design document names.
    design_doc_names = _.uniq(design_doc_names);

    getDesignDocs(abs_files, design_doc_names, function(designDocs) {
        post_all_design_docs(designDocs, function(err) {
            if (err) {
                console.log('Failure: ' + err);
                process.exit(2);
            }
        });
    });
}

function getDesignDocs(files, design_doc_names, callback) {
    var design_docs = {};

    async.forEachSeries(design_doc_names, function(design_name, parent_cb) {
        // The variable to hold the named design document.
        var doc_code = '';

        async.forEachSeries(files, function(file, cb) {
            var filename = path.basename(file);

            if (strBeginsWith(filename, design_name) && strEndsWith(filename, '-map.js')) {

                var base = path.basename(filename, '-map.js');

                var pieces = base.split('-');
                var view_name = pieces[1];

                var map_code = fs.readFileSync(file, 'utf-8');

                var reduce_file = base + '-reduce.js';

                fs.exists(reduce_file, function(exists) {
                    if (exists) {
                        var reduce_code = fs.readFileSync(reduce_file, 'utf-8');
                        var map_reduce = create_map_reduce(view_name, map_code, reduce_code);
                        if (doc_code === '') {
                            doc_code += map_reduce;
                        } else {
                            doc_code += ',\n' + map_reduce;
                        }
                    } else {
                        var map = create_map(view_name, map_code);
                        if (doc_code === '') {
                            doc_code += map;
                        } else {
                            doc_code += ',\n' + map;
                        }
                    }

                    cb();
                });
            } else {
                cb();
            }
        }, function() {
            design_docs[design_name] = '{' + doc_code + '}';
            parent_cb();
        });
    }, function() {
        callback(design_docs);
    });
}

// Check if a string begins with another string (prefix).
function strBeginsWith(str, prefix) {
    return str.indexOf(prefix) === 0;
}

// Check if a string end with another string (suffix).
function strEndsWith(str, suffix) {
    var lastIndex = str.lastIndexOf(suffix);
    return (lastIndex != -1) && (lastIndex + suffix.length == str.length);
}

// Create a Couchdb "map" key/value for a "view" design document.
// The first argument is the name of the map, and the second
// argument is the javascript code to execute.
function create_map(name, code) {
    var view = '"' + name + '": {' + '\n';
    view += '"map": "' + escape(code) + '"}';
    return view;
}

// Create a Couchdb "map/reduce" key/value for a "view" design document. The
// first argument is the name of the map, and the second argument is the
// javascript code to execute.
function create_map_reduce(name, map_code, reduce_code) {
    var view = '"' + name + '": {' + '\n';
    view += '"map": "' + escape(map_code) + '",' + '\n';
    view += '"reduce": "' + escape(reduce_code) + '"' + '\n';
    view += '}\n';

    return view;
}

// Certain parts of JavaScript code has to be escaped for proper
// inclusion into a JSON document. This function escapes the code
// and returns the formatted result.
function escape(code) {
    var escaped = code
        .replace(/\n/g, "\\n")
        .replace(/\"/g, "\\\"")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t")
        .replace(/\f/g, "\\f");
    return escaped;
}

// Take the code that has been escaped and formatted into a JSON documents
// (CouchDB design documents) and post tehm into the CouchDB server.
function post_all_design_docs(design_docs, callback) {
    // Establish the connection parameters, including the application's
    // CouchDB credentials.
    var couch_conn = new(cradle.Connection)('http://' + couchdb_address, couchdb_port, {
        auth: { username: couchdb_admin, password: couchdb_password },
        cache: false,
        raw: false
    });

    // Create the CouchDB connection using the configured database name.
    var db = couch_conn.database(couchdb_db);

    async.forEachSeries(_.keys(design_docs), function(name, cb) {
        var code = design_docs[name];

        var view_json = JSON.parse(code);

        db.save('_design/' + name, view_json, function(err, res) {
            if (err) {
                if (typeof err === 'object' && err.hasOwnProperty('error')) {
                    console.log('Error: ' + err['error'] + '. Reason: ' + err['reason']);
                    callback(err);
                } else {
                    callback(err);
                }
                process.exit(1);
            } else {
                cb();
            }
        });
    });
}
