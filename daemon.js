// ============================================================================
// Antigravity Theme Patch Daemon (Windows)
// Manages CDP connection, dynamic hot injection, and auto-healing
// ============================================================================

const fs = require('fs');
const path = require('path');
const { version } = require('./package.json');

const PATCH_DIR = __dirname;
const LOG_FILE = path.join(PATCH_DIR, 'daemon.log');
const PORT_FILE = path.join(process.env.APPDATA, 'Antigravity', 'DevToolsActivePort');
const STYLE_FILE = path.join(PATCH_DIR, 'style.css');
const DATAURL_FILE = path.join(PATCH_DIR, 'assets', 'background.dataurl.txt');
const INJECTOR_FILE = path.join(PATCH_DIR, 'injector.js');

let activeWs = null;
let newDocumentScriptId = null;

function log(msg, ...args) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [AG-Daemon] ${msg} ${args.length ? JSON.stringify(args) : ''}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line, 'utf-8');
  } catch (e) {}
  try {
    if (process.stdout && process.stdout.write) {
      process.stdout.write(line);
    }
  } catch (e) {}
}

process.on('uncaughtException', (err) => {
  log('Uncaught Exception:', err.stack || err.message);
});

process.on('unhandledRejection', (reason) => {
  log('Unhandled Rejection:', reason && reason.stack ? reason.stack : reason);
});

function getPort() {
  try {
    if (!fs.existsSync(PORT_FILE)) return null;
    const content = fs.readFileSync(PORT_FILE, 'utf-8');
    const port = content.split('\n')[0].trim();
    return port ? parseInt(port, 10) : null;
  } catch (err) {
    return null;
  }
}

function getPayloadCode() {
  const css = fs.readFileSync(STYLE_FILE, 'utf-8');
  let dataUri = '';
  if (fs.existsSync(DATAURL_FILE)) {
    dataUri = fs.readFileSync(DATAURL_FILE, 'utf-8').trim();
  }
  const injector = fs.readFileSync(INJECTOR_FILE, 'utf-8');

  return `
    window.__AG_VERSION = ${JSON.stringify(version)};
    window.__AG_BG_DATA_URI = ${JSON.stringify(dataUri)};
    window.__AG_CSS_CONTENT = ${JSON.stringify(css)};
    ${injector}
  `;
}

async function getPageTarget(port) {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/json`);
    if (!resp.ok) return null;
    const targets = await resp.json();
    return targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  } catch (err) {
    return null;
  }
}

function cdpSend(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 10000000);
    const timeout = setTimeout(() => {
      ws.removeEventListener('message', handler);
      reject(new Error(`CDP command timeout: ${method}`));
    }, 5000);

    const handler = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.id === id) {
          clearTimeout(timeout);
          ws.removeEventListener('message', handler);
          if (data.error) {
            reject(new Error(data.error.message || 'CDP Error'));
          } else {
            resolve(data.result);
          }
        }
      } catch (e) {}
    };

    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function inject(ws) {
  const code = getPayloadCode();

  // 1. Persistent injection on new document load (deduplicated)
  try {
    if (newDocumentScriptId) {
      await cdpSend(ws, 'Page.removeScriptToEvaluateOnNewDocument', { identifier: newDocumentScriptId }).catch(() => {});
    }
    const addRes = await cdpSend(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: code });
    newDocumentScriptId = addRes.identifier;
    log('Registered persistent Page script with ID:', newDocumentScriptId);
  } catch (err) {
    log('Notice: Page.addScriptToEvaluateOnNewDocument skipped:', err.message);
  }

  // 2. Immediate live injection
  const evalRes = await cdpSend(ws, 'Runtime.evaluate', {
    expression: code,
    returnByValue: true
  });
  log('Live injection completed:', evalRes.result ? evalRes.result.value : evalRes);
}

let lastCssMtime = 0;
let lastInjectorMtime = 0;
let lastBackgroundMtime = 0;

async function checkHealth(ws) {
  let cssMtime = 0;
  let injMtime = 0;
  let backgroundMtime = 0;
  try {
    cssMtime = fs.statSync(STYLE_FILE).mtimeMs;
    injMtime = fs.statSync(INJECTOR_FILE).mtimeMs;
    if (fs.existsSync(DATAURL_FILE)) backgroundMtime = fs.statSync(DATAURL_FILE).mtimeMs;
  } catch (e) {}

  if (cssMtime !== lastCssMtime || injMtime !== lastInjectorMtime || backgroundMtime !== lastBackgroundMtime) {
    lastCssMtime = cssMtime;
    lastInjectorMtime = injMtime;
    lastBackgroundMtime = backgroundMtime;
    return false; // trigger re-injection on CSS or injector modification
  }

  const checkRes = await cdpSend(ws, 'Runtime.evaluate', {
    expression: `Boolean(document.getElementById('ag-theme-patch-style') && document.getElementById('ag-custom-bg'))`,
    returnByValue: true
  });
  return checkRes?.result?.value === true;
}

async function connect() {
  const port = getPort();
  if (!port) {
    return false;
  }

  const target = await getPageTarget(port);
  if (!target) {
    return false;
  }

  log(`Discovered Antigravity on port ${port}, connecting to page: "${target.title}"`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  activeWs = ws;
  newDocumentScriptId = null;

  ws.onclose = () => {
    log('CDP WebSocket disconnected.');
    activeWs = null;
    newDocumentScriptId = null;
  };

  ws.onerror = (e) => {
    log('CDP WebSocket error:', e.message || e);
  };

  await inject(ws);
  return true;
}

// --- Main Supervisory Loop ---
async function supervise() {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN) {
    try {
      await connect();
    } catch (err) {
      // Antigravity not ready yet, continue polling
    }
  } else {
    try {
      const isHealthy = await checkHealth(activeWs);
      if (!isHealthy) {
        log('Health check failed (styles missing or outdated). Performing re-injection...');
        await inject(activeWs);
      }
    } catch (err) {
      log('Health check error, closing connection:', err.message);
      try { activeWs.close(); } catch (e) {}
      activeWs = null;
    }
  }
}

log('Antigravity Theme Patch Daemon started.');
setInterval(supervise, 3000);
supervise();
