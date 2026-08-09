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
import { getGameRegistryEntry, recordGameInRegistry } from '../storage/registry.js';
import { parseGameTitle } from './title-parser.js';

// 附属内容/非本体关键词（带 \b 边界，避免误伤 ghost/post/trials 等合法游戏名）
// Add-on keywords with \b boundaries (never misjudge real names like Ghost/Trials)
export const ADDON_NAME_PATTERN = /\bdemo\b|试玩|\btrial\b|soundtrack|\bost\b|artbook|\bdlc\b|wallpaper|screenshot|原声带|美术集|设定集|艺术集|画集|壁纸|原画集|收藏版/i;
// Demo/试玩版（单独用于 isDemo 标识）/ Demo/trial edition (for the isDemo badge)
export const DEMO_NAME_PATTERN = /\bdemo\b|试玩|\btrial\b/i;

// 在搜索结果中挑选目标游戏：优先非 Demo 且非附属内容的游戏本体
// Pick the base game from search results (skip Demos and add-ons)
export function pickSearchItem(items) {
  const good = items.find(i => !ADDON_NAME_PATTERN.test(i.name || ''));
  return good || items[0];
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

// --- 搜索 ---

// 并行获取中英文搜索结果（英文名用于注册表记录；中文失败重试一次防抖动）
// Parallel CN/EN searches; EN names feed the registry; one CN retry on flakiness
export async function searchSteamAppId(searchTerms) {
  for (const term of searchTerms) {
    let cnData = null;
    let enData = null;
    for (let attempt = 0; attempt < 2 && cnData === null; attempt++) {
      try {
        cnData = await (await fetchWithTimeout(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=schinese&cc=cn`)).json();
      } catch (e) { /* 中文搜索失败不阻断流程 */ }
    }
    try {
      enData = await (await fetchWithTimeout(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=cn`)).json();
    } catch (e) { /* 英文搜索失败回退中文名 */ }

    const cnItems = (cnData && cnData.items) || [];
    if (cnItems.length > 0) {
      const picked = pickSearchItem(cnItems);
      const enItems = (enData && enData.items) || [];
      const pickedEn = enItems.find(i => i.id === picked.id) || enItems[0];
      return {
        appId: picked.id,
        name: picked.name,
        englishName: pickedEn ? pickedEn.name : picked.name
      };
    }
  }
  return null;
}

// --- 应用详情 ---

// 获取应用详情（language: schinese/english 等，name 随语言） / Fetch app details
export async function fetchSteamAppDetails(appId, language = 'schinese') {
  const detailUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=${language}`;
  const response = await fetchWithTimeout(detailUrl);
  const detailData = await response.json();
  if (!detailData[appId] || !detailData[appId].success) return null;
  return detailData[appId].data;
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

export async function fetchReviewSummary(appId) {
  try {
    const reviewUrl = `https://store.steampowered.com/appreviews/${appId}?json=1&language=all&num_per_page=0`;
    const response = await fetchWithTimeout(reviewUrl);
    const data = await response.json();
    if (data.success === 1 && data.query_summary) {
      const qs = data.query_summary;
      return {
        total: qs.total_reviews,
        positive: qs.total_positive,
        negative: qs.total_negative,
        score: qs.review_score,
        desc: qs.review_score_desc
      };
    }
  } catch (e) {
    console.log('获取总体评价失败:', e);
  }
  return null;
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
      players2weeks: data.players_2weeks ? data.players_2weeks.toLocaleString() : null,
      playersForever: data.players_forever ? data.players_forever.toLocaleString() : null,
      averagePlaytime: data.average_forever ? Math.round(data.average_forever / 60) + '小时' : null
    };
  } catch (e) {
    console.log('SteamSpy获取失败:', e.message);
    return null;
  }
}

// --- 组装最终结果对象 ---

export function buildSteamResult(appId, gameData, langInfo, userTags, reviews, steamdbInfo, steamspyInfo, enGameData) {
  const { reviewSummary, cnReviewSummary, chineseReviews } = reviews;
  const { chineseSupported, simplifiedChinese, chineseHasAudio, chineseHasSubtitles } = langInfo;

  return {
    appId,
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
// Fetch full Steam details by appId (details/language/tags/reviews/SteamDB/SteamSpy)
export async function fetchSteamFullDetailsByAppId(appId) {
  // 并行获取中英文详情：中文用于页面显示，英文名写入游戏注册表
  const [gameData, enGameData] = await Promise.all([
    fetchSteamAppDetails(appId, 'schinese'),
    fetchSteamAppDetails(appId, 'english')
  ]);
  if (!gameData) return null;

  const storeHtml = await fetchStorePageHtml(appId);
  const [langInfo, userTags, reviews] = await Promise.all([
    Promise.resolve(parseChineseLanguageSupport(storeHtml, gameData)),
    Promise.resolve(parseUserTags(storeHtml)),
    fetchSteamReviews(appId)
  ]);
  const steamdbInfo = await fetchSteamDbInfo(appId);
  const steamspyInfo = (!steamdbInfo || !steamdbInfo.available)
    ? await fetchSteamSpyInfo(appId)
    : null;

  return buildSteamResult(appId, gameData, langInfo, userTags, reviews, steamdbInfo, steamspyInfo, enGameData);
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

// 幂等补写注册表：缓存命中返回时确保注册表存在该条目的正确中英文名
// Idempotent registry fill when serving from cache
export async function ensureRegistryEntry(appId, cnName, enName, gameName) {
  if (!appId) return;
  const existing = await getGameRegistryEntry(appId);
  if (existing && (existing.cnName || existing.enName)) return;
  await recordGameInRegistry(appId, {
    cnName: cnName || '',
    enName: enName || cnName || '',
    gameName: gameName || ''
  });
}

// 英文名异常自愈：注册表英文名须含英文字母（旧数据可能存在中文占位）。
// 发现异常时按 appId 重新获取 Steam 英文名并更新注册表。
// Self-heal the registry EN name: it must contain English letters (legacy data
// may hold Chinese placeholders). Re-fetches the official EN name by appId.
export async function ensureValidEnglishName(appId, enName, cnName, gameName) {
  if (!appId) return;
  if (enName && /[A-Za-z]{2,}/.test(enName)) return; // 正常，无需修复
  try {
    const enData = await fetchSteamAppDetails(appId, 'english');
    const officialEn = (enData && enData.name) || '';
    if (officialEn && /[A-Za-z]{2,}/.test(officialEn)) {
      await recordGameInRegistry(appId, {
        cnName: cnName || '',
        enName: officialEn,
        gameName: gameName || ''
      });
      Logger.warn('Steam', `英文名异常自愈: appId ${appId} "${enName || '空'}" → "${officialEn}"`);
    }
  } catch (e) {
    // 获取失败，下次访问时重试 / retry on the next visit
  }
}

// 中文名异常自愈：注册表中文名须含中文字符（旧数据可能缺失/被英文占位）。
// 发现异常时按 appId 重新获取 Steam 中文名并更新；
// 若 Steam 本身无中文名（如 Demeo），保持原值不覆盖。
// Self-heal the registry CN name: it should contain Chinese characters.
// Re-fetches the official CN name by appId; keeps the old value when Steam
// itself has no Chinese name (e.g. Demeo).
export async function ensureValidChineseName(appId, cnName, enName, gameName) {
  if (!appId) return;
  if (cnName && /[\u4e00-\u9fff]/.test(cnName)) return; // 正常，无需修复
  try {
    const cnData = await fetchSteamAppDetails(appId, 'schinese');
    const officialCn = (cnData && cnData.name) || '';
    if (officialCn && /[\u4e00-\u9fff]/.test(officialCn)) {
      await recordGameInRegistry(appId, {
        cnName: officialCn,
        enName: enName || '',
        gameName: gameName || ''
      });
      Logger.warn('Steam', `中文名异常自愈: appId ${appId} "${cnName || '空'}" → "${officialCn}"`);
    }
  } catch (e) {
    // 获取失败，下次访问时重试 / retry on the next visit
  }
}

// 选择注册表英文名：优先下载站标题中的英文段，回退 Steam 官方英文名
// Pick the registry EN name (title EN segment first, Steam official fallback)
export function pickRegistryEnName(gameName, steamEnName) {
  const enFromTitle = parseGameTitle(gameName || '').find(t => /^[A-Za-z]/.test(t));
  return enFromTitle || steamEnName || '';
}

// 记录 Steam 相关日志（统一出口）/ Log helper
export function logSteam(level, message, data) {
  Logger[level]('Steam', message, data);
}
