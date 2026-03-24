/* WebSocket client wrapper
   target: Tizen 5.5+ / Chromium 69
   Handles connection to the TizenBrew installer service (ws://localhost:8091)
   and re-dispatches events to the app via window callbacks.
*/

'use strict';

var WS = (function () {

  var Events = {
    InstallPackage:      1,
    
    Error:               3,
    InstallationStatus:  4,
    DeleteConfiguration: 5,
    ConnectToTV:         6
  };

  var socket = null;

  var statusLabels = {
    'installStatus.fetching':   'Fetching from GitHub...',
    'installStatus.resigning':  'Signing package...',
    'installStatus.parsing':    'Reading package...',
    'installStatus.installing': 'Installing...',
    'installStatus.installed':  'Installed successfully!'
  };

  function connect(onReady) {
    socket = new WebSocket('ws://localhost:8091');

    socket.onopen = function () {
      if (typeof onReady === 'function') onReady();
    };

    socket.onerror = function () {
      // Service not yet running, launch it, then reload
      var pkgId = tizen.application.getCurrentApplication().appInfo.packageId;
      tizen.application.launchAppControl(
        new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/service'),
        pkgId + '.InstallerService',
        function () { window.location.reload(); },
        function (e) { App.showError('Could not start install service: ' + e.message); }
      );
    };

    socket.onmessage = function (event) {
      var msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      handleMessage(msg.type, msg.payload);
    };
  }

  function handleMessage(type, payload) {
    switch (type) {

      case Events.InstallPackage:
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
            // If cert error, wipe stored cert so user re-signs next time
            if (failLine.indexOf('Check certificate error') !== -1) {
              send(Events.DeleteConfiguration, null);
            }
          } else {
            App.showStatus('✓ Installed successfully!');
            setTimeout(function () { App.hideStatus(); }, 4000);
          }
        }
        break;

      case Events.InstallationStatus:
        App.showStatus(statusLabels[payload] || payload);
        break;

      case Events.Error:
        App.hideStatus();
        App.showError(payload);
        break;
    }
  }

  function send(type, payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      App.showError('Not connected to install service.');
      return;
    }
    socket.send(JSON.stringify({ type: type, payload: payload }));
  }

  return {
    Events:  Events,
    connect: connect,
    send:    send
  };

})();
