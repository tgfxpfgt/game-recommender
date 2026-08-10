/**
 * Game Recommender - 消息处理 / Message Handlers
 *
 * 所有消息类型的处理函数与分发映射表（无内部状态，全部依赖各业务模块）。
 * All message handlers and the dispatch map (stateless; delegates to modules).
 */
import { dataStore } from '../data/data-store.js';
import { DB_KEYS, DATA_MODULES, EXPORT_FORMAT, EXPORT_VERSION, DEFAULT_SETTINGS, resolveTtlMs, detailSteamCacheTtlMs } from './core/constants.js';
import { getSettings, saveSettings } from './core/settings.js';
import { resetInMemoryCaches } from './core/reset.js';
import { getDownloadSites, saveAdapterRules, deleteAdapterRules, getAllRules } from './core/rules.js';
import { Logger, getRuntimeLogs, clearRuntimeLogs } from './storage/logger.js';
import { collectExpiredSteamCache, collectExpiredNegativeNames, collectExpiredDownloadUrls } from './storage/cleanup.js';
import {
  flushSteamCache, getSteamCacheEntry, setSteamCacheEntry,
  deleteSteamCacheEntry, getSteamCacheMemory, loadSteamCacheToMemory,
  isModuleValid, getModuleData, getMergedData, latestModuleTs
} from './storage/steam-cache.js';
import { flushRegistry, getGameRegistry, getGameRegistryEntry, recordGameInRegistry } from './storage/registry.js';
import {
  flushNameIndex, recordNameIndex, lookupAppIdByName, deleteNameIndexEntries, deleteNameIndexEntry
} from './storage/name-index.js';
import { readDownloadUrlsStore, recordDownloadUrl, recordDownloadUrlsBatch, getDownloadUrls } from './storage/download-urls.js';
import { addBehaviorLog, updateGameProfile, maybeUpdatePreferences, getBehaviorLog } from './storage/behavior.js';
import { createBackup, getBackupList, restoreBackup, deleteBackup } from './storage/backups.js';
import { getDownloadHistory, recordDownloadHistory, inferSiteFromDomain } from './storage/history.js';
import { recordWrongReport, flushWrongReports } from './storage/wrong-reports.js';
import { searchSteamGame, getSteamPositiveRate, getSteamRatingsFromCacheOnly } from './steam/orchestrator.js';
import { handleGetSteamRatings, handlePrefetchSteamRatings } from './steam/ratings-batch.js';
import { searchSteamAppId, fetchSteamFullDetailsByAppId, scanAndHealRegistry, isCompleteCacheData, namesRelated } from './steam/api.js';
import { parseGameTitle } from './steam/title-parser.js';
import { calculateRecommendation, computeGameScore, findProfile } from './recommend/engine.js';
import { searchDownloadSites, extractDetailMeta } from './sites/search.js';
import { getFreeGamesData, claimFreeGame } from './freegames/manager.js';
import { fetchWithTimeout } from './core/utils.js';
import { getSteamApiStatus } from './core/api-monitor.js';

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
  // 返回缓存时间戳供详情页浮窗显示"缓存于 xx 分钟前"（模块化：取最近模块时间）
  const cachedEntry = steamResult ? await getSteamCacheEntry(steamResult.appId) : null;
  return { data: steamResult, cachedAt: cachedEntry ? latestModuleTs(cachedEntry) : null };
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
  return { data: steamResult, cachedAt: cachedEntry ? latestModuleTs(cachedEntry) : null };
}

// 直接通过 appId 获取 Steam 详情（绕过名称搜索；图片 URL 含 appId 时使用）
// v3.3.7：缓存命中要求"detail 模块未过期（详情页独立 TTL）+ 数据完整"——
// 仅 detail 过期时重新获取详情，meta/rating/spy 模块保留（部分刷新）。
// v3.3.14：图片提取的 appId 可能与页面标题无关（gamer520 侧边推荐图是 Steam
// CDN 封面，会被全页图提取误取）——有 gameName 时校验名称相关性，不相关
// 拒绝并转标题搜索；manual=true（手动选择候选）跳过校验（用户主动确认）。
async function handleGetSteamByAppId(message) {
  const appId = message.appId;
  const gameName = message.gameName || '';
  const manual = message.manual === true;

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
    return { data: result, cachedAt: newEntry ? latestModuleTs(newEntry) : null };
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
  // v3.3.13：手动选择 = 用户确认正确 appid → 记录为纠正知识（长期有效）
  await recordWrongReport(gameName, { correctAppId: appId, source: 'manual' });
  await flushWrongReports();
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
      const result = await searchSteamAppId([term], term);
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
// v3.4.0：语义统一——"清除学习数据"同时删除 learnedNoise 存储（此前仅清
// 内存、存储保留导致下次加载恢复）；wrongReports（人工纠正知识库）为有意
// 保留的长期数据，不随本操作删除。
async function handleClearData() {
  await Promise.all([
    dataStore.removeModule(DB_KEYS.BEHAVIOR_LOG),
    dataStore.removeModule(DB_KEYS.GAME_PROFILES),
    dataStore.removeModule(DB_KEYS.KEYWORD_WEIGHTS),
    dataStore.removeModule(DB_KEYS.STEAM_CACHE),
    dataStore.removeModule(DB_KEYS.GAME_REGISTRY),
    dataStore.removeModule(DB_KEYS.NAME_INDEX),
    dataStore.removeModule(DB_KEYS.DOWNLOAD_URLS),
    dataStore.removeModule(DB_KEYS.LEARNED_NOISE)
  ]);
  await chrome.storage.local.remove(DB_KEYS.MANUAL_MAPPINGS);
  resetInMemoryCaches();
  return { success: true };
}

// --- 适配规则管理（v3.0.0 规则编辑器支撑）---
async function handleGetAdapterRules() {
  // 编辑器渲染：内置 / 已导入 / 生效合并规则
  return await getAllRules();
}

async function handleSaveAdapterRules(message) {
  // 后台二次校验：仅接受纯数据 JSON（白名单字段/拒绝函数/规模上限）
  const result = await saveAdapterRules(message && message.rules);
  if (result.ok) {
    Logger.info('Rules', `保存适配规则: ${result.rules.sites.length} 个站点`);
  } else {
    Logger.warn('Rules', `保存适配规则失败: ${result.error}`);
  }
  return result;
}

async function handleDeleteAdapterRules() {
  // 删除用户导入规则，恢复内置规则
  await deleteAdapterRules();
  Logger.info('Rules', '删除导入规则，恢复内置规则');
  return { ok: true };
}

// 强制刷新页面（popup 按钮）：清除当前页游戏的 Steam 缓存与名称索引
// （含负缓存），页面重载后全部重新从 Steam 获取——忽视缓存有效期与
// 0 评测冷却。Force-refresh (popup button): clear this page's Steam cache
// and name-index entries (negative ones included); the reload then fetches
// everything fresh from Steam, ignoring cache TTLs and the zero-review cooldown.
async function handleClearCacheForPage(message) {
  const names = message.names || [];
  const appIds = message.appIds || [];
  const seen = new Set();
  let cleared = 0;
  for (const id of appIds) {
    const key = String(id);
    if (!seen.has(key)) { seen.add(key); await deleteSteamCacheEntry(key); cleared++; }
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
async function handleCacheSteamPage(message) {
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
    Logger.warn('Steam', `Steam 商品页缓存预取失败: appId ${appId}`, e.message);
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
async function handleReportWrongAppId(message) {
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
async function handleCleanExpiredCache() {
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
async function handleHealRegistryNames(message) {
  const result = await scanAndHealRegistry(Math.min(50, message && message.limit || 20));
  Logger.info('Steam', `名称批量自愈: 扫描 ${result.scanned} 条, 修复 ${result.healed} 条, 剩余 ${result.remaining} 条`);
  return result;
}

// --- Steam API 状态监测（v3.3.0）---
async function handleGetApiStatus() {
  return getSteamApiStatus();
}

// --- 下载站搜索（Steam 页浮窗）---
async function handleSearchDownloadSites(message) {
  const settings = await getSettings();
  const allSites = await getDownloadSites();
  const enabledKeys = settings.steamSiteSearch || allSites.map(s => s.key);
  const sites = await searchDownloadSites(message.gameName, message.appId, enabledKeys);

  // 兜底 1：缓存优先。全部未命中且提供 appId 时，优先使用下载站网址缓存
  // （列表页/详情页访问时已记录 appId → 下载页地址）。解决英文官方名与中文站
  // 标题跨语言不匹配导致的漏检（如 Gothic 1 Remake → 哥特王朝 重制版）。
  // Fallback 1: the download-URL cache (recorded from list/detail visits) — it
  // bridges cross-language mismatches between EN official names and CN titles.
  if (sites.every(s => !s.found) && message.appId) {
    const cached = await getDownloadUrls(message.appId);
    for (const s of sites) {
      const entry = cached[s.key];
      if (entry && entry.url) {
        s.found = true;
        s.detailUrl = entry.url;
        // 顺带刷新详情页元信息（失败不影响结果）
        try {
          const dResp = await fetchWithTimeout(entry.url, { headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' } });
          if (dResp.ok) {
            const meta = extractDetailMeta(await dResp.text(), s.key);
            Object.assign(s, { updateDate: meta.updateDate, version: meta.version, size: meta.size, panUrl: meta.panUrl, panCode: meta.panCode });
          }
        } catch (e) { /* 元信息失败忽略 */ }
      }
    }
    if (sites.some(s => s.found)) {
      Logger.info('DownloadSites', `缓存命中: "${message.gameName}" (appId ${message.appId}) 下载站网址缓存直接返回`);
    }
  }

  // 兜底 2：全部未命中且提供了 appId 时，用注册表中的官方中英文名与
  // 下载站标题变体重新搜索（跨语言桥接）。
  // Fallback 2: retry with the registry's official CN/EN names AND download-site
  // title variants (cross-language bridge).
  if (sites.every(s => !s.found) && message.appId) {
    const entry = await getGameRegistryEntry(message.appId);
    const officialNames = [...new Set([
      entry && entry.cnName, entry && entry.enName, ...(entry && entry.names || [])
    ].filter(Boolean))].filter(n => n && n !== message.gameName);
    for (const name of officialNames) {
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
    dataStore.readModule(DB_KEYS.GAME_PROFILES).then(v => v || {}),
    dataStore.readModule(DB_KEYS.KEYWORD_WEIGHTS).then(v => v || {})
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
    const rec = computeGameScore({
      profile,
      globalStats,
      tags: entry.tags || null,
      keywordWeights,
      positiveRate: (cachedData && cachedData.positiveRate !== undefined) ? cachedData.positiveRate : null,
      chineseSupported: cachedData ? !!cachedData.chineseSupported : false,
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
  // v3.4.0：密钥安全——导出/备份默认剔除 API 密钥（备份文件流转不再泄露
  // 凭据；导入/恢复后原密钥保留、提示重输）
  if (modules.settings) {
    const s = { ...modules.settings };
    if (s.llmConfig) s.llmConfig = { ...s.llmConfig, apiKey: '' };
    if (s.steamApiKey) s.steamApiKey = '';
    modules.settings = s;
  }
  // 适配规则无用户导入时导出内置规则
  if (moduleKeys.includes('adapterRules') && modules.adapterRules === undefined) {
    modules.adapterRules = globalThis.__GAME_RECOMMENDER_SITES__ || { version: 1, sites: [] };
  }
  Logger.info('Export', `导出数据模块: ${moduleKeys.join(', ')}（API 密钥已剔除）`);
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
  DELETE_BACKUP:          async (msg) => deleteBackup(msg.backupId),
  GET_ADAPTER_RULES:      handleGetAdapterRules,
  SAVE_ADAPTER_RULES:     handleSaveAdapterRules,
  DELETE_ADAPTER_RULES:   handleDeleteAdapterRules,
  CLEAN_EXPIRED_CACHE:    handleCleanExpiredCache,
  CLEAR_CACHE_FOR_PAGE:   handleClearCacheForPage,
  CACHE_STEAM_PAGE:       handleCacheSteamPage,
  REPORT_WRONG_APPID:     handleReportWrongAppId,
  HEAL_REGISTRY_NAMES:    handleHealRegistryNames,
  GET_API_STATUS:         handleGetApiStatus
};

// 消息统一入口 / Message entry
export async function handleMessage(message, sender) {
  const handler = MESSAGE_HANDLERS[message.action];
  if (handler) return await handler(message, sender);
  return { error: 'Unknown action: ' + message.action };
}
