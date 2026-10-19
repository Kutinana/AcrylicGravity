// Loaded before the original Electron entry point. No preload or webPreferences changes.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const config = require('./package.json').acrylicGravity;

app.on('browser-window-created', (_event, window) => {
  const bundled = path.join(__dirname, 'dist', 'bootstrap.js');
  const external = process.env.ANTIGRAVITY_THEME_BOOTSTRAP || config.bootstrapPath;
  const target = external && fs.existsSync(external) ? external : bundled;
  const applyTheme = () => {
    if (window.isDestroyed()) return;
    // The Antigravity UI is served by its local host bridge. Skip remote content.
    let url;
    try { url = new URL(window.webContents.getURL()); } catch { return; }
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return;
    if (!['http:', 'https:'].includes(url.protocol)) return;
    try {
      window.webContents.executeJavaScript(fs.readFileSync(target, 'utf8'))
        .catch(error => console.warn('[AcrylicGravity]', error.message));
    } catch (error) {
      console.warn('[AcrylicGravity]', error.message);
    }
  };
  window.webContents.on('did-finish-load', applyTheme);
  fs.watchFile(target, { interval: 1000, persistent: false }, applyTheme);
  window.once('closed', () => fs.unwatchFile(target, applyTheme));
});

require(path.resolve(__dirname, config.originalMain));
