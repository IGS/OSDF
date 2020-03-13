#!/usr/bin/env node

var async = require('async');
var commander = require('commander');
var http = require('http');
var readline = require('readline');

var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

var default_couchdb_port = 5984;

commander.description('Add a new user to CouchDB.')
    .option('-s, --server <hostname/IP address>',
        'Specify the CouchDB hostname or IP address.')
    .option('-p, --port <port>',
        'Specify a path to the working directory where namespaces data is stored.')
    .option('-l, --log <path>',
        'Specify the path to the log file.')
    .option('-a, --couchdb-admin <user>',
        'Specify the username of the CouchDB administrator.')
    .option('-r, --couchdb-role <role>',
        'Specify the role for the new user. Deafaults to "reader".')
    .option('-u, --couchdb-user <username>',
        'Required. Specify the username for the new account.')
    .parse(process.argv);

var couchdb_server = commander.server;
var couchdb_port = commander.port;
var couchdb_admin = commander.couchdbAdmin;
var couchdb_role = commander.couchdbRole;
var couchdb_user = commander.couchdbUser;

if (typeof couchdb_role === 'undefined') {
    couchdb_role = 'reader';
}

if (typeof couchdb_port === 'undefined') {
    couchdb_port = default_couchdb_port;
}

if (typeof couchdb_server === 'undefined') {
    console.error('Please specify the CouchDB server with the ' +
                  '-s or --server options.');
    process.exit(1);
}

if (typeof couchdb_admin === 'undefined') {
    console.error('Please specify the CouchDB administrator with the ' +
                  '-a or --couchdb-admin options.');
    process.exit(1);
}


async.waterfall([
    function(callback) {
        // Ask for the administrators password to CouchDB. Be careful not to echo it
        // to the terminal.
        hidden('Enter the CouchDB Admin password for ' + couchdb_admin + ' (not visible when typed):',
            function(admin_pw) {
                callback(null, admin_pw);
            });
    },
    function(admin_pw, callback) {
        // Ask for the new user's password. Again, be careful not to echo it
        // to the terminal.
        hidden('Enter the password for "' + couchdb_user + '" (not visible when typed):',
            function(password) {
                callback(null, admin_pw, password);
            });
    },
    function(admin_pw, password, callback) {
        var user_data = JSON.stringify(
            {
                _id: 'org.couchdb.user:' + couchdb_user,
                type: 'user',
                name: couchdb_user,
                roles: [ couchdb_role ],
                password: password
            }
        );

        callback(null, admin_pw, user_data);
    },
    function(admin_pw, user_data, callback) {
        console.log('Creating user.');

        var server_details = {
            host: couchdb_server,
            port: couchdb_port,
            auth: couchdb_admin + ':' + admin_pw
        };

        sendCreateRequest(server_details, user_data, function(body, response) {
            // If the body of the response contains 'error' in it somewhere
            // then that means we failed.
            if (body.indexOf('error') > -1) {
                console.error('Problem creating account:');
                console.error(body);
                process.exit(1);
            } else {
                console.log('Successfully created new user.');
                process.exit(0);
            }
        });
    }]
);

function sendCreateRequest(server_details, user_data, callback) {
    var body = '';
    var cb = function(response) {
        response.on('data', function(chunk) {
            body = body + chunk;
        });

        response.on('end', function() {
            callback(body, response);
        });
    };

    var options = {
        host: server_details.host,
        port: server_details.port,
        auth: server_details.auth,
        headers: {
            'Content-Type': 'application/json'
        },
        method: 'POST',
        path: '/_users'
    };

    var req = http.request(options, cb);

    req.write(user_data);

    req.end();
}

function hidden(query, callback) {
    var stdin = process.openStdin();

    process.stdin.on('data', function(char) {
        char = char + '';
        switch (char) {
            case '\n':
            case '\r':
            case '\u0004':
                //stdin.pause();
                break;
            default:
                process.stdout.write('\033[2K\033[200D' + query + Array(rl.line.length+1).join('*'));
                break;
        }
    });

    rl.question(query, function(value) {
        rl.history = rl.history.slice(1);
        callback(value);
    });
}
