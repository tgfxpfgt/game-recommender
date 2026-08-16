import { recordSteamCall } from '../core/api-monitor.js';
import { generateSearchVariants, extractNoiseCandidates } from '../core/title-parser.js';
import { fetchWithTimeout } from '../core/utils.js';
import { getActiveNoiseWords, recordNoiseCandidates } from '../storage/learned-noise.js';
import { Logger } from '../storage/logger.js';
import { fetchSteamAppDetails } from './api-details.js';

// 附属内容/非本体关键词（带 \b 边界，避免误伤 ghost/post/trials 等合法游戏名）
// Add-on keywords with \b boundaries (never misjudge real names like Ghost/Trials)
export const ADDON_NAME_PATTERN =
  /\bdemo\b|试玩|\btrial\b|prologue|序章|序幕|\bsoundtrack\b|\bost\b|\bartbook\b|\bdlc\b|supporter pack|支持者包|fan pack|wallpaper|screenshot|原声带|美术集|设定集|艺术集|画集|壁纸|原画集|收藏版|内容包|扩展包|追加内容|组合包/i;
// Demo/试玩版（单独用于 isDemo 标识）/ Demo/trial edition (for the isDemo badge)
export const DEMO_NAME_PATTERN = /\bdemo\b|试玩|\btrial\b/i;

// 标题与缓存名是否相关（v3.3.10）：提取双方 CJK/英文词集合（去停用词），
// 任一语言共同词非空 → 相关；双方均为单语言且语言不同 → 跨语言信任；
// 混合语言且无共同词 → 不相关。用于 searchSteamGame 缓存命中校验，
// 防止名称索引粘性条目（历史误写钉死的 appId）命中缓存反复返回错误游戏。
// Title-vs-cached-name relevance (v3.3.10): shared CJK/EN tokens make them
// related; single-language pairs of different languages are trusted across
// languages; mixed-language pairs with no shared token are unrelated. Guards
// cache hits against sticky name-index entries that pin the wrong appId.
export function namesRelated(title, cachedName) {
  const norm = (s) => String(s || '').toLowerCase();
  // 中文词（连续 2+ 汉字）/ CJK tokens
  const cjkWords = (s) => norm(s).match(/[\u4e00-\u9fff\u3400-\u4dbf]{2,}/g) || [];
  // 英文词（≥4 字符，排除 of/the/and/ii 等短词与下载站噪声词）/
  // EN tokens (≥4 chars, excluding short words and download-site noise)
  const enWords = (s) => (norm(s).match(/[a-z][a-z0-9']{3,}/g) || []).filter((w) => !NOISE_EN_WORDS.has(w));
  const tCjk = cjkWords(title),
    tEn = enWords(title);
  const cCjk = cjkWords(cachedName),
    cEn = enWords(cachedName);
  const hasCommon = (a, b) => a.some((w) => b.includes(w));
  if (hasCommon(tCjk, cCjk) || hasCommon(tEn, cEn)) return true;
  // 跨语言信任：双方均单语言且语言不同（纯英文标题 vs 纯中文缓存名等）
  // v6.4.17：加数字冲突校验——"生化危机9" 跨语言匹配 "Resident Evil 4"
  // （系列旧作）被拒；候选无数字（"Resident Evil Requiem"）不冲突
  const tSingle = tCjk.length === 0 || tEn.length === 0;
  const cSingle = cCjk.length === 0 || cEn.length === 0;
  if (tSingle && cSingle && tCjk.length > 0 !== cCjk.length > 0) {
    return digitSetsOverlap(title, cachedName);
  }
  return false;
}

// v6.4.16：标题核心词提取（CJK 连续 2+ 汉字 + 英文 ≥4 字符，剔除数字段）——
// 供删词变体校验与候选打分使用。规范化小写。
// Core title tokens (CJK runs + EN words) for variant checks and scoring.
// v6.4.17：英文词排除下载站噪声（Build 号/标签等，官方名几乎不会用）——
// 否则 "Build.22898177" 的 build 使标题被判"混合语言"，跨语言信任失效，
// 纯英文官方名（Resident Evil Requiem）被误拒。
const NOISE_EN_WORDS = new Set(['build', 'plus', 'full', 'crack', 'repack', 'update']);
function coreTokensOf(text) {
  const norm = String(text || '').toLowerCase();
  const cjk = norm.match(/[\u4e00-\u9fff\u3400-\u4dbf]{2,}/g) || [];
  const en = (norm.match(/[a-z][a-z0-9']{3,}/g) || []).filter((w) => !NOISE_EN_WORDS.has(w));
  return [...cjk, ...en];
}

// v6.4.17：跨语言数字冲突校验——双方数字集合非空且无交集 → 冲突。
// 用于跨语言信任分支："生化危机9" vs "Resident Evil 4"（{9}∩{4}=∅ 冲突，
// 系列旧作）；"生化危机9" vs "Resident Evil Requiem"（候选无数字不冲突）。
// Digit-conflict guard for cross-language trust (blocks same-series old entries).
export function digitSetsOverlap(a, b) {
  const nums = (s) => (String(s).match(/\d+/g) || []).map((n) => Number(n));
  const na = nums(a);
  const nb = nums(b);
  if (na.length === 0 || nb.length === 0) return true; // 任一无数字 → 不冲突
  return na.some((x) => nb.includes(x));
}

/**
 * 游戏雷达 Game Radar - Steam API 子模块：api-search.js
 *
 * v5.0.0：由 steam/api.js 按职能拆分。
 */

// v5.0.0：偏好标签推荐（由 handlers/stats.js 内嵌裸 fetch 下沉）——按用户
// 偏好关键词在 Steam 商店搜索 + 取价格概览，返回候选游戏列表
// Tag-based Steam store recommendations (sunk from the stats handler).
export async function fetchSteamTagRecommendations(tags, limit = 9) {
  const recGames = [];
  for (const tag of tags.slice(0, 3)) {
    const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(tag)}&l=schinese&cc=cn`;
    const resp = await fetchWithTimeout(searchUrl);
    const data = await resp.json();

    if (data.total > 0 && data.items) {
      // v9.3.0：条目详情并发拉取（此前逐个串行——3 标签 × 4 条目 = 15 次串行请求，
      // 标签推荐长尾明显；改为每批 4 并发，标签间保持串行（storesearch 单在途）
      const items = data.items.slice(0, 4).filter((item) => !recGames.some((g) => g.appId === item.id));
      const details = await Promise.all(
        items.map(async (item) => {
          /** @type {{name?: string, header_image?: string, price_overview?: {final_formatted?: string}}|null} */
          let detail = null;
          try {
            const detUrl = `https://store.steampowered.com/api/appdetails?appids=${item.id}&l=schinese&filters=basic,price_overview`;
            const detResp = await fetchWithTimeout(detUrl);
            const detData = await detResp.json();
            if (detData[item.id]?.success) {
              detail = detData[item.id].data;
            }
          } catch {
            /* 详情失败用搜索条目兜底 */
          }
          return { item, detail };
        })
      );
      for (const { item, detail } of details) {
        recGames.push({
          appId: item.id,
          name: detail?.name || item.name,
          image: detail?.header_image || `https://cdn.akamai.steamstatic.com/steam/apps/${item.id}/header.jpg`,
          price: detail?.price_overview ? detail.price_overview.final_formatted : '免费',
          reviewSummary: '',
          url: `https://store.steampowered.com/app/${item.id}/`,
          matchTags: [tag]
        });
      }
    }
    if (recGames.length >= limit) break;
  }
  return recGames.slice(0, limit);
}

/**
 * 名称相关性校验（v3.2.2）：防止下载站噪声词/删词变体匹配到无关游戏或续作。
 * 规范化后要求"结果名包含搜索词"；若原始标题中搜索词之后紧跟数字（如
 * "PC Building Simulator 2" 删词后变体缺失"2"），结果名必须也含数字——
 * 精确匹配时同样生效（变体词恰为前作名时拒绝）。
 * Name-relevance check: the result must contain the search term (normalized);
 * when the raw title has a digit right after the term, the result must too
 * (blocks sequel/1st-gen mismatches such as "PC Building Simulator 2" → gen 1,
 * including when the variant term equals the predecessor's exact name).
 * @param {string} resultName - storesearch 结果名
 * @param {string} term - 搜索词
 * @param {string} rawName - 原始下载站标题
 * @returns {boolean} 是否相关
 */
export function nameMatchesSearch(resultName, term, rawName) {
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[\s\-_:：|.'!！?？\[\]()（）×•·]/g, '');
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
  const cnOf = (s) => /[\u4e00-\u9fff]/.test(s);

  if (rn === tn) return !digitGap;
  if (rn.includes(tn)) return !digitGap;

  // v6.4.19：数字间隔（digitGap）仅对同语言候选拒绝——跨语言候选（中文俗称
  // 标题 vs 英文官方名）允许"官方名无俗称序号"（如 生化危机9 → Resident Evil
  // Requiem：官方未加序号，但互联网习惯加 9）。同语言仍拒绝（防 1 代/旧作）。
  if (digitGap && cnOf(tn) === cnOf(rn)) return false;

  // 跨语言信任：搜索词与结果名一中文一英文时（如英文搜索词命中官方中文名
  // 条目"Gladiator Guild Manager"→"角斗士公会经理"），信任 storesearch 索引
  // 匹配；数字差异（1代/2代）仍拒绝。
  // v6.4.16 收紧：中文搜索词命中英文结果名**不再无条件信任**——schinese
  // 搜索对中文词的英文结果常为索引噪声（新作中文索引缺失时返回任意英文
  // 条目，如"生化危机9" → "Jrago III"类）；仅当原始标题含英文词且与结果
  // 名有共同英文词时才放行。英文搜索词命中中文结果名保留信任。
  // v6.4.19 俗称序号例外：标题含数字（"生化危机9"）且候选无数字（官方名
  // 未加序号 "Resident Evil Requiem"）→ 放行（storesearch 索引相关性保证
  // 候选与搜索词同源）。
  if (cnOf(tn) !== cnOf(rn)) {
    if (cnOf(tn)) {
      // 用原始 resultName 提取英文词（norm 去空格后无法分词）
      const rawEn = coreTokensOf(rawName).filter((w) => /^[a-z]/.test(w));
      const rEn = coreTokensOf(resultName).filter((w) => /^[a-z]/.test(w));
      if (rawEn.length > 0 && rawEn.some((w) => rEn.includes(w))) return true;
      return /\d/.test(rawName) && !/\d/.test(resultName);
    }
    return true;
  }
  return false;
}

// v6.4.16：删词变体校验——结果名除包含搜索词外，还须与原始标题的**其他
// 核心词**有交集。防通用词变体错配：标题"生化危机9 安魂曲"的删词变体
// "安魂曲"会命中任何名字含"安魂曲"的游戏（如"Jrago III 夜之安魂曲"），
// 而它与标题整体无关。变体搜索（扩展组合搜索）专用。
// Variant-search guard: the result must also share a core token with the part
// of the raw title that the variant dropped (blocks generic-word mismatches).
export function nameMatchesSearchVariant(resultName, term, rawName) {
  if (!nameMatchesSearch(resultName, term, rawName)) return false;
  const tn = String(term || '').toLowerCase();
  const others = coreTokensOf(rawName).filter((w) => !tn.includes(w));
  if (others.length === 0) return true;
  const rn = String(resultName || '').toLowerCase();
  // v6.4.19：结果名为纯英文（无 CJK）时，中文"其他核心词"跨语言不可比——
  // 仅校验英文 others（若无英文 others 则交 nameMatchesSearch 的跨语言分支
  // 把关：含搜索词 + 俗称序号/共同英文词例外）
  if (!/[\u4e00-\u9fff]/.test(rn)) {
    const enOthers = others.filter((w) => /^[a-z]/.test(w));
    if (enOthers.length === 0) return true;
    return enOthers.some((w) => rn.includes(w));
  }
  return others.some((w) => rn.includes(w));
}

// v6.4.16：候选相关性打分（多候选排序用）——共同核心词数优先，
// 跨语言（无共同词）得分 0 不再被采用。
// Candidate relevance score for multi-candidate ranking (score 0 = rejected).
export function matchCandidateScore(resultName, term, rawName) {
  const rn = String(resultName || '').toLowerCase();
  const tn = String(term || '').toLowerCase();
  const rTokens = coreTokensOf(resultName);
  const rawTokens = coreTokensOf(rawName);
  let score = 0;
  // 与原始标题的共同核心词（CJK 词 ×2 / 英文词 ×3——英文更稀缺更可信）
  for (const w of rawTokens) {
    if (/^[a-z]/.test(w)) {
      if (rTokens.includes(w)) score += 3;
    } else if (rTokens.includes(w)) {
      score += 2;
    }
  }
  // 搜索词包含关系
  if (rn === tn) score += 2;
  else if (tn.length >= 2 && rn.includes(tn)) score += 1;
  // 数字一致性（v6.4.19：数字集合有交集才加分——"生化危机9" vs "Resident
  // Evil 4" 都有数字但不同，不得加分；"赛博朋克2077" vs "Cyberpunk 2077" 加分）
  const nums = (s) => (String(s).match(/\d+/g) || []).map(Number);
  if (nums(rawName).some((x) => nums(resultName).includes(x))) score += 1;
  // v6.4.19：俗称序号例外加分——中文标题含数字（"生化危机9"）、英文候选
  // 无数字（官方名未加序号 "Resident Evil Requiem"）→ 最低 1 分可被采用
  // （storesearch 相关性排序保证候选同源；多个无数字候选按出现顺序取前）
  if (
    /[\u4e00-\u9fff]/.test(rawName) &&
    !/[\u4e00-\u9fff]/.test(resultName) &&
    /\d/.test(rawName) &&
    !/\d/.test(resultName)
  ) {
    score += 1;
  }
  return score;
}

// 名称校验：中文名含中文、英文名含英文、不命中附属内容关键词
// Name validation for zero-review verification and registry writes

// --- 搜索 ---

// 单次搜索实现（网络全挂时抛错供外层重试；无结果返回 null 表示"确实未找到"）
// 结果需通过名称相关性校验（防噪声词/删词变体误匹配无关游戏或续作）。
// One search pass (throws on total network failure for outer retry; null = not
// found). Results must pass the name-relevance check.
async function searchSteamAppIdOnce(searchTerms, rawName, excludeAppId) {
  for (const term of searchTerms) {
    /** @type {{items: Array<{id: number, name: string, type?: string}>}|null} */
    let cnData = null;
    for (let attempt = 0; attempt < 2 && cnData === null; attempt++) {
      try {
        cnData = await (
          await fetchWithTimeout(
            `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=schinese&cc=cn`
          )
        ).json();
        recordSteamCall(true);
      } catch {
        recordSteamCall(false); /* 中文搜索失败不阻断流程 */
      }
    }

    // 网络失败（两次尝试均未返回）：抛错 → 外层重试一次（抗瞬时抖动）
    if (!cnData) throw new Error('Steam 搜索网络失败');

    const cnItems = (cnData && cnData.items) || [];
    if (cnItems.length > 0) {
      // 名称相关性校验：优先非 Demo/附属且与搜索词相关的项；无相关项则尝试下一词
      // v3.3.13：排除曾报错的错误 appid（人工纠正知识库的"黑名单"项）
      // v6.4.16：多候选打分排序——此前取第一个通过者，跨语言/索引噪声
      // 候选会直接中选；现按与完整标题的共同核心词评分，分数 0 不采用
      const related = cnItems
        .filter(
          (i) =>
            String(i.id) !== String(excludeAppId) &&
            !ADDON_NAME_PATTERN.test(i.name || '') &&
            nameMatchesSearch(i.name, term, rawName)
        )
        .map((i) => ({ item: i, score: matchCandidateScore(i.name, term, rawName) }))
        .sort((a, b) => b.score - a.score);
      const best = related[0];
      if (!best || best.score < 1) continue;
      return {
        appId: best.item.id,
        name: best.item.name,
        englishName: best.item.name
      };
    }
  }
  return null;
}

// 并行获取中英文搜索结果（英文名用于注册表记录；网络失败整体重试一次防抖动）。
// 静态候选全部失败时自动进入"扩展组合搜索"（删词变体 + 动态噪声词清洗），
// 成功后把跳过的词作为候选噪声词自动学习（自适应检索，v3.1.2）。
// v3.3.13：excludeAppId 为曾报错的错误 appid（人工纠正知识库黑名单），
// 搜索结果中排除它——避免自动检索再次命中用户已报告的错误游戏。
// Parallel CN/EN searches; one whole-pass retry on network flakiness. When all
// static candidates fail, an extended combination search runs automatically;
// skipped words are then learned. excludeAppId skips a user-reported-wrong app.

// 并行获取中英文搜索结果（英文名用于注册表记录；网络失败整体重试一次防抖动）。
// 静态候选全部失败时自动进入"扩展组合搜索"（删词变体 + 动态噪声词清洗），
// 成功后把跳过的词作为候选噪声词自动学习（自适应检索，v3.1.2）。
// v3.3.13：excludeAppId 为曾报错的错误 appid（人工纠正知识库黑名单），
// 搜索结果中排除它——避免自动检索再次命中用户已报告的错误游戏。
// Parallel CN/EN searches; one whole-pass retry on network flakiness. When all
// static candidates fail, an extended combination search runs automatically;
// skipped words are then learned. excludeAppId skips a user-reported-wrong app.
/**
 * 并行中英文搜索（strict 类型化，v6.3.1）
 * @param {Array<string>} searchTerms
 * @param {string} rawName
 * @param {string|number|null} [excludeAppId]
 * @returns {Promise<import('../core/types.js').SteamSearchResult|null>}
 */
export async function searchSteamAppId(searchTerms, rawName, excludeAppId) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await searchSteamAppIdOnce(searchTerms, rawName, excludeAppId);
      if (result) return result;
      break; // 网络正常但未找到：不重试
    } catch {
      /* 网络失败：重试一次 */
    }
  }

  // 扩展组合搜索：删词变体 + 已生效的动态噪声词清洗
  // Extended search: word-drop variants + active learned-noise cleaning
  if (rawName) {
    const activeNoise = await getActiveNoiseWords();
    const variants = generateSearchVariants(rawName, activeNoise);
    // v6.4.19：俗称序号变体——官方名常无系列序号（"Resident Evil Requiem"），
    // 互联网习惯加（"生化危机9"）——对含数字的变体追加去数字版本
    // （"生化危机9" → "生化危机"），数字冲突校验会保护候选选择。
    const extras = [];
    for (const v of variants) {
      if (/\d/.test(v)) {
        const dv = v.replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim();
        if (dv.length >= 2 && !variants.includes(dv) && !extras.includes(dv)) extras.push(dv);
      }
    }
    variants.push(...extras);
    for (const variant of variants) {
      // v6.4.16：变体搜索走删词校验（结果名须与标题其余核心词相关）
      const result = await searchSteamAppIdLight(variant, rawName, excludeAppId, true);
      if (result) {
        // 成功 → 自动学习被跳过的词（计数确认后才生效，防误学副标题）
        const noiseWords = extractNoiseCandidates(rawName, variant);
        if (noiseWords.length > 0) {
          await recordNoiseCandidates(noiseWords);
          Logger.info(
            'Steam',
            `扩展搜索命中: "${rawName}" → "${variant}" (appId ${result.appId})，候选噪声词: ${noiseWords.join('、')}`
          );
        }
        return result;
      }
    }
  }
  return null;
}

// v4.1.1：版本后缀补搜——标题含"增强版/重制版"等版本词、但封面/直取 appId
// 是旧版时（如 gamer520 40746 封面 271590 是 GTA5 老版，标题"侠盗猎车手V 增强版"
// 应为 3240220），用旧版英文名 + 英文版本后缀补搜新版。
// 触发条件：标题含 CN 后缀；直取详情名不含 CN 后缀；英文名不含 EN 后缀。
// 结果要求：名称含 EN 后缀（防匹配无关新作）且与标题相关（单语言跨语言信任）。
// Version-suffix variant search: when the title says "增强版" but the cover
// appId is the legacy/base edition, search "<EN name> <EN suffix>" (e.g. GTA V
// legacy cover 271590 → "Grand Theft Auto V Enhanced" → 3240220). The result
// must carry the EN suffix and pass the name-relevance check.
const VERSION_SUFFIX_PAIRS = [
  ['增强版', 'Enhanced'],
  ['重制版', 'Remastered'],
  ['复刻版', 'Remake'],
  ['豪华版', 'Deluxe'],
  ['终极版', 'Ultimate'],
  ['年度版', 'Game of the Year'],
  ['典藏版', 'Collector'],
  ['黄金版', 'Gold']
];

export async function findVersionVariant(appId, title) {
  if (!title) return null;
  const pair = VERSION_SUFFIX_PAIRS.find(([cn]) => title.includes(cn));
  if (!pair) return null;
  const [cnSuffix, enSuffix] = pair;
  // 英文名来源：直取 appId 的 english 详情（失败/无名为 null → 跳过补搜）
  const details = await fetchSteamAppDetails(appId, 'english').catch(() => null);
  if (!details || !details.name) return null;
  if (details.name.toLowerCase().includes(enSuffix.toLowerCase())) return null; // 已是该版本
  // 旧版名常带 Legacy/Classic 等后缀（如 GTA5 传承版 "Grand Theft Auto V Legacy"），
  // 拼新版本后缀前先剥离，否则 "Legacy Enhanced" 组合在 Steam 索引无结果
  // Strip legacy suffixes (e.g. "Grand Theft Auto V Legacy") before appending
  // the new-edition suffix — "Legacy Enhanced" never matches the index.
  const baseName = details.name.replace(/\s+(legacy|classic|original( edition)?|standard edition|vanilla)$/i, '');
  const result = await searchSteamAppId([`${baseName} ${enSuffix}`], title);
  if (!result) return null;
  // 结果名必须带版本标识（防"Grand Theft Auto VI"类新作误配）——storesearch
  // 可能返回中文条目名（"Grand Theft Auto V 增强版"），CN/EN 后缀都接受
  const resultName = result.name.toLowerCase();
  const hasSuffix = resultName.includes(enSuffix.toLowerCase()) || result.name.includes(cnSuffix);
  if (!hasSuffix) return null;
  if (!namesRelated(title, result.name)) return null;
  return result;
}

// 轻量单次中文搜索（扩展组合用：低开销，不加重试与英文搜索；结果需通过名称校验）
// Lightweight single CN search (cheap; results pass the name-relevance check)

// 轻量单次中文搜索（扩展组合用：低开销，不加重试与英文搜索；结果需通过名称校验）
// Lightweight single CN search (cheap; results pass the name-relevance check)
async function searchSteamAppIdLight(term, rawName, excludeAppId, variantMode = false) {
  try {
    const data = await (
      await fetchWithTimeout(
        `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=schinese&cc=cn`
      )
    ).json();
    const items = (data && data.items) || [];
    if (items.length === 0) return null;
    // 名称相关性校验：变体词较短，要求结果包含变体词且与原始标题相关；
    // v3.3.13：排除曾报错的错误 appid
    // v6.4.16：多候选打分 + variantMode 时用删词变体校验（防通用词错配）
    const check = variantMode ? nameMatchesSearchVariant : nameMatchesSearch;
    const related = items
      .filter(
        (i) =>
          String(i.id) !== String(excludeAppId) &&
          !ADDON_NAME_PATTERN.test(i.name || '') &&
          check(i.name, term, rawName)
      )
      .map((i) => ({ item: i, score: matchCandidateScore(i.name, term, rawName) }))
      .sort((a, b) => b.score - a.score);
    const best = related[0];
    if (!best || best.score < 1) return null;
    return { appId: best.item.id, name: best.item.name, englishName: best.item.name };
  } catch {
    return null;
  }
}

// 标题与缓存名是否相关（v3.3.10）：提取双方 CJK/英文词集合（去停用词），
// 任一语言共同词非空 → 相关；双方均为单语言且语言不同 → 跨语言信任；
// 混合语言且无共同词 → 不相关。用于 searchSteamGame 缓存命中校验，
// 防止名称索引粘性条目（历史误写钉死的 appId）命中缓存反复返回错误游戏。
// Title-vs-cached-name relevance (v3.3.10): shared CJK/EN tokens make them
// related; single-language pairs of different languages are trusted across
// languages; mixed-language pairs with no shared token are unrelated. Guards
// cache hits against sticky name-index entries that pin the wrong appId.
