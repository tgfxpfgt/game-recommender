import { dataStore } from '../../data/data-store.js';
import { flushAllCaches } from '../storage/flush.js';
import { DB_KEYS, detailSteamCacheTtlMs } from '../core/constants.js';
import { parseGameTitle } from '../core/title-parser.js';
import {
  searchSteamAppId,
  fetchSteamFullDetailsByAppId,
  scanAndHealRegistry,
  isCompleteCacheData,
  namesRelated,
  findVersionVariant
} from '../steam/api.js';
import { searchSteamGame } from '../steam/orchestrator.js';
import { readDownloadUrlsStore } from '../storage/download-urls.js';
import { Logger } from '../storage/logger.js';
import { flushNameIndex, recordNameIndex, lookupAppIdByName, deleteNameIndexEntry } from '../storage/name-index.js';
import { flushRegistry, recordGameInRegistry } from '../storage/registry.js';
import {
  flushSteamCache,
  getSteamCacheEntry,
  setSteamCacheEntry,
  deleteSteamCacheEntry,
  isModuleValid,
  getModuleData,
  getMergedData,
  latestModuleTs
} from '../storage/steam-cache.js';
import { recordWrongReport, flushWrongReports } from '../storage/wrong-reports.js';
import { getAppIdByUrl, setUrlAppId } from '../storage/url-index.js'; // v7.0.2：详情页网址第一候选

/**
 * 游戏雷达 Game Radar - 消息处理：Steam 查询 / Steam Message Handlers
 *
 * v5.0.0：由 handlers.js 拆分——搜索/直取/手动映射/候选/预热/报错/自愈。
 */

// --- Steam 查询 / Steam lookups ---
// v7.0.2：详情页网址作为检索第一候选——同一 URL 始终指向同一 appId，
// 消除列表页/详情页两条匹配路径的分歧；匹配成功后记录 URL → appId
export async function handleSearchSteam(message, sender) {
  const pageUrl = sender && sender.tab ? sender.tab.url : '';
  // 第一候选：URL 索引命中 → 直接用该 appId 获取详情（不再标题搜索）
  if (pageUrl) {
    const urlAppId = await getAppIdByUrl(pageUrl);
    if (urlAppId) {
      const byUrl = await fetchSteamFullDetailsByAppId(urlAppId);
      if (byUrl) {
        Logger.info('Steam', `网址索引命中 "${message.gameName}" → ${byUrl.name}`, { appId: byUrl.appId });
        await flushAllCaches();
        const cachedEntry = await getSteamCacheEntry(byUrl.appId);
        return { data: byUrl, cachedAt: cachedEntry ? latestModuleTs(cachedEntry) : null };
      }
      // 详情获取失败（如缓存损坏）→ 继续标题搜索路径
    }
  }
  const steamResult = await searchSteamGame(message.gameName);
  if (steamResult) {
    Logger.info('Steam', `匹配"${message.gameName}" → ${steamResult.name}`, {
      appId: steamResult.appId,
      rating: steamResult.ratingDesc
    });
    // 记录 URL → appId（详情页网址作为后续检索第一候选）
    if (pageUrl) await setUrlAppId(pageUrl, steamResult.appId);
  } else {
    Logger.warn('Steam', `未找到"${message.gameName}"`);
  }
  await flushAllCaches();
  // 返回缓存时间戳供详情页浮窗显示"缓存于 xx 分钟前"（模块化：取最近模块时间）
  const cachedEntry = steamResult ? await getSteamCacheEntry(steamResult.appId) : null;
  return { data: steamResult, cachedAt: cachedEntry ? latestModuleTs(cachedEntry) : null };
}

export async function handleRefreshSteamCache(message) {
  // 通过名称索引查找 appId，以 appId 为键删除缓存
  const appId = await lookupAppIdByName(message.gameName);
  if (appId) {
    await deleteSteamCacheEntry(appId);
  }
  const steamResult = await searchSteamGame(message.gameName);
  await flushAllCaches();
  const cachedEntry = steamResult ? await getSteamCacheEntry(steamResult.appId) : null;
  if (steamResult) {
    Logger.info('Steam', `手动刷新缓存"${message.gameName}" → ${steamResult.name}`, { appId: steamResult.appId });
  }
  return { data: steamResult, cachedAt: cachedEntry ? latestModuleTs(cachedEntry) : null };
}

// 直接通过 appId 获取 Steam 详情（绕过名称搜索；图片 URL 含 appId 时使用）
// v3.3.7：缓存命中要求"detail 模块未过期（详情页独立 TTL）+ 数据完整"——
// 仅 detail 过期时重新获取详情，meta/rating/spy 模块保留（部分刷新）。
// v3.3.14：图片提取的 appId 可能与页面标题无关（gamer520 侧边推荐图是 Steam
// CDN 封面，会被全页图提取误取）——有 gameName 时校验名称相关性，不相关
// 拒绝并转标题搜索；manual=true（手动选择候选）跳过校验（用户主动确认）。

// 直接通过 appId 获取 Steam 详情（绕过名称搜索；图片 URL 含 appId 时使用）
// v3.3.7：缓存命中要求"detail 模块未过期（详情页独立 TTL）+ 数据完整"——
// 仅 detail 过期时重新获取详情，meta/rating/spy 模块保留（部分刷新）。
// v3.3.14：图片提取的 appId 可能与页面标题无关（gamer520 侧边推荐图是 Steam
// CDN 封面，会被全页图提取误取）——有 gameName 时校验名称相关性，不相关
// 拒绝并转标题搜索；manual=true（手动选择候选）跳过校验（用户主动确认）。
// v7.0.3：检索顺序统一为「网址索引 → 封面直取 → 标题搜索 → 搜索引擎」——
// 直取（GET_STEAM_BY_APPID）也先查网址索引；manual（用户手动选择）优先于一切
export async function handleGetSteamByAppId(message, sender) {
  let appId = message.appId;
  const gameName = message.gameName || '';
  const manual = message.manual === true;
  const pageUrl = sender && sender.tab ? sender.tab.url : '';
  // 网址索引第一候选（非手动路径）：同一详情页网址始终指向同一 appId
  if (!manual && pageUrl) {
    const urlAppId = await getAppIdByUrl(pageUrl);
    if (urlAppId) {
      if (String(urlAppId) !== String(appId)) {
        Logger.info('Steam', `网址索引优先: ${appId} → ${urlAppId}（${pageUrl}）`);
      }
      appId = urlAppId;
    }
  }

  const cached = await getSteamCacheEntry(appId);
  const detailData = isModuleValid(cached, 'detail', detailSteamCacheTtlMs()) ? getModuleData(cached, 'detail') : null;
  if (detailData && isCompleteCacheData(detailData)) {
    // 返回合并视图（detail 判定完整性；meta/rating 字段随合并返回供浮窗渲染）；
    // v3.3.14：非手动路径校验名称相关性（侧边推荐缓存也可能被误取）
    if (manual || !gameName || namesRelated(gameName, detailData.name)) {
      return { data: getMergedData(cached), cachedAt: latestModuleTs(cached) };
    }
    Logger.warn('Steam', `图片 appId ${appId} 与页面标题不相关（${detailData.name} vs ${gameName}），拒绝缓存命中`);
    return { data: null, cachedAt: null };
  }

  try {
    const result = await fetchSteamFullDetailsByAppId(appId);
    if (!result) return { data: null, cachedAt: null };
    // v3.3.14：名称相关性校验（手动选择跳过）
    if (!manual && gameName && !namesRelated(gameName, result.name)) {
      Logger.warn('Steam', `图片 appId ${appId} 与页面标题不相关（${result.name} vs ${gameName}），拒绝并转标题搜索`);
      return { data: null, cachedAt: null };
    }

    // v4.1.1：版本后缀补搜（findVersionVariant）——标题含"增强版"等版本词、
    // 封面/直取 appId 是旧版时升级到新版（如 gamer520 40746 封面 271590 是
    // GTA5 老版，标题"侠盗猎车手V 增强版"应匹配 3240220）；命中则整体走新版
    let target = result;
    if (!manual && gameName) {
      const variant = await findVersionVariant(appId, gameName);
      if (variant && String(variant.appId) !== String(appId)) {
        const variantResult = await fetchSteamFullDetailsByAppId(variant.appId);
        if (variantResult) {
          Logger.info(
            'Steam',
            `版本后缀补搜: "${gameName}" 封面 ${appId} 为旧版 → 升级 ${variant.appId} ${variantResult.name}`
          );
          target = variantResult;
        }
      }
    }

    await setSteamCacheEntry(target.appId, target);
    await recordGameInRegistry(target.appId, {
      cnName: target.name,
      enName: target.englishName || target.name,
      gameName,
      tags: target.genres,
      coverImage: target.headerImage || ''
    });
    if (gameName) await recordNameIndex(gameName, target.appId);
    // v7.0.3：直取匹配成功也回写网址索引（统一详情页/列表页/Steam 页匹配）
    if (pageUrl) await setUrlAppId(pageUrl, target.appId);

    await flushAllCaches();
    const newEntry = await getSteamCacheEntry(target.appId);
    Logger.info('Steam', `通过 appId ${target.appId} 直接获取: ${target.name}`);
    return { data: target, cachedAt: newEntry ? latestModuleTs(newEntry) : null };
  } catch (e) {
    Logger.error('Steam', `通过 appId ${appId} 获取失败: ${String(e)}`);
    return { data: null, cachedAt: null };
  }
}

// 保存用户手动选择的"游戏名→appId"映射

// 保存用户手动选择的"游戏名→appId"映射
export async function handleSaveManualMapping(message) {
  const gameName = (message.gameName || '').trim();
  const appId = message.appId;
  if (!gameName || !appId) return { success: false };

  await recordNameIndex(gameName, appId);
  await recordGameInRegistry(appId, { cnName: gameName, gameName });
  await flushNameIndex();
  await flushRegistry();
  // v3.3.13：手动选择 = 用户确认正确 appid → 记录为纠正知识（长期有效）
  await recordWrongReport(gameName, { correctAppId: appId, source: 'manual' });
  await flushWrongReports();
  Logger.info('Steam', `保存手动映射: "${gameName}" → appId ${appId}`);
  return { success: true };
}

// 搜索候选游戏列表（手动选择浮窗）

// 搜索候选游戏列表（手动选择浮窗）
export async function handleSearchSteamCandidates(message) {
  const searchTerms = parseGameTitle(message.gameName || '');
  const candidates = [];
  const seen = new Set();
  for (const term of searchTerms.slice(0, 3)) {
    try {
      const result = await searchSteamAppId([term], term);
      if (result) {
        const item = { appId: result.appId, name: result.name };
        if (!seen.has(item.appId)) {
          seen.add(item.appId);
          candidates.push({ appId: item.appId, name: item.name, price: null, image: '' });
        }
      }
    } catch {
      /* 单个词失败继续 */
    }
  }
  return { candidates: candidates.slice(0, 10) };
}

// 强制刷新当前页缓存（popup"强制刷新"）：按 appIds/names 删除 Steam 缓存与
// 名称索引（含负缓存），页面重载后从 Steam 全新拉取（忽略 TTL 与 0 评测冷却）。
// Force-refresh the current page's Steam cache (popup button): deletes cache and
// name-index entries (negative ones included); the reload then fetches
// everything fresh from Steam, ignoring cache TTLs and the zero-review cooldown.
export async function handleClearCacheForPage(message) {
  const names = message.names || [];
  const appIds = message.appIds || [];
  const seen = new Set();
  let cleared = 0;
  for (const id of appIds) {
    const key = String(id);
    if (!seen.has(key)) {
      seen.add(key);
      await deleteSteamCacheEntry(key);
      cleared++;
    }
  }
  for (const name of names) {
    const appId = await lookupAppIdByName(name);
    if (appId && !seen.has(String(appId))) {
      seen.add(String(appId));
      await deleteSteamCacheEntry(String(appId));
      cleared++;
    }
    // 名称索引条目（正/负缓存）一并删除，防止负缓存拦截重新获取
    await deleteNameIndexEntry(name);
  }
  await flushSteamCache();
  await flushNameIndex();
  Logger.info('Cache', `强制刷新清除 ${cleared} 条 Steam 缓存（${names.length} 个游戏名）`);
  return { success: true, cleared };
}

// Steam 商品页缓存预取（v3.3.8）：浏览 store.steampowered.com/app/{id}/ 时
// 预热该游戏缓存——detail 模块有效则跳过（防重复请求）；否则完整拉取并记录
// 名称索引（回下载站列表页徽章/筛选立即命中）
// Steam-store-page cache warm-up: prefetch the game's full data while browsing
// its store page (skipped when the detail module is still valid); the name
// index entry makes download-site list badges hit instantly afterwards.
export async function handleCacheSteamPage(message) {
  const appId = String(message.appId || '');
  const gameName = message.gameName || '';
  if (!appId) return { success: false };
  try {
    const cached = await getSteamCacheEntry(appId);
    const detail = isModuleValid(cached, 'detail', detailSteamCacheTtlMs()) ? getModuleData(cached, 'detail') : null;
    if (detail && isCompleteCacheData(detail)) return { success: true, cached: true };
    const result = await fetchSteamFullDetailsByAppId(appId);
    if (!result) return { success: false };
    await setSteamCacheEntry(appId, result);
    if (gameName) await recordNameIndex(gameName, appId);
    await flushSteamCache();
    await flushNameIndex();
    Logger.info('Steam', `Steam 商品页缓存预取: appId ${appId} (${result.name})`);
    return { success: true, cached: false };
  } catch (e) {
    Logger.warn('Steam', `Steam 商品页缓存预取失败: appId ${appId}`, String(e));
    return { success: false };
  }
}

// 人工报错重检索（v3.3.11）：详情页浮窗"报错"按钮——用户发现检索到错误的
// appid 时，清除该 appId 的 Steam 缓存/名称索引（正/负缓存都删，防负缓存
// 拦截重检索）/下载站网址映射（30 天错误映射一并清除），随后重新检索。
// 注册表不删：它是 Steam 官方信息，错误的是"标题→appId"的映射。
// Manual wrong-appId report: clears the wrong appId's Steam cache, name-index
// entries (both signs, so the negative cache can't block the re-search) and
// download-URL mappings; the registry is kept (it holds official Steam info,
// only the title→appId mapping was wrong).

// 人工报错重检索（v3.3.11）：详情页浮窗"报错"按钮——用户发现检索到错误的
// appid 时，清除该 appId 的 Steam 缓存/名称索引（正/负缓存都删，防负缓存
// 拦截重检索）/下载站网址映射（30 天错误映射一并清除），随后重新检索。
// 注册表不删：它是 Steam 官方信息，错误的是"标题→appId"的映射。
// Manual wrong-appId report: clears the wrong appId's Steam cache, name-index
// entries (both signs, so the negative cache can't block the re-search) and
// download-URL mappings; the registry is kept (it holds official Steam info,
// only the title→appId mapping was wrong).
export async function handleReportWrongAppId(message) {
  const appId = String(message.appId || '');
  const gameName = message.gameName || '';
  if (appId) {
    await deleteSteamCacheEntry(appId);
    const urlStore = await readDownloadUrlsStore();
    for (const bucket of Object.values(urlStore.sites || {})) {
      if (bucket[appId]) delete bucket[appId];
    }
    await dataStore.writeModule(DB_KEYS.DOWNLOAD_URLS, urlStore);
  }
  if (gameName) await deleteNameIndexEntry(gameName);
  await flushSteamCache();
  await flushNameIndex();
  // v3.3.13：记录报错样本（长期有效，供检索纠正知识库与错误排除）
  if (gameName && appId) {
    await recordWrongReport(gameName, { wrongAppId: appId, source: 'report' });
    await flushWrongReports();
  }
  Logger.info('Cache', `人工报错: 清除 appId ${appId || '?'} 缓存（${gameName}）`);
  return { success: true };
}

// --- 缓存过期清理（v3.0.0）---

// --- 名称批量自愈（v3.1.0）---
export async function handleHealRegistryNames(message) {
  const result = await scanAndHealRegistry(Math.min(50, (message && message.limit) || 20));
  Logger.info(
    'Steam',
    `名称批量自愈: 扫描 ${result.scanned} 条, 修复 ${result.healed} 条, 剩余 ${result.remaining} 条`
  );
  return result;
}

// --- Steam API 状态监测（v3.3.0）---
