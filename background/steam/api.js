/**
 * Game Recommender - Steam API 子模块 / Steam API Submodules
 *
 * 搜索（中英并行）、应用详情、商店页 HTML、中文语言支持解析、用户标签、
 * 评测汇总、SteamDB/SteamSpy 补充数据、结果组装。所有外部请求均经过
 * 带超时与 host 校验的 fetch。
 * Steam API submodules: bilingual search, details, store HTML, language/tags
 * parsing, review summaries, SteamDB/SteamSpy fallbacks, result assembly.
 * All requests go through the timeout + host-validated fetch.
 */
import { fetchWithTimeout } from '../core/utils.js';
import { Logger } from '../storage/logger.js';
import { getGameRegistryEntry, recordGameInRegistry, flushRegistry } from '../storage/registry.js';
import { generateSearchVariants, extractNoiseCandidates } from './title-parser.js';
import { getActiveNoiseWords, recordNoiseCandidates } from '../storage/learned-noise.js';
import { recordSteamCall, getSteamApiStatus } from '../core/api-monitor.js';

// 附属内容/非本体关键词（带 \b 边界，避免误伤 ghost/post/trials 等合法游戏名）
// Add-on keywords with \b boundaries (never misjudge real names like Ghost/Trials)
export const ADDON_NAME_PATTERN = /\bdemo\b|试玩|\btrial\b|prologue|序章|序幕|\bsoundtrack\b|\bost\b|\bartbook\b|\bdlc\b|supporter pack|支持者包|fan pack|wallpaper|screenshot|原声带|美术集|设定集|艺术集|画集|壁纸|原画集|收藏版|内容包|扩展包|追加内容|组合包/i;
// Demo/试玩版（单独用于 isDemo 标识）/ Demo/trial edition (for the isDemo badge)
export const DEMO_NAME_PATTERN = /\bdemo\b|试玩|\btrial\b/i;

// 名称相关性校验（v3.2.2）：防止下载站噪声词/删词变体匹配到无关游戏或续作。
// 规范化后要求"结果名包含搜索词"；若原始标题中搜索词之后紧跟数字（如
// "PC Building Simulator 2" 删词后变体缺失"2"），结果名必须也含数字——
// 精确匹配时同样生效（变体词恰为前作名时拒绝）。
// Name-relevance check: the result must contain the search term (normalized);
// when the raw title has a digit right after the term, the result must too
// (blocks sequel/1st-gen mismatches such as "PC Building Simulator 2" → gen 1,
// including when the variant term equals the predecessor's exact name).
export function nameMatchesSearch(resultName, term, rawName) {
  const norm = s => String(s || '').toLowerCase().replace(/[\s\-_:：|.'!！?？\[\]()（）×•·]/g, '');
  const rn = norm(resultName);
  const tn = norm(term);
  if (!rn || !tn || rn.length < 2 || tn.length < 2) return false;
  // 纯短英文词（≤3 字母，如 PC/VR/HD）：仅精确匹配接受，防"PC"匹配"Gunner, HEAT, PC!"类
  if (/^[a-z]{1,3}$/.test(tn) && rn !== tn) return false;

  // 续作防护：原始标题中该词后紧跟数字，而结果名无数字 → 视为不相关
  const rawNorm = norm(rawName);
  const idx = rawNorm.indexOf(tn);
  const next = idx >= 0 ? rawNorm[idx + tn.length] : '';
  const digitGap = !!next && /\d/.test(next) && !/\d/.test(rn);

  if (rn === tn) return !digitGap;
  if (rn.includes(tn)) return !digitGap;

  // 跨语言信任：搜索词与结果名一中文一英文时（如英文搜索词命中官方中文名
  // 条目"Gladiator Guild Manager"→"角斗士公会经理"），信任 storesearch 索引
  // 匹配；数字差异（1代/2代）仍拒绝。
  if (digitGap) return false;
  const cnOf = s => /[\u4e00-\u9fff]/.test(s);
  if (cnOf(tn) !== cnOf(rn)) return true;
  return false;
}

// 名称校验：中文名含中文、英文名含英文、不命中附属内容关键词
// Name validation for zero-review verification and registry writes
export function validateSteamNames(cnName, enName) {
  const cn = cnName || '';
  const en = enName || '';
  const issues = [];
  if (cn && !/[\u4e00-\u9fff]/.test(cn)) issues.push('中文名不含中文');
  if (en && !/[A-Za-z]{2,}/.test(en)) issues.push('英文名不含英文');
  if (ADDON_NAME_PATTERN.test(cn) || ADDON_NAME_PATTERN.test(en)) issues.push('疑似附属内容');
  return { valid: issues.length === 0, issues };
}

// 从 appdetails 数据解析"游戏本体" appId（v3.2.6+，v3.2.10 补 demo，v3.3.4 兼容真实字段）：
//   - type=game → 自身
//   - type=demo → 优先解析所属本体（demo 页面同样带 fullgame，如
//     "杀死影子 Demo" 2947640 → 2660230）；无 fullgame 的独立 Demo 保留自身
//   - type=dlc 且含 fullgame → 返回所属本体 appId（DLC 页面提供）
//   - 其他（bundle/mod/music/soundtrack/video/software/hardware 等非本体）→ null
// 注意：appdetails 响应的应用 ID 字段是 `steam_appid`（无 `appid`），
// 两者都兼容（测试/模拟数据可能用 appid）。
// Resolve the base-game appId from appdetails data: game stays; a demo resolves
// to its full game when fullgame exists (e.g. "杀死影子 Demo" 2947640 →
// 2660230), otherwise stays; a DLC with fullgame resolves to its base game;
// every other non-base type (bundle/mod/music/video/software/hardware...) → null.
// Note: the real appdetails payload names the app id `steam_appid` (there is no
// `appid` field); both are accepted (tests/mock data may use `appid`).
export function baseAppIdFromDetails(data) {
  if (!data || typeof data !== 'object') return null;
  const selfId = data.appid || data.steam_appid;
  if (data.type === 'game') {
    return selfId ? String(selfId) : null;
  }
  if (data.type === 'demo') {
    if (data.fullgame && data.fullgame.appid) return String(data.fullgame.appid);
    return selfId ? String(selfId) : null;
  }
  if (data.type === 'dlc' && data.fullgame && data.fullgame.appid) {
    return String(data.fullgame.appid);
  }
  return null;
}

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
export const RATING_RETRY_COOLDOWN_MS = 5 * 60 * 1000;

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
  return !!data.url &&
    !!data.name &&
    Array.isArray(data.genres) &&
    Array.isArray(data.userTags) &&
    Array.isArray(data.developers) &&
    data.chineseSupported !== undefined &&
    data.releaseDate !== undefined &&
    data.description !== undefined &&
    !!data.headerImage;
}

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
  if (isFailedRatingEntry(d)) return true;
  if (d.ratingRetriedAt && (Date.now() - d.ratingRetriedAt < RATING_RETRY_COOLDOWN_MS)) return false;
  return true;
}

// 封面图 URL：优先已有封面，否则按 appId 构造 Steam CDN header 图（纯函数，可单测）
// Cover URL: keep the provided cover, else build the Steam CDN header URL
export function coverImageFor(appId, fallback) {
  if (fallback && /^https?:\/\//i.test(fallback)) return fallback;
  if (appId) return `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
  return '';
}

// --- 搜索 ---

// 单次搜索实现（网络全挂时抛错供外层重试；无结果返回 null 表示"确实未找到"）
// 结果需通过名称相关性校验（防噪声词/删词变体误匹配无关游戏或续作）。
// One search pass (throws on total network failure for outer retry; null = not
// found). Results must pass the name-relevance check.
async function searchSteamAppIdOnce(searchTerms, rawName) {
  for (const term of searchTerms) {
    let cnData = null;
    let enData = null;
    for (let attempt = 0; attempt < 2 && cnData === null; attempt++) {
      try {
        cnData = await (await fetchWithTimeout(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=schinese&cc=cn`)).json();
        recordSteamCall(true);
      } catch (e) {
        recordSteamCall(false); /* 中文搜索失败不阻断流程 */
      }
    }
    try {
      enData = await (await fetchWithTimeout(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=cn`)).json();
      recordSteamCall(true);
    } catch (e) {
      recordSteamCall(false); /* 英文搜索失败回退中文名 */
    }

    // 网络整体失败（中英文均未返回）：抛错 → 外层重试一次（抗瞬时抖动）
    if (!cnData && !enData) throw new Error('Steam 搜索网络失败');

    const cnItems = (cnData && cnData.items) || [];
    if (cnItems.length > 0) {
      // 名称相关性校验：优先非 Demo/附属且与搜索词相关的项；无相关项则尝试下一词
      const related = cnItems.find(i => !ADDON_NAME_PATTERN.test(i.name || '') && nameMatchesSearch(i.name, term, rawName));
      if (!related) continue;
      const enItems = (enData && enData.items) || [];
      const pickedEn = enItems.find(i => i.id === related.id) || enItems[0] || null;
      return {
        appId: related.id,
        name: related.name,
        englishName: pickedEn ? pickedEn.name : related.name
      };
    }
  }
  return null;
}

// 并行获取中英文搜索结果（英文名用于注册表记录；网络失败整体重试一次防抖动）。
// 静态候选全部失败时自动进入"扩展组合搜索"（删词变体 + 动态噪声词清洗），
// 成功后把跳过的词作为候选噪声词自动学习（自适应检索，v3.1.2）。
// Parallel CN/EN searches; one whole-pass retry on network flakiness. When all
// static candidates fail, an extended combination search (word-drop variants +
// learned-noise cleaning) runs automatically; skipped words are then learned.
export async function searchSteamAppId(searchTerms, rawName) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await searchSteamAppIdOnce(searchTerms, rawName);
      if (result) return result;
      break; // 网络正常但未找到：不重试
    } catch (e) { /* 网络失败：重试一次 */ }
  }

  // 扩展组合搜索：删词变体 + 已生效的动态噪声词清洗
  // Extended search: word-drop variants + active learned-noise cleaning
  if (rawName) {
    const activeNoise = await getActiveNoiseWords();
    const variants = generateSearchVariants(rawName, activeNoise);
    for (const variant of variants) {
      const result = await searchSteamAppIdLight(variant, rawName);
      if (result) {
        // 成功 → 自动学习被跳过的词（计数确认后才生效，防误学副标题）
        const noiseWords = extractNoiseCandidates(rawName, variant);
        if (noiseWords.length > 0) {
          await recordNoiseCandidates(noiseWords);
          Logger.info('Steam', `扩展搜索命中: "${rawName}" → "${variant}" (appId ${result.appId})，候选噪声词: ${noiseWords.join('、')}`);
        }
        return result;
      }
    }
  }
  return null;
}

// 轻量单次中文搜索（扩展组合用：低开销，不加重试与英文搜索；结果需通过名称校验）
// Lightweight single CN search (cheap; results pass the name-relevance check)
async function searchSteamAppIdLight(term, rawName) {
  try {
    const data = await (await fetchWithTimeout(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=schinese&cc=cn`)).json();
    const items = (data && data.items) || [];
    if (items.length === 0) return null;
    // 名称相关性校验：变体词较短，要求结果包含变体词且与原始标题相关
    const related = items.find(i => !ADDON_NAME_PATTERN.test(i.name || '') && nameMatchesSearch(i.name, term, rawName));
    if (!related) return null;
    return { appId: related.id, name: related.name, englishName: related.name };
  } catch (e) {
    return null;
  }
}

// --- 应用详情 ---

// 获取应用详情（language: schinese/english 等，name 随语言） / Fetch app details
export async function fetchSteamAppDetails(appId, language = 'schinese') {
  const detailUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=${language}`;
  try {
    const response = await fetchWithTimeout(detailUrl);
    const detailData = await response.json();
    recordSteamCall(true);
    if (!detailData[appId] || !detailData[appId].success) return null;
    return detailData[appId].data;
  } catch (e) {
    recordSteamCall(false);
    return null;
  }
}

// --- 商店页面 HTML ---

export async function fetchStorePageHtml(appId) {
  try {
    const storePageUrl = `https://store.steampowered.com/app/${appId}/?cc=cn&l=schinese`;
    const resp = await fetchWithTimeout(storePageUrl, { headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' } });
    return await resp.text();
  } catch (e) {
    console.log('获取商店页面失败:', e);
    return '';
  }
}

// --- 中文语言支持解析 ---

export function parseChineseLanguageSupport(storeHtml, gameData) {
  let chineseSupported = false;
  let simplifiedChinese = false;
  let chineseHasAudio = false;
  let chineseHasSubtitles = false;

  // 方法1：解析商店页语言支持表 (game_language_options)
  if (storeHtml) {
    const langTableMatch = storeHtml.match(/<table[^>]*class="[^"]*game_language_options[^"]*"[\s\S]*?<\/table>/i);
    if (langTableMatch) {
      const langTable = langTableMatch[0];
      const rows = langTable.match(/<tr[\s\S]*?<\/tr>/gi) || [];
      for (const row of rows) {
        const isSimplifiedRow = /简体中文|Chinese\s*\(Simplified\)/i.test(row);
        const isChineseRow = /中文|Chinese/i.test(row) && !/繁体|Traditional/i.test(row);
        if (isSimplifiedRow || isChineseRow) {
          const hasCheck = /✓|&#10003;|class="[^"]*check/i.test(row);
          const cells = row.match(/<td[\s\S]*?<\/td>/gi) || [];
          if (hasCheck || cells.some(c => /✓|&#10003;|check/i.test(c))) {
            chineseSupported = true;
            if (isSimplifiedRow) simplifiedChinese = true;
            if (cells.length >= 3) {
              chineseHasAudio = /✓|&#10003;|check/i.test(cells[2] || '');
              chineseHasSubtitles = /✓|&#10003;|check/i.test(cells[3] || '');
            }
          }
        }
      }
    }
  }

  // 方法2：回退到 supported_languages 字段
  if (!chineseSupported) {
    const supportedLangs = gameData.supported_languages || '';
    const cleanLangs = supportedLangs.replace(/<[^>]+>/g, ' ');
    chineseSupported = /简体中文|繁体中文|Chinese|中文/i.test(cleanLangs);
    simplifiedChinese = /简体中文|Simplified\s*Chinese/i.test(cleanLangs);
  }

  return { chineseSupported, simplifiedChinese, chineseHasAudio, chineseHasSubtitles };
}

// --- 用户标签解析 ---

export function parseUserTags(storeHtml) {
  if (!storeHtml) return [];
  const tagMatches = storeHtml.match(/<a[^>]*class="[^"]*app_tag[^"]*"[^>]*>[\s\S]*?<\/a>/gi);
  if (!tagMatches) return [];

  const seenTags = new Set();
  return tagMatches
    .map(m => m
      .replace(/<[^>]+>/g, '')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(t => {
      if (t.length < 1 || t.length > 30) return false;
      const lower = t.toLowerCase();
      if (seenTags.has(lower)) return false;
      seenTags.add(lower);
      return true;
    })
    .slice(0, 10);
}

// --- 评测获取 ---

// 近 30 天评测窗口（秒）/ 30-day recent-review window (seconds)
export const RECENT_REVIEW_WINDOW_SEC = 30 * 24 * 3600;

// 从最近评测列表中统计 30 天窗口内好评率（纯函数，可单测）。
// appreviews 的 query_summary 恒为全时段统计（filter=recent 不影响），
// 近 30 天好评率需从 reviews 数组自行统计（filter=recent 按时间降序返回）。
// Summarize a 30-day window from a recent-reviews list (pure, testable).
// query_summary always covers all-time totals (filter=recent does not change
// it), so the 30-day rate is computed from the reviews array itself.
export function summarizeRecentReviews(reviews, cutoffSec = Date.now() / 1000 - RECENT_REVIEW_WINDOW_SEC) {
  const list = Array.isArray(reviews) ? reviews : [];
  const inWindow = list.filter(r => r && typeof r.timestamp_created === 'number' && r.timestamp_created >= cutoffSec);
  if (inWindow.length === 0) {
    return { total: 0, positive: 0, rate: null };
  }
  const positive = inWindow.filter(r => r.voted_up === true).length;
  return {
    total: inWindow.length,
    positive,
    rate: Math.round(positive / inWindow.length * 100)
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
      recordSteamCall(true);
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
    } catch (e) {
      recordSteamCall(false); // 重试一次 / retry once
    }
  }
  return null;
}

// 最近更新日期（v3.3.6）：Steam 官方无"最近更新"字段，用最新公告日期近似
// （GetNewsForApp 免费无 key；持续更新/抢先体验游戏即最新更新公告，完成品
// 显示发行日附近——语义"无后续更新"）。失败返回 null（UI 隐藏该部分）。
// Last-update date: Steam exposes no such field; the newest announcement date
// approximates it (GetNewsForApp is keyless). Null on failure (UI hides it).
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
  } catch (e) {
    return null;
  }
}

export async function fetchChineseReviews(appId) {
  let cnReviewSummary = null;
  let chineseReviews = [];
  try {
    const cnReviewUrl = `https://store.steampowered.com/appreviews/${appId}?json=1&language=schinese&num_per_page=10&filter=all`;
    const resp = await fetchWithTimeout(cnReviewUrl);
    const data = await resp.json();
    if (data.success === 1) {
      if (data.reviews && data.reviews.length > 0) {
        chineseReviews = data.reviews.slice(0, 5).map(r => ({
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
          positiveRate: qs.total_reviews > 0
            ? Math.round(qs.total_positive / qs.total_reviews * 100)
            : null
        };
      }
    }
  } catch (e) {
    console.log('获取中文评价失败:', e);
  }
  return { cnReviewSummary, chineseReviews };
}

export async function fetchSteamReviews(appId) {
  const [reviewSummary, cnData] = await Promise.all([
    fetchReviewSummary(appId),
    fetchChineseReviews(appId)
  ]);
  return {
    reviewSummary,
    cnReviewSummary: cnData.cnReviewSummary,
    chineseReviews: cnData.chineseReviews
  };
}

// --- SteamDB 信息 ---

export async function fetchSteamDbInfo(appId) {
  const steamdbUrl = `https://steamdb.info/app/${appId}/`;
  try {
    const resp = await fetchWithTimeout(steamdbUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    });
    const html = await resp.text();
    const isBlocked = !resp.ok ||
      /Just a moment|cf-browser-verification|challenge-platform|Checking your browser|Attention Required/i.test(html);

    if (isBlocked) {
      return { url: steamdbUrl, available: false, blocked: true };
    }

    const ratingMatch = html.match(/<div[^>]*class="[^"]*header-rating[^"]*"[^>]*>\s*<span[^>]*>([\d.]+)%?<\/span>/i) ||
                        html.match(/([\d.]+)%\s*(?:positive|好评)/i);
    const playersMatch = html.match(/([\d,]+)\s*(?:players|人在玩)/i);
    const priceMatch = html.match(/Lowest Price[\s\S]*?([\d.,]+\s*(?:¥|\$|USD|CNY))/i);
    const reviewCountMatch = html.match(/([\d,]+)\s*(?:reviews|评测|评价)/i);

    return {
      url: steamdbUrl,
      rating: ratingMatch ? ratingMatch[1] : null,
      reviewCount: reviewCountMatch ? reviewCountMatch[1] : null,
      currentPlayers: playersMatch ? playersMatch[1] : null,
      lowestPrice: priceMatch ? priceMatch[1] : null,
      available: true,
      blocked: false
    };
  } catch (e) {
    console.log('SteamDB获取失败:', e.message);
    return { url: steamdbUrl, available: false, blocked: true };
  }
}

// --- SteamSpy 信息（SteamDB 被拦截时的补充数据） ---

// v3.3.6：实测 SteamSpy 响应的可用字段为 positive/negative/ccu(当前在线)/
// owners(拥有者区间)/average_forever(平均游玩分钟)——原 players_2weeks/
// players_forever 字段并不存在，恒为 null，已改为 ccu/owners。
// Field fix: the real SteamSpy payload exposes positive/negative/ccu/owners/
// average_forever; the previously-read players_2weeks/players_forever never
// exist and were always null.
export async function fetchSteamSpyInfo(appId) {
  try {
    const resp = await fetchWithTimeout(`https://steamspy.com/api.php?request=appdetails&appid=${appId}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data || !data.appid) return null;

    const total = (data.positive || 0) + (data.negative || 0);
    return {
      positiveRate: total > 0 ? Math.round(data.positive / total * 100) : null,
      reviewCount: total > 0 ? total.toLocaleString() : null,
      currentPlayers: data.ccu ? data.ccu.toLocaleString() : null,
      owners: data.owners || null,
      averagePlaytime: data.average_forever ? Math.round(data.average_forever / 60) + '小时' : null
    };
  } catch (e) {
    console.log('SteamSpy获取失败:', e.message);
    return null;
  }
}

// --- 组装最终结果对象 ---

export function buildSteamResult(appId, gameData, langInfo, userTags, reviews, steamdbInfo, steamspyInfo, enGameData, lastUpdate = null) {
  const { reviewSummary, cnReviewSummary, chineseReviews } = reviews;
  const { chineseSupported, simplifiedChinese, chineseHasAudio, chineseHasSubtitles } = langInfo;
  // 近 30 天好评率（v3.3.6，来自 filter=recent 评测数组统计）
  const recent = reviewSummary && reviewSummary.recent ? reviewSummary.recent : null;

  return {
    appId,
    type: gameData.type || 'game', // Steam 条目类型（game/dlc/demo/...）/ entry type
    name: gameData.name,
    // 英文名：来自 english 语言的详情（注册表/缓存管理页使用）
    englishName: (enGameData && enGameData.name) || gameData.name,
    // 是否为 Demo/试玩版（详情页浮窗显示标识用）
    isDemo: DEMO_NAME_PATTERN.test((enGameData && enGameData.name) + ' ' + gameData.name),
    url: `https://store.steampowered.com/app/${appId}/`,
    steamdbUrl: steamdbInfo?.url || `https://steamdb.info/app/${appId}/`,
    rating: reviewSummary ? reviewSummary.score : null,
    ratingDesc: reviewSummary ? reviewSummary.desc : null,
    totalReviews: reviewSummary ? reviewSummary.total : 0,
    positiveRate: reviewSummary && reviewSummary.total > 0
      ? Math.round(reviewSummary.positive / reviewSummary.total * 100)
      : null,
    // 近 30 天评价（v3.3.6）：好评率 + 条数（0 条 → rate null）
    recentPositiveRate: recent ? recent.rate : null,
    recentTotalReviews: recent ? recent.total : 0,
    // 最近更新日期（最新公告日期近似，v3.3.6）
    lastUpdate,
    cnRatingDesc: cnReviewSummary ? cnReviewSummary.desc : null,
    cnPositiveRate: cnReviewSummary ? cnReviewSummary.positiveRate : null,
    cnTotalReviews: cnReviewSummary ? cnReviewSummary.total : 0,
    reviews: chineseReviews,
    genres: (gameData.genres || []).map(g => g.description),
    userTags,
    chineseSupported,
    simplifiedChinese,
    chineseHasAudio,
    chineseHasSubtitles,
    releaseDate: gameData.release_date?.date || '',
    developers: gameData.developers || [],
    description: gameData.short_description || '',
    headerImage: gameData.header_image || '',
    steamdb: steamdbInfo,
    steamspy: steamspyInfo
  };
}

// 通过 appId 获取完整的 Steam 详情（组装：详情/语言/标签/评测/SteamDB/SteamSpy）
// 先校验 appId：DLC 等非游戏本体自动解析为所属本体（fullgame）。
// Fetch full Steam details by appId (details/language/tags/reviews/SteamDB/
// SteamSpy). The appId is validated first: a DLC resolves to its base game.
export async function fetchSteamFullDetailsByAppId(appId) {
  // 并行获取中英文详情：中文用于页面显示，英文名写入游戏注册表
  let [gameData, enGameData] = await Promise.all([
    fetchSteamAppDetails(appId, 'schinese'),
    fetchSteamAppDetails(appId, 'english').catch(() => null)
  ]);
  // appId 校验（统一走 baseAppIdFromDetails）：dlc/demo 等非本体自动切换到
  // 所属本体（fullgame）重新获取；bundle 等无法解析的类型视为无效。
  if (gameData) {
    const baseId = baseAppIdFromDetails(gameData);
    if (baseId && baseId !== String(appId)) {
      const reason = gameData.type === 'dlc' ? 'DLC' : gameData.type === 'demo' ? 'Demo' : gameData.type;
      Logger.warn('Steam', `appId ${appId} 为 ${reason}，自动解析为本体 ${baseId}（${(gameData.fullgame && gameData.fullgame.name) || ''}）`);
      appId = baseId;
      [gameData, enGameData] = await Promise.all([
        fetchSteamAppDetails(appId, 'schinese'),
        fetchSteamAppDetails(appId, 'english').catch(() => null)
      ]);
    } else if (!baseId) {
      // bundle/mod/music 等非本体且无法解析 → 视为无效
      Logger.warn('Steam', `appId ${appId} 类型 ${gameData.type} 非游戏本体且无法解析`);
      return null;
    }
  }
  if (!gameData) return null;

  const storeHtml = await fetchStorePageHtml(appId);
  const [langInfo, userTags, reviews] = await Promise.all([
    Promise.resolve(parseChineseLanguageSupport(storeHtml, gameData)),
    Promise.resolve(parseUserTags(storeHtml)),
    fetchSteamReviews(appId)
  ]);
  // v3.3.6：SteamSpy 总是请求（详情页以 SteamSpy 为主数据）；SteamDB 仍抓取
  // 供链接/补充；最近更新日期用最新公告日期近似
  const [steamdbInfo, steamspyInfo, lastUpdate] = await Promise.all([
    fetchSteamDbInfo(appId),
    fetchSteamSpyInfo(appId).catch(() => null),
    fetchLastUpdate(appId).catch(() => null)
  ]);

  return buildSteamResult(appId, gameData, langInfo, userTags, reviews, steamdbInfo, steamspyInfo, enGameData, lastUpdate);
}

// 通过注册表判断 appId 是否为 Demo/试玩版（缓存缺失时的自愈依据）
// Determine from the registry whether an appId is a Demo/trial edition
export async function isDemoAppId(appId) {
  if (!appId) return false;
  const entry = await getGameRegistryEntry(appId);
  if (!entry) return false;
  const text = [entry.cnName, entry.enName, ...(entry.names || [])].filter(Boolean).join(' ');
  return DEMO_NAME_PATTERN.test(text);
}

// 幂等补写注册表：缓存命中返回时确保注册表存在该条目的正确中英文名（含封面/type）
// Idempotent registry fill when serving from cache (cover + type included)
export async function ensureRegistryEntry(appId, cnName, enName, gameName, coverImage, type) {
  if (!appId) return;
  const existing = await getGameRegistryEntry(appId);
  if (existing && (existing.cnName || existing.enName)) {
    // 条目已存在：仅补缺失的封面与 type / fill missing cover & type only
    if (coverImage && !existing.coverImage && /^https?:\/\//i.test(coverImage)) {
      await recordGameInRegistry(appId, { coverImage });
    }
    if (type && !existing.type) {
      await recordGameInRegistry(appId, { type });
    }
    return;
  }
  await recordGameInRegistry(appId, {
    cnName: cnName || '',
    enName: enName || cnName || '',
    gameName: gameName || '',
    coverImage: coverImage || '',
    type: type || ''
  });
}

// 按 appId 修复注册表中异常的中英文名（并行获取官方名，一次修复两个字段）。
// 中文名异常时仅当 Steam 官方确实有中文名才覆盖（Steam 无中文名的游戏保持原值）。
// Self-heal abnormal CN/EN names by appId (parallel fetch, one pass). The CN
// name is overwritten only when Steam itself provides a Chinese name.
export async function healRegistryNames(appId, { cnName, enName, gameName }) {
  if (!appId) return false;
  const cnOk = cnName && /[\u4e00-\u9fff]/.test(cnName);
  const enOk = enName && /[A-Za-z]{2,}/.test(enName);
  if (cnOk && enOk) return false; // 正常，无需修复 / healthy
  try {
    const [cnData, enData] = await Promise.all([
      fetchSteamAppDetails(appId, 'schinese').catch(() => null),
      fetchSteamAppDetails(appId, 'english').catch(() => null)
    ]);
    const officialCn = (cnData && cnData.name) || '';
    const officialEn = (enData && enData.name) || '';
    const newCn = (!cnOk && officialCn && /[\u4e00-\u9fff]/.test(officialCn)) ? officialCn : cnName;
    const newEn = (!enOk && officialEn && /[A-Za-z]{2,}/.test(officialEn)) ? officialEn : (enName || cnName);
    if (newCn !== cnName || newEn !== enName) {
      await recordGameInRegistry(appId, {
        cnName: newCn || '',
        enName: newEn || '',
        gameName: gameName || ''
      });
      Logger.warn('Steam', `名称异常自愈: appId ${appId} cn "${cnName || '空'}"→"${newCn || '空'}" en "${enName || '空'}"→"${newEn || '空'}"`);
      return true;
    }
  } catch (e) {
    // 获取失败，下次访问时重试 / retry on the next visit
  }
  return false;
}

// 缓存命中路径的名称自愈入口（兼容旧调用语义）
// Self-heal entry for cache-hit paths (keeps the old call shape)
export async function ensureValidRegistryNames(appId, cnName, enName, gameName) {
  await healRegistryNames(appId, { cnName, enName, gameName });
}

// 批量自愈：扫描注册表中名称异常（中文名无中文/英文名无英文）的条目，分批修复
// Batch self-heal: scan the registry for abnormal names and fix them in batches
export async function scanAndHealRegistry(limit = 20) {
  const registry = await getGameRegistry();
  const abnormal = Object.entries(registry).filter(([, e]) => {
    const cnBad = !e.cnName || !/[\u4e00-\u9fff]/.test(e.cnName);
    const enBad = !e.enName || !/[A-Za-z]{2,}/.test(e.enName);
    return cnBad || enBad;
  });
  const targets = abnormal.slice(0, limit);
  let healed = 0;
  for (let i = 0; i < targets.length; i += 3) {
    const batch = targets.slice(i, i + 3);
    await Promise.all(batch.map(async ([appId, e]) => {
      try {
        if (await healRegistryNames(appId, { cnName: e.cnName, enName: e.enName, gameName: '' })) healed++;
      } catch (err) { /* 单条失败不阻断 */ }
    }));
  }
  if (healed > 0) await flushRegistry();
  return { scanned: targets.length, healed, remaining: abnormal.length - targets.length };
}

// 选择注册表英文名：优先下载站标题中的英文段，回退 Steam 官方英文名
// （实现在 title-parser.js，此处不重复定义）
// (EN-name picking lives in title-parser.js; not duplicated here)
