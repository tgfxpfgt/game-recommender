/**
 * 游戏雷达 Game Radar - Steam 动态缓存（模块化）/ Steam Dynamic Cache (modular)
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
import { recordFlushFailure } from './flush-health.js'; // v10.0.0：写失败计数

// v10.6.0 C1：持久层拆为 4 个模块文件（meta/rating/detail/spy 各一，
// {appId: {data, ts}}），flush 只写脏模块——原单文件全量序列化在 500+ 条目
// 时单批 ~1MB（写放大，v10.4.3 实测），拆分后写量降 ~60-75%。
// 内存结构（steamCacheMemory 统一 Map）与全部读取方保持不变。
// v10.6.0 C1: persistence split into 4 per-module files; flush writes only
// dirty modules. The unified in-memory Map and all readers stay unchanged.

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
  // v10.5.3：好评/差评原始条数——列表页综合评分徽章（XDGame 同口径）与
  // 详情页内嵌信息卡共用；随 rating 模块存取与过期（按 appId 多站共享）
  positiveReviews: 'rating',
  negativeReviews: 'rating',
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

/** @type {Map<string, import('../core/types.js').SteamCacheEntry>} */
let steamCacheMemory = new Map(); // Map: appId -> entry（modules 结构）
let steamCacheMemoryLoaded = false;
let steamCacheDirty = false; // 有未落盘的修改（v3.4.1：flush 无变更直接跳过）
// v10.6.0 C1：脏模块集合（flush 只写脏模块文件）
const CACHE_PART_KEYS = {
  meta: DB_KEYS.STEAM_CACHE_META,
  rating: DB_KEYS.STEAM_CACHE_RATING,
  detail: DB_KEYS.STEAM_CACHE_DETAIL,
  spy: DB_KEYS.STEAM_CACHE_SPY
};
const CACHE_PART_NAMES = Object.keys(CACHE_PART_KEYS);
const dirtyModules = new Set();
let legacyMigrated = false; // 旧单文件已拆分（拆分完成后删除旧文件）

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
  /** @type {Object|null} */
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
  /** @type {number|null} */
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

// 加载缓存到内存（首次）：读 4 个分模块文件合并；旧单文件存在时一次性
// 拆分迁移（拆分后旧文件在 flush 成功时删除）
// Load: merge the 4 per-module files; migrate the legacy single file once.
export async function loadSteamCacheToMemory() {
  if (steamCacheMemoryLoaded) return;
  steamCacheMemory = new Map();
  // 1. 分模块文件
  const parts = await Promise.all(CACHE_PART_NAMES.map((m) => dataStore.readModule(CACHE_PART_KEYS[m])));
  CACHE_PART_NAMES.forEach((m, i) => {
    const part = parts[i];
    if (!part || typeof part !== 'object') return;
    for (const [key, mod] of Object.entries(part)) {
      if (!mod || !mod.data) continue;
      const entry = steamCacheMemory.get(String(key)) || { modules: {} };
      entry.modules[m] = mod; // {data, ts}
      steamCacheMemory.set(String(key), entry);
    }
  });
  // 2. 旧单文件迁移（一次性）：存在非空旧文件 → 拆入内存并标记全模块重写
  try {
    const legacy = await dataStore.readModule(DB_KEYS.STEAM_CACHE);
    if (legacy && typeof legacy === 'object' && Object.keys(legacy).length > 0) {
      for (const [key, entry] of Object.entries(legacy)) {
        const migrated = migrateEntry(entry);
        if (!migrated) continue;
        const id = String(key);
        const existing = steamCacheMemory.get(id) || { modules: {} };
        // 旧模块让位于分模块文件中更新的同名字段（按 ts 比较）
        for (const [m, mod] of Object.entries(migrated.modules)) {
          const cur = existing.modules[m];
          if (!cur || (mod.ts || 0) >= (cur.ts || 0)) existing.modules[m] = mod;
        }
        steamCacheMemory.set(id, existing);
      }
      legacyMigrated = true;
      steamCacheDirty = true;
      CACHE_PART_NAMES.forEach((m) => dirtyModules.add(m));
      writer.scheduleWrite(); // 拆分结果尽快落盘（flush 成功后删除旧文件）
    }
  } catch {
    /* 旧文件读取失败 → 按无旧数据处理 */
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

// 缓存命中率统计（v6.3.2 B3 可观测；v7.1.0 分模块：meta/rating/detail/spy）
// cache hit stats (global + per-module; module key recorded at read sites)
/** @type {{hits: number, misses: number, modules: Object}} */
const cacheStats = {
  hits: 0,
  misses: 0,
  modules: {
    meta: { hits: 0, misses: 0 },
    rating: { hits: 0, misses: 0 },
    detail: { hits: 0, misses: 0 },
    spy: { hits: 0, misses: 0 }
  }
};

// 读取缓存条目（返回模块结构；moduleKey 传入时按模块计数命中率）
// Read a cache entry; pass moduleKey to record per-module hit/miss.
export async function getSteamCacheEntry(cacheKey, moduleKey) {
  await loadSteamCacheToMemory();
  const entry = steamCacheMemory.get(String(cacheKey)) || null;
  if (moduleKey && cacheStats.modules[moduleKey]) {
    const m = cacheStats.modules[moduleKey];
    if (entry && entry.modules && entry.modules[moduleKey] && entry.modules[moduleKey].data) m.hits++;
    else m.misses++;
  } else {
    if (entry) cacheStats.hits++;
    else cacheStats.misses++;
  }
  return entry;
}

// 缓存命中率统计（只读快照，含分模块）/ cache hit-rate snapshot (global + modules)
export function getCacheStats() {
  return {
    hits: cacheStats.hits,
    misses: cacheStats.misses,
    modules: {
      meta: { ...cacheStats.modules.meta },
      rating: { ...cacheStats.modules.rating },
      detail: { ...cacheStats.modules.detail },
      spy: { ...cacheStats.modules.spy }
    }
  };
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
  /** @type {{meta?: Object, rating?: Object, detail?: Object, spy?: Object}} */
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
  // v10.6.0 C1：记录脏模块（flush 只写脏模块文件）
  for (const key of Object.keys(nextModules)) dirtyModules.add(key);
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
// v10.6.0 C1：只写脏模块文件（原单文件全量序列化 ~1MB/批 → 每模块子集）
export async function flushSteamCache() {
  // v6.1.0：timer 管理收敛至工厂
  // v3.4.1：无未落盘修改时跳过（批量场景无脏数据时避免重复写盘）
  if (!steamCacheMemory || !steamCacheDirty || dirtyModules.size === 0) return;
  steamCacheDirty = false;
  cleanupSteamCacheMemory(); // 写入前清理过期和超量条目 / Purge before persisting
  try {
    for (const m of dirtyModules) {
      const subset = {};
      for (const [id, entry] of steamCacheMemory) {
        const mod = entry.modules && entry.modules[m];
        if (mod && mod.data) subset[id] = mod; // {data, ts}
      }
      await dataStore.writeModule(CACHE_PART_KEYS[m], subset);
    }
    // 拆分迁移完成：删除旧单文件（一次性）
    if (legacyMigrated) {
      await dataStore.removeModule(DB_KEYS.STEAM_CACHE).catch(() => {});
      legacyMigrated = false;
    }
    dirtyModules.clear();
  } catch (e) {
    // v9.7.0：写失败回滚 dirty 并重新调度——此前 dirty 已清零，本批修改
    // 会随 SW 死亡静默丢失且永不重试（参照 logger.js flushLogBuffer 的回滚）
    steamCacheDirty = true;
    writer.scheduleWrite();
    recordFlushFailure('steamCacheWriteFails');
    console.error('Steam缓存写入失败:', String(e));
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
    CACHE_PART_NAMES.forEach((m) => dirtyModules.add(m)); // v10.6.0：条目从所有模块文件移除
  }
}

// 重置（备份恢复/导入/清除后调用）/ Reset
export function resetSteamCache() {
  steamCacheMemory = new Map();
  steamCacheMemoryLoaded = false;
  steamCacheDirty = false;
  dirtyModules.clear();
  legacyMigrated = false;
}
