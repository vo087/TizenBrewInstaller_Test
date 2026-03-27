// Continuation of the index.js Tizen Node web service
// Tizen certificate sign docs: https://docs.tizen.org/application/web/tutorials/sign-certificate/
// target: Tizen 5.5+ (and later) / Chromium 69 / Node.js v10.9.0
// Node 10 / ES5 safe: no const/let, no arrow functions, no async/await, no backticks, etc

// Certificate creation and signing logic - utility module.

// next up remove dependencies

'use strict';

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var child_process = require('child_process');
var http = require('http');

var tizen_studio = require('../tizen_studio/tizenStudio.js');
var forge = require('node-forge'); // TODO hopefully we can remove this dependency.  

// Temp directory for wgt unpacking during signing.
var WORKING_DIR = '/home/owner/share/tmp/wgt_unpack';


// --- Helpers ---

function log(msg) {
    console.log('[TizenBrew Service]: CertLogic: ' + msg);
}

// List all files in dirPath recursively. Returns relative paths from dirPath.
function listFilesRelative(dirPath) {
    var results = [];
    var entries = fs.readdirSync(dirPath);
    entries.forEach(function (entry) {
        var full = path.join(dirPath, entry);
        if (fs.statSync(full).isDirectory()) {
            listFilesRelative(full).forEach(function (sub) {
                results.push(path.join(entry, sub));
            });
        } else {
            results.push(entry);
        }
    });
    return results;
}

// Unpack a wgt (it's a zip) into toPath.
// Returns null on success, error message string on failure.
function extractWgt(wgtPath, toPath) {
    try {
        child_process.execSync('rm -rf ' + toPath + ' && mkdir -p ' + toPath);
        child_process.execSync('unzip -q ' + wgtPath + ' -d ' + toPath);
        return null;
    } catch (e) {
        return e.message;
    }
}

// Repack a directory back into a wgt (zip).
// Returns null on success, error message string on failure.
function repackWgt(workingDir, newWgtPath) {
    try {
        // 'cd' first so paths inside the archive are relative (no leading './')
        child_process.execSync('cd ' + workingDir + ' && zip -rq ' + newWgtPath + ' .');
        return null;
    } catch (e) {
        return e.message;
    }
}

// Parse a PKCS12 DER binary string into a forge PKCS12 object.
// certBinaryStr: binary-encoded string (NOT base64, NOT Buffer , forge.asn1.fromDer expects binary).
function parseP12(certBinaryStr, password) {
    var asn1 = forge.asn1.fromDer(certBinaryStr);
    return forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
}


// Get the TV's DUID without ADB/SDB , SmartView SDK exposes it via HTTP on port 8001.
function getDuid(callback) {
    // Alternative: child_process.execSync('buxton2ctl get-string system db/spec/duid') 
    // but SmartView HTTP is cleaner and always available when dev mode is active.
    http.get('http://127.0.0.1:8001/api/v2/', function (res) {
        var data = '';
        res.on('data', function (c) { data += c; });
        res.on('end', function () {
            try {
                var info = JSON.parse(data);
                var duid = info.device.duid || info.device.id;
                if (!duid) return callback(new Error('DUID not found in SmartView API response'));
                callback(null, duid);
            } catch (e) {
                callback(new Error('SmartView API parse error: ' + e.message));
            }
        });
    }).on('error', function (e) {
        callback(new Error('SmartView API unreachable (is TV in dev mode?): ' + e.message));
    });
}


// --- Certificate creation (Tizen 7+) ---

function createCert(authData, savePath, callback) {
    getDuid(function (err, duid) {
        if (err) return callback(new Error('Could not get DUID: ' + err.message));
        log('DUID: ' + duid);

        // Random PKCS12 password stored alongside the certs.
        var password = crypto.randomBytes(12).toString('hex');

        // authorInfo field names match Tizen Studio Certificate Extension conventions.
        // 'Partner' privilege level is required to install most 3rd-party apps.
        var authorInfo = {
            name: 'TizenBrewDev',
            email: authData.email || (authData.userId + '@samsung.com'),
            password: password,
            privilegeLevel: 'Partner'
        };

        var accessInfo = {
            userId: authData.userId,
            accessToken: authData.access_token
        };

        var creator = new tizen_studio.SamsungCertificateCreator();

        creator.createCertificate(authorInfo, accessInfo, [duid]).then(function (certificate) {
            // certificate fields (binary strings, not base64):
            //   certificate.authorCert:      DER-encoded author PKCS12
            //   certificate.distributorCert: DER-encoded distributor PKCS12
            //   certificate.distributorXML:  device-profile XML (wascmd may need it on some versions)
            log('SamsungCertificateCreator succeeded');

            // Write device-profile.xml (wascmd needs it on some Tizen versions)
            try {
                child_process.execSync('mkdir -p /home/owner/share/tmp/sdk_tools');
                fs.writeFileSync(
                    '/home/owner/share/tmp/sdk_tools/device-profile.xml',
                    certificate.distributorXML
                );
            } catch (e) {
                log('Warning: could not write device-profile.xml: ' + e.message);
            }

            // Save both certs as base64 + the password to disk.
            // Buffer.from(str, 'binary') safely converts the binary string to a Buffer for base64 encoding.
            var certConfig = {
                authorCert: Buffer.from(certificate.authorCert, 'binary').toString('base64'),
                distributorCert: Buffer.from(certificate.distributorCert, 'binary').toString('base64'),
                password: password
            };
            fs.writeFileSync(savePath, JSON.stringify(certConfig));
            log('Cert config saved to ' + savePath);

            callback(null);
        }).catch(function (e) {
            callback(new Error('SamsungCertificateCreator failed: ' + e.message));
        });
    });
}


function loadCert(savePath) {
    var save = JSON.parse(fs.readFileSync(savePath, 'utf8'));
    if (!save.authorCert || !save.distributorCert || !save.password) {
        throw new Error('Saved cert is incomplete, delete it and re-auth');
    }
    // base64 -> binary string (what forge.asn1.fromDer expects)
    var authorBin = Buffer.from(save.authorCert, 'base64').toString('binary');
    var distBin = Buffer.from(save.distributorCert, 'base64').toString('binary');
    return {
        authorP12: parseP12(authorBin, save.password),
        distributorP12: parseP12(distBin, save.password)
    };
}


// --- WGT signing ---
// wgtPath:  path to the wgt to sign. Modified in-place (unpacked, signed, repacked at same path).
// certP12s: { authorP12, distributorP12 } - forge PKCS12 objects from loadCert()
// callback(err)
//
// Signing order per W3C Widget Digsig spec:
//   1. AuthorSignature       - signs all widget content files (no existing sig XMLs)
//   2. DistributorSignature  - signs those same content files + author-signature.xml
//
// tizen_studio.Signature.sign(p12) returns a Promise resolving to an array of
//   { uri: encodeURIComponent(relPath), data: Buffer }
// including the newly generated signature XML file itself.

function signWgtPackage(wgtPath, certP12s, callback) {
    var unpackDir = WORKING_DIR;

    var err = extractWgt(wgtPath, unpackDir);
    if (err) return callback(new Error('WGT unpack failed: ' + err));

    // Collect all content files (sorted for determinism), skip any existing sig XMLs.
    var allRelPaths = listFilesRelative(unpackDir).sort();
    var fileObjects = allRelPaths
        .filter(function (rel) {
            return rel !== 'author-signature.xml' && rel !== 'signature1.xml';
        })
        .map(function (rel) {
            return {
                uri: encodeURIComponent(rel),  // tizen_studio.Signature expects URI-encoded relative paths
                data: fs.readFileSync(path.join(unpackDir, rel))
            };
        });

    log('Signing ' + fileObjects.length + ' files');

    // Step 1: Author signature
    var authorSig = new tizen_studio.Signature('AuthorSignature', fileObjects);

    authorSig.sign(certP12s.authorP12).then(function (filesWithAuthor) {
        // Step 2: Distributor signature (author-signature.xml is included in scope, per spec)
        var distSig = new tizen_studio.Signature('DistributorSignature', filesWithAuthor);

        return distSig.sign(certP12s.distributorP12).then(function (signedFiles) {
            // Write all signed files back to the unpack directory
            signedFiles.forEach(function (file) {
                var rel = decodeURIComponent(file.uri);
                var fullPath = path.join(unpackDir, rel);
                var dir = path.dirname(fullPath);
                if (!fs.existsSync(dir)) {
                    child_process.execSync('mkdir -p ' + dir);
                }
                fs.writeFileSync(fullPath, file.data);
            });

            // Repack back to wgt, overwriting in-place at wgtPath
            var packErr = repackWgt(unpackDir, wgtPath);
            if (packErr) throw new Error('WGT repack failed: ' + packErr);

            log('WGT signed and repacked: ' + wgtPath);
            callback(null);
        });

    }).catch(function (e) {
        try { child_process.execSync('rm -rf ' + unpackDir); } catch (e) { log('Cleanup failed: ' + e.message); }
        callback(new Error('signWgtPackage failed: ' + e.message));
    });
}


// --- Exports ---

module.exports = {
    getDuid: getDuid,
    verifyDevMode: verifyDevMode,
    createCert: createCert,
    loadCert: loadCert,
    signWgtPackage: signWgtPackage,
    getLanIP: getLanIP
};
