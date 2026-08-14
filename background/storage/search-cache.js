/**
 * 游戏雷达 Game Radar - 下载站搜索缓存 / Download-Site Search Cache
 *
 * v6.4.3：下载站搜索结果缓存（此前每次搜索逐站逐词重复请求）——搜索结果
 * 的资源页变化慢，缓存 24h 大幅减少请求。内存 Map + 变更即写 storage
 *（防 SW 休眠丢失；数据量小）。缓存 key 含 appId 区分同名游戏。
 * Download-site search results cache (24h TTL): results change slowly; the
 * cache cuts repeated per-site per-term requests. In-memory Map with
 * write-through persistence.
 */
'use strict';

import { dataStore } from '../../data/data-store.js';
import { DB_KEYS } from '../core/constants.js';

const SEARCH_CACHE_TTL = 24 * 3600e3; // 24 小时 / 24 hours
const MAX_ENTRIES = 200; // 上限裁剪（LRU 按 ts）/ LRU cap

/** @type {Map<string, {appId: string|null, siteKeys: Array<string>, results: Array<Object>, ts: number}>} */
let searchCacheMemory = new Map();
let loaded = false;

async function load() {
  if (loaded) return;
  try {
    const stored = await dataStore.readModule(DB_KEYS.SEARCH_CACHE);
    if (stored && typeof stored === 'object') {
      searchCacheMemory = new Map(Object.entries(stored));
    }
  } catch {
    /* 损坏缓存忽略，重新开始 */
  }
  loaded = true;
}

function cacheKey(gameName, appId) {
  const name = (gameName || '').toLowerCase().trim();
  return appId ? `${name}#${appId}` : name;
}

// 读取缓存（过期条目返回 null 并惰性清理）/ Read cache (expired → null)
export async function getSearchCache(gameName, appId, siteKeys) {
  await load();
  const key = cacheKey(gameName, appId);
  const entry = searchCacheMemory.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > SEARCH_CACHE_TTL) {
    searchCacheMemory.delete(key);
    return null;
  }
  // siteKeys 变更（用户自定义站点）→ 缓存失效
  const wantKeys = (siteKeys || []).slice().sort();
  const haveKeys = (entry.siteKeys || []).slice().sort();
  if (JSON.stringify(wantKeys) !== JSON.stringify(haveKeys)) return null;
  return entry.results;
}

// 写入缓存（LRU 裁剪）/ Write cache (LRU cap)
export async function setSearchCache(gameName, appId, siteKeys, results) {
  await load();
  const key = cacheKey(gameName, appId);
  searchCacheMemory.set(key, { appId: appId || null, siteKeys: siteKeys || [], results, ts: Date.now() });
  if (searchCacheMemory.size > MAX_ENTRIES) {
    const entries = [...searchCacheMemory.entries()].sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
    for (let i = 0; i < searchCacheMemory.size - MAX_ENTRIES; i++) {
      searchCacheMemory.delete(entries[i][0]);
    }
  }
  try {
    await dataStore.writeModule(DB_KEYS.SEARCH_CACHE, Object.fromEntries(searchCacheMemory));
  } catch {
    /* 写失败仅丢失缓存，不影响主流程 */
  }
}

// 清空（导入/清除数据时调用）/ Clear (on import/data clear)
export function resetSearchCache() {
  searchCacheMemory = new Map();
  loaded = false;
}
