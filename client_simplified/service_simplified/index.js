/**
 * The background tizenbrew-installer-service but writen in a more simplistic way.
 * The old code could be used on both PC/desktop and TV, this new code is Samsung Tizen TV only.
 * 
 * Without any special tools, without polyfills, only nessesary modules.
 * Targeting Tizen 5.5+ and later, with Chromium 69 JS javascript support.
 * 
 * What it is supposed to do:
 * 1) Fetch repo releases from github, pick the .wgt release. 
 * 2) Sign the package with local account Samsung certificate (as if the developer was the user)
 * 3) Install the package to the TV.
 * 
 * This is different from a Tizen Web App. A web app is mainly just a website,
 * while this is a Web Service and a web service has access to Tizen node.js features.
 * 
 */


'use strict';

module.exports.onStart = function () {
    console.log('Service started');

    // fetch from github.
    // adbhost ADB host and client stuff.
    // create/get samsung certificate (as of Tizen 7). (maybe ask user for credentials/login).
    // resign fetched package with certificate. (AuthorSignature, DistributorSignature)
    // make sure everything is in the right path. create a new zip with signature.xml.
    // install the package, that is Install with vd_appinstall (wascmd wrapper for SDB)  (perhaps there is a simpler way, consider it).
    // make sure eveything is pushed and magic stuff like: ``` const sendBuffer = new Buffer(8); \n sendBuffer.writeUInt32LE(0x444E4553, 0); \n sendBuffer.writeUInt32LE(filePath.length + 6, 4); \n adb._writePacket(commands.WRTE, shell._localId, shell._remoteId, sendBuffer); ```
    //
    //
    // mean while tell the user what is going on via the frontend interface.
    //
    // Note this is possible thanks the the developer PC IP in dev mode was set to 127.0.0.1 which creates a local dev loop, so we ourselves can install stuff as if we were Tizen Studio on desktop (that is simulated / hack).



    const { writeFileSync, readFileSync, readdirSync, statSync, mkdirSync, existsSync } = require('fs');
    const { join, dirname } = require('path');
    const { homedir } = require('os');

    const { Signature, SamsungCertificateCreator } = require('tizen')
    const adbhost = require('adbhost');
    const AdbPacket = require('adbhost/lib/packet.js');

    const { execSync } = require('child_process'); // for wascmd, possibly also buxton2ctl if needed
    const xml2js = require('xml2js');
    const JSZip = require('jszip');


    function checkCanConnectToDevice() {
        fetch('http://127.0.0.1:8001/api/v2/').then(res => res.json())
            .then(json => {
                canConnectToDevice = (json.device.developerIP === '127.0.0.1' || json.device.developerIP === '1.0.0.127') && json.device.developerMode === '1';
            }).catch(err => {
                setTimeout(checkCanConnectToDevice, 1000);
            });
    }


    const saveFileName = `${homedir()}/share/tizenbrewInstallerSave.json`;
    function readConfig() {
        if (!existsSync(saveFileName)) {
            return {
                authorCert: null,
                distributorCert: null,
                password: null
            };
        }
        return JSON.parse(readFileSync(saveFileName, 'utf8'));
    }

    function writeConfig(config) {
        if (!existsSync(`${homedir()}/share`)) {
            mkdirSync(`${homedir()}/share`);
        }

        writeFileSync(saveFileName, JSON.stringify(config, null, 4));
    }


    function htmlWebPageForCertificateCredentials() {
        // TODO
    }


    function fetchLatestRelease(repo) {
        // TODO
    }

    // and a lot more code to be made...

} // end of onStart()

// This is called when the UI sends an AppControl signal
module.exports.onRequest = function (request) {
    const wgtUrl = request.data.find(d => d.key === "wgt_url").value[0];
    // TODO
}

module.exports.onStart();

