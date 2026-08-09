/**
 * Game Recommender - 消息处理 / Message Handlers
 *
 * 所有消息类型的处理函数与分发映射表（无内部状态，全部依赖各业务模块）。
 * All message handlers and the dispatch map (stateless; delegates to modules).
 */
import { dataStore } from '../data/data-store.js';
import { DB_KEYS, DATA_MODULES, EXPORT_FORMAT, EXPORT_VERSION, DEFAULT_SETTINGS } from './core/constants.js';
import { getSettings, saveSettings } from './core/settings.js';
import { resetInMemoryCaches } from './core/reset.js';
import { getDownloadSites } from './core/rules.js';
import { Logger, getRuntimeLogs, clearRuntimeLogs } from './storage/logger.js';
import {
  flushSteamCache, getSteamCacheEntry, setSteamCacheEntry,
  deleteSteamCacheEntry, getSteamCacheMemory, loadSteamCacheToMemory
} from './storage/steam-cache.js';
import { flushRegistry, getGameRegistry, getGameRegistryEntry, recordGameInRegistry } from './storage/registry.js';
import {
  flushNameIndex, recordNameIndex, lookupAppIdByName, deleteNameIndexEntries
} from './storage/name-index.js';
import { readDownloadUrlsStore, recordDownloadUrl, recordDownloadUrlsBatch } from './storage/download-urls.js';
import { addBehaviorLog, updateGameProfile, maybeUpdatePreferences, getBehaviorLog } from './storage/behavior.js';
import { createBackup, getBackupList, restoreBackup, deleteBackup } from './storage/backups.js';
import { getDownloadHistory, recordDownloadHistory, inferSiteFromDomain } from './storage/history.js';
import { searchSteamGame, getSteamPositiveRate } from './steam/orchestrator.js';
import { searchSteamAppId, fetchSteamFullDetailsByAppId } from './steam/api.js';
import { parseGameTitle } from './steam/title-parser.js';
import { calculateRecommendation } from './recommend/engine.js';
import { searchDownloadSites } from './sites/search.js';
import { getFreeGamesData, claimFreeGame } from './freegames/manager.js';
import { fetchWithTimeout } from './core/utils.js';

// --- 行为追踪 / Behavior tracking ---
async function handleTrackEvent(message) {
  await addBehaviorLog(message.data);

  if (message.data.type === 'click_download') {
    await updateGameProfile({
      name: message.data.gameName,
      event: 'download',
      keywords: message.data.keywords
    });
    await recordDownloadHistory(message.data);
    Logger.info('Download', `下载"${message.data.gameName}"`, { method: message.data.method, domain: message.data.domain });
  }
  if (message.data.type === 'view_detail') {
    await updateGameProfile({
      name: message.data.gameName,
      event: 'view',
      keywords: message.data.keywords
    });
  }
  // Steam标签回写
  if (message.data.type === 'steam_tags_update') {
    await updateGameProfile({
      name: message.data.gameName,
      event: 'view',
      keywords: message.data.keywords,
      steamAppId: message.data.steamAppId,
      steamRating: message.data.steamRating
    });
  }
  // 节流更新偏好模型；下载事件强制刷新（更具信号价值）
  await maybeUpdatePreferences(message.data.type === 'click_download');
  return { success: true };
}

async function handleGetRecommendations(message) {
  const games = message.games || [];
  const useBuiltinOnly = games.length > 1; // 批量时强制内置算法
  const results = [];
  for (const game of games) {
    const score = await calculateRecommendation(game, useBuiltinOnly);
    results.push({ ...game, recommendation: score });
  }
  return { results };
}

// --- Steam 查询 / Steam lookups ---
async function handleSearchSteam(message) {
  const steamResult = await searchSteamGame(message.gameName);
  if (steamResult) {
    Logger.info('Steam', `匹配"${message.gameName}" → ${steamResult.name}`, { appId: steamResult.appId, rating: steamResult.ratingDesc });
  } else {
    Logger.warn('Steam', `未找到"${message.gameName}"`);
  }
  await flushSteamCache();
  await flushNameIndex();
  await flushRegistry();
  // 返回缓存时间戳供详情页浮窗显示"缓存于 xx 分钟前"
  const cachedEntry = steamResult ? await getSteamCacheEntry(steamResult.appId) : null;
  return { data: steamResult, cachedAt: cachedEntry ? cachedEntry.timestamp : null };
}

async function handleRefreshSteamCache(message) {
  // 通过名称索引查找 appId，以 appId 为键删除缓存
  const appId = await lookupAppIdByName(message.gameName);
  if (appId) {
    await deleteSteamCacheEntry(appId);
  }
  const steamResult = await searchSteamGame(message.gameName);
  await flushSteamCache();
  await flushNameIndex();
  await flushRegistry();
  const cachedEntry = steamResult ? await getSteamCacheEntry(steamResult.appId) : null;
  if (steamResult) {
    Logger.info('Steam', `手动刷新缓存"${message.gameName}" → ${steamResult.name}`, { appId: steamResult.appId });
  }
  return { data: steamResult, cachedAt: cachedEntry ? cachedEntry.timestamp : null };
}

// 直接通过 appId 获取 Steam 详情（绕过名称搜索；图片 URL 含 appId 时使用）
async function handleGetSteamByAppId(message) {
  const appId = message.appId;
  const gameName = message.gameName || '';

  const cached = await getSteamCacheEntry(appId);
  if (cached && cached.data && cached.data.url && cached.data.appId) {
    return { data: cached.data, cachedAt: cached.timestamp };
  }

  try {
    const result = await fetchSteamFullDetailsByAppId(appId);
    if (!result) return { data: null, cachedAt: null };

    await setSteamCacheEntry(appId, result);
    await recordGameInRegistry(appId, {
      cnName: result.name,
      enName: result.englishName || result.name,
      gameName,
      tags: result.genres,
      coverImage: result.headerImage || ''
    });
    if (gameName) await recordNameIndex(gameName, appId);

    await flushSteamCache();
    await flushNameIndex();
    await flushRegistry();
    const newEntry = await getSteamCacheEntry(appId);
    Logger.info('Steam', `通过 appId ${appId} 直接获取: ${result.name}`);
    return { data: result, cachedAt: newEntry ? newEntry.timestamp : null };
  } catch (e) {
    Logger.error('Steam', `通过 appId ${appId} 获取失败: ${e.message}`);
    return { data: null, cachedAt: null };
  }
}

// 保存用户手动选择的"游戏名→appId"映射
async function handleSaveManualMapping(message) {
  const gameName = (message.gameName || '').trim();
  const appId = message.appId;
  if (!gameName || !appId) return { success: false };

  await recordNameIndex(gameName, appId);
  await recordGameInRegistry(appId, { cnName: gameName, gameName });
  await flushNameIndex();
  await flushRegistry();
  Logger.info('Steam', `保存手动映射: "${gameName}" → appId ${appId}`);
  return { success: true };
}

// 搜索候选游戏列表（手动选择浮窗）
async function handleSearchSteamCandidates(message) {
  const searchTerms = parseGameTitle(message.gameName || '');
  const candidates = [];
  const seen = new Set();
  for (const term of searchTerms.slice(0, 3)) {
    try {
      const result = await searchSteamAppId([term]);
      if (result) {
        const item = { appId: result.appId, name: result.name };
        if (!seen.has(item.appId)) {
          seen.add(item.appId);
          candidates.push({ appId: item.appId, name: item.name, price: null, image: '' });
        }
      }
    } catch (e) { /* 单个词失败继续 */ }
  }
  return { candidates: candidates.slice(0, 10) };
}

// 列表页批量好评率查询（忽略负缓存 + 封面 appId 直取）
async function handleGetSteamRatings(message) {
  const ratingNames = message.names || [];
  const imageData = message.imageData || {};
  const appIds = message.appIds || {};
  const ratings = {};
  const batchSize = 5;
  try {
    for (let i = 0; i < ratingNames.length; i += batchSize) {
      const batch = ratingNames.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(async (name) => {
        try {
          const img = imageData[name] || (appIds[name] ? { appId: appIds[name] } : null);
          const r = await getSteamPositiveRate(name, {
            ignoreNegativeCache: true,
            appId: img ? img.appId : null,
            cover: img ? img.cover : null
          });
          return [name, r];
        } catch (e) {
          return [name, null];
        }
      }));
      batchResults.forEach(([name, r]) => { ratings[name] = r; });
      // 每批完成后立即落盘（flush 已安全化，失败不中断）
      await flushSteamCache();
      await flushNameIndex();
      await flushRegistry();
    }
  } catch (e) {
    Logger.warn('Steam', '批量好评率查询部分失败', e.message);
  }
  return { ratings };
}

// 预热下一页 Steam 缓存（仅填充缓存不返回数据）
async function handlePrefetchSteamRatings(message) {
  const ratingNames = message.names || [];
  const imageData = message.imageData || {};
  const appIds = message.appIds || {};
  const covers = message.covers || {};
  if (ratingNames.length === 0) return { success: true };

  // 过滤：跳过已有有效缓存（预载同样忽略负缓存，重试一次值得）
  const needsPrefetch = [];
  for (const name of ratingNames) {
    try {
      const appId = await lookupAppIdByName(name);
      if (appId) {
        const cached = await getSteamCacheEntry(appId);
        if (cached && cached.data && cached.data.positiveRate !== undefined) continue;
        needsPrefetch.push(name);
      } else {
        needsPrefetch.push(name);
      }
    } catch (e) {
      needsPrefetch.push(name);
    }
  }
  if (needsPrefetch.length === 0) return { success: true };

  const batchSize = 6;
  for (let i = 0; i < needsPrefetch.length; i += batchSize) {
    const batch = needsPrefetch.slice(i, i + batchSize);
    await Promise.all(batch.map(async (name) => {
      try {
        const img = imageData[name] || (appIds[name] ? { appId: appIds[name], cover: covers[name] } : null);
        await getSteamPositiveRate(name, {
          ignoreNegativeCache: true,
          appId: img ? img.appId : null,
          cover: img ? img.cover : null
        });
      } catch (e) {}
    }));
  }
  await flushSteamCache();
  await flushNameIndex();
  await flushRegistry();
  return { success: true };
}

// --- 设置 / Settings ---
async function handleGetSettings() {
  return { settings: await getSettings() };
}

async function handleSaveSettings(message) {
  await saveSettings(message.settings);
  return { success: true };
}

async function handleResetSettings() {
  // 恢复默认设置（运行时数据不变）/ Reset to default settings
  await saveSettings({ ...DEFAULT_SETTINGS });
  return { success: true, settings: { ...DEFAULT_SETTINGS } };
}

// --- 统计 / Stats ---
async function handleGetStats() {
  const log = await getBehaviorLog();
  const [profiles, keywordWeights] = await Promise.all([
    dataStore.readModule(DB_KEYS.GAME_PROFILES).then(v => v || {}),
    dataStore.readModule(DB_KEYS.KEYWORD_WEIGHTS).then(v => v || {})
  ]);

  const viewDetailCount = log.filter(e => e.type === 'view_detail').length;
  const downloadCount = log.filter(e => e.type === 'click_download').length;
  const listViewCount = log.filter(e => e.type === 'view_list').length;

  const gameList = Object.values(profiles)
    .sort((a, b) => b.downloads - a.downloads || b.views - a.views)
    .slice(0, 50);

  const downloadMethods = {};
  log.filter(e => e.type === 'click_download').forEach(e => {
    const method = e.method || 'unknown';
    downloadMethods[method] = (downloadMethods[method] || 0) + 1;
  });

  return {
    totalEvents: log.length,
    totalGames: Object.keys(profiles).length,
    viewDetailCount,
    downloadCount,
    listViewCount,
    downloadRate: viewDetailCount > 0 ? Math.round(downloadCount / viewDetailCount * 100) : 0,
    topKeywords: Object.entries(keywordWeights)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([kw, weight]) => ({ keyword: kw, weight })),
    gameList,
    downloadMethods,
    recentLog: log.slice(-30).reverse()
  };
}

// 基于用户偏好标签的 Steam 推荐
async function handleGetSteamRecommendations() {
  const kwData = await dataStore.readModule(DB_KEYS.KEYWORD_WEIGHTS);
  const weights = kwData || {};
  const topTags = Object.entries(weights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([kw]) => kw);

  if (topTags.length === 0) {
    return { games: [], message: '还没有足够的学习数据，请先浏览一些游戏网站' };
  }

  try {
    const recGames = [];
    for (const tag of topTags.slice(0, 3)) {
      const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(tag)}&l=schinese&cc=cn`;
      const resp = await fetchWithTimeout(searchUrl);
      const data = await resp.json();

      if (data.total > 0 && data.items) {
        for (const item of data.items.slice(0, 4)) {
          if (recGames.some(g => g.appId === item.id)) continue;

          let detail = null;
          try {
            const detUrl = `https://store.steampowered.com/api/appdetails?appids=${item.id}&l=schinese&filters=basic,price_overview`;
            const detResp = await fetchWithTimeout(detUrl);
            const detData = await detResp.json();
            if (detData[item.id]?.success) {
              detail = detData[item.id].data;
            }
          } catch (e) {}

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
      if (recGames.length >= 9) break;
    }

    return { games: recGames.slice(0, 9), basedOnTags: topTags };
  } catch (e) {
    console.error('Steam推荐失败:', e);
    return { games: [], error: '获取Steam推荐失败: ' + e.message };
  }
}

// --- 数据清除 / Data clearing ---
async function handleClearData() {
  await Promise.all([
    dataStore.removeModule(DB_KEYS.BEHAVIOR_LOG),
    dataStore.removeModule(DB_KEYS.GAME_PROFILES),
    dataStore.removeModule(DB_KEYS.KEYWORD_WEIGHTS),
    dataStore.removeModule(DB_KEYS.STEAM_CACHE),
    dataStore.removeModule(DB_KEYS.GAME_REGISTRY),
    dataStore.removeModule(DB_KEYS.NAME_INDEX),
    dataStore.removeModule(DB_KEYS.DOWNLOAD_URLS)
  ]);
  await chrome.storage.local.remove(DB_KEYS.MANUAL_MAPPINGS);
  resetInMemoryCaches();
  return { success: true };
}

// --- 下载站搜索（Steam 页浮窗）---
async function handleSearchDownloadSites(message) {
  const settings = await getSettings();
  const allSites = await getDownloadSites();
  const enabledKeys = settings.steamSiteSearch || allSites.map(s => s.key);
  const sites = await searchDownloadSites(message.gameName, message.appId, enabledKeys);

  // 兜底：全部未命中且提供了 appId 时，用注册表中的官方中英文名重新搜索。
  // 处理 gameName 带站点前缀（如"Steam 上的"）或与下载站译名不同的情况。
  // Fallback: when nothing matches and an appId exists, retry with the registry's
  // official CN/EN names (handles site-prefixed names or title mismatches).
  if (sites.every(s => !s.found) && message.appId) {
    const entry = await getGameRegistryEntry(message.appId);
    const officialNames = [entry && entry.cnName, entry && entry.enName].filter(Boolean);
    const distinct = [...new Set(officialNames)].filter(n => n && n !== message.gameName);
    for (const name of distinct) {
      const retry = await searchDownloadSites(name, message.appId, enabledKeys);
      retry.forEach(r => {
        const target = sites.find(s => s.key === r.key);
        if (r.found && target && !target.found) Object.assign(target, r);
      });
      if (sites.some(s => s.found)) break;
    }
    if (sites.some(s => s.found)) {
      Logger.info('DownloadSites', `兜底重试命中: "${message.gameName}" → 注册表名重搜`);
    }
  }

  Logger.info('DownloadSites', `搜索"${message.gameName}"`, { found: sites.filter(s => s.found).map(s => s.key) });
  return { sites };
}

// --- 下载历史 ---
async function handleGetDownloadHistory(message) {
  const history = await getDownloadHistory();
  if (message.gameName) {
    return { record: history[message.gameName] || null };
  }
  return { history };
}

// 详情页访问记录（更新下载站网址缓存 lastAccessed）
async function handleTrackDownloadSiteVisit(message) {
  const data = message.data || {};
  const appId = data.appId;
  const url = data.url || '';
  if (!appId || !url) return { success: false };
  const siteInfo = inferSiteFromDomain(data.domain || '');
  if (siteInfo.key === 'unknown') return { success: false };
  await recordDownloadUrl(String(appId), siteInfo.key, siteInfo.name, url);
  return { success: true };
}

// 列表页批量记录下载页地址
async function handleRecordDownloadUrlsBatch(message) {
  const data = message.data || {};
  const siteInfo = inferSiteFromDomain(data.domain || '');
  if (siteInfo.key === 'unknown') return { success: false };
  await recordDownloadUrlsBatch(siteInfo.key, siteInfo.name, data.entries || []);
  return { success: true };
}

// --- 游戏缓存管理 / Game cache management ---
async function handleGetGameCacheList(message) {
  const keyword = (message.keyword || '').toLowerCase().trim();
  const minRating = Number(message.minRating) > 0 ? Number(message.minRating) : 0;
  const tag = (message.tag || '').trim().toLowerCase();
  const siteKey = (message.siteKey || '').trim().toLowerCase();
  const page = Math.max(1, message.page || 1);
  const pageSize = Math.max(1, Math.min(100, message.pageSize || 20));

  const registry = await getGameRegistry();
  const urlStore = await readDownloadUrlsStore();
  await loadSteamCacheToMemory();
  const steamCacheMemory = getSteamCacheMemory();

  let games = Object.entries(registry).map(([appId, entry]) => {
    const urls = {};
    for (const [sk, bucket] of Object.entries(urlStore.sites)) {
      if (bucket[appId]) urls[sk] = bucket[appId];
    }
    const primaryUrl = Object.values(urls).find(u => u && u.url) || null;
    const cachedEntry = steamCacheMemory ? steamCacheMemory.get(String(appId)) || null : null;
    const cachedData = cachedEntry ? cachedEntry.data : null;
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

  games.sort((a, b) => (b.lastConfirmed || 0) - (a.lastConfirmed || 0));

  const total = games.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const pageItems = games.slice(start, start + pageSize);

  return { games: pageItems, total, page, pageSize, totalPages };
}

async function handleDeleteGameCacheEntry(message) {
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

async function handleClearGameCache() {
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

async function handleRefreshGameCacheEntry(message) {
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

    await flushSteamCache();
    await flushNameIndex();
    await flushRegistry();

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
function countModuleItems(value) {
  if (value === undefined || value === null) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'object') return Object.keys(value).length;
  return 1;
}

async function handleGetDataModules() {
  const modules = [];
  for (const m of DATA_MODULES) {
    const value = await dataStore.readModule(m.storageKey);
    modules.push({ key: m.key, name: m.name, desc: m.desc, count: countModuleItems(value) });
  }
  return { modules };
}

async function handleExportData(message) {
  const moduleKeys = (message.moduleKeys && message.moduleKeys.length > 0)
    ? message.moduleKeys
    : DATA_MODULES.map(m => m.key);
  const modules = {};
  for (const mod of DATA_MODULES) {
    if (!moduleKeys.includes(mod.key)) continue;
    const value = await dataStore.readModule(mod.storageKey);
    if (value !== undefined) modules[mod.key] = value;
  }
  // 适配规则无用户导入时导出内置规则
  if (moduleKeys.includes('adapterRules') && modules.adapterRules === undefined) {
    modules.adapterRules = globalThis.__GAME_RECOMMENDER_SITES__ || { version: 1, sites: [] };
  }
  Logger.info('Export', `导出数据模块: ${moduleKeys.join(', ')}`);
  return {
    success: true,
    data: { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: Date.now(), modules }
  };
}

async function handleImportData(message) {
  const payload = message.data;
  if (!payload || typeof payload !== 'object') return { success: false, error: '数据格式不正确' };
  if (payload.format !== EXPORT_FORMAT) return { success: false, error: '不是有效的 Game Recommender 导出文件' };
  if (payload.version !== EXPORT_VERSION) return { success: false, error: '导出文件版本不兼容: ' + payload.version };
  if (!payload.modules || typeof payload.modules !== 'object') return { success: false, error: '导出文件缺少模块数据' };

  const moduleKeys = (message.moduleKeys && message.moduleKeys.length > 0)
    ? message.moduleKeys
    : Object.keys(payload.modules);
  try {
    const imported = [];
    for (const key of moduleKeys) {
      const mod = DATA_MODULES.find(m => m.key === key);
      if (!mod) continue;
      const value = payload.modules[key];
      if (value === undefined) continue;
      await dataStore.writeModule(mod.storageKey, value);
      imported.push(key);
    }
    resetInMemoryCaches();
    Logger.info('Import', `导入数据模块: ${imported.join(', ')}`);
    return { success: true, imported };
  } catch (e) {
    Logger.error('Import', '导入失败', e.message);
    return { success: false, error: e.message };
  }
}

// --- 消息分发映射表 / Message dispatch map ---
export const MESSAGE_HANDLERS = {
  TRACK_EVENT:            handleTrackEvent,
  GET_RECOMMENDATIONS:    handleGetRecommendations,
  SEARCH_STEAM:           handleSearchSteam,
  REFRESH_STEAM_CACHE:    handleRefreshSteamCache,
  GET_STEAM_BY_APPID:     handleGetSteamByAppId,
  SAVE_MANUAL_MAPPING:    handleSaveManualMapping,
  SEARCH_STEAM_CANDIDATES: handleSearchSteamCandidates,
  GET_STEAM_RATINGS:      handleGetSteamRatings,
  PREFETCH_STEAM_RATINGS: handlePrefetchSteamRatings,
  GET_SETTINGS:           handleGetSettings,
  SAVE_SETTINGS:          handleSaveSettings,
  RESET_SETTINGS:         handleResetSettings,
  GET_STATS:              handleGetStats,
  GET_STEAM_RECOMMENDATIONS: handleGetSteamRecommendations,
  CLEAR_DATA:             handleClearData,
  SEARCH_DOWNLOAD_SITES:  handleSearchDownloadSites,
  GET_FREE_GAMES:         async (msg) => getFreeGamesData(msg.force === true),
  CLAIM_FREE_GAME:        async (msg) => claimFreeGame(msg.gameId),
  GET_DOWNLOAD_HISTORY:   handleGetDownloadHistory,
  TRACK_DOWNLOAD_SITE_VISIT: handleTrackDownloadSiteVisit,
  RECORD_DOWNLOAD_URLS_BATCH: handleRecordDownloadUrlsBatch,
  GET_GAME_CACHE_LIST:    handleGetGameCacheList,
  DELETE_GAME_CACHE_ENTRY: handleDeleteGameCacheEntry,
  CLEAR_GAME_CACHE:       handleClearGameCache,
  REFRESH_GAME_CACHE_ENTRY: handleRefreshGameCacheEntry,
  GET_RUNTIME_LOGS:       async (msg) => ({ logs: await getRuntimeLogs(msg.limit) }),
  CLEAR_RUNTIME_LOGS:     async () => { await clearRuntimeLogs(); return { success: true }; },
  EXPORT_LOGS:            async () => ({ logs: await getRuntimeLogs() }),
  GET_DATA_MODULES:       handleGetDataModules,
  EXPORT_DATA:            handleExportData,
  IMPORT_DATA:            handleImportData,
  CREATE_BACKUP:          async (msg) => {
    const b = await createBackup(true, msg && msg.moduleKeys);
    return { success: !!b, backup: b ? { id: b.id, timestamp: b.timestamp, modules: b.modules } : null };
  },
  GET_BACKUPS:            async () => ({ backups: await getBackupList() }),
  RESTORE_BACKUP:         async (msg) => restoreBackup(msg.backupId, msg.moduleKeys),
  DELETE_BACKUP:          async (msg) => deleteBackup(msg.backupId)
};

// 消息统一入口 / Message entry
export async function handleMessage(message, sender) {
  const handler = MESSAGE_HANDLERS[message.action];
  if (handler) return await handler(message, sender);
  return { error: 'Unknown action: ' + message.action };
}
