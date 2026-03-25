// Tizen Service - different from a web app
// docs: https://docs.tizen.org/application/web/get-started/web-service/first-service/
// This Installer Service is used to download .wgt and run commands to sign and install the app, simplest way possible.

'use strict';

var http = require('http');
var https = require('https');
var fs = require('fs');
var child_process = require('child_process');
var certificate_logic = require('./certificate_logic.js');

// Configuration
var SERVER_PORT = 8091;
var SIGN_PORT = 4794; // Samsung Certificate Manager auth bridge port.
var SAVE_PATH = '/home/owner/share/tizenbrewInstallerSavedData.json';
var TEMP_WGT_FOLDER_PATH = '/home/owner/share/tmp/sdk_tools/';
var TEMP_WGT_PATH = TEMP_WGT_FOLDER_PATH + 'package.wgt';
var LOCAL_HOST = '127.0.0.1'

var HEADERS = { 'User-Agent': 'TizenBrew' }; // needed, else we get 403.
var STATUS_OK = 200

// State management
// architecture note: HTTP (single command) + SSE (status)
var server = null;
var clientResponse = null; // could be array, but we only have one client.
var devModeFailed = false;

var Events = {


    Error: 3,
    InstallationStatus: 4,

    ConnectToTV: 6,
    ExtraInfo: 7,
    NeedAuth: 8
};

// General note: some code is bulky or longer than needed because of backwards compatibility.

// 1. GitHub API -> Find .wgt URL
function findWgtAppURL(repoPath, callback) {
    var options = { 
        hostname: 'api.github.com',
        path: '/repos/' + repoPath + '/releases/latest',
        headers: HEADERS
    };

    https.get(options, function (res) { 
        if (res.statusCode !== STATUS_OK) {
            callback(new Error('GitHub API returned (not ok): ' + res.statusCode));
            return;
        }

        var data = '';
        res.on('data', function (chunk) { data += chunk; });
        res.on('end', function () {
            try {
                var releases = JSON.parse(data);
                if (releases.assets && releases.assets.length) {
                    var asset = releases.assets.filter(function (a) { return /\.wgt$/i.test(a.name); })[0];
                    if (asset) callback(null, asset.browser_download_url, asset.name); // success
                    else callback(new Error('No .wgt found in repo releases: ' + JSON.stringify(options)));
                }
                else callback(new Error('No .wgt found in repo releases'));
            } catch (e) { callback(new Error('GitHub API/JSON Error: ' + e.message)); }
        });
    }).on('error', function (e) { callback(new Error('Network error: ' + e.message)); });
}

// 2. GitHub Downloader (Streaming to avoid OOM)
function downloadWgtAppFromURL(url, callback) {
    https.get(url, {headers: HEADERS}, function (res) {
        // Handle GitHub/S3 Redirects, needed.
        if (res.statusCode >= 300 && res.statusCode < 400) { // 301 and 302
            return downloadWgtAppFromURL(res.headers.location, callback);
        }
        if (res.statusCode !== STATUS_OK) { 
            return callback(new Error('Download failed: ' + res.statusCode));
        }
        // we do not block if server answers wrong, but might be worth debug for.
        log("content type: " + (res.headers['content-type'] || '')); 

        // Warning: Some Tizen 5.5 / 6.0 TVs run Node v10.9.0 , this is not supported.
        //fs.mkdirSync(TEMP_WGT_FOLDER_PATH, { recursive: true }); 
        child_process.execSync('mkdir -p ' + TEMP_WGT_FOLDER_PATH);
        
        var file = fs.createWriteStream(TEMP_WGT_PATH);
        res.pipe(file); // store to file.

        var done = false;
        function finish(err) { // incase callback gets called twice.
            if (done) return;
            done = true;
            callback(err);
        }
        
        file.on('error', finish);
        res.on('error', finish);
        
        file.on('finish', function () {
            file.close(finish);
        });
    }).on('error', callback);
}

// 3. Installer Logic
function installPackage(sendStatus, pkgPath) {
    // Note: this project is a dev tool, no shell escape, no security, if dev wants to do injection feel free. 
    // Determine Package ID from config.xml inside WGT
    // instead of jsZip try linux unzip.
    var cmd = 'unzip -p ' + pkgPath + ' config.xml' // | grep -o 'package=\"[^\"]*\"' | head -1 | cut -d'\"' -f2";

    child_process.exec(cmd, function (err, stdout) {
        if (err) return sendStatus(Events.Error, 'Unzip command failed: ' + err.message);

        /* 
        Install:    package ID        <tizen:application package="...">
        Launch:     application ID    <tizen:application id="...">
        Signing:    widget ID         <widget id="...">
         */
        var match = stdout.match(/<tizen:application[^>]*package="([^"]+)"/);
        if (!match || !match[1]) return sendStatus(Events.Error, 'Could not find package info in config.xml');

        var pkgId = match[1].trim();
        if (!pkgId) return sendStatus(Events.Error, 'Could not find Package ID in config.xml');
        // maybe test pkgID length == 10, unsure what modern Tizen docs say.

        sendStatus(Events.InstallationStatus, 'Installing ' + pkgId + ' ... (' + pkgId.length + ')');

        // Final command
        // Note: Tizen 7+ would need a 'tizen sign' call here before wascmd
        child_process.exec('wascmd -i ' + pkgId + ' -p ' + pkgPath, function (err, stdout, stderr) {
            if (err) return sendStatus(Events.Error, 'Install failed: ' + err.message + (stderr ? '\n' + stderr : ''));
            if (stderr) log('wascmd stderr: ' + stderr);

            sendStatus(Events.InstallationStatus, 'Successfully installed!'); 
            sendStatus(Events.ExtraInfo, stdout); 

            try {
                if (fs.existsSync(TEMP_WGT_PATH)) {
                    fs.unlinkSync(TEMP_WGT_PATH);
                }
            } catch (e) {
                log('clean up failed');
            }
        });
        // TODO if cert sign failed, maybe wipe saved data.
    });
}

// 0. Install Request Handling
function handleInstallRequest(sendStatus, req) {
    if (devModeFailed) {
        sendStatus(Events.Error, 'Failed to setup dev mode: ' + devModeFailed.err)
        return;
    }

    var data = '';
    req.on('data', function (chunk) { data += chunk; });
    req.on('end', function () {
        var repo = data.trim();
        if (!repo) return sendStatus(Events.Error, 'No repo provided.');
        
        // downloadAndInstallRepo();
        sendStatus(Events.InstallationStatus, 'Fetching GitHub release...');
        findWgtAppURL(repo, function (err, downloadURL, name) {
            if (err) return sendStatus(Events.Error, err.message);

            sendStatus(Events.InstallationStatus, 'Downloading ' + name + ' ...');
            downloadWgtAppFromURL(downloadURL, function (err) {
                if (err) return sendStatus(Events.Error, 'Download failed: ' + err.message);

                sendStatus(Events.InstallationStatus, 'Downloaded the .wgt');
                installPackage(sendStatus, TEMP_WGT_PATH);
            });
        });

    });
}


function handleAuthRequest(req, res) {
    // TODO  this is fake stub
    var body = '';
    req.on('data', function (chunk) { body += chunk; });
    req.on('end', function () {
        // Logic to save Samsung Account data to SAVE_PATH
        fs.writeFileSync(SAVE_PATH, body);
        res.writeHead(STATUS_OK, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ status: 'success' }));
    });
}

// Minimal Web Server
function createWebServer() {
    server = http.createServer(function (req, res) {
        // Handle Tizen 7+ Auth
        if (req.url === '/handle-auth' && req.method === 'POST') {
            handleAuthRequest(req, res); // maybe on a seperate port... TODO
        }
        else if (req.url === '/delete-saved-info' && req.method === 'POST') { 
            try {
                if (fs.existsSync(SAVE_PATH)) {
                    fs.unlinkSync(SAVE_PATH);
                }
                res.writeHead(STATUS_OK);
                res.end(JSON.stringify({ status: 'success' }));
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: e.message }));
            }
        }
        else if (req.url === '/install' && req.method === 'POST') { // start installing
            // could check if(client_reponse) is there, but I'll let it slide anyway.
            handleInstallRequest(sendStatus, req);
            res.writeHead(202); // "Accepted"
            res.end(JSON.stringify({ status: 'processing' }));
        }
        else if (req.url === '/events' && req.method === 'GET') { // live connection to write current status to
            // set up SSE
            res.writeHead(STATUS_OK, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            });

            clientResponse = res;

            var heartbeat = setInterval(function () { // avoid dropped connection
                if (clientResponse) {
                    clientResponse.write(':\n\n'); 
                }
            }, 15000);

            req.on('close', function () {
                clearInterval(heartbeat);
                clientResponse = null;
            });

            sendStatus(Events.ConnectToTV, 'Service Online');
        }
        else { // no such page
            res.writeHead(404);
            res.end();
        }
    });

    server.listen(SERVER_PORT, LOCAL_HOST); // Use 0.0.0.0 for LAN access??
    log('TizenBrew Service Started on ' + SERVER_PORT);
}

// Initialize "The Hack"
function initDevMode() {
    try {
        child_process.execSync('buxton2ctl set-string system db/sdk/develop/ip ' + LOCAL_HOST);
        child_process.execSync('buxton2ctl set-int32 system db/sdk/develop/mode 1');
        log('Dev mode initialized');  // TODO we don't check anything via :8001/api
        devModeFailed = false;
    } catch (e) {
        console.error('Failed to set dev mode:', e.message);
        devModeFailed = { err: e.message };
    }
}


// Lifecycle Exports
module.exports.onStart = function () {
    initDevMode();
    createWebServer();
}

module.exports.onRequest = function () {
    // mostly for 'Keep Alive' insurance testing
    log('TizenBrew Service request received');
};

module.exports.onStop = function () {
    sendStatus(Events.Error, 'Service Offline!');
    if (server) server.close();
};



// --- Utilities ---

function sendStatus(type, message) {
    if (clientResponse) {
        var payload = JSON.stringify({ type: type, message: message });
        clientResponse.write('data: ' + payload + '\n\n');
    }
    else log('tried to send status, but no client connected');
}

function log(message) {
    console.log('TizenBrew Service: ' + message)
}