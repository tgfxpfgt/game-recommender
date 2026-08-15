import { Logger } from '../storage/logger.js';
import {
  baseAppIdFromDetails,
  fetchSteamAppDetails,
  fetchStorePageHtml,
  parseChineseLanguageSupport,
  parseUserTags
} from './api-details.js';
import { fetchLastUpdate, fetchSteamReviews } from './api-reviews.js';
import { DEMO_NAME_PATTERN } from './api-search.js';
import { fetchSteamSpyInfo } from './api-supplement.js';
import { getSettings } from '../core/settings.js'; // v6.4.19：模块开关（MV3 SW 不支持动态 import，必须静态）

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
    url: `https://store.steampowered.com/app/${appId}/`,
    // v6.2.1：SteamDB 链接模板拼接（此前每次详情抓取 SteamDB 网页仅产出该
    // URL——官方 API 优先，移除冗余网页抓取）
    steamdbUrl: `https://steamdb.info/app/${appId}/`,
    rating: reviewSummary ? reviewSummary.score : null,
    ratingDesc: reviewSummary ? reviewSummary.desc : null,
    totalReviews: reviewSummary ? reviewSummary.total : 0,
    positiveRate:
      reviewSummary && reviewSummary.total > 0
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
      Logger.warn(
        'Steam',
        `appId ${appId} 为 ${reason}，自动解析为本体 ${baseId}（${(gameData.fullgame && gameData.fullgame.name) || ''}）`
      );
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

  // v6.4.19：Steam API 模块开关——关闭的模块不调用其接口（好评率/详情解析/
  // SteamSpy），对应字段置空；基础信息（meta）为必需项不参与开关。
  // Per-module API toggles: disabled modules are not fetched (fields left empty).
  const settings = await getSettings();
  const mods = settings.steamApiModules || {};

  const storeHtml = mods.detail === false ? null : await fetchStorePageHtml(appId);
  const [langInfo, userTags, reviews] = await Promise.all([
    mods.detail === false
      ? Promise.resolve({ chineseSupported: false, simplifiedChinese: false, chineseHasAudio: false, chineseHasSubtitles: false })
      : Promise.resolve(parseChineseLanguageSupport(storeHtml, gameData)),
    mods.detail === false ? Promise.resolve([]) : Promise.resolve(parseUserTags(storeHtml, gameData)),
    mods.rating === false ? Promise.resolve(null) : fetchSteamReviews(appId)
  ]);
  // v3.3.6：SteamSpy 总是请求（详情页以 SteamSpy 为主数据）；最近更新日期
  // 用最新公告日期近似。v6.2.1：SteamDB 网页抓取移除（链接模板拼接即可）
  // v6.4.19：spy 开关关闭时跳过 SteamSpy；lastUpdate 属详情解析一并受控
  const [steamspyInfo, lastUpdate] = await Promise.all([
    mods.spy === false ? Promise.resolve(null) : fetchSteamSpyInfo(appId).catch(() => null),
    mods.detail === false ? Promise.resolve(null) : fetchLastUpdate(appId).catch(() => null)
  ]);

  return buildSteamResult(
    appId,
    gameData,
    langInfo,
    userTags,
    reviews,
    steamspyInfo,
    enGameData,
    lastUpdate
  );
}

// 通过注册表判断 appId 是否为 Demo/试玩版（缓存缺失时的自愈依据）
// Determine from the registry whether an appId is a Demo/trial edition
