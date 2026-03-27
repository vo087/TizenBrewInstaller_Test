/* app.js,  UI logic, screen routing, D-pad + Tab + mouse navigation
   target: Tizen 5.5+ / Chromium 69 - 1920×1080
*/

'use strict';

var App = (function () {

  /*  DOM refs  */
  var screens = {
    home:   document.getElementById('screen-home'),
    github: document.getElementById('screen-github')
  };

  var navHint     = document.getElementById('nav-hint');
  var statusBar   = document.getElementById('status-bar');
  var errorBanner = document.getElementById('error-banner');
  var overlaySign = document.getElementById('overlay-signing');
  var accessUrlEl = document.getElementById('access-url');
  //var tbLabel     = document.getElementById('tb-label'); // unused for now
  var ghInput     = document.getElementById('gh-input');
  var extraInfo   = document.getElementById('extra-info');

  /*  Focus state  */
  var focusState  = { home: 0, github: 1 };
  var currentScreen = 'home';

  /*  Screen navigation  */
  function showScreen(name) {
    currentScreen = name;
    Object.keys(screens).forEach(function (k) {
      screens[k].classList.toggle('active', k === name);
    });
    hideError();
    applyFocus();
  }

  /*  Focusable elements per screen  */
  function getFocusables() {
    var el = screens[currentScreen];
    if (!el) return [];
    var nodes = el.querySelectorAll('[data-index]');
    return Array.prototype.slice.call(nodes).sort(function (a, b) {
      return Number(a.dataset.index) - Number(b.dataset.index);
    });
  }

  /*  Apply JS-managed focus  */
  function applyFocus() {
    var focusables = getFocusables();
    var idx = focusState[currentScreen] || 0;
    idx = Math.max(0, Math.min(idx, focusables.length - 1));
    focusState[currentScreen] = idx;

    focusables.forEach(function (elem, i) {
      elem.classList.toggle('focused', i === idx);
    });

    var target = focusables[idx];
    if (target) target.focus({ preventScroll: true });
  }

  function moveFocus(delta) {
    var focusables = getFocusables();
    var idx = Math.max(0, Math.min(
      (focusState[currentScreen] || 0) + delta,
      focusables.length - 1
    ));
    focusState[currentScreen] = idx;
    applyFocus();
  }

  function activateFocused() {
    var focusables = getFocusables();
    var el = focusables[focusState[currentScreen] || 0];
    if (el) el.click();
  }

  /*  Sync JS focus state when Tab moves browser focus 
     Tab/Shift+Tab let the browser move focus natively.
     We listen for focusin to keep our index in sync so
     D-pad can take over at any point without jumping.  */
  document.addEventListener('focusin', function (e) {
    var focusables = getFocusables();
    var idx = focusables.indexOf(e.target);
    if (idx !== -1) {
      // Update state but don't re-call applyFocus (browser already moved focus)
      focusState[currentScreen] = idx;
      focusables.forEach(function (el, i) {
        el.classList.toggle('focused', i === idx);
      });
    }
  });

  /*  Keyboard / D-pad  */
  var KEY_UP     = 38;
  var KEY_DOWN   = 40;
  var KEY_LEFT   = 37;
  var KEY_RIGHT  = 39;
  var KEY_ENTER  = 13;
  var KEY_RETURN = 10009; // Samsung Back
  var KEY_MENU   = 65376; // Samsung Enter (some models)
  // Tab (9) and Shift+Tab are handled natively by the browser,
  // we only sync state via focusin above, no extra handling needed.

  document.addEventListener('keydown', function (e) {
    var code = e.keyCode;
    var activeIsInput = (document.activeElement === ghInput);

    if (code === KEY_RETURN) {
      e.preventDefault();
      if (currentScreen !== 'home') showScreen('home');
      return;
    }

    // While typing in the text field, only intercept Enter/OK
    if (activeIsInput) {
      if (code === KEY_ENTER || code === KEY_MENU) {
        e.preventDefault();
        ghInstall();
      }
      return;
    }

    if (code === KEY_UP || code === KEY_LEFT) {
      e.preventDefault();
      moveFocus(-1);
    } else if (code === KEY_DOWN || code === KEY_RIGHT) {
      e.preventDefault();
      moveFocus(1);
    } else if (code === KEY_ENTER || code === KEY_MENU) {
      e.preventDefault();
      activateFocused();
    }
  });

  /*  Mouse support  */
  document.addEventListener('mouseover', function (e) {
    var target = e.target;
    while (target && target !== document.body) {
      if (target.classList.contains('focusable')) {
        var focusables = getFocusables();
        var idx = focusables.indexOf(target);
        if (idx !== -1) {
          focusState[currentScreen] = idx;
          applyFocus();
        }
        return;
      }
      target = target.parentElement;
    }
  });

  /*  Home screen  */
  document.getElementById('btn-install-tb').addEventListener('click', function () {
    installRepo('reisxd/TizenBrew');
  });

  document.getElementById('btn-install-gh').addEventListener('click', function () {
    showNavHint('Install from GitHub');
    showScreen('github');
    setTimeout(function () { ghInput.focus(); }, 80);
  });

  document.getElementById('btn-back').addEventListener('click', function () {
    hideNavHint();
    showScreen('home');
  });
  
  /*  GitHub screen  */
  document.getElementById('gh-install-btn').addEventListener('click', function () {
    ghInstall();
  });

  function ghInstall() {
    var repo = ghInput.value.trim();
    if (!repo) return;
    installRepo(repo);
    //ghInput.value = ''; // could clear, but in case typo it is nicer to keep it.
    
    //hideNavHint();
    //showScreen('home');
  }

  function showNavHint(path) {
    navHint.textContent = path;
    navHint.classList.remove('hidden');
  }

  function hideNavHint() {
    navHint.classList.add('hidden');
    navHint.textContent = '';
    extraInfo.textContent = ''; // does not really fit here, but it should reset either way.
  }

  /*  Install helper  */
  function installRepo(repo) {
    showStatus('Preparing to install ' + repo + '...');
    server.get("/install", repo); // TODO WIP this is not correct and not how you do it over http
  }

  function addInfo(newInfo) {
    extraInfo.textContent += "<br>" + newInfo;
  }
  
  /*  Status / error / overlay UI  */
  function showStatus(msg) {
    statusBar.textContent = msg;
    statusBar.classList.remove('hidden');
  }

  function hideStatus() {
    statusBar.classList.add('hidden');
    statusBar.textContent = '';
  }

  function showError(msg) {
    errorBanner.textContent = msg;
    errorBanner.classList.remove('hidden');
    clearTimeout(App._errorTimer);
    App._errorTimer = setTimeout(hideError, 9000);
  }

  function hideError() {
    errorBanner.classList.add('hidden');
    errorBanner.textContent = '';
  }

  function showSigningOverlay() {
    var ip = '';
    try { ip = webapis.network.getIp(); } catch (e) { ip = 'localhost'; } 
    accessUrlEl.textContent = 'http://' + ip + ':4794';
    overlaySign.classList.remove('hidden');
  }

  function hideSigningOverlay() {
    overlaySign.classList.add('hidden');
  }

  // could check and then say update instead, but this is simpler for now
  // if(has TizenBrew or not) ...
  // tbLabel.textContent = 'Update TizenBrew';

  /*  Boot  */
  function init() { // not how you do it.
    applyFocus();
  };
  init();

  /*  Public API (called by bridge.js)  */
  return {
    showStatus:         showStatus,
    hideStatus:         hideStatus,
    showError:          showError,
    hideError:          hideError,
    showSigningOverlay: showSigningOverlay,
    hideSigningOverlay: hideSigningOverlay,
    addInfo:            addInfo
  };

})();


/* --- OTHER IRRELEVANT SCRAP BOOK --- */

// Here is a trick instead of using a web interface inside Tizen:
// This might not work, untested. Is this only for Node services, because this file is a web app.
function triggerServiceInstall(wgtUrl, samsungInfo) {
  const serviceId = "vo087TizenIn.InstallerService"; // From your config.xml

  // Package the data into Tizen-specific 'extra data'
  const data = [
    new tizen.ApplicationControlData("wgt_url", [wgtUrl]),
    new tizen.ApplicationControlData("email", [samsungInfo.email]),
    new tizen.ApplicationControlData("password", [samsungInfo.password])
  ];

  const appControl = new tizen.ApplicationControl(
    "http://tizen.org/appcontrol/operation/default",
    null, null, null, data
  );

  tizen.application.launchAppControl(
    appControl,
    serviceId,
    () => console.log("Service signaled!"),
    (err) => console.error("Failed to reach service: " + err.message)
  );
}

// Also here is something else
// maybe this privledge could be used instead of  wascmd or similar :
// http://tizen.org/privilege/packagemanager.install
