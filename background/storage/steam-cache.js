/**
 * Game Recommender - Steam 动态缓存 / Steam Dynamic Cache
 *
 * 以 appId 为键的 Steam 动态信息缓存（好评率/评论/详情）。
 * 内存 Map（read-through）+ 防抖批量写入（OPFS 文件 / storage.local 降级），
 * LRU 上限控制，写入失败不中断主流程。
 * appId-keyed dynamic Steam cache with in-memory Map (read-through) and
 * debounced batch writes; LRU-capped; write failures never abort the main flow.
 */
import { dataStore } from '../../data/data-store.js';
import {
  DB_KEYS, STEAM_CACHE_VERSION, STEAM_CACHE_WRITE_DEBOUNCE,
  STEAM_CACHE_MAX_ENTRIES, steamCacheTtlMs
} from '../core/constants.js';

let steamCacheMemory = null;        // Map: appId -> entry
let steamCacheMemoryLoaded = false;
let steamCacheWriteTimer = null;

// 判断缓存条目是否有效（版本匹配 + 未过期）/ Is a cache entry valid?
export function isSteamCacheValid(entry) {
  return entry &&
    entry.version === STEAM_CACHE_VERSION &&
    (Date.now() - entry.timestamp < steamCacheTtlMs());
}

// 加载缓存到内存（仅首次从存储读取）/ Load cache into memory (once)
export async function loadSteamCacheToMemory() {
  if (steamCacheMemoryLoaded) return;
  const stored = await dataStore.readModule(DB_KEYS.STEAM_CACHE);
  steamCacheMemory = new Map(Object.entries(stored || {}));
  steamCacheMemoryLoaded = true;
}

// 读取缓存条目 / Read a cache entry
export async function getSteamCacheEntry(cacheKey) {
  await loadSteamCacheToMemory();
  return steamCacheMemory.get(cacheKey) || null;
}

// 写入缓存条目（防抖批量落盘）/ Write a cache entry (debounced persist)
export async function setSteamCacheEntry(cacheKey, data) {
  await loadSteamCacheToMemory();
  steamCacheMemory.set(cacheKey, { data, timestamp: Date.now(), version: STEAM_CACHE_VERSION });
  scheduleSteamCacheWrite();
}

// 防抖写入 / Debounced write
function scheduleSteamCacheWrite() {
  if (steamCacheWriteTimer) clearTimeout(steamCacheWriteTimer);
  steamCacheWriteTimer = setTimeout(flushSteamCache, STEAM_CACHE_WRITE_DEBOUNCE);
}

// 强制立即写入 / Force flush
export async function flushSteamCache() {
  if (steamCacheWriteTimer) {
    clearTimeout(steamCacheWriteTimer);
    steamCacheWriteTimer = null;
  }
  if (!steamCacheMemory) return;
  cleanupSteamCacheMemory(); // 写入前清理过期和超量条目 / Purge before persisting
  try {
    await dataStore.writeModule(DB_KEYS.STEAM_CACHE, Object.fromEntries(steamCacheMemory));
  } catch (e) {
    console.error('Steam缓存写入失败:', e.message);
  }
}

// 内存清理（LRU，写入前执行）/ In-memory cleanup (LRU, before persisting)
function cleanupSteamCacheMemory() {
  if (!steamCacheMemory) return;
  const now = Date.now();
  for (const [key, entry] of steamCacheMemory) {
    if (!isSteamCacheValid(entry)) steamCacheMemory.delete(key);
  }
  if (steamCacheMemory.size > STEAM_CACHE_MAX_ENTRIES) {
    const entries = [...steamCacheMemory.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = steamCacheMemory.size - STEAM_CACHE_MAX_ENTRIES;
    for (let i = 0; i < toRemove; i++) {
      steamCacheMemory.delete(entries[i][0]);
    }
  }
}

// 获取内存 Map 引用（缓存管理页批量读取用）/ Get the in-memory Map reference
export function getSteamCacheMemory() {
  return steamCacheMemory;
}

// 删除单个缓存条目（缓存管理页删除用）/ Delete a single cache entry
export async function deleteSteamCacheEntry(appId) {
  await loadSteamCacheToMemory();
  if (steamCacheMemory) steamCacheMemory.delete(appId);
}

// 重置（备份恢复/导入/清除后调用）/ Reset
export function resetSteamCache() {
  steamCacheMemory = null;
  steamCacheMemoryLoaded = false;
  if (steamCacheWriteTimer) { clearTimeout(steamCacheWriteTimer); steamCacheWriteTimer = null; }
}
