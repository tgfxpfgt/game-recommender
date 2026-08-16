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
      window.parent.postMessage({ type: 'GR_HUB_SWITCH', page: page || 'options' }, '*');
      return;
    }
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      const url = chrome.runtime.getURL('hub/hub.html') + (page ? '#page=' + page : '');
      chrome.tabs.create({ url });
    }
  }

  // v6.4.19：应用皮肤主题（body data-theme → themes.css 变量覆盖生效）
  // Apply the UI skin theme (body[data-theme] drives themes.css overrides).
  // v9.2.0：20 套主题（win31/95/98/win7/win10 已清理——netscape/vista/ios17 覆盖）
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
    deepSet,
    getByPath,
    applyPatch,
    goHub,
    applyTheme,
    applyCustomTheme,
    createSaveQueue
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
