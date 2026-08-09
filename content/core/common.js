/**
 * Game Recommender - 内容脚本公共工具 / Content Common
 *
 * 命名空间 __GR__ 的初始化与通用工具（转义、站点、消息）。
 * 内容脚本各模块通过 globalThis.__GR__ 共享函数（经典脚本，非 module）。
 * Namespace init + common utilities (escaping, site, messaging) shared across
 * content-script modules via globalThis.__GR__ (classic scripts, not modules).
 */
(function (global) {
  'use strict';

  const GR = (global.__GR__ = global.__GR__ || {});

  // 当前站点域名 / Current site domain
  function getCurrentDomain() { return window.location.hostname; }

  // HTML 转义（动态内容安全）/ HTML escape (safe dynamic content)
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // HTML 属性值转义（href 等属性，防止引号逃逸）
  // Attribute-value escape (prevents quotes breaking out of attributes)
  function escapeAttr(text) {
    return (text || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 发送行为追踪消息 / Send a behavior-tracking message
  function trackEvent(type, data) {
    chrome.runtime.sendMessage({
      action: 'TRACK_EVENT',
      data: { type, url: window.location.href, domain: getCurrentDomain(), ...data }
    }).catch(() => {});
  }

  // 记录下载站详情页访问（写入下载站网址缓存并更新"上次调用"时间）
  // Record a detail-page visit (writes the URL cache + lastAccessed)
  function trackDownloadSiteVisit(appId, gameName) {
    if (!appId) return;
    chrome.runtime.sendMessage({
      action: 'TRACK_DOWNLOAD_SITE_VISIT',
      data: {
        appId: String(appId),
        gameName: gameName || '',
        url: window.location.href,
        domain: getCurrentDomain()
      }
    }).catch(() => {});
  }

  GR.common = {
    getCurrentDomain,
    escapeHtml,
    escapeAttr,
    trackEvent,
    trackDownloadSiteVisit
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
