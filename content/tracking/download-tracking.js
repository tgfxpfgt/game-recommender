/**
 * Game Recommender - 下载追踪模块 / Download Tracking Module
 *
 * 始终激活：window.open 拦截 + 全局点击委托 + 复制事件捕获。
 * Always active: window.open interception, global click delegation and copy capture.
 */
(function (global) {
  'use strict';

  const GR = (global.__GR__ = global.__GR__ || {});

  // 网盘/下载URL识别（覆盖主流网盘）/ Pan/download URL detection
  function isDownloadUrl(str) {
    if (!str) return false;
    return /pan\.baidu\.com|yun\.baidu\.com|baidupcs|aliyundrive\.com|alipan\.com|115\.com|quark\.cn|weiyun\.com|jianwen\.com|caiyun\.com|139\.com|mega\.nz|mediafire|1fichier|gofile|rapidgator|uploaded\.net|magnet:|thunder:|ed2k:|ftp:|\.torrent/i.test(str);
  }

  // 下载相关文本识别 / Download-related text detection
  function isDownloadText(text) {
    if (!text) return false;
    return /百度网盘|百度云|网盘|百度盘|阿里云盘|夸克网盘|115网盘|微云|提取码|下载游戏|游戏下载|高速下载|普通下载|磁力|种子/.test(text);
  }

  // 记录一次下载事件 / Record a download event
  function recordDownload(url, text, method) {
    GR.debug.DEBUG.downloadEvents++;
    GR.debug.dbg(`📥 下载事件 [${method}]: ${text}`);
    GR.common.trackEvent('click_download', {
      gameName: GR.debug.DEBUG.gameName || GR.detail.detectGameName() || document.title,
      keywords: [],
      downloadUrl: url,
      downloadText: text,
      method: method
    });
    GR.debug.scheduleDebugUpdate();
  }

  // 设置下载追踪（打开网盘即视为下载）
  // 策略：window.open 拦截 + 全局点击委托（capture 阶段）+ copy 事件捕获。
  function setupDownloadTracking() {
    GR.debug.dbg('设置下载追踪...');

    // 1. 拦截 window.open（网盘链接常以新窗口打开）
    const originalOpen = window.open;
    window.open = function(url, ...args) {
      if (url && isDownloadUrl(url)) {
        recordDownload(url, 'window.open打开网盘', 'window_open');
      }
      return originalOpen.apply(this, [url, ...args]);
    };

    // 2. 全局点击委托（capture 阶段，覆盖静态与动态链接）
    document.addEventListener('click', (e) => {
      const target = e.target.closest('a, button, [onclick], [data-href], [class*="down"], [class*="baidu"], [class*="pan"], [id*="down"], [class*="netdisk"]');
      if (!target) return;

      const text = (target.textContent || '').trim();
      const urls = [
        target.href,
        target.getAttribute('data-href'),
        target.getAttribute('data-url'),
        target.getAttribute('data-link'),
        target.getAttribute('onclick')
      ].filter(Boolean);

      const hasDownloadUrl = urls.some(u => isDownloadUrl(u));
      const hasDownloadText = isDownloadText(text);

      if (hasDownloadUrl || hasDownloadText) {
        const url = urls.find(u => isDownloadUrl(u)) || urls[0] || text;
        recordDownload(url, text.substring(0, 50) || '网盘下载', 'delegate_click');
      }
    }, true);

    // 3. 复制事件 - 捕获网盘链接/提取码复制
    document.addEventListener('copy', () => {
      const sel = window.getSelection()?.toString() || '';
      if (isDownloadUrl(sel) || /提取码|密码|网盘|pan\.baidu/.test(sel)) {
        recordDownload(sel.substring(0, 200), '复制网盘链接/提取码', 'copy_link');
      }
    });

    GR.debug.dbg('✅ 下载追踪已激活');
  }

  GR.tracking = {
    setupDownloadTracking,
    isDownloadUrl,
    isDownloadText
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
