/**
 * Game Recommender - Steam 动态缓存（模块化）/ Steam Dynamic Cache (modular)
 *
 * v3.3.7 起缓存条目按**字段模块**组织，每模块独立有效期、独立刷新：
 *   entry = { modules: { meta: {data, ts}, rating: {data, ts},
 *                        detail: {data, ts}, spy: {data, ts} } }
 * 字段归属由 FIELD_MODULES 映射表决定（未来增删字段只需改映射，未知新字段
 * 默认进 detail 模块）。字段调整不再使整体缓存失效——缺失/过期的模块在后续
 * 使用中按自身 TTL 自动重新获取（部分刷新），其他模块保留。
 *
 * 旧平铺结构（{data, timestamp, version}）加载时自动迁移为模块结构，
 * 原有缓存继续使用、不立即失效。
 *
 * Since v3.3.7 cache entries are organized into field modules with per-module
 * TTLs and refresh: fields are routed by the FIELD_MODULES map (add/remove a
 * field = edit one map line; unknown fields default to the detail module).
 * Structure changes no longer invalidate whole entries — a missing/expired
 * module is refetched on use while the others stay. Legacy flat entries are
 * migrated on load and keep working.
 */
import { dataStore } from '../../data/data-store.js';
import { createDebouncedStore } from './debounced-store.js';
import { DB_KEYS, STEAM_CACHE_WRITE_DEBOUNCE, STEAM_CACHE_MAX_ENTRIES, moduleTtlMs } from '../core/constants.js';

// 字段 → 模块归属映射（v3.3.7 模块化；未知新字段默认进 detail）
// Field → module routing (modular since v3.3.7; unknown fields go to detail)
const FIELD_MODULES = {
  // meta：基础信息（几乎不变）
  appId: 'meta',
  type: 'meta',
  name: 'meta',
  englishName: 'meta',
  headerImage: 'meta',
  // rating：好评率（变化快）
  positiveRate: 'rating',
  ratingDesc: 'rating',
  totalReviews: 'rating',
  recentPositiveRate: 'rating',
  recentTotalReviews: 'rating',
  ratingRetriedAt: 'rating',
  // detail：详情页完整信息（变化慢）
  url: 'detail',
  steamdbUrl: 'detail',
  isDemo: 'detail',
  rating: 'detail',
  genres: 'detail',
  userTags: 'detail',
  chineseSupported: 'detail',
  simplifiedChinese: 'detail',
  chineseHasAudio: 'detail',
  chineseHasSubtitles: 'detail',
  releaseDate: 'detail',
  developers: 'detail',
  description: 'detail',
  lastUpdate: 'detail',
  cnRatingDesc: 'detail',
  cnPositiveRate: 'detail',
  cnTotalReviews: 'detail',
  reviews: 'detail',
  // spy：第三方补充数据（SteamSpy/SteamDB）
  steamdb: 'spy',
  steamspy: 'spy'
};
const DEFAULT_MODULE = 'detail';

// 字段归属（未知字段默认 detail）/ Field routing (default: detail)
function moduleOf(field) {
  return FIELD_MODULES[field] || DEFAULT_MODULE;
}

let steamCacheMemory = null; // Map: appId -> entry（modules 结构）
let steamCacheMemoryLoaded = false;
let steamCacheDirty = false; // 有未落盘的修改（v3.4.1：flush 无变更直接跳过）

// 判断某模块是否有效（存在且未超过该模块 TTL）
// Is one module valid? (exists and not past its own TTL)
export function isModuleValid(entry, moduleKey, ttlMs) {
  const mod = entry && entry.modules && entry.modules[moduleKey];
  if (!mod || !mod.data) return false;
  return Date.now() - (mod.ts || 0) < (ttlMs !== undefined ? ttlMs : moduleTtlMs(moduleKey));
}

// 获取模块数据（无模块返回 null）/ Get a module's data (null when absent)
export function getModuleData(entry, moduleKey) {
  const mod = entry && entry.modules && entry.modules[moduleKey];
  return (mod && mod.data) || null;
}

// 合并视图：所有模块字段合并为一个对象（兼容旧字段访问；后写的模块覆盖先写的）
// Merged view: all modules' fields combined into one object (legacy access)
export function getMergedData(entry) {
  if (!entry || !entry.modules) return null;
  let merged = null;
  for (const key of Object.keys(entry.modules)) {
    const mod = entry.modules[key];
    if (mod && mod.data && typeof mod.data === 'object') {
      merged = { ...(merged || {}), ...mod.data };
    }
  }
  return merged;
}

// 最近模块写入时间（cachedAt 展示用；无模块返回 null）
// Latest module write time (for cachedAt display; null when empty)
export function latestModuleTs(entry) {
  if (!entry || !entry.modules) return null;
  let latest = null;
  for (const key of Object.keys(entry.modules)) {
    const ts = entry.modules[key] && entry.modules[key].ts;
    if (ts && (latest === null || ts > latest)) latest = ts;
  }
  return latest;
}

// 条目是否仍有效（存在且任一模块未过期；全部过期视为无效，供清理/命中判定）
// Is the entry still usable? (any module not expired)
export function isSteamCacheValid(entry) {
  if (!entry || !entry.modules) return false;
  const now = Date.now();
  for (const key of Object.keys(entry.modules)) {
    const mod = entry.modules[key];
    if (mod && mod.data && now - (mod.ts || 0) < moduleTtlMs(key)) return true;
  }
  return false;
}

// 加载缓存到内存（首次从存储读取；旧平铺结构自动迁移为模块结构）
// Load cache into memory (once); legacy flat entries are migrated
export async function loadSteamCacheToMemory() {
  if (steamCacheMemoryLoaded) return;
  const stored = await dataStore.readModule(DB_KEYS.STEAM_CACHE);
  steamCacheMemory = new Map();
  for (const [key, entry] of Object.entries(stored || {})) {
    // v3.4.1：历史 number 键（storesearch 搜索路径写入）统一规范化为 string
    steamCacheMemory.set(String(key), migrateEntry(entry));
  }
  steamCacheMemoryLoaded = true;
}

// 迁移旧平铺结构（{data, timestamp, version}）→ 模块结构（ts = 原 timestamp）。
// 旧缓存迁移后继续使用、不立即失效（v3.3.7：字段调整不再整体失效）。
// Migrate a legacy flat entry into the modular structure (ts = old timestamp).
// Legacy entries keep working after migration (no whole-entry invalidation).
export function migrateEntry(entry) {
  if (!entry) return null;
  if (entry.modules) return entry; // 已是模块结构 / already modular
  if (entry.data && typeof entry.data === 'object') {
    const ts = entry.timestamp || Date.now();
    const modules = {};
    for (const [field, value] of Object.entries(entry.data)) {
      const key = moduleOf(field);
      modules[key] = modules[key] || { data: {}, ts };
      modules[key].data[field] = value;
    }
    return { modules };
  }
  return null;
}

// 读取缓存条目（返回模块结构）/ Read a cache entry (modular structure)
export async function getSteamCacheEntry(cacheKey) {
  await loadSteamCacheToMemory();
  return steamCacheMemory.get(String(cacheKey)) || null;
}

// 写入缓存条目（按 FIELD_MODULES 自动路由拆分到各模块；签名不变，调用方零改动）
// Write a cache entry (fields routed into modules by FIELD_MODULES; signature
// unchanged so callers stay untouched)
export async function setSteamCacheEntry(cacheKey, data) {
  await loadSteamCacheToMemory();
  cacheKey = String(cacheKey);
  const now = Date.now();
  const existing = steamCacheMemory.get(cacheKey) || { modules: {} };
  const modules = existing.modules || {};
  const nextModules = {};
  // 保留未涉及的模块（部分更新） / keep untouched modules (partial update)
  for (const key of Object.keys(modules)) nextModules[key] = modules[key];
  // 新数据按字段路由写入（每模块独立 ts） / route new fields with per-module ts
  if (data && typeof data === 'object') {
    const touched = new Set();
    for (const [field, value] of Object.entries(data)) {
      const key = moduleOf(field);
      if (!nextModules[key]) nextModules[key] = { data: {}, ts: now };
      nextModules[key].data[field] = value;
      touched.add(key);
    }
    for (const key of touched) nextModules[key].ts = now;
  }
  steamCacheMemory.set(cacheKey, { modules: nextModules });
  scheduleSteamCacheWrite();
}

// 防抖写入 / Debounced write
// v6.1.0：防抖调度收敛至工厂（flush 保留原 dirty/清理语义）
const writer = createDebouncedStore({
  name: 'Steam缓存',
  debounceMs: STEAM_CACHE_WRITE_DEBOUNCE,
  save: flushSteamCache
});

function scheduleSteamCacheWrite() {
  steamCacheDirty = true;
  writer.scheduleWrite();
}

// 强制立即写入 / Force flush
export async function flushSteamCache() {
  // v6.1.0：timer 管理收敛至工厂
  // v3.4.1：无未落盘修改时跳过整次全量序列化（批量场景每 5 批一次 flush，
  // 无脏数据时避免重复写盘）
  if (!steamCacheMemory || !steamCacheDirty) return;
  steamCacheDirty = false;
  cleanupSteamCacheMemory(); // 写入前清理过期和超量条目 / Purge before persisting
  try {
    await dataStore.writeModule(DB_KEYS.STEAM_CACHE, Object.fromEntries(steamCacheMemory));
  } catch (e) {
    console.error('Steam缓存写入失败:', e.message);
  }
}

// 内存清理（LRU，写入前执行）：仅删除**所有模块均过期**的条目——
// 部分有效的条目保留，后续使用中自动刷新过期模块（v3.3.7 部分刷新语义）
// In-memory cleanup: entries whose modules are ALL expired are dropped; partly
// valid entries stay and refresh their expired modules on use.
function cleanupSteamCacheMemory() {
  if (!steamCacheMemory) return;
  const now = Date.now();
  for (const [key, entry] of steamCacheMemory) {
    if (allModulesExpired(entry, now)) steamCacheMemory.delete(key);
  }
  if (steamCacheMemory.size > STEAM_CACHE_MAX_ENTRIES) {
    const entries = [...steamCacheMemory.entries()].sort((a, b) => {
      const ta = latestModuleTs(a[1]) || 0;
      const tb = latestModuleTs(b[1]) || 0;
      return ta - tb;
    });
    const toRemove = steamCacheMemory.size - STEAM_CACHE_MAX_ENTRIES;
    for (let i = 0; i < toRemove; i++) {
      steamCacheMemory.delete(entries[i][0]);
    }
  }
}

// 所有模块均过期？（无模块/空条目也视为过期）/ all modules expired?
export function allModulesExpired(entry, now = Date.now()) {
  if (!entry || !entry.modules) return true;
  for (const key of Object.keys(entry.modules)) {
    const mod = entry.modules[key];
    if (!mod || !mod.data) continue;
    if (now - (mod.ts || 0) < moduleTtlMs(key)) return false; // 任一模块有效
  }
  return true; // 全部过期或无任何模块
}

// 获取内存 Map 引用（缓存管理页批量读取用）/ Get the in-memory Map reference
export function getSteamCacheMemory() {
  return steamCacheMemory;
}

// 删除单个缓存条目（缓存管理页删除用）/ Delete a single cache entry
export async function deleteSteamCacheEntry(appId) {
  await loadSteamCacheToMemory();
  if (steamCacheMemory && steamCacheMemory.delete(String(appId))) {
    steamCacheDirty = true; // v3.4.1：dirty 检查下必须显式标记，否则 flush 会跳过
  }
}

// 重置（备份恢复/导入/清除后调用）/ Reset
export function resetSteamCache() {
  steamCacheMemory = null;
  steamCacheMemoryLoaded = false;
  steamCacheDirty = false;
}
