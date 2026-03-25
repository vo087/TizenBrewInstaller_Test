// Certificate creation and signatures logic, this is a utility file.
// code is made simplest way possible.

// hopefully we can use as little dependencies as resonably possible, hopefully without jsZip and node-forge.
// we may use linux commands

'use strict';

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var child_process = require('child_process');

var WORKING_DIR = '/home/owner/share/tmp/wgt_unpack';
var HASH_ALGO = 'sha256'; // could be sha512, depending on W3C 1.1 spec the Tizen folows.
var SIGN_ALGO = 'RSA-SHA256';
var SIGN_ALGO_lower = SIGN_ALGO.toLowerCase();

function generateHash(data) {
    return crypto.createHash(HASH_ALGO).update(data).digest('base64');
}

function extractWgt(wgtPath, toPath) {
    try {
        child_process.execSync('rm - rf ' + toPath + ' && mkdir - p ' + toPath);
        child_process.execSync('unzip -q ' + wgtPath + ' -d ' + toPath);
        return undefined;
    } catch(e) {
        return e.message;
    }
}

function zipWgt(workingDir, newWgtPath) {
    try {
        child_process.execSync('cd ' + workingDir + ' && zip -rq ' + newWgtPath + ' .');
        return undefined;
    } catch(e) {
        return e.message;
    }
}

function getAllFiles(dirPath, arrayOfFiles) {
    var files = fs.readdirSync(dirPath);
    arrayOfFiles = arrayOfFiles || []; // due to recursive calls
    files.forEach(function(file) {
        var p = path.join(dirPath, "/", file);
        if (fs.statSync(p).isDirectory()) {
            arrayOfFiles = getAllFiles(p, arrayOfFiles);
        } else {
            arrayOfFiles.push(p);
        }
    });
    return arrayOfFiles;
}

// Note: there is both  "author-signature.xml"  and  "signature1.xml" 

function generateRegerenceHashes(dirPath, privateKeyPEM) {
    // This one should be called once to generate AuthorSignature, and save it
    // and then called once again to generate DistributorSignature (that includes new file "author-signature.xml" file in SignInfo)

    var xmlSignedInfoStart = '<SignedInfo><CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/><SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#' + SIGN_ALGO_lower + '"/>';

    var xmlReferenceHashes = '';
    files = getAllFiles(dirPath);
    files.forEach(function (file) { // should maybe be an array then join all strings.
        var relativePath = path.relative(unpackDir, file); // maybe escape / to %2F
        var hash = generateHash(fs.readFileSync(file));
        xmlReferenceHashes += '<Reference URI="' + relativePath + '"><DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#' + HASH_ALGO + '"/><DigestValue>' + hash + '</DigestValue></Reference>';
    });

    var xmlSignedInfoTotal = xmlSignedInfoStart + xmlReferenceHashes + '</SignedInfo>'

    var signatureValue = crypto.createSign(SIGN_ALGO).update(signedInfo).sign(privateKeyPEM, 'base64');

    var xmlPostHash = '\n<SignatureValue>' + signatureValue + '</SignatureValue>\n'

    // skip "#prop"

    // note: the xml is not done here, it is finished building inside  generateXMLSignatureString()
    return xmlSignedInfoStart + xmlReferenceHashes + xmlPostHash
}

function generateXMLSignatureString(dirPath, variant, cerficiates) {
    // annoying to build this by hand, but we have no choise. easy for human error to sneak in...

    // 'variant' is either  AuthorSignature  or  DistributorSignature

    var xmlStart = '<?xml version="1.0" encoding="UTF-8"?>\n'; // maybe not this, I don't see it else where...
    xmlStart += '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#" Id="' + variant + '">\n';

    xmlReferenceHashes = generateRegerenceHashes(dirPath, cerficiates.privateKeyPEM);

    // TODO  We don't have it yet
    var authorCert = cerficiates.authorCertPEM.replace(/-----(BEGIN|END) CERTIFICATE-----|\n/g, '');
    var intermediateCert = cerficiates.distributorCertPEM.replace(/-----(BEGIN|END) CERTIFICATE-----|\n/g, '')
    var xmlEnd = '<KeyInfo><X509Data><X509Certificate>' + authorCert + '</X509Certificate><X509Certificate>' + intermediateCert + '</X509Certificate></X509Data></KeyInfo></Signature>';

    // skip "<Object>"  // this one is also different between variants.

    return xmlStart + xmlReferenceHashes + xmlEnd;
}



function createCert() {
    // TODO
    // We need two different cert
    // we have no PKCS#12 (.p12) yet   (use the Auth Bridge to let the user do the heavy lifting)
    // Your Cert: Issued to "User Name".
    //Samsung's Cert: Issued to "Samsung Code Signing CA".
    // SCS (Samsung Certificate Service)
    // SSO (Samsung Account)  to get  access_token

    // On Tizen 8, the TV's firmware has a "Root" certificate. It cannot verify Tag 1 directly. It verifies Tag 2 against the Root, and then uses Tag 2 to verify Tag 1. If Tag 2 is missing, the chain is broken.
    // The Reality: In the TizenBrew hack, the TV is "fooled" into thinking it is its own developer PC.
    // UNCHECKED:
    // UNCHECKED: If the user provides a Personal/Author Certificate, you only need one <X509Certificate> tag in author-signature.xml.
    // UNCHECKED: The "Double Tag" structure is for Distributor - signed packages(Official Store apps).Since TizenBrew installs apps in "Developer Mode," a single valid Author certificate is usually enough to satisfy the wascmd check, even on Tizen 7 / 8, provided the DUID matches.
    // UNCHECKED: Tizen 8 is where the signature becomes a hard wall. They check the author-signature.xml against the Samsung Account logged into the TV.

    // save is done by index.js instead
}

// Example logic to fetch the signed cert from Samsung
function fetchSamsungCert(accessToken, duid, callback) {
    const https = require('https');

    const payload = JSON.stringify({
        "device_id": duid,
        "access_token": accessToken,
        "type": "developer" // or "distributor"
    });

    const options = {
        hostname: 'api.samsung.com', // Placeholder for the actual signer endpoint
        path: '/v1/tizen/sign',  // Pretty sure it shoudl be scs.samsung.com/v2/ ??  This is the modern endpoint used by Tizen Studio 4.x and 5.x   SCS (Samsung Certificate Service)
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': payload.length
        }
    };

    const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (d) => { data += d; });
        res.on('end', () => {
            // This 'data' contains the Base64 certs for your XML
            callback(null, JSON.parse(data));
        });
    });

    req.write(payload);
    req.end();
}

function signWgtPackage(unpackedDir, cert) {
    // Assume: no signatures already, it is downloaded from github source not a TizenStudio.
    // Signs a .wgt with the stored author + distributor certs. (or whatever is needed)
    // Signs all files if needed, repacks the zip.
    // tizen.Signature, 
    // TODO

    xml = generateXMLSignatureString(unpackedDir, 'AuthorSignature', certificates);
    fs.writeFileSync(path.join(unpackedDir, 'author-signature.xml'), xml);

    xml = generateXMLSignatureString(unpackedDir, 'DistributorSignature', certificates);
    fs.writeFileSync(path.join(unpackedDir, 'signature1.xml'), xml);
}

function getFileHash(filePath) {
    const data = fs.readFileSync(filePath);
    // Tizen XML digital signatures typically use Base64 for the <DigestValue>
    return crypto.createHash('sha256').update(data).digest('base64');
}

function getDuid(callback) { // DUID
    // could perhaps do: buxton2ctl get-string system db/spec/duid

    http.get('http://127.0.0.1:8001/api/v2/', function (res) {
        var data = '';
        res.on('data', function (c) { data += c; });
        res.on('end', function () {
            try {
                var info = JSON.parse(data);
                var duid = info.device.duid || info.device.id;
                if (!duid) return callback(new Error('DUID not found in SmartView API response'));
                callback(null, duid);
            } catch (e) { callback(new Error('SmartView API parse error: ' + e.message)); }
        });
    }).on('error', function (e) { callback(new Error('SmartView API unreachable: ' + e.message)); });
}


module.exports = {
    //createCert: createCert,
    //signWgtPackage: signWgtPackage,
    getDuid: getDuid
};
