/**
 * 游戏雷达 Game Radar - Steam 搜索兜底链 / Search fallbacks
 *
 * v14.27.0（优化方案 P2-10）：自 steam/api-search.js 拆出——主搜索（全词扫描）
 * 未命中后的兜底链：主词去数字重试、删词变体扩展搜索（含噪声词学习）、
 * steamcommunity 社区搜索端点。轻量单次搜索 searchSteamAppIdLight 也在此
 * （兜底链专用）。
 * Fallback chain split out of api-search.js: de-digit retry, variant search
 * (with noise learning), community-search endpoint, plus the light search.
 */
import { recordSteamCall, isCircuitOpen, recordDomainCall } from '../core/api-monitor.js';
import { generateSearchVariants, extractNoiseCandidates } from '../core/title-parser.js';
import { fetchWithTimeout } from '../core/utils.js';
import { ENDPOINTS, PERF_CONFIG } from '../core/constants.js'; // v14.6.2：超时单源
import { getActiveNoiseWords, recordNoiseCandidates } from '../storage/learned-noise.js';
import { Logger } from '../storage/logger.js';
import {
  ADDON_NAME_PATTERN,
  nameMatchesSearch,
  nameMatchesSearchVariant,
  matchCandidateScore
} from './search-candidates.js';

/**
 * 兜底链：主词去数字 → 删词变体（含动态噪声词清洗）→ null。
 * Fallback chain after the main all-term scan misses: de-digit retry for the
 * primary terms, then word-drop variants with learned-noise cleaning.
 * @param {Array<string>} searchTerms
 * @param {string} rawName
 * @param {string|number|null} [excludeAppId]
 * @param {string} [lang]
 * @returns {Promise<import('../core/types.js').SteamSearchResult|null>}
 */
export async function searchExtendedFallback(searchTerms, rawName, excludeAppId, lang = 'schinese') {
  // v14.6.2（错题库 gamer520-123938）：主词去数字变体——parseGameTitle 主词
  // 带系列序号（"生化危机4"）而 schinese 索引返回空时，去数字重试（"生化
  // 危机"）——原去数字逻辑只作用于 rawName 长标题变体，主词自身从不重试。
  // 结果经 nameMatchesSearch 校验：数字对齐放行（"Resident Evil 4" 同序号
  // 正主）已由 seqNumsOf 护栏保证（"生化危机9" 不会错配 RE4/RE2）。
  // v14.6.2 (mismatch-sample gamer520-123938): de-digit retry for the
  // PRIMARY terms themselves — schinese index returns empty for numbered
  // titles; results pass the aligned-number guarded relevance check.
  /** @type {Array<[string, string]>} [去数字词, 原主词] */
  const deDigitTerms = [];
  for (const t of searchTerms) {
    const d = String(t).replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim();
    if (d.length >= 2 && d !== t && !deDigitTerms.some(([dd]) => dd === d)) {
      deDigitTerms.push([d, t]);
    }
  }
  for (const [d, srcTerm] of deDigitTerms) {
    const result = await searchSteamAppIdLight(d, rawName, excludeAppId, false, lang);
    if (result) {
      Logger.info('Steam', `主词去数字命中: "${srcTerm}" → "${d}" (appId ${result.appId})`);
      return result;
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
      const result = await searchSteamAppIdLight(variant, rawName, excludeAppId, true, lang);
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

// v14.6：社区搜索端点兜底（steamcommunity.com/actions/SearchApps/<term>）——
// 免 key、极快（调研 docs/标题检索AppID-准确率与效率调研-2026-10.md 建议 3）。
// **仅英文**（实测中文返回空数组），故只接入英文重搜阶段；结果经与
// storesearch 同一的相关性校验（nameMatchesSearch）后返回单条最佳。
// Community search fallback (research recommendation 3): keyless and fast,
// English-only (verified — Chinese queries return an empty array). Results
// pass the same relevance check as storesearch before being returned.
/**
 * @param {string} term
 * @param {string} rawName
 * @param {string|number|null} [excludeAppId]
 * @returns {Promise<import('../core/types.js').SteamSearchResult|null>}
 */
export async function searchCommunityApps(term, rawName, excludeAppId) {
  if (!term) return null;
  // v14.6.2 修复：独立熔断域——steamcommunity.com 与 store.steampowered.com 是
  // 不同主机，此处失败曾误计入 store 域熔断与 Steam 全局失败统计（recordSteamCall），
  // 导致：store 域 5 次失败熔断误开（storesearch 全短路 → 大量"未找到"）+
  // Steam anomaly 误触发（批量降速 2 个/批 + 5s 间隔 → 批次跑不完 → "等待检索"
  // 徽章残留）。兜底端点自身失败只影响自己（独立域开路时本函数短路）。
  if (isCircuitOpen('steamcommunity')) return null;
  try {
    const resp = await fetchWithTimeout(
      ENDPOINTS.steamCommunitySearch + encodeURIComponent(String(term).trim()),
      {},
      PERF_CONFIG.fetchTimeoutCommunitySearchMs
    );
    // 404/空结果非失败（SearchApps 未命中返回 []）
    recordDomainCall('steamcommunity', resp.ok || resp.status === 404);
    if (!resp.ok) return null;
    const list = await resp.json();
    if (!Array.isArray(list)) return null;
    for (const item of list) {
      if (!item || item.appid == null || typeof item.name !== 'string' || !item.name) continue;
      if (excludeAppId != null && String(item.appid) === String(excludeAppId)) continue;
      if (ADDON_NAME_PATTERN.test(item.name)) continue;
      if (!nameMatchesSearch(item.name, term, rawName)) continue;
      return { appId: String(item.appid), name: item.name, englishName: item.name };
    }
    return null;
  } catch {
    recordDomainCall('steamcommunity', false);
    return null;
  }
}

// 轻量单次中文搜索（扩展组合用：低开销，不加重试与英文搜索；结果需通过名称校验）
// Lightweight single CN search (cheap; results pass the name-relevance check)
async function searchSteamAppIdLight(term, rawName, excludeAppId, variantMode = false, lang = 'schinese') {
  // v14.7 批次 1（A-P2-2）：与主搜索同样短路——主搜索途中熔断打开后，去数字
  // +变体循环仍会串行发 ~10 个请求（慢网各挂 15s）拖死批次。
  // Circuit short-circuit like the main search (variant loop must not keep
  // firing into an open circuit).
  if (isCircuitOpen('store')) return null;
  try {
    const resp = await fetchWithTimeout(`${ENDPOINTS.steamSearch}?term=${encodeURIComponent(term)}&l=${lang}&cc=cn`);
    // v14.10.1：404=空结果非失败（终态空——不进入 catch 的失败记录路径）
    if (resp.status === 404) return null;
    const data = await resp.json();
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
    recordSteamCall(false, 0); // v14.0.0：网络失败计入限流统计（此前完全不可见）
    recordDomainCall('store', false); // v14.0.0：计入 store 域熔断
    return null;
  }
}
