/**
 * 游戏雷达 Game Radar - Steam 信息浮窗模块（编排壳）/ Steam Info Float (orchestrator)
 *
 * v14 B3：由 detail-page.js 拆分——Steam 详情浮窗全生命周期：数据装载
 * （appId 直取/名称搜索/负缓存重试）、报错重检索与手动刷新回调、
 * 信息栏渲染与按钮绑定、Steam250/ITAD/收藏行填充、内嵌 Steam 信息区。
 * Split from detail-page.js (B3): the whole Steam-info float lifecycle.
 * 候选兜底在 candidates.js，下载面板与行为采集在 tracking.js。
 * v14.3.0（第五轮 B1）：653 行按域拆分——异步行填充 sidebar-rows.js、内嵌
 * 信息卡 inline-card.js；本文件保留浮窗编排（数据装载/纠错/刷新回调）与
 * DOM 绑定（renderSteamSidebar 单一挂点保持浮窗与内嵌卡同步）。
 * v14.5.0 B3：sidebar-rows / inline-card 改按需加载——两模块仅详情页浮窗
 * 渲染路径需要，列表页/首页/Steam 页零网络请求（getURL 动态 import，与
 * tracker 装载同模式；内嵌卡先做 features 预判，未声明站点连模块都不拉）。
 */
import * as detailTemplates from './detail-templates.js';
import * as float from '../core/floats.js';
import * as status from '../core/status-bar.js';
import * as debug from '../core/debug.js';
import * as common from '../core/common.js';
import * as builder from '../adapters/builder.js';
import * as candidates from './candidates.js';
import * as tracking from './tracking.js';
import { createSteamActions } from './sidebar-actions.js'; // v14.5.0 B7：回调工厂
// v14.26.0 P1-6：消息超时单源（Steam 检索为出站长超时）
import { MSG_TIMEOUT_LONG_MS } from '../core/timeouts.js';

const dbg = (...a) => debug.dbg(...a);
const BTN_FAIL_FEEDBACK_MS = 1500; // 按钮失败文案恢复延时（v14.6.2：具名单点，两按钮共用）
const MENU_INFO_TIMEOUT_MS = 5000; // v14.23.0：浮窗菜单缓存信息查询限时（具名单点）
const esc = (text) => common.escapeHtml(text);

// v14.23.0：浮窗菜单缓存信息上下文——renderAndShow 每次渲染刷新（当前游戏
// 名称/缓存时间），菜单打开时随全局缓存规模一并提供
// Menu cache-info context: refreshed by every renderAndShow, consumed when
// the float menu opens (combined with global cache stats from the backend).
const menuCacheContext = { name: '', cachedAt: null };
function buildMenuCacheInfo() {
  return (async () => {
    const rows = [];
    if (menuCacheContext.cachedAt) {
      rows.push('本游戏缓存：' + common.formatRelativeTime(menuCacheContext.cachedAt));
    }
    try {
      const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_FLOAT_CACHE_INFO' }, null, {
        timeout: MENU_INFO_TIMEOUT_MS
      });
      if (resp && resp.success && resp.steamCache) {
        rows.push(
          `Steam 缓存：${resp.steamCache.entries} 条（命中 ${resp.steamCache.hits} / 未中 ${resp.steamCache.misses}）`
        );
        rows.push(`负缓存（匹配失败记录）：${resp.negativeCacheCount} 条`);
      }
    } catch {
      rows.push('缓存信息不可用');
    }
    return rows;
  })();
}

// ============ 详情页专属子模块按需加载（v14.5.0 B3） ============
// Promise 单例：并发渲染共享同一次模块加载；getURL 由 sim mock 解析到同一
// 文件 URL，实例与静态导入时代一致（无状态分裂）。
// Lazy loaders (promise singletons): concurrent renders share one fetch; the
// sim getURL mock resolves to the same file URL, so instances match the
// static-import era exactly.
/** @type {Promise<any>|null} */
let sidebarRowsMod = null;
/** @type {Promise<any>|null} */
let inlineCardMod = null;
function loadSidebarRows() {
  if (!sidebarRowsMod) {
    sidebarRowsMod = /** @type {Promise<any>} */ (import(chrome.runtime.getURL('content/detail/sidebar-rows.js')));
  }
  return sidebarRowsMod;
}
function loadInlineCard() {
  if (!inlineCardMod) {
    inlineCardMod = /** @type {Promise<any>} */ (import(chrome.runtime.getURL('content/detail/inline-card.js')));
  }
  return inlineCardMod;
}

/**
 * Steam 详情数据载荷（GET_STEAM_BY_APPID / SEARCH_STEAM 响应 data，v14 B5 类型化）
 * @typedef {Object} SteamLookupData
 * @property {string|number} appId
 * @property {string} name
 * @property {string} [ratingDesc]
 * @property {number} [positiveRate]
 * @property {boolean} [chineseSupported]
 * @property {Array<string>} [genres]
 * @property {string} [releaseDate]
 */
/**
 * Steam 检索响应（data + 缓存时间/失败原因）
 * @typedef {Object} SteamLookupResp
 * @property {SteamLookupData} data
 * @property {number} [cachedAt]
 * @property {string} [error]
 * @property {string} [reason]
 */

// ============ Steam详情浮窗（v6.4.4 起左侧信息栏） ============
// 容器经 GR.float 统一管理（左上区域，chrome 标题栏含折叠/关闭）
// v10.4.0：接收 settings——浮窗位置（detailFloatSide 左/右）与默认展开
// （detailFloatExpanded）可配置
let floatModules = null; // v12 B4：浮窗模块显隐设置（注入时随 settings 传入）
let inlineRenderSeq = 0; // v14.5.0 B3：内嵌卡渲染令牌（按需加载窗口内重渲染防旧卡回挂）

// 由 detail-page.js 入口（injectSteamButton）委托调用——tracker 调用面不变。

/**
 * 浮窗外壳（v14.14.0 提取，重构序 6c）：创建 + 初始隐藏动画 + 占位文案 +
 * 显隐助手（floatModules 显隐设置随 settings 注入模块级变量，语义同前）。
 * v14.24.0：⚙ 菜单浮窗专属项（menuItems）透传。
 * @param {{[k: string]: any}} settings
 * @param {Array<{action?: string, label: string, title?: string, onClick?: (btn: HTMLElement) => void | Promise<void>}>} menuItems
 */
function createFloatShell(settings, menuItems) {
  floatModules = (settings && settings.floatModules) || null;
  const panel = float.create(
    settings && settings.detailFloatSide === 'right' ? float.ZONE.TOP_RIGHT : float.ZONE.TOP_LEFT,
    'gr-steam-float',
    {
      chrome: true,
      width: 320,
      title: '🎮 Steam 信息',
      folded: settings ? settings.detailFloatExpanded === false : false,
      menuInfo: buildMenuCacheInfo, // v14.23.0：⚙ 菜单缓存信息区
      menuItems // v14.24.0：手动更新/重新检索/选择机型迁入 ⚙ 菜单（用户需求）
    }
  );
  // 初始隐藏，数据就绪后滑入显示（保留原动画语义）
  panel.style.cssText +=
    'opacity:0;transform:translateX(20px);pointer-events:none;transition:opacity 0.3s,transform 0.3s;';
  panel.innerHTML = `
      <div style="padding:16px;text-align:center;color:#8f98a0;">
        <div style="font-size:24px;margin-bottom:8px;">🎮</div>
        正在查询 Steam 信息...
      </div>
    `;
  function showPanel() {
    panel.style.opacity = '1';
    panel.style.transform = 'translateX(0)';
    panel.style.pointerEvents = 'auto';
  }
  function hidePanel() {
    // 折叠内容区（chrome 标题栏保留）/ fold the body (header stays)
    panel.style.display = 'none';
  }
  return { panel, showPanel, hidePanel };
}

// ============ 网络故障期自动重查（v14.14.0 提取，v14.7 批次 9 语义）/ Auto retry ============

/**
 * 自动重查控制器：网络故障期未命中 → 30s 后静默自动重查一次（穿透负缓存）；
 * 正常未找到（not-found）不浪费请求。手动选择/报错/跳过后定时器作废，
 * 每游戏至多一次（防风暴）。
 * @param {{renderAndShow: (data: Object, cachedAt: number|null, name: string) => void}} io
 */
function createAutoRetry(io) {
  const { renderAndShow } = io;
  // v14.7 批次 9：网络故障期未命中 → 30s 后静默自动重查一次（穿透负缓存）；
  // 正常未找到（not-found）不浪费请求。手动选择/报错/跳过后定时器作废。
  // Delayed auto-retry after a network-failure miss (single shot, 30s).
  const AUTO_RETRY_DELAY_MS = 30000; // 批次 9（内容侧具名单源）
  /** @type {ReturnType<typeof setTimeout>|null} */
  let autoRetryTimer = null;
  /** @type {Set<string>} */
  const autoRetriedGames = new Set(); // 每游戏至多一次（防风暴）
  function cancelAutoRetry() {
    if (autoRetryTimer) {
      clearTimeout(autoRetryTimer);
      autoRetryTimer = null;
    }
  }
  function scheduleAutoRetry(name) {
    if (autoRetriedGames.has(name)) return;
    autoRetriedGames.add(name);
    cancelAutoRetry();
    autoRetryTimer = setTimeout(async () => {
      autoRetryTimer = null;
      if (candidates.isGameDismissed(name)) return; // 用户已跳过 → 不再打扰
      dbg('Steam: 网络故障期未命中，自动重查:', name);
      try {
        const resp = await window.__GR_MSG__.sendMessage(
          {
            action: 'SEARCH_STEAM',
            gameName: name,
            rawTitle: document.title,
            ignoreNegativeCache: true
          },
          null,
          { timeout: MSG_TIMEOUT_LONG_MS }
        );
        if (resp && resp.data) {
          renderAndShow(resp.data, resp.cachedAt || null, name);
          status.showStats({
            title: 'Steam 信息（自动重查命中）',
            summary: `${resp.data.ratingDesc || '暂无评价'} ${resp.data.positiveRate != null ? resp.data.positiveRate + '%' : ''}`,
            rows: [`AppID ${resp.data.appId} · ${resp.data.name}`, '网络恢复后已自动完成匹配']
          });
        }
      } catch {
        /* 重查失败保持候选浮窗现状 */
      }
    }, AUTO_RETRY_DELAY_MS);
  }
  return { cancelAutoRetry, scheduleAutoRetry };
}

// ============ 未命中处理（v14.14.0 提取）/ Lookup-miss handling ============

/**
 * 未命中处理：已跳过检查 → 网络故障/熔断期自动重查 → 手动选择浮窗
 *（未命中原因透传 + 穿透负缓存重试）。
 * v14.24.0：手动面板装配收口 io.openManualSelect（⚙ 菜单"选择机型"直达
 * 与未命中兜底同源装配；原先内联的候选面板参数随装配收进工厂）。
 * @param {string} gameName
 * @param {{reason?: string, [k: string]: any}|null} response
 * @param {{scheduleAutoRetry: (name: string) => void, openManualSelect: (name: string, opts?: {reason?: string, openPlatformView?: boolean}) => void}} io
 */
function handleLookupMiss(gameName, response, io) {
  const { scheduleAutoRetry, openManualSelect } = io;
  debug.DEBUG.steamStatus = '❌ 未找到';
  // v14.7 批次 3/4：本页已"跳过"的游戏不再自动弹候选浮窗（负缓存首档
  // 15min 到期后下次访问自动重查）
  if (candidates.isGameDismissed(gameName)) {
    dbg('Steam: 用户已跳过该游戏，本页不再自动弹候选浮窗');
    return;
  }
  // v14.7 批次 9：网络故障/熔断期未命中 → 30s 后静默自动重查一次
  //（正常未找到 not-found 不浪费请求）
  // v14.31.0（双管线一致性）：优先消费结构化 errorType（与列表 networkFailed
  // 哨兵同名同义——铁律 14 故障三态），reason 正则保留兼容旧响应形状。
  const missErrorType = String((response && response.errorType) || '');
  const missReasonAuto = String((response && response.reason) || '');
  if (missErrorType === 'network' || /steam-api-unreachable|circuit/i.test(missReasonAuto)) {
    scheduleAutoRetry(gameName);
  }
  dbg('Steam: 自动搜索未找到，显示手动选择浮窗');
  // v10.9.3：未命中原因透传 + 重试（穿透负缓存重新自动匹配）
  const missReason = (response && response.reason) || '';
  openManualSelect(gameName, { reason: missReason });
}

export function createSteamFloat(gameName, settings) {
  dbg('注入Steam浮窗...');
  // v14.24.0（用户需求：手动更新/重新检索/选择机型迁入右上角 ⚙ 菜单）：菜单项
  // 持久（浮窗创建一次），回调经 menuState 注册表取每次渲染的最新闭包——
  // renderAndShow 重渲染时刷新注册表（name/refresh/report），菜单点击永远
  // 作用于当前游戏。
  // v14.24.0: persistent ⚙ menu items resolve the latest callbacks through the
  // menuState registry, refreshed on every renderAndShow.
  /** @type {{name: string, refresh: (() => Promise<void>) | null, report: (() => Promise<void>) | null}} */
  const menuState = { name: gameName, refresh: null, report: null };
  const floatMenuItems = [
    {
      action: 'steam-refresh',
      label: '🔄 手动更新 Steam 缓存',
      title: '清除缓存并从 Steam 重新拉取最新数据',
      onClick: async (/** @type {HTMLElement} */ btn) => {
        if (!menuState.refresh) return;
        const orig = btn.textContent;
        btn.textContent = '⏳ 更新中...';
        try {
          await menuState.refresh();
          btn.textContent = '✅ 已更新';
        } catch {
          btn.textContent = '❌ 更新失败';
        }
        setTimeout(() => {
          btn.textContent = orig;
        }, BTN_FAIL_FEEDBACK_MS);
      }
    },
    {
      action: 'steam-research',
      label: '⚠️ 信息有误？重新检索',
      title: '清除错误缓存并重新匹配（未命中进入手动选择）',
      onClick: async (/** @type {HTMLElement} */ btn) => {
        if (!menuState.report) return;
        const orig = btn.textContent;
        btn.textContent = '⏳ 重新检索中...';
        try {
          await menuState.report();
          btn.textContent = orig;
        } catch {
          btn.textContent = '❌ 重检索失败';
          setTimeout(() => {
            btn.textContent = orig;
          }, BTN_FAIL_FEEDBACK_MS);
        }
      }
    },
    {
      action: 'steam-platform',
      label: '🎮 选择主机机型',
      title: '声明为主机/模拟器游戏并转 Metacritic 评分',
      onClick: () => {
        openManualSelect(menuState.name || gameName, { openPlatformView: true });
      }
    }
  ];
  const { panel, showPanel, hidePanel } = createFloatShell(settings, floatMenuItems);

  /** @type {SteamLookupData|null} */
  let steamData = null;

  // v14.14.0（重构序 6c）：自动重查控制器提取为 createAutoRetry 工厂
  const { cancelAutoRetry, scheduleAutoRetry } = createAutoRetry({ renderAndShow });

  // v14.5.0 B7：报错重检索/手动刷新回调统一为 createSteamActions 工厂
  //（状态 steamData/reportIssue 经存取器互通——原两份同构闭包收敛单点）。
  // steamData 本地引用保留为工厂状态的只读镜像（renderAndShow 同步读用）。
  /** @type {(() => Promise<void>)|null} */
  let reportIssue = null;
  const actions = createSteamActions({ panel, hidePanel, showPanel, renderSteamSidebar, renderAndShow });

  // v14.24.0：手动选择面板装配收口——未命中兜底与 ⚙ 菜单"选择机型"直达
  // 共用同一装配（原先 handleLookupMiss 内联，菜单路径无从复用）。
  // Manual-select panel assembly unified: miss fallback and the menu's
  // platform item share one factory.
  function openManualSelect(name, opts = {}) {
    candidates.renderManualSelectPanel(
      panel,
      name,
      hidePanel,
      (selectedData, selectedAppId) => {
        cancelAutoRetry(); // v14.7 批次 9：手动选择后自动重查作废
        renderAndShow(selectedData, Date.now(), name);
        chrome.runtime
          .sendMessage({
            action: 'SAVE_MANUAL_MAPPING',
            // v9.7.0：gameName 为契约必填字段——漏发会被消息契约层直接拒绝，
            // 手动纠错映射永不保存（报错重检索路径一直带着，此处是遗漏）
            gameName: name,
            appId: selectedAppId,
            // v14.8 批次 3：rawTitle 随行——错题样本采集现场（后台确认后采集）
            rawTitle: document.title
          })
          .catch(() => {});
      },
      opts.reason || '',
      async () => {
        const retryResp = await window.__GR_MSG__
          .sendMessage(
            { action: 'SEARCH_STEAM', gameName: name, rawTitle: document.title, ignoreNegativeCache: true },
            null,
            {
              timeout: MSG_TIMEOUT_LONG_MS
            }
          )
          .catch(() => null);
        if (retryResp && retryResp.data) {
          renderAndShow(retryResp.data, retryResp.cachedAt || Date.now(), name);
          return true;
        }
        return false;
      },
      // v14.19.1：主机/模拟器机型选择消费 actions.makePickPlatform 单源工厂
      async (platformId) => {
        cancelAutoRetry();
        return actions.makePickPlatform(name)(platformId);
      },
      opts.openPlatformView === true // v14.24.0：菜单直达 → 渲染后直接切机型专页
    );
    showPanel();
  }

  // 渲染数据并显示浮窗的通用函数
  // v14.8 批次 5（第九轮 B6）：反向深链——Steam 页浮窗附"在下载站搜索"
  // （trackedSites 首站 WordPress ?s= 约定；本页已是下载站时无意义 → 门控）
  const reverseSiteDomain = (() => {
    const sites = (settings && settings.trackedSites) || [];
    const domain = window.location.hostname;
    const onTracked = sites.length === 0 || sites.some((s) => domain.includes(s));
    return onTracked ? null : sites[0] || null;
  })();

  function renderAndShow(data, cachedAt, name) {
    // v14.19.0：手动平台映射条目（MC 评分/平台标签，无 appId）——跳过 Steam
    // 侧联动（行填充/标签回写/访问记录/AppID 桥接），浮窗渲染 MC 视图模板
    const isPlatformEntry = !!(data && (data.platformOnly || data.mcScore != null));
    if (reverseSiteDomain && !isPlatformEntry) {
      data.downloadSiteSearchUrl =
        'https://' + reverseSiteDomain + '/?s=' + encodeURIComponent(name || data.name || '');
    }
    steamData = data;
    // v14.23.0：菜单缓存信息上下文刷新（cachedAt 空值 = 刚拉取的新数据）
    menuCacheContext.name = name || data.name || '';
    menuCacheContext.cachedAt = cachedAt || Date.now();
    // v14.24.0：⚙ 菜单回调注册表刷新（菜单项消费最新闭包）
    menuState.name = name || data.name || '';
    actions.setSteamData(data);
    reportIssue = actions.makeReportIssue(name);
    actions.setReportIssue(reportIssue);
    menuState.report = reportIssue;
    const onRefresh = actions.makeOnRefresh(name);
    menuState.refresh = onRefresh;
    debug.DEBUG.steamStatus = isPlatformEntry
      ? `🎮 ${data.platformTag || '主机'}${data.mcScore != null ? ` · MC ${data.mcScore}` : ''}`
      : `✅ ${data.ratingDesc || ''} ${data.positiveRate || ''}%`;
    dbg(`Steam: ${data.name} - ${data.ratingDesc || data.platformTag || ''} ${data.positiveRate || ''}`);
    renderSteamSidebar(panel, data, hidePanel, cachedAt);
    showPanel();

    // v14.19.0：平台条目（主机/模拟器映射）无 Steam 侧联动
    if (isPlatformEntry) return;
    // 记录下载站详情页访问（Steam 匹配成功后补充记录；后台同时累计详情页打开计数 b）
    common.trackDownloadSiteVisit(data.appId, name);

    // v10.4.4：Steam250 排名行（浮窗 + 内嵌卡双挂点；异步填充，无数据隐藏）
    // v10.6.0：ITAD 最低价行 + 收藏按钮（Key 未配置/无数据时自动隐藏）
    // v14.5.0 B3：两填充改按需模块调用——参数同步捕获（模块加载窗口期内
    // steamData 可能被重检索改写，读旧值保持与静态导入时代一致的语义）
    const appIdStr = String(data.appId);
    const releaseDate = (steamData && steamData.releaseDate) || '';
    loadSidebarRows()
      .then((rows) => {
        rows.fillSteam250Info(appIdStr);
        rows.fillItadAndFavorites(appIdStr, name, releaseDate);
        rows.fillSeriesInfo(appIdStr, name); // v14.16.0 N10：系列作品行
      })
      .catch((e) => dbg('浮窗行填充模块加载失败: ' + String(e)));

    // 回写Steam标签（v14 B3：TRACK_EVENT 采集迁至 tracking.js）
    tracking.trackSteamTagsUpdate(data, name);
  }

  // 自动加载Steam数据：单消息 SEARCH_STEAM（背景统一处理全匹配管线）
  (async () => {
    debug.DEBUG.steamStatus = '查询中...';
    debug.scheduleDebugUpdate();
    status.showStatus('正在查询 Steam 信息', null, null, gameName); // 工作状态浮窗
    try {
      // v3.3.14：appId 提取限定主内容区——gamer520 侧边推荐图是 Steam CDN
      // 封面，全页提取会误取推荐游戏的 appId（如 16598 页右侧推荐 2001760）
      const mainEl = document.querySelector(
        'article, .entry-content, .post-content, .main-content, #main-content, main, .single-content'
      );
      const imgAppId = builder.extractSteamAppIdFromImages(mainEl || document);
      /** @type {SteamLookupResp|null} */
      let response = null;
      // v14.3.2：单消息合并——appId(元素直取) / pageUrl(sender) / gameName / rawTitle
      // 四项提示一次发送，背景 resolveAppId 按 URL→元素+DLC→字典→搜索→兜底统一排序
      response = await window.__GR_MSG__.sendMessage(
        {
          action: 'SEARCH_STEAM',
          gameName,
          rawTitle: document.title,
          appId: imgAppId || undefined
        },
        null,
        { timeout: MSG_TIMEOUT_LONG_MS }
      );
      // 未命中自动重试一次（穿透负缓存）——历史失败遗留的负缓存不再把
      // 可匹配的游戏永久推入手动选择；仅在"干净未命中"时重试（超时不重试）
      if (response && !response.data && !response.error) {
        response = await window.__GR_MSG__
          .sendMessage(
            {
              action: 'SEARCH_STEAM',
              gameName,
              rawTitle: document.title,
              appId: imgAppId || undefined,
              ignoreNegativeCache: true
            },
            null,
            { timeout: MSG_TIMEOUT_LONG_MS }
          )
          .catch(() => null);
      }

      if (response && response.data) {
        renderAndShow(response.data, response.cachedAt || null, gameName);
        // 工作状态浮窗：完成统计 / Completion stats
        status.showStats({
          title: 'Steam 信息获取完成',
          summary: `${response.data.ratingDesc || '暂无评价'} ${response.data.positiveRate != null ? response.data.positiveRate + '%' : ''}`,
          rows: [
            `AppID ${response.data.appId} · ${response.data.name}`,
            response.data.chineseSupported ? '✓ 支持中文' : '✗ 暂不支持中文'
          ]
        });
      } else {
        // v14.14.0（重构序 6c）：未命中处理（跳过检查/自动重查/手动选择浮窗）
        // v14.24.0：手动面板装配收口 openManualSelect（菜单直达同源）
        handleLookupMiss(gameName, response, {
          scheduleAutoRetry,
          openManualSelect
        });
      }
    } catch (e) {
      debug.DEBUG.steamStatus = '❌ ' + String(e);
      dbg('Steam查询错误: ' + String(e));
      panel.innerHTML = `<div style="padding:16px;text-align:center;color:#e74c3c;">查询失败: ${esc(globalThis.__GR_MSG__.toUserMessage(e))}</div>`;
      showPanel();
      status.showStats({ title: 'Steam 信息查询失败', summary: String(e) });
    }
    debug.scheduleDebugUpdate();
  })();
}

// 仿Steam右侧信息栏渲染（v5.1.0：模板拆至 detailTemplates.steamSidebar，
// 本函数保留 DOM 绑定；模板按元素 id 约定输出）
// Steam-style info sidebar (template in GR.detailTemplates since v5.1.0;
// this function keeps the DOM bindings).
// v14.24.0（用户需求：手动更新/重新检索迁入 ⚙ 菜单）：底部两按钮移除——
// 绑定随按钮删除，动作改由浮窗菜单项承担（menuState 注册表，见 createSteamFloat）。
function renderSteamSidebar(panel, data, onClose, cachedAt) {
  // v14.19.0：平台条目（手动主机映射）——内嵌卡跳过（语义属 Steam 条目；
  // MC 视图提供"重新选择"语义由候选浮窗承担）
  const isPlatformEntry = !!(data && (data.platformOnly || data.mcScore != null));
  panel.innerHTML = detailTemplates.steamSidebar(floatModules ? { ...data, floatModules } : data, cachedAt);

  // 头部图片加载失败时按备选 CDN 域回退（v10.6.0），全部失败才隐藏
  const headerImg = panel.querySelector('#gr-header-image');
  if (headerImg)
    headerImg.addEventListener('error', () => {
      // CDN 备选域链：akamai → cloudflare → media（替代域对同一资源同路径）
      const hosts = ['cdn.akamai.steamstatic.com', 'cdn.cloudflare.steamstatic.com', 'media.steampowered.com'];
      const cur = hosts.indexOf(new URL(headerImg.src, window.location.href).hostname);
      const next = hosts[cur + 1];
      if (cur >= 0 && next) {
        headerImg.src = headerImg.src.replace(hosts[cur], next);
        return;
      }
      headerImg.style.display = 'none';
    });

  // v10.5.3 任务1：同步渲染内嵌 Steam 信息区（咸鱼单机/gamer520 详情页）——
  // 所有数据就绪路径（首次加载/手动选择/纠错重检索/手动刷新）都经过本函数，
  // 单一挂点保证浮窗与内嵌信息区始终同步
  // Keep the inline Steam info card in sync here: every ready-data path goes
  // through this function, so the float and the inline card never diverge.
  // v14.5.0 B3：内嵌卡模块按需加载 + 渲染令牌——异步加载窗口内浮窗可能重渲染
  //（刷新/纠错），过期令牌直接丢弃，防旧数据卡挂到新模板；features 预判与
  // inline-card 内部门控同源（未声明站点零模块加载，门控仍以模块内为权威）。
  let inlineEnabled = false;
  try {
    inlineEnabled = !!((builder.getAdapter() || {}).features || {}).inlineSteamCard;
  } catch {
    /* 适配器不可用时跳过 / skip when the adapter is unavailable */
  }
  if (!inlineEnabled || isPlatformEntry) return; // v14.19.0：平台条目不渲染内嵌 Steam 卡
  const seq = ++inlineRenderSeq;
  loadInlineCard()
    .then((m) => {
      if (seq !== inlineRenderSeq) return; // 已被更新的渲染取代 / superseded
      m.renderInlineSteamSection(data, cachedAt);
    })
    .catch((e) => dbg('内嵌信息卡模块加载失败: ' + String(e)));
}
