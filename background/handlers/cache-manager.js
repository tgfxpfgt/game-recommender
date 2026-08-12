import { dataStore } from '../../data/data-store.js';
import { readProfiles, readKeywordWeights } from '../storage/behavior.js';
import { flushAllCaches } from '../storage/flush.js';
import { DB_KEYS, resolveTtlMs } from '../core/constants.js';
import { getDownloadSites } from '../core/rules.js';
import { getSettings } from '../core/settings.js';
import { computeGameScore, findProfile, steamspyScores } from '../recommend/engine.js';
import { searchDownloadSites } from '../sites/search.js';
import { fetchSteamFullDetailsByAppId } from '../steam/api.js';
import { collectExpiredSteamCache, collectExpiredNegativeNames, collectExpiredDownloadUrls } from '../storage/cleanup.js';
import { readDownloadUrlsStore } from '../storage/download-urls.js';
import { Logger } from '../storage/logger.js';
import { flushNameIndex, deleteNameIndexEntries } from '../storage/name-index.js';
import { flushRegistry, getGameRegistry, recordGameInRegistry } from '../storage/registry.js';
import { resetInMemoryCaches } from '../storage/reset.js';
import { flushSteamCache, setSteamCacheEntry, deleteSteamCacheEntry, getSteamCacheMemory, loadSteamCacheToMemory, getMergedData } from '../storage/steam-cache.js';

/**
 * Game Recommender - 消息处理：游戏缓存管理 / Cache Manager Handlers
 *
 * v5.0.0：由 handlers.js 拆分——缓存列表/删除/清空/单条刷新/过期清理。
 */


// --- 缓存过期清理（v3.0.0）---
export async function handleCleanExpiredCache() {
  const settings = await getSettings();
  const ttl = settings.cacheTtls || {};
  // v3.3.7 模块化：Steam 缓存按各模块自身 TTL 判定（collectExpiredSteamCache
  // 不再需要外部 TTL），仅清理所有模块均过期的条目
  const negTtl = resolveTtlMs('negativeCache', ttl.negativeCache);
  const urlTtl = resolveTtlMs('downloadUrls', ttl.downloadUrls);

  const [steamData, nameData, urlStore] = await Promise.all([
    dataStore.readModule(DB_KEYS.STEAM_CACHE),
    dataStore.readModule(DB_KEYS.NAME_INDEX),
    readDownloadUrlsStore()
  ]);
  const steam = collectExpiredSteamCache(steamData || {});
  const names = collectExpiredNegativeNames(nameData || {}, negTtl);
  const urls = collectExpiredDownloadUrls(urlStore, urlTtl);

  await Promise.all([
    dataStore.writeModule(DB_KEYS.STEAM_CACHE, Object.fromEntries(steam.map)),
    dataStore.writeModule(DB_KEYS.NAME_INDEX, Object.fromEntries(names.map)),
    dataStore.writeModule(DB_KEYS.DOWNLOAD_URLS, urls.store)
  ]);
  resetInMemoryCaches();
  const total = steam.removed + names.removed + urls.removed;
  Logger.info('Cache', `清理过期缓存: Steam ${steam.removed} / 负缓存 ${names.removed} / 网址 ${urls.removed}`);
  return { steamCache: steam.removed, nameIndex: names.removed, downloadUrls: urls.removed, total };
}

// --- 名称批量自愈（v3.1.0）---


// --- 游戏缓存管理 / Game cache management ---
export async function handleGetGameCacheList(message) {
  const keyword = (message.keyword || '').toLowerCase().trim();
  const minRating = Number(message.minRating) > 0 ? Number(message.minRating) : 0;
  const tag = (message.tag || '').trim().toLowerCase();
  const siteKey = (message.siteKey || '').trim().toLowerCase();
  const typeFilter = (message.typeFilter || '').trim().toLowerCase();
  const page = Math.max(1, message.page || 1);
  const pageSize = Math.max(1, Math.min(100, message.pageSize || 20));

  const settings = await getSettings();
  const weights = settings.weights;

  const registry = await getGameRegistry();
  const urlStore = await readDownloadUrlsStore();
  await loadSteamCacheToMemory();
  const steamCacheMemory = getSteamCacheMemory();

  // 推荐值（appId 维度个性化）：批量计算一次取齐画像/偏好，循环复用
  const [gameProfiles, keywordWeights] = await Promise.all([
    readProfiles(),
    readKeywordWeights()
  ]);
  const allProfiles = Object.values(gameProfiles);
  const globalStats = {
    maxViews: Math.max(1, ...allProfiles.map(p => p.views || 0)),
    maxDownloads: Math.max(1, ...allProfiles.map(p => p.downloads || 0))
  };

  let games = Object.entries(registry).map(([appId, entry]) => {
    const urls = {};
    for (const [sk, bucket] of Object.entries(urlStore.sites)) {
      if (bucket[appId]) urls[sk] = bucket[appId];
    }
    const primaryUrl = Object.values(urls).find(u => u && u.url) || null;
    const cachedEntry = steamCacheMemory ? steamCacheMemory.get(String(appId)) || null : null;
    const cachedData = cachedEntry ? getMergedData(cachedEntry) : null;
    // 推荐值计算（纯函数，行为/Steam 信息动态反映）
    const profile = findProfile(gameProfiles, entry.cnName || entry.enName || '', entry);
    // v4.0.0：SteamSpy 时长/热度信号（与 calculateRecommendation 两处评分一致）
    const { playTimeScore, heatScore } = steamspyScores(
      cachedData && cachedData.steamspy ? cachedData.steamspy : null);
    const rec = computeGameScore({
      profile,
      globalStats,
      tags: entry.tags || null,
      keywordWeights,
      positiveRate: (cachedData && cachedData.positiveRate !== undefined) ? cachedData.positiveRate : null,
      chineseSupported: cachedData ? !!cachedData.chineseSupported : false,
      playTimeScore,
      heatScore,
      weights
    });
    return {
      appId,
      cnName: entry.cnName || '',
      enName: entry.enName || '',
      names: entry.names || [],
      tags: entry.tags || [],
      coverImage: entry.coverImage || null,
      firstSeen: entry.firstSeen || null,
      lastConfirmed: entry.lastConfirmed || null,
      positiveRate: (cachedData && cachedData.positiveRate !== undefined) ? cachedData.positiveRate : null,
      recommendation: rec.score,
      recommendationDetail: rec.breakdown,
      type: entry.type || (cachedData && cachedData.type) || '',
      downloadUrls: Object.entries(urls).map(([sk, u]) => ({
        siteKey: sk,
        siteName: u.siteName || sk,
        url: u.url,
        firstSeen: u.firstSeen,
        lastRefreshed: u.lastRefreshed,
        lastAccessed: u.lastAccessed
      })),
      primaryDownloadUrl: primaryUrl ? primaryUrl.url : '',
      lastAccessed: primaryUrl ? primaryUrl.lastAccessed : null
    };
  });

  if (keyword) {
    games = games.filter(g =>
      String(g.appId).includes(keyword) ||
      (g.cnName && g.cnName.toLowerCase().includes(keyword)) ||
      (g.enName && g.enName.toLowerCase().includes(keyword)) ||
      g.names.some(n => n.includes(keyword))
    );
  }
  if (minRating > 0) {
    games = games.filter(g => g.positiveRate !== null && g.positiveRate !== undefined && g.positiveRate >= minRating);
  }
  if (tag) {
    games = games.filter(g => (g.tags || []).some(t => t.toLowerCase().includes(tag)));
  }
  if (siteKey) {
    games = games.filter(g => g.downloadUrls.some(u => u.siteKey === siteKey && u.url));
  }
  if (typeFilter) {
    games = games.filter(g => (g.type || '').toLowerCase() === typeFilter);
  }

  games.sort((a, b) => (b.lastConfirmed || 0) - (a.lastConfirmed || 0));

  const total = games.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const pageItems = games.slice(start, start + pageSize);

  return { games: pageItems, total, page, pageSize, totalPages };
}



export async function handleDeleteGameCacheEntry(message) {
  const appId = String(message.appId || '');
  if (!appId) return { success: false, error: 'appId required' };

  const registry = await getGameRegistry();
  const entry = registry[appId];
  const namesToClean = entry ? (entry.names || []) : [];

  delete registry[appId];
  await flushRegistry();

  await deleteSteamCacheEntry(appId);
  await flushSteamCache();

  const urlStore = await readDownloadUrlsStore();
  for (const bucket of Object.values(urlStore.sites)) {
    delete bucket[appId];
  }
  await dataStore.writeModule(DB_KEYS.DOWNLOAD_URLS, urlStore);

  await deleteNameIndexEntries(appId, namesToClean);
  await flushNameIndex();

  Logger.info('Cache', `删除游戏缓存: appId ${appId}`);
  return { success: true };
}



export async function handleClearGameCache() {
  await Promise.all([
    dataStore.removeModule(DB_KEYS.GAME_REGISTRY),
    dataStore.removeModule(DB_KEYS.STEAM_CACHE),
    dataStore.removeModule(DB_KEYS.DOWNLOAD_URLS),
    dataStore.removeModule(DB_KEYS.NAME_INDEX)
  ]);
  await chrome.storage.local.remove(DB_KEYS.MANUAL_MAPPINGS);
  resetInMemoryCaches();
  Logger.info('Cache', '清空全部游戏缓存');
  return { success: true };
}



export async function handleRefreshGameCacheEntry(message) {
  const appId = String(message.appId || '');
  if (!appId) return { success: false, error: 'appId required' };
  try {
    const result = await fetchSteamFullDetailsByAppId(appId);
    if (!result) return { success: false, error: '获取 Steam 信息失败' };

    await setSteamCacheEntry(appId, result);
    await recordGameInRegistry(appId, {
      cnName: result.name,
      enName: result.englishName || result.name,
      tags: result.genres,
      coverImage: result.headerImage || ''
    });

    const settings = await getSettings();
    const allSites = await getDownloadSites();
    const enabledKeys = settings.steamSiteSearch || allSites.map(s => s.key);
    const sites = await searchDownloadSites(result.name, appId, enabledKeys);

    await flushAllCaches();

    Logger.info('Cache', `手动刷新缓存条目: appId ${appId} → ${result.name}`);
    return {
      success: true,
      name: result.name,
      englishName: result.englishName || '',
      positiveRate: result.positiveRate,
      sites: sites.map(s => ({ key: s.key, found: s.found, detailUrl: s.detailUrl }))
    };
  } catch (e) {
    Logger.error('Cache', `手动刷新缓存条目失败: ${e.message}`);
    return { success: false, error: e.message };
  }
}

// --- 数据模块：清单/导出/导入 ---
