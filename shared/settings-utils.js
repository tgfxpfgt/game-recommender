/**
 * 游戏雷达 Game Radar - 设置深路径工具 / Settings Path Utilities
 *
 * v6.4.11：popup / menu-vista / options 三处设置保存共用。
 * 点号路径深读写（如 'badgeVisibility.recent'、'llmConfig.endpoint'），
 * 修复 savePatch 用 Object.assign 扁平合并导致嵌套设置无法保存的问题。
 * Classic script（经 <script> 注入，挂 globalThis.__GR_SETTINGS_UTILS__）。
 * Shared by popup / menu-vista / options for settings save (dotted-path
 * deep read/write; fixes flat Object.assign merges losing nested settings).
 */
(function (global) {
  'use strict';

  // 深写入：path 支持点号路径（如 'llmConfig.endpoint'）；中间层不存在时创建
  // Deep set a dotted path (creates intermediate objects as needed).
  function deepSet(obj, path, value) {
    const keys = String(path).split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (o[k] === null || typeof o[k] !== 'object') o[k] = {};
      o = o[k];
    }
    o[keys[keys.length - 1]] = value;
    return obj;
  }

  // 深读取：path 为点号路径；缺失返回 fallback
  // Deep get a dotted path; returns fallback when missing.
  function getByPath(obj, path, fallback) {
    let o = obj;
    for (const k of String(path).split('.')) {
      if (o === null || o === undefined || typeof o !== 'object') return fallback;
      o = o[k];
    }
    return o === undefined ? fallback : o;
  }

  // 合并补丁：支持点号路径键（如 { 'badgeVisibility.recent': false }）
  // Apply a patch object whose keys may be dotted paths.
  function applyPatch(obj, patch) {
    for (const [k, v] of Object.entries(patch || {})) {
      if (k.includes('.')) deepSet(obj, k, v);
      else obj[k] = v;
    }
    return obj;
  }

  // 跳转设置中心：hub iframe 内（URL 带 ?hub=1）→ postMessage 让父级切换面板；
  // 独立打开 → 新开标签直达指定页面。page 取值：options|vista|dashboard|freegames
  // Go to the hub: switch the parent panel when embedded, else open a new tab.
  function goHub(page) {
    const inHub = typeof location !== 'undefined' && location.search && location.search.indexOf('hub=1') !== -1;
    if (inHub && typeof window !== 'undefined' && window.parent !== window) {
      // v10.5.0 P3：定向扩展自身源（父级 hub 与本 iframe 同源），不再用 '*'
      window.parent.postMessage({ type: 'GR_HUB_SWITCH', page: page || 'options' }, location.origin);
      return;
    }
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      const url = chrome.runtime.getURL('hub/hub.html') + (page ? '#page=' + page : '');
      chrome.tabs.create({ url });
    }
  }

  // v14.3.2：主题文件动态加载——styles/themes/<name>.css 每主题一文件，
  // applyTheme 切换时经 <link id="gr-theme-file"> 注入（重复切换复用同一元素
  // 换 href，保持在 head 尾部 → 晚于 ui-theme.css 生效，层叠序与拆分前一致）。
  // steam 为默认主题（ui-theme.css :root），无需文件 → 移除注入的 link。
  // Theme CSS is now one file per skin under styles/themes/, injected on demand
  // by applyTheme via a single reusable <link>; 'steam' (the :root default in
  // ui-theme.css) removes the link instead.
  /**
   * @param {string} name 主题名（VALID_THEMES 成员）
   * @returns {string} 主题 CSS 文件 URL
   */
  function themeFileUrl(name) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      return chrome.runtime.getURL('styles/themes/' + name + '.css');
    }
    // 页面均在一级子目录（popup/ 等），兜底相对路径
    // Pages live one level deep; relative fallback for non-extension contexts.
    return '../styles/themes/' + name + '.css';
  }
  /**
   * @param {string} theme 主题名（'steam' 时移除注入的 link）
   * @returns {void}
   */
  function applyThemeFile(theme) {
    if (typeof document === 'undefined' || !document.head) return;
    const el = document.getElementById('gr-theme-file');
    if (theme === 'steam') {
      if (el) el.remove();
      return;
    }
    const href = themeFileUrl(theme);
    if (el) {
      if (el.getAttribute('href') === href) return; // 同主题幂等（防重复注入）
      el.setAttribute('href', href);
      return;
    }
    const link = document.createElement('link');
    link.id = 'gr-theme-file';
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  // v6.4.19：应用皮肤主题（body data-theme → 主题变量覆盖生效）
  // Apply the UI skin theme (body[data-theme] drives theme variable overrides).
  // v9.2.0：20 套主题（win31/95/98/win7/win10 已清理——netscape/vista/ios17 覆盖）
  // v14.3.2：主题样式改动态加载（见 applyThemeFile）
  const VALID_THEMES = new Set([
    'steam',
    'vista',
    'ios6',
    'ios17',
    'winxp',
    'win11',
    'cyberpunk',
    'aqua',
    'neumorph',
    'netscape',
    'material',
    'gtk2',
    'vaporwave',
    'oled',
    'wabi',
    'crt',
    'win8',
    'morandi',
    'gothic',
    'nordic'
  ]);
  function applyTheme(theme) {
    if (typeof document === 'undefined') return;
    const t = VALID_THEMES.has(theme) ? theme : 'steam';
    document.body.dataset.theme = t;
    applyThemeFile(t); // v14.3.2：动态加载该主题文件（steam 移除）
  }

  // v10.6.0 F4：主题定时切换解析（纯函数，可单测）——themeAutoSwitch 开启时
  // 按 19:00-07:00 窗口选日/夜主题，否则用 uiTheme
  // Theme auto-switch resolution (pure): night window 19:00-07:00.
  // v10.7.0 批次5：夜间窗口小时数可调（uiThemeNightStart/End，默认 19/7；
  // 支持跨零点窗口 start > end，如 21 → 6）
  // Night window hours now configurable (supports wrap-around windows).
  function resolveTheme(settings, hour) {
    if (!settings) return 'steam';
    const h = typeof hour === 'number' ? hour : new Date().getHours();
    if (settings.themeAutoSwitch === true) {
      const start = Number.isFinite(settings.uiThemeNightStart) ? settings.uiThemeNightStart : 19;
      const end = Number.isFinite(settings.uiThemeNightEnd) ? settings.uiThemeNightEnd : 7;
      const night = start > end ? h >= start || h < end : h >= start && h < end;
      const t = night ? settings.uiThemeNight : settings.uiThemeDay;
      return t || settings.uiTheme || 'steam';
    }
    return settings.uiTheme || 'steam';
  }

  // 应用解析后的主题（定时切换入口；无 settings 时回退 applyTheme）
  function applyThemeAuto(settings) {
    if (!settings) return;
    applyTheme(resolveTheme(settings));
  }

  // v14.3.2：统一入口补齐——dashboard/freegames/hub/popup/sidepanel 五页在
  // v10.7.0 批次5 即调用 applyPageTheme，但工具文件从未实现（调用方守卫
  // 静默跳过 = 除 popup 外四页主题恒不生效）。契约：定时解析主题 + 自定义
  // CSS 一次完成。
  // Unified entry finally implemented: auto-switch-aware resolution + custom
  // theme CSS in one call (was referenced by 5 pages but never defined).
  /**
   * @param {{uiTheme?: string, themeAutoSwitch?: boolean, uiThemeDay?: string,
   *   uiThemeNight?: string, uiThemeNightStart?: number, uiThemeNightEnd?: number,
   *   customThemeCss?: string}} settings 完整设置对象（消费键列出）
   * @returns {void}
   */
  function applyPageTheme(settings) {
    if (!settings) return;
    applyThemeAuto(settings);
    applyCustomTheme(settings.customThemeCss);
  }

  // v7.0.5：应用自定义主题 CSS（覆盖任意主题变量；空值移除）
  // Apply user custom theme CSS (overrides any theme variables; empty removes).
  function applyCustomTheme(css) {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('gr-custom-theme');
    const text = String(css || '').trim();
    if (!text) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      const style = document.createElement('style');
      style.id = 'gr-custom-theme';
      document.head.appendChild(style);
      style.textContent = text;
    } else {
      el.textContent = text;
    }
  }

  // v9.3.0：串行保存队列工厂（popup 保存链路复用 + 可单测——并发 GET→SAVE
  // 基于旧快照互相覆盖的防竞态）
  // Serial save queue: each task re-reads latest settings before patching.
  function createSaveQueue(send) {
    let queue = Promise.resolve();
    return function enqueue(getLatest, patch, doSave) {
      queue = queue.then(async () => {
        const latest = await getLatest();
        await doSave(latest, patch);
      });
      return queue;
    };
  }

  global.__GR_SETTINGS_UTILS__ = {
    VALID_THEMES, // v14.2.0：主题清单单源导出（此前仅模块内私有，页面无法复用）
    deepSet,
    getByPath,
    applyPatch,
    goHub,
    applyTheme,
    applyThemeAuto,
    applyPageTheme, // v14.3.2：统一入口（v10.7.0 起五页面调用，此前缺失）
    resolveTheme,
    applyCustomTheme,
    createSaveQueue
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
