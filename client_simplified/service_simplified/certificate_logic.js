// Certificate creation and signatures logic, this is a utility file.
// code is made simplest way possible.

// hopefully we can use as little dependencies as resonably possible, hopefully without jsZip and node-forge.
// we may use linux commands

var crypto = require('crypto');
var fs = require('fs');
var child_process = require('child_process');

function generateHash(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

function createCert() {
    // TODO
    // save is done by index.js instead
}

function signWgt() {
    // Signs a .wgt with the stored author + distributor certs. (or whatever is needed)
    // Signs all files if needed, repacks the zip.
    // tizen.Signature, 
    // TODO
}

function getDuid(callback) {
    http.get('http://127.0.0.1:8001/api/v2/', function (res) {
        var data = '';
        res.on('data', function (c) { data += c; });
        res.on('end', function () {
            try {
                var json = JSON.parse(data);
                var duid = json.duid || json.id;
                if (!duid) return callback(new Error('DUID not found in SmartView API response'));
                callback(null, duid);
            } catch (e) { callback(new Error('SmartView API parse error: ' + e.message)); }
        });
    }).on('error', function (e) { callback(new Error('SmartView API unreachable: ' + e.message)); });
}


module.exports = {
    //createCert: createCert,
    //signWgt: signWgt,
    getDuid: getDuid
};
