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

const dbg = (...a) => debug.dbg(...a);
const BTN_FAIL_FEEDBACK_MS = 1500; // 按钮失败文案恢复延时（v14.6.2：具名单点，两按钮共用）
const esc = (text) => common.escapeHtml(text);

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
export function createSteamFloat(gameName, settings) {
  dbg('注入Steam浮窗...');
  floatModules = (settings && settings.floatModules) || null;

  const panel = float.create(
    settings && settings.detailFloatSide === 'right' ? float.ZONE.TOP_RIGHT : float.ZONE.TOP_LEFT,
    'gr-steam-float',
    {
      chrome: true,
      width: 320,
      title: '🎮 Steam 信息',
      folded: settings ? settings.detailFloatExpanded === false : false
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

  /** @type {SteamLookupData|null} */
  let steamData = null;

  function showPanel() {
    panel.style.opacity = '1';
    panel.style.transform = 'translateX(0)';
    panel.style.pointerEvents = 'auto';
  }

  function hidePanel() {
    // 折叠内容区（chrome 标题栏保留）/ fold the body (header stays)
    panel.style.display = 'none';
  }

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
          { timeout: 25000 }
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

  // v14.5.0 B7：报错重检索/手动刷新回调统一为 createSteamActions 工厂
  //（状态 steamData/reportIssue 经存取器互通——原两份同构闭包收敛单点）。
  // steamData 本地引用保留为工厂状态的只读镜像（renderAndShow 同步读用）。
  /** @type {(() => Promise<void>)|null} */
  let reportIssue = null;
  const actions = createSteamActions({ panel, hidePanel, showPanel, renderSteamSidebar, renderAndShow });

  // 渲染数据并显示浮窗的通用函数
  function renderAndShow(data, cachedAt, name) {
    steamData = data;
    actions.setSteamData(data);
    reportIssue = actions.makeReportIssue(name);
    actions.setReportIssue(reportIssue);
    debug.DEBUG.steamStatus = `✅ ${data.ratingDesc || ''} ${data.positiveRate || ''}%`;
    dbg(`Steam: ${data.name} - ${data.ratingDesc} ${data.positiveRate}%`);
    renderSteamSidebar(panel, data, hidePanel, cachedAt, actions.makeOnRefresh(name), reportIssue);
    showPanel();

    // v10.1.0：AppID 写 DOM 数据桥接——download-tracking 的点击委托（隔离世界
    // 同全局可读）随 click_download 事件带上 appId，后台据此累计下载计数 a
    try {
      if (data.appId) document.documentElement.dataset.grAppId = String(data.appId);
    } catch {
      /* ignore */
    }

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
        { timeout: 25000 }
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
            { timeout: 25000 }
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
        debug.DEBUG.steamStatus = '❌ 未找到';
        // v14.7 批次 3/4：本页已"跳过"的游戏不再自动弹候选浮窗（负缓存首档
        // 15min 到期后下次访问自动重查）
        if (candidates.isGameDismissed(gameName)) {
          dbg('Steam: 用户已跳过该游戏，本页不再自动弹候选浮窗');
          return;
        }
        // v14.7 批次 9：网络故障/熔断期未命中 → 30s 后静默自动重查一次
        //（正常未找到 not-found 不浪费请求）
        const missReasonAuto = String((response && response.reason) || '');
        if (/steam-api-unreachable|circuit/i.test(missReasonAuto)) {
          scheduleAutoRetry(gameName);
        }
        dbg('Steam: 自动搜索未找到，显示手动选择浮窗');
        // v10.9.3：未命中原因透传 + 重试（穿透负缓存重新自动匹配）
        const missReason = (response && response.reason) || '';
        candidates.renderManualSelectPanel(
          panel,
          gameName,
          hidePanel,
          (selectedData, selectedAppId) => {
            cancelAutoRetry(); // v14.7 批次 9：手动选择后自动重查作废
            renderAndShow(selectedData, Date.now(), gameName);
            chrome.runtime
              .sendMessage({
                action: 'SAVE_MANUAL_MAPPING',
                // v9.7.0：gameName 为契约必填字段——漏发会被消息契约层直接拒绝，
                // 手动纠错映射永不保存（报错重检索路径一直带着，此处是遗漏）
                gameName,
                appId: selectedAppId
              })
              .catch(() => {});
          },
          missReason,
          async () => {
            const retryResp = await window.__GR_MSG__
              .sendMessage(
                { action: 'SEARCH_STEAM', gameName, rawTitle: document.title, ignoreNegativeCache: true },
                null,
                { timeout: 25000 }
              )
              .catch(() => null);
            if (retryResp && retryResp.data) {
              renderAndShow(retryResp.data, retryResp.cachedAt || Date.now(), gameName);
              return true;
            }
            return false;
          }
        );
        showPanel();
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
function renderSteamSidebar(panel, data, onClose, cachedAt, onRefresh, onReport) {
  panel.innerHTML = detailTemplates.steamSidebar(
    floatModules ? { ...data, floatModules } : data,
    cachedAt,
    !!onRefresh,
    !!onReport
  );

  // 绑定手动更新按钮事件
  if (onRefresh) {
    const refreshBtn = panel.querySelector('#gr-refresh-cache-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        const originalText = refreshBtn.textContent;
        refreshBtn.textContent = '⏳ 更新中...';
        refreshBtn.disabled = true;
        try {
          await onRefresh();
        } catch {
          refreshBtn.textContent = '❌ 更新失败';
          setTimeout(() => {
            refreshBtn.textContent = originalText;
            refreshBtn.disabled = false;
          }, BTN_FAIL_FEEDBACK_MS);
        }
      });
    }
  }

  // 绑定报错按钮事件（v3.3.11：人工纠错 → 清缓存重检索）
  if (onReport) {
    const reportBtn = panel.querySelector('#gr-report-issue-btn');
    if (reportBtn) {
      reportBtn.addEventListener('click', async () => {
        const originalText = reportBtn.textContent;
        reportBtn.textContent = '⏳ 重新检索中...';
        reportBtn.disabled = true;
        try {
          await onReport();
        } catch {
          reportBtn.textContent = '❌ 重检索失败';
          setTimeout(() => {
            reportBtn.textContent = originalText;
            reportBtn.disabled = false;
          }, BTN_FAIL_FEEDBACK_MS);
        }
      });
    }
  }

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
  if (!inlineEnabled) return;
  const seq = ++inlineRenderSeq;
  loadInlineCard()
    .then((m) => {
      if (seq !== inlineRenderSeq) return; // 已被更新的渲染取代 / superseded
      m.renderInlineSteamSection(data, cachedAt);
    })
    .catch((e) => dbg('内嵌信息卡模块加载失败: ' + String(e)));
}
