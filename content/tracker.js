/**
 * Game Recommender - 内容脚本入口 / Content Script Entry
 *
 * 模块化架构（经典脚本顺序加载，经 globalThis.__GR__ 共享）：
 *   core/common.js      通用工具（转义/消息/站点）
 *   core/debug.js       调试状态/面板/诊断条
 *   adapters/builder.js 适配规则加载与适配器构建
 *   list/list-page.js   列表页功能（徽章/过滤/预载）
 *   detail/detail-page.js 详情页功能（Steam 浮窗/历史/手动选择）
 *   tracking/download-tracking.js 下载追踪
 *
 * 本文件仅负责：主流程（init）、启动与消息监听。
 * This entry only wires the main flow (init), startup and message listening.
 */
(function () {
  'use strict';

  if (window.__gameRecommenderTracker) return;
  window.__gameRecommenderTracker = true;

  // 模块依赖（经命名空间访问）/ Module access via the shared namespace
  const GR = window.__GR__ || {};
  const common = GR.common || {};
  const debug = GR.debug || {};
  const builder = GR.builder || {};
  const list = GR.list || {};
  const detail = GR.detail || {};
  const tracking = GR.tracking || {};

  const dbg = (...a) => debug.dbg(...a);

  // ============ 核心初始化（URL检测页面类型） ============
  async function init() {
    let settings;
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
      settings = resp?.settings;
    } catch (e) {
      return;
    }

    if (!settings || !settings.enabled) return;

    // 加载适配规则（用户导入的 storage.adapterRules 优先）并构建站点适配器
    await builder.loadSiteRules();
    builder.buildSiteAdapters(builder.getSITE_RULES());

    const domain = common.getCurrentDomain();
    const trackedSites = settings.trackedSites || [];
    const isTracked = trackedSites.length === 0 || trackedSites.some(s => domain.includes(s));
    const isSteamPage = domain.includes('store.steampowered.com');

    // 调试面板：仅在设置开启时显示（追踪站或Steam页）
    debug.DEBUG.siteTracked = isTracked;
    if (settings.showDebugPanel && (isTracked || isSteamPage)) {
      debug.initDebugPanel();
    }

    // === 功能4：非追踪网站且非Steam页 → 尽早退出，节省资源 ===
    if (!isTracked && !isSteamPage) {
      return;
    }

    dbg('插件初始化...');
    dbg(`域名: ${domain}, 追踪: ${isTracked ? '是' : '否'}, Steam: ${isSteamPage ? '是' : '否'}`);

    // === 功能3：Steam页面 → 注入下载站跳转浮窗 ===
    if (isSteamPage) {
      detail.injectDownloadSitePanel();
      if (!isTracked) return; // Steam页只注入下载站浮窗，不做行为追踪
    }

    const adapter = builder.getAdapter();
    debug.DEBUG.adapter = adapter.name;

    // === 页面类型检测：URL优先，DOM辅助 ===
    const detailByUrl = list.isDetailPageByUrl();
    const listByUrl = list.isListPageByUrl();
    dbg(`URL检测: 详情=${detailByUrl}, 列表=${listByUrl}`);

    // === 1. 列表页：提取游戏列表并高亮 ===
    const isList = listByUrl || (!detailByUrl && adapter.isListPage());
    if (isList) {
      debug.DEBUG.pageType = '列表页';
      dbg('✅ 检测到列表页');
      const items = list.getListItemsSmart(adapter);
      if (items.length > 0) {
        dbg(`找到 ${items.length} 个游戏项`);
        list.trackListView(adapter, items, settings);
      } else {
        // 适配器未提取到游戏：诊断条提示（页面结构可能已变化）
        dbg('⚠️ 适配器未提取到游戏项');
        debug.showDiagStrip({ extracted: 0, queried: 0, shown: 0, notFound: 0, error: '适配器未提取到游戏项（页面结构可能已变化）' });
      }
    }

    // === 2. 始终设置下载追踪 ===
    tracking.setupDownloadTracking();

    // === 3. 详情页：注入Steam浮窗和下载历史浮窗 ===
    const isDetail = detailByUrl || (!isList && !!document.querySelector('h1'));
    if (isDetail) {
      debug.DEBUG.pageType = '详情页';
      const gameName = detail.detectGameName();
      // 即使未检测到游戏名，若页面含 Steam 图片可提取 appId，仍注入 Steam 浮窗
      const appIdFromImg = builder.extractSteamAppIdFromImages();
      if (gameName && gameName.length > 1) {
        debug.DEBUG.gameName = gameName;
        dbg(`详情页游戏名: ${gameName}`);
        common.trackEvent('view_detail', { gameName: gameName, keywords: [], description: '' });
        detail.injectSteamButton(gameName);
        detail.injectDownloadHistoryPanel(gameName);
      } else if (appIdFromImg) {
        // 仅有 appId 无游戏名：用 document.title 作为回退名，仅注入 Steam 浮窗
        const fallbackName = (document.title || '')
          .replace(/[\|\-–—_]\s*[^\|\-–—_]*$/, '')
          .replace(/(下载|游戏下载|免费下载|破解版|汉化版|中文版|绿色版|免安装).*$/i, '')
          .trim();
        debug.DEBUG.gameName = fallbackName || `(appId:${appIdFromImg})`;
        dbg(`详情页游戏名为空，但图片含 appId: ${appIdFromImg}，使用回退名注入 Steam 浮窗`);
        detail.injectSteamButton(fallbackName || '');
      } else {
        dbg('⚠️ 详情页未检测到游戏名称');
      }
    } else if (!isList) {
      dbg('⚠️ 未识别页面类型');
    }

    dbg('✅ 初始化完成');
  }

  // ============ Startup / 启动 ============
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 300);
  } else {
    window.addEventListener('DOMContentLoaded', () => setTimeout(init, 300));
  }

  // Message listener / 消息监听
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'REFRESH_RECOMMENDATIONS') {
      // 刷新推荐需要 settings 来读取高亮阈值，并应用虚拟机过滤
      (async () => {
        try {
          const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
          const settings = resp?.settings;
          if (!settings) { sendResponse({ success: false }); return; }
          const adapter = builder.getAdapter();
          if (list.isListPageByUrl() || adapter.isListPage()) {
            let items = list.getListItemsSmart(adapter);
            // 应用虚拟机过滤（若已启用）
            if (settings.enableVmFilter) {
              items = list.applyVmFilter(items, settings.vmFilterKeywords);
            }
            list.requestRecommendations(items, settings);
          }
          sendResponse({ success: true });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true; // 异步响应 / Async response
    }
    if (message.action === 'GET_DEBUG_INFO') {
      sendResponse({ debug: debug.DEBUG });
    }
    return true;
  });
})();
