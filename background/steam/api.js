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
import { parseGameTitle, generateSearchVariants, extractNoiseCandidates } from './title-parser.js';
import { getActiveNoiseWords, recordNoiseCandidates } from '../storage/learned-noise.js';

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

// 封面图 URL：优先已有封面，否则按 appId 构造 Steam CDN header 图（纯函数，可单测）
// Cover URL: keep the provided cover, else build the Steam CDN header URL
export function coverImageFor(appId, fallback) {
  if (fallback && /^https?:\/\//i.test(fallback)) return fallback;
  if (appId) return `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
  return '';
}

// --- 搜索 ---

// 单次搜索实现（网络全挂时抛错供外层重试；无结果返回 null 表示"确实未找到"）
// One search pass (throws on total network failure for outer retry; null = not found)
async function searchSteamAppIdOnce(searchTerms) {
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

    // 网络整体失败（中英文均未返回）：抛错 → 外层重试一次（抗瞬时抖动）
    if (!cnData && !enData) throw new Error('Steam 搜索网络失败');

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

// 并行获取中英文搜索结果（英文名用于注册表记录；网络失败整体重试一次防抖动）。
// 静态候选全部失败时自动进入"扩展组合搜索"（删词变体 + 动态噪声词清洗），
// 成功后把跳过的词作为候选噪声词自动学习（自适应检索，v3.1.2）。
// Parallel CN/EN searches; one whole-pass retry on network flakiness. When all
// static candidates fail, an extended combination search (word-drop variants +
// learned-noise cleaning) runs automatically; skipped words are then learned.
export async function searchSteamAppId(searchTerms, rawName) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await searchSteamAppIdOnce(searchTerms);
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
      const result = await searchSteamAppIdLight(variant);
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

// 轻量单次中文搜索（扩展组合用：低开销，不加重试与英文搜索）
// Lightweight single CN search (for extended combinations: cheap, no retries)
async function searchSteamAppIdLight(term) {
  try {
    const data = await (await fetchWithTimeout(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=schinese&cc=cn`)).json();
    const items = (data && data.items) || [];
    if (items.length === 0) return null;
    const picked = pickSearchItem(items);
    return { appId: picked.id, name: picked.name, englishName: picked.name };
  } catch (e) {
    return null;
  }
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

// 幂等补写注册表：缓存命中返回时确保注册表存在该条目的正确中英文名（含封面）
// Idempotent registry fill when serving from cache (cover included)
export async function ensureRegistryEntry(appId, cnName, enName, gameName, coverImage) {
  if (!appId) return;
  const existing = await getGameRegistryEntry(appId);
  if (existing && (existing.cnName || existing.enName)) {
    // 条目已存在：仅补缺失的封面 / fill the missing cover only
    if (coverImage && !existing.coverImage && /^https?:\/\//i.test(coverImage)) {
      await recordGameInRegistry(appId, { coverImage });
    }
    return;
  }
  await recordGameInRegistry(appId, {
    cnName: cnName || '',
    enName: enName || cnName || '',
    gameName: gameName || '',
    coverImage: coverImage || ''
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
// Pick the registry EN name (title EN segment first, Steam official fallback)
export function pickRegistryEnName(gameName, steamEnName) {
  const enFromTitle = parseGameTitle(gameName || '').find(t => /^[A-Za-z]/.test(t));
  return enFromTitle || steamEnName || '';
}

// 记录 Steam 相关日志（统一出口）/ Log helper
export function logSteam(level, message, data) {
  Logger[level]('Steam', message, data);
}
