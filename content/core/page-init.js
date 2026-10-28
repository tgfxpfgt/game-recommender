/**
 * 游戏雷达 Game Radar - 页面检测与功能分发 / Page Detection & Feature Dispatch
 *
 * v14.5.0 B7：由 tracker.js init() 迁出——tracker 收敛为"装载器"（模块加载
 * + 预热 + 消息接线），本模块承接页面类型检测（URL 优先/DOM 辅助）与各域
 * 功能分派（列表/详情/首页/Steam 页/追踪/二维码/布局定制）。
 * Moved from tracker.js init() (B7): tracker stays the loader; this module
 * owns page-type detection and per-domain feature dispatch.
 */

// 核心初始化（URL 检测页面类型 → 分发各域功能）
// boot = { M, settings }（tracker bootPromise 的解析值）
export async function initPage(boot) {
  const { M, settings: bootSettings } = boot;
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
  // v10.6.0 F4：主题定时切换解析（浮窗 data-theme 跟随日/夜选择）
  let effectiveTheme = settings.uiTheme || 'steam';
  if (settings.themeAutoSwitch === true) {
    const h = new Date().getHours();
    effectiveTheme = h >= 19 || h < 7 ? settings.uiThemeNight || 'oled' : settings.uiThemeDay || 'steam';
  }
  M.floats.applyFloatTheme(effectiveTheme);

  // v14.7 批次 13（B 路）：tracker boot 已加载规则并构建适配器——此处重复
  // 构建为纯开销（rules 有缓存守卫不重发消息，但 adapter 重建是实打实的）。
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

  // v10.4.4：Steam 标签页（/tags/）不注入——标签聚合页没有单一游戏对象，
  // 浮窗/评分/追踪均无意义且干扰浏览（用户需求：扩展在 tags 页应不工作）
  if (isSteamPage && window.location.pathname.startsWith('/tags/')) {
    dbg('Steam 标签页：跳过注入');
    return;
  }

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

  // === v10.5.3 任务2：下载站首页错位修复 ===
  // 各下载站首页混排轮播/新闻/多尺寸卡片，列表功能（徽章插入/网格重排/
  // 过滤控件）会打破站点原生布局（用户反馈首页显示错位）。首页（根路径或
  // /index.html 且无查询串）暂停列表与详情功能，仅保留下载追踪与二维码
  // 转链接；带查询串的根路径（如 WordPress 搜索 /?s=）仍按列表页处理。
  // Download-site homepages mix carousels/news/varied cards and break under
  // list features; suspend them there (keep download tracking + QR unlock).
  // Root paths WITH a query string (e.g. /?s=) still run the list flow.
  if (list.isHomePageUrl()) {
    debug.DEBUG.pageType = '首页';
    dbg('🏠 下载站首页：跳过列表/详情功能（防错位），仅保留下载追踪与二维码');
    tracking.setupDownloadTracking(settings);
    M.qrUnlock?.init?.(settings);
    return;
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
    // v10.5.1 任务1：列表页好评率过滤悬浮控件（开关+滑块，实时调节）
  }

  // === 2. 下载追踪（v10.3.0 独立开关；v10.5.0 P3 起真正生效——关闭则不接线）===
  tracking.setupDownloadTracking(settings);

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
      detail.injectSteamButton(gameName, settings);
      detail.injectDownloadHistoryPanel(gameName);
    } else if (appIdFromImg) {
      // 仅有 appId 无游戏名：用 document.title 作为回退名，仅注入 Steam 浮窗
      // v5.0.0：清洗链收敛至 common.cleanPageTitle
      const fallbackName = common.cleanPageTitle(document.title);
      debug.DEBUG.gameName = fallbackName || `(appId:${appIdFromImg})`;
      dbg(`详情页游戏名为空，但图片含 appId: ${appIdFromImg}，使用回退名注入 Steam 浮窗`);
      detail.injectSteamButton(fallbackName || '', settings);
    } else {
      dbg('⚠️ 详情页未检测到游戏名称');
    }
  } else if (!isList) {
    dbg('⚠️ 未识别页面类型');
  }

  // === 4. v10.2.0：二维码转链接 + XDGAME 列表布局定制 ===
  // v10.3.0：传入 settings（各内容功能独立开关，关闭早退互不影响）；放在
  // 主流程末尾——二维码扫描/布局定制不与徽章/评分流程竞争初始化时序
  //（E2E 间歇性 3b 失败定位：早期初始化的 MutationObserver 介入波次时序）
  M.qrUnlock?.init?.(settings);
  M.xdgrid?.init?.(settings);

  dbg('✅ 初始化完成');
}
