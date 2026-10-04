/**
 * 游戏雷达 Game Radar - Steam 信息浮窗模块 / Steam Info Float Module
 *
 * v14 B3：由 detail-page.js 拆分——Steam 详情浮窗全生命周期：数据装载
 * （appId 直取/名称搜索/负缓存重试）、报错重检索与手动刷新回调、
 * 信息栏渲染与按钮绑定、Steam250/ITAD/收藏行填充、内嵌 Steam 信息区
 * （XDGame 同款信息卡，站点按 features.inlineSteamCard 门控）。
 * Split from detail-page.js (B3): the whole Steam-info float lifecycle —
 * data loading, report/refresh callbacks, sidebar rendering & button
 * bindings, Steam250/ITAD/favorites row fills, and the inline info card.
 * 候选兜底在 candidates.js，下载面板与行为采集在 tracking.js。
 */
import * as detailTemplates from './detail-templates.js';
import * as float from '../core/floats.js';
import * as status from '../core/status-bar.js';
import * as debug from '../core/debug.js';
import * as common from '../core/common.js';
import * as builder from '../adapters/builder.js';
import * as candidates from './candidates.js';
import * as tracking from './tracking.js';

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

// v10.6.0：ITAD 最低价行 + 收藏按钮（F1/F2）
// ITAD：Key 未配置或查询失败 → 行隐藏；收藏：按钮切换 + 状态持久化
async function fillItadAndFavorites(appId, name, releaseDate) {
  // v12 B6
  const itadEl = document.getElementById('gr-itad-row');
  // —— 收藏按钮（状态经 GET_FAVORITES 查询；点击 TOGGLE_FAVORITE）——
  // v12 B6：releaseDate 由调用方（renderAndShow → fillItadAndFavorites）传入
  if (itadEl) {
    const favRow = document.createElement('div');
    favRow.id = 'gr-fav-row-inner';
    favRow.style.marginTop = '4px';
    itadEl.parentNode.insertBefore(favRow, itadEl);
    const renderFav = (favorited) => {
      favRow.innerHTML = '';
      const btn = document.createElement('button');
      btn.textContent = favorited ? '★ 已收藏' : '☆ 收藏';
      btn.style.cssText = `padding:2px 10px;font-size:11px;cursor:pointer;border-radius:3px;border:1px solid ${favorited ? '#f1c40f' : '#666'};background:transparent;color:${favorited ? '#f1c40f' : '#aaa'}`;
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        try {
          const resp = await window.__GR_MSG__.sendMessage(
            {
              action: 'TOGGLE_FAVORITE',
              appId,
              name: name || '',
              releaseDate: releaseDate || '' // v12 B6：发售追踪
            },
            null,
            { timeout: 5000 }
          );
          if (resp && resp.favorited !== undefined) renderFav(resp.favorited);
        } catch {
          /* 后台不可达静默 */
        }
      });
      favRow.appendChild(btn);
    };
    try {
      const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_FAVORITES' }, null, { timeout: 5000 });
      const favs = (resp && resp.favorites) || {};
      renderFav(!!favs[appId]);
    } catch {
      favRow.style.display = 'none';
    }
  }
  // —— ITAD 最低价行（Key 未配置时后台返回 null → 行隐藏）——
  if (!itadEl) return;
  try {
    const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_ITAD_LOWEST', appId }, null, { timeout: 20000 });
    const info = resp && resp.info;
    if (!info || info.price === undefined || info.price === null) {
      itadEl.style.display = 'none';
      return;
    }
    const shop = info.shop ? ` @ ${esc(info.shop)}` : ''; // v10.9.1：shop 一并转义
    const price = Number(info.price); // v10.9.1：异型防 "NaN"
    if (!isFinite(price)) throw new Error('bad-price');
    itadEl.innerHTML = `💰 ITAD 历史最低: <b style="color:#67c1f5;">${price.toFixed(2)}</b>${shop} <a href="https://isthereanydeal.com" target="_blank" rel="noopener" style="color:#67c1f5;text-decoration:none;">ITAD ↗</a>`;
    itadEl.style.display = '';
  } catch {
    itadEl.style.display = 'none';
  }
}

// v10.4.4：Steam250 排名行填充（查询后台快照；游戏不在前 250 时隐藏）
async function fillSteam250Info(appId) {
  if (!appId) return;
  try {
    const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_STEAM250_RANK', appId }, null, { timeout: 25000 });
    const info = resp && resp.info;
    const html = info
      ? `🏆 Steam250 排名 <b style="color:#67c1f5;">#${info.rank ?? '-'}</b> · ${info.score ?? '-'} 分 · ${Number(info.votes || 0).toLocaleString()} 条评价 ` + // v10.9.1
        `<a href="https://steam250.com/top250" target="_blank" rel="noopener" style="color:#67c1f5;text-decoration:none;">Steam250 ↗</a>`
      : '';
    for (const id of ['gr-steam250-row', 'gr-steam250-inline']) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (html) {
        el.innerHTML = html;
        el.style.display = '';
      } else {
        el.style.display = 'none';
      }
    }
  } catch {
    /* 查询失败静默（行保持隐藏） */
  }
}

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

// ============ v10.5.3 任务1：内嵌 Steam 信息区（咸鱼单机/gamer520） ============
// XDGame 站点原生详情页自带「Steam 玩家评价」信息区，咸鱼单机/gamer520 没有。
// 在这两站详情页标题下方注入与 XDGame 完全一致的信息卡（模板见
// detailTemplates.steamInlineSection，样式为 XDGame article_steam_rating_
// 20260905.css 的 1:1 译本，见下方 INLINE_SECTION_CSS）。与浮窗互补：信息卡
// 纯展示随页面排版，浮窗保留交互（刷新缓存/人工纠错/手动选择）。站点按适配
// 器 key 门控，避免与 XDGame 原生信息区重复。
// Inline Steam review card for xianyudanji/gamer520 (XDGame has a native
// one): a pixel-faithful replica — template in detailTemplates, stylesheet
// below translated 1:1 from XDGame's own CSS. Display-only companion to the
// interactive float, gated by adapter key.
const INLINE_SECTION_ID = 'gr-steam-inline-section';
const INLINE_SECTION_STYLE_ID = 'gr-steam-inline-style';

// XDGame article_steam_rating_20260905.css 1:1 译本：
//  · `.soft-detail .steam-review-*` → `#gr-steam-inline-section .steam-review-*`
//    （作用域挂到注入容器 id，不泄漏到宿主页、不影响 XDGame 原生卡片）
//  · `body.night .soft-detail *` → `#gr-steam-inline-section.gr-night *`
//    （XDGame 夜间为整站 body.night；宿主页以背景亮度判定后加 .gr-night 类）
//  · 字体/盒模型基线取自 XDGame 页面（layui body：14px Helvetica Neue 栈）
// 1:1 translation of XDGame's card CSS, scoped under the injected wrapper.
const INLINE_SECTION_CSS = `
#gr-steam-inline-section{font-family:'Helvetica Neue',Helvetica,'PingFang SC',Tahoma,Arial,sans-serif;font-size:14px;line-height:24px}
#gr-steam-inline-section,#gr-steam-inline-section *{box-sizing:border-box}
#gr-steam-inline-section p{margin:0}
#gr-steam-inline-section .steam-review-card{display:grid;grid-template-columns:230px minmax(0,1fr);gap:22px;box-sizing:border-box;margin:16px 0 20px;padding:17px 18px;border:1px solid #dce6f1;border-radius:14px;background:linear-gradient(145deg,#fbfdff 0%,#f5f8fc 100%);box-shadow:0 14px 30px -27px rgba(29,56,96,.5);color:#354052}
#gr-steam-inline-section .steam-review-overview{display:flex;flex-direction:column;justify-content:center;min-width:0;padding-right:20px;border-right:1px solid #e3e9f1}
#gr-steam-inline-section .steam-review-heading{display:flex;align-items:center;min-width:0}
#gr-steam-inline-section .steam-review-icon{display:inline-flex;flex:0 0 40px;align-items:center;justify-content:center;width:40px;height:40px;margin-right:11px;border:1px solid #d5e1ee;border-radius:11px;background:#eaf2fa;color:#4f779f;font-size:21px}
#gr-steam-inline-section .steam-review-heading strong{display:block;color:#2d394a;font-size:16px;font-weight:700;line-height:22px;white-space:nowrap}
#gr-steam-inline-section .steam-review-heading small{display:block;color:#8a96a5;font-size:13px;line-height:20px}
#gr-steam-inline-section .steam-review-level{display:inline-flex;align-items:center;align-self:flex-start;gap:6px;min-height:27px;margin:10px 0 0 51px;padding:0 10px;border-radius:999px;font-size:14px;font-weight:700;line-height:27px}
#gr-steam-inline-section .steam-review-level.is-positive{background:#e3f4ec;color:#2e8660}
#gr-steam-inline-section .steam-review-level.is-mixed{background:#fff1d8;color:#a26c17}
#gr-steam-inline-section .steam-review-level.is-negative{background:#f9e7e9;color:#bd545d}
#gr-steam-inline-section .steam-review-detail{display:grid;grid-template-columns:minmax(225px,.9fr) minmax(260px,1.2fr);gap:18px;min-width:0}
#gr-steam-inline-section .steam-review-primary{display:flex;flex-direction:column;justify-content:center;min-width:0;padding-right:18px;border-right:1px solid #e3e9f1}
#gr-steam-inline-section .steam-review-judgment{display:flex;flex-direction:column;justify-content:center;min-width:0}
#gr-steam-inline-section .steam-review-final-score{display:flex;align-items:baseline;gap:7px;min-width:0;white-space:nowrap}
#gr-steam-inline-section .steam-review-final-score>strong{color:#356da8;font-size:31px;font-weight:800;line-height:34px;letter-spacing:-.04em}
#gr-steam-inline-section .steam-review-final-score>span{display:flex;align-items:baseline;gap:8px;color:#536174}
#gr-steam-inline-section .steam-review-final-score b{color:#788595;font-size:13px;font-weight:600}
#gr-steam-inline-section .steam-review-final-score small{font-size:15px;font-weight:700}
#gr-steam-inline-section .steam-review-rate{display:flex;align-items:baseline;gap:8px;margin:1px 0 0;min-width:0;color:#748192;font-size:14px;line-height:21px;white-space:nowrap}
#gr-steam-inline-section .steam-review-rate b{color:#536174;font-size:14px;font-weight:700}
#gr-steam-inline-section .steam-review-primary>small{margin-top:3px;color:#98a3b0;font-size:12px;line-height:19px;white-space:nowrap}
#gr-steam-inline-section .steam-review-verdict{margin:0 0 10px;color:#3d4a5c;font-size:15px;font-weight:700;line-height:22px}
#gr-steam-inline-section .steam-review-meter{position:relative;height:8px;overflow:hidden;border-radius:999px;background:#e9cfd2}
#gr-steam-inline-section .steam-review-meter span{display:block;width:0;height:100%;border-radius:999px;background:linear-gradient(90deg,#55b58b,#72c99f);transition:width .5s ease}
#gr-steam-inline-section .steam-review-meta{display:flex;flex-wrap:wrap;gap:4px 16px;margin:8px 0 0;color:#7c8999;font-size:13px;line-height:20px}
#gr-steam-inline-section .steam-review-meta b{color:#5c697a;font-size:14px;font-weight:700}
#gr-steam-inline-section .steam-review-meta b.is-positive{color:#2f8a63}
#gr-steam-inline-section .steam-review-meta b.is-negative{color:#c66068}
#gr-steam-inline-section.gr-night .steam-review-card{border-color:#3b4655;background:linear-gradient(145deg,#292d33 0%,#262a30 100%);box-shadow:none;color:#cbd3de}
#gr-steam-inline-section.gr-night .steam-review-overview{border-color:#3e4855}
#gr-steam-inline-section.gr-night .steam-review-icon{border-color:#44566b;background:#303d4c;color:#91b6da}
#gr-steam-inline-section.gr-night .steam-review-heading strong{color:#e0e6ee}
#gr-steam-inline-section.gr-night .steam-review-heading small,#gr-steam-inline-section.gr-night .steam-review-primary>small,#gr-steam-inline-section.gr-night .steam-review-meta{color:#939fad}
#gr-steam-inline-section.gr-night .steam-review-level.is-positive{background:#30473f;color:#83c9aa}
#gr-steam-inline-section.gr-night .steam-review-level.is-mixed{background:#50452e;color:#e5bd72}
#gr-steam-inline-section.gr-night .steam-review-level.is-negative{background:#50363a;color:#e18b92}
#gr-steam-inline-section.gr-night .steam-review-primary{border-color:#3e4855}
#gr-steam-inline-section.gr-night .steam-review-final-score>strong{color:#92bce7}
#gr-steam-inline-section.gr-night .steam-review-final-score>span,#gr-steam-inline-section.gr-night .steam-review-final-score b{color:#aeb9c6}
#gr-steam-inline-section.gr-night .steam-review-rate{color:#aeb8c4}
#gr-steam-inline-section.gr-night .steam-review-rate b,#gr-steam-inline-section.gr-night .steam-review-meta b{color:#c8d0da}
#gr-steam-inline-section.gr-night .steam-review-verdict{color:#d3dae4}
#gr-steam-inline-section.gr-night .steam-review-meter{background:#563b40}
#gr-steam-inline-section.gr-night .steam-review-meta b.is-positive{color:#75c9a3}
#gr-steam-inline-section.gr-night .steam-review-meta b.is-negative{color:#e18b92}
@media screen and (max-width:640px){
#gr-steam-inline-section .steam-review-card{grid-template-columns:1fr;gap:13px;margin:14px 0 18px;padding:15px;border-radius:12px}
#gr-steam-inline-section .steam-review-overview{flex-direction:row;align-items:center;justify-content:space-between;gap:10px;padding:0 0 13px;border-right:0;border-bottom:1px solid #e3e9f1}
#gr-steam-inline-section .steam-review-icon{width:38px;height:38px;flex-basis:38px;margin-right:9px;font-size:20px}
#gr-steam-inline-section .steam-review-heading strong{font-size:16px}
#gr-steam-inline-section .steam-review-heading small{font-size:13px}
#gr-steam-inline-section .steam-review-level{flex:0 0 auto;align-self:auto;min-height:27px;margin:0;padding:0 9px;font-size:13px}
#gr-steam-inline-section .steam-review-detail{grid-template-columns:1fr;gap:10px}
#gr-steam-inline-section .steam-review-primary{position:relative;padding:0;border-right:0}
#gr-steam-inline-section .steam-review-final-score>strong{font-size:34px;line-height:37px}
#gr-steam-inline-section .steam-review-final-score>span{display:flex;align-items:baseline;gap:7px}
#gr-steam-inline-section .steam-review-final-score b,#gr-steam-inline-section .steam-review-final-score small{display:inline;line-height:20px}
#gr-steam-inline-section .steam-review-final-score small{font-size:14px}
#gr-steam-inline-section .steam-review-rate{flex-wrap:wrap;gap:1px 7px;margin-top:3px;font-size:14px;white-space:normal}
#gr-steam-inline-section .steam-review-primary>small{position:absolute;top:5px;right:0;margin:0;font-size:11px}
#gr-steam-inline-section .steam-review-verdict{margin:0 0 9px;font-size:15px;line-height:22px}
#gr-steam-inline-section .steam-review-meta{gap:4px 12px;font-size:13px}
#gr-steam-inline-section .steam-review-meta b{font-size:14px}
#gr-steam-inline-section.gr-night .steam-review-overview{border-bottom-color:#3e4855}
}
`;

// 样式随首张卡片注入一次（模块级幂等标记 + DOM id 双保险）
// The stylesheet ships with the first card (idempotent module flag + DOM id).
let inlineStyleInjected = false;
function ensureInlineSectionStyle() {
  if (inlineStyleInjected) return;
  try {
    if (document.getElementById(INLINE_SECTION_STYLE_ID)) {
      inlineStyleInjected = true;
      return;
    }
    const style = document.createElement('style');
    style.id = INLINE_SECTION_STYLE_ID;
    style.textContent = INLINE_SECTION_CSS;
    (document.head || document.documentElement).appendChild(style);
    inlineStyleInjected = true;
  } catch (e) {
    dbg('内嵌信息区样式注入失败: ' + String(e));
  }
}

// 宿主页是否为深色主题（XDGame 夜间配色启用判定）：
// body 计算背景亮度 < 128 → 深色；背景透明不可判定 → 回退系统偏好。
// Dark-host detection for the night palette (XDGame uses body.night).
function hostIsDarkMode() {
  try {
    if (typeof window.getComputedStyle === 'function' && document.body) {
      const bg = window.getComputedStyle(document.body).backgroundColor || '';
      const m = bg.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i);
      if (m) {
        const alpha = m[4] === undefined ? 1 : parseFloat(m[4]);
        if (alpha > 0) {
          const [r, g, b] = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
          return 0.299 * r + 0.587 * g + 0.114 * b < 128;
        }
      }
    }
  } catch {
    /* 计算样式不可用 → 回退系统偏好 / fall back to the media query */
  }
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  } catch {
    return false;
  }
}

function renderInlineSteamSection(data, cachedAt) {
  try {
    if (!data) return;
    // 站点门控（v10.7.0 批次4）：由 adapter 规则的 features.inlineSteamCard 声明
    // 决定（内置 xianyudanji/gamer520 打开；自定义站可经规则包启用）——
    // 此前为 INLINE_SECTION_SITES 硬编码数组，规则站无法获得该能力
    let inlineEnabled = false;
    try {
      inlineEnabled = !!((builder.getAdapter() || {}).features || {}).inlineSteamCard;
    } catch {
      /* 适配器不可用时跳过 / skip when the adapter is unavailable */
    }
    if (!inlineEnabled) return;

    const html = detailTemplates.steamInlineSection(data, cachedAt);
    const existing = document.getElementById(INLINE_SECTION_ID);
    if (!html) {
      // 新数据无评测（纠错换游戏等）→ 移除旧卡，与 XDGame 无数据隐藏一致
      if (existing) existing.remove();
      return;
    }

    ensureInlineSectionStyle();

    // 幂等：同游戏已注入 → 跳过；换游戏（纠错重检索）→ 移除旧卡重建
    if (existing) {
      if (existing.getAttribute('data-gr-appid') === String(data.appId || '')) return;
      existing.remove();
    }

    // 插入点：标题（h1 / h2.entry-title，WordPress 主题）之后；无标题时回退
    // 正文容器顶部；两者皆无 → 放弃（极端页面结构，不强行注入）
    const title = document.querySelector('h1, h2.entry-title');
    const content = document.querySelector('.entry-content, .post-content, .article-content, article, main');
    const section = document.createElement('div');
    section.id = INLINE_SECTION_ID;
    section.setAttribute('data-gr-appid', String(data.appId || ''));
    if (hostIsDarkMode()) section.className = 'gr-night'; // 夜间配色（XDGame body.night 等价）
    section.innerHTML = html;
    if (title && title.parentNode) {
      title.parentNode.insertBefore(section, title.nextSibling);
    } else if (content) {
      content.insertBefore(section, content.firstChild);
    } else {
      return;
    }
    dbg('✅ 已注入内嵌 Steam 信息区（详情页标题下方，XDGame 同款）');
  } catch (e) {
    dbg('内嵌 Steam 信息区注入失败: ' + String(e));
  }
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
