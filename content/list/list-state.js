/**
 * 游戏雷达 Game Radar - 列表页共享状态容器 / Shared List-Page State
 *
 * v7.3.0：从 list-page.js 拆分——_state 状态容器与评分状态机
 * （createRatingsJob/applyRatingsResponse/finishRatings/scheduleFallbacks/
 * ratingFilterPass/sortItemsByRating）独立成模块。list-batch 与 list-page
 * 共同依赖本模块（单向），彻底打破原 list-page ↔ list-batch 双向循环
 * 依赖——双向 static import 在并发模块加载下偶发加载竞态（GR.listBatch
 * null），拆分后依赖图无环，加载顺序确定。
 * Shared state container split out of list-page.js (v7.3.0): list-batch and
 * list-page both depend on this module one-way, breaking the circular
 * dependency that occasionally raced during concurrent module loading.
 * 注意：本模块不得 import list-page/list-batch（依赖方向保持单向）。
 */
import * as badges from './badges.js';
import * as builder from '../adapters/builder.js';
import * as status from '../core/status-bar.js';
import * as debug from '../core/debug.js';

const dbg = (...a) => debug.dbg(...a);

// ============ 列表页 Steam 好评率（两波：缓存命中即时显示 + 后台推送更新） ============
// Two-wave rating flow: cached hits render instantly; misses are fetched in
// the background and pushed back via STEAM_RATINGS_UPDATE.
// v5.1.0：状态容器（list-page 与 list-batch 共享）/ shared state container
/**
 * @typedef {Object} RatingsJob
 * @property {Array<any>} processItems
 * @property {any} settings
 * @property {Array<string>} uniqueNames
 * @property {Record<string, number|null>} ratingMap
 * @property {Set<string>} processed
 * @property {number} shown
 * @property {number} filtered
 * @property {Array<string>} filteredNames
 * @property {Array<string>} notFoundNames
 * @property {Array<any>} urlEntries
 * @property {boolean} finished
 * @property {any} forceTimer
 */
/** @type {{ ratingsJob: RatingsJob|null, batchState: any }} */
export const _state = { ratingsJob: null, batchState: null };

function createRatingsJob(processItems, settings, uniqueNames) {
  _state.ratingsJob = {
    processItems,
    settings,
    uniqueNames,
    ratingMap: {}, // v6.4.4：name → positiveRate（重排序用）/ for re-sorting
    processed: new Set(), // 已出结果的游戏名（徽章已显示）/ names already resolved
    shown: 0,
    filtered: 0,
    filteredNames: [], // v7.4.0：被过滤游戏名（状态浮窗可恢复）/ filtered names
    notFoundNames: [],
    urlEntries: [], // appId → 下载页地址批量写入 / download-URL batch entries
    finished: false,
    forceTimer: null // 强制收尾定时器 / force-finish timer
  };
}

// 应用一波查询结果。mode='first'：未命中的跳过（等待推送），不插"未找到"徽章；
// mode='final'：波内仍未命中的按"未找到"处理。
// 收尾后到达的迟到推送仍会应用徽章（只补徽章，不重复统计）。
// Apply one wave of results. 'first': misses wait for the push; 'final':
// misses in this wave resolve as "not found". Late pushes still apply badges.
// v6.4.4：好评率过滤判定（总 + 30 天 + 与/或/非）——纯函数导出供单测
// and：总≥阈值 且 30天≥阈值；or：任一达标；not：只看 30 天（忽略总好评）
export function ratingFilterPass(rating, settings = {}) {
  const totalOk =
    !settings.enableRatingFilter ||
    (settings.minSteamRatingFilter || 0) <= 0 ||
    (rating.positiveRate ?? -1) >= (settings.minSteamRatingFilter || 0);
  const recentOk =
    !settings.enableRecentFilter ||
    (settings.minRecentSteamRatingFilter || 0) <= 0 ||
    (rating.recentPositiveRate ?? -1) >= (settings.minRecentSteamRatingFilter || 0);
  const mode = settings.ratingFilterMode || 'and';
  // v6.4.18：混合模式——"任一 ≥ 高值，或 双 ≥ 低值"。
  // 高值 = 两阈值的较大者（任一达到即保留），低值 = 较小者（双达才保留）。
  // 例：总 90 / 30天 80 → 任一 ≥90 或 双 ≥80 保留，其余过滤隐藏。
  // 阈值 ≤0 的维度视为未参与（仅一个阈值时退化为该阈值过滤）。
  // Hybrid: keep when either rate ≥ the larger threshold OR both rates ≥ the
  // smaller one (e.g. total 90 + recent 80 → either ≥90 or both ≥80 keeps).
  if (mode === 'hybrid') {
    const t = Number(settings.minSteamRatingFilter) || 0;
    const r = Number(settings.minRecentSteamRatingFilter) || 0;
    const active = [t, r].filter((v) => v > 0);
    if (active.length === 0) return true; // 无阈值 → 全部保留
    const high = Math.max(...active);
    const low = Math.min(...active);
    const totalPass = rating.positiveRate ?? -1;
    const recentPass = rating.recentPositiveRate ?? -1;
    return totalPass >= high || recentPass >= high || (totalPass >= low && recentPass >= low);
  }
  if (mode === 'or') return totalOk || recentOk;
  if (mode === 'not') return recentOk; // 非总好评过滤：仅 30 天生效
  return totalOk && recentOk;
}

export function applyRatingsResponse(ratings, mode) {
  if (!_state.ratingsJob) return false;
  const job = _state.ratingsJob;
  // v3.3.8：关闭"全部好评率"徽章 → 好评率过滤停用（数据获取不受影响）
  const bv = (job.settings && job.settings.badgeVisibility) || {};
  const filterEnabled = job.settings?.enableRatingFilter && bv.all !== false;
  const minRating = filterEnabled ? job.settings.minSteamRatingFilter || 0 : 0;
  let changed = false;
  job.processItems.forEach((item) => {
    if (job.processed.has(item.name)) return;
    const rating = ratings[item.name];
    if (rating && rating.appId) {
      job.processed.add(item.name);
      job.ratingMap[item.name] = rating.positiveRate ?? null; // v6.4.4 排序用
      changed = true;
      // 合集等 type 徽章：appId 非本体，不写入下载站网址缓存
      const isTypeBadge = rating.type && rating.type !== 'game' && rating.type !== 'demo';
      if (item.url && !isTypeBadge) job.urlEntries.push({ appId: rating.appId, url: item.url });
      // 好评率过滤（v6.4.4：总 + 30 天 + 与/或/非）：不达标的从 DOM 移除
      // v6.4.10 修复：30 天过滤（enableRecentFilter）在 positiveRate 为 null 时
      // 被外层检查跳过——过滤判定独立于 positiveRate（任一过滤启用即判定）
      const doFilter = filterEnabled || !!job.settings?.enableRecentFilter;
      if (doFilter && (rating.positiveRate != null || rating.recentPositiveRate != null)) {
        if (
          !ratingFilterPass(rating, {
            ...job.settings,
            enableRatingFilter: filterEnabled,
            minSteamRatingFilter: minRating
          })
        ) {
          badges.removeItemFromDom(item);
          job.filtered++;
          job.filteredNames.push(item.name);
          return;
        }
      }
      badges.prependBadge(item, rating, job.settings);
      job.shown++;
    } else if (mode !== 'first' && Object.prototype.hasOwnProperty.call(ratings, item.name)) {
      // 最终波：仅对**波内包含**的名字判定"未找到"（波外名字继续等待后续波）
      // 'final': only names present in this wave resolve as "not found"
      job.processed.add(item.name);
      job.notFoundNames.push(item.name);
      changed = true;
      badges.prependBadge(item, null, job.settings);
    }
  });
  return changed;
}

// 完成统计：批量写下载站网址缓存 + 统一浮窗显示统计。
// 收尾后保留 ratingsJob（迟到推送仍可补徽章），不再置 null。
export function finishRatings() {
  if (!_state.ratingsJob || _state.ratingsJob.finished) return;
  _state.ratingsJob.finished = true;
  clearTimeout(_state.ratingsJob.forceTimer);
  const job = _state.ratingsJob;
  const unresolved = job.processItems.filter((i) => !job.processed.has(i.name)).length;
  // 批量写入下载站网址缓存（fire-and-forget）
  const siteKey = builder.getAdapterKey();
  if (siteKey && job.urlEntries.length > 0) {
    chrome.runtime
      .sendMessage({
        action: 'RECORD_DOWNLOAD_URLS_BATCH',
        data: {
          siteKey,
          siteName: builder.getAdapter().name,
          domain: window.location.hostname,
          entries: job.urlEntries
        }
      })
      .catch(() => {});
  }
  dbg(
    `列表页: 显示 ${job.shown} 个好评率, 过滤 ${job.filtered} 个, 未找到 ${job.notFoundNames.length} 个` +
      (job.notFoundNames.length > 0 ? ` [${job.notFoundNames.slice(0, 5).join('、')}]` : '') +
      (unresolved > 0 ? `, 未返回 ${unresolved} 个` : '')
  );
  status.showStats({
    title: 'Steam 好评率获取完成',
    summary: `${job.shown} 个好评率${job.filtered > 0 ? ` · ${job.filtered} 个已过滤` : ''}${job.notFoundNames.length > 0 ? ` · ${job.notFoundNames.length} 个未找到` : ''}${unresolved > 0 ? ` · ${unresolved} 个暂未返回（刷新页面可重试）` : ''}`,
    rows: [
      `查询 ${job.uniqueNames.length} 个游戏 · 提取 ${job.processItems.length} 个`,
      job.notFoundNames.length > 0
        ? `未找到: ${job.notFoundNames.slice(0, 3).join('、')}${job.notFoundNames.length > 3 ? '...' : ''}`
        : '',
      // v7.4.0：被过滤游戏可恢复（点击回调由 status-bar 委托执行）
      job.filteredNames.length > 0
        ? {
            text: `已过滤 ${job.filteredNames.length} 个（点击恢复全部）`,
            click: () => restoreFilteredGames(job)
          }
        : ''
    ].filter(Boolean)
  });
  // v6.4.4：按好评率降序重排（设置开启时）
  if (job.settings && job.settings.enableSortByRating) {
    sortItemsByRating(job);
  }
}

// v7.4.0：恢复被过滤游戏（重新插入列表容器末尾——位置可能略有变化）
// Restore filtered games: re-append their elements to the list container
function restoreFilteredGames(job) {
  if (!job || job.filteredNames.length === 0) return;
  const names = new Set(job.filteredNames);
  const live = job.processItems.find((i) => i.element && i.element.parentNode);
  const container = live && live.element.parentNode;
  if (!container) return;
  let restored = 0;
  for (const item of job.processItems) {
    if (names.has(item.name) && item.element && !item.element.parentNode) {
      container.appendChild(item.element);
      restored++;
    }
  }
  job.filteredNames = [];
  job.filtered = 0;
  status.showStats({
    title: '已恢复被过滤游戏',
    summary: `恢复了 ${restored} 个游戏（位置可能略有变化）`,
    rows: []
  });
}

// v6.4.4：按好评率降序重排列表页 DOM（评分最高的在前；无评分的沉底）
// Re-sort list items by positive rate descending (unrated sink to the bottom)
export function sortItemsByRating(job) {
  const sorted = job.processItems.slice().sort((a, b) => (job.ratingMap[b.name] ?? -1) - (job.ratingMap[a.name] ?? -1));
  const container = sorted[0] && sorted[0].element && sorted[0].element.parentNode;
  if (!container) return;
  for (const item of sorted) {
    if (item.element && item.element.parentNode === container) {
      container.appendChild(item.element); // 按序移到末尾 = 重排
    }
  }
}

// 兜底：45 秒强制收尾。未返回的游戏保持空白（后台已逐批落盘缓存，
// 刷新页面第一波即命中），**不误标"未找到"**；收尾后迟到的推送仍会应用徽章。
// v4.0.0：批次多次调度，forceTimer 逐批重置（最后一批发起 +45s 起算）。
function scheduleFallbacks() {
  const job = _state.ratingsJob;
  if (!job) return;
  clearTimeout(job.forceTimer);
  job.forceTimer = setTimeout(() => {
    if (!_state.ratingsJob || _state.ratingsJob.finished) return;
    finishRatings();
  }, 45000);
}

// 评分状态机句柄（list-batch 经此调用；不含 applySteamRatingsUpdate——
// 该函数依赖 list-batch 的 maybeFetchNextBatch，保留在 list-page 层）
export const _internal = {
  createRatingsJob,
  applyRatingsResponse,
  finishRatings,
  scheduleFallbacks,
  ratingFilterPass,
  sortItemsByRating
};
