/**
 * Game Recommender - 内容脚本入口 / Content Script Entry
 *
 * 模块化架构（经典脚本顺序加载，经 globalThis.__GR__ 共享）：
 *   core/common.js      通用工具（转义/消息/站点）
 *   core/floats.js      统一浮窗管理器（v3.1.0）
 *   core/status-bar.js  工作状态/诊断统一浮窗
 *   core/debug.js       调试状态/面板/诊断条
 *   adapters/builder.js 适配规则加载与适配器构建
 *   list/list-page.js   列表页功能（徽章/过滤/预载）
 *   detail/detail-page.js 详情页功能（Steam 浮窗/历史/手动选择）
 *   tracking/download-tracking.js 下载追踪
 *
 * 本文件仅负责：预热（并行唤醒后台/加载规则）、主流程（init）、启动与消息监听。
 * This entry only wires warm-up (parallel SW wake-up & rule loading), the main
 * flow (init), startup and message listening.
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

  // 命名空间完整性自检（v3.3.9）：内容脚本靠 manifest 数组顺序加载，
  // 任一模块缺失即说明加载顺序/文件遗漏，尽早报错指明问题
  // Namespace integrity check: content scripts load in manifest order; a
  // missing module means a broken order or a dropped file — fail loudly.
  const REQUIRED_KEYS = [
    'common',
    'float',
    'status',
    'debug',
    'builder',
    'badges',
    'listBatch',
    'list',
    'detail',
    'detailTemplates',
    'tracking'
  ];
  const missing = REQUIRED_KEYS.filter((k) => !GR[k]);
  if (missing.length > 0) {
    console.error(
      `[Game Recommender] 内容脚本模块缺失（检查 manifest content_scripts 加载顺序）: ${missing.join(', ')}`
    );
  }

  const dbg = (...a) => debug.dbg(...a);

  // ============ 预热（document_start 立即执行，与页面加载并行） ============
  // Warm-up: run immediately at document_start, in parallel with page loading.
  // 1) 唤醒后台 Service Worker（MV3 冷启动需数秒，提前唤醒可隐藏该延迟）；
  // 2) 并行加载设置与适配规则。init 直接复用本结果，DOM 就绪时立即开始工作。
  const warmupPromise = (async () => {
    let settings = null;
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
      settings = resp?.settings;
    } catch {
      /* 后台不可达时 init 会自行重试 */
    }
    try {
      await builder.loadSiteRules();
      builder.buildSiteAdapters(builder.getSITE_RULES());
    } catch {
      /* 规则加载失败时回退内置规则 */
    }
    return settings;
  })();

  // ============ 核心初始化（URL检测页面类型） ============
  async function init() {
    // 复用预热结果（通常已就绪，立即返回；否则等待剩余时间）
    let settings = await warmupPromise;
    // SW 冷启动失败兜底：重试一次获取设置，避免整页功能静默失效
    // Fallback when the warm-up failed (e.g. SW cold start): retry once
    if (!settings) {
      try {
        const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
        settings = resp?.settings;
      } catch {
        /* 仍失败则放弃本页 */
      }
    }
    if (!settings || !settings.enabled) return;

    // 工作状态浮窗总开关（设置控制，默认开启）/ Status-bar master switch
    if (GR.status) GR.status.setEnabled(settings.showStatusBar !== false);

    // 加载适配规则（用户导入的 storage.adapterRules 优先）并构建站点适配器
    await builder.loadSiteRules();
    builder.buildSiteAdapters(builder.getSITE_RULES());
    // v3.3.9：列表页链接扫描上限可配置（默认 500）
    if (builder.setScanLimit) builder.setScanLimit(settings.maxScanLinks || 500);

    const domain = common.getCurrentDomain();
    const trackedSites = settings.trackedSites || [];
    const isTracked = trackedSites.length === 0 || trackedSites.some((s) => domain.includes(s));
    const isSteamPage = domain.includes('store.steampowered.com');

    // 调试模式：开启时统一浮窗在统计显示 3 秒后切换为诊断视图
    // Debug mode: with it on, the unified bar switches to the debug view after stats
    debug.DEBUG.siteTracked = isTracked;
    if (GR.status) GR.status.setDebugMode(settings.showDebugPanel && (isTracked || isSteamPage));

    // === 功能4：非追踪网站且非Steam页 → 尽早退出，节省资源 ===
    if (!isTracked && !isSteamPage) {
      return;
    }

    dbg('插件初始化...');
    dbg(`域名: ${domain}, 追踪: ${isTracked ? '是' : '否'}, Steam: ${isSteamPage ? '是' : '否'}`);

    // === 功能3：Steam页面 → 注入下载站跳转浮窗 ===
    if (isSteamPage) {
      detail.injectDownloadSitePanel();
      // v3.3.8：浏览 Steam 商品页时预取并缓存该游戏完整数据——回到下载站
      // 列表页时徽章/筛选立即有数据（后台 detail 缓存有效则自动跳过）
      // Cache the game when browsing a Steam store page, so badges are ready
      // when the user returns to download-site lists (the background skips
      // when the detail module is still valid)
      const appIdMatch = window.location.pathname.match(/\/app\/(\d+)/);
      if (appIdMatch) {
        const nameEl = document.querySelector('.apphub_AppName');
        const pageName = (
          nameEl ? nameEl.textContent : document.title.replace(/^Steam 上的\s*|\s*on Steam$/i, '')
        ).trim();
        chrome.runtime
          .sendMessage({ action: 'CACHE_STEAM_PAGE', appId: appIdMatch[1], gameName: pageName })
          .catch(() => {});
      }
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
      // 页面数据渲染完成即开始（AJAX 延迟渲染页面：等待列表容器出现，最多 4 秒）
      let items = list.getListItemsSmart(adapter);
      if (items.length === 0) {
        dbg('列表项为空，等待页面数据渲染...');
        items = await list.waitForListItems(adapter, 4000);
      }
      if (items.length > 0) {
        dbg(`找到 ${items.length} 个游戏项`);
        list.trackListView(adapter, items, settings);
      } else {
        // 适配器未提取到游戏：统一浮窗提示（页面结构可能已变化）
        dbg('⚠️ 适配器未提取到游戏项');
        GR.status.showStats({ title: '列表页处理', summary: '适配器未提取到游戏项（页面结构可能已变化）' });
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
        // v5.0.0：清洗链收敛至 GR.common.cleanPageTitle
        const fallbackName = GR.common.cleanPageTitle(document.title);
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
  // document_start 注入：预热已在顶层并行执行，DOM 就绪立即 init（无额外延迟）
  // Injected at document_start: warm-up already runs in parallel; init fires as
  // soon as the DOM is ready (no extra delay).
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    void init();
  } else {
    window.addEventListener('DOMContentLoaded', () => void init(), { once: true });
  }

  // Message listener / 消息监听
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'REFRESH_RECOMMENDATIONS') {
      // 刷新推荐需要 settings 来读取高亮阈值，并应用虚拟机过滤
      (async () => {
        try {
          const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
          const settings = resp?.settings;
          if (!settings) {
            sendResponse({ success: false });
            return;
          }
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
    if (message.action === 'SHOW_LAST_STATS') {
      // 弹窗请求重新显示最近一次统计 / Popup asks to re-show the latest stats
      if (GR.status) GR.status.showLastStats();
      sendResponse({ success: true });
      return; // 同步响应，无需保持消息通道 / sync response, no channel held
    }
    if (message.action === 'STEAM_RATINGS_UPDATE') {
      // 后台推送：缓存未命中的游戏已从 Steam 拉取完成（多波增量，done 标记收尾）
      // Background push: cache misses fetched from Steam (incremental waves + done)
      if (GR.list) GR.list.applySteamRatingsUpdate(message.ratings, message.done === true);
      sendResponse({ success: true });
      return; // 同步响应，无需保持消息通道 / sync response, no channel held
    }
    if (message.action === 'FORCE_REFRESH_PAGE') {
      // popup 强制刷新：收集当前页游戏引用 → 后台清除对应 Steam 缓存（忽视
      // 缓存有效期与 0 评测冷却）→ 重载页面后全部重新获取
      // Popup force-refresh: collect this page's game refs → clear their Steam
      // cache (ignoring TTLs and the zero-review cooldown) → reload to re-fetch
      (async () => {
        try {
          const names = new Set();
          const appIds = new Set();
          if (list.isDetailPageByUrl()) {
            const gn = detail.detectGameName();
            if (gn && gn.length > 1) names.add(gn);
            const img = builder.extractSteamImageInfo(document);
            if (img) appIds.add(img.appId);
          } else {
            const adapter = builder.getAdapter();
            if (list.isListPageByUrl() || adapter.isListPage()) {
              list.getListItemsSmart(adapter).forEach((item) => {
                if (item.name) names.add(item.name);
                const info = builder.extractSteamImageInfo(item.element);
                if (info) appIds.add(info.appId);
              });
            }
          }
          const resp = await chrome.runtime.sendMessage({
            action: 'CLEAR_CACHE_FOR_PAGE',
            names: [...names],
            appIds: [...appIds]
          });
          dbg(`♻️ 强制刷新：已清除 ${resp && resp.cleared} 条缓存，重载页面`);
          sendResponse({ success: true, cleared: resp && resp.cleared });
          location.reload();
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true; // 异步响应 / Async response
    }
    // v3.4.1：未处理的消息不返回 true（不无谓地保持消息通道，避免拖住
    // Service Worker 生命周期）/ Unhandled messages return nothing, so no
    // message channel is held open
  });
})();
