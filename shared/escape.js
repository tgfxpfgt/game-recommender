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
  // v10.8.1 修复：入参 String 强转——转义是安全防线，调用方可能传数字（如
  // Steam appId，v10.5.0 起候选列表 escapeAttr(数字) 抛 TypeError 使候选浮窗
  // 整体"搜索失败"）；防线自身不得因数据类型崩溃
  function escapeAttr(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  global.escapeHtml = escapeHtml;
  global.escapeAttr = escapeAttr;
})(typeof globalThis !== 'undefined' ? globalThis : this);
