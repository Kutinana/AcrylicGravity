# AcrylicGravity

English | [简体中文](README_zh.md)

An acrylic (frosted-glass) theme patch for the Antigravity desktop app on Windows.

It brings multi-layered frosted glass backgrounds, translucent sidebars, restyled chat and dialog surfaces, and seamless Light/Dark mode adaptation. Wallpaper, blur, and reading-surface controls can be modified with built-in settings panel **Antigravity Settings → AcrylicGravity**.

| Dark Theme | Light Theme |
| :---: | :---: |
| ![AcrylicGravity Dark Theme](docs/dark-theme-preview.png) | ![AcrylicGravity Light Theme](docs/light-theme-preview.png) |

## Requirements

- **OS**: Windows
- **Runtime**: Node.js `22.12` or later (with `npm`)
- **App**: Antigravity desktop client (tested on `2.24.0`; default install location: `%LOCALAPPDATA%\Programs\antigravity`)

## Installation & Restore

Download or clone this repository first.

> [!IMPORTANT]
> 
> Installing or restoring will automatically close and restart Antigravity. Please save your work beforehand. You will need to reinstall the patch after Antigravity updates.

### Option 1: Folder Mode (Recommended)

Extracts the patched client into `resources\app` and backs up the original archive as `resources\app.asar.vanilla`. It installs quickly and automatically reloads changes if you rebuild the theme locally.

- **Install**: Double-click `install-via-folder.bat`
- **Restore**: Double-click `uninstall-folder.bat`

### Option 2: Archive Mode (`app.asar`)

Repacks the patched client directly into `resources\app.asar` (while still backing up the original as `resources\app.asar.vanilla`). Choose this if you plan to move or delete this repository folder after installation.

- **Install**: Double-click `install-permanent-patch.bat`
- **Restore**: Double-click `restore-original.bat`

### Custom Install Location

If Antigravity is installed outside the default path, run the installer script via PowerShell and pass your `resources` folder path:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-theme.ps1 -ResourcesPath "D:\Apps\Antigravity\resources"
```

*(Optional: append `-Mode Asar` for Archive Mode, or `-Mode Restore` to restore the original client.)*

## Development & Build

`style.css` and `injector.js` are the theme source files. Build them into the self-contained `bootstrap.js` bundle with:

```powershell
npm ci --ignore-scripts
npm run build
```

- **Live Reload**: Folder Mode watches `bootstrap.js` in this repo and reloads the theme automatically whenever you run `npm run build` (run `rebuild-theme.bat` if updating from an older install).
- **Local Dry-Run Build**: To generate the patched client files under `build/` without touching your installed Antigravity app:
  ```powershell
  npm run build:app
  node scripts/prepare-app.js --asar
  node scripts/prepare-app.js --source "D:\Backup\app.asar" --asar
  ```
- **Optional CDP Daemon**: If you prefer runtime injection without patching client files (requires an active `DevToolsActivePort`), use `start.bat` or `start-silent.vbs` to launch `daemon.js`, and `stop.bat` to stop it.
