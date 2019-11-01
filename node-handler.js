// async/each      - For handling async code in series
// async/waterfall - For handling complicated async workflows
// async/series    - For handling async code in series
// cradle          - For interactions with CouchDB
// lodash          - For generic utility functions
// string-format   - For better string formatting abilities
// ajv             - Used for JSON validation with JSON-Schema

var _ = require('lodash');
var auth = require('auth_enforcer');
var config = require('config');
var cradle = require('cradle');
var http = require('http');
var each = require('async/each');
var format = require('string-format');
var fs = require('fs');
var linkage_controller = require('linkage-controller');
var osdf_utils = require('osdf_utils');
var path = require('path');
var perms = require('perms-handler');
var provenance = require('provenance');
var schema_utils = require('schema_utils');
var series = require('async/series');
var sprintf = require('sprintf').sprintf;
var ajv = require('ajv');
var util = require('util');
var waterfall = require('async/waterfall');

format.extend(String.prototype);

config.load(osdf_utils.get_config());

// Load some important configuration parameters.
var base_url = config.value('global', 'base_url');
var port = config.value('global', 'port');
var couch_address = config.value('global', 'couch_address');
var couch_port = config.value('global', 'couch_port');
var couch_user = config.value('global', 'couch_user');
var couch_pass = config.value('global', 'couch_pass');

var dbname = config.value('global', 'couch_dbname');

var logger = osdf_utils.get_logger();
var osdf_error = osdf_utils.send_error;

// An array to hold the namespaces.
var namespaces = [];
var validators = {};
var base_validator;
var base_validate;
var working_dir;
var couch_conn;
var db;

// This initializes the handler. The things we need to do before the
// handler is ready to begin its work are: establish a connection to the
// CouchDB server, determine what the installed namespaces are, and create
// the various validators for each of the node types inside each namespace.
exports.init = function(emitter, working_dir_custom) {
    var module_base = path.basename(__filename);
    logger.debug('In {} init().'.format(module_base));

    working_dir = osdf_utils.get_working_dir();

    logger.info('Creating CouchDB connection. Using db: ' + dbname);

    // Establish the connection parameters, including the application's
    // CouchDB credentials.
    couch_conn = new(cradle.Connection)('http://' + couch_address, couch_port, {
        auth: { username: couch_user, password: couch_pass },
        cache: false,
        raw: false
    });

    // Create the CouchDB connection using the configured database name.
    db = couch_conn.database(dbname);

    db.exists(function(err, exists) {
        // Here we emit the error to abort the server startup process.
        if (err) {
            var msg = sprintf(
                'Error connecting to CouchDB database at %s:%s. ' +
                'Check settings & credentials in %s.',
                couch_address,
                couch_port,
                osdf_utils.get_config()
            );
            emitter.emit('node_handler_aborted', msg);
        }

        if (! exists) {
            emitter.emit(
                'node_handler_aborted',
                "CouchDB database '{}' doesn't exist.".format(dbname)
            );
        }
    });

    waterfall([
        function(callback) {
            // Load the base schema for nodes. This is used in the validation process.
            var base_schema_path = path.join(
                osdf_utils.get_osdf_root(),
                'lib',
                'node.json'
            );

            logger.info('Loading base node json-schema, node.json.');

            fs.readFile(base_schema_path, 'utf8', function(err, schema_text) {
                if (err) {
                    var msg = 'Unable to read base schema from {}: {}'
                        .format(base_schema_path, err);
                    callback(msg, null);
                } else {
                    var base_schema = JSON.parse(schema_text);
                    callback(null, base_schema);
                }
            });
        },
        function(base_schema, callback) {
            logger.info('Creating base node validator.');
            base_validator = new ajv({allErrors: true});
            base_validate = base_validator.compile(base_schema);

            callback(null);
        },
        function(callback) {
            // The linkage controller needs its own ability to interact with
            // CouchDB, to validate nodes, so we give it the connection we
            // established.
            linkage_controller.set_db_connection(db);

            osdf_utils.get_namespace_names(function(err, names) {
                if (err) {
                    logger.error('Error retrieving namespace names: ' + err);
                    callback(err, null);
                } else {
                    logger.info('Namespaces: ', names);
                    callback(null, names);
                }
            });
        },
        function(names, callback) {
            namespaces = names;
            populate_validators(function(err) {
                if (err) {
                    logger.error('Error populating validators: ' + err);
                    callback(err);
                } else {
                    callback(null);
                }
            });
        },
        function(callback) {
            establish_linkage_controls(function(err) {
                if (err) {
                    logger.error('Error establishing linkage controls: ' + err);
                    callback(err);
                } else {
                    logger.info('Successfully established linkage controls.');
                    callback(null);
                }
            });
        }],
    function(err) {
        if (err) {
            emitter.emit('node_handler_aborted', err);
        } else {
            emitter.emit('node_handler_initialized');
        }
    });
};

// This function handles the deletion of nodes. We must check that the
// node exists and that the user has write permissions to it.
exports.delete_node = function(request, response) {
    logger.debug('In delete_node.');

    // Check that we actually have the id in the request...
    var node_id = null;

    if (request.hasOwnProperty('params') && request.params.hasOwnProperty('id')) {
        node_id = request.params.id;
    } else {
        var msg = 'No node ID provided.';
        logger.error(msg);
        throw msg;
    }

    try {
        // Check if this node has other nodes pointing to it.
        has_dependent_nodes(node_id, function(err, has_dependencies) {
            if (err) {
                logger.error(err);
                throw err;
            }

            if (has_dependencies) {
                osdf_error(response, 'Node has dependencies on it.', 409);
            } else {
                logger.debug('No dependencies, so clear to delete.');
                // Get the user that is making the deletion request.
                var user = auth.get_user(request);
                delete_helper(user, node_id, response);
            }
        });
    } catch (err) {
        logger.error('Error deleting node. Reason: ' + err);
        osdf_error(response, 'Unable to delete node.', 500);
    }
};

// This is the method that handles node retrieval. It is called when users HTTP
// GET the node.
exports.get_node = function(request, response) {
    logger.debug('In get_node.');

    db.get(request.params.id, function(err, node_data) {
        node_retrieval_helper(request, response, err, node_data);
    });
};

// This is the method that handles node retrieval by version number. It is
// called when users HTTP GET the node and supply a specific version number in
// the url.
exports.get_node_by_version = function(request, response) {
    logger.debug('In get_node_by_version.');

    var node_id = request.params.id;
    var requested_version = parseInt(request.params.ver, 10);

    if (requested_version <= 0) {
        logger.warn('User asked for invalid version number of node.');
        osdf_error(response, 'Invalid version number.', 422);
    } else if ( isNaN(requested_version) ) {
        logger.warn("User didn't provide a valid number for the version number.");
        osdf_error(response, 'Invalid version number.', 422);
    } else {
        var version = request.params.ver.toString();
        var stream = db.getAttachment(node_id + '_hist', version);
        var data = '';

        stream.on('data', function(chunk) {
            data += chunk;
        });

        stream.on('end', function() {
            logger.debug('CouchDB request for attachment complete.');
            var couch_response = null;
            try {
                couch_response = JSON.parse(data);
            } catch (err) {
                logger.error(err, data);
            }

            if (couch_response === null) {
                osdf_error(response, 'Unable to retrieve node version.', 422);
            } else {
                logger.info('Got a valid CouchDB response.');

                if (couch_response.hasOwnProperty('error')) {
                    logger.info('CouchDB response indicated an error occurred.');

                    get_couch_doc(node_id, function(err, current_node) {
                        if (err) {
                            logger.error(err);
                            osdf_error(response, 'Unable to retrieve node.', 500);
                        } else {
                            var current_node_version = parse_version(current_node['_rev']);

                            // The user may be using this method to get the current version.
                            // They 'should' use the regular node retrieval method, but here
                            // they are using the 'by version' method to get the current
                            // version.
                            if (requested_version === current_node_version) {
                                response.jsonp(osdf_utils.fix_keys(current_node));
                            } else {
                                osdf_error(response, 'Unable to retrieve node version.', 404);
                            }
                        }
                    });
                } else {
                    response.jsonp(couch_response);
                }
            }
            return;
        });
    }
};

// Retrieve the nodes that a particular node links to
exports.get_out_linkage = function(request, response) {
    logger.debug('In get_out_linkage.');

    // Check that we actually have the id in the request...
    var node_id = null;

    if (request.hasOwnProperty('params') && request.params.hasOwnProperty('id')) {
        node_id = request.params.id;
    } else {
        var msg = 'No node ID provided.';
        logger.error(msg);
        throw msg;
    }

    var view_opts = {include_docs: true, startkey: [node_id], endkey:[node_id, {}]};

    try {
        // This needs to query a view, not issue N queries...
        db.view('linkage/out', view_opts, function(err, results) {
            if (err) {
                logger.error(err);
                throw err;
            }

            // The first entry is the node itself. Subsequent elements in the
            // array are the nodes that we are linking to
            results.shift();

            // Remove duplicates. A node can actually link to other nodes
            // multiple times, but the API says we only report it once.
            var seen_list = [];

            logger.debug('Filtering duplicates from the result list.');
            var filtered = _.filter(results, function(result) {
                if ( _.includes(seen_list, result['doc']['_id'])) {
                    return false;
                } else {
                    seen_list.push( result['doc']['_id'] );
                    return true;
                }
            });

            // Move the structure up a level.
            filtered = _.map(filtered, function(filtered_result) {
                return filtered_result['doc'];
            });

            // Fix the couch docs to look like an OSDF doc
            filtered = _.map(filtered, function(filtered_result) {
                return osdf_utils.fix_keys(filtered_result);
            });

            // Exclude nodes that we do not have read permission for
            var user = auth.get_user(request);
            filtered = _.filter(filtered, function(node) {
                return perms.has_read_permission(user, node);
            });

            // Assemble the final document for transmission
            var report = {
                'result_count': filtered.length,
                'page': 1,
                'results': []
            };

            _.each(filtered, function(filtered_result) {
                report['results'].push( filtered_result );
            });

            response.jsonp(report);
        });
    } catch (e) {
        logger.error(e);
        osdf_error(response, 'Unable to retrieve node linkages.', 500);
    }
};

// Retrieve the nodes that point to this node.
exports.get_in_linkage = function(request, response) {
    logger.debug('In get_in_linkage.');

    // Check that we actually have the id in the request...
    var node_id = request.params.id;
    if (node_id === null || node_id === '') {
        osdf_error(response, 'Invalid or missing node id.', 422);
        return;
    }

    try {
        // This needs to query a view, not issue N queries...
        db.view('linkage/in', {include_docs: true, key: node_id}, function(err, results) {
            if (err) {
                logger.error(err);
                throw err;
            }

            // Remove duplicates. A node can actually link to other nodes multiple times, but
            // the API says we only report it once.
            var seen_list = [];

            logger.debug('Filtering duplicates from the result list.');
            var filtered = _.filter(results, function(result) {
                if ( _.includes(seen_list, result['doc']['_id'])) {
                    return false;
                } else {
                    seen_list.push( result['doc']['_id'] );
                    return true;
                }
            });

            // Move the structure up a level.
            filtered = _.map(filtered, function(filtered_result) {
                return filtered_result['doc'];
            });

            // Fix the CouchDB doc to look like an OSDF doc
            filtered = _.map(filtered, function(filtered_result) {
                return osdf_utils.fix_keys(filtered_result);
            });

            // Exclude nodes that we do not have read permission for
            var user = auth.get_user(request);
            filtered = _.filter(filtered, function(node) {
                return perms.has_read_permission(user, node);
            });

            // Assemble the final document for transmission
            var report = {
                'result_count': filtered.length,
                'page': 1,
                'results': []
            };

            _.each(filtered, function(filtered_result) {
                report['results'].push( filtered_result );
            });

            response.jsonp(report);
        });
    } catch (e) {
        logger.error(e);
        osdf_error(response, 'Unable to retrieve node linkages.', 500);
    }
};

// This is the method that handles node creation.
exports.insert_node = function(request, response) {
    logger.debug('In insert_node.');

    var content = request.rawBody;

    waterfall([
        function(callback) {
            var node_data;
            try {
                node_data = JSON.parse(content);
            } catch (err) {
                callback({err: 'Invalid JSON data.', code: 422}, null);
                return;
            }
            callback(null, node_data);
        },
        function(node_data, callback) {
            validate_incoming_node(content, function(err, report) {
                if (err) {
                    logger.error(err);
                    callback({err: err, code: 422});
                } else {
                    callback(null, report, node_data);
                }
            });
        },
        function(report, node_data, callback) {
            if (successful_validation_report(report)) {
                logger.info('Node validated properly.');
                callback(null, node_data);
            } else {
                if (report !== null && report.errors !== null && report.errors.length > 0) {
                    var first_err = report.errors[0];
                    logger.info('Node does not validate. Error: ' + first_err);
                    callback({err: first_err, code: 422});
                } else {
                    callback({err: 'Node does not validate.', code: 422});
                }
            }
        },
        function(node_data, callback) {
            couch_conn.uuids(1, function(err, uuid_list) {
                if (err) {
                    callback(err, null);
                } else {
                    callback(null, uuid_list[0], node_data);
                }
            });
        },
        function(uuid, node_data, callback) {
            node_data['ver'] = 1;
            node_data['id'] = uuid;

            // Checksum the data for provenance purposes
            node_data = provenance.hash_first_version(node_data);

            // Set the ID for the document for CouchDB
            //node_data['_id'] = uuid;

            // Persist to CouchDB
            logger.debug('Saving node to CouchDB.');

            //db.save(node_data, function(err, couch_response) {
            db.save(uuid, node_data, function(err, couch_response) {
                if (err) {
                    logger.error(err);
                    callback(err);
                } else {
                    logger.debug('Successfully saved node to CouchDB.');
                    callback(null, couch_response, node_data);
                }
            });
        },
        function(couch_response, node_data, callback) {
            var node_id = couch_response.id;

            if (couch_response.ok === true) {
                // Save the history
                node_data['id'] = node_id;

                save_history(node_id, node_data, function(err) {
                    if (err) {
                        logger.error(err);
                        callback({err: err, code: 500});
                    } else {
                        var node_url = '{}:{}/nodes/{}'.format(base_url, port, node_id);
                        callback(null, node_url);
                    }
                });
            } else {
                // This shouldn't happen, but...
                logger.error("No error, but CouchDB response was not 'ok'.");
                callback({err: 'Unable to save data.', code: 500});
            }
        }],
    function(err, node_url) {
        if (err) {
            if (_.isPlainObject(err) && err.hasOwnProperty('err') &&
                err.hasOwnProperty('code')) {
                osdf_error(response, err['err'], err['code']);
            } else {
                logger.error(err);
                osdf_error(response, 'Unable to save node.', 500);
            }
        } else {
            logger.info('Successful insertion: ' + node_url);
            response.location(node_url);
            response.status(201).send('');
        }
    });
};

// This is the function that handles edits/modifications to nodes.
exports.update_node = function(request, response) {
    logger.debug('In update_node.');

    var node_id = request.params.id;
    var content = request.rawBody;

    waterfall([
        function(callback) {
            // Check that we have been provided valid JSON
            try {
                var node_data = JSON.parse(content);
                callback(null, node_data);
            } catch (err) {
                callback({err: 'Invalid JSON data.', code: 422}, null);
            }
        },
        function(node_data, callback) {
            // Check that the version has been supplied.
            if (node_data !== null && node_data.hasOwnProperty('ver')) {
                callback(null, node_data);
            } else {
                callback({
                    err: 'Incoming node data does not supply the node version.',
                    code: 422
                });
            }
        },
        function(node_data, callback) {
            validate_incoming_node(content, function(err, report) {
                if (err) {
                    callback({err: err, code: 422});
                } else {
                    callback(null, report, node_data);
                }
            });
        },
        function(report, node_data, callback) {
            if (successful_validation_report(report)) {
                logger.info('Node validated properly.');
                callback(null, node_data);
            } else {
                if (report !== null && report.errors !== null && report.errors.length > 0) {
                    var first_err = report.errors[0];
                    logger.info('Node does not validate. Error: ' + first_err);
                    callback({err: first_err, code: 422});
                } else {
                    callback({err: 'Node does not validate.', code: 422});
                }
            }
        },
        function(node_data, callback) {
            var user = auth.get_user(request);

            // If here, then the node looks okay for an update in terms of
            // structure and validation. Now need to check permissions and
            // execute the update, for which we have an auxiliary function.
            update_helper(user, node_id, node_data, function(err, update_result) {
                if (err) {
                    logger.error('Unable to update data in CouchDB.', err);
                    var msg = update_result['msg'];
                    var code = update_result['code'];
                    callback({'err': msg, 'code': code});
                } else {
                    callback(null);
                }
            });
        }],
    function(err) {
        if (err) {
            if (_.isPlainObject(err) && err.hasOwnProperty('err') &&
                err.hasOwnProperty('code')) {
                osdf_error(response, err['err'], err['code']);
            } else {
                logger.error(err);
                osdf_error(response, 'Unable to update node.', 500);
            }
        } else {
            logger.info('Successful update for node id: ' + node_id);
            response.status(200).send('');
        }
    });
};

// Just validate a node against a schema if it has one assigned for the
// specified node_type. If it does NOT then then only a check for
// well-formedness and basic OSDF structure is performed.
exports.validate_node = function(request, response) {
    logger.debug('In validate_node.');

    var content = request.rawBody;

    var report; // To hold the results of validation

    waterfall([
        function(callback) {
            var e = false;
            try {
                var node_data = JSON.parse(content);
            } catch (err) {
                e = true;
            }

            if (e) {
                callback({err: 'Invalid JSON provided.', code: 422 });
            } else {
                callback(null, node_data);
            }
        },
        function(node_data, callback) {
            validate_incoming_node(content, function(err, report) {
                if (err) {
                    callback(err, null);
                } else {
                    callback(null, report);
                }
            });
        },
        function(report, callback) {
            if (successful_validation_report(report)) {
                // If here, then we're valid
                logger.info('Detected a valid node.');
                callback(null);
            } else {
                var first_err = report.errors[0];

                logger.info('Invalid node. First error: ', first_err);

                // Assemble the full list of errors by iterating and
                // concatenating to a string.
                var error_text = '';
                _.forEach(report.errors, function(err) {
                    error_text = error_text.concat(err + '\n');
                });

                error_text = error_text.trim() + '\n';

                var err_object = {
                    err: first_err,
                    code: 422,
                    content: error_text
                };

                callback(err_object);
            }
        }],
    function(err, result) {
        if (err) {
            // If here, then it's because the node data didn't validate
            // or some other problem occurred.
            if (_.isPlainObject(err) && err.hasOwnProperty('err') &&
                err.hasOwnProperty('code')) {
                // Here we do not simply use the osdf_error() function because
                // we actually want to list all the error messages without the
                // user having to inspect HTTP headers. The first error message
                // will still be in the headers though...
                response.set('X-OSDF-Error', err['err']);
                response.status(err['code']);

                if (err.hasOwnProperty('content')) {
                    response.send(err['content']);
                } else {
                    response.send('');
                }
            } else {
                osdf_error(response, 'Could not validate node.', 500);
            }
        } else {
            logger.debug('Valid node detected.');
            response.status(200).send('');
        }
    });
};

// This message is used to process auxiliary schema deletion events
// that are relayed to this process from the master process by worker.js.
exports.process_aux_schema_change = function(msg) {
    logger.debug('In process_aux_schema_change.');

    var aux_schema_json;

    if (msg.hasOwnProperty('cmd') && msg['cmd'] === 'aux_schema_change') {
        var namespace = msg['ns'];
        var aux_schema_name = msg['name'];

        if (msg.hasOwnProperty('type') && msg['type'] === 'insertion') {
            logger.debug('Got an auxiliary schema insertion.');
            aux_schema_json = msg['json'];
            insert_aux_schema_helper(namespace, aux_schema_name, aux_schema_json);
        } else if (msg.hasOwnProperty('type') && msg['type'] === 'update') {
            logger.debug('Got an auxiliary schema update.');
            aux_schema_json = msg['json'];
            update_aux_schema_helper(namespace, aux_schema_name, aux_schema_json);
        } else if (msg.hasOwnProperty('type') && msg['type'] === 'deletion') {
            logger.debug('Got an auxiliary schema deletion.');
            delete_aux_schema_helper(namespace, aux_schema_name);
        }
    }
};

// This message is used to process schema deletion events that are relayed to
// this process from the master process by worker.js.
exports.process_schema_change = function(msg) {
    logger.debug('In process_schema_change.');

    if (msg.hasOwnProperty('cmd') && msg['cmd'] === 'schema_change') {
        var namespace = msg['ns'];
        var schema_name = msg['name'];

        if (msg.hasOwnProperty('type') && msg['type'] === 'insertion') {
            var json = msg['json'];
            insert_schema_helper(namespace, schema_name, json);
        } else if (msg.hasOwnProperty('type') && msg['type'] === 'deletion') {
            delete_schema_helper(namespace, schema_name);
        }
    }
};

// Validates the data presented based on the json-schema of the node type.
// Returns a report with validation results, or throws an exception if we
// are unable to get that far, for instance, if the content can't be parsed
// into a JSON data structure.
function validate_incoming_node(node_string, callback) {
    logger.debug('In validate_incoming_node.');

    var node;
    var msg;

    if (typeof node_string === 'string') {
        try {
            node = JSON.parse(node_string);
        } catch (parse_error) {
            msg = 'Unable to parse content into JSON.';
            logger.debug(msg);
            callback(msg, null);
            return;
        }
    }

    // Do a rudimentary check with json-schema for whether the JSON document
    // has the required structure/keys.
    var base_result = base_validate(node);

    if (! base_result) {
        var errors = [];
        _.each(base_validate.errors, function(validation_error) {
            var err_msg = '{} on path {}'.format(
                validation_error.message,
                validation_error.dataPath
            );
            errors.push(err_msg);
        });

        logger.debug('Node JSON does not possess the correct structure.');

        var report = {
            valid: false,
            errors: errors
        };

        callback(null, report);

        return;
    }

    waterfall([
        function(callback) {
            var errors = [];
            if (! _.includes(namespaces, node.ns)) {
                msg = 'Node belongs to an unrecognized namespace.';
                logger.error(msg);
                errors.push(msg);
            }
            callback(null, errors);
        },
        function(errors, callback) {
            // Check if the linkages look okay...
            linkage_controller.valid_linkage(node, function(err, valid) {
                if (err) {
                    logger.error('Error when checking for linkage validity: ' + err);
                    callback('Unable to check linkage validity.');
                } else {
                    if (! valid) {
                        errors.push('Invalid linkage detected for node.');
                    }

                    callback(null, errors, valid);
                }
            });
        },
        function(errors, linkage_validity, callback) {
            logger.debug('Linkage validity: ' + linkage_validity);

            var report = null;

            if ( validators.hasOwnProperty(node.ns) &&
                     validators[node.ns].hasOwnProperty(node.node_type) ) {
                // Look up the schema for this node type from our validators
                // data structure.
                var schema = validators[node.ns][node.node_type]['schema'];

                // So, we don't validate the whole node against the JSON schema,
                // just the 'meta' portion.
                var metadata = node['meta'];

                // And validate...
                var validator = validators[node.ns]['val'];

                var valid;
                try {
                    valid = validator.validate(schema, metadata);
                } catch (err) {
                    callback('Error validating document: ' + err);
                }

                if (! valid) {
                    _.each(validator.errors, function(validation_error) {
                        var err_msg = validation_error.message + ' on path ' +
                                      validation_error.dataPath;
                        errors.push(err_msg);
                    });
                }

                // We have to consider BOTH linkage validity AND JSON-Schema
                // validity
                var combined_validity = linkage_validity && valid;

                report = {
                    valid: combined_validity,
                    errors: errors
                };
            } else {
                logger.debug('No validator found for namespace/node_type of {}/{}.'.
                    format(node.ns, node.node_type));

                // Since there is no JSON-Schema validation to check, the only
                // validity to consider at this point is the linkage validity.
                report = {
                    valid: linkage_validity,
                    errors: errors
                };
            }

            callback(null, report);
        }],
    function(err, report) {
        if (err) {
            logger.error(err);
            callback(err, null);
        } else {
            callback(null, report);
        }
    });
}

// A function to parse the version of a CouchDB document out
// from its native CouchDB representation as a string to a
// numeric form.
// Parameters: CouchDB (string)
// Returns: int
function parse_version(couchdb_version) {
    logger.debug('In parse_version.');

    if (couchdb_version === null) {
        throw 'Invalid CouchDB version provided.';
    }
    var couchdb_version_int = parseInt(couchdb_version.split('-')[0], 10);
    return couchdb_version_int;
}

function get_node_version(node_id, callback) {
    logger.debug('In get_node_version.');

    db.get(node_id, function(err, data) {
        if (err) {
            callback('Unable to retrieve node operation.', null);
        } else {
            var couchdb_version = data['_rev'];
            var version = parse_version(couchdb_version);
            callback(null, version);
        }
    });
}

// Simple function to retrieve a document from CouchDB backing database It then
// calls the user provided callback with an error flag, and the document which
// is null if an error was encountered.
// Parameters: couchdb_id (string), callback (function)
// Returns: none
function get_couch_doc(couchdb_id, callback) {
    logger.debug('In get_couch_doc.');

    db.get(couchdb_id, function(err, data) {
        if (err) {
            callback('Unable to retrieve CouchDB doc.', null);
        } else {
            callback(null, data);
        }
    });
}

function update_helper(user, node_id, node_data, callback) {
    logger.debug('In update_helper.');

    var node_version = node_data['ver'];
    // What we will send back through the callback
    var result = {};

    waterfall([
        function(callback) {
            get_couch_doc(node_id, function(err, data) {
                if (err) {
                    result['msg'] = 'Unable to perform update operation.';
                    result['code'] = 500;

                    // This should stop the waterfall...
                    callback(err);
                } else {
                    callback(null, data);
                }
            });
        },
        function(data, callback) {
            var previous_node = data;
            var previous_version = previous_node['ver'];
            var previous_couch_version = previous_node['_rev'];

            if (node_version !== previous_version) {
                var msg = "Version provided ({}) doesn't match saved ({}).";
                msg = msg.format(node_version, previous_version);

                result['msg'] = msg;
                result['code'] = 422;

                // This should stop the waterfall...
                callback(msg);
            } else {
                callback(null, previous_node, previous_couch_version);
            }
        },
        function(previous_node, previous_couch_version, callback) {
            // Check that the user has sufficient permissions to make
            // edits to this node.
            var can_write = perms.has_write_permission(user, previous_node);

            if (can_write) {
                logger.debug('User {} has write permission to node {}.'
                    .format(user, node_id)
                );
                callback(null, previous_node, previous_couch_version);
            } else {
                var msg = 'User {} does not have write permissions for node {}.'
                    .format(user, node_id);
                logger.info(msg);
                callback(msg);
            }
        },
        function(previous_node, previous_couch_version, callback) {
            node_data['ver'] = node_version + 1;

            // Checksum with the previous version of the node to extend
            // provenance/checksum chain
            node_data = provenance.set_checksums(previous_node, node_data);

            // Okay to proceed with the update because the versions match
            db.save(node_id, previous_couch_version, node_data, function(err, couch_response) {
                if (err) {
                    result['msg'] = err.error;
                    result['code'] = 500;

                    callback(err);
                }

                if (! couch_response.ok) {
                    result['msg'] =  'Unable to save node data.';
                    result['code'] = 500;

                    callback(result['msg']);
                }

                logger.info('Successful update for node id: ' + node_id);
                callback(null, previous_node);
            });
        },
        function(previous_node, callback) {
            // Save the history
            logger.debug('Saving node history for node: ' + node_id);

            previous_node = osdf_utils.fix_keys(previous_node);

            if (previous_node['ver'] !== 1) {
                save_history(node_id, previous_node, function(err) {
                    if (err) {
                        logger.error(err);

                        result['msg'] = err.error;
                        result['code'] = 500;

                        callback(err);
                    } else {
                        result['msg'] = '';
                        result['code'] = 200;

                        callback(null);
                    }
                });
            } else {
                result['msg'] = '';
                result['code'] = 200;

                callback(null);
            }
        }
    ], function(err) {
        // In both cases (failure and success) the caller is going to need
        // 'result' so we know what error code and message to return back
        // to the client.
        if (err) {
            callback(err, result);
        } else {
            callback(null, result);
        }
    });
}

function schema_registrar(namespace, callback) {
    logger.debug('In schema_registrar: ' + namespace);

    var schema_dir = path.join(ns2working(namespace), 'schemas');

    // Scan the working area for the namespace for JSON schema files for the
    // node_types. Each .json file in there is basenamed with the name of the
    // node_type.
    fs.readdir(schema_dir, function(err, files) {
        if (err) {
            logger.error(err);
            throw err;
        }

        logger.debug('Filtering out non-json files.');
        files = _.filter(files, function(file) {
            return path.extname(file) === '.json';
        });

        if (files.length === 0) {
            validators[namespace] = {};
            callback(null);
        } else {
            var err_flag = null;

            _.forEach(files, function(node_type_schema) {
                logger.info('Found a schema! ' + node_type_schema);

                var node_type = path.basename(node_type_schema, '.json');

                // If the validators structure has no key for the namespace
                // we kick things off by defining it and setting the value
                // to an empty object.
                if (! validators.hasOwnProperty(namespace)) {
                    validators[namespace] = {};
                }

                // If the validators structure has the namespace
                // registered, but the node_type is yet unseen, then we
                // initialize that to an empty object.
                if (! validators[namespace].hasOwnProperty(node_type)) {
                    validators[namespace][node_type] = {};
                }

                var schema_path = path.join(schema_dir, node_type_schema);

                fs.readFile(schema_path, 'utf-8', function(err, data) {
                    if (err) {
                        logger.error('Unable to read ' + schema_path, err);
                        callback(err);
                    }

                    try {
                        validators[namespace][node_type]['schema'] = JSON.parse(data);
                    } catch (parse_err) {
                        logger.error('ERROR: Unable to parse schema {} to JSON !!!'
                            .format(node_type_schema));
                        err_flag = parse_err;
                        return false;
                    }
                });
            });

            callback(err_flag);
        }
    });
}

function define_namespace_validators(namespace, define_cb) {
    logger.debug('In define_namespace_validators: ' + namespace);

    series([
        function(callback) {
            schema_registrar(namespace, function(err) {
                if (err) {
                    callback(err);
                } else {
                    callback(null);
                }
            });
        },
        function(callback) {
            register_aux_schemas(namespace, function(err) {
                if (err) {
                    callback(err);
                } else {
                    logger.info('Finished registering auxiliary schemas for ' +
                                'namespace "{}".'.format(namespace));
                    callback(null);
                }
            });
        }],
    function(err) {
        if (err) {
            logger.error(err);
        }
        define_cb(err);
    });
}

// This function is used to help out with the deletion of nodes once it has already
// been determined that the node is okay to be deleted because no nodes point to the
// target node with linkages.
// Parameters: user (string), the user requesting deletion
//             node_id (string), the id of the node being deleted
//             response (object), the http response object so response can be sent.
// Returns: none
function delete_helper(user, node_id, response) {
    logger.debug('In delete_helper.');

    db.get(node_id, function(err, node_data) {
        try {
            if (err) {
                if (err.error && err.error === 'not_found') {
                    logger.info('User "{}" attempted to delete unknown node {}.'
                        .format(user, node_id));
                    osdf_error(response, 'Unknown node.', 422);
                } else {
                    throw err.reason;
                }
            } else {
                var can_write = perms.has_write_permission(user, node_data);

                if (can_write) {
                    delete_couch_doc(node_id, function(err) {
                        if (err) {
                            throw 'Unable to delete node ' + node_id;
                        } else {
                            delete_history_node(node_id, function(err) {
                                if (err) {
                                    logger.warn(
                                        'Unable to delete history of node: {}: {}'
                                            .format(node_id, err.message)
                                    );
                                } else {
                                    logger.info('Successful deletion: ' + node_id);
                                }
                                response.status(204).send('');
                            });
                        }
                    });
                } else {
                    logger.debug('User "{}" cannot delete node '.format(user, node_id));
                    osdf_error(response, 'No ACL permissions to delete node.', 403);
                }
            }
        } catch (err) {
            logger.warn('Failed deletion.', err);
            response.status(500).send('');
        }
    });
}

function delete_history_node(node_id, callback) {
    logger.debug('In delete_history_node.');

    var history_node_id = node_id + '_hist';

    delete_couch_doc(node_id + '_hist', function(err) {
        if (err) {
            logger.error('Unable to delete history node for node: ' + history_node_id);
            callback(err);
        } else {
            callback(null);
        }
    });
}

function delete_aux_schema_helper(namespace, aux_schema_name) {
    logger.debug('In node-handler:delete_aux_schema_helper.');

    if (! (validators.hasOwnProperty(namespace))) {
        logger.error('No such namespace: ' + namespace);
    }
}

function delete_schema_helper(namespace, schema_name) {
    logger.debug('In node-handler:delete_schema_helper.');

    if (validators.hasOwnProperty(namespace) &&
            validators[namespace].hasOwnProperty(schema_name)) {
        logger.debug('Deleting schema {} from {} namespace.'
            .format(schema_name, namespace));
        delete validators[namespace][schema_name];
    } else {
        logger.error('The specified namespace or schema is not known.');
    }
}

// This is the function that is used to save the node data into
// the 'historical record' every time an update is made to it. The
// way we actually implement this is by saving the data as an
// attachment into a special CouchDB document that is paired with
// with the regular node document, but that has the sole purpose
// of holding the node's changes over time as attachments.
// Parameters: id (string) - The CouchDB document ID.
//             callback (function) - Called when complete with an error
//                                   argument. Null if operation was successful.
// Returns: none
function delete_couch_doc(id, callback) {
    logger.debug('In delete_couch_doc: {}'.format(id));

    db.get(id, function(err, doc_data) {
        if (err) {
            logger.error("Unable to determine revision of id {}. Can't delete."
                .format(id));
            callback(err);
        } else {
            var doc_revision = doc_data['_rev'];

            db.remove(id, doc_revision, function(err, res) {
                if (err) {
                    callback(err);
                } else {
                    logger.debug('Successful deletion of node: ' + id);
                    callback(null);
                }
            });
        }
    });
}

// This function is used to determine if any nodes point to this node.
// We know what nodes we point to because they are listed in the linkage
// property of the object, but to determine what nodes point to us, we
// perform a query against a special view in the database. We also discount
// linkages of nodes against themselves. Those, if they exist, should not
// be counted as dependencies.
//
// Parameters: a node object, or node_id string
// Returns: a boolean
function has_dependent_nodes(node, callback) {
    logger.debug('In has_dependent_nodes.');

    var node_id;
    if (typeof(node) === 'object' && node.hasOwnProperty('id') &&
            node.hasOwnProperty('linkage') && node.hasOwnProperty('meta')) {
        node_id = node['id'];
    } else if (typeof(node) === 'string') {
        node_id = node;
    } else {
        throw 'Invalid argument.';
    }
    logger.debug('Checking {} for dependencies.'.format(node_id));

    var has_dependencies = false;

    // Query the specially created view using cradle.
    db.view('linkage/reverse', {key: node_id}, function(err, response) {
        if (err) {
            callback(err, null);
        }

        // Remove any reference to ourselves from consideration
        response = _.reject(response, function(row) {
            return row['id'] === node_id;
        });

        var row_count = response.length;
        if (row_count > 0) {
            logger.debug('Found dependencies for ' + node_id);
            has_dependencies = true;
        }
        callback(null, has_dependencies);
    });
}

// TODO: Investigate whether ajv overwrites the previous notion it had
// for that auxiliary schema. This code assumes that it does.
function update_aux_schema_helper(namespace, name, aux_schema_json) {
    logger.debug('In node-handler:update_aux_schema_helper.');

    logger.debug('Type of aux schema provided: ' + typeof(aux_schema_json));

    if (validators.hasOwnProperty(namespace)) {
        var validator = validators[namespace]['val'];

        load_aux_schema_into_validator_from_json(validator, name, aux_schema_json, function(err) {
            if (err) {
                logger.error('Unable to load aux schema: ' + err);
            }
            return;
        });
    } else {
        logger.error('No such namespace: ' + namespace);
    }
}

function insert_aux_schema_helper(namespace, name, aux_schema_json) {
    logger.debug('In node-handler:insert_aux_schema_helper.');

    logger.debug('Type of aux schema provided: ' + typeof(aux_schema_json));

    if (validators.hasOwnProperty(namespace)) {
        var validator = validators[namespace]['val'];
        load_aux_schema_into_validator_from_json(validator, name, aux_schema_json, function(err) {
            if (err) {
                logger.error('Unable to load aux schema: ' + err);
            }
            return;
        });
    } else {
        logger.error('No such namespace: ' + namespace);
    }
}

function insert_schema_helper(namespace, name, schema_json) {
    logger.debug('In insert_schema_helper.');

    if (validators.hasOwnProperty(namespace)) {
        var validator = validators[namespace]['val'];
        try {
            validator.addSchema(schema_json, name);
        } catch (err) {
            logger.error('Unable to load schema: ' + err);
        }
    } else {
        logger.error('No such namespace: ' + namespace);
    }
}

function load_aux_schema_into_validator(validator, schema, callback) {
    logger.debug('In load_aux_schema_into_validator: ' + schema);
    var basename = path.basename(schema, '.json');

    fs.readFile(schema, 'utf-8', function(err, data) {
        if (err) {
            logger.error('Missing or invalid schema found for ' + schema);
            callback(err);
        } else {
            logger.debug('Registering schema "{}" with id "{}".'
                .format(schema, basename));
            // The second argument, with the ajv library, is interpreted as the
            // $ref schemas's ID.
            validator.addSchema(JSON.parse(data), basename);
            callback(null);
        }
    });
}

function load_aux_schema_into_validator_from_json(validator, name, aux_schema_json, callback) {
    logger.debug('In load_aux_schema_into_validator_from_json. ' +
                 'Aux schema name: ' + name);

    var json_type = typeof(aux_schema_json);

    try {
        if (json_type === 'object') {
            validator.addSchema(aux_schema_json, name);
            callback(null);
        } else if (json_type === 'string') {
            validator.addSchema(JSON.parse(aux_schema_json), name);
            callback(null);
        } else {
            callback('Invalid data type for auxiliary schema.');
        }
    } catch (err) {
        logger.error('Error in load_aux_schema_into_validator_from_json: ' + err);
        callback(err);
    }
}

function load_aux_schemas_into_validator(ns, validator, schemas, then) {
    logger.debug('In load_aux_schemas_into_validator.');
    var loaded = {};
    recursive_load_helper(ns, validator, schemas, loaded, then);
}

function locate_aux_schema_by_name(ns, aux_schema_name) {
    return path.join(working_dir, 'namespaces', ns, 'aux', aux_schema_name + '.json');
}

function locate_aux_schema_source(ns, aux_schema) {
    return path.join(working_dir, 'namespaces', ns, 'aux', aux_schema);
}

// Given a namespace name (string), return the location on the filesystem
// where the namespace's working directory is.
//
// Parameters: namespace (string)
// Returns: path (string)
function ns2working(namespace) {
    var location = path.join(working_dir, 'namespaces', namespace);
    return location;
}

// A utility function to establish the various JSON-Schema validator objects
// for each of the namespaces that we know about. This all happens
// asynchronously, so the argument to the function is a callback for client
// code to know when the process is complete.
//
// Parameters: populate_callback (function)
// Returns: none
function populate_validators(populate_callback) {
    logger.debug('In populate_validators.');

    each(namespaces, function(ns, cb) {
        logger.info('Creating validators for namespace: ' + ns);
        define_namespace_validators(ns, function(err) {
            if (err) {
                logger.error('Error creating validators for namespace: ' + ns);
            }
            cb(err);
        });
    },
    function(err) {
        if (err) {
            logger.error(err);
        }
        populate_callback(err);
    });
}

function establish_linkage_controls(callback) {
    logger.debug('In establish_linkage_controls.');

    each(namespaces, function(ns, cb) {
        logger.info('Checking namespace "{}" for linkage.json file.'.format(ns));
        var linkage_path = path.join(ns2working(ns), 'linkage.json');
        logger.debug('Path to linkage.json: ' + linkage_path);

        fs.stat(linkage_path, function(err, stat) {
            if (err === null) {
                logger.info('Linkage control file exists for namespace "{}".'
                    .format(ns));

                fs.readFile(linkage_path, 'utf8', function(err, file_text) {
                    if (err) {
                        logger.error(err);
                        cb(err);
                    }

                    var linkage_json;

                    try {
                        linkage_json = JSON.parse(file_text);
                    } catch (parse_err) {
                        var msg = 'Unable to parse linkage control file for ' +
                            'namespace "{}"!';
                        msg = msg.format(ns);
                        logger.error(msg);
                        cb(msg);
                    }

                    logger.debug('Successfully parsed linkage control file ' +
                        'for namespace "{}".'.format(ns));
                    linkage_controller.set_namespace_linkages(ns, linkage_json);
                    cb(null);
                });
            } else {
                logger.info('No linkage control file for namespace "{}".'.format(ns));
                cb(null);
            }
        });
    },
    function(err) {
        if (err) {
            logger.error('Error in establish_linkage_controls: ' + err);
            callback(err);
        } else {
            callback(null);
        }
    });
}

// Recursively load all the auxiliary schemas belonging to a namespace
// into the provided JSON-Schema validator in order to be able to validate
// incoming nodes for compliance.
//
// Parameters
// ns: The string namespace name
// ajv: The ajv validator. Each namespace has one.
// schemas: An array of schema files to load, each may contain references to
//          other schemas
// then: a callback that is called when the loading is complete
function recursive_load_helper(ns, ajv, schemas, loaded, then) {
    each(schemas, function(schema, cb) {
        var schema_src = locate_aux_schema_source(ns, schema);

        fs.stat(schema_src, function(err, stats) {
            if (err) {
                logger.debug('Error examining {}: {}.'.format(schema_src, err));
                cb(err);
            }

            if (stats.isDirectory()) {
                logger.warn('Skipping directory: ' + schema_src);
                cb();
            } else {
                var schema_id = path.basename(schema, '.json');

                fs.readFile(schema_src, function(err, data) {
                    if (err) {
                        logger.error(err);
                        cb(err);
                    }

                    var schemaJson, reference_ids;
                    try {
                        schemaJson = JSON.parse(data);
                        reference_ids = schema_utils.extractRefNames(schemaJson);
                    } catch (e) {
                        logger.warn('Unable to extract references from ' + schema_src);
                        cb(e);
                    }

                    var reference_schemas = [];
                    _.forEach(reference_ids, function(reference_id) {
                        var schema_file = reference_id + '.json';
                        reference_schemas.push(schema_file);
                    });

                    // Call ourselves and pass along the list of schemas that we have
                    // already loaded.
                    recursive_load_helper(ns, ajv, reference_schemas, loaded, function(err) {
                        if (loaded.hasOwnProperty(schema_id)) {
                            logger.debug('Already loaded ' + schema_id);
                            cb();
                        } else {
                            load_aux_schema_into_validator(ajv, schema_src, function() {
                                // Make a note that we loaded this one already
                                loaded[schema_id] = 1;
                                cb();
                            });
                        }
                    });
                });
            }
        });
    },
    function(err) {
        if (err) {
            logger.error('Recursion error. ' + err);
        }
        then(err);
    });
}

function register_aux_schemas(ns, callback) {
    logger.debug('In register_aux_schemas: ' + ns);

    var validator = new ajv({allErrors: true});

    register_aux_schemas_to_validator(validator, ns, function(err) {
        if (err) {
            logger.error('Error in register_aux_schemas: ', err);
            callback(err);
        } else {
            validators[ns]['val'] = validator;
            callback(null);
        }
    });
}

function register_aux_schemas_to_validator(validator, ns, then) {
    logger.debug('In register_aux_schemas_to_validator.');

    waterfall([
        function(callback) {
            var aux_dir = path.join(working_dir, 'namespaces', ns, 'aux');

            // Scan the files contained in the directory and process them
            fs.readdir(aux_dir, function(err, files) {
                if (err) {
                    logger.error(err);
                    callback(err);
                    return;
                }

                logger.debug('Filtering out non-json files.');
                var acceptable_files = _.filter(files, function(file) {
                    return path.extname(file) === '.json';
                });

                logger.info('Acceptable aux schema file count: ' +
                            acceptable_files.length);
                callback(null, acceptable_files);
            });
        },
        function(files, callback) {
            load_aux_schemas_into_validator(ns, validator, files, function(err) {
                callback(err);
            });
        }],
    function(err, results) {
        then(err);
    });
}

function node_retrieval_helper(request, response, err, data) {
    logger.debug('In node_retrieval_helper.');

    if (err) {
        if (err.error === 'not_found') {
            logger.debug('User requested non-existent node.');
            osdf_error(response, 'Non-existent node.', 404);
        } else {
            logger.error(err);
            osdf_error(response, err.error, 500);
        }
    } else {
        var user = auth.get_user(request);

        if (perms.has_read_permission(user, data)) {
            var fix = osdf_utils.fix_keys(data);
            response.jsonp(fix);
        } else {
            logger.info('User {} does not have read permissions for node.'
                .format(user)
            );
            osdf_error(response, 'No read access to this node.', 403);
        }
    }
}

// This is the function that is used to save the node data into
// the 'historical record' every time an update is made to it. The
// way we actually implement this is by saving the data as an
// attachment into a special CouchDB document that is paired with
// with the regular node document, but that has the sole purpose
// of holding the node's changes over time as attachments.
// Parameters: node_id (string)
//             node_data (string) - In JSON format
//             callback (function) - Called when complete
// Returns: none
function save_history(node_id, node_data, callback) {
    logger.debug('In save_history.');
    var version = node_data['ver'];

    var attachment = {
        body: JSON.stringify(node_data),
        contentType: 'application/json',
        name: version.toString()
    };

    try {
        if (version === 1) {
            // This is the first time this node is being edited/changed
            db.save(node_id + '_hist', {}, function(err, data) {
                if (err) {
                    logger.error(err);
                    throw err;
                }

                var first_hist_version = data['_rev'];

                var doc = {
                    id: node_id + '_hist',
                    rev: first_hist_version
                };

                // Save the data as an attachment into CouchDB...
                db.saveAttachment(doc, attachment, function(err, data) {
                    if (err) {
                        logger.error(err);
                        throw err;
                    }
                    logger.debug('Saved first history for node {}.'.
                        format(node_id));
                    callback(null);
                });
            });
        } else {
            // This is not the first change/edit to this node...
            db.get(node_id + '_hist', function(err, hist_node) {
                if (err) {
                    logger.error(err);
                    throw err;
                }

                var doc = {
                    id: node_id + '_hist',
                    rev: hist_node['_rev']
                };

                // Save the data as an attachment into CouchDB...
                db.saveAttachment(doc, attachment, function(err, data) {
                    if (err) {
                        logger.error(err);
                        throw err;
                    }

                    logger.debug('Saved history for node {}.'.format(node_id));
                    callback(null);
                });
            });
        }
    } catch (err) {
        callback(err);
    }
}

function successful_validation_report(report) {
    logger.debug('In successful_validation_report.');

    // Assume it's not valid until proven otherwise
    var valid = false;

    if (report !== null && (report.valid &&
            (report.errors === null || report.errors.length === 0))) {
        valid = true;
    }

    return valid;
}
