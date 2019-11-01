var _ = require('lodash');
var osdf_utils = require('osdf_utils');
var shajs = require('sha.js');
var stringify = require('json-stable-stringify');

var logger = osdf_utils.get_logger();

exports.set_checksums = function(prior, latest) {
    logger.debug('In set_checksums().');

    if (! prior.hasOwnProperty('hash')) {
        throw 'No hash in first argument.';
    }

    // Shouldn't be there, but if it is, we delete it
    if (latest.hasOwnProperty('hash')) {
        delete latest['hash'];
    }

    if (latest.hasOwnProperty('_id')) {
        latest['id'] = latest['_id'];
        delete latest['_id'];
    }

    var rev = null;

    if (latest.hasOwnProperty('_rev')) {
        rev = latest['_rev'];
        delete latest['_rev'];
    }

    var cumulative = prior['hash'];
    var new_transaction_hash = double_sha256(stringify(latest));

    var concatenated = cumulative + new_transaction_hash;
    var final_hash = double_sha256(concatenated);

    latest['hash'] = final_hash;
    latest['_id'] = latest['id'];

    if (! _.isNull(rev)) {
        latest['_rev'] = rev;
    }

    return latest;
};

exports.hash_first_version = function(json) {
    logger.debug('In hash_first_version().');

    if (json.hasOwnProperty('hash')) {
        delete json['hash'];
    }

    var hash = double_sha256(stringify(json));
    json['hash'] = hash;

    return json;
};

function double_sha256(input) {
    if (! _.isString(input)) {
        throw 'Invalid non-string provided.';
    }

    var cs = new shajs.sha256();

    var first_hashed = cs.update(input).digest('hex');
    var second_hashed = cs.update(first_hashed).digest('hex');

    return second_hashed;
}
