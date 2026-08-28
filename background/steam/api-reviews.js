import { recordSteamCall } from '../core/api-monitor.js';
import { fetchWithTimeout } from '../core/utils.js';
import { Logger } from '../storage/logger.js';

/**
 * 游戏雷达 Game Radar - Steam API 子模块：api-reviews.js
 *
 * v5.0.0：由 steam/api.js 按职能拆分。
 */

// 缓存条目是否为"好评率获取失败固化"（positiveRate 与 ratingDesc 均为空）。
// 网络失败/限流时若把 null 写入缓存会固化"只显示 AppID"，命中时需重新获取。
// Is a cached entry a "failed-rating snapshot" (both positiveRate and ratingDesc
// empty)? Such entries must be re-fetched instead of served from cache.
export function isFailedRatingEntry(cachedData) {
  return !!cachedData && cachedData.positiveRate === null && !cachedData.ratingDesc;
}

// 无好评率重试冷却期（确认 0 评测后，避免每次刷新列表页都请求 Steam）。
// v3.3.2：10 分钟 → 5 分钟——游戏评测增长通常以小时计，5 分钟已能防刷新
// 风暴（用户高频刷新时每轮最多一次重试），同时更快反映"游戏后来有了评测"。
// Cooldown after confirming a zero-review rating (avoids re-fetching on every
// list refresh, which would amplify API rate limiting). 10→5 minutes since
// v3.3.2: review growth happens over hours, so 5 minutes still stops refresh
// storms while reflecting newly published reviews sooner.

// 无好评率重试冷却期（确认 0 评测后，避免每次刷新列表页都请求 Steam）。
// v3.3.2：10 分钟 → 5 分钟——游戏评测增长通常以小时计，5 分钟已能防刷新
// 风暴（用户高频刷新时每轮最多一次重试），同时更快反映"游戏后来有了评测"。
// Cooldown after confirming a zero-review rating (avoids re-fetching on every
// list refresh, which would amplify API rate limiting). 10→5 minutes since
// v3.3.2: review growth happens over hours, so 5 minutes still stops refresh
// storms while reflecting newly published reviews sooner.
export const RATING_RETRY_COOLDOWN_MS = 5 * 60 * 1000;
// v6.4.15：失败固化（3 次以上）的长冷却——Steam 限流/中国网络超时是暂时
// 性的，永久不重试会让游戏永远显示 #appid；长冷却后允许重新尝试。
// Long cooldown after the retry cap: transient rate-limits/timeouts must not
// permanently freeze a game at "no rating".
export const RATING_RETRY_LONG_COOLDOWN_MS = 60 * 60 * 1000;

// 详情页缓存数据完整性判定（v3.3.3）：详情页渲染需要的关键字段齐全才可
// 直接命中缓存——列表页写入的轻量缓存（appId/name/好评率等 7 字段）不含
// 标签/中文支持/开发商/描述等，命中会导致详情页渲染残缺，必须视为未命中
// 并转完整拉取。纯函数，可单测。
// Detail-page cache completeness check: only entries carrying every field the
// detail page renders may be served from cache — the lightweight list-page
// entries (appId/name/rating etc.) would render a broken detail page, so they
// count as a miss and trigger a full fetch. Pure function, unit-testable.

// 详情页缓存数据完整性判定（v3.3.3）：详情页渲染需要的关键字段齐全才可
// 直接命中缓存——列表页写入的轻量缓存（appId/name/好评率等 7 字段）不含
// 标签/中文支持/开发商/描述等，命中会导致详情页渲染残缺，必须视为未命中
// 并转完整拉取。纯函数，可单测。
// Detail-page cache completeness check: only entries carrying every field the
// detail page renders may be served from cache — the lightweight list-page
// entries (appId/name/rating etc.) would render a broken detail page, so they
// count as a miss and trigger a full fetch. Pure function, unit-testable.
export function isCompleteCacheData(data) {
  if (!data || typeof data !== 'object') return false;
  return (
    !!data.url &&
    !!data.name &&
    Array.isArray(data.genres) &&
    Array.isArray(data.userTags) &&
    Array.isArray(data.developers) &&
    data.chineseSupported !== undefined &&
    data.releaseDate !== undefined &&
    data.description !== undefined &&
    !!data.headerImage
  );
}

// 列表页缓存命中判定（v3.3.1）：缓存无好评率（0 评测/失败固化）时重新获取——
// 失败固化立即重试；已确认 0 评测的按冷却期重试（默认 5 分钟）。
// v3.3.7：兼容两种入参——旧缓存条目（{data: {...}}）与模块化后的合并视图
// 数据对象（orchestrator 现传 getMergedData 结果）。
// Cache-hit check: a cache entry without a positive rate is refetched — failed
// snapshots immediately, confirmed zero-review entries after the cooldown.
// Accepts both a legacy entry ({data}) and the merged-view data object.

// 列表页缓存命中判定（v3.3.1）：缓存无好评率（0 评测/失败固化）时重新获取——
// 失败固化立即重试；已确认 0 评测的按冷却期重试（默认 5 分钟）。
// v3.3.7：兼容两种入参——旧缓存条目（{data: {...}}）与模块化后的合并视图
// 数据对象（orchestrator 现传 getMergedData 结果）。
// Cache-hit check: a cache entry without a positive rate is refetched — failed
// snapshots immediately, confirmed zero-review entries after the cooldown.
// Accepts both a legacy entry ({data}) and the merged-view data object.
export function needsRatingRefetch(cached) {
  if (!cached) return true;
  const d = cached.data || cached;
  if (d.positiveRate !== null && d.positiveRate !== undefined) return false;
  if (isFailedRatingEntry(d)) {
    // v6.4.10：失败固化重试上限 3 次（页面刷新触发一次；冷却防同次刷新连打）
    // v6.4.15：3 次后不再永久停止——超过上限按长冷却（1 小时）重置重试，
    // 因为限流/网络超时是暂时性的，固化会造成游戏永远显示 #appid
    const failCount = d.ratingFailCount || 0;
    if (failCount < 3) {
      return !d.ratingRetriedAt || Date.now() - d.ratingRetriedAt >= RATING_RETRY_COOLDOWN_MS;
    }
    return !!d.ratingRetriedAt && Date.now() - d.ratingRetriedAt >= RATING_RETRY_LONG_COOLDOWN_MS;
  }
  if (d.ratingRetriedAt && Date.now() - d.ratingRetriedAt < RATING_RETRY_COOLDOWN_MS) return false;
  return true;
}

// 封面图 URL：优先已有封面，否则按 appId 构造 Steam CDN header 图（纯函数，可单测）
// Cover URL: keep the provided cover, else build the Steam CDN header URL

// --- 评测获取 ---

// 近 30 天评测窗口（秒）/ 30-day recent-review window (seconds)
export const RECENT_REVIEW_WINDOW_SEC = 30 * 24 * 3600;

/**
 * 从最近评测列表中统计 30 天窗口内好评率（纯函数，可单测）。
 * appreviews 的 query_summary 恒为全时段统计（filter=recent 不影响），
 * 近 30 天好评率需从 reviews 数组自行统计（filter=recent 按时间降序返回）。
 * Summarize a 30-day window from a recent-reviews list (pure, testable).
 * query_summary always covers all-time totals (filter=recent does not change
 * it), so the 30-day rate is computed from the reviews array itself.
 * @param {Array<{timestamp_created?: number, voted_up?: boolean}>} reviews - 最近评测列表（时间降序）
 * @param {number} [cutoffSec] - 窗口起点（Unix 秒），默认 now-30 天
 * @returns {{total: number, positive: number, rate: number|null}} rate=null 表示窗口内 0 条
 */

/**
 * 从最近评测列表中统计 30 天窗口内好评率（纯函数，可单测）。
 * appreviews 的 query_summary 恒为全时段统计（filter=recent 不影响），
 * 近 30 天好评率需从 reviews 数组自行统计（filter=recent 按时间降序返回）。
 * Summarize a 30-day window from a recent-reviews list (pure, testable).
 * query_summary always covers all-time totals (filter=recent does not change
 * it), so the 30-day rate is computed from the reviews array itself.
 * @param {Array<{timestamp_created?: number, voted_up?: boolean}>} reviews - 最近评测列表（时间降序）
 * @param {number} [cutoffSec] - 窗口起点（Unix 秒），默认 now-30 天
 * @returns {{total: number, positive: number, rate: number|null}} rate=null 表示窗口内 0 条
 */
export function summarizeRecentReviews(reviews, cutoffSec = Date.now() / 1000 - RECENT_REVIEW_WINDOW_SEC) {
  const list = Array.isArray(reviews) ? reviews : [];
  const inWindow = list.filter((r) => r && typeof r.timestamp_created === 'number' && r.timestamp_created >= cutoffSec);
  if (inWindow.length === 0) {
    return { total: 0, positive: 0, rate: null };
  }
  const positive = inWindow.filter((r) => r.voted_up === true).length;
  return {
    total: inWindow.length,
    positive,
    rate: Math.round((positive / inWindow.length) * 100)
  };
}

export async function fetchReviewSummary(appId) {
  // 网络失败/限流时重试一次（列表页批量场景 Steam API 限流常见）。
  // v3.3.6：filter=recent&num_per_page=100——一次请求同时拿到全时段
  // query_summary 与最近 100 条评测（时间降序），近 30 天好评率由此统计。
  // One request serves both: the all-time query_summary and the 100 newest
  // reviews (time-descending) used to compute the 30-day rate.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const reviewUrl = `https://store.steampowered.com/appreviews/${appId}?json=1&language=all&filter=recent&num_per_page=100&purchase_type=all`;
      const response = await fetchWithTimeout(reviewUrl);
      const data = await response.json();
      // v9.7.0：同 api-details——传入 status，非 2xx 不计成功（限流可感知）
      recordSteamCall(response.ok, response.status);
      if (!response.ok) continue;
      if (data.success === 1 && data.query_summary) {
        const qs = data.query_summary;
        const recent = summarizeRecentReviews(data.reviews);
        return {
          total: qs.total_reviews,
          positive: qs.total_positive,
          negative: qs.total_negative,
          score: qs.review_score,
          desc: qs.review_score_desc,
          recent
        };
      }
    } catch {
      recordSteamCall(false, 0); // 重试一次 / retry once
    }
  }
  return null;
}

// 最近更新日期（v3.3.6）：Steam 官方无"最近更新"字段，用最新公告日期近似
// （GetNewsForApp 免费无 key；持续更新/抢先体验游戏即最新更新公告，完成品
// 显示发行日附近——语义"无后续更新"）。失败返回 null（UI 隐藏该部分）。
// Last-update date: Steam exposes no such field; the newest announcement date
// approximates it (GetNewsForApp is keyless). Null on failure (UI hides it).

// 最近更新日期（v3.3.6）：Steam 官方无"最近更新"字段，用最新公告日期近似
// （GetNewsForApp 免费无 key；持续更新/抢先体验游戏即最新更新公告，完成品
// 显示发行日附近——语义"无后续更新"）。失败返回 null（UI 隐藏该部分）。
// Last-update date: Steam exposes no such field; the newest announcement date
// approximates it (GetNewsForApp is keyless). Null on failure (UI hides it).
/**
 * 获取最近更新日期（最新公告时间戳）
 * @param {string|number} appId
 * @returns {Promise<string|null>} - YYYY-MM-DD
 */
export async function fetchLastUpdate(appId) {
  try {
    const resp = await fetchWithTimeout(
      `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=1&maxlength=0&format=json`
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const item = data && data.appnews && data.appnews.newsitems && data.appnews.newsitems[0];
    if (!item || !item.date) return null;
    const d = new Date(item.date * 1000);
    if (isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

export async function fetchChineseReviews(appId) {
  /** @type {{total: number, positive: number, negative: number, score: number|null, desc: string|null, positiveRate: number|null}|null} */
  let cnReviewSummary = null;
  let chineseReviews = [];
  try {
    const cnReviewUrl = `https://store.steampowered.com/appreviews/${appId}?json=1&language=schinese&num_per_page=10&filter=all`;
    const resp = await fetchWithTimeout(cnReviewUrl);
    const data = await resp.json();
    if (data.success === 1) {
      if (data.reviews && data.reviews.length > 0) {
        chineseReviews = data.reviews.slice(0, 5).map((r) => ({
          recommended: r.voted_up === true,
          text: r.review.substring(0, 200),
          author: r.author?.steamid || '匿名',
          language: 'schinese'
        }));
      }
      if (data.query_summary) {
        const qs = data.query_summary;
        cnReviewSummary = {
          total: qs.total_reviews,
          positive: qs.total_positive,
          negative: qs.total_negative,
          score: qs.review_score,
          desc: qs.review_score_desc,
          positiveRate: qs.total_reviews > 0 ? Math.round((qs.total_positive / qs.total_reviews) * 100) : null
        };
      }
    }
  } catch (e) {
    Logger.debug('Steam', '获取中文评价失败:', String(e));
  }
  return { cnReviewSummary, chineseReviews };
}

export async function fetchSteamReviews(appId) {
  const [reviewSummary, cnData] = await Promise.all([fetchReviewSummary(appId), fetchChineseReviews(appId)]);
  return {
    reviewSummary,
    cnReviewSummary: cnData.cnReviewSummary,
    chineseReviews: cnData.chineseReviews
  };
}

// --- SteamDB 信息 ---
