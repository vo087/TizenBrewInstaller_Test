
// Note: There is no backtick in older Node.

function buildSignInPage(tvIp) { // Not sure about this web page, i don't think there are tabs in .WGT, and not sure you can even use "copy".
    return '<!DOCTYPE html><html><head>' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>TizenBrewInstaller - Sign in</title>' +
        '<style>' +
        'body{margin:0;padding:40px 20px;font-family:Arial,sans-serif;background:#0d1117;color:#e6edf3;max-width:520px;margin:0 auto;}' +
        'h2{margin-bottom:8px;}' +
        'p{color:#8b949e;margin-bottom:24px;line-height:1.5;}' +
        'a.btn{display:block;text-align:center;padding:14px;background:#1e68c9;color:white;text-decoration:none;border-radius:6px;font-size:16px;margin-bottom:32px;}' +
        'a.btn:hover{background:#2979d9;}' +
        'textarea{width:100%;box-sizing:border-box;padding:12px;background:#161b22;border:1px solid #30363d;border-radius:6px;color:#e6edf3;font-size:13px;font-family:monospace;resize:vertical;min-height:120px;}' +
        'textarea.valid{border-color:#3fb950;}' +
        'textarea.invalid{border-color:#f85149;}' +
        '#status{margin-top:12px;font-size:14px;min-height:20px;}' +
        '</style></head><body>' +

        '<h2>TizenBrew Sign-in</h2>' +
        '<p>Step 1: Click the button below to open Samsung Sign-in in a new tab. Log in, then copy the JSON text shown on the page.</p>' +
        '<a class="btn" href="https://account.samsung.com/accounts/TDC/signInGate?clientId=v285zxnl3h&tokenType=TOKEN" target="_blank">Open Samsung Sign-in ↗</a>' +
        '<p>Step 2: Paste the JSON here — it will be submitted automatically.</p>' +
        '<textarea id="json" placeholder=\'{"access_token":"...","userId":"...",...}\'></textarea>' +
        '<div id="status"></div>' +

        '<script>' +
        'var ta = document.getElementById("json");' +
        'var st = document.getElementById("status");' +
        'ta.addEventListener("input", function() {' +
        '  var val = ta.value.trim();' +
        '  if (!val) { ta.className=""; st.textContent=""; return; }' +
        '  try {' +
        '    var json = JSON.parse(val);' +
        '    if (!json.access_token || !json.userId) { ta.className="invalid"; st.textContent="Missing access_token or userId."; return; }' +
        '    ta.className="valid";' +
        '    st.textContent="Submitting...";' +
        '    fetch("/handle-auth", { method:"POST", headers:{"Content-Type":"application/json"}, body: val })' +
        '      .then(function(r){ return r.json(); })' +
        '      .then(function(r){ st.textContent = r.status === "success" ? "✓ Done! You can close this tab." : "Error: " + r.error; })' +
        '      .catch(function(e){ st.textContent = "Network error: " + e.message; });' +
        '  } catch(e) { ta.className="invalid"; st.textContent="Not valid JSON yet..."; }' +
        '});' +
        '</script></body></html>';
};
