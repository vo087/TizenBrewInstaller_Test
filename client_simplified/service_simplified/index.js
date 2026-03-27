// Tizen Service - different from a Web App, background Web Service as backend running on the TV.
// Tizen web service docs: https://docs.tizen.org/application/web/get-started/web-service/first-service/
//
// This installer service downloads .wgt files from GitHub and installs them directly on the TV.
// Aims to be simplest possible implementation.
//
// Node 10 / ES5 safe: no const/let, no arrow functions, no async/await, no backticks, etc

// For Tizen 7+ we also need signing of the package using the own user Samsung Account.

'use strict';

var http = require('http');
var https = require('https');
var fs = require('fs');
var child_process = require('child_process');
var os = require('os');
var certLogic = require('./certificate_logic.js');
var certPage = require('./certificate_page.js');

// --- Configuration ---
var SERVER_PORT = 8091;  // main server (localhost only, UI communication)
var SIGN_PORT = 4794;    // Samsung Certificate Manager auth bridge port (LAN-accessible)
var SAVE_PATH = '/home/owner/share/tizenbrewInstallerSavedData.json';
var TEMP_WGT_FOLDER_PATH = '/home/owner/share/tmp/sdk_tools/';
var TEMP_WGT_PATH = TEMP_WGT_FOLDER_PATH + 'package.wgt';
var LOCAL_HOST = '127.0.0.1';
var HEADERS = { 'User-Agent': 'TizenBrew' };  // needed, else GitHub returns 403
var STATUS_OK = 200;

// --- State ---
var server = null;
var signServer = null;      // serves auth page on SIGN_PORT
var clientResponse = null;  // active SSE connection (one client at a time)
var devModeFailed = false;  // false, or { err: string }
var isTizen7Plus = false;   // set at startup from tizen.systeminfo
var hasSavedData = false;   // do we have a cert? (Tize 7+)
var cert12Ps = null;        // cert data (Tizen 7+)

// --- Event type constants (sent over SSE to UI) ---
var Events = {
    Error: 3,
    InstallationStatus: 4,
    ConnectToTV: 6,
    ExtraInfo: 7,
    NeedAuth: 8     // UI shows the auth URL for the user to open on phone/PC
};


// --- Lifecycle exports ---

module.exports.onStart = function () {
    detectVersionAndSave();
    initDevMode();
    createWebServer();
};

module.exports.onRequest = function () {
    log('onRequest called (keep-alive check)');
};

module.exports.onStop = function () {
    sendStatus(Events.Error, 'Service is stopping...');
    if (server) server.close(); // TODO clientRequest?
    if (signServer) signServer.close();
};


// --- Functionallity ---

function detectVersionAndSave() {
    try {
        /* global tizen from TizenOS Node environment*/
        var version = tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version');
        var major = Number(version.split('.')[0]);
        isTizen7Plus = major >= 7;
        log('Tizen version: ' + version + ' (isTizen7Plus=' + isTizen7Plus + ')');
    } catch (e) {
        // Detection failure is not fatal. Default conservatively to true so the sign server starts and Tizen 7+ TVs can still auth.
        //  On a real < 7 TV this wastes the sign server init and port, but that is harmless.
        log('Warning: Tizen version detection failed (' + e.message + '), assuming Tizen 7+');
        isTizen7Plus = true;
    }
    if(isTizen7Plus) {
        if (fs.existsSync(SAVE_PATH)) hasSavedData = true;
    }
}

// Initialize Dev mode: make the TV point developer IP at itself ("The Hack")
function initDevMode() {
    try {
        child_process.execSync('buxton2ctl set-string system db/sdk/develop/ip ' + LOCAL_HOST);
        child_process.execSync('buxton2ctl set-int32 system db/sdk/develop/mode 1');
        devModeFailed = false;
        log('Dev mode set to 127.0.0.1');

        // Check via SmartView API (port 8001). Logging only.
        verifyDevMode(function (err, ok) {
            if (err) log('Dev mode SmartView verify error: ' + err.message);
            else if (!ok) log('Warning: SmartView says dev mode is NOT active yet');
            else log('Dev mode confirmed via SmartView API');
        });

    } catch (e) {
        log('ERROR: buxton dev mode failed: ' + e.message);
        devModeFailed = { err: e.message };
    }
}


// Verify that buxton dev mode settings took effect. Used for logging only.
function verifyDevMode(callback) {
    http.get('http://127.0.0.1:8001/api/v2/', function (res) {
        var data = '';
        res.on('data', function (c) { data += c; });
        res.on('end', function () {
            try {
                var info = JSON.parse(data);
                var ok = info.device.developerIP === '127.0.0.1' && info.device.developerMode === '1';
                callback(null, ok);
            } catch (e) {
                callback(new Error('SmartView parse error: ' + e.message));
            }
        });
    }).on('error', function (e) {
        callback(new Error('SmartView API unreachable: ' + e.message));
    });
}


// Main web server, port 8091 (localhost only, UI talks here)
function createWebServer() {
    server = http.createServer(handleRequest);

    server.listen(SERVER_PORT, LOCAL_HOST, function () {
        log('Main server on port ' + SERVER_PORT + ' (localhost only)');
    });

    server.on('error', function (e) {
        log('Main server error: ' + e.message);
    });
}

function handleRequest(req, res) {
    if (req.url === '/install' && req.method === 'POST') {
        // 202 Accepted immediately, actual result comes via SSE
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'processing' }));
        installRequest(req);
    }
    else if (req.url === '/events' && req.method === 'GET') {
        eventsRequest(req, res);
    }
    else if (req.url === '/delete-saved-info' && req.method === 'POST') {
        deleteDataRequest(req, res);
    }
    else {
        res.writeHead(404);
        res.end();
    }
}

function eventsRequest(req, res) {
    res.writeHead(STATUS_OK, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });
    if (clientResponse) {
        clientResponse.close();
    }
    clientResponse = res;

    // Heartbeat to prevent connection drops
    var heartbeat = setInterval(function () {
        if (clientResponse) clientResponse.write(':\n\n');
    }, 15000);

    req.on('close', function () {
        clearInterval(heartbeat);
        clientResponse = null;
    });

    // Immediately confirm to the UI that service is up
    sendStatus(Events.ConnectToTV, 'Service Online');
}

function deleteDataRequest(req, res) {
    try {
        deleteSaveData();
        res.writeHead(STATUS_OK, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success' }));
    } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
    }
}



// 0. Install request handler, get repo data and check cert
function installRequest(req) {
    if (devModeFailed) {
        return sendStatus(Events.Error, 'Dev mode setup failed: ' + devModeFailed.err);
    }

    var data = '';
    req.on('data', function (chunk) { data += chunk; });
    req.on('end', function () {
        var repo = data.trim();
        if (!repo) return sendStatus(Events.Error, 'No repo provided.');

        // Gatekeeper: Check cert requirement before downloading, so make one
        if (isTizen7Plus && !hasSavedData) {
            return certificateProcess(repo);
        }

        return continueFromRepo(repo);
    });
}


function certificateProcess(pendingRepoToInstall) {
    // assumption: isTizen7Plus = true

    sendStatus(Events.InstallationStatus, 'Loading signing certificate...');

    if(hasSavedData) {
        try {
            certP12s = certLogic.loadCert(SAVE_PATH);
        } catch (e) {
            // Cert is missing or corrupt - wipe it so re-auth is triggered next time.
            try { deleteSaveData(); } catch (ex) { /* ignore */ }
            sendStatus(Events.Error, 'Certificate load failed: ' + e.message + '. Saved cert deleted, re-auth on next install.');
            return;
        }
        continueFromRepo(pendingRepoToInstall);
    }
    else {
        
        // No cert yet, tell the UI to prompt the user to open the auth page.
        var ip = getLanIP();
        var authUrl = 'http://' + ip + ':' + SIGN_PORT + '/';
        sendStatus(Events.NeedAuth, authUrl);
        log('Auth needed before download. Sign server URL: ' + authUrl);
        
        // It is fine to start it late, because we can sefely expect a user to be very slow entering ip + port numbers.
        createSignServer(pendingRepoToInstall);
        //certLogic.createCert();

        // Once the user completes auth, handleAuthCallback resumes the install.
    }
}


// 1. From repo info get the release file and download it. 
function continueFromRepo(repoToInstall) {
    // From here on out we have a cert on Tizen 7+

    sendStatus(Events.InstallationStatus, 'Fetching GitHub release...');

    findWgtAppURL(repoToInstall, function (err, downloadURL, name) {
        if (err) return sendStatus(Events.Error, 'GitHub error: ' + err.message);

        sendStatus(Events.InstallationStatus, 'Downloading ' + name + ' ...');
        downloadWgtAppFromURL(downloadURL, function (err) {
            if (err) return sendStatus(Events.Error, 'Download error: ' + err.message);

            sendStatus(Events.InstallationStatus, 'Download complete.');
            continueAfterDownload(sendStatus, TEMP_WGT_PATH);
        });
    });
}


// 2. GitHub API -> Find .wgt download URL
function findWgtAppURL(repoPath, callback) {
    var options = {
        hostname: 'api.github.com',
        path: '/repos/' + repoPath + '/releases/latest',
        headers: HEADERS
    };

    https.get(options, function (res) {
        if (res.statusCode !== STATUS_OK) {
            return callback(new Error('GitHub API returned: HTTP ' + res.statusCode));
        }

        var data = '';
        res.on('data', function (chunk) { data += chunk; });
        res.on('end', function () {
            try {
                var releases = JSON.parse(data);
                if (releases.assets && releases.assets.length) {
                    var asset = releases.assets.filter(function (a) { return /\.wgt$/i.test(a.name); })[0];
                    if (asset) return callback(null, asset.browser_download_url, asset.name);
                }
                callback(new Error('No .wgt asset found in repo latest release'));
            } catch (e) {
                callback(new Error('GitHub API/JSON parse error: ' + e.message));
            }
        });
    }).on('error', function (e) {
        callback(new Error('Network error reaching GitHub: ' + e.message));
    });
}


// 3. Download .wgt (streaming to avoid OOM)
function downloadWgtAppFromURL(url, callback) {
    https.get(url, { headers: HEADERS }, function (res) {
        // Follow GitHub/S3 redirects (301, 302), needed.
        if (res.statusCode >= 300 && res.statusCode < 400) {
            return downloadWgtAppFromURL(res.headers.location, callback);
        }
        if (res.statusCode !== STATUS_OK) {
            return callback(new Error('Download failed: HTTP ' + res.statusCode));
        }
        // we do not block if server answers wrong, but might be worth debug for.
        log('content type: ' + (res.headers['content-type'] || '')); 

        // Warning: Some Tizen 5.5 / 6.0 TVs run Node v10.9.0, this line is unstable therefore linux.
        //fs.mkdirSync(TEMP_WGT_FOLDER_PATH, { recursive: true }); 
        child_process.execSync('mkdir -p ' + TEMP_WGT_FOLDER_PATH);

        var file = fs.createWriteStream(TEMP_WGT_PATH);
        res.pipe(file); // store to file

        var done = false;
        function finish(err) { // incase callback gets called twice.
            if (done) return;
            done = true;
            callback(err);
        }

        file.on('error', finish);
        res.on('error', finish);
        file.on('finish', function () { file.close(finish); });

    }).on('error', callback);
}


// 4. After download: extract pkgId, then branch on Tizen version
function continueAfterDownload(wgtPath) {
    // Extract pkg ID from the wgt before anything else
    var pkgId;
    try {
        pkgId = getPkgId(wgtPath);
        log('Package ID: ' + pkgId);
    } catch (e) {
        return sendStatus(Events.Error, 'Could not read package ID: ' + e.message);
    }

    if (isTizen7Plus) { // we have already checked that cert exist / hasSavedData = true.
        // Tizen 7+: must sign with a Samsung developer certificate.
        // we have already checked that there exist a Samsung developer certificate already.
        signAndInstall(wgtPath, pkgId, cert12Ps);
    } else {
        // Tizen < 7: no signing required, install directly.
        installPackage(wgtPath, pkgId);
    }
}


// Sign then install (Tizen 7+ path).
function signAndInstall(wgtPath, pkgId, certP12s) {
    
    sendStatus(Events.InstallationStatus, 'Signing wgt package...');
    certLogic.signWgtPackage(wgtPath, certP12s, function (err) {
        if (err) return sendStatus(Events.Error, 'Signing package failed: ' + err.message);

        sendStatus(Events.InstallationStatus, 'Package signed. Installing...');
        installPackage(sendStatus, wgtPath, pkgId);
    });
}


// 5, lastly. Install the downloaded (and potentially signed) .wgt via wascmd
function installPackage(pkgPath, pkgId) {
    sendStatus(Events.InstallationStatus, 'Installing ' + pkgId + ' ...');

    child_process.exec('wascmd -i ' + pkgId + ' -p ' + pkgPath, function (err, stdout, stderr) {
        if (err) {
            return sendStatus(Events.Error, 'Install failed: ' + err.message + (stderr ? '\n' + stderr : ''));
        }
        if (stderr) log('wascmd stderr: ' + stderr);

        sendStatus(Events.InstallationStatus, 'Successfully installed!');
        if (stdout) sendStatus(Events.ExtraInfo, stdout);

        // Cleanup the temp wgt
        try { if (fs.existsSync(TEMP_WGT_PATH)) fs.unlinkSync(TEMP_WGT_PATH); }
        catch (e) { log('Cleanup failed: ' + e.message); }
    });
    // TODO if wascmd says certificate error, maybe wipe saved data.
}


// --- Certificate creation ---

// Sign server, port 4794, LAN-accessible.
// Serves the Samsung auth page and receives the resulting JSON via POST /submit-auth.
function createSignServer(pendingRepoToInstall) {
    var tvIP = getLanIP(); 
    var html = certPage.buildSignInPage(tvIP);
    signServer = http.createServer(function (req, res) {
      
        if (req.method === 'GET' && req.url === '/') { // "home page"
            res.writeHead(STATUS_OK, { 'Content-Type': 'text/html' });
            res.end(html);
            return;
        }

        if (req.method === 'POST' && req.url === '/submit-auth') {
            var body = '';
            req.on('data', function (chunk) { body += chunk; });
            req.on('end', function () {
                try {
                    var authData = JSON.parse(body);
                    handleAuthCallback(authData, res, pendingRepoToInstall);
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid JSON: ' + e.message }));
                }
            });
            return;
        }

        res.writeHead(404);
        res.end();
    });

    signServer.listen(SIGN_PORT, '0.0.0.0', function () {
        log('Sign server started on port ' + SIGN_PORT + ' (LAN-accessible)');
    });

    signServer.on('error', function (e) {
        log('Sign server error: ' + e.message);
    });
}

// Auth callback, called after the user completes Samsung sign-in
// (POST /handle-auth on the sign server, port 4794).
function handleAuthCallback(authData, res, pendingRepoToInstall) {
    if (!authData.access_token || !authData.userId) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Missing access_token or userId in posted JSON' }));
        return;
    }

    // Acknowledge to the browser immediately, the rest happens async.
    res.writeHead(STATUS_OK, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ status: 'success', message: 'Creating certificate on TV, please wait...' }));

    sendStatus(Events.InstallationStatus, 'Samsung auth received. Creating certificate...');

    certLogic.createCert(authData, SAVE_PATH, function (err) {
        if (err) {
            return sendStatus(Events.Error, 'Certificate creation failed: ' + err.message);
        }

        hasSavedData = true;
        sendStatus(Events.InstallationStatus, 'Certificate created and saved. Signing and installing...');
        continueFromRepo(pendingRepoToInstall);
    });
}


function deleteSaveData() {
    hasSavedData = false;
    if (fs.existsSync(SAVE_PATH)) fs.unlinkSync(SAVE_PATH);
}


// --- Utilities ---

// Extract the Tizen package ID from a downloaded .wgt.
// Returns the package ID string, or throws an Error on failure.
// The package ID is in config.xml: <tizen:application package="XXXXXXXXXX">
function getPkgId(pkgPath) {
    // Use linux unzip to extract config.xml from the wgt (which is a zip). (instead of jsZip)
    // execSync returns a Buffer; toString() gives us the XML text.
    var buf = child_process.execSync('unzip -p ' + pkgPath + ' config.xml');
    var xml = buf.toString('utf8');

    // Install uses package= (10-char ID), not the full application id (app.package format).
    var match = xml.match(/<tizen:application[^>]*\spackage="([^"]+)"/);
    if (!match || !match[1] || !match[1].trim()) {
        throw new Error('Could not find package ID in config.xml of ' + pkgPath);
    }
    return match[1].trim();
}

// Get the TV's LAN IP (first non-loopback IPv4) for generating the auth URL
// shown to the user so they can reach the sign server from their phone/PC.
function getLanIP() { // might be a better/cleaner way to do this
    var ifaces = os.networkInterfaces();
    var ip = null;
    Object.keys(ifaces).forEach(function (name) {
        (ifaces[name] || []).forEach(function (iface) {
            if (!ip && iface.family === 'IPv4' && !iface.internal) {
                ip = iface.address;
            }
        });
    });
    if (!ip) {
        try { // maybe overkill ip should always be there... this increases complexity of code.
            return child_process.execSync('hostname -I').toString(); // backup plan
        } catch (error) { log('could not get local IP, return null'); }
    }
    return ip;
}

function sendStatus(type, message) {
    if (clientResponse) {
        var payload = JSON.stringify({ type: type, message: message });
        clientResponse.write('data: ' + payload + '\n\n');
    } else {
        log('[no SSE client] type=' + type + ', msg=' + message);
    }
}

function log(message) {
    console.log('[TizenBrew Service]: ' + message);
}
