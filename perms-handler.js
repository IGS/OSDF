// async/each - For handling async loops
// format        - For more easily formatting strings
// fs            - For filesystem operations
// lodash - for generic utility functions
// path          - For work with filesystem paths
// string-format - For easier assembly of more complicated strings

var _ = require('lodash');
var each = require('async/each');
var format = require('string-format');
var fs = require('fs');
var path = require('path');
var osdf_utils = require('osdf_utils');

format.extend(String.prototype);
var logger = osdf_utils.get_logger();

// The main data structure to hold our ACL information.
var acl = {};
var namespace_user_acls = {};

function process_namespace(namespace, cb) {
    var acl_dir = path.join(osdf_utils.get_working_dir(), 'namespaces',
        namespace, 'acls');

    fs.readdir(acl_dir, function(err, files) {
        if (err) {
            throw err;
        }

        // Reject any hidden files/directories, such as .svn directories
        files = _.reject(files, function(file) {
            return file.substr(0, 1) === '.';
        });

        // So, if we're here, the scan has been completed and the 'files'
        // array is populated without incident.
        logger.debug('Found {} ACL files for namespace {}.'
            .format(files.length, namespace));

        each(files, function(file, callback) {
            var acl_file = path.join(acl_dir, file);

            fs.readFile(acl_file, 'utf-8', function(err, data) {
                if (err) {
                    callback(err);
                }

                var members = data.split('\n');

                // Reject any strange members
                members = _.reject(members, function(member) {
                    return member === null ||
                        member.length === 0 ||
                        member === 'all';
                });

                // Remove any that have spaces in them.
                members = _.reject(members, function(member) {
                    return osdf_utils.has_white_space(member);
                });

                // Sort them
                members = _.sortBy(members, function(member) {
                    return member;
                });

                // Remove any duplicates...
                members = _.uniq(members, true);

                // Populate the acl object
                acl[namespace][file] = members;

                // Populate the namespace_user_acls object
                _.each(members, function(member) {
                    if (! namespace_user_acls[namespace][member]) {
                        namespace_user_acls[namespace][member] = [];
                    }
                    namespace_user_acls[namespace][member].push(file);
                });

                callback();
            });
        }, function(err) {
            if (err) {
                logger.error('Namespace {} had an ACL error: {}'
                    .format(namespace, err));
                cb(err);
            } else {
                logger.info('Processed namespace {} ACLs fine.'.format(namespace));
                cb();
            }
        });
    });
}

// Initialize the handler by scanning the 'acls' directory in each namespace
// directory, reading the files therein, and adding the contents to a
// datastructure in memory for faster lookups during runtime.
exports.init = function(emitter) {
    logger.info('In {} init().'.format(path.basename(__filename)));

    var acl_reader = function(namespaces) {
        // Initialize the master ACL hash with a key for each namespace
        _.each(namespaces, function(namespace) {
            acl[namespace] = {};
            namespace_user_acls[namespace] = {};
        });

        // Now, iterate over the namespaces and scan the ACL files for each one.
        each(namespaces, function(namespace, callback) {
            process_namespace(namespace, function(err) {
                if (err) {
                    callback(err);
                } else {
                    callback();
                }
            });
        }, function(err) {
            if (err) {
                emitter.emit('perms_handler_aborted', err);
            } else {
                emitter.emit('perms_handler_initialized');
            }
        });
    };

    osdf_utils.get_namespace_names(function(err, namespaces) {
        if (err) {
            logger.error('Error retrieving namespace names: ' + err);
            emitter.emit('perms_handler_aborted', err);
        } else {
            logger.debug('Got namespace names.');
            acl_reader(namespaces);
        }
    });
};

// Given a user and a node, determine if the user can read (retrieve)
// the node. Returns true or false.
exports.has_read_permission = function(user, node) {
    logger.debug('In has_read_permission.');
    var can_read = eval_permission(user, node, 'read');
    return can_read;
};

// Given a user and a node, determine if the user can write to
// (that is, update or delete) the node. Returns true or false.
exports.has_write_permission = function(user, node) {
    logger.debug('In has_write_permission.');
    var can_write = eval_permission(user, node, 'write');
    return can_write;
};

exports.get_user_acls = function(namespace, user) {
    var user_acls = ['all'];
    // If namespace/user has valid acls, return them with prepended "all"
    // otherwise, simply return "all"
    if (namespace_user_acls[namespace] && namespace_user_acls[namespace][user]) {
        user_acls.concat(namespace_user_acls[namespace][user]);
    }
    return user_acls;
};

function eval_permission(user, node, operation) {
    logger.debug('In eval_permission: can user "{}" {} on {}?'
        .format(user, operation, node['id'])
    );

    if (operation !== 'read' && operation !== 'write') {
        throw 'Invalid operation. Must be read or write.';
    }

    var permitted = false;
    var node_acls = node['acl'][operation];

    // Do the easiest/fastest things first. Is 'none' or 'all' in the acl?
    // If so, our job is done. That settles it: none returns false, and 'all'
    // returns true. Note that none is checked first, since we want none to
    // override 'all', in the strange case of a node having both.
    if (_.includes(node_acls, 'none')) {
        return false;
    }

    if (_.includes(node_acls, 'all')) {
        return true;
    }

    // Okay, look at them in more detail. For that we'll need the node's
    // namespace.
    var namespace = node['ns'];

    if (acl.hasOwnProperty(namespace)) {
        _.each(node_acls, function(acl_name) {
            // Check if the acl is known to us before examining
            // the user's membership in it.
            if (acl[namespace].hasOwnProperty(acl_name)) {
                if (_.includes(acl[namespace][acl_name], user)) {
                    permitted = true;
                    return false; // Break out of _.each()
                }
            } else {
                logger.warn('Unknown {} acl: {}'.format(operation, acl_name));
            }
        });
    } else {
        logger.warn('Unknown namespace: ' + namespace);
    }

    return permitted;
}
