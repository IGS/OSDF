var assert = require('chai').assert;
var osdf_utils = require('osdf_utils');
var tutils = require('./lib/test_utils.js');
var waterfall = require('async/waterfall');

// Get a set of valid and invalid credentials for our tests
var auth = tutils.get_test_auth();
var bad_auth = tutils.get_invalid_auth();

var test_node = {
    ns: 'test',
    acl: { 'read': [ 'all' ], 'write': [ 'all' ] },
    linkage: {},
    node_type: 'test',
    meta: {}
};

var restricted_node = {
    ns: 'test',
    acl: { 'read': [ 'all' ], 'write': [ 'all' ] },
    linkage: {},
    node_type: 'test',
    meta: {}
};

describe('node-retrieve', function() {
    // Test basic retrieval of a node. The approach is to first insert a node,
    // then retrieve it. We also make an attempt To cleanup by deleting the
    // node at the conclusion of the test.
    it('basic_retrieve', function(done) {
        waterfall([
            function(callback) {
                // First we create a node
                tutils.insert_node(test_node, auth, function(err, resp) {
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

                assert.equal(response.statusCode, 201,
                    'Correct status for insertion.');

                assert.isOk('location' in response.headers,
                    'Response header contains location of new node.');

                assert.strictEqual(data, '',
                    'No content returned on a node insertion.');

                var node_id = tutils.get_node_id(response);

                // then try to retrieve it
                tutils.retrieve_node(node_id, auth, function(err, resp) {
                    if (err) {
                        callback(err, null);
                    } else {
                        callback(null, node_id, resp);
                    }
                });
            },
            function(node_id, resp, callback) {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 200,
                    'Correct status for node retrieval.');

                assert.isAbove(data.length, 0, 'Data returned.');

                var node_data = null;
                try {
                    node_data = JSON.parse(data);
                } catch (err) {
                    // ignored
                }

                assert.isNotNull(node_data, 'Data returned was valid JSON.');
                assert.hasAllKeys(node_data,
                    [
                        'acl', 'hash', 'id', 'linkage', 'meta', 'node_type',
                        'ns', 'ver'
                    ],
                    'Node data has the required keys.');

                // Perform cleanup by removing what we just inserted and
                // retrieved.
                tutils.delete_node(node_id, auth, function(err) {
                    if (err) {
                        console.log(
                            'Problem deleting test node during cleanup.',
                            err);
                    }
                });

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

    // Attempt a retrieval with no authentication header provided.
    // Insert a node, then retrieve it with no authentication, then cleanup.
    it('basic_retrieve_no_auth', function(done) {
        waterfall([
            function(callback) {
                // First we create a node...
                tutils.insert_node(test_node, auth, function(err, resp) {
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

                assert.equal(response.statusCode, 201,
                    'Correct status for insertion.');

                assert.isOk('location' in response.headers,
                    'Response header contains location of new node.' );

                assert.strictEqual(data, '',
                    'No content returned on a node insertion.');

                var node_id = tutils.get_node_id(response);

                // ...then try to retrieve it, this should fail.
                // Note the null where the auth credentials would normally go.
                tutils.retrieve_node(node_id, null, function(err, resp) {
                    if (err) {
                        callback(err, null);
                    } else {
                        callback(null, node_id, resp);
                    }
                });
            },
            function(node_id, resp, callback) {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 403,
                    'Correct status for retrieval without auth token.');

                assert.strictEqual(data.length, 0,
                    'No data returned.');

                tutils.delete_node(node_id, auth, function(err) {
                    if (err) {
                        console.log('Problem deleting test node during cleanup.');
                    }
                });

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

    // Attempt a retreival with no authentication header provided.
    // Insert a node, then retrieve it with no authentication, then cleanup.
    it('basic_retrieve_bad_auth', function(done) {
        waterfall([
            function(callback) {
                // First we create a node
                tutils.insert_node(test_node, auth, function(err, resp) {
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

                assert.equal(response.statusCode, 201,
                    'Correct status for insertion.');

                assert.isOk('location' in response.headers,
                    'Response header contains location of new node.' );

                assert.strictEqual(data, '',
                    'No content returned on a node insertion.');

                var node_id = tutils.get_node_id(response);

                // then try to retrieve it, this should fail.
                tutils.retrieve_node(node_id, bad_auth, function(err, resp) {
                    if (err) {
                        callback(err, null);
                    } else {
                        callback(null, node_id, resp);
                    }
                });
            },
            function(node_id, resp, callback) {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 403,
                    'Correct status for retrieval without auth token.');

                assert.strictEqual(data.length, 0, 'No data returned.');

                tutils.delete_node(node_id, auth, function(err) {
                    if (err) {
                        console.log('Problem deleting test node during cleanup.');
                    }
                });

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

    // Retrieve a node by version.
    it('retrieve_by_version', function(done) {
        waterfall([
            function(callback) {
                // First we create a node
                tutils.insert_node(test_node, auth, function(err, resp) {
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

                // Check that the insertion happened properly
                assert.equal(response.statusCode, 201,
                    'Correct status for insertion.');

                assert.isOk('location' in response.headers,
                    'Response header contains location of new node.');

                assert.strictEqual(data, '',
                    'No content returned on a node insertion.');

                var node_id = tutils.get_node_id(response);

                // Then retrieve it and modify it.
                tutils.retrieve_node(node_id, auth, function(err, resp) {
                    if (err) {
                        callback(err, null);
                    } else {
                        callback(null, node_id, resp);
                    }
                });
            },
            function(node_id, resp, callback) {
                var data = resp['body'];
                var response = resp['response'];

                // Perform a modification
                var inserted_node = JSON.parse(data);
                assert.isOk('ver' in inserted_node,
                    'Inserted node has version.');
                var version = inserted_node['ver'];

                var modified_data = test_node;
                modified_data['meta']['modified'] = true;
                modified_data['ver'] = version;

                // and save the modification
                tutils.update_node(node_id, modified_data, auth, function(err, resp) {
                    if (err) {
                        callback(err, null);
                    } else {
                        callback(null, version, node_id, resp);
                    }
                });
            },
            function(version, node_id, resp, callback) {
                // Retrieve the modified node
                tutils.retrieve_node(node_id, auth, function(err, resp) {
                    if (err) {
                        callback(err, null);
                    } else {
                        callback(null, version, node_id, resp);
                    }
                });
            },
            function(version, node_id, resp, callback) {
                var data = resp['body'];

                // and double check that it was modified
                var updated = JSON.parse(data);

                assert.isOk('id' in updated,
                    'Updated node has an id.');
                assert.equal(updated.id, node_id,
                    'Updated node has the same id as original.');
                assert.isOk('ver' in updated,
                    'Updated node has a version.');

                var updated_version = updated['ver'];

                assert.notEqual(updated_version, version,
                    'Updated node and original have different versions.');

                assert.isOk(
                    'modified' in updated['meta'] &&
                    updated['meta']['modified'] === true,
                    'Updated node is modified as expected.'
                );

                // Now, retrieve the older node by version
                tutils.retrieve_node_by_version(node_id, version, auth,
                    function(err, resp) {
                        if (err) {
                            callback(err, null);
                        } else {
                            callback(null, version, node_id, resp);
                        }
                    }
                );
            },
            function(version, node_id, resp, callback) {
                var data = resp['body'];
                var response = resp['response'];

                // And examine it in detail
                assert.equal(response.statusCode, 200,
                    'Correct status for node retrieval by version.');

                assert.isAbove(data.length, 0, 'Data returned.');

                var node_data = null;
                try {
                    node_data = JSON.parse(data);
                } catch (e) {
                    // ignored
                }

                assert.isNotNull(node_data, 'Data returned was valid JSON.');
                assert.hasAllKeys(node_data,
                    [
                        'acl', 'hash', 'id', 'linkage', 'meta', 'node_type',
                        'ns', 'ver'
                    ],
                    'Node data has the required keys.');

                // Also test that the version we requested is the version we got
                assert.equal(version, node_data['ver'],
                    'Version requested and retrieved match.');

                assert.isOk(node_data !== null && (! ('modified' in node_data['meta'])),
                    'Older version of node does not have modification.');

                // Perform cleanup by removing what we just inserted and retrieved.
                tutils.delete_node(node_id, auth, function(err) {
                    // ignored
                });

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

    // Retreive a node by version.
    it('retrieve_by_version_with_invalid_version', function(done) {
        waterfall([
            function(callback) {
                // First we create a node
                tutils.insert_node(test_node, auth, function(err, resp) {
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

                // Check that the insertion happened properly
                assert.equal(response.statusCode, 201,
                    'Correct status for insertion.');

                assert.isOk('location' in response.headers,
                    'Response header contains location of new node.');

                assert.strictEqual(data, '',
                    'No content returned on a node insertion.');

                var node_id = tutils.get_node_id(response);

                // Now, retrieve the node (by version) using an invalid (zero)
                // version number.
                tutils.retrieve_node_by_version(node_id, 0, auth,
                    function(err, resp) {
                        if (err) {
                            callback(err, null);
                        } else {
                            callback(null, node_id, resp);
                        }
                    }
                );
            },
            function(node_id, resp, callback) {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 422,
                    'Correct status for version number of zero.');

                assert.equal(data.length, 0, 'No data returned.');

                // Now, retrieve the node (by version) using an invalid
                // (negative) version number.
                tutils.retrieve_node_by_version(node_id, -1, auth, function(err, resp) {
                    if (err) {
                        callback(err, null);
                    } else {
                        callback(null, node_id, resp);
                    }
                });
            },
            function(node_id, resp, callback) {
                var data = resp['body'];
                var response = resp['response'];
                assert.equal(response.statusCode, 422,
                    'Correct status for negative version number.');

                // Now, retrieve the node (by version) using an invalid (string)
                // version number. We generate it randomly.
                var random_string = osdf_utils.random_string(8);
                random_string = random_string.replace(/[0-9]/g, '');
                if (random_string.length === 0) {
                    random_string = 'ABCDEFG';
                }

                tutils.retrieve_node_by_version(node_id, random_string, auth,
                    function(err, resp) {
                        if (err) {
                            callback(err, null);
                        } else {
                            callback(null, node_id, resp);
                        }
                    }
                );
            },
            function(node_id, resp, callback) {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 422,
                    'Correct status for invalid (alphanumeric string) version.');

                // Perform cleanup by removing what we just inserted and retrieved.
                tutils.delete_node(node_id, auth, function(err) {
                    // ignored
                });

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

    // Retreive a node by version, but ask for the CURRENT version of the node.
    // Normally one would retrieve the current version of the node by simply
    // using the simple retrieve method using the node's id. However, one should
    // ALSO be able to get it out using the history/versioning feature. This is
    // unorthodox, but should be supported.
    it('retrieve_by_version_using_latest_version', function(done) {
        waterfall([
            function(callback) {
                // First we create a node
                tutils.insert_node(test_node, auth, function(err, resp) {
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

                // Check that the insertion happened properly
                assert.equal(response.statusCode, 201,
                    'Correct status for insertion.');

                assert.isOk('location' in response.headers,
                    'Response header contains location of new node.');

                assert.strictEqual(data, '',
                    'No content returned on a node insertion.');

                var node_id = tutils.get_node_id(response);

                // Then retrieve it and modify it.
                tutils.retrieve_node(node_id, auth, function(err, resp) {
                    if (err) {
                        callback(err, null);
                    } else {
                        callback(null, node_id, resp);
                    }
                });
            },
            function(node_id, resp, callback) {
                var data = resp['body'];
                var response = resp['response'];

                // Perform a modification
                var inserted_node = JSON.parse(data);
                assert.isOk('ver' in inserted_node,
                    'Inserted node has version.');
                var version = inserted_node['ver'];

                var modified_data = test_node;
                modified_data['meta']['modified'] = true;
                modified_data['ver'] = version;

                // and save the modification
                tutils.update_node(node_id, modified_data, auth,
                    function(err, resp) {
                        if (err) {
                            callback(err, null);
                        } else {
                            callback(null, node_id, version, resp);
                        }
                    }
                );
            },
            function(node_id, version, resp, callback) {
                // Retrieve the modified node
                tutils.retrieve_node(node_id, auth, function(err, resp) {
                    if (err) {
                        callback(err, null);
                    } else {
                        callback(null, node_id, version, resp);
                    }
                });
            },
            function(node_id, version, resp, callback) {
                var data = resp['body'];
                var response = resp['response'];

                // and double check that it was modified
                var updated = JSON.parse(data);

                assert.isOk('id' in updated, 'Updated node has an id.');
                assert.equal(updated.id, node_id,
                    'Updated node has the same id as original.');
                assert.isOk('ver' in updated, 'Updated node has a version.');
                var updated_version = updated['ver'];

                assert.notEqual(updated_version, version,
                    'Updated node and original have different versions.');

                assert.isOk(
                    'modified' in updated['meta'] &&
                    updated['meta']['modified'] === true,
                    'Updated node is modified as expected.'
                );

                // Now, retrieve the LATEST version of the node by version
                tutils.retrieve_node_by_version(node_id, updated_version, auth,
                    function(err, resp) {
                        if (err) {
                            callback(err, null);
                        } else {
                            callback(null, node_id, updated_version, resp);
                        }
                    }
                );
            },
            function(node_id, updated_version, resp, callback) {
                var data = resp['body'];
                var response = resp['response'];

                // And examine it in detail
                assert.equal(response.statusCode, 200,
                    'Correct status for node retrieval by version.');

                assert.isAbove(data.length, 0, 'Data returned.');

                var node_data = null;
                try {
                    node_data = JSON.parse(data);
                } catch (e) {
                    // ignored
                }

                assert.isNotNull(node_data, 'Data returned was valid JSON.');
                assert.hasAllKeys(node_data,
                    [
                        'acl', 'hash', 'id', 'linkage', 'meta', 'node_type',
                        'ns', 'ver'
                    ],
                    'Node data has required keys.'
                );

                // Also test that the version we requested is the version we got
                assert.equal(updated_version, node_data['ver'],
                    'Version requested and retrieved match.');

                assert.isOk(
                    node_data !== null &&
                    'modified' in node_data['meta'],
                    'Current version of node has our modification.'
                );

                // Perform cleanup by removing what we just inserted and retrieved.
                tutils.delete_node(node_id, auth, function(err) {
                    // ignored
                });

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

    // Retrieve a node by requesting a specific version, but attempt to do so
    // without providing an authentication token.
    it('retrieve_by_version_no_auth', function(done) {
        waterfall([
            function(callback) {
                // First we create a node
                tutils.insert_node(test_node, auth, function(err, resp) {
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

                assert.equal(response.statusCode, 201,
                    'Correct status for insertion.');

                assert.isOk('location' in response.headers,
                    'Response header contains location of new node.');

                assert.strictEqual(data, '',
                    'No content returned on a node insertion.');

                var node_id = tutils.get_node_id(response);

                // Then retrieve it and modify it.
                tutils.retrieve_node(node_id, auth, function(err, resp) {
                    if (err) {
                        callback(err, null);
                    } else {
                        callback(null, node_id, resp);
                    }
                });
            },
            function(node_id, resp, callback) {
                var data = resp['body'];
                var response = resp['response'];

                var inserted_node = JSON.parse(data);
                assert.isOk('ver' in inserted_node,
                    'Inserted node has version.');
                var version = inserted_node['ver'];

                var modified_data = test_node;
                modified_data.meta['modified'] = true;
                modified_data['ver'] = version;

                // Perform the modification and double check it.
                tutils.update_node(node_id, modified_data, auth,
                    function(err, resp) {
                        if (err) {
                            callback(err, null);
                        } else {
                            callback(null, node_id, version, resp);
                        }
                    }
                );
            },
            function(node_id, version, resp, callback) {
                // Check it by retrieving the updated node
                tutils.retrieve_node(node_id, auth, function(err, resp) {
                    if (err) {
                        callback(err, null);
                    } else {
                        callback(null, node_id, version, resp);
                    }
                });
            },
            function(node_id, version, resp, callback) {
                var data = resp['body'];
                var response = resp['response'];

                // and seeing if the 'modified' flag is set
                var updated = JSON.parse(data);

                assert.isOk('id' in updated, 'Updated node has an id.');
                assert.equal(updated.id, node_id,
                    'Updated node has the same id as original.');
                assert.isOk('ver' in updated, 'Updated node has a version.');
                assert.notEqual(updated.ver, version,
                    'Updated node and original have different versions.');

                assert.isOk(
                    'modified' in updated.meta &&
                    updated.meta.modified === true,
                    'Updated node is modified as expected.'
                );

                // Now, retrieve the older node by version, but WITHOUT
                // supplying credentials.
                tutils.retrieve_node_by_version(node_id, version, null,
                    function(err, resp) {
                        if (err) {
                            callback(err, null);
                        } else {
                            callback(null, node_id, resp);
                        }
                    }
                );
            },
            function(node_id, resp, callback) {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 403,
                    'Correct status for node retrieval by id.');

                assert.strictEqual(data.length, 0, 'No data returned.');

                // Perform cleanup by removing what we just inserted and retrieved.
                tutils.delete_node(node_id, auth, function(err) {
                    // ignored
                });

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

    // Retrieve a node by requesting a specific version, but attempt to do so
    // with an invalid authentication token.
    it('retrieve_by_version_bad_auth', function(done) {
        waterfall([
            function(callback) {
                // First we create a node
                tutils.insert_node(test_node, auth, function(err, resp) {
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

                assert.equal(response.statusCode, 201,
                    'Correct status for insertion.');

                assert.isOk('location' in response.headers,
                    'Response header contains location of new node.');

                assert.strictEqual(data, '',
                    'No content returned on a node insertion.');

                var node_id = tutils.get_node_id(response);

                // Then retrieve it and modify it.
                tutils.retrieve_node(node_id, auth, function(err, resp) {
                    if (err) {
                        callback(err, null);
                    } else {
                        callback(null, node_id, resp);
                    }
                });
            },
            function(node_id, resp, callback) {
                var data = resp['body'];
                var response = resp['response'];

                var inserted_node = JSON.parse(data);
                assert.isOk('ver' in inserted_node,
                    'Inserted node has version.');
                var version = inserted_node['ver'];

                var modified_data = test_node;
                modified_data.meta['modified'] = true;
                modified_data['ver'] = version;

                // Perform the modification and double check it.
                tutils.update_node(node_id, modified_data, auth,
                    function(err, resp) {
                        if (err) {
                            callback(err, null);
                        } else {
                            callback(null, node_id, version, resp);
                        }
                    }
                );
            },
            function(node_id, version, resp, callback) {
                // Check it by retrieving the updated node
                tutils.retrieve_node(node_id, auth, function(err, resp) {
                    if (err) {
                        callback(err, null);
                    } else {
                        callback(null, node_id, version, resp);
                    }
                });
            },
            function(node_id, version, resp, callback) {
                var data = resp['body'];
                var response = resp['response'];

                // and seeing if the 'modified' flag is set
                var updated = JSON.parse(data);

                assert.isOk('id' in updated, 'Updated node has an id.');
                assert.equal(updated.id, node_id,
                    'Updated node has the same id as original.');
                assert.isOk('ver' in updated, 'Updated node has a version.');
                assert.notEqual(updated.ver, version,
                    'Updated node and original have different versions.');

                assert.isOk(
                    'modified' in updated.meta &&
                    updated.meta.modified === true,
                    'Updated node is modified as expected.'
                );

                // Now, retrieve the older node by version, but with INVALID
                // credentials.
                tutils.retrieve_node_by_version(node_id, version, bad_auth,
                    function(err, resp) {
                        if (err) {
                            callback(err, null);
                        } else {
                            callback(null, node_id, resp);
                        }
                    }
                );
            },
            function(node_id, resp, callback) {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 403,
                    'Correct status for node retrieval by id.');

                assert.equal(data.length, 0, 'No data returned.');

                // Perform cleanup by removing what we just inserted and retrieved.
                tutils.delete_node(node_id, auth, function(data, response) {
                    // ignored
                });

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

    // Test the behavior of retrieving a non-existent node.
    it('retrieve_nonexistent', function(done) {
        var node_id = osdf_utils.random_string(8);

        tutils.retrieve_node(node_id, auth, function(err, resp) {
            if (err) {
                done(err);
            } else {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 404,
                    'Correct status for retrieval of non-existent node.');

                assert.strictEqual(data, '',
                    'No data returned for retrieval of non-existent node.');

                done();
            }
        });
    });

    // Try to retrieve a node that doesn't exist and try to do it without
    // authenticating with an authorization token. This test is a bit silly, but
    // it's here just in case and for completeness.
    it('retrieve_nonexistent_no_auth', function(done) {
        var node_id = osdf_utils.random_string(8);

        // Use null for the credential, which won't send anything.
        tutils.retrieve_node(node_id, null, function(err, resp) {
            if (err) {
                done(err);
            } else {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 403,
                    'Correct status for retrieval ' +
                    'of non-existent node with no auth.');

                assert.strictEqual(data, '', 'No data returned for ' +
                    'retrieval of non-existent node with no auth.');

                done();
            }
        });
    });

    // Try to retrieve a node that doesn't exist and try to do it with an invalid
    // set of credentials. This test is a bit silly, but it's here just in case and
    // for completeness.
    it('retrieve_nonexistent_bad_auth', function(done) {
        var node_id = osdf_utils.random_string(8);

        tutils.retrieve_node(node_id, bad_auth, function(err, resp) {
            if (err) {
                done(err);
            } else {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 403,
                    'Correct status for retrieval ' +
                    'of non-existent node with no auth.');

                assert.strictEqual(data, '',
                    'No data returned for retrieval of ' +
                    'non-existent node with no auth.');

                done();
            }
        });
    });

});
