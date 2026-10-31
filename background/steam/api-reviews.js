import { recordSteamCall, recordDomainCall, isCircuitOpen } from '../core/api-monitor.js';
import { fetchWithTimeout } from '../core/utils.js';
import { ENDPOINTS, STORAGE_CAPS, PERF_CONFIG } from '../core/constants.js'; // v10.7.0：端点单源；v14.6.2：超时单源
import { createTtlCache } from '../core/mechanisms.js'; // v10.7.0：TTL 缓存工厂
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
const RATING_RETRY_COOLDOWN_MS = 5 * 60 * 1000;
// v6.4.15：失败固化（3 次以上）的长冷却——Steam 限流/中国网络超时是暂时
// 性的，永久不重试会让游戏永远显示 #appid；长冷却后允许重新尝试。
// Long cooldown after the retry cap: transient rate-limits/timeouts must not
// permanently freeze a game at "no rating".
const RATING_RETRY_LONG_COOLDOWN_MS = 60 * 60 * 1000;

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

// v14.8.2：appreviews 端点死亡标记（本 SW 会话内）——首次观测到 302→商店首页
// 后置位，后续 fetchReviewSummary 直接走商店页回退（SW 冷启动后重新探测一次）。
// Session-wide dead-endpoint flag: set on the first observed redirect-to-home,
// after which fetchReviewSummary goes straight to the store-page fallback.
let appreviewsDead = false;

export async function fetchReviewSummary(appId) {
  // 网络失败/限流时重试一次（列表页批量场景 Steam API 限流常见）。
  // v3.3.6：filter=recent&num_per_page=100——一次请求同时拿到全时段
  // query_summary 与最近 100 条评测（时间降序），近 30 天好评率由此统计。
  // One request serves both: the all-time query_summary and the 100 newest
  // reviews (time-descending) used to compute the 30-day rate.
  // v14.8.2：端点死亡快路径——首次观测到 302 跟随落地商店首页后，本 SW 会话
  // 内跳过 API 直接走商店页回退（省 2 次 302 跟随请求/项，60 项批量显著减负；
  // SW 冷启动后重新探测一次，有界）。
  if (!appreviewsDead) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const reviewUrl = `${ENDPOINTS.steamAppReviews}${appId}?json=1&language=all&filter=recent&num_per_page=100&purchase_type=all`;
        const response = await fetchWithTimeout(reviewUrl);
        // v14.8.2：302 跟随落地商店首页 = 端点死亡信号（标记后本会话直接回退）
        if (response.redirected && /store\.steampowered\.com\/?$/.test(response.url || '')) {
          appreviewsDead = true;
          break;
        }
        const data = await response.json();
        // v9.7.0：同 api-details——传入 status，非 2xx 不计成功（限流可感知）
        recordSteamCall(response.ok || response.status === 404, response.status); // v10.3.0：404=空结果非失败
        recordDomainCall('store', response.ok || response.status === 404); // v11.0 B2
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
        recordDomainCall('store', false); // v14.0.0：网络失败计入 store 域熔断
      }
    }
  }
  // v14.8 批次 18：appreviews 端点 302（Steam 侧变更——全参数形态 302 商店
  // 首页，json=1 失效）→ **商店页 HTML 回退解析**：user_reviews_summary_row
  // 三行（全部评测/最近评测/您语言）+ game_review_summary 描述文本，返回与
  // 上方同构的数据（评价文本不可得 → reviews 空数组，UI 按无文本降级）。
  // Store-page HTML fallback: the appreviews endpoint now redirects (Steam
  // change); parse the summary rows from the store page instead.
  // v14.8.2（用户实测截图：低/新评测游戏大面积 #AppID 裸徽章）——解析升级
  // **三形态**：①完整行（tooltip 带计数+好评率，≥10 评测）；②低评测行
  // （tooltip "需要更多用户评测来生成整体评价"，计数在 game_review_summary
  // span / meta reviewCount——Steam 自身不出百分比，positive 返回 null 交管
  // 线按"暂无整体评价"语义渲染，不再落入"获取失败"重试循环）；③无评测行
  // （tooltip "无用户评测"，total 0 = 历史 appreviews 0 评测同构）。
  // Three row forms: full (count+pct from tooltip), insufficient (count from
  // span/meta, Steam hides the pct → positive=null), zero (无用户评测).
  try {
    const pageResp = await fetchWithTimeout(`https://store.steampowered.com/app/${appId}/?l=schinese&cc=cn`);
    if (pageResp.ok) {
      const html = await pageResp.text();
      const tips = [...html.matchAll(/user_reviews_summary_row"[^>]*data-tooltip-html="([^"]+)"/g)].map((m) =>
        m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      );
      /** @param {string} tip */
      const parseTip = (tip) => {
        const count = Number(((tip.match(/([\d,]+)\s*篇用户评测/) || [])[1] || '').replace(/,/g, ''));
        const pct = Number((tip.match(/有\s*(\d+)%\s*为好评/) || [])[1]);
        return {
          count: Number.isFinite(count) ? count : null,
          pct: Number.isFinite(pct) ? pct : null,
          isRecent: tip.includes('过去 30 天'),
          isCn: tip.includes('您语言')
        };
      };
      const parsed = tips.map(parseTip).filter((r) => r.count != null && r.pct != null);
      const allRow = parsed.find((r) => !r.isRecent && !r.isCn) || parsed[0] || null;
      const recentRow = parsed.find((r) => r.isRecent) || null;
      // v14.8 TS18047：解构到局部常量供 TS 收窄（allRow.count 判空后不再宽化）
      const allCount = allRow && allRow.count != null ? allRow.count : 0;
      const allPct = allRow && allRow.pct != null ? allRow.pct : 0;
      if (allRow && allCount > 0) {
        const positive = Math.round((allCount * allPct) / 100);
        const recentTotal = recentRow && recentRow.count != null ? recentRow.count : 0;
        const recentPct = recentRow && recentRow.pct != null ? recentRow.pct : 0;
        const descMatch = html.match(/game_review_summary\s+(?:positive|mixed|negative)"[^>]*>([^<]+)</);
        const desc = descMatch ? descMatch[1].trim() : null;
        const score = allPct >= 95 ? 10 : allPct >= 80 ? 9 : allPct >= 70 ? 8 : allPct >= 40 ? 7 : allPct >= 20 ? 6 : 5;
        recordSteamCall(true, 200);
        recordDomainCall('store', true);
        Logger.info('Steam', `好评率回退（商店页解析）: ${appId} → ${allPct}%（${desc}，${allCount} 篇）`);
        return {
          total: allCount,
          positive,
          negative: Math.max(0, allCount - positive),
          score,
          desc,
          recent: {
            total: recentTotal,
            positive: recentRow ? Math.round((recentTotal * recentPct) / 100) : 0,
            rate: recentRow ? recentPct : null
          }
        };
      }
      // v14.8.2：低/零评测形态——tooltip 无 count+pct 时，从行内
      // game_review_summary span / meta reviewCount 取计数
      const rowBlocks = [
        ...html.matchAll(/user_reviews_summary_row"[^>]*data-tooltip-html="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)
      ].map((m) => {
        const tip = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        const meta = Number((m[2].match(/itemprop="reviewCount" content="(\d+)"/) || [])[1]);
        const span = Number(((m[2].match(/([\d,]+)\s*篇用户评测/) || [])[1] || '').replace(/,/g, ''));
        const count = Number.isFinite(meta) ? meta : Number.isFinite(span) ? span : null;
        return { tip, count: Number.isFinite(count) ? count : null, isRecent: tip.includes('过去 30 天') };
      });
      const insufficient = rowBlocks.find(
        (b) => !b.isRecent && b.count != null && b.count > 0 && b.tip.includes('需要更多用户评测')
      );
      const zeroRow = rowBlocks.find((b) => !b.isRecent && (b.tip.includes('无用户评测') || b.count === 0));
      if (insufficient) {
        recordSteamCall(true, 200);
        recordDomainCall('store', true);
        Logger.info('Steam', `好评率回退（低评测）: ${appId} → ${insufficient.count} 篇（Steam 未生成整体评价）`);
        return {
          total: insufficient.count,
          positive: null, // Steam 未出百分比——管线按"暂无整体评价"渲染，不伪造
          negative: null,
          score: 0,
          desc: '需要更多用户评测来生成整体评价',
          recent: { total: 0, positive: 0, rate: null }
        };
      }
      if (zeroRow) {
        recordSteamCall(true, 200);
        recordDomainCall('store', true);
        Logger.info('Steam', `好评率回退（无评测）: ${appId} → 0 篇`);
        return {
          total: 0,
          positive: 0,
          negative: 0,
          score: 0,
          desc: '无用户评测',
          recent: { total: 0, positive: 0, rate: null }
        };
      }
    }
  } catch {
    /* 商店页回退失败 → 维持 null（UI 降级） */
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
// v10.7.0 批次3：会话内去重缓存（24h，含 null 负缓存）——lastUpdate 变更
// 极低频，同一 appId 在缓存过期重建/多批次重复解析时不再重复打
// api.steampowered.com（与 appreviews 共享限流域）
// Session dedupe cache for news lookups (24h incl. negative), cutting repeat
// GetNewsForApp calls on cache rebuilds and repeated resolutions.
const lastUpdateCache = createTtlCache({ ttlMs: 24 * 3600e3, max: STORAGE_CAPS.itadPriceCache }); // v14.2.0：补 max

export async function fetchLastUpdate(appId) {
  const key = String(appId);
  const cached = lastUpdateCache.peek(key);
  if (cached !== undefined) return cached;
  // v14.6.2 修复（审查 A10）：api 域熔断短路——与 store 域搜索短路对称
  //（此前熔断打开时仍逐个发出、各挂 4s；注意直接返回不写负缓存——熔断期
  // 失败固化 24h 会把恢复后的查询一并挡掉）
  if (isCircuitOpen('api')) return null;
  try {
    // v10.9.2：4s 硬帽——api.steampowered.com（GetNewsForApp）在大陆网络不可达，
    // 默认 15s 挂起会把整条 SEARCH_STEAM 拖过消息超时（"最近更新"仅为徽章角
    // 数据，不应主导搜索预算）；失败经 lastUpdateCache 负缓存 24h
    const resp = await fetchWithTimeout(
      `${ENDPOINTS.steamAppNews}?appid=${appId}&count=1&maxlength=0&format=json`,
      {},
      PERF_CONFIG.fetchTimeoutLastUpdateMs
    );
    // v14.0.0：api 域可达性上报（此前 api 域恒为 unknown）——只记 domain 不记
    // recordSteamCall：全局失败率会因大陆常态不可达而恒报警，误触发批量降速
    recordDomainCall('api', resp.ok);
    if (!resp.ok) {
      lastUpdateCache.set(key, null);
      return null;
    }
    const data = await resp.json();
    const item = data && data.appnews && data.appnews.newsitems && data.appnews.newsitems[0];
    if (!item || !item.date) {
      lastUpdateCache.set(key, null);
      return null;
    }
    const d = new Date(item.date * 1000);
    if (isNaN(d.getTime())) {
      lastUpdateCache.set(key, null);
      return null;
    }
    const out = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    lastUpdateCache.set(key, out);
    return out;
  } catch {
    recordDomainCall('api', false); // v14.0.0：网络失败计入 api 域熔断
    lastUpdateCache.set(key, null);
    return null;
  }
}

async function fetchChineseReviews(appId) {
  /** @type {{total: number, positive: number, negative: number, score: number|null, desc: string|null, positiveRate: number|null}|null} */
  let cnReviewSummary = null;
  let chineseReviews = [];
  try {
    const cnReviewUrl = `${ENDPOINTS.steamAppReviews}${appId}?json=1&language=schinese&num_per_page=10&filter=all`;
    const resp = await fetchWithTimeout(cnReviewUrl);
    // v14.7 批次 13：429/5xx 也带 JSON 体——不查 ok 会静默按空数据处理且不计失败
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
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
    recordSteamCall(false, 0); // v14.0.0：网络失败计入限流统计（与 fetchReviewSummary 对齐）
    recordDomainCall('store', false); // v14.0.0：计入 store 域熔断
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
