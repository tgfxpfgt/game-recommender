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

  global.__GR_SETTINGS_UTILS__ = { deepSet, getByPath, applyPatch, goHub };
})(typeof globalThis !== 'undefined' ? globalThis : this);
