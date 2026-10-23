/**
 * 游戏雷达 Game Radar - 浮窗回调工厂 / Steam Float Callback Factory
 *
 * v14.5.0 B7：由 sidebar.js 拆出——人工报错重检索（makeReportIssue）与手动
 * 刷新缓存（makeOnRefresh）两个闭包统一为一个回调工厂（共享 steamData/
 * reportIssue 状态，经存取器与编排壳互通），消除编排壳内两份同构闭包。
 * The two callback closures (report-issue re-search / manual refresh) unified
 * into one factory sharing the steamData/reportIssue state via accessors.
 */
import * as builder from '../adapters/builder.js';
import * as candidates from './candidates.js';
import * as debug from '../core/debug.js';

const dbg = (...a) => debug.dbg(...a);

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

/**
 * 创建浮窗回调族（报错重检索 + 手动刷新 + 数据/回调状态存取）
 * @param {Object} deps - 编排壳依赖（渲染与显隐回调，由 sidebar.js 注入）
 * @param {any} deps.panel - 浮窗根元素
 * @param {() => void} deps.hidePanel - 折叠内容区
 * @param {() => void} deps.showPanel - 滑入显示
 * @param {Function} deps.renderSteamSidebar - 渲染+绑定（单一挂点）
 * @param {Function} deps.renderAndShow - 数据就绪渲染通用入口
 */
export function createSteamActions({ panel, hidePanel, showPanel, renderSteamSidebar, renderAndShow }) {
  /** @type {SteamLookupData|null} */
  let steamData = null;
  /** @type {(() => Promise<void>)|null} */
  let reportIssue = null;

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

  // 人工报错重检索回调（v3.3.11）：清除错误 appid 缓存 → 重新检索 →
  // 更新浮窗；**重检索结果仍是同一 appid（未纠正）或失败时，自动进入
  // 手动选择面板**（v3.3.12）。reportIssue 在 renderAndShow 时创建
  // 并随渲染传递（makeOnRefresh 重渲染时复用同一回调）
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
        resp = await window.__GR_MSG__.sendMessage({
          action: 'SEARCH_STEAM',
          gameName: name,
          rawTitle: document.title
        });
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
              .sendMessage(
                { action: 'SEARCH_STEAM', gameName: name, rawTitle: document.title, ignoreNegativeCache: true },
                null,
                {
                  timeout: 25000
                }
              )
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

  return {
    get steamData() {
      return steamData;
    },
    /** @param {SteamLookupData} d */
    setSteamData(d) {
      steamData = d;
    },
    get reportIssue() {
      return reportIssue;
    },
    /** @param {(() => Promise<void>)|null} fn */
    setReportIssue(fn) {
      reportIssue = fn;
    },
    makeOnRefresh,
    makeReportIssue
  };
}
