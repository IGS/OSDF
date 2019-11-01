var assert = require('chai').assert;
var osdf_utils = require('../lib/osdf_utils');
var tutils = require('./lib/test_utils.js');

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

describe('node-validate', function() {
    it('basic_validation_no_schema_control', function(done) {
        tutils.validate_node(test_node, auth, function(err, resp) {
            if (err) {
                done(err);
            } else {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 200,
                    'Correct status for validation.');

                assert.strictEqual(data, '',
                    'No content returned on a good node validation.');

                done();
            }
        });
    });

    it('basic_validation_with_schema_control', function(done) {
        tutils.validate_node(test_node_with_schema, auth, function(err, resp) {
            if (err) {
                done(err);
            } else {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 200,
                    'Correct status for validation.');

                assert.strictEqual(data, '',
                    'No content returned on a good node validation.');

                done();
            }
        });
    });


    it('basic_validation_with_invalid_node', function(done) {
        var invalid_node = test_node_with_schema;
        delete invalid_node['meta']['color'];

        tutils.validate_node(invalid_node, auth, function(err, resp) {
            if (err) {
                done(err);
            } else {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 422,
                    'Correct status for invalid node.');

                assert.notStrictEqual(data, '',
                    'Content returned on a bad node validation.');

                // Message should say something about 'color' being missing...
                assert.isOk(data.indexOf('color') !== -1,
                    'Error message mentioned missing property.');

                done();
            }
        });
    });

    // Attempt a node validation without providing an authentication token.
    it('basic_validation_no_auth', function(done) {
        tutils.validate_node(test_node, null, function(err, resp) {
            if (err) {
                done(err);
            } else {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 403,
                    'Correct status for unauthorized validation.');

                assert.strictEqual(data, '',
                    'No content returned on a unauthorized node validation.');

                done();
            }
        });
    });

    // Attempt a node validation with an invalid authentication token.
    it('basic_validation_bad_auth', function(done) {
        // First we create a node
        tutils.validate_node(test_node, bad_auth, function(err, resp) {
            if (err) {
                done(err);
            } else {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 403,
                    'Correct status for unauthorized validation.');

                assert.strictEqual(data, '',
                    'No content returned on a unauthorized node validation.');

                done();
            }
        });
    });

    // Test what happens when we attempt to validate a node with
    // an unknown namespace. We should get an error.
    it('validation_with_unknown_namespace', function(done) {
        var bad_node = test_node;

        // Overwrite the namespace with a randomly generated one.
        bad_node.ns = osdf_utils.random_string(8).toLowerCase();

        tutils.validate_node(bad_node, auth, function(err, resp) {
            if (err) {
                done(err);
            } else {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 422,
                    'Correct status for node with bad namespace.');

                assert.isOk(data !== '',
                    'Content is returned on bad node validation.');

                done();
            }
        });
    });

    // Test what happens when we attempt to validate a node with an unknown
    // namespace AND without an authorization token.  We should get an HTTP 403
    // (Forbidden) error.
    it('validation_with_unknown_namespace_no_auth', function(done) {
        var bad_node = test_node;

        // Overwrite the namespace with a randomly generated one.
        bad_node.ns = osdf_utils.random_string(8);

        tutils.validate_node(bad_node, null, function(err, resp) {
            if (err) {
                done(err);
            } else {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 403,
                    'Correct status for node with bad namespace, no auth.');

                assert.strictEqual(data, '',
                    'No content returned on bad node validation with no authentication.');

                done();
            }
        });
    });

    it('validation_with_valid_linkage', function(done) {
        var test_node = {
            ns: 'test2',
            acl: { 'read': ['all'], 'write': ['all'] },
            linkage: {},
            node_type: 'target',
            meta: {
              color: 'red',
              description: 'description'
            }
        };

        tutils.validate_node(test_node, auth, function(err, resp) {
            if (err) {
                done(err);
            } else {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 200,
                    'Correct status for node with valid linkages.');

                assert.strictEqual(data, '', 'No Content returned.');

                done();
            }
        });
    });

    // Test the validation mechanism with a link to a node that does
    // not exist (xxxxx). This should result in a 422 error code.
    it('validation_with_non_existent_link', function(done) {
        var test_node = {
            ns: 'test2',
            acl: { 'read': ['all'], 'write': ['all'] },
            linkage: { related_to: [ 'xxxxx' ]},
            node_type: 'example',
            meta: {}
        };

        tutils.validate_node(test_node, auth, function(err, resp) {
            if (err) {
                done(err);
            } else {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 422,
                    'Correct status for node with non-existent link node.');

                assert.isOk(data !== '', 'Validation results returned.');

                assert.isOk(data.search('linkage') !== -1,
                    'Validation output mentioned linkage.');

                done();
            }
        });
    });

    // Test the validation mechanism with a linkage block
    // that has an incorrect structure. In this case, the linkage
    // name (related_to), is pointing to string, instead of an
    // array of strings.
    it('validation_with_invalid_linkage', function(done) {
        var test_node = {
            ns: 'test2',
            acl: { 'read': ['all'], 'write': ['all'] },
            // Wrong structure
            linkage: { related_to: '1234XXXXX'},
            node_type: 'example',
            meta: {}
        };

        tutils.validate_node(test_node, auth, function(err, resp) {
            if (err) {
                done(err);
            } else {
                var data = resp['body'];
                var response = resp['response'];

                assert.equal(response.statusCode, 422,
                    'Correct status for node with invalid linkage.');

                assert.isOk(data !== '', 'Validation results returned.');

                assert.isOk(data.search('linkage') !== -1,
                    'Validation output mentioned linkage.');

                done();
            }
        });
    });
});

