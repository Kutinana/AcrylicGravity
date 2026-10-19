// ============================================================================
// Antigravity Theme Patch: Injector Core Logic
// Injected into Chromium Renderer via Chrome DevTools Protocol (CDP)
// Includes: Dynamic Settings UI, Custom Wallpaper, Opacity/Blur/Position Controls
// ============================================================================

(function () {
  const PATCH_VERSION = window.__AG_VERSION || 'dev';

  // --- 0. Theme Configuration Storage ---
  function getThemeConfig() {
    try {
      const config = JSON.parse(localStorage.getItem('ag_theme_config') || '{}');
      return config && typeof config === 'object' && !Array.isArray(config) ? config : {};
    } catch (e) {
      return {};
    }
  }

  function saveThemeConfig(patch) {
    try {
      const cur = getThemeConfig();
      const updated = { ...cur, ...patch };
      localStorage.setItem('ag_theme_config', JSON.stringify(updated));
      return updated;
    } catch (e) {
      console.warn('[AG-Theme] Failed to save config to localStorage:', e);
      return {};
    }
  }

  const READING_DEFAULTS = {
    light: { color: '#ffffff', opacity: 70 },
    dark: { color: '#10141e', opacity: 0 }
  };

  function currentThemeMode() {
    return document.body.matches('.theme-light, .light') ? 'light' : 'dark';
  }

  function getReadingConfig(mode = currentThemeMode()) {
    const saved = getThemeConfig().reading?.[mode];
    const defaults = READING_DEFAULTS[mode];
    return {
      color: /^#[0-9a-f]{6}$/i.test(saved?.color) ? saved.color.toLowerCase() : defaults.color,
      opacity: typeof saved?.opacity === 'number' && Number.isFinite(saved.opacity)
        ? Math.min(100, Math.max(0, saved.opacity)) : defaults.opacity
    };
  }

  function applyReadingConfig(config = getReadingConfig()) {
    const rgb = config.color.slice(1).match(/../g).map(channel => parseInt(channel, 16)).join(', ');
    document.body.style.setProperty('--ag-reading-rgb', rgb);
    document.body.style.setProperty('--ag-reading-opacity', String(config.opacity / 100));
    const color = document.getElementById('ag-reading-color');
    const colorLabel = document.getElementById('ag-reading-color-value');
    const opacity = document.getElementById('ag-range-reading-opacity');
    const opacityLabel = document.getElementById('ag-label-reading-opacity');
    const modeLabel = document.getElementById('ag-reading-mode');
    if (color) color.value = config.color;
    if (colorLabel) colorLabel.value = config.color.toUpperCase();
    if (opacity) opacity.value = config.opacity;
    if (opacityLabel) opacityLabel.value = `${config.opacity}%`;
    if (modeLabel) modeLabel.textContent = `${currentThemeMode() === 'light' ? '浅色' : '暗色'}主题的正文底色，独立保存。`;
  }

  // --- 1. Background Image & Dynamic Layer ---
  function ensureBackgroundLayer() {
    let bgEl = document.getElementById("ag-custom-bg");
    if (!bgEl) {
      bgEl = document.createElement("div");
      bgEl.id = "ag-custom-bg";
      document.body.prepend(bgEl);
    }

    const cfg = getThemeConfig();
    const bgUrl = (cfg.bgUrl !== undefined) ? cfg.bgUrl : (window.__AG_BG_DATA_URI || 'none');
    const hasBg = bgUrl && bgUrl !== 'none';
    const opacity = cfg.opacity !== undefined ? (cfg.opacity / 100) : 0.40;
    const blur = cfg.blur !== undefined ? cfg.blur : 0;
    const position = cfg.position || "center";

    bgEl.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: calc(100vw + 380px);
      height: 100vh;
      z-index: 0;
      display: ${hasBg ? 'block' : 'none'};
      background-image: ${hasBg ? `url("${bgUrl}")` : 'none'};
      background-size: cover;
      background-position: ${position};
      background-repeat: no-repeat;
      pointer-events: none;
      opacity: ${opacity};
      filter: blur(${blur}px) brightness(var(--ag-bg-brightness, 0.88)) saturate(1.05) contrast(1.02);
      transition: transform var(--ag-pane-duration, 380ms) var(--ag-pane-ease, cubic-bezier(0.22, 0.8, 0.25, 1.04)), opacity 0.2s ease, filter 0.2s ease;
    `;

    // Clean up any legacy gradient mask if present in DOM
    const oldMask = document.getElementById("ag-gradient-mask");
    if (oldMask) oldMask.remove();

    function updateAuxPush() {
      // The pane's state is authoritative. Reading its geometry on every style
      // mutation forced layout while the native split animation was running.
      const isAuxOpen = !!document.querySelector('[data-aux-pane-open="true"]');

      if (bgEl) {
        const transform = isAuxOpen ? 'translateX(-380px)' : 'translateX(0px)';
        if (bgEl.style.transform !== transform) bgEl.style.transform = transform;
      }
    }

    updateAuxPush();

    if (window.__ag_mask_interval) {
      clearInterval(window.__ag_mask_interval);
      window.__ag_mask_interval = null;
    }
    if (window.__ag_aux_observer) {
      window.__ag_aux_observer.disconnect();
    }

    const containsPane = node => node.nodeType === Node.ELEMENT_NODE &&
      (node.matches('[data-aux-pane-open]') || node.querySelector('[data-aux-pane-open]'));
    const auxObs = new MutationObserver(records => {
      if (records.some(record => record.type === 'attributes' ||
        [...record.addedNodes, ...record.removedNodes].some(containsPane))) {
        updateAuxPush();
      }
    });
    auxObs.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ['data-aux-pane-open']
    });
    window.__ag_aux_observer = auxObs;
  }

  // The menu, sidebar and page toolbar share one tint and blur sample at their
  // meeting point. Native nodes stay put; reading surfaces receive a light veil.
  function installChromeGlass() {
    window.__ag_chrome_cleanup?.();
    const titleSelector = '[data-testid="title-menu-bar"]';
    const sidebarSelector = 'div.h-full.w-full.flex.flex-col.pb-2.bg-sidebar';
    const toolbarSelector = 'div.flex-1.flex.flex-col > div.shrink-0:has(> [class*="select-none items-center justify-between"]), div.shrink-0[style*="height: 40px"]:has(> [class*="select-none items-center justify-between"])';
    const anchors = `${titleSelector}, ${sidebarSelector}, ${toolbarSelector}`;
    let title = null;
    let sidebar = null;
    let sidebarSlot = null;
    let toolbars = [];
    let glass = null;
    let frame = 0;
    const marked = new Set();
    const readingSurfaces = new Set();
    const resize = new ResizeObserver(scheduleSync);

    function scheduleSync() {
      if (!frame) frame = requestAnimationFrame(sync);
    }
    function sync() {
      frame = 0;
      if (!title?.isConnected || !glass) return;
      const titleBottom = title.getBoundingClientRect().bottom;
      const toolbarRects = toolbars.map(toolbar => toolbar.getBoundingClientRect())
        .filter(rect => rect.width && Math.abs(rect.top - titleBottom) <= 1);
      const top = Math.max(titleBottom, ...toolbarRects.map(rect => rect.bottom));
      const slot = sidebarSlot?.getBoundingClientRect();
      const side = sidebar?.getBoundingClientRect();
      let right = slot?.width && side?.width ? Math.max(0, Math.min(slot.right, side.right)) : 0;
      // Cover the native splitter gutter too, up to the actual content edge.
      const adjoining = toolbarRects.filter(rect => rect.left >= right && rect.left - right <= 8)
        .sort((a, b) => a.left - b.left)[0];
      if (right && adjoining) right = adjoining.left;
      glass.style.setProperty('--ag-chrome-top', `${top}px`);
      glass.style.setProperty('--ag-chrome-left', `${right}px`);
      glass.style.setProperty('--ag-chrome-sidebar-alpha', right ? '1' : '0');
    }
    function refresh() {
      resize.disconnect();
      for (const element of marked) element.removeAttribute('data-ag-chrome-surface');
      marked.clear();
      for (const element of readingSurfaces) element.removeAttribute('data-ag-reading-surface');
      readingSurfaces.clear();
      title = document.querySelector(titleSelector);
      sidebar = document.querySelector(sidebarSelector);
      sidebarSlot = sidebar?.parentElement?.parentElement;
      toolbars = [...document.querySelectorAll(toolbarSelector)]
        .filter(element => !element.closest('.settings-modal-container'));
      if (!title) { glass?.remove(); glass = null; return; }
      if (!glass) {
        glass = document.createElement('div');
        glass.id = 'ag-chrome-glass';
        glass.setAttribute('aria-hidden', 'true');
        document.getElementById('ag-custom-bg').after(glass);
      }
      for (const [element, name] of [[title, 'title'], [sidebar, 'sidebar'], ...toolbars.map(element => [element, 'toolbar'])]) {
        if (!element) continue;
        element.setAttribute('data-ag-chrome-surface', name);
        marked.add(element);
        resize.observe(element);
      }
      for (const toolbar of toolbars) {
        const content = toolbar.nextElementSibling;
        if (content) {
          content.setAttribute('data-ag-reading-surface', '');
          readingSurfaces.add(content);
        }
      }
      if (sidebarSlot) resize.observe(sidebarSlot);
      sync();
    }
    const containsChrome = node => node.nodeType === Node.ELEMENT_NODE &&
      (node.matches(anchors) || node.querySelector(anchors));
    const observer = new MutationObserver(records => {
      if (!title?.isConnected || [...marked, ...readingSurfaces].some(element => !element.isConnected) ||
        records.some(record => [...record.addedNodes, ...record.removedNodes].some(containsChrome))) refresh();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', scheduleSync);
    window.__ag_chrome_cleanup = () => {
      observer.disconnect();
      resize.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleSync);
      for (const element of marked) element.removeAttribute('data-ag-chrome-surface');
      for (const element of readingSurfaces) element.removeAttribute('data-ag-reading-surface');
      glass?.remove();
    };
    refresh();
  }

  // --- 2. Custom CSS Stylesheet (#ag-theme-patch-style) ---
  function ensureStyleElement() {
    let style = document.getElementById("ag-theme-patch-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "ag-theme-patch-style";
    }
    document.head.appendChild(style);
    if (window.__AG_CSS_CONTENT) {
      style.textContent = window.__AG_CSS_CONTENT;
    }
  }

  // Keep the accelerated column motion local to a single, sufficiently wide
  // conversation. Narrow windows and multi-chat splits retain native sizing.
  function installConversationMotion() {
    window.__ag_motion_cleanup?.();
    let marked = null;
    let observed = null;
    let observedPane = null;
    const resize = new ResizeObserver(sync);
    function sync() {
      const views = [...document.querySelectorAll('[data-testid="conversation-view"]')];
      const aux = document.querySelector('[data-aux-pane-open]');
      const fixedPane = aux?.parentElement?.parentElement;
      const splitter = fixedPane?.parentElement?.parentElement;
      if (splitter !== observed || fixedPane !== observedPane) {
        resize.disconnect();
        observed = splitter;
        observedPane = fixedPane;
        if (observed) resize.observe(observed);
        if (observedPane) resize.observe(observedPane);
      }
      let next = null;
      if (views.length === 1 && fixedPane && splitter) {
        const width = getComputedStyle(views[0]).getPropertyValue('--max-conversation-width').trim();
        const match = /^(\d+(?:\.\d+)?)(px|rem)$/.exec(width || '48rem');
        if (match) {
          const preferred = Math.max(innerWidth * 0.3, Number(match[1]) *
            (match[2] === 'rem' ? parseFloat(getComputedStyle(document.documentElement).fontSize) : 1));
          const available = splitter.clientWidth - fixedPane.clientWidth - 33;
          if (available >= preferred) next = views[0];
        }
      }
      if (marked !== next) {
        marked?.removeAttribute('data-ag-motion-column');
        marked = next;
        marked?.setAttribute('data-ag-motion-column', '');
      }
    }
    const concernsLayout = node => node.nodeType === Node.ELEMENT_NODE &&
      (node.matches('[data-aux-pane-open], [data-testid="conversation-view"]') ||
        node.querySelector('[data-aux-pane-open], [data-testid="conversation-view"]'));
    const observer = new MutationObserver(records => {
      if (records.some(record => record.type === 'attributes' ||
        [...record.addedNodes, ...record.removedNodes].some(concernsLayout))) sync();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['data-aux-pane-open'] });
    window.__ag_motion_cleanup = () => {
      observer.disconnect();
      resize.disconnect();
      marked?.removeAttribute('data-ag-motion-column');
    };
    sync();
  }

  // Scope the shared library-page palette to actual page roots, including
  // client-side route changes, without broad selectors over the chat tree.
  function installLibraryPages() {
    window.__ag_library_cleanup?.();
    const marked = new Set();
    const anchors = '[data-testid="history-search-input"], [data-testid="sidecars-view"], [data-testid="sidecar-detail"], [data-testid="customizations-search"]';
    function sync() {
      const roots = new Map();
      const history = document.querySelector('[data-testid="history-search-input"]')?.closest('.max-w-2xl');
      const customizations = document.querySelector('[data-testid="customizations-search"]')?.closest('.sticky')?.parentElement;
      if (history) roots.set(history, 'history');
      if (customizations) roots.set(customizations, 'customizations');
      for (const id of ['sidecars-view', 'sidecar-detail']) {
        const root = document.querySelector(`[data-testid="${id}"]`);
        if (root) roots.set(root, id);
      }
      for (const root of marked) {
        if (!roots.has(root)) {
          root.removeAttribute('data-ag-library-page');
          marked.delete(root);
        }
      }
      for (const [root, name] of roots) {
        if (root.getAttribute('data-ag-library-page') !== name) root.setAttribute('data-ag-library-page', name);
        marked.add(root);
      }
    }
    const containsPage = node => node.nodeType === Node.ELEMENT_NODE &&
      (node.matches(anchors) || node.querySelector(anchors));
    const observer = new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(containsPage))) sync();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.__ag_library_cleanup = () => {
      observer.disconnect();
      for (const root of marked) root.removeAttribute('data-ag-library-page');
    };
    sync();
  }

  // The backdrop's forwards-filled opacity animation is a backdrop root even
  // after it finishes. A blur inside it cannot sample the underlying app. Keep
  // the glass immediately BEFORE that root, without changing the backdrop or
  // moving React-owned nodes. Only the settings panel's bounds are blurred.
  function installSettingsAcrylicPlate() {
    if (window.__ag_settings_acrylic_cleanup) {
      window.__ag_settings_acrylic_cleanup();
    }

    let dialog = null;
    let backdrop = null;
    let plate = null;
    let frame = 0;
    const resizeObserver = new ResizeObserver(scheduleSync);
    const stateObserver = new MutationObserver(scheduleSync);

    function clearPlate() {
      resizeObserver.disconnect();
      stateObserver.disconnect();
      if (plate) plate.remove();
      dialog = backdrop = plate = null;
    }

    function scheduleSync() {
      if (!frame) frame = requestAnimationFrame(syncPlate);
    }

    function syncPlate() {
      frame = 0;
      if (!dialog || !dialog.isConnected || !backdrop.isConnected) {
        clearPlate();
        return;
      }

      const rect = dialog.getBoundingClientRect();
      const panelStyle = getComputedStyle(dialog);
      const backdropStyle = getComputedStyle(backdrop);
      const values = {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        borderRadius: panelStyle.borderRadius,
        opacity: String(Number(panelStyle.opacity) * Number(backdropStyle.opacity)),
        zIndex: backdropStyle.zIndex,
        visibility: rect.width && rect.height ? panelStyle.visibility : 'hidden'
      };
      for (const [key, value] of Object.entries(values)) {
        if (plate.style[key] !== value) plate.style[key] = value;
      }

      // Track the actual animated bounds; stop reading layout once settled.
      if ([...dialog.getAnimations(), ...backdrop.getAnimations()]
        .some(animation => animation.playState === 'running' || animation.pending)) {
        scheduleSync();
      }
    }

    function findDialog() {
      const next = document.querySelector('.settings-modal-container[role="dialog"]');
      if (next === dialog) return;
      clearPlate();
      if (!next) return;

      dialog = next;
      backdrop = dialog.closest('.settings-modal-backdrop') || dialog.parentElement;
      plate = document.createElement('div');
      plate.id = 'ag-settings-acrylic-plate';
      plate.setAttribute('aria-hidden', 'true');
      backdrop.before(plate);
      resizeObserver.observe(dialog);
      const stateOptions = { attributes: true, attributeFilter: ['class', 'style', 'data-closed', 'data-ending-style'] };
      stateObserver.observe(dialog, stateOptions);
      stateObserver.observe(backdrop, stateOptions);
      scheduleSync();
    }

    function onAnimation(event) {
      if (event.target === dialog || event.target === backdrop) scheduleSync();
    }

    const observer = new MutationObserver(findDialog);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', scheduleSync);
    document.addEventListener('scroll', scheduleSync, true);
    document.addEventListener('animationstart', onAnimation, true);
    document.addEventListener('animationend', onAnimation, true);
    document.addEventListener('animationcancel', onAnimation, true);
    window.__ag_settings_acrylic_cleanup = () => {
      observer.disconnect();
      clearPlate();
      cancelAnimationFrame(frame);
      frame = 0;
      window.removeEventListener('resize', scheduleSync);
      document.removeEventListener('scroll', scheduleSync, true);
      document.removeEventListener('animationstart', onAnimation, true);
      document.removeEventListener('animationend', onAnimation, true);
      document.removeEventListener('animationcancel', onAnimation, true);
    };
    findDialog();
  }

  // --- 3. Settings Modal Integration (Theme & Wallpaper Tab) ---
  function installSettingsThemeUI() {
    const previous = document.getElementById('ag-theme-settings-view');
    let reopen = previous && previous.style.display !== 'none';
    window.__ag_settings_ui_cleanup?.();
    window.__ag_settings_ui_observer?.disconnect();
    const bindings = new Map();
    function checkAndInject() {
      for (const [dialog, cleanup] of bindings) {
        if (!dialog.isConnected || !cleanup.view.isConnected || !cleanup.nav.isConnected || !cleanup.nativePane.isConnected) {
          if (dialog.isConnected && cleanup.view.style.display !== 'none') reopen = true;
          cleanup(); bindings.delete(dialog);
        }
      }
      const dialog = document.querySelector('.settings-modal-container[role="dialog"]');
      if (!dialog || bindings.has(dialog)) return;
      const main = dialog.querySelector('.flex-1.min-h-0.w-full > div');
      if (!main || main.children.length < 2) return;
      const [sidebar, nativePane] = main.children;
      const appearance = sidebar.querySelector('[data-testid="settings-nav-item-Appearance"]');
      if (!appearance) return;
      const previousView = dialog.querySelector('#ag-theme-settings-view');
      const wasOpen = previousView && previousView.style.display !== 'none';
      dialog.querySelector('#ag-settings-nav-theme')?.remove();
      previousView?.remove();
      const nativeDisplay = nativePane.style.display === 'none' ? '' : nativePane.style.display;
      nativePane.style.display = nativeDisplay;
      const nav = document.createElement('button');
      nav.id = 'ag-settings-nav-theme';
      nav.type = 'button';
      nav.className = appearance.className.replace('bg-sidebar-secondary', 'hover:bg-sidebar-muted');
      nav.setAttribute('aria-controls', 'ag-theme-settings-view');
      nav.setAttribute('aria-expanded', 'false');
      nav.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1.5 1.5 0 0 1 .8-2.8H17a4 4 0 0 0 4-4C21 6.4 17 3 12 3Z"/><circle cx="7.5" cy="10" r=".8"/><circle cx="11" cy="6.5" r=".8"/><circle cx="16" cy="8" r=".8"/></svg><span class="text-sm select-none truncate flex-1">AcrylicGravity</span>`;
      appearance.after(nav);
      const view = document.createElement('div');
      view.id = 'ag-theme-settings-view';
      view.style.display = 'none';
      view.innerHTML = `
        <div class="ag-settings-content">
          <header class="ag-settings-header"><h2>AcrylicGravity</h2><p>自定义背景图片和亚克力效果</p></header>
          <div class="ag-settings-sections">
            <section aria-labelledby="ag-wallpaper-heading">
              <h3 id="ag-wallpaper-heading">背景图片</h3>
              <div class="ag-settings-group">
                <div class="ag-settings-row">
                  <div class="ag-setting-copy"><label for="ag-file-input">本地图片</label><p>选择图片，或将图片拖放到下方区域。</p></div>
                  <div class="ag-settings-actions"><button type="button" id="ag-btn-pick" class="ag-settings-button">选择图片…</button><button type="button" id="ag-btn-clear-bg" class="ag-settings-button">清除</button></div>
                </div>
                <div class="ag-wallpaper-fields">
                  <input type="file" id="ag-file-input" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
                  <button type="button" id="ag-dropzone" aria-label="选择或拖放背景图片"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg><span>点击选择或拖放图片</span><span class="ag-settings-hint">PNG、JPG、WebP、GIF</span></button>
                </div>
                <div class="ag-settings-row ag-url-row">
                  <div class="ag-setting-copy"><label for="ag-url-input">网络图片</label><p>使用图片的 HTTP 或 HTTPS 地址。</p></div>
                  <div class="ag-settings-actions ag-url-controls"><input type="url" id="ag-url-input" placeholder="https://…" autocomplete="off" spellcheck="false" /><button type="button" id="ag-btn-load-url" class="ag-settings-button">加载</button></div>
                </div>
              </div>
            </section>
            <section aria-labelledby="ag-effects-heading">
              <h3 id="ag-effects-heading">显示效果</h3>
              <div class="ag-settings-group">
                <div class="ag-settings-row"><div class="ag-setting-copy"><label for="ag-range-opacity">不透明度</label><p>调整背景图片的显示强度。</p></div><div class="ag-range-control"><input type="range" id="ag-range-opacity" min="5" max="100" aria-describedby="ag-label-opacity" /><output id="ag-label-opacity" for="ag-range-opacity"></output></div></div>
                <div class="ag-settings-row"><div class="ag-setting-copy"><label for="ag-range-blur">模糊程度</label><p>0 px 保持原图清晰，数值越大越柔和。</p></div><div class="ag-range-control"><input type="range" id="ag-range-blur" min="0" max="30" aria-describedby="ag-label-blur" /><output id="ag-label-blur" for="ag-range-blur"></output></div></div>
                <div class="ag-settings-row"><div class="ag-setting-copy"><label id="ag-position-label" for="ag-position">图片位置</label><p>设置背景图片的对齐方向。</p></div><button type="button" id="ag-position" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="ag-position-listbox" aria-labelledby="ag-position-label ag-position-value"><span id="ag-position-value"></span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button></div>
              </div>
            </section>
            <section aria-labelledby="ag-reading-heading">
              <div class="ag-settings-section-heading"><h3 id="ag-reading-heading">阅读底色</h3><button type="button" id="ag-reading-reset" class="ag-settings-button">恢复默认</button></div>
              <div class="ag-settings-group">
                <div class="ag-settings-row"><div class="ag-setting-copy"><label for="ag-reading-color">底色颜色</label><p id="ag-reading-mode"></p></div><div class="ag-settings-actions"><input type="color" id="ag-reading-color" /><output id="ag-reading-color-value" for="ag-reading-color"></output></div></div>
                <div class="ag-settings-row"><div class="ag-setting-copy"><label for="ag-range-reading-opacity">底色不透明度</label><p>0% 关闭正文底色，100% 完全遮住壁纸。</p></div><div class="ag-range-control"><input type="range" id="ag-range-reading-opacity" min="0" max="100" aria-describedby="ag-label-reading-opacity" /><output id="ag-label-reading-opacity" for="ag-range-reading-opacity"></output></div></div>
              </div>
            </section>
          </div>
          <p id="ag-settings-status" class="ag-settings-status" role="status" aria-live="polite"></p>
        </div>`;
      main.append(view);
      const find = selector => view.querySelector(selector);
      const cfg = getThemeConfig();
      const bg = document.getElementById('ag-custom-bg');
      const fileInput = find('#ag-file-input');
      const dropzone = find('#ag-dropzone');
      const urlInput = find('#ag-url-input');
      const status = find('#ag-settings-status');
      const versionLabel = `AcrylicGravity v${PATCH_VERSION}`;
      status.textContent = versionLabel;
      const currentBg = cfg.bgUrl ?? window.__AG_BG_DATA_URI ?? 'none';
      if (/^https?:\/\//i.test(currentBg)) urlInput.value = currentBg;
      function persist(patch) {
        const saved = saveThemeConfig(patch);
        status.textContent = Object.keys(patch).every(key => saved[key] === patch[key])
          ? versionLabel : '更改已生效，但无法保存。请尝试较小的图片或网络地址。';
      }
      function saveReading(patch) {
        const mode = currentThemeMode();
        const updated = { ...getReadingConfig(mode), ...patch };
        const reading = getThemeConfig().reading;
        applyReadingConfig(updated);
        persist({ reading: { ...(reading && typeof reading === 'object' ? reading : {}), [mode]: updated } });
      }
      find('#ag-reading-color').oninput = event => saveReading({ color: event.target.value });
      find('#ag-range-reading-opacity').oninput = event => saveReading({ opacity: Number(event.target.value) });
      find('#ag-reading-reset').onclick = () => saveReading(READING_DEFAULTS[currentThemeMode()]);
      applyReadingConfig();
      function applyImage(url) {
        if (bg) {
          bg.style.display = url === 'none' ? 'none' : 'block';
          bg.style.backgroundImage = url === 'none' ? 'none' : `url(${JSON.stringify(url)})`;
        }
        persist({ bgUrl: url });
      }
      function readImage(file) {
        if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { status.textContent = '请选择 PNG、JPG、WebP 或 GIF 图片。'; return; }
        const reader = new FileReader();
        reader.onload = () => { applyImage(reader.result); urlInput.value = ''; };
        reader.onerror = () => { status.textContent = '无法读取图片，请重新选择。'; };
        reader.readAsDataURL(file);
      }
      find('#ag-btn-pick').onclick = () => fileInput.click();
      dropzone.onclick = () => fileInput.click();
      fileInput.onchange = () => { readImage(fileInput.files[0]); fileInput.value = ''; };
      dropzone.ondragover = event => { event.preventDefault(); dropzone.classList.add('ag-drag-over'); };
      dropzone.ondragleave = () => dropzone.classList.remove('ag-drag-over');
      dropzone.ondrop = event => { event.preventDefault(); dropzone.classList.remove('ag-drag-over'); readImage(event.dataTransfer?.files[0]); };
      const applyUrl = () => {
        try {
          const url = new URL(urlInput.value.trim());
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported protocol');
          applyImage(url.href);
        } catch { status.textContent = '请输入有效的 HTTP 或 HTTPS 图片地址。'; }
      };
      find('#ag-btn-load-url').onclick = applyUrl;
      urlInput.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); applyUrl(); } };
      find('#ag-btn-clear-bg').onclick = () => { applyImage('none'); urlInput.value = ''; };
      for (const [key, fallback, suffix, max] of [['opacity', 40, '%', 100], ['blur', 0, ' px', 30]]) {
        const slider = find(`#ag-range-${key}`);
        const output = find(`#ag-label-${key}`);
        const value = Number(cfg[key] ?? fallback);
        slider.value = Number.isFinite(value) ? Math.min(max, Math.max(Number(slider.min), value)) : fallback;
        output.value = `${slider.value}${suffix}`;
        slider.oninput = () => {
          const value = Number(slider.value);
          output.value = `${value}${suffix}`;
          if (bg && key === 'opacity') bg.style.opacity = value / 100;
          if (bg && key === 'blur') bg.style.filter = `blur(${value}px) brightness(var(--ag-bg-brightness, 0.88)) saturate(1.05) contrast(1.02)`;
          persist({ [key]: value });
        };
      }
      const position = find('#ag-position');
      const positions = [['center', '居中'], ['right center', '靠右'], ['left center', '靠左'], ['center top', '居上']];
      let selected = Math.max(0, positions.findIndex(([value]) => value === cfg.position));
      let highlighted = selected;
      let popup = null;
      let popupTimer = 0;
      const updatePositionLabel = () => { find('#ag-position-value').textContent = positions[selected][1]; };
      updatePositionLabel();
      const placePopup = () => {
        if (!popup) return;
        const rect = position.getBoundingClientRect();
        const width = Math.max(140, rect.width);
        const height = popup.offsetHeight;
        const below = rect.bottom + height + 6 <= innerHeight;
        popup.style.width = `${width}px`;
        popup.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
        popup.style.top = `${Math.max(8, below ? rect.bottom + 4 : rect.top - height - 4)}px`;
        popup.style.transformOrigin = below ? 'top center' : 'bottom center';
      };
      function closePopup(immediate = false) {
        position.setAttribute('aria-expanded', 'false');
        position.removeAttribute('aria-activedescendant');
        document.removeEventListener('pointerdown', outsidePopup, true);
        window.removeEventListener('resize', placePopup);
        view.removeEventListener('scroll', placePopup);
        if (!popup) return;
        const closing = popup;
        popup = null;
        clearTimeout(popupTimer);
        if (immediate) closing.remove();
        else {
          closing.setAttribute('data-ending-style', '');
          popupTimer = setTimeout(() => closing.remove(), 120);
        }
      }
      function outsidePopup(event) {
        if (!popup?.contains(event.target) && !position.contains(event.target)) closePopup();
      }
      function highlight(index) {
        highlighted = (index + positions.length) % positions.length;
        if (!popup) return;
        [...popup.querySelectorAll('[role="option"]')].forEach((option, i) => option.toggleAttribute('data-highlighted', i === highlighted));
        position.setAttribute('aria-activedescendant', `ag-position-option-${highlighted}`);
      }
      function selectPosition(index) {
        selected = index;
        updatePositionLabel();
        if (bg) bg.style.backgroundPosition = positions[selected][0];
        persist({ position: positions[selected][0] });
        closePopup();
        position.focus();
      }
      function openPopup() {
        if (popup) return;
        // Finish any prior closing animation before reusing the option IDs.
        document.querySelectorAll('[data-ag-position-popup]').forEach(element => element.remove());
        popup = document.createElement('div');
        popup.setAttribute('data-select-popup', '');
        popup.setAttribute('data-ag-position-popup', '');
        popup.innerHTML = '<div id="ag-position-listbox" role="listbox" aria-labelledby="ag-position-label"></div>';
        for (const [index, [, label]] of positions.entries()) {
          const option = document.createElement('div');
          option.id = `ag-position-option-${index}`;
          option.setAttribute('role', 'option');
          option.setAttribute('aria-selected', String(index === selected));
          option.textContent = label;
          option.onpointermove = () => highlight(index);
          option.onpointerdown = event => event.preventDefault();
          option.onclick = () => selectPosition(index);
          popup.firstElementChild.append(option);
        }
        document.body.append(popup);
        position.setAttribute('aria-expanded', 'true');
        highlight(selected);
        placePopup();
        document.addEventListener('pointerdown', outsidePopup, true);
        window.addEventListener('resize', placePopup);
        view.addEventListener('scroll', placePopup);
      }
      position.onclick = () => { if (popup) closePopup(); else openPopup(); };
      position.onkeydown = event => {
        if (event.key === 'Escape' && popup) {
          event.preventDefault();
          event.stopPropagation();
          closePopup();
          return;
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) event.preventDefault();
        if (event.key === 'Escape' || event.key === 'Tab') closePopup();
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          if (!popup) openPopup();
          else highlight(highlighted + (event.key === 'ArrowDown' ? 1 : -1));
        } else if (event.key === 'Home' || event.key === 'End') {
          openPopup(); highlight(event.key === 'Home' ? 0 : positions.length - 1);
        } else if (event.key === 'Enter' || event.key === ' ') {
          if (popup) selectPosition(highlighted); else openPopup();
        }
      };
      function setOpen(open) {
        if (!open) closePopup(true);
        nativePane.style.display = open ? 'none' : nativeDisplay;
        view.style.display = open ? 'block' : 'none';
        nav.classList.toggle('bg-sidebar-secondary', open);
        nav.classList.toggle('hover:bg-sidebar-muted', !open);
        nav.setAttribute('aria-expanded', String(open));
        dialog.toggleAttribute('data-ag-theme-open', open);
      }
      const onNavigation = event => {
        const button = event.target.closest('button');
        if (button === nav) setOpen(true);
        else if (button?.matches('[data-testid^="settings-nav-item-"]')) setOpen(false);
      };
      sidebar.addEventListener('click', onNavigation, true);
      const cleanup = () => {
        closePopup(true);
        clearTimeout(popupTimer);
        document.querySelectorAll('[data-ag-position-popup]').forEach(element => element.remove());
        sidebar.removeEventListener('click', onNavigation, true);
        nativePane.style.display = nativeDisplay;
        dialog.removeAttribute('data-ag-theme-open');
        nav.remove(); view.remove();
      };
      Object.assign(cleanup, {view, nav, nativePane});
      bindings.set(dialog, cleanup);
      if (wasOpen || reopen) setOpen(true);
      reopen = false;
    }
    const observer = new MutationObserver(checkAndInject);
    observer.observe(document.body, { childList: true, subtree: true });
    window.__ag_settings_ui_cleanup = () => { observer.disconnect(); for (const cleanup of bindings.values()) cleanup(); bindings.clear(); };
    checkAndInject();
  }


  // --- 4. TanStack Router Deadlock Guard ---
  function installRouterGuard() {
    if (window.__ag_settings_guard_installed) return;
    window.__ag_settings_guard_installed = true;

    document.addEventListener("click", (e) => {
      const btn = e.target && e.target.closest && e.target.closest('[data-testid="settings-button"]');
      if (!btn) return;

      const hasDialog = !!document.querySelector('[role="dialog"]');
      const urlHasSettings = window.location.search.includes("settingsOpen=true");

      if (!hasDialog && urlHasSettings) {
        try {
          const url = new URL(window.location.href);
          url.searchParams.delete("settingsOpen");
          url.searchParams.delete("settingsScreen");
          window.history.replaceState(window.history.state, "", url.toString());
        } catch (err) {
          console.error("[AG-Patch] Error recovering settings route:", err);
        }
      }
    }, true);
  }

  // --- 5. LocalStorage Safety Hook ---
  function installStorageGuard() {
    if (window.__ag_preset_hooked) return;
    window.__ag_preset_hooked = true;

    const ALL_CUSTOM_PRESETS = new Set([
      "high-contrast",
      "claude-desktop-purewhite",
      "vintage-deep",
      "chuanban-warm-white",
      "claude-desktop-official",
      "absoulutely-chuanban",
      "yasashii-neiro-acrylic"
    ]);

    try {
      const originalGet = localStorage.getItem.bind(localStorage);
      localStorage.getItem = function (k) {
        const val = originalGet(k);
        if (k === "theme-preset-light" && ALL_CUSTOM_PRESETS.has(val)) {
          return "Default Light";
        }
        return val;
      };

      const originalSet = localStorage.setItem.bind(localStorage);
      localStorage.setItem = function (k, v) {
        if (k === "theme-preset-light" && ALL_CUSTOM_PRESETS.has(v)) {
          v = "Default Light";
        }
        originalSet(k, v);
      };
    } catch (e) {
      console.warn("[AG-Patch] Storage guard hook warning:", e);
    }
  }

  // --- 6. Window Controls Caption Buttons (Minimize/Maximize/Close) ---
  function updateTitleBarControls() {
    try {
      if (window.electronNative && typeof window.electronNative.setTitleBarOverlay === 'function') {
        window.electronNative.setTitleBarOverlay({
          color: '#00000000',
          symbolColor: getComputedStyle(document.body).getPropertyValue('--ag-text').trim() || '#ECEAE4',
          height: 35
        });
      }
    } catch (e) {
      console.warn("[AG-Patch] setTitleBarOverlay notice:", e);
    }
  }

  function installThemePaletteObserver() {
    window.__ag_theme_palette_cleanup?.();
    const observer = new MutationObserver(() => {
      updateTitleBarControls();
      applyReadingConfig();
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.__ag_theme_palette_cleanup = () => observer.disconnect();
  }

  // --- Run All Enhancements ---
  try {
    ensureBackgroundLayer();
    ensureStyleElement();
    applyReadingConfig();
    installChromeGlass();
    installConversationMotion();
    installLibraryPages();
    installSettingsAcrylicPlate();
    installSettingsThemeUI();
    installRouterGuard();
    installStorageGuard();
    updateTitleBarControls();
    installThemePaletteObserver();
    window.__ag_patch_version = PATCH_VERSION;
    return { success: true, version: PATCH_VERSION };
  } catch (err) {
    console.error("[AG-Patch] Injection execution error:", err);
    return { success: false, error: String(err) };
  }
})();
