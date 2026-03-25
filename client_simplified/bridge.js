/*  Bridge to localhost:8091 which is the service in service_simplified/index.js
    target: Tizen 5.5+ / Chromium 69
    Handles connection to the TizenBrew installer service (localhost:8091)  (http client to server)
    and shows new information about the process via SSE (server to client)
*/

'use strict';


var Events = {
  
  
  Error:              3,
  InstallationStatus: 4,
  
  ConnectToTV:        6,
  ExtraInfo:          7,
  NeedAuth:           8
};

var server = null;

  

function connect(onReady) { // TODO
  server = // something something connect to localhost:8091

  // if localhost:8091/events not working
  onError = function () {
    // Service not yet running, launch it, then reload - I don't know if this is correct.
    // Is this even possible on the Web App side wgt, isn't this only for node service code?
    var pkgId = tizen.application.getCurrentApplication().appInfo.packageId;
    tizen.application.launchAppControl(
      new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/service'),
      pkgId + '.InstallerService',
      function () { window.location.reload(); },
      function (e) { App.showError('Could not start install service: ' + e.message); }
    );
  };

  // new SSE event 
  onEvent = function (event) {
    var msg;
    try { msg = JSON.parse(event.data); } catch (e) { return; }
    handleMessage(msg.type, msg.payload);
  };
}

function handleMessage(type, payload) {
  switch (type) {

    case Events.NeedAuth:
      // This is worng, but example code.
      // response 0 = done, 1 = cert saved, 2 = cert needed
      if (payload.response === 2) {
        App.showSigningOverlay();
      } else if (payload.response === 1) {
        App.hideSigningOverlay();
        App.showStatus('Certificate saved, retrying...');
      } else if (payload.response === 0) {
        App.hideStatus();
        var failLine = payload.result && payload.result.split('\n').filter(function (l) {
          return l.indexOf('install failed') !== -1;
        })[0];
        if (failLine) {
          App.showError('Install failed: ' + failLine);
        } else {
          App.showStatus('✓ Installed successfully!');
          setTimeout(function () { App.hideStatus(); }, 4000);
        }
      }
      break;

    case Events.ConnectToTV:
      App.showStatus(payload);
      break;

    case Events.InstallationStatus:
      App.showStatus(payload);
      App.addInfo(payload);
      break;

    case Events.Error:
      App.hideStatus();
      App.showError(payload);
      App.addInfo(payload);
      break;
  }
}

