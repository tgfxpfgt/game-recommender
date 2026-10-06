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
 */
import * as detailTemplates from './detail-templates.js';
import * as float from '../core/floats.js';
import * as status from '../core/status-bar.js';
import * as debug from '../core/debug.js';
import * as common from '../core/common.js';
import * as builder from '../adapters/builder.js';
import * as candidates from './candidates.js';
import * as tracking from './tracking.js';
import { fillItadAndFavorites, fillSteam250Info } from './sidebar-rows.js';
import { renderInlineSteamSection } from './inline-card.js';

const dbg = (...a) => debug.dbg(...a);
const esc = (text) => common.escapeHtml(text);

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

  // 人工报错重检索回调（v3.3.11）：清除错误 appid 缓存 → 重新检索 →
  // 更新浮窗；**重检索结果仍是同一 appid（未纠正）或失败时，自动进入
  // 手动选择面板**（v3.3.12）。reportIssue 在 renderAndShow 时创建
  // 并随渲染传递（makeOnRefresh 重渲染时复用同一回调）
  /** @type {(() => Promise<void>)|null} */
  let reportIssue = null;
  function makeReportIssue(name) {
    return async () => {
      const wrongAppId =
        steamData && steamData.appId ? String(steamData.appId) : builder.extractSteamAppIdFromImages() || '';
      dbg(`⚠️ 人工报错: 清除 appId ${wrongAppId} 缓存并重新检索 ${name}`);
      try {
        await window.__GR_MSG__.sendMessage({ action: 'REPORT_WRONG_APPID', appId: wrongAppId, gameName: name });
      } catch {
        /* 后台不可达不阻断重检索 */
      }
      // 重新检索：有封面 appId 直取，否则名称搜索
      const imgAppId = builder.extractSteamAppIdFromImages();
      /** @type {SteamLookupResp|null} */
      let resp = null;
      if (imgAppId) {
        resp = await window.__GR_MSG__.sendMessage({ action: 'GET_STEAM_BY_APPID', appId: imgAppId, gameName: name });
      }
      if (!resp || !resp.data) {
        resp = await window.__GR_MSG__.sendMessage({ action: 'SEARCH_STEAM', gameName: name });
      }
      // v3.3.12：重检索成功但结果仍是同一 appid（自动纠正失败）→ 手动选择
      const sameAppId = resp && resp.data && wrongAppId && String(resp.data.appId) === wrongAppId;
      if (resp && resp.data && !sameAppId) {
        steamData = resp.data;
        const newCachedAt = resp.cachedAt || Date.now();
        dbg(`✅ 报错重检索成功: ${steamData.name} (appId ${steamData.appId})`);
        renderSteamSidebar(panel, steamData, hidePanel, newCachedAt, makeOnRefresh(name), reportIssue);
        showPanel();
      } else {
        dbg(
          sameAppId ? `⚠️ 报错重检索仍是同一 appId ${wrongAppId}，进入手动选择` : '⚠️ 报错重检索未找到，进入手动选择'
        );
        // v10.9.3：重检路径同样带原因与重试
        candidates.renderManualSelectPanel(
          panel,
          name,
          hidePanel,
          (selData, selAppId) => {
            renderAndShow(selData, Date.now(), name);
            chrome.runtime
              .sendMessage({ action: 'SAVE_MANUAL_MAPPING', gameName: name, appId: selAppId })
              .catch(() => {});
          },
          '报错重检索仍未命中',
          async () => {
            const rr = await window.__GR_MSG__
              .sendMessage({ action: 'SEARCH_STEAM', gameName: name, ignoreNegativeCache: true }, null, {
                timeout: 25000
              })
              .catch(() => null);
            if (rr && rr.data) {
              renderAndShow(rr.data, rr.cachedAt || Date.now(), name);
              return true;
            }
            return false;
          }
        );
      }
    };
  }

  // 手动更新缓存回调（成功获取数据后复用渲染逻辑）
  function makeOnRefresh(name) {
    return async () => {
      const appId = builder.extractSteamAppIdFromImages();
      /** @type {SteamLookupResp|null} */
      let refreshResp;
      if (appId) {
        refreshResp = await window.__GR_MSG__.sendMessage({ action: 'GET_STEAM_BY_APPID', appId, gameName: name });
      } else {
        refreshResp = await window.__GR_MSG__.sendMessage({ action: 'REFRESH_STEAM_CACHE', gameName: name });
      }
      if (refreshResp && refreshResp.data) {
        steamData = refreshResp.data;
        const newCachedAt = refreshResp.cachedAt || Date.now();
        dbg(`🔄 手动刷新缓存成功: ${steamData.name}`);
        renderSteamSidebar(panel, steamData, hidePanel, newCachedAt, makeOnRefresh(name), reportIssue);
      } else {
        throw new Error('刷新后未获取到数据');
      }
    };
  }

  // 渲染数据并显示浮窗的通用函数
  function renderAndShow(data, cachedAt, name) {
    steamData = data;
    reportIssue = makeReportIssue(name);
    debug.DEBUG.steamStatus = `✅ ${data.ratingDesc || ''} ${data.positiveRate || ''}%`;
    dbg(`Steam: ${data.name} - ${data.ratingDesc} ${data.positiveRate}%`);
    renderSteamSidebar(panel, data, hidePanel, cachedAt, makeOnRefresh(name), reportIssue);
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
    fillSteam250Info(String(data.appId));
    // v10.6.0：ITAD 最低价行 + 收藏按钮（Key 未配置/无数据时自动隐藏）
    fillItadAndFavorites(String(data.appId), name, (steamData && steamData.releaseDate) || '');

    // 回写Steam标签（v14 B3：TRACK_EVENT 采集迁至 tracking.js）
    tracking.trackSteamTagsUpdate(data, name);
  }

  // 自动加载Steam数据：优先 appId 直取，回退名称搜索，都失败显示手动选择浮窗
  (async () => {
    debug.DEBUG.steamStatus = '查询中...';
    debug.scheduleDebugUpdate();
    status.showStatus('正在查询 Steam 信息', null, null, gameName); // 工作状态浮窗
    try {
      // v3.3.14：appId 提取限定主内容区——gamer520 侧边推荐图是 Steam CDN
      // 封面，全页提取会误取推荐游戏的 appId（如 16598 页右侧推荐 2001760）；
      // 主内容区无图时回退全页（后台另有 namesRelated 校验兜底）
      const mainEl = document.querySelector(
        'article, .entry-content, .post-content, .main-content, #main-content, main, .single-content'
      );
      const appId = builder.extractSteamAppIdFromImages(mainEl || document);
      /** @type {SteamLookupResp|null} */
      let response = null;
      if (appId) {
        dbg(`从图片URL提取到 appId: ${appId}，直接获取 Steam 详情`);
        response = await window.__GR_MSG__.sendMessage({ action: 'GET_STEAM_BY_APPID', appId, gameName });
      }

      if (!response || !response.data) {
        // v10.9.2：显式 25s 超时（GetNewsForApp 等 Steam 慢接口 + 搜索全链预算；
        // 默认 10s 会被大陆网络下 api.steampowered.com 的挂起拖爆）
        response = await window.__GR_MSG__.sendMessage({ action: 'SEARCH_STEAM', gameName }, null, { timeout: 25000 });
        // 未命中自动重试一次（穿透负缓存）——历史失败遗留的负缓存不再把
        // 可匹配的游戏永久推入手动选择；仅在"干净未命中"时重试（超时不重试）
        if (response && !response.data && !response.error) {
          response = await window.__GR_MSG__
            .sendMessage({ action: 'SEARCH_STEAM', gameName, ignoreNegativeCache: true }, null, { timeout: 25000 })
            .catch(() => null);
        }
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
        dbg('Steam: 自动搜索未找到，显示手动选择浮窗');
        // v10.9.3：未命中原因透传 + 重试（穿透负缓存重新自动匹配）
        const missReason = (response && response.reason) || '';
        candidates.renderManualSelectPanel(
          panel,
          gameName,
          hidePanel,
          (selectedData, selectedAppId) => {
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
              .sendMessage({ action: 'SEARCH_STEAM', gameName, ignoreNegativeCache: true }, null, { timeout: 25000 })
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
          }, 1500);
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
          }, 1500);
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
  renderInlineSteamSection(data, cachedAt);
}
