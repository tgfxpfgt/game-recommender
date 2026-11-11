import { Logger } from '../storage/logger.js';
import { ENDPOINTS } from '../core/constants.js'; // v14.12 B3：store URL 单源
import {
  baseAppIdFromDetails,
  fetchSteamAppDetails,
  fetchStorePageHtml,
  parseChineseLanguageSupport,
  parseUserTags
} from './api-details.js';
import { fetchLastUpdate, fetchSteamReviews, needsRatingRefetch, hasInvertedReviewCounts } from './api-reviews.js';
import { DEMO_NAME_PATTERN } from './api-search.js';
import { fetchSteamSpyInfo } from './api-supplement.js';
import { getSettings } from '../core/settings.js'; // v6.4.19：模块开关（MV3 SW 不支持动态 import，必须静态）
import { isModuleValid, getMergedData, isDetailCacheComplete, pickFieldsForModules } from '../storage/steam-cache.js'; // v14.28.8：缓存完整性单源 + 部分刷新字段挑选

/**
 * 游戏雷达 Game Radar - Steam API 子模块：api-assemble.js
 *
 * v5.0.0：由 steam/api.js 按职能拆分。
 */

// --- 组装最终结果对象 ---

export function buildSteamResult(
  appId,
  gameData,
  langInfo,
  userTags,
  reviews,
  steamspyInfo,
  enGameData,
  /** @type {string|null} */ lastUpdate = null
) {
  // v6.4.19：reviews 可能为 null（rating 模块关闭时）——容忍缺失
  const { reviewSummary, cnReviewSummary, chineseReviews } = reviews || {};
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
    // 优先用 appdetails 的 type 权威信号；名称判定带词边界（\b），
    // 避免 Trials/Demons 等合法游戏名被误判（v3.4.2）。
    isDemo:
      gameData.type === 'demo' ||
      (enGameData && enGameData.type === 'demo') ||
      DEMO_NAME_PATTERN.test((enGameData && enGameData.name) + ' ' + gameData.name),
    url: `${ENDPOINTS.steamStoreApp}${appId}/`,
    // v6.2.1：SteamDB 链接模板拼接（此前每次详情抓取 SteamDB 网页仅产出该
    // URL——官方 API 优先，移除冗余网页抓取）
    steamdbUrl: `https://steamdb.info/app/${appId}/`,
    rating: reviewSummary ? reviewSummary.score : null,
    ratingDesc: reviewSummary ? reviewSummary.desc : null,
    totalReviews: reviewSummary ? reviewSummary.total : 0,
    // v10.5.3：好评/差评原始条数——内嵌信息区（XDGame 同款）「好评/差评/
    // 修正口碑」行与修正口碑精确计算需要；旧缓存缺失时模板按整数好评率回退
    positiveReviews: reviewSummary ? reviewSummary.positive : null,
    negativeReviews: reviewSummary ? reviewSummary.negative : null,
    positiveRate:
      reviewSummary && reviewSummary.total > 0 && reviewSummary.positive != null
        ? Math.round((reviewSummary.positive / reviewSummary.total) * 100)
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
    // v14.24.0（用户报告：浮窗依旧没有具体评论）：评论正文回填自愈标记——
    // 旧缓存条目（v14.21.2 前）reviews 恒空且被缓存命中路径永久顶住（完整性
    // 判定不含评论字段）。本标记 = "评论抓取已尝试过"：缺失（旧缓存）→ 缓存
    // 不命中转完整拉取（评论回填一次）；存在且 reviews 仍空 = 该游戏确实没有
    // 可得的简体中文评论（社区页无产出/未配置代理），不循环重取。
    // v14.24.0: review-backfill marker — pre-v14.21.2 caches carry empty
    // reviews forever (completeness check has no review field). Missing marker
    // ⇒ cache miss → one full refetch backfills comments; marker present with
    // empty reviews ⇒ genuinely unavailable, no retry loop.
    cnReviewsFetchedAt: reviews ? Date.now() : 0,
    genres: (gameData.genres || []).map((g) => g.description),
    userTags,
    chineseSupported,
    simplifiedChinese,
    chineseHasAudio,
    chineseHasSubtitles,
    releaseDate: gameData.release_date?.date || '',
    developers: gameData.developers || [],
    description: gameData.short_description || '',
    headerImage: gameData.header_image || '',
    // v14.16.0 N2：平台兼容信号（appdetails basic 同响应内零额外请求）——
    // mac/linux 用户此前零信号；windows 恒真不展示（噪声控制）
    platforms: {
      mac: !!(gameData.platforms && gameData.platforms.mac),
      linux: !!(gameData.platforms && gameData.platforms.linux)
    },
    steamspy: steamspyInfo
  };
}

// 通过 appId 获取完整的 Steam 详情（组装：详情/语言/标签/评测/SteamDB/SteamSpy）
// 先校验 appId：DLC 等非游戏本体自动解析为所属本体（fullgame）。
// Fetch full Steam details by appId (details/language/tags/reviews/SteamDB/
// SteamSpy). The appId is validated first: a DLC resolves to its base game.

// 通过 appId 获取完整的 Steam 详情（组装：详情/语言/标签/评测/SteamDB/SteamSpy）
// 先校验 appId：DLC 等非游戏本体自动解析为所属本体（fullgame）。
// Fetch full Steam details by appId (details/language/tags/reviews/SteamDB/
// SteamSpy). The appId is validated first: a DLC resolves to its base game.
/**
 * @param {string|number} appId
 * @param {{ refreshModules?: string[] }} [options] - refreshModules = 部分刷新计划（缺省全量）
 * @returns {Promise<Record<string, any>|null>} 全量结果，或部分刷新时只含计划内模块字段的子集
 */
export async function fetchSteamFullDetailsByAppId(appId, options = {}) {
  // plan=null → 全量（旧行为）；plan=Set → 只拉所列模块
  /** @type {Set<string>|null} */
  let plan = Array.isArray(options.refreshModules) ? new Set(options.refreshModules) : null;
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
      Logger.warn(
        'Steam',
        `appId ${appId} 为 ${reason}，自动解析为本体 ${baseId}（${(gameData.fullgame && gameData.fullgame.name) || ''}）`
      );
      appId = baseId;
      // plan 描述的是原 appId 的残缺模块 → 换到本体重取时按全量拉取
      plan = null;
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

  // v6.4.19：Steam API 模块开关——关闭的模块不调用其接口（好评率/详情解析/
  // SteamSpy），对应字段置空；基础信息（meta）为必需项不参与开关。
  // v14.28.8：部分刷新计划（refreshModules）进一步收窄出站面——未列入的模块
  // 一个请求都不发（残缺缓存只补缺失模块）。
  // Per-module API toggles: disabled modules are not fetched (fields left empty).
  // A refresh plan narrows the outbound surface to the modules being refreshed.
  const settings = await getSettings();
  const mods = settings.steamApiModules || {};
  const need = (m) => !plan || plan.has(m);
  const needDetail = need('detail');
  const needRating = need('rating');

  const storeHtml = needDetail && mods.detail !== false ? await fetchStorePageHtml(appId) : null;
  const [langInfo, userTags, reviews] = await Promise.all([
    needDetail && mods.detail !== false
      ? Promise.resolve(parseChineseLanguageSupport(storeHtml, gameData))
      : Promise.resolve({
          chineseSupported: false,
          simplifiedChinese: false,
          chineseHasAudio: false,
          chineseHasSubtitles: false
        }),
    needDetail && mods.detail !== false ? Promise.resolve(parseUserTags(storeHtml, gameData)) : Promise.resolve([]),
    // 评论：rating 需要好评率；detail 需要评论正文 + cnReviewsFetchedAt 回填标记。
    // 二者任一在计划内都要取——否则"刷新 detail 却把标记写 0"会造成下次死循环。
    // Reviews serve rating (positive rate) and detail (text + backfill marker).
    (needRating || needDetail) && mods.rating !== false ? fetchSteamReviews(appId) : Promise.resolve(null)
  ]);
  // v3.3.6：SteamSpy 总是请求（详情页以 SteamSpy 为主数据）；最近更新日期
  // 用最新公告日期近似。v6.2.1：SteamDB 网页抓取移除（链接模板拼接即可）
  // v6.4.19：spy 开关关闭时跳过 SteamSpy；lastUpdate 属详情解析一并受控
  const [steamspyInfo, lastUpdate] = await Promise.all([
    need('spy') && mods.spy !== false ? fetchSteamSpyInfo(appId).catch(() => null) : Promise.resolve(null),
    needDetail && mods.detail !== false ? fetchLastUpdate(appId).catch(() => null) : Promise.resolve(null)
  ]);

  const full = buildSteamResult(appId, gameData, langInfo, userTags, reviews, steamspyInfo, enGameData, lastUpdate);
  // 部分刷新：只返回计划内模块的字段（写缓存时未涉及模块的字段与 ts 不动）
  return plan ? pickFieldsForModules(full, [...plan]) : full;
}

// 详情缓存未命中时的模块级刷新计划：只补缺失/过期模块，有效模块不重拉。
// meta 恒含（appId 校验 / DLC 解析 / 中英文名必需）；rating 在模块无效、需重取
// 好评率或评价数倒挂时补；detail 在模块无效、完整性判定失败或缺评论回填标记时补；
// spy 在模块无效时补。返回 undefined 表示无缓存条目（调用方按全量拉取处理）。
// Module-level refresh plan for a detail cache miss: only missing/expired
// modules are refetched. undefined = no cache entry (caller fetches fully).
/**
 * @param {import('../core/types.js').SteamCacheEntry|null|undefined} entry
 * @param {Record<string, any>|null} [merged]
 * @returns {string[]|undefined}
 */
export function planDetailRefresh(entry, merged) {
  if (!entry || !entry.modules) return undefined;
  const view = merged || getMergedData(entry) || {};
  const plan = ['meta']; // appId 校验 / DLC 解析 / 中英文名必需
  if (!isModuleValid(entry, 'rating') || needsRatingRefetch(view) || hasInvertedReviewCounts(view)) {
    plan.push('rating');
  }
  if (!isModuleValid(entry, 'detail') || !isDetailCacheComplete(entry) || !view.cnReviewsFetchedAt) {
    plan.push('detail');
  }
  if (!isModuleValid(entry, 'spy')) plan.push('spy');
  return plan;
}

// 通过注册表判断 appId 是否为 Demo/试玩版（缓存缺失时的自愈依据）
// Determine from the registry whether an appId is a Demo/trial edition
