/**
 * Game Recommender - Steam API 编排器 / Steam API Orchestrator
 *
 * 详情页查询（searchSteamGame）与列表页轻量好评率查询（getSteamPositiveRate）：
 * 缓存优先 → Demo 自愈重搜 → 0 评测验证 → 三层缓存写入。
 * Detail-page search and list-page lightweight rating lookup: cache-first,
 * Demo self-heal, zero-review verification, 3-layer cache writes.
 */
import {
  searchSteamAppId, fetchSteamFullDetailsByAppId, fetchSteamAppDetails,
  fetchReviewSummary, validateSteamNames, DEMO_NAME_PATTERN, ensureRegistryEntry,
  ensureValidRegistryNames, coverImageFor, isDemoAppId, baseAppIdFromDetails
} from './api.js';
import { isSteamCacheValid, getSteamCacheEntry, setSteamCacheEntry } from '../storage/steam-cache.js';
import { recordGameInRegistry } from '../storage/registry.js';
import { lookupAppIdByName, recordNameIndex, isRecentlySearchedNotFound } from '../storage/name-index.js';
import { parseGameTitle, pickRegistryEnName } from './title-parser.js';
import { Logger } from '../storage/logger.js';

// 判断缓存条目是否为"Demo 版且无评测"——需清除并重新搜索完整版（自愈）
// Whether a cached entry is a "Demo edition without reviews" (needs re-search)
function isDemoCacheWithoutRating(cachedData) {
  if (!cachedData) return false;
  if (cachedData.positiveRate !== null && cachedData.positiveRate !== undefined) return false;
  return DEMO_NAME_PATTERN.test(cachedData.name || '');
}

/**
 * 搜索游戏并获取完整 Steam 详情（详情页/浮窗使用）
 * 流程：名称索引 → 动态缓存（含 Demo 自愈）→ 搜索 → 完整详情 → 三层缓存。
 * Search a game and fetch full Steam details (detail pages/panels).
 */
export async function searchSteamGame(gameName) {
  // 1. 通过名称索引查找 appId / Lookup appId via name index
  let appId = await lookupAppIdByName(gameName);

  // 2. 若有 appId，检查 Steam 动态缓存（appId+name 即可命中；列表页部分缓存可复用）
  if (appId) {
    const cached = await getSteamCacheEntry(appId);
    if (isSteamCacheValid(cached) && cached.data && cached.data.appId && cached.data.name) {
      // 自愈：Demo 版缓存无好评率 → 忽略缓存，重新搜索完整版
      if (isDemoCacheWithoutRating(cached.data)) {
        appId = null;
      } else {
        // 缓存命中：幂等补写注册表（含封面），防止缓存管理页缺失条目/封面；
        // 中英文名异常（占位/缺失）时自动按 appId 重新获取（自愈）
        await ensureRegistryEntry(cached.data.appId || appId, cached.data.name, cached.data.englishName, gameName, cached.data.headerImage || '');
        await ensureValidRegistryNames(cached.data.appId || appId, cached.data.name, cached.data.englishName, gameName);
        return cached.data;
      }
    } else if (await isDemoAppId(appId)) {
      // 缓存缺失/过期且该 appId 是 Demo 版 → 重新搜索完整版
      appId = null;
    }
  } else if (await isRecentlySearchedNotFound(gameName)) {
    // 3. 无 appId 时，检查负缓存 / No appId: check the negative cache
    return null;
  }

  try {
    // 4. 搜索 appId（若已有 appId 但缓存过期，跳过搜索直接获取详情）
    if (!appId) {
      const searchResult = await searchSteamAppId(parseGameTitle(gameName), gameName);
      if (!searchResult) {
        // 记录负缓存 / Record negative cache
        await recordNameIndex(gameName, null);
        return null;
      }
      appId = searchResult.appId;
    }

    // 5. 获取完整 Steam 详情 / Fetch full Steam details
    const result = await fetchSteamFullDetailsByAppId(appId);
    if (!result) return null;

    // 6. 写入三层缓存：Steam 动态缓存(24h) + 游戏注册表(永久) + 名称索引
    //    注册表以 Steam 官方中英文名为准，下载站标题入 names 变体，封面一并缓存
    await setSteamCacheEntry(appId, result);
    await recordGameInRegistry(appId, {
      cnName: result.name,
      enName: result.englishName || result.name,
      gameName,
      tags: result.genres,
      coverImage: result.headerImage || ''
    });
    await recordNameIndex(gameName, appId);

    return result;
  } catch (error) {
    console.error('Steam API 调用失败:', error);
    return null;
  }
}

/**
 * 仅缓存命中查询（列表页第一波，无网络请求）。
 * 缓存命中（含 Demo 自愈跳过）即返回，否则返回 null → 调用方转入 Steam 拉取。
 * Cache-only lookup (first wave on list pages, zero network). Returns the
 * cached rating when valid (demo-without-rating self-heals to a miss).
 */
export async function getSteamRatingsFromCacheOnly(gameName, options = {}) {
  if (!gameName) return null;
  let appId = options.appId ? String(options.appId) : null;
  if (!appId) {
    appId = await lookupAppIdByName(gameName);
  }
  if (!appId) return null;

  const cached = await getSteamCacheEntry(appId);
  if (!isSteamCacheValid(cached) || !cached.data || cached.data.positiveRate === undefined) return null;
  if (isDemoCacheWithoutRating(cached.data)) return null;

  // 与完整路径一致：幂等补写注册表（含封面）+ 中英文名异常自愈（缓存命中时同步）
  await ensureRegistryEntry(cached.data.appId || appId, cached.data.name, cached.data.englishName, gameName, cached.data.headerImage || '');
  await ensureValidRegistryNames(cached.data.appId || appId, cached.data.name, cached.data.englishName, gameName);
  return {
    positiveRate: cached.data.positiveRate,
    ratingDesc: cached.data.ratingDesc || null,
    appId: cached.data.appId || appId,
    name: cached.data.name || gameName
  };
}

/**
 * 轻量级 Steam 好评率查询（列表页用，缓存优先，仅获取好评率）
 * options.ignoreNegativeCache：列表页批量场景跳过负缓存（用户主动浏览值得重试）。
 * Lightweight rating lookup for list pages (cache-first).
 */
export async function getSteamPositiveRate(gameName, options = {}) {
  if (!gameName) return null;

  // 0. appId 优先（列表页封面图提取），否则名称索引
  let appId = options.appId ? String(options.appId) : null;
  if (!appId) {
    appId = await lookupAppIdByName(gameName);
  }

  // 2. 若有 appId，检查 Steam 动态缓存（含 Demo 自愈）
  let usableAppId = appId;
  if (appId) {
    const cached = await getSteamCacheEntry(appId);
    if (isSteamCacheValid(cached) && cached.data && cached.data.positiveRate !== undefined) {
      // 自愈：命中 Demo 版且无评测的缓存 → 视为无效，重新搜索完整版
      if (!isDemoCacheWithoutRating(cached.data)) {
        // 缓存命中：幂等补写注册表（含封面）；中英文名异常时自愈
        await ensureRegistryEntry(cached.data.appId || appId, cached.data.name, cached.data.englishName, gameName, cached.data.headerImage || '');
        await ensureValidRegistryNames(cached.data.appId || appId, cached.data.name, cached.data.englishName, gameName);
        return {
          positiveRate: cached.data.positiveRate,
          ratingDesc: cached.data.ratingDesc || null,
          appId: cached.data.appId || appId,
          name: cached.data.name || gameName
        };
      }
      usableAppId = null;
    } else if (await isDemoAppId(appId)) {
      // 缓存缺失/过期且该 appId 是 Demo 版 → 重新搜索完整版
      usableAppId = null;
    }
  } else if (!options.ignoreNegativeCache) {
    // 3. 无 appId 时，检查负缓存（列表页批量场景可忽略）
    if (await isRecentlySearchedNotFound(gameName)) {
      Logger.debug('Steam', `负缓存命中，跳过: ${gameName}`);
      return null;
    }
  }

  try {
    // 4. 搜索 appId（若已有 appId 但缓存过期，跳过搜索直接获取评价）
    let foundAppId = usableAppId;
    let foundName = gameName;
    let searchResult = null;
    if (!foundAppId) {
      searchResult = await searchSteamAppId(parseGameTitle(gameName), gameName);
      if (!searchResult) {
        // 记录负缓存 / Record negative cache
        Logger.warn('Steam', `列表页搜索未找到: ${gameName}`);
        await recordNameIndex(gameName, null);
        return null;
      }
      foundAppId = searchResult.appId;
      foundName = searchResult.name;
    }

    // 4.5 appId 校验（v3.2.6）：DLC 等非游戏本体 → 自动解析为所属本体（fullgame）；
    // bundle/未知类型且无法解析 → 视为未找到。网络失败时保持原值继续（防误杀）。
    if (foundAppId) {
      const baseCheck = await fetchSteamAppDetails(foundAppId, 'schinese').catch(() => null);
      if (baseCheck) {
        const baseId = baseAppIdFromDetails(baseCheck);
        if (baseId && baseId !== String(foundAppId)) {
          Logger.warn('Steam', `appId ${foundAppId} 为 DLC/非本体，自动解析为本体 ${baseId}（${(baseCheck.fullgame && baseCheck.fullgame.name) || ''}）`);
          foundAppId = baseId;
          foundName = (baseCheck.fullgame && baseCheck.fullgame.name) || foundName;
        } else if (!baseId) {
          Logger.warn('Steam', `appId ${foundAppId} 类型 ${baseCheck.type} 非游戏本体且无法解析，视为未找到`);
          return null;
        }
      }
    }

    // 5. 获取评价统计（好评率）
    const reviewSummary = await fetchReviewSummary(foundAppId);
    let positiveRate = null;
    let ratingDesc = null;
    if (reviewSummary) {
      ratingDesc = reviewSummary.desc || null;
      if (reviewSummary.total > 0) {
        positiveRate = Math.round(reviewSummary.positive / reviewSummary.total * 100);
      }
    }

    // 5.5 官方中英文名：搜索路径用搜索结果英文名；0 评测时轻量获取官方名
    //     并验证 Demo/附属内容（校验失败 → 重搜本体）
    let officialCn = foundName;
    let officialEn = searchResult ? (searchResult.englishName || foundName) : pickRegistryEnName(gameName, foundName);
    if (positiveRate === null) {
      const [cnData, enData] = await Promise.all([
        fetchSteamAppDetails(foundAppId, 'schinese').catch(() => null),
        fetchSteamAppDetails(foundAppId, 'english').catch(() => null)
      ]);
      officialCn = (cnData && cnData.name) || officialCn;
      officialEn = (enData && enData.name) || officialCn;
      // 名称校验：Demo/试玩或附属内容 → 视为无效匹配，重搜本体
      const nameCheck = validateSteamNames(officialCn, officialEn);
      if (!nameCheck.valid || DEMO_NAME_PATTERN.test(officialCn + ' ' + officialEn)) {
        Logger.warn('Steam', `0评测匹配无效(${nameCheck.issues.join('/')}): ${foundAppId} ${officialCn}，重搜`);
        const reSearch = await searchSteamAppId(parseGameTitle(gameName), gameName);
        if (reSearch) {
          foundAppId = reSearch.appId;
          foundName = reSearch.name;
          officialCn = reSearch.name;
          officialEn = reSearch.englishName || officialCn;
          const rs2 = await fetchReviewSummary(foundAppId);
          if (rs2) {
            ratingDesc = rs2.desc || null;
            if (rs2.total > 0) positiveRate = Math.round(rs2.positive / rs2.total * 100);
          }
        }
      }
    }

    // 6. 合并写入 Steam 动态缓存（自愈场景不留存旧 Demo 数据；含封面供补写）
    const existing = usableAppId ? ((await getSteamCacheEntry(usableAppId)) || {}).data || {} : {};
    const headerImage = coverImageFor(foundAppId, options.cover);
    const mergedData = { ...existing, appId: foundAppId, name: foundName, englishName: officialEn, positiveRate, ratingDesc, headerImage };
    await setSteamCacheEntry(foundAppId, mergedData);

    // 7. 同步更新游戏注册表和名称索引：官方中英文名 + 封面图 + 标题变体
    await recordGameInRegistry(foundAppId, {
      cnName: officialCn,
      enName: officialEn,
      gameName,
      coverImage: headerImage
    });
    await recordNameIndex(gameName, foundAppId);

    return { positiveRate, ratingDesc, appId: foundAppId, name: foundName };
  } catch (e) {
    Logger.warn('Steam', `获取好评率异常: ${gameName}`, e.message);
    console.log('获取Steam好评率失败:', e.message);
    return null;
  }
}
