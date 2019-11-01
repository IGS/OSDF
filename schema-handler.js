var _ = require('lodash');
var config = require('config');
var each = require('async/each');
var events = require('events');
var fs = require('fs');
var osdf_utils = require('osdf_utils');
var path = require('path');
var schema_utils = require('schema_utils');
var util = require('util');
var waterfall = require('async/waterfall');
var format = require('string-format');

format.extend(String.prototype);

var root_local_dir = osdf_utils.get_osdf_root();
var logger = osdf_utils.get_logger();
config.load(osdf_utils.get_config());

var osdf_error = osdf_utils.send_error;
var bind_address = config.value('global', 'bind_address');
var port = config.value('global', 'port');
var base_url = config.value('global', 'base_url');
var working_dir;
var global_schemas = {};

function SchemaHandler() {
    // The constructor
}

// Let's make SchemaHandler inherit from EventEmitter so that we
// can emit events.
util.inherits(SchemaHandler, events.EventEmitter);

module.exports = new SchemaHandler();
exports = module.exports;

exports.init = function(emitter, working_dir_custom) {
    logger.debug('In init.');

    if (working_dir_custom !== null &&
        typeof working_dir_custom !== 'undefined') {
        logger.debug('Configuring for a custom working directory of: ' +
                     working_dir_custom);
        working_dir = working_dir_custom;
    } else {
        working_dir = path.join(root_local_dir, 'working');
    }

    var ns_schema_dir;

    // Get all the namespace names into a list of strings
    osdf_utils.get_namespace_names(function(ns_err, namespaces) {
        if (ns_err) {
            logger.error('Aborting schema_handler initialization.');
            emitter.emit('schema_handler_aborted', ns_err);
        } else {
            logger.debug('Namespaces to scan: ' + namespaces.length);

            each(namespaces, function(ns, cb) {
                get_ns_schemas(ns, function(err, ns_schemas) {
                    if (err) {
                        logger.error(err);
                        cb(err);
                    } else {
                        global_schemas[ns] = ns_schemas;
                        cb();
                    }
                });
            }, function(err) {
                if (err) {
                    logger.error('Aborting schema_handler initialization.');
                    emitter.emit('schema_handler_aborted', err);
                } else {
                    logger.info('Finished scanning all schemas.');
                    emitter.emit('schema_handler_initialized');
                }
            });
        }
    });
};

// Retrieves all the primary schemas belonging to a namespace.
exports.get_all_schemas = function(request, response) {
    var ns = request.params.ns;

    logger.debug('In get_all_schemas: ' + ns);

    // First of all, is the requested namespace even known to us?
    if (global_schemas.hasOwnProperty(ns) && global_schemas[ns].hasOwnProperty('schemas')) {
        response.jsonp(global_schemas[ns]['schemas']);
    } else {
        logger.warn('User requested schemas for an unknown namespace: ' + ns);
        osdf_error(response, 'Namespace or schema not found.', 404);
        return;
    }
};

// Retrieves all the auxiliary schemas belonging to a namespace. The
// namespace is specified by the client in the URL.
exports.get_all_aux_schemas = function(request, response) {
    var ns = request.params.ns;

    logger.debug('In get_all_aux_schemas. Namespace: {}.'.format(ns));

    if (global_schemas.hasOwnProperty(ns)) {
        // Need to return all the auxiliary schemas, which are found
        // under global_schemas[ns]['aux'].
        if (global_schemas[ns].hasOwnProperty('aux')) {
            response.jsonp(global_schemas[ns]['aux']);
        } else {
            // Send an emtpy object
            response.jsonp({});
        }
    } else {
        logger.warn('Unknown ns: ' + ns);
        osdf_error(response, 'Namespace not found.', 404);
    }
};

// Retrieves a specific auxiliary schema belonging to a namespace. Both the
// namespace and the auxiliary schema name are specified by the client
// in the URL.
exports.get_aux_schema = function(request, response) {
    var ns = request.params.ns;
    var aux = request.params.aux;

    logger.debug('In get_aux_schema (ns:aux): ({}:{}).'.format(ns, aux));

    if (global_schemas.hasOwnProperty(ns)) {
        if (global_schemas[ns].hasOwnProperty('aux') &&
                global_schemas[ns]['aux'].hasOwnProperty(aux)) {
            response.jsonp(global_schemas[ns]['aux'][aux]);
        } else {
            logger.warn('Unknown ns:aux: {}:{}.'.format(ns, aux));
            osdf_error(response, 'Auxiliary schema not found.', 404);
        }
    } else {
        logger.warn('Unknown ns: ' + ns);
        osdf_error(response, 'Namespace not found.', 404);
    }
};

// Retrieves a specific main schema belonging to a namespace. Both the
// namespace and the schema name are specified by the client in the URL.
exports.get_schema = function(request, response) {
    var ns = request.params.ns;
    var schema = request.params.schema;

    logger.debug('In get_schema (ns:schema): (' + ns + ':' + schema + ').');

    if (global_schemas.hasOwnProperty(ns)) {
        if (global_schemas[ns].hasOwnProperty('schemas') &&
                global_schemas[ns]['schemas'].hasOwnProperty(schema)) {
            response.jsonp(global_schemas[ns]['schemas'][schema]);
        } else {
            logger.warn('Unknown ns:schema: {}:{}.'.format(ns, schema));
            osdf_error(response, 'Schema not found.', 404);
        }
    } else {
        logger.warn('Unknown ns: ' + ns);
        osdf_error(response, 'Namespace not found.', 404);
    }
};

// This is the code that implements auxiliary schema insertion for when users
// wish to create NEW auxiliary schemas. Auxiliary schemas are schemas which
// can be reused and referenced from main schemas using the $ref construct.
exports.insert_aux_schema = function(request, response) {
    logger.debug('In insert_aux_schema.');

    // Get the namespace and the schema data (JSON) that has been provided.
    var ns = request.params.ns;
    var content = request.rawBody;

    // Before we do anything, let's see if the namespace is known to us. If it
    // isn't then we send an appropriate HTTP response code.
    if (! global_schemas.hasOwnProperty(ns)) {
        logger.warn('User attempted to insert an auxiliary schema into an ' +
                    'unknown namespace: ' + ns);
        osdf_error(response, 'Namespace not found.', 404);
        return;
    }

    // Parse the data provided. If it's invalid/malformed, we're about to find
    // out.
    var insertion_doc = null;

    try {
        insertion_doc = JSON.parse(content);
    } catch (err) {
        logger.warn('User provided invalid JSON for auxiliary schema ' +
                    'insertion.');
        osdf_error(response, 'Invalid JSON provided for insertion.', 422);
        return;
    }

    var msg = null;

    // Okay, so the user provided valid JSON. However, is it in the right
    // format?  Check that the JSON has 'name' and 'schema' properties...
    if (! insertion_doc.hasOwnProperty('name')) {
        msg = "Document did not have the required 'name' property.";
        logger.error(msg);
        osdf_error(response, msg, 422);
        return;
    }

    if (! insertion_doc.hasOwnProperty('schema')) {
        msg = "Document did not have the required 'schema' property.";
        logger.error(msg);
        osdf_error(response, msg, 422);
        return;
    }

    var aux_schema_name = insertion_doc['name'];
    var aux_schema_json = insertion_doc['schema'];

    // Check that the JSON-Schema embedded in the user-supplied data is
    // actually valid JSON-Schema and not just a string, or regular JSON that
    // is not JSON-Schema.
    logger.info('Checking if aux schema document is valid JSON-Schema.');
    if (! schema_utils.valid_json_schema(aux_schema_json)) {
        logger.warn('User provided invalid JSON-schema.');
        osdf_error(response, 'Invalid JSON-Schema.', 422);
        return;
    }

    // Now we check if the auxiliary schema already exists. If it does, then
    // we need to reject the insertion as the user should either do an update
    // or a delete instead.
    if (global_schemas[ns]['aux'].hasOwnProperty(aux_schema_name)) {
        osdf_error(response, 'Auxiliary schema ' + aux_schema_name +
                   ' already exists in namespace ' + ns, 409);
        return;
    }

    // Check if the schema name looks okay.
    if (! schema_utils.valid_schema_name(aux_schema_name)) {
        msg = 'Invalid auxiliary schema name.';
        logger.warn(msg);
        osdf_error(response, msg, 422);
        return;
    }

    try {
        // The last parameter indicates that this worker is the first to
        // receive this request (we're not responding to a hint from the master
        // process) and therefore we are the worker responsible for writing the
        // data to disk/storage.
        aux_schema_change_helper(ns, aux_schema_name, aux_schema_json, true);

        // Can't use 'this', so we have to reach down to the module.exports
        // to get the inherited emit() function.
        module.exports.emit('insert_aux_schema', {
            'ns': ns,
            'name': aux_schema_name,
            'json': aux_schema_json
        });

        // Send a message to the master process so that it can notify other
        // sibling workers about this.
        process.send({
            cmd: 'aux_schema_change',
            type: 'insertion',
            ns: ns,
            name: aux_schema_name,
            json: aux_schema_json
        });

        // The URL to the new aux schema should be supplied back in the form
        // of a Location header
        var location = '{}:{}/namespaces/{}/schemas/aux/{}'.format(
            base_url, port, ns, aux_schema_name
        );

        response.location(location);
        response.status(201).send('');
    } catch (e) {
        logger.error(e);
        osdf_error(response, 'Unable to insert auxiliary schema.', 500);
        return;
    }
};

// This is the code that implements schema insertion for when users wish
// to create NEW schemas.
exports.insert_schema = function(request, response) {
    logger.debug('In insert_schema.');

    // Get the namespace and the schema data (JSON) that has been provided.
    var ns = request.params.ns;
    var content = request.rawBody;

    // Before we do anything, let's see if the namespace is known to us. If it
    // isn't then we send an appropriate HTTP response code.
    if (! global_schemas.hasOwnProperty(ns)) {
        logger.warn('User attempted to insert a schema into an unknown ' +
                    'namespace: ' + ns);
        osdf_error(response, 'Namespace not found.', 404);
        return;
    }

    // Parse the data provided. If it's invalid/malformed, we're about to find
    // out.
    var insertion_doc = null;
    try {
        insertion_doc = JSON.parse(content);
    } catch (err) {
        logger.warn('User provided invalid JSON for schema insertion.');
        osdf_error(response, 'Invalid JSON provided for insertion.', 422);
        return;
    }

    var msg = null;

    // Okay, so the user provided valid JSON. However, is it in the right
    // format?  Check that the JSON has 'name' and 'schema' properties...
    if (! insertion_doc.hasOwnProperty('name')) {
        msg = "Document did not have the required 'name' property.";
        logger.error(msg);
        osdf_error(response, msg, 422);
        return;
    }

    if (! insertion_doc.hasOwnProperty('schema')) {
        msg = "Document did not have the required 'schema' property.";
        logger.error(msg);
        osdf_error(response, msg, 422);
        return;
    }

    var schema_name = insertion_doc['name'];
    var schema_json = insertion_doc['schema'];

    // Check if the schema name looks okay.
    if (! schema_utils.valid_schema_name(schema_name)) {
        msg = 'Invalid schema name.';
        logger.warn(msg);
        osdf_error(response, msg, 422);
        return;
    }

    // Check that the JSON-Schema embedded in the user-supplied data is
    // actually valid JSON-Schema and not just a string, or regular JSON that
    // is not JSON-Schema.
    logger.info('Checking if schema document is valid JSON-Schema.');
    if (! schema_utils.valid_json_schema(schema_json)) {
        logger.warn('User provided invalid JSON-Schema.');
        osdf_error(response, 'Invalid JSON-Schema.', 422);
        return;
    }

    // Now we check if the schema already exists. If it does, then we need to
    // reject the insertion as the user should either do an update or a delete
    // instead.
    if (global_schemas[ns]['schemas'].hasOwnProperty(schema_name)) {
        osdf_error(
            response,
            'Schema {} already exists in namespace {}.'.format(schema_name, ns),
            409
        );
        return;
    }

    // Check if the incoming schema make use of any references that we don't
    // already know about.
    var refs = schema_utils.extractRefNames(schema_json);

    for (var ref_index in refs) {
        var aux_name = refs[ref_index];
        if (global_schemas[ns].hasOwnProperty('aux') &&
                global_schemas[ns]['aux'].hasOwnProperty(aux_name)) {
            // If here, then we know about this auxiliary schema. Nothing to do.
        } else {
            logger.warn('Schema uses unknown reference/aux schema: ' + aux_name);
            osdf_error(response,
                'Schema uses unknown reference/aux schema.', 422);
            return;
        }
    }

    try {
        // The last parameter indicates that this worker is the first to
        // receive this request (we're not responding to a hint from the master
        // process) and therefore we are the worker responsible for writing the
        // data to disk/storage.
        schema_change_helper(ns, schema_name, schema_json, true);

        // Can't use 'this', so we have to reach down to the module.exports
        // to get the inherited emit() function.
        module.exports.emit('insert_schema', {
            'ns': ns,
            'name': schema_name,
            'json': schema_json
        });

        // Send a message to the master process so that it can notify other
        // sibling workers about this.
        process.send({
            cmd: 'schema_change',
            type: 'insertion',
            ns: ns,
            name: schema_name,
            json: schema_json
        });

        var location = '{}:{}/namespaces/{}/schemas/{}'.format(
            base_url, port, ns, schema_name
        );

        response.location(location);
        response.status(201).send('');
    } catch (e) {
        logger.error(e);
        osdf_error(response, 'Unable to insert schema.', 500);
        return;
    }
};

/*
   Delete a JSON schema from a namespace. We delete it
   from memory as well as from disk.  A user must have 'write' access to the
   namespace in order to delete one of the namespace's schemas.

   TODO: Check the namespace ACL for permission to delete
 */
exports.delete_schema = function(request, response) {
    logger.debug('In delete_schema.');

    // The namespace the schema belongs to
    var ns = request.params.ns;

    // The name of the schema to delete
    var schema_name = request.params.schema;

    if (! global_schemas.hasOwnProperty(ns)) {
        logger.warn('User attempted to delete a schema from ' +
                    'unknown namespace: ' + ns);
        osdf_error(response, 'Namespace not found.', 404);
        return;
    }

    if (global_schemas[ns].hasOwnProperty('schemas') &&
            global_schemas[ns]['schemas'].hasOwnProperty(schema_name)) {
        try {
            delete_schema_helper(ns, schema_name);

            // Can't use 'this', so we have to reach down to the module.exports
            // to get the inherited emit() function.
            module.exports.emit('delete_schema', {
                'ns': ns,
                'name': schema_name
            });

            // Send a message to the master process so that it can notify other
            // sibling workers about this.
            process.send({
                cmd: 'schema_change',
                type: 'deletion',
                ns: ns,
                name: schema_name
            });

            response.status(204).send('');
        } catch (err) {
            logger.error('Unable to delete schema.', err);
            osdf_error(response, 'Unable to delete schema.', 500);
        }
    } else {
        logger.warn('User attempted to delete a non-existent ' +
                    'schema: ' + schema_name);
        osdf_error(response, 'Schema not found.', 404);
        return;
    }
};

/* Delete an auxiliary schema.  We delete it from memory
   as well as from disk. A user must have 'write' access to the
   namespace in order to delete one of the namespace's auxiliary
   schemas.

   TODO: Check the namespace ACL for permission to delete
 */
exports.delete_aux_schema = function(request, response) {
    logger.debug('In delete_aux_schema.');

    // The namespace the auxiliary schema belongs to
    var ns = request.params.ns;

    // The name of the auxiliary schema to delete
    var aux_schema_name = request.params.aux;

    if (! global_schemas.hasOwnProperty(ns)) {
        logger.warn('User attempted to delete an auxiliary schema ' +
                    'from unknown namespace ' + ns);
        osdf_error(response, 'Namespace not found.', 404);
        return;
    }

    if (global_schemas[ns].hasOwnProperty('aux') &&
            global_schemas[ns]['aux'].hasOwnProperty(aux_schema_name)) {
        try {
            if (schema_utils.aux_schema_in_use(global_schemas, ns, aux_schema_name)) {
                logger.warn('Aux schema ' + aux_schema_name + ' in use.');
                osdf_error(response, 'Auxiliary schema in use.', 409);
                return;
            }

            delete_aux_schema_helper(ns, aux_schema_name);

            // Can't use 'this', so we have to reach down to the module.exports
            // to get the inherited emit() function.
            module.exports.emit('delete_aux_schema', {
                'ns': ns,
                'name': aux_schema_name
            });

            // Send a message to the master process so that it can notify other
            // sibling workers about this.
            process.send({
                cmd: 'aux_schema_change',
                type: 'deletion',
                ns: ns,
                name: aux_schema_name
            });

            response.status(204).send('');
        } catch (err) {
            logger.error('Unable to delete auxiliary schema.', err);
            osdf_error(response, 'Unable to delete auxiliary schema.', 500);
        }
    } else {
        logger.warn('User attempted to delete a non-existent auxiliary ' +
                    'schema: ' + aux_schema_name);
        osdf_error(response, 'Auxiliary schema not found.', 404);
        return;
    }
};

// This message is used to process auxiliary schema events that are relayed to
// this process from the master process by worker.js.
exports.process_aux_schema_change = function(msg) {
    logger.debug('In process_aux_schema_change. PID: ' + process.pid);

    if (msg.hasOwnProperty('cmd') && msg['cmd'] === 'aux_schema_change') {
        var namespace = msg['ns'];
        var aux_schema_name = msg['name'];

        if (msg.hasOwnProperty('type')) {
            if (msg['type'] === 'deletion') {
                delete_aux_schema_helper(namespace, aux_schema_name);
            } else if ((msg['type'] === 'insertion') || (msg['type'] === 'update')) {
                var aux_schema_json = msg['json'];
                // false is to indicate that we do not need to write to disk.
                // since we are responding to a message from the master, another
                // worker already handled the write
                aux_schema_change_helper(namespace, aux_schema_name,
                    aux_schema_json, false);
            } else {
                logger.error('Invalid message type: ' + msg['type']);
            }
        } else {
            logger.error("Invalid aux schema change message. Missing 'type' key.");
        }
    } else {
        logger.error('Invalid aux schema change message. Missing or ' +
                     "invalid 'cmd' key.");
    }
};

// This method is used to process schema change events that are relayed to
// this process from the master process by worker.js.
exports.process_schema_change = function(msg) {
    logger.debug('In process_schema_change. PID: ' + process.pid);

    if (msg.hasOwnProperty('cmd') && msg['cmd'] === 'schema_change') {
        var namespace = msg['ns'];
        var schema_name = msg['name'];

        if (msg.hasOwnProperty('type')) {
            if (msg['type'] === 'deletion') {
                delete_schema_helper(namespace, schema_name);
            } else if ((msg['type'] === 'insertion') || (msg['type'] === 'update')) {
                var schema_json = msg['json'];
                // false is to indicate that we do not need to write to disk.
                // since we are responding to a message from the master, another
                // worker already handled the write
                schema_change_helper(namespace, schema_name, schema_json, false);
            } else {
                logger.error('Invalid message type: ' + msg['type']);
            }
        } else {
            logger.error("Invalid schema change message. Missing 'type' key.");
        }
    } else {
        logger.error('Invalid schema change message. ' +
                     "Missing or invalid 'cmd' key.");
    }
};

exports.update_schema = function(request, response) {
    logger.debug('In update_schema.');

    // Get the namespace and the schema data (JSON) that has been provided.
    var ns = request.params.ns;
    var schema_name = request.params.schema;

    var content = request.rawBody;

    // Before we do anything, let's see if the namespace is known to us. If it
    // isn't then we send an appropriate HTTP response code.
    if (! global_schemas.hasOwnProperty(ns)) {
        logger.warn('User attempted to update a schema in an unknown ' +
                    'namespace: ' + ns);
        osdf_error(response, 'Namespace not found.', 404);
        return;
    }

    // Parse the data provided. If it's invalid/malformed, we're about to find
    // out.
    var schema_json;
    try {
        schema_json = JSON.parse(content);
    } catch (err) {
        logger.warn('User provided invalid JSON for schema update.');
        osdf_error(response, 'Invalid JSON provided for update.', 422);
        return;
    }

    // Check if the schema name looks okay.
    if (! schema_utils.valid_schema_name(schema_name)) {
        var msg = 'Invalid schema name.';
        logger.warn(msg);
        osdf_error(response, msg, 422);
        return;
    }

    // Check that the JSON-Schema embedded in the user-supplied data is
    // actually valid JSON-Schema and not just a string, or regular JSON that
    // is not JSON-Schema.
    logger.info('Checking if schema document is valid JSON-Schema.');
    if (! schema_utils.valid_json_schema(schema_json)) {
        logger.warn('User provided invalid JSON-schema.');
        osdf_error(response, 'Invalid JSON-Schema.', 422);
        return;
    }

    // Now we check if the auxiliary schema already exists. If it does NOT,
    // then we need to reject the update as the user should first perform an
    // insertion.
    if (! global_schemas[ns]['schemas'].hasOwnProperty(schema_name)) {
        osdf_error(response, 'Schema ' + schema_name +
                   ' does not exist in namespace ' + ns, 404);
        return;
    }

    // Check if the incoming auxiliary schema make use of any references that
    // we don't already know about.
    var refs = schema_utils.extractRefNames(schema_json);

    for (var ref_index in refs) {
        var aux_name = refs[ref_index];
        if (global_schemas[ns].hasOwnProperty('aux') &&
                global_schemas[ns]['aux'].hasOwnProperty(aux_name)) {
            // If here, then we know about this auxiliary schema. Nothing to do.
        } else {
            logger.warn('Schema uses unknown reference/aux schema: ' + aux_name);
            osdf_error(response, 'Schema uses unknown reference/aux schema.', 422);
            return;
        }
    }

    try {
        // The last parameter indicates that this worker is the first to receive
        // this request (we're not responding to a hint from the master process) and
        // therefore we are the worker responsible for writing the data to disk/storage.
        schema_change_helper(ns, schema_name, schema_json, true);

        // Can't use 'this', so we have to reach down to the module.exports
        // to get the inherited emit() function.
        module.exports.emit('update_schema', {
            'ns': ns,
            'name': schema_name,
            'json': schema_json
        });

        // Send a message to the master process so that it can notify other
        // sibling workers about this.
        process.send({
            cmd: 'schema_change',
            type: 'update',
            ns: ns,
            name: schema_name,
            json: schema_json
        });

        response.send(200).send('');
    } catch (e) {
        logger.error(e);
        osdf_error(response, 'Unable to update schema.', 500);
        return;
    }
};

exports.update_aux_schema = function(request, response) {
    logger.debug('In update_aux_schema.');

    // Get the namespace and the auxiliary schema data that has been provided.
    var ns = request.params.ns;
    var aux_schema_name = request.params.aux;

    var content = request.rawBody;

    // Before we do anything, let's see if the namespace is known to us. If it isn't
    // then we send an appropriate HTTP response code.
    if (! global_schemas.hasOwnProperty(ns)) {
        logger.warn('User attempted to update an auxiliary schema in an ' +
                    'unknown namespace: ' + ns);
        osdf_error(response, 'Namespace not found.', 404);
        return;
    }

    // Parse the data provided. If it's invalid/malformed, we're about to find out.
    var aux_schema_json;
    try {
        aux_schema_json = JSON.parse(content);
    } catch (err) {
        logger.warn('User provided invalid JSON for auxiliary schema update.');
        osdf_error(response, 'Invalid JSON provided for update.', 422);
        return;
    }

    // Check that the user-supplied JSON-Schema data is actually valid
    // JSON-Schema and not just a string, or regular JSON that is not
    // JSON-Schema.
    logger.info('Checking if the aux schema document is valid JSON-Schema.');
    if (! schema_utils.valid_json_schema(aux_schema_json)) {
        logger.warn('User provided invalid JSON-schema.');
        osdf_error(response, 'Invalid JSON-Schema.', 422);
        return;
    }

    // Now we check if the auxiliary schema already exists. If it does NOT,
    // then we need to reject the update as the user should do an insertion.
    if (! global_schemas[ns]['aux'].hasOwnProperty(aux_schema_name)) {
        osdf_error(response, 'Auxiliary schema ' + aux_schema_name +
                   ' already exists in namespace ' + ns, 409);
        return;
    }

    // Check if the auxiliary schema name looks okay.
    if (! schema_utils.valid_schema_name(aux_schema_name)) {
        var msg = 'Invalid auxiliary schema name.';
        logger.warn(msg);
        osdf_error(response, msg, 422);
        return;
    }

    // Check if the incoming auxiliary schema makes use of any references that
    // we don't already know about.
    var refs = schema_utils.extractRefNames(aux_schema_json);

    for (var ref_index in refs) {
        var aux_name = refs[ref_index];
        if (global_schemas[ns].hasOwnProperty('aux') &&
                global_schemas[ns]['aux'].hasOwnProperty(aux_name)) {
            // If here, then we know about this auxiliary schema. Nothing to do.
        } else {
            logger.warn('Auxiliary schema uses unknown reference/aux ' +
                        'schema: ' + aux_name);
            osdf_error(response, 'Auxiliary schema uses unknown ' +
                       'reference/aux schema.', 422);
            return;
        }
    }

    try {
        // The last parameter indicates that this worker is the first to
        // receive this request (we're not responding to a hint from the master
        // process) and therefore we are the worker responsible for writing the
        // data to disk/storage.
        aux_schema_change_helper(ns, aux_schema_name, aux_schema_json, true);

        // Can't use 'this', so we have to reach down to the module.exports
        // to get the inherited emit() function.
        module.exports.emit('insert_aux_schema', {
            'ns': ns,
            'name': aux_schema_name,
            'json': aux_schema_json
        });

        // Send a message to the master process so that it can notify other
        // sibling workers about this.
        process.send({
            cmd: 'aux_schema_change',
            type: 'update',
            ns: ns,
            name: aux_schema_name,
            json: aux_schema_json
        });

        response.status(200).send('');
    } catch (e) {
        logger.error(e);
        osdf_error(response, 'Unable to insert auxiliary schema.', 500);
        return;
    }
};

// Handle the details of an auxiliary schema that has been deleted.
// This is used by both the worker that initially received the request,
// and the workers that respond to notifications from the master
// process.
function delete_aux_schema_helper(namespace, aux_schema_name) {
    logger.debug('In schema-handler:delete_aux_schema_helper.');

    if (global_schemas[namespace].hasOwnProperty('aux') &&
        global_schemas[namespace]['aux'].hasOwnProperty(aux_schema_name)) {

        // Delete from the filesystem, and if successful, from memory.
        var aux_schema_path = path.join(working_dir, 'namespaces', namespace, 'aux',
            aux_schema_name + '.json');

        // We have to check if the schema file exists because it might have
        // already been deleted by another worker.
        fs.exists(aux_schema_path, function(exists) {
            if (exists) {
                fs.unlink(aux_schema_path, function(err) {
                    if (err) {
                        throw err;
                    } else {
                        logger.debug('Successful deletion of auxiliary schema file.');
                    }
                });
            }
        });

        logger.debug('Deleting auxiliary schema from memory.');
        if (global_schemas.hasOwnProperty(namespace) &&
                global_schemas[namespace].hasOwnProperty('aux') &&
                global_schemas[namespace]['aux'].hasOwnProperty(aux_schema_name)) {
            delete global_schemas[namespace]['aux'][aux_schema_name];
        }
    } else {
        logger.warn(
            'Namespace "{}" did not have auxiliary schema: "{}". Nothing to do.'
                .format(namespace, aux_schema_name)
        );
    }
}

// Handle the details of a schema that has been deleted. This is
// used by both the worker that initially received the request,
// and the workers that respond to notifications from the master
// process.
function delete_schema_helper(namespace, schema_name) {
    logger.debug('In schema-handler:delete_schema_helper.');

    if (global_schemas[namespace].hasOwnProperty('schemas') &&
        global_schemas[namespace]['schemas'].hasOwnProperty(schema_name)) {

        // Delete from the filesystem, and if successful, from memory.
        var schema_path = path.join(working_dir, 'namespaces', namespace, 'schemas',
            schema_name + '.json');

        // We have to check if the schema file exists because it might have
        // already been deleted by another worker.
        fs.exists(schema_path, function(exists) {
            if (exists) {
                fs.unlink(schema_path, function(err) {
                    if (err) {
                        throw err;
                    } else {
                        logger.debug('Successful deletion of schema file.');
                    }
                });
            }
        });

        logger.debug('Deleting schema from memory.');
        if (global_schemas.hasOwnProperty(namespace) &&
                global_schemas[namespace].hasOwnProperty('schemas') &&
                global_schemas[namespace]['schemas'].hasOwnProperty(schema_name)) {
            delete global_schemas[namespace]['schemas'][schema_name];
        }
    } else {
        logger.warn('Namespace "{}" did not have schema "{}". Nothing to do.'
            .format(namespace, schema_name));
    }
}

function aux_schema_change_helper(namespace, aux_schema_name, aux_schema_json, write) {
    logger.debug('In schema-handler:aux_schema_change_helper.');

    if (! global_schemas[namespace].hasOwnProperty('aux')) {
        // Should never get here.
        logger.error("No 'aux' structure for namespace: " + namespace);
        throw "No 'aux' structure for namespace: " + namespace;
    }

    if (global_schemas[namespace]['aux'].hasOwnProperty(aux_schema_name)) {
        // Overwriting an auxiliary schema, so let's just make a note of that.
        logger.warn(
            'Overwriting existing auxiliary schema (ns:aux_schema): ({}:{})'
                .format(namespace, aux_schema_name)
        );
    }

    if (write) {
        // Save the schema to the filesystem in the working directory,
        // and if successful, save it to our in-memory data structure.
        var schema_path = path.join(working_dir, 'namespaces', namespace,
            'aux', aux_schema_name + '.json');

        var stream = fs.createWriteStream(schema_path);

        stream.once('open', function(fd) {
            // Write out the prettyfied JSON to the filesystem.
            stream.write(JSON.stringify(aux_schema_json, null, 4));
            stream.end();
        });
    }

    // And save it to our data structure.
    global_schemas[namespace]['aux'][aux_schema_name] = aux_schema_json;
}

function get_ns_schemas(ns, callback) {
    logger.debug('In get_ns_schemas.');

    var ns_schema_dir;
    var ns_aux_schema_dir;

    waterfall([
        function(callback) {
            // Determine the directory to the schemas for this namespace.
            ns_schema_dir = path.join(working_dir, 'namespaces', ns, 'schemas');
            logger.debug('Schema dir for namespace {}: {}.'
                .format(ns, ns_schema_dir));

            // Scan the directory for the schema files.
            fs.readdir(ns_schema_dir, function(err, files) {
                if (err) {
                    logger.error(
                        'Unable to scan schema directory for namespace ' + ns,
                        err
                    );

                    callback(err);
                } else {
                    // Reject any hidden files/directories, such as .svn directories
                    files = _.reject(files, function(file) {
                        return file.substr(0, 1) === '.';
                    });

                    callback(null, files);
                }
            });
        },
        function(files, callback) {
            logger.debug('Scanned {} schemas.'.format(files.length));

            var schemas = {};

            each(files, function(file, cb) {
                var file_path = path.join(ns_schema_dir, file);

                fs.readFile(file_path, 'utf8', function(err, file_text) {
                    if (err) {
                        logger.error(err);
                        cb(err);
                        return;
                    }

                    try {
                        var schema_json = JSON.parse(file_text);
                        var name = path.basename(file, '.json');
                        schemas[name] = schema_json;
                        cb();
                    } catch (parse_error) {
                        logger.error('Invalid data in ' + file_path);
                        cb(parse_error);
                    }
                });
            }, function(err) {
                if (err) {
                    callback(err, null);
                } else {
                    callback(null, schemas);
                }
            });
        },
        function(schemas, callback) {
            // Determine the directory to the auxiliary schemas for this namespace.
            ns_aux_schema_dir = path.join(working_dir, 'namespaces', ns, 'aux');
            logger.debug('Aux schema dir for namespace "{}": {}'
                .format(ns, ns_aux_schema_dir)
            );

            // Scan the directory for the schema files.
            fs.readdir(ns_aux_schema_dir, function(err, files) {
                if (err) {
                    logger.error('Unable to scan auxiliary schema directory ' +
                                 'for namespace ' + ns, err);
                    callback(err);
                }

                // Reject any hidden files/directories, such as .svn directories
                files = _.reject(files, function(file) {
                    return file.substr(0, 1) === '.';
                });

                callback(null, files, schemas);
            });
        },
        function(files, schemas, callback) {
            logger.debug('Scanned {} auxiliary schemas.'.format(files.length));

            var aux_schemas = {};

            each(files, function(file, cb) {
                var file_path = path.join(ns_aux_schema_dir, file);

                fs.readFile(ns_aux_schema_dir + '/' + file, 'utf8', function(err, file_text) {
                    if (err) {
                        cb(err);
                    }

                    try {
                        var aux_schema_json = JSON.parse(file_text);
                        var name = path.basename(file, '.json');
                        aux_schemas[name] = aux_schema_json;
                        cb();
                    } catch (parse_error) {
                        logger.error('Invalid data in ' + file_path);
                        cb(err);
                    }
                });
            },
            function(err) {
                if (err) {
                    callback(err);
                } else {
                    // Assemble an object to contain both the schemas and
                    // auxiliary schemas for this namespace.
                    var ns_final_struct = {
                        'schemas': schemas,
                        'aux': aux_schemas
                    };

                    callback(null, ns_final_struct);
                }
            });
        }],
    // This is called when the waterfall is complete, and either
    // ns_final_struct is set, or err will contain the problem
    // if one occurred.
    function(err, ns_final_struct) {
        // This is the callback provided by the invoker of this function.
        callback(err, ns_final_struct);
    });
}

// Handle the details of a schema that is being inserted, updated, or modified.
// This is used by both the worker that initially received the request, and the
// workers that respond to notifications from the master process.
function schema_change_helper(namespace, schema_name, schema_json, write) {
    logger.debug('In schema-handler:schema_change_helper.');

    if (! global_schemas[namespace].hasOwnProperty('schemas')) {
        // Should never get here.
        logger.error("No 'schemas' structure for namespace: " + namespace);
        throw "No 'schemas' structure for namespace: " + namespace;
    }

    if ( global_schemas[namespace]['schemas'].hasOwnProperty(schema_name) ) {
        // Overwriting a schema, so let's just make a note of that.
        logger.warn('Overwriting existing schema (ns:schema): ({}:{}).'
            .format(namespace, schema_name)
        );
    }

    if (write) {
        // Save the schema to the filesystem in the working directory,
        // and if successful, save it to our in-memory data structure.
        var schema_path = path.join(working_dir, 'namespaces', namespace,
            'schemas', schema_name + '.json');

        var stream = fs.createWriteStream(schema_path);

        stream.once('open', function(fd) {
            // Write out the prettyfied JSON to the filesystem.
            stream.write(JSON.stringify(schema_json, null, 4));
            stream.end();
        });
    }

    // And save it to our data structure.
    global_schemas[namespace]['schemas'][schema_name] = schema_json;
}
