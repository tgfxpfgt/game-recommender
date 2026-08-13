/**
 * 游戏雷达 Game Radar - 共享 HTML 转义工具 / Shared HTML Escaping
 *
 * 供所有扩展页面（options/popup/dashboard/freegames）与内容脚本使用，
 * 消除各文件重复定义。动态内容渲染前必须转义（XSS 防护）。
 * Shared escaping for all extension pages; deduplicated. Always escape dynamic
 * content before rendering (XSS protection).
 */
(function (global) {
  'use strict';

  // HTML 转义 / HTML escape
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // HTML 属性值转义（href 等属性）/ Attribute-value escape
  function escapeAttr(text) {
    return (text || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  global.escapeHtml = escapeHtml;
  global.escapeAttr = escapeAttr;
})(typeof globalThis !== 'undefined' ? globalThis : this);
