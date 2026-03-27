// HTML page served on port 4794 (LAN) to the user's phone or PC browser.
// The user clicks to open Samsung sign-in, copies the JSON, pastes it here.
// After submission the service creates the cert and resumes the pending install.
//
// Node 10 / ES5: No backticks, no arrow functions, no const/let, etc

'use strict';

// tvIP is available for potential use (e.g. if we ever generate the QR on the TV side).
function buildSignInPage(tvIP) {
    // The sign-in URL to open (Samsung SSO -> returns JSON directly in the browser).
    // NOTE: clientId 'v285zxnl3h' may change - verify against current Tizen Studio if this stops working.
    // Find out at: https://github.com/sreyemnayr/tizencertificates/blob/main/tizencertificates/certtool.py
    var samsungSignInURL = 'https://account.samsung.com/accounts/TDC/signInGate?clientId=v285zxnl3h&tokenType=TOKEN';

    // The URL that was used to reach THIS page - i.e. http://tvIP:4794/
    // Used only as a reminder label; the fetch() below is relative so it always works.
    var thisPageUrl = 'http://' + tvIP + ':4794/';

    // QR code of the Samsung sign-in URL, loaded by the phone via internet (qrserver.com CDN).
    var qrImgURL = 'https://api.qrserver.com/v1/create-qr-code/?data=' +
        encodeURIComponent(samsungSignInURL) + '&size=200x200&margin=8';

    return '<!DOCTYPE html><html lang="en"><head>' +
        '<meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>TizenBrewInstaller - Samsung Sign-in / Auth</title>' +
        '<style>' +
            'html,body{margin:0;padding:0;background:#0d1117;color:#e6edf3;font-family:Arial,sans-serif;}' +
            'body{padding:32px 20px;max-width:480px;margin:0 auto;}' +
            'h2{margin:0 0 4px;font-size:20px;}' +
            '.sub{color:#8b949e;font-size:13px;margin-bottom:24px;}' +
            '.step-num{display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;' +
                'background:#1e68c9;border-radius:50%;font-size:12px;font-weight:bold;margin-right:8px;flex-shrink:0;}' +
            '.step{display:flex;align-items:flex-start;margin-bottom:8px;font-size:14px;}' +
            '.step p{margin:0;padding-top:2px;color:#c9d1d9;line-height:1.5;}' +
            '.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin:12px 0 20px;}' +
            '.qr-wrap{text-align:center;margin:12px 0 4px;}' +
            '.qr-wrap img{border-radius:4px;background:#fff;padding:4px;}' +
            '.qr-url{text-align:center;font-size:11px;color:#8b949e;word-break:break-all;margin-bottom:8px;}' +
            'a.btn{display:block;text-align:center;padding:13px;background:#1e68c9;color:#fff;' +
                'text-decoration:none;border-radius:6px;font-size:15px;font-weight:bold;}' +
            'a.btn:active{background:#1558a8;}' +
            'label{display:block;font-size:12px;color:#8b949e;margin-bottom:4px;}' +
            'input[type=email]{width:100%;box-sizing:border-box;padding:10px 12px;' +
                'background:#0d1117;border:1px solid #30363d;border-radius:6px;' +
                'color:#e6edf3;font-size:14px;margin-bottom:12px;}' +
            'textarea{width:100%;box-sizing:border-box;padding:12px;' +
                'background:#0d1117;border:1px solid #30363d;border-radius:6px;' +
                'color:#e6edf3;font-size:13px;font-family:monospace;resize:vertical;min-height:100px;}' +
            'textarea.valid{border-color:#3fb950;}' +
            'textarea.invalid{border-color:#f85149;}' +
            '#status{margin-top:10px;font-size:14px;min-height:18px;line-height:1.5;}' +
            '#status.ok{color:#3fb950;}' +
            '#status.err{color:#f85149;}' +
        '</style></head><body>' +

        '<h2>TizenBrewInstaller - Samsung Sign-in</h2>' +
        '<p class="sub">Required to install apps on Tizen 7+. This page is served by your TV (' + thisPageUrl + ').</p>' +

        // Open Samsung sign-in
        '<div class="step"><span class="step-num">1</span>' +
        '<p>Open Samsung sign-in. After logging in, Samsung will display a page of JSON text <strong>copy all of it</strong>.</p></div>' +
        '<div class="card">' +
            '<div class="qr-wrap"><img src="' + qrImgURL + '" width="200" height="200" alt="QR code for Samsung sign-in" onerror="this.style.display=\'none\'"/></div>' +
            '<p class="qr-url">Or tap: <a href="' + samsungSignInURL + '" style="color:#58a6ff;" target="_blank">Samsung Sign-in </a></p>' +
            '<a class="btn" href="' + samsungSignInURL + '" target="_blank">Open Samsung Sign-in</a>' +
        '</div>' +

        // Paste JSON
        '<div class="step"><span class="step-num">3</span>' +
        '<p>Paste the JSON from the Samsung page below it will submit automatically once valid.</p></div>' +
        '<label for="json">Samsung account JSON</label>' +
        '<textarea id="json" placeholder=\'{"access_token":"...","userId":"...","tokenType":"TOKEN",...}\'></textarea>' +
        '<div id="status" role="status" aria-live="polite"></div>' +

        '<script>' +
        '(function() {' +
            'var ta = document.getElementById("json");' +
            'var st = document.getElementById("status");' +
            'var submitted = false;' +

            'function setStatus(msg, cls) {' +
                'st.textContent = msg;' +
                'st.className = cls || "";' +
            '}' +

            'ta.addEventListener("input", function() {' +
                'if (submitted) return;' +
                'var val = ta.value.trim();' +
                'if (!val) { ta.className = ""; setStatus(""); return; }' +
                'var json;' +
                'try { json = JSON.parse(val); }' +
                'catch(e) { ta.className = "invalid"; setStatus("Not valid JSON yet"); return; }' +
                'if (!json.access_token) { ta.className = "invalid"; setStatus("Missing \\"access_token\\" field."); return; }' +
                'if (!json.userId)       { ta.className = "invalid"; setStatus("Missing \\"userId\\" field."); return; }' +

                'ta.className = "valid";' +
                'setStatus("Submitting");' +
                'submitted = true;' +

                'var email = document.getElementById("email").value.trim();' +
                'if (email) json.email = email;' +

                'fetch("/submit-auth", {' +
                    'method: "POST",' +
                    'headers: { "Content-Type": "application/json" },' +
                    'body: JSON.stringify(json)' +
                '})' +
                '.then(function(r) { return r.json(); })' +
                '.then(function(r) {' +
                    'if (r.status === "success") {' +
                        'setStatus("Submitted! The TV is creating the certificate. You can close this tab.", "ok");' +
                    '} else {' +
                        'submitted = false;' +
                        'setStatus("Error: " + (r.error || "unknown error"), "err");' +
                    '}' +
                '})' +
                '.catch(function(e) {' +
                    'submitted = false;' +
                    'setStatus("Network error: " + e.message, "err");' +
                '});' +
            '});' +
        '})();' +
        '</script></body></html>';
}

module.exports = { buildSignInPage: buildSignInPage };
