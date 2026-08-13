/**
 * 游戏雷达 Game Radar - 内容脚本公共工具 / Content Common
 *
 * 命名空间 __GR__ 的初始化与通用工具（转义、站点、消息）。
 * 内容脚本各模块通过 globalThis.__GR__ 共享函数（经典脚本，非 module）。
 * Namespace init + common utilities (escaping, site, messaging) shared across
 * content-script modules via globalThis.__GR__ (classic scripts, not modules).
 */

  // 当前站点域名 / Current site domain
function getCurrentDomain() {
    return window.location.hostname;
  }

  // HTML 转义（动态内容安全）。v3.3.9：shared/escape.js 已由 manifest 注入
  // 内容脚本（单点维护）——存在全局实现时复用，缺失时回退本地实现。
  // HTML escape (safe dynamic content). Since v3.3.9 shared/escape.js is
  // injected into content scripts (single maintenance point); reuse the global
  // implementation when present, fall back to the local one otherwise.
// v6.0.0：escapeDiv 惰性创建（模块顶层在 Node 测试环境无 document）
let escapeDiv = null;
function escapeHtmlLocal(text) {
  escapeDiv = escapeDiv || document.createElement('div');
  escapeDiv.textContent = text || '';
  return escapeDiv.innerHTML;
}
function escapeAttrLocal(text) {
  return (text || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const escapeHtml = typeof globalThis.escapeHtml === 'function' ? globalThis.escapeHtml : escapeHtmlLocal;
const escapeAttr = typeof globalThis.escapeAttr === 'function' ? globalThis.escapeAttr : escapeAttrLocal;

  // 相对时间格式化（内容脚本统一实现，替代各浮窗独立实现）
  // Relative-time formatting (shared by all content floats)
function formatRelativeTime(timestamp) {
    if (!timestamp) return '未知';
    const diff = Date.now() - timestamp;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 7 * 86400000) return Math.floor(diff / 86400000) + ' 天前';
    return new Date(timestamp).toLocaleDateString('zh-CN');
  }

  // 发送行为追踪消息 / Send a behavior-tracking message
function trackEvent(type, data) {
    chrome.runtime
      .sendMessage({
        action: 'TRACK_EVENT',
        data: { type, url: window.location.href, domain: getCurrentDomain(), ...data }
      })
      .catch(() => {});
  }

  // 记录下载站详情页访问（写入下载站网址缓存并更新"上次调用"时间）
  // Record a detail-page visit (writes the URL cache + lastAccessed)
function trackDownloadSiteVisit(appId, gameName) {
    if (!appId) return;
    chrome.runtime
      .sendMessage({
        action: 'TRACK_DOWNLOAD_SITE_VISIT',
        data: {
          appId: String(appId),
          gameName: gameName || '',
          url: window.location.href,
          domain: getCurrentDomain()
        }
      })
      .catch(() => {});
  }

  // v5.0.0：页面标题清洗链（detail-page 与 tracker 此前逐字重复两份）——
  // 去尾部"|中文|下载"等噪声段，返回清洗后的标题（空则原样）
  // Page-title cleaning chain (was duplicated verbatim in detail-page/tracker).
function cleanPageTitle(title) {
    return (title || '')
      .replace(/[\|\-–—_]\s*[^\|\-–—_]*$/, '')
      .replace(/(下载|游戏下载|免费下载|破解版|汉化版|中文版|绿色版|免安装).*$/i, '')
      .trim();
  }

export {
  getCurrentDomain,
  escapeHtml,
  escapeAttr,
  formatRelativeTime,
  cleanPageTitle,
  trackEvent,
  trackDownloadSiteVisit
};
