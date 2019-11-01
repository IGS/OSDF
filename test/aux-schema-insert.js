var assert = require('chai').assert;
var osdf_utils = require('osdf_utils');
var schema_utils = require('schema_utils');
var tutils = require('./lib/test_utils.js');
var waterfall = require('async/waterfall');

var test_ns = 'test';

// Get a set of valid and invalid credentials for our tests
var auth = tutils.get_test_auth();
var bad_auth = tutils.get_invalid_auth();

var test_aux_schema = {
    description: 'A test aux schema.',
    type: 'object',
    properties: {
        prop: {
            title: 'A bit of text.',
            type: 'string'
        }
    },
    additionalProperties: false,
    required: [ 'prop' ]
};

describe('aux-schema-insert', function() {
    // Test basic insertion of an auxiliary schema. The approach is to attempt
    // the insertion, then retrieve it to check that it's there, then clean up
    // by deleting it.
    it('insert_aux_schema', function(done) {
        var aux_schema_name = osdf_utils.random_string(8);

        waterfall([
            function(callback) {
                // First we insert an auxiliary schema
                var aux_schema_doc = {
                    name: aux_schema_name,
                    schema: test_aux_schema
                };

                tutils.insert_aux_schema(test_ns, aux_schema_doc, auth,
                    function(err, resp) {
                        if (err) {
                            callback(err, null);
                        } else {
                            callback(null, resp);
                        }
                    }
                );
            },
            function(resp, callback) {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 201,
                    'Correct status for auxiliary schema insertion.');

                assert.strictEqual(data, '',
                    'No content returned on a schema insertion.');

                // then try to retrieve it
                tutils.retrieve_aux_schema(test_ns, aux_schema_name, auth,
                    function(err, resp) {
                        if (err) {
                            callback(err, null);
                        } else {
                            callback(null, resp);
                        }
                    }
                );
            },
            function(resp, callback) {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 200,
                    'Auxiliary schema retrieval yielded correct status code.');

                assert.isOk(data.length > 0,
                    'Data returned on aux schema retrieval.');

                // Get all the auxiliary schemas for the namespace and see if the
                // one we just inserted is there
                tutils.retrieve_all_aux_schemas(test_ns, auth, function(err, resp) {
                    if (err) {
                        callback(err, null);
                    } else {
                        callback(null, resp);
                    }
                });
            },
            function(resp, callback) {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 200,
                    'Retrieval of all auxiliary schemas yielded correct ' +
                    'status code.');

                assert.isOk(data.length > 0,
                    'Data returned on aux schema collection retrieval.');

                var aux_schemas = JSON.parse(data);

                assert.isOk(aux_schemas.hasOwnProperty(aux_schema_name),
                    "Namespace's auxiliary schema listing includes test " +
                    'aux schema.');

                // Perform cleanup by deleting the auxiliary schema we attempted to
                // insert. It should not have been inserted, but delete it anyway
                // just in case the implementation failed to reject it.
                tutils.delete_aux_schema(test_ns, aux_schema_name, auth,
                    function(err, resp) {
                        // ignored
                    }
                );

                callback(null);
            }],
        function(err, results) {
            if (err) {
                done(err);
            } else {
                done();
            }
        });
    });

    // Test that the service does not allow invalid data or invalid JSON from
    // being registered as a schema.
    it('insert_aux_schema_with_malformed_json', function(done) {
        var aux_schema_name = osdf_utils.random_string(8);

        waterfall([
            function(callback) {
                /*eslint no-useless-escape: 0*/
                var bad_data = '\\\\\/////';

                // First we insert a schema
                var aux_schema_doc = {
                    name: aux_schema_name,
                    schema: bad_data
                };

                tutils.insert_aux_schema(test_ns, aux_schema_doc, auth,
                    function(err, resp) {
                        if (err) {
                            callback(err, null);
                        } else {
                            callback(null, resp);
                        }
                    }
                );
            },
            function(resp, callback) {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 422,
                    'Correct status for auxiliary schema insertion.');

                assert.equal(data, 0, 'No content returned on an auxiliary ' +
                    'schema insertion.');

                // then try to retrieve it
                tutils.retrieve_aux_schema(test_ns, aux_schema_name, auth,
                    function(err, resp) {
                        if (err) {
                            callback(err, null);
                        } else {
                            callback(null, resp);
                        }
                    }
                );
            },
            function(resp, callback) {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 404,
                    'Auxiliary schema retrieval yielded correct status code.');

                assert.strictEqual(data, '',
                    'No data returned on auxiliary schema retrieval.');

                // If for whatever reason, the auxiliary schema actually made it
                // into the server we try to remove it so that the test doesn't
                // leave a residue behind.
                if (response.statusCode !== 404) {
                    // Cleanup. Remove the auxiliary schema that we inserted.
                    tutils.delete_aux_schema(test_ns, aux_schema_name, auth,
                        function(err, resp) {
                            // ignored
                        }
                    );
                }

                callback(null);
            }],
        function(err, results) {
            if (err) {
                done(err);
            } else {
                done();
            }
        });
    });

    // Test insertion of a schema into the server where one with the same name
    // already exists. The server should not allow an overwrite of this nature.
    // The user must either delete the schema, or update/edit it.
    it('insert_conflicting_aux_schema', function(done) {
        var aux_schema_name = osdf_utils.random_string(8);

        var aux_schema_doc = {
            name: aux_schema_name,
            schema: test_aux_schema
        };

        // Make a duplicate of the aux_schema_doc...
        var aux_schema_doc_dupe = aux_schema_doc;

        // Modify it slightly so that we can detect if the duplicate made it in
        // easier.
        aux_schema_doc_dupe['schema']['description'] = 'duplicate aux schema';

        waterfall([
            function(callback) {
                // First we insert a schema
                tutils.insert_aux_schema(test_ns, aux_schema_doc, auth,
                    function(err, resp) {
                        if (err) {
                            callback(err, null);
                        } else {
                            callback(null, resp);
                        }
                    }
                );
            },
            function(resp, callback) {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 201,
                    'Correct status for insertion.');

                // Now, try inserting another aux schema with the same name
                tutils.insert_aux_schema(test_ns, aux_schema_doc_dupe, auth,
                    function(err, resp) {
                        if (err) {
                            callback(err, null);
                        } else {
                            callback(null, resp);
                        }
                    }
                );
            },
            function(resp, callback) {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 409,
                    'Insertion of an auxiliary schema with an existing ' +
                    'name did not succeed.');

                assert.strictEqual(data, '',
                    'No data returned on subsequent insertion.');

                // Check that schema actually didn't make it into the server despite
                // what the HTTP code says
                tutils.retrieve_aux_schema(test_ns, aux_schema_name, auth,
                    function(err, resp) {
                        if (err) {
                            callback(err, null);
                        } else {
                            callback(null, resp);
                        }
                    }
                );
            },
            function(resp, callback) {
                var data = resp['body'];
                var response = resp['response'];

                assert.isOk(data.length > 0,
                    'Data retrieved for retrieving aux schema.');

                var retrieved;
                try {
                    retrieved = JSON.parse(data);
                } catch (err) {
                    callback(err);
                    return;
                }

                assert.equal(retrieved['description'], test_aux_schema['description'],
                    'Duplicate schema did NOT overwrite the original ' +
                    'aux schema.');

                // Perform cleanup by deleting the auxiliary schema we attempted to
                // insert. It should not have been inserted, but delete it anyway
                // just in case the implementation failed to reject it.
                tutils.delete_aux_schema(test_ns, aux_schema_name, auth,
                    function(err, resp) {
                        // ignored
                    }
                );

                callback(null);
            }],
        function(err, results) {
            if (err) {
                done(err);
            } else {
                done();
            }
        });
    });

    // Test insertion of a schema when no authentication credentials are provided.
    // We should not be able to insert a schema this way.
    it('insert_aux_schema_no_auth', function(done) {
        // Use a helper function since the insert_aux_schema_no_auth()
        // and insert_aux_schema_bad_auth() tests are so similar.
        invalid_credentials_helper(done, null);
    });

    // Test insertion of a schema when invalid authentication credentials are
    // provided. We should not be able to insert a schema this way.
    it('insert_aux_schema_bad_auth', function(done) {
        // Use a helper function since the insert_aux_schema_no_auth()
        // and insert_aux_schema_bad_auth() tests are so similar.
        invalid_credentials_helper(done, bad_auth);
    });

    // Test that the service does not allow a schema to be inserted that makes
    // reference to an auxiliary schema that it does not know about.
    it('insert_aux_schema_with_unknown_auxiliary', function(done) {
        var aux_schema_name = osdf_utils.random_string(8);

        waterfall([
            function(callback) {
                // Let's take the test schema, add a $ref to it using a
                // randomly generated name, and attempt to insert it. This
                // should fail.
                var random_aux_name = osdf_utils.random_string(8);
                var test_aux_schema_modified = test_aux_schema;

                test_aux_schema_modified['properties']['$ref'] = random_aux_name;

                var aux_schema_doc = {
                    name: aux_schema_name,
                    schema: test_aux_schema_modified
                };

                var schema_utils = require('schema_utils.js');
                var refs = schema_utils.extractRefNames(test_aux_schema_modified);

                assert.isArray(refs, 'Got an array of references to test.');

                assert.equal(refs.length, 1,
                    'Got the expected number of reference names.');

                assert.equal(refs[0], random_aux_name,
                    'The extracted ref name matches the random name we generated.');

                tutils.insert_aux_schema(test_ns, aux_schema_doc, auth,
                    function(err, resp) {
                        if (err) {
                            callback(err, null);
                        } else {
                            callback(null, resp);
                        }
                    }
                );
            },
            function(resp, callback) {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 422,
                    'Correct status code for aux schema insertion ' +
                    'with an unknown auxiliary.');

                assert.strictEqual(data, '',
                    'No content returned for aux schema insertion with an ' +
                    'unknown auxiliary.');

                tutils.retrieve_aux_schema(test_ns, aux_schema_name, auth,
                    function(err, resp) {
                        if (err) {
                            callback(err, null);
                        } else {
                            callback(null, resp);
                        }
                    }
                );
            },
            function(resp, callback) {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 404,
                    'Correct status code for failed auxiliary schema insertion.');

                assert.strictEqual(data, '',
                    'No content returned for auxiliary schema retrieval.');

                // Perform cleanup by deleting the auxiliary schema we attempted to
                // insert. It should not have been inserted, but delete it anyway
                // just in case the implementation failed to reject it.
                tutils.delete_aux_schema(test_ns, aux_schema_name, auth,
                    function(err, resp) {
                        // ignored
                    }
                );

                callback(null);
            }],
        function(err, results) {
            if (err) {
                done(err);
            } else {
                done();
            }
        });
    });
});

function invalid_credentials_helper(done, test_auth) {
    var aux_schema_name = osdf_utils.random_string(8);

    waterfall([
        function(callback) {
            // First we insert a schema
            var aux_schema_doc = {
                name: aux_schema_name,
                schema: test_aux_schema
            };

            // Make sure we use the invalid credentials here
            tutils.insert_aux_schema(test_ns, aux_schema_doc, test_auth,
                function(err, resp) {
                    if (err) {
                        callback(err, null);
                    } else {
                        callback(null, resp);
                    }
                }
            );
        },
        function(resp, callback) {
            var data = resp['body'];
            var response = resp['response'];

            assert.equal(response.statusCode, 403,
                'Correct status for auxiliary schema insertion.');

            assert.strictEqual(data, '',
                'No content returned on an auxiliary schema insertion.');

            // then try to retrieve it (with valid credentials)
            tutils.retrieve_aux_schema(test_ns, aux_schema_name, auth,
                function(err, resp) {
                    if (err) {
                        callback(err, null);
                    } else {
                        callback(null, resp);
                    }
                }
            );
        },
        function(resp, callback) {
            var data = resp['body'];
            var response = resp['response'];

            assert.equal(response.statusCode, 404,
                'Auxiliary schema retrieval of failed insertion had ' +
                'correct code.');

            assert.strictEqual(data, '',
                'No data returned on auxiliary schema retrieval.');

            // Finally, also check to see that the auxiliary schema did NOT find its
            // way into the namespace's master list of auxiliary schemas.
            tutils.retrieve_all_aux_schemas(test_ns, auth, function(err, resp) {
                if (err) {
                    callback(err, null);
                } else {
                    callback(null, resp);
                }
            });
        },
        function(resp, callback) {
            var data = resp['body'];
            var response = resp['response'];

            assert.equal(response.statusCode, 200,
                'Correct status for the auxiliary schema listing.');

            assert.isOk(data.length > 0,
                'Got data back for the auxiliary schema listing.');

            var aux_schemas;
            try {
                aux_schemas = JSON.parse(data);
            } catch (err) {
                callback(err);
                return;
            }

            assert.isFalse(aux_schemas.hasOwnProperty(aux_schema_name),
                'Auxiliary schema was not registered into master list.');

            // Perform cleanup by deleting the auxiliary schema we attempted to
            // insert. It should not have been inserted, but delete it anyway
            // just in case the implementation failed to reject it.
            tutils.delete_aux_schema(test_ns, aux_schema_name, auth,
                function(err, resp) {
                    // ignored
                }
            );

            callback(null);
        }],
    function(err, results) {
        if (err) {
            done(err);
        } else {
            done();
        }
    });
}
