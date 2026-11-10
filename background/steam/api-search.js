/**
 * 游戏雷达 Game Radar - Steam API 子模块：api-search.js
 *
 * v5.0.0：由 steam/api.js 按职能拆分。
 * v14.27.0（优化方案 P2-10）：按三段拆出实现——search-candidates.js（候选
 * 生成/相关性/打分）、search-consensus.js（跨词共识裁决）、search-fallback.js
 * （兜底链）；本文件只保留编排（searchSteamAppId）与对外 re-export，
 * 对外 import 路径与导出面不变（原 702 行 → 编排层）。
 * Split for readability (P2-10): orchestration + re-exports stay here; the
 * public import path and export surface are unchanged.
 */
import { recordSteamCall, isCircuitOpen, recordDomainCall } from '../core/api-monitor.js';
import { fetchWithTimeout } from '../core/utils.js';
import { ENDPOINTS } from '../core/constants.js';
import { fetchSteamAppDetails } from './api-details.js';
import { searchSteamAppIdOnce, namesRelated, versionSuffixesOf } from './search-candidates.js';
import { searchExtendedFallback } from './search-fallback.js';

// 纯函数与候选生成（实现迁至 search-candidates.js / search-consensus.js）
export {
  ADDON_NAME_PATTERN,
  DEMO_NAME_PATTERN,
  reloadRetrievalRules,
  namesRelated,
  coreTokensOf,
  digitSetsOverlap,
  seqNumsOf,
  nameMatchesSearch,
  nameMatchesSearchVariant,
  matchCandidateScore,
  rankCandidatesByType,
  cjkBigramDice,
  isCrossoverEntry
} from './search-candidates.js';
export { searchCommunityApps } from './search-fallback.js';

// v5.0.0：偏好标签推荐（由 handlers/stats.js 内嵌裸 fetch 下沉）——按用户
// 偏好关键词在 Steam 商店搜索 + 取价格概览，返回候选游戏列表
// Tag-based Steam store recommendations (sunk from the stats handler).
export async function fetchSteamTagRecommendations(tags, limit = 9) {
  if (isCircuitOpen('store')) return []; // v14.7 批次 13：熔断短路（与其他 store 路径对齐）
  const recGames = [];
  for (const tag of tags.slice(0, 3)) {
    const searchUrl = `${ENDPOINTS.steamSearch}?term=${encodeURIComponent(tag)}&l=schinese&cc=cn`;
    const resp = await fetchWithTimeout(searchUrl);
    recordSteamCall(resp.ok); // v14.7 批次 13：补 store 域统计（此前此路径指标全盲）
    recordDomainCall('store', resp.ok);
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
            const detUrl = `${ENDPOINTS.steamAppDetails}?appids=${item.id}&l=schinese&filters=basic,price_overview`;
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
          image: detail?.header_image || ENDPOINTS.steamCdnHeader(item.id),
          price: detail?.price_overview ? detail.price_overview.final_formatted : '免费',
          reviewSummary: '',
          url: `${ENDPOINTS.steamStoreApp}${item.id}/`,
          matchTags: [tag]
        });
      }
    }
    if (recGames.length >= limit) break;
  }
  return recGames.slice(0, limit);
}

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
export async function searchSteamAppId(searchTerms, rawName, excludeAppId, lang = 'schinese') {
  // v11.0 B1：熔断打开 → 短路返回 null（不发请求逐个超时；orchestrator 的
  // failed>0 门会跳过负缓存固化，恢复后自动重搜）
  if (isCircuitOpen('store')) return null; // v12 B1：per-domain 熔断
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await searchSteamAppIdOnce(searchTerms, rawName, excludeAppId, lang);
      if (result) return result;
      break; // 网络正常但未找到：不重试
    } catch {
      /* 网络失败：重试一次 */
    }
  }
  // 兜底链（去数字重试 + 删词变体扩展 + 噪声词学习）迁至 search-fallback.js
  return searchExtendedFallback(searchTerms, rawName, excludeAppId, lang);
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
// v14.7 批次 12：VERSION_SUFFIX_PAIRS 改用时取用（versionSuffixesOf）。

export async function findVersionVariant(appId, title) {
  if (!title) return null;
  const pair = versionSuffixesOf().find(([cn]) => title.includes(cn));
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
