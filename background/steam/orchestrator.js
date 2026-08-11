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
  fetchReviewSummary, fetchLastUpdate, validateSteamNames, DEMO_NAME_PATTERN,
  ADDON_NAME_PATTERN, ensureRegistryEntry, ensureValidRegistryNames, coverImageFor,
  isDemoAppId, baseAppIdFromDetails, needsRatingRefetch,
  isCompleteCacheData, namesRelated
} from './api.js';
import { isModuleValid, getModuleData, getMergedData, getSteamCacheEntry, setSteamCacheEntry } from '../storage/steam-cache.js';
import { recordGameInRegistry } from '../storage/registry.js';
import { lookupAppIdByName, recordNameIndex, isRecentlySearchedNotFound, deleteNameIndexEntry } from '../storage/name-index.js';
import { lookupWrongReportCorrection } from '../storage/wrong-reports.js';
import { parseGameTitle, pickRegistryEnName } from '../core/title-parser.js';
import { Logger } from '../storage/logger.js';
import { detailSteamCacheTtlMs } from '../core/constants.js';

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

  // 1.5 人工纠正知识库优先（v3.3.13）：该标题曾报错并手动确认了正确 appid——
  // 用户确认 > 自动匹配；同时清除该名负缓存（纠正名不应被负缓存拦截）
  const correction = await lookupWrongReportCorrection(gameName);
  let excludeAppId = null;
  if (correction) {
    appId = correction.correctAppId;
    excludeAppId = correction.wrongAppId;
    await deleteNameIndexEntry(gameName);
  }

  // 2. 若有 appId，检查 Steam 动态缓存（v3.3.7 模块化：detail 模块有效且
  //    数据完整才命中——列表页仅 rating 模块的条目不满足，转完整拉取，
  //    拉取只更新 detail/spy 模块，meta/rating 保留）。
  //    v3.3.10：命中前校验标题与缓存名相关——名称索引粘性条目（历史误写
  //    钉死 appId）在此被推翻，转重新搜索自愈（如 16598 页误钉 2001760）
  if (appId) {
    const cached = await getSteamCacheEntry(appId);
    const detail = isModuleValid(cached, 'detail', detailSteamCacheTtlMs()) ? getModuleData(cached, 'detail') : null;
    const merged = getMergedData(cached) || {};
    // 无好评率条目（0 评测/失败固化）按冷却期重新获取
    if (detail && merged.appId && merged.name && isCompleteCacheData(detail) && !needsRatingRefetch(merged) &&
        namesRelated(gameName, merged.name)) {
      // 自愈：Demo 版缓存无好评率 → 忽略缓存，重新搜索完整版
      if (isDemoCacheWithoutRating(merged)) {
        appId = null;
      } else {
        // 缓存命中：幂等补写注册表（含封面），防止缓存管理页缺失条目/封面；
        // 中英文名异常（占位/缺失）时自动按 appId 重新获取（自愈）
        await ensureRegistryEntry(merged.appId || appId, merged.name, merged.englishName, gameName, merged.headerImage || '', merged.type);
        await ensureValidRegistryNames(merged.appId || appId, merged.name, merged.englishName, gameName);
        return merged;
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
    // 4. 搜索 appId（若已有 appId 但缓存过期，跳过搜索直接获取详情；
    //    v3.3.13：排除曾报错的错误 appid）
    if (!appId) {
      const searchResult = await searchSteamAppId(parseGameTitle(gameName), gameName, excludeAppId);
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
  const merged = getMergedData(cached) || {};
  // 无好评率条目（0 评测/失败固化）按冷却期重新获取（v3.3.7：rating 模块有效判定）
  if (!isModuleValid(cached, 'rating') || merged.positiveRate === undefined || needsRatingRefetch(merged)) return null;
  if (isDemoCacheWithoutRating(merged)) return null;

  // 与完整路径一致：幂等补写注册表（含封面/type）+ 中英文名异常自愈（缓存命中时同步）
  await ensureRegistryEntry(merged.appId || appId, merged.name, merged.englishName, gameName, merged.headerImage || '', merged.type);
  await ensureValidRegistryNames(merged.appId || appId, merged.name, merged.englishName, gameName);
  return {
    positiveRate: merged.positiveRate,
    ratingDesc: merged.ratingDesc || null,
    appId: merged.appId || appId,
    name: merged.name || gameName,
    type: merged.type || 'game',
    // v3.3.6：近 30 天好评率/最近更新随缓存返回（徽章三段式）
    totalReviews: merged.totalReviews || 0,
    recentPositiveRate: merged.recentPositiveRate ?? null,
    recentTotalReviews: merged.recentTotalReviews ?? 0,
    lastUpdate: merged.lastUpdate || null,
    releaseDate: merged.releaseDate || ''
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

  // 2. 若有 appId，检查 Steam 动态缓存（含 Demo 自愈；v3.3.7：rating 模块有效判定）
  let usableAppId = appId;
  if (appId) {
    const cached = await getSteamCacheEntry(appId);
    const merged = getMergedData(cached) || {};
    if (isModuleValid(cached, 'rating') && merged.positiveRate !== undefined && !needsRatingRefetch(merged)) {
      // 自愈：命中 Demo 版且无评测的缓存 → 视为无效，重新搜索完整版
      if (!isDemoCacheWithoutRating(merged)) {
        // 缓存命中：幂等补写注册表（含封面/type）；中英文名异常时自愈
        await ensureRegistryEntry(merged.appId || appId, merged.name, merged.englishName, gameName, merged.headerImage || '', merged.type);
        await ensureValidRegistryNames(merged.appId || appId, merged.name, merged.englishName, gameName);
        return {
          positiveRate: merged.positiveRate,
          ratingDesc: merged.ratingDesc || null,
          appId: merged.appId || appId,
          name: merged.name || gameName,
          type: merged.type || 'game',
          // v3.3.6：近 30 天好评率/最近更新随缓存返回（徽章三段式）
          totalReviews: merged.totalReviews || 0,
          recentPositiveRate: merged.recentPositiveRate ?? null,
          recentTotalReviews: merged.recentTotalReviews ?? 0,
          lastUpdate: merged.lastUpdate || null,
          releaseDate: merged.releaseDate || ''
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
    // 4. 搜索 appId（若已有 appId 但缓存过期，跳过搜索直接获取评价；
    //    v3.3.13：排除曾报错的错误 appid）
    let foundAppId = usableAppId;
    let foundName = gameName;
    let searchResult = null;
    // 该标题曾报错：错误 appid 作为黑名单排除（全流程复用，含 0 评测重搜）
    const corr = await lookupWrongReportCorrection(gameName);
    if (!foundAppId) {
      searchResult = await searchSteamAppId(parseGameTitle(gameName), gameName, corr ? corr.wrongAppId : null);
      if (!searchResult) {
        // 记录负缓存 / Record negative cache
        Logger.warn('Steam', `列表页搜索未找到: ${gameName}`);
        await recordNameIndex(gameName, null);
        return null;
      }
      foundAppId = searchResult.appId;
      foundName = searchResult.name;
    }

    // 4.5 appId 校验（v3.2.6，v3.3.2 按需化）：DLC 等非游戏本体 → 自动解析为
    // 所属本体（fullgame）；其他非本体类型（bundle/mod/music 等）→ 返回 type 标记。
    // 网络失败时保持原值继续（防误杀）。**按需执行**：缓存条目已有 type（说明该
    // appId 此前已校验并解析为本体）或游戏名不疑似附属内容（正常游戏名几乎不可
    // 能是 DLC/bundle）时跳过网络校验，省 1 请求/游戏——批量列表页请求量减 20%，
    // 显著降低 Steam 限流与慢网下批内挂起风险。
    // appId validation (on-demand since v3.3.2): a DLC resolves to its base game,
    // other non-base types (bundle/mod/music) return a type marker. Skipped when
    // the cache already carries a type (already validated/resolved) or the name
    // shows no add-on hints — saves 1 request per game (~20% fewer in batch).
    let appType = null;
    if (foundAppId) {
      // v3.3.7：缓存 type 从合并视图读取（meta 模块）
      const cachedType = usableAppId ? ((await getSteamCacheEntry(usableAppId)) || null) : null;
      const cachedTypeVal = cachedType ? (getMergedData(cachedType) || {}).type : null;
      if (cachedTypeVal) {
        appType = cachedTypeVal;
      } else if (ADDON_NAME_PATTERN.test(foundName)) {
        const baseCheck = await fetchSteamAppDetails(foundAppId, 'schinese').catch(() => null);
        if (baseCheck) {
          appType = baseCheck.type || 'game';
          const baseId = baseAppIdFromDetails(baseCheck);
          if (baseId && baseId !== String(foundAppId)) {
            Logger.warn('Steam', `appId ${foundAppId} 为 DLC/非本体，自动解析为本体 ${baseId}（${(baseCheck.fullgame && baseCheck.fullgame.name) || ''}）`);
            foundAppId = baseId;
            foundName = (baseCheck.fullgame && baseCheck.fullgame.name) || foundName;
          } else if (!baseId) {
            // bundle/mod/music 等非本体且无法解析：返回 type 标记（徽章显示 type 值而非"未找到"）
            Logger.warn('Steam', `appId ${foundAppId} 类型 ${baseCheck.type} 非游戏本体且无法解析，返回 type 标记`);
            return { positiveRate: null, ratingDesc: null, appId: foundAppId, name: foundName, type: baseCheck.type };
          }
        }
      }
    }

    // 5. 获取评价统计（好评率 + 近 30 天好评率，v3.3.6 一次请求同取）。
    //    获取失败（网络/限流）→ 不写缓存并标记 failed，
    //    下次访问自动重试（避免 null 固化导致长期只显示 AppID）。
    const reviewSummary = await fetchReviewSummary(foundAppId);
    if (!reviewSummary) {
      Logger.warn('Steam', `好评率获取失败: ${gameName} (appId ${foundAppId})，不写缓存待重试`);
      return { positiveRate: null, ratingDesc: null, appId: foundAppId, name: foundName, failed: true, type: appType || 'game' };
    }
    let positiveRate = null;
    let ratingDesc = null;
    let recentRate = null;
    let recentTotal = 0;
    if (reviewSummary) {
      ratingDesc = reviewSummary.desc || null;
      if (reviewSummary.total > 0) {
        positiveRate = Math.round(reviewSummary.positive / reviewSummary.total * 100);
      }
      if (reviewSummary.recent) {
        recentRate = reviewSummary.recent.rate;
        recentTotal = reviewSummary.recent.total;
      }
    }

    // 5.5 官方中英文名：搜索路径用搜索结果英文名；0 评测时轻量获取官方名
    //     并验证 Demo/附属内容（校验失败 → 重搜本体）。
    //     v3.3.2：officialEn 已有可靠英文名时仅请求 schinese（省 1 请求/0 评测游戏）
    let officialCn = foundName;
    let officialEn = searchResult ? (searchResult.englishName || foundName) : pickRegistryEnName(gameName, foundName);
    if (positiveRate === null) {
      // 英文名缺失时才并行补英文（避免 validateSteamNames 误判重搜）
      const needsEn = !/[A-Za-z]{2,}/.test(officialEn);
      const [cnData, enData] = await Promise.all([
        fetchSteamAppDetails(foundAppId, 'schinese').catch(() => null),
        needsEn ? fetchSteamAppDetails(foundAppId, 'english').catch(() => null) : Promise.resolve(null)
      ]);
      officialCn = (cnData && cnData.name) || officialCn;
      if (enData && enData.name) officialEn = enData.name;
      // 名称校验：Demo/试玩或附属内容 → 视为无效匹配，重搜本体
      const nameCheck = validateSteamNames(officialCn, officialEn);
      if (!nameCheck.valid || DEMO_NAME_PATTERN.test(officialCn + ' ' + officialEn)) {
        Logger.warn('Steam', `0评测匹配无效(${nameCheck.issues.join('/')}): ${foundAppId} ${officialCn}，重搜`);
        const reSearch = await searchSteamAppId(parseGameTitle(gameName), gameName, corr ? corr.wrongAppId : null);
        if (reSearch) {
          foundAppId = reSearch.appId;
          foundName = reSearch.name;
          officialCn = reSearch.name;
          officialEn = reSearch.englishName || officialCn;
          const rs2 = await fetchReviewSummary(foundAppId);
          if (rs2) {
            ratingDesc = rs2.desc || null;
            if (rs2.total > 0) positiveRate = Math.round(rs2.positive / rs2.total * 100);
            if (rs2.recent) {
              recentRate = rs2.recent.rate;
              recentTotal = rs2.recent.total;
            }
          }
        }
      }
    }

    // 6. 合并写入 Steam 动态缓存（自愈场景不留存旧 Demo 数据；含封面/type 供补写）。
    //    确认 0 评测（positiveRate null）时记录重试时间，冷却期内不再重复请求。
    //    v3.3.6：近 30 天好评率随同一请求写入缓存（徽章三段式数据源）。
    //    v3.3.7：existing 为模块合并视图（setSteamCacheEntry 按字段自动路由，
    //    只更新 meta/rating 模块，detail/spy 保留）。
    //    v3.3.8：列表页独立获取最近更新日期（不依赖详情页访问；缓存已有则复用；
    //    GetNewsForApp 在 api.steampowered.com 独立限流域，不影响商店 API 配额）。
    const existing = usableAppId ? (getMergedData(await getSteamCacheEntry(usableAppId)) || {}) : {};
    const headerImage = coverImageFor(foundAppId, options.cover);
    let lastUpdate = existing.lastUpdate || null;
    if (!lastUpdate) {
      lastUpdate = await fetchLastUpdate(foundAppId).catch(() => null);
    }
    const mergedData = {
      ...existing, appId: foundAppId, name: foundName, englishName: officialEn,
      positiveRate, ratingDesc, headerImage, type: appType || 'game',
      totalReviews: reviewSummary ? reviewSummary.total : 0,
      recentPositiveRate: recentRate, recentTotalReviews: recentTotal,
      lastUpdate: lastUpdate || existing.lastUpdate || null,
      ratingRetriedAt: positiveRate === null ? Date.now() : existing.ratingRetriedAt
    };
    await setSteamCacheEntry(foundAppId, mergedData);

    // 7. 同步更新游戏注册表和名称索引：官方中英文名 + 封面图 + 标题变体 + type
    await recordGameInRegistry(foundAppId, {
      cnName: officialCn,
      enName: officialEn,
      gameName,
      coverImage: headerImage,
      type: appType || 'game'
    });
    await recordNameIndex(gameName, foundAppId);

    return {
      positiveRate, ratingDesc, appId: foundAppId, name: foundName,
      totalReviews: reviewSummary ? reviewSummary.total : 0,
      recentPositiveRate: recentRate, recentTotalReviews: recentTotal,
      lastUpdate: lastUpdate || existing.lastUpdate || null,
      releaseDate: existing.releaseDate || ''
    };
  } catch (e) {
    Logger.warn('Steam', `获取好评率异常: ${gameName}`, e.message);
    Logger.debug('Steam', '获取Steam好评率失败:', e.message);
    return null;
  }
}
