/**
 * 游戏雷达 Game Radar - 内容脚本入口 / Content Script Entry
 *
 * v6.0.0：内容脚本 ESM 化（动态 import 路径）——Chrome content_scripts 官方
 * 不支持原生 ESM，本入口保持经典脚本，内部 await import() 并行加载模块
 *（模块间依赖由 ESM import 图显式表达，替代旧 __GR__ 全局命名空间）。
 * Since v6.0.0 modules load via dynamic import() from this classic entry;
 * module-to-module dependencies are explicit ESM imports (no __GR__ namespace).
 *
 * 本文件仅负责：模块加载（boot）、预热、主流程（init）、启动与消息监听。
 */
(function () {
  'use strict';

  if (window.__gameRecommenderTracker) return;
  window.__gameRecommenderTracker = true;

  // ============ 模块加载（动态 import，零构建） ============
  // v8.2.0：JSDoc 类型化——MODULES 形状固定，`M.float` 类键名错误编译期可捕获
  /**
   * @typedef {{
   *   common: any, floats: any, status: any, debug: any, builder: any,
   *   badges: any, listBatch: any, list: any, listState: any,
   *   detailTemplates: any, detail: any, tracking: any,
   *   qrUnlock: any, xdgrid: any
   * }} GRModules
   */
  /** @type {GRModules|null} */
  let MODULES = null;

  async function ensureModules() {
    if (MODULES) return MODULES;
    // 逐模块 getURL（动态 import 的 URL 由浏览器解析；测试环境 getURL 可 mock）
    const m = (p) => chrome.runtime.getURL('content/' + p);
    const [
      common,
      floats,
      status,
      debug,
      builder,
      badges,
      listBatch,
      list,
      listState,
      detailTemplates,
      detail,
      tracking,
      qrUnlock,
      xdgrid
    ] = await Promise.all([
      import(m('core/common.js')),
      import(m('core/floats.js')),
      import(m('core/status-bar.js')),
      import(m('core/debug.js')),
      import(m('adapters/builder.js')),
      import(m('list/badges.js')),
      import(m('list/list-batch.js')),
      import(m('list/list-page.js')),
      import(m('list/list-state.js')),
      import(m('detail/detail-templates.js')),
      import(m('detail/detail-page.js')),
      import(m('tracking/download-tracking.js')),
      import(m('detail/qr-unlock.js')),
      import(m('list/xdgrid.js'))
    ]);
    MODULES = {
      common,
      floats,
      status,
      debug,
      builder,
      badges,
      listBatch,
      list,
      listState,
      detailTemplates,
      detail,
      tracking,
      qrUnlock,
      xdgrid
    };
    return MODULES;
  }

  // v9.1.0：boot 计时（性能基线）
  const BOOT_T0 = Date.now();
  // ============ 预热（模块加载 + 设置/规则并行） ============
  // Warm-up: module load, settings and site rules all run in parallel.
  const bootPromise = (async () => {
    const M = await ensureModules();
    /** @type {any} */
    let settings = null;
    try {
      const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_SETTINGS' }, null, { timeout: 3000 });
      settings = resp?.settings;
    } catch {
      /* 后台不可达时 init 会自行重试 */
    }
    try {
      await M.builder.loadSiteRules();
      M.builder.buildSiteAdapters(M.builder.getSITE_RULES());
    } catch {
      /* 规则加载失败时回退内置规则 */
    }
    // v9.1.0：boot 完成 → Perf 日志上报（后台落盘 runtimeLog，可脚本分析）
    try {
      window.__GR_MSG__
        .sendMessage(
          { action: 'LOG_PERF', source: 'content-boot', metric: location.hostname, durationMs: Date.now() - BOOT_T0 },
          null,
          { timeout: 2000 }
        )
        .catch(() => {});
    } catch {
      /* 忽略上报失败 */
    }
    return { M, settings };
  })();
  // v8.2.0：boot 就绪信号（测试等待模块+预热完成——推送不再走延迟路径）
  window.__grBootPromise = bootPromise;

  // ============ 核心初始化（URL检测页面类型） ============
  async function init() {
    const { M, settings: bootSettings } = await bootPromise;
    const { common, debug, builder, list, detail, tracking, status } = M;
    // 复用预热结果（通常已就绪，立即返回；否则等待剩余时间）
    let settings = bootSettings;
    // SW 冷启动失败兜底：重试一次获取设置，避免整页功能静默失效
    // Fallback when the warm-up failed (e.g. SW cold start): retry once
    if (!settings) {
      try {
        const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_SETTINGS' }, null, { timeout: 3000 });
        settings = resp?.settings;
      } catch {
        /* 仍失败则放弃本页 */
      }
    }
    if (!settings || !settings.enabled) return;

    // 工作状态浮窗总开关（设置控制，默认开启）/ Status-bar master switch
    status.setEnabled(settings.showStatusBar !== false);
    // v8.1.0：浮窗主题跟随设置页皮肤系统（内容侧 data-theme）
    M.floats.applyFloatTheme(settings.uiTheme || 'steam');

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
    status.setDebugMode(settings.showDebugPanel && (isTracked || isSteamPage));

    // === 功能4：非追踪网站且非Steam页 → 尽早退出，节省资源 ===
    if (!isTracked && !isSteamPage) {
      return;
    }

    const dbg = (...a) => debug.dbg(...a);
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
        status.showStats({ title: '列表页处理', summary: '适配器未提取到游戏项（页面结构可能已变化）' });
      }
    }

    // === 2. 始终设置下载追踪 ===
    tracking.setupDownloadTracking();

    // === v10.2.0：二维码转链接（gamer520 等站二维码网盘链接自动解码）===
    M.qrUnlock.init();
    // === v10.2.0：XDGAME 列表布局自定义（模块内按域名早退，其他站零开销）===
    M.xdgrid.init();

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
        // v5.0.0：清洗链收敛至 common.cleanPageTitle
        const fallbackName = common.cleanPageTitle(document.title);
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
  // document_start 注入：boot（模块加载+预热）已在顶层并行执行，DOM 就绪立即
  // init（无额外延迟）。Injected at document_start: boot (module load + warm-up)
  // already runs in parallel; init fires as soon as the DOM is ready.
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    void init();
  } else {
    window.addEventListener('DOMContentLoaded', () => void init(), { once: true });
  }

  // ============ 扩展更新自检（v7.3.0：旧版本问题根治） ============
  // Extension update self-check: compare the last injected version against the
  // manifest version; on change, show a one-time toast asking for a page
  // refresh. Content scripts of an updated extension do NOT re-inject into
  // already-open tabs, so a stale page silently runs old logic — the root
  // cause of many "settings not saving" reports.
  const EXT_VER_KEY = 'extLastInjectedVersion';
  function checkExtensionUpdate() {
    try {
      const ver = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '';
      if (!ver) return;
      chrome.storage.local.get(EXT_VER_KEY, (res) => {
        const last = res[EXT_VER_KEY];
        if (last && last !== ver) showUpdateToast(ver);
        if (last !== ver) chrome.storage.local.set({ [EXT_VER_KEY]: ver });
      });
    } catch {
      /* 存储不可用时静默（不影响主流程） */
    }
  }

  function showUpdateToast(ver) {
    try {
      if (document.getElementById('gr-update-toast')) return;
      const toast = document.createElement('div');
      toast.id = 'gr-update-toast';
      toast.textContent = `游戏雷达已更新至 v${ver}，刷新页面后生效（当前页仍为旧版本）`;
      const refresh = document.createElement('button');
      refresh.type = 'button';
      refresh.textContent = '刷新';
      refresh.addEventListener('click', () => window.location.reload());
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'gr-update-close';
      close.textContent = '✕';
      close.addEventListener('click', () => toast.remove());
      toast.appendChild(refresh);
      toast.appendChild(close);
      (document.documentElement || document.body).appendChild(toast);
    } catch {
      /* DOM 未就绪或样式异常时静默 */
    }
  }

  // 顶层立即执行（document_start 阶段 html 元素已存在）
  checkExtensionUpdate();

  // Message listener / 消息监听（模块句柄惰性获取）
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'REFRESH_RECOMMENDATIONS') {
      // 刷新推荐需要 settings 来读取高亮阈值，并应用虚拟机过滤
      (async () => {
        try {
          const { M } = await bootPromise;
          const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_SETTINGS' });
          const settings = resp?.settings;
          if (!settings) {
            sendResponse({ success: false });
            return;
          }
          const adapter = M.builder.getAdapter();
          if (M.list.isListPageByUrl() || adapter.isListPage()) {
            let items = M.list.getListItemsSmart(adapter);
            // 应用关键词过滤规则（若已启用；v7.2.0 修正参数——原传 vmFilterKeywords 数组）
            if (settings.enableVmFilter) {
              items = M.list.applyVmFilter(items, settings);
            }
            M.list.requestRecommendations(items, settings);
          }
          sendResponse({ success: true });
        } catch (e) {
          sendResponse({ success: false, error: String(e) });
        }
      })();
      return true; // 异步响应 / Async response
    }
    if (message.action === 'SHOW_LAST_STATS') {
      // 弹窗请求重新显示最近一次统计 / Popup asks to re-show the latest stats
      if (MODULES) MODULES.status.showLastStats();
      else bootPromise.then(({ M }) => M.status.showLastStats()).catch(() => {});
      sendResponse({ success: true });
      return; // 同步响应，无需保持消息通道 / sync response, no channel held
    }
    if (message.action === 'STEAM_RATINGS_UPDATE') {
      // 后台推送：缓存未命中的游戏已从 Steam 拉取完成（多波增量，done 标记收尾）
      // Background push: cache misses fetched from Steam (incremental waves + done)
      // 模块已就绪时同步应用（徽章即时渲染）；否则等 boot 完成后处理
      if (MODULES) MODULES.list.applySteamRatingsUpdate(message.ratings, message.done === true);
      else
        bootPromise
          .then(({ M }) => M.list.applySteamRatingsUpdate(message.ratings, message.done === true))
          .catch((e) => {
            // v6.4.10：推送处理错误可见（此前静默吞错——偶发状态下徽章丢失难排查）
            console.warn('【游戏雷达】 好评率推送处理失败:', e);
          });
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
          const { M } = await bootPromise;
          const names = new Set();
          const appIds = new Set();
          if (M.list.isDetailPageByUrl()) {
            const gn = M.detail.detectGameName();
            if (gn && gn.length > 1) names.add(gn);
            const img = M.builder.extractSteamImageInfo(document);
            if (img) appIds.add(img.appId);
          } else {
            const adapter = M.builder.getAdapter();
            if (M.list.isListPageByUrl() || adapter.isListPage()) {
              M.list.getListItemsSmart(adapter).forEach((item) => {
                if (item.name) names.add(item.name);
                const info = M.builder.extractSteamImageInfo(item.element);
                if (info) appIds.add(info.appId);
              });
            }
          }
          const resp = await window.__GR_MSG__.sendMessage({
            action: 'CLEAR_CACHE_FOR_PAGE',
            names: [...names],
            appIds: [...appIds]
          });
          M.debug.dbg(`♻️ 强制刷新：已清除 ${resp && resp.cleared} 条缓存，重载页面`);
          sendResponse({ success: true, cleared: resp && resp.cleared });
          location.reload();
        } catch (e) {
          sendResponse({ success: false, error: String(e) });
        }
      })();
      return true; // 异步响应 / Async response
    }
    // v3.4.1：未处理的消息不返回 true（不无谓地保持消息通道，避免拖住
    // Service Worker 生命周期）/ Unhandled messages return nothing, so no
    // message channel is held open
  });
})();
