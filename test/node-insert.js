var assert = require('chai').assert;
var osdf_utils = require('osdf_utils');
var tutils = require('./lib/test_utils.js');
var eachLimit = require('async/eachLimit');
var format = require('string-format');

format.extend(String.prototype);

// Get a set of valid and invalid credentials for our tests
var auth = tutils.get_test_auth();
var bad_auth = tutils.get_invalid_auth();

var test_node = {
    ns: 'test',
    acl: { 'read': [ 'all' ], 'write': [ 'all' ] },
    linkage: {},
    node_type: 'unregistered',
    meta: {}
};

var test_node_with_schema = {
    ns: 'test',
    acl: { 'read': [ 'all' ], 'write': [ 'all' ] },
    linkage: {},
    node_type: 'example',
    meta: {
        description: 'something',
        color: 'blue'
    }
};

describe('node-insert', function() {
    it('basic-insertion', function(done) {
        // First we create a node
        tutils.insert_node(test_node, auth, function(err, resp) {
            if (err) {
                done(err);
            } else {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 201,
                    'Correct status for insertion.');
                assert.isOk('location' in response.headers,
                    'Response header contains location of new node.');

                var node_id = tutils.get_node_id(response);

                assert.strictEqual(data, '',
                    'No content returned on a node insertion.');

                // Clean-up (delete the inserted node)
                tutils.delete_node(node_id, auth, function(err) {
                    // ignored
                });

                done();
            }
        });
    });

    // Attempt a node insertion without providing an authentication token.
    it('basic_insertion_no_auth', function(done) {
        // First we create a node
        tutils.insert_node(test_node, null, function(err, resp) {
            if (err) {
                done(err);
            } else {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 403,
                    'Correct status for unauthorized insertion.');

                assert.strictEqual(data, '',
                    'No content returned on a unauthorized node insertion.');

                done();
            }
        });
    });

    // Attempt a node insertion with an invalid authentication token.
    it('basic_insertion_bad_auth', function(done) {

        // First we create a node
        tutils.insert_node( test_node, bad_auth, function(err, resp) {
            if (err) {
                done(err);
            } else {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 403,
                    'Correct status for unauthorized insertion.');

                assert.strictEqual(data, '',
                    'No content returned on a unauthorized node insertion.');

                done();
            }
        });
    });

    // Check the behavior of the system when inserting a valid node that is
    // mapped to a node type that has a schema associated with it.
    it('valid_insertion_with_schema_validation', function(done) {
        // Attempt to insert a node
        tutils.insert_node(test_node_with_schema, auth, function(err, resp) {
            if (err) {
                done(err);
            } else {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 201,
                    'Correct status for insertion.');
                assert.isOk('location' in response.headers,
                    'Response header contains location of new node.');

                var node_id = tutils.get_node_id(response);

                assert.isOk(node_id.length > 0,
                    'Got a node id from the insertion.');
                var inserted = true;

                assert.strictEqual(data, '',
                    'No content returned on a node insertion.');

                if (inserted) {
                    tutils.delete_node(node_id, auth, function(err) {
                        if (err) {
                            console.error('Problem deleting inserted node: ', err);
                        }
                    });
                }

                done();
            }
        });
    });

    // Check the behavior of the system when inserting a node that does
    // NOT validate against the schema associated with the node's 'node_type'.
    it('invalid_insertion_with_schema_validation', function(done) {
        // We make a 'bad' node by copying our good node, and then deleting a
        // required property in that the validator mandates should be present.
        var bad_node = test_node_with_schema;
        delete bad_node.meta['color'];

        // First we create a node
        tutils.insert_node(bad_node, auth, function(err, resp) {
            if (err) {
                done(err);
            } else {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 422,
                    'Correct status for insertion of bad node.');
                assert.isFalse('location' in response.headers,
                    "Response header does not contain 'location'.");

                assert.strictEqual(data, '',
                    'No content returned on a bad node insertion.');

                // We shouldn't get in here, but you never know.
                if ('location' in response.headers) {
                    var node_id = tutils.get_node_id(response);

                    // We should NOT have inserted, because the node inserted is
                    // invalid, but if we DID insert anyway (perhaps due to a bug),
                    // then we clean up after ourselves by deleting.
                    tutils.delete_node(node_id, auth, function(err) {
                        console.error('Problem deleting inserted node: ', err);
                    });
                }

                done();
            }
        });
    });

    it('invalid_insertion_bad_acls', function(done) {
        // Should be a dictionary of array of strings, like { "read": ['all'] },
        // so this insertion should be rejected
        var bad_acls1 = {
            'read': 'all',
            'write': 'all'
        };

        // Correct structure but with acl names in capitals
        var bad_acls2 = {
            'READ': ['all'],
            'WRITE': ['all']
        };

        // Correct structure but with extra/spurious field
        var bad_acls3 = {
            'read': ['all'],
            'write': ['all'],
            'extra': osdf_utils.random_string(6)
        };

        // Bad because of empty string
        var bad_acls4 = '';
        // Bad because of empty dictionary
        var bad_acls5 = {};
        // Bad because of empty array
        var bad_acls6 = [];

        var bad_acls = {
            'case1': bad_acls1,
            'case2': bad_acls2,
            'case3': bad_acls3,
            'case4': bad_acls4,
            'case5': bad_acls5,
            'case6': bad_acls6
        };

        // Go through each of the various cases, and test each one in turn.
        eachLimit(Object.keys(bad_acls), 1, function(scenario, cb) {
            var bad_node = test_node_with_schema;

            bad_node['acl'] = bad_acls[scenario];

            tutils.insert_node(bad_node, auth, function(err, resp) {
                if (err) {
                    cb(err);
                } else {
                    var data = resp['body'];
                    var response = resp['response'];

                    assert.equal(response.statusCode, 422,
                        'Correct status for node with bad acl entries ({}).'.format(scenario));

                    assert.strictEqual(data, '',
                        'No content returned on bad node insertion.');

                    // We shouldn't get in here, but you never know.
                    if ('location' in response.headers) {
                        var node_id = tutils.get_node_id(response);

                        // We should NOT have inserted, because the node inserted is
                        // invalid, but if we DID insert anyway (perhaps due to a bug),
                        // then we clean up after ourselves by deleting.
                        tutils.delete_node(node_id, auth, function(err) {
                            console.error('Problem deleting inserted node: ', err);
                        });
                    }

                    cb();
                }
            });
        }, function(err) {
            if (err) {
                done(err);
            } else {
                done();
            }
        });
    });

    // Check the behavior of the system when inserting a node that is completely
    // valid, except for providing extra, or additional/spurious, properties.
    // The system should reject the insertion.
    it('invalid_insertion_extra_properties', function(done) {
        var bad_node =  test_node_with_schema;
        bad_node['additional'] = osdf_utils.random_string(8);

        tutils.insert_node(bad_node, auth, function(err, resp) {
            if (err) {
                done(err);
            } else {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 422,
                    'Correct status for node extaneous top level field.');

                assert.strictEqual(data, '',
                    'No content returned on bad node insertion.');

                // We shouldn't get in here, but you never know.
                if ('location' in response.headers) {
                    var node_id = tutils.get_node_id(response);

                    // We should NOT have inserted, because the node inserted is
                    // invalid, but if we DID insert anyway (perhaps due to a bug),
                    // then we clean up after ourselves by deleting.
                    tutils.delete_node(node_id, auth, function(err) {
                        console.log('Problem deleting inserted node: ', err);
                    });
                }

                done();
            }
        });
    });

    // Test what happens when we attempt to insert a node into
    // an unknown namespace. We should get an error.
    it('insertion_into_unknown_namespace', function(done) {
        var bad_node = test_node;

        // Overwrite the namespace with a randomly generated one.
        bad_node.ns = osdf_utils.random_string(8);

        tutils.insert_node(bad_node, auth, function(err, resp) {
            if (err) {
                done(err);
            } else {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 422,
                    'Correct status for node with bad namespace.');

                assert.strictEqual(data, '',
                    'No content returned on bad node insertion.');

                // We shouldn't get in here, but you never know.
                if ('location' in response.headers) {
                    var node_id = tutils.get_node_id(response);

                    // We should NOT have inserted, because the node inserted is
                    // invalid, but if we DID insert anyway (perhaps due to a bug),
                    // then we clean up after ourselves by deleting.
                    tutils.delete_node(node_id, auth, function(err) {
                        console.error('Problem deleting inserted node: ', err);
                    });
                }

                done();
            }
        });
    });

    // Test what happens when we attempt to insert a node into
    // an unknown namespace AND without an authorization token.
    // We should get an HTTP 403 (Forbidden) error.
    it('insertion_into_unknown_namespace_no_auth', function(done) {
        var bad_node = test_node;

        // Overwrite the namespace with a randomly generated one.
        bad_node.ns = osdf_utils.random_string(8);

        tutils.insert_node(bad_node, null, function(err, resp) {
            if (err) {
                done(err);
            } else {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 403,
                    'Correct status for node with bad ns, no auth.');

                assert.strictEqual(data, '',
                    'No content returned on bad node insertion.');

                // We shouldn't get in here, but you never know.
                if ('location' in response.headers) {
                    var node_id = tutils.get_node_id(response);

                    // We should NOT have inserted, because the node inserted is
                    // invalid, but if we DID insert anyway (perhaps due to a bug),
                    // then we clean up after ourselves by deleting.
                    tutils.delete_node(node_id, auth, function(err) {
                        console.error('Problem deleting inserted node: ', err);
                    });
                }

                done();
            }
        });
    });

    it('insertion_of_empty_string', function(done) {
        tutils.insert_node('', auth, function(err, resp) {
            if (err) {
                done(err);
            } else {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 422,
                    'Correct status for attempt of insertion with empty string.');

                assert.strictEqual(data, '',
                    'No content returned on bad node insertion.');

                // We shouldn't get in here, but you never know.
                if ('location' in response.headers) {
                    var node_id = tutils.get_node_id(response);

                    // We should NOT have inserted, because the node inserted is
                    // invalid, but if we DID insert anyway (perhaps due to a bug),
                    // then we clean up after ourselves by deleting.
                    tutils.delete_node(node_id, auth, function(err) {
                        console.error('Problem deleting inserted node: ', err);
                    });
                }

                done();
            }
        });
    });

    it('insertion_of_invalid_json', function(done) {
        tutils.insert_node('{', auth, function(err, resp) {
            if (err) {
                done(err);
            } else {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 422,
                    'Correct status for attempt of insertion with empty string.');

                assert.strictEqual(data, '',
                    'No content returned on invalid JSON insertion.');

                // We shouldn't get in here, but you never know.
                if ('location' in response.headers) {
                    var node_id = tutils.get_node_id(response);

                    // We should NOT have inserted, because the node inserted is
                    // invalid, but if we DID insert anyway (perhaps due to a bug),
                    // then we clean up after ourselves by deleting.
                    tutils.delete_node(node_id, auth, function(err) {
                        console.error('Problem deleting inserted node: ', err);
                    });
                }

                done();
            }
        });
    });
});
