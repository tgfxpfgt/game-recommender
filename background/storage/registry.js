/**
 * 游戏雷达 Game Radar - 游戏注册表 / Game Registry
 *
 * 以 appId 为唯一标识的游戏信息（中英文名以 Steam 官方为准、名称变体、
 * Steam 标签、封面图）。永久保留，超过重确认周期后重新从 Steam 确认。
 * 内存缓存 + 防抖批量写入。
 * appId-keyed game info (official CN/EN names, name variants, tags, cover).
 * Permanent, re-confirmed after the TTL; in-memory cache + debounced writes.
 */
import { dataStore } from '../../data/data-store.js';
import { createDebouncedStore } from './debounced-store.js';
import { DB_KEYS, REGISTRY_WRITE_DEBOUNCE } from '../core/constants.js';
import { recordFlushFailure } from './flush-health.js'; // v10.0.0：写失败计数

/** @type {Record<string, any>} */
let registryMemory = {};
let registryMemoryLoaded = false;
// v8.2.0：注册表上限（防长期运行无界膨胀——超限按 lastConfirmed 最旧淘汰；
// 正常用户远低于此，仅极端累积触发）
const REGISTRY_MAX_ENTRIES = 10000;
function enforceRegistryLimit() {
  const keys = Object.keys(registryMemory);
  if (keys.length <= REGISTRY_MAX_ENTRIES) return;
  const sorted = keys
    .map((k) => [k, (registryMemory[k] && registryMemory[k].lastConfirmed) || 0])
    .sort((a, b) => a[1] - b[1]);
  for (const [k] of sorted.slice(0, keys.length - REGISTRY_MAX_ENTRIES)) delete registryMemory[k];
}
let registryDirty = false; // 有未落盘的修改（v3.4.1：flush 无变更直接跳过）

// 加载注册表到内存 / Load registry into memory (once)
async function loadRegistryToMemory() {
  if (registryMemoryLoaded) return;
  const stored = await dataStore.readModule(DB_KEYS.GAME_REGISTRY);
  registryMemory = stored || {};
  registryMemoryLoaded = true;
  enforceRegistryLimit();
}

// 获取整个注册表 / Get the entire registry
// v7.0.4：预热内存缓存（SW 启动时调用）
export async function warmupRegistry() {
  await loadRegistryToMemory();
}

export async function getGameRegistry() {
  await loadRegistryToMemory();
  return registryMemory;
}

// 获取单个游戏注册条目 / Get a single registry entry
/**
 * 读取注册表条目
 * @param {string|number} appId
 * @returns {Promise<Object|null>}
 */
export async function getGameRegistryEntry(appId) {
  if (!appId) return null;
  const registry = await getGameRegistry();
  return registry[String(appId)] || null;
}

// 记录/更新游戏到注册表 / Record/update a game in the registry
/**
 * 记录游戏到注册表
 * @param {string|number} appId
 * @param {{cnName?: string, enName?: string, gameName?: string, tags?: Array<string>|null, coverImage?: string|null, type?: string|null}} data
 */
export async function recordGameInRegistry(
  appId,
  { cnName = '', enName = '', gameName = '', tags = null, coverImage = null, type = null }
) {
  if (!appId) return;
  await loadRegistryToMemory();
  const key = String(appId);
  const existing =
    registryMemory[key] ||
    /** @type {{firstSeen: number, names: Array<string>, tags?: Array<string>, cnName?: string, enName?: string, coverImage?: string}} */ ({
      firstSeen: Date.now(),
      names: /** @type {Array<string>} */ ([])
    });

  if (cnName) existing.cnName = cnName;
  if (enName) existing.enName = enName;

  // Steam 条目类型（game/dlc/demo/bundle 等，管理页筛选用）
  if (type) existing.type = type;

  // 更新封面图 URL（仅 http/https，安全校验）/ Update the cover URL (http/https only)
  if (coverImage && /^https?:\/\//i.test(coverImage)) {
    existing.coverImage = coverImage;
  }

  // 更新 Steam 官方类型标签（去重合并，最多 20 个）/ Merge Steam genre tags (dedup, max 20)
  if (tags && Array.isArray(tags) && tags.length > 0) {
    existing.tags = [...new Set([...(existing.tags || []), ...tags])].slice(0, 20);
  }

  // 触发名加入名称变体（去重，最多 10 个）/ Add the triggering name to variants
  if (gameName) {
    const lower = gameName.toLowerCase().trim();
    if (lower && !existing.names.includes(lower)) {
      existing.names.push(lower);
      if (existing.names.length > 10) existing.names.shift();
    }
  }

  existing.lastConfirmed = Date.now();
  registryMemory[key] = existing;
  enforceRegistryLimit();
  scheduleRegistryWrite();
}

// 防抖写入 / Debounced write
// v6.1.0：防抖调度收敛至工厂
const writer = createDebouncedStore({
  name: '注册表',
  debounceMs: REGISTRY_WRITE_DEBOUNCE,
  save: flushRegistry
});

function scheduleRegistryWrite() {
  registryDirty = true;
  writer.scheduleWrite();
}

// 强制立即写入 / Force flush
export async function flushRegistry() {
  // v3.4.1：无未落盘修改时跳过整次全量序列化
  if (!registryMemory || !registryDirty) return;
  registryDirty = false;
  try {
    await dataStore.writeModule(DB_KEYS.GAME_REGISTRY, registryMemory);
  } catch (e) {
    // v9.7.0：写失败回滚 dirty 并重新调度（否则本批修改静默丢失且永不重试）
    registryDirty = true;
    writer.scheduleWrite();
    recordFlushFailure('registryWriteFails');
    console.error('注册表写入失败:', String(e));
  }
}

// 删除单个注册条目（缓存管理页删除用）/ Delete a single registry entry
// v9.7.0：delete 只改内存引用，必须显式置 dirty 并调度写入，否则 flush 会
// 跳过、删除在 SW 重启后"复活"（与 deleteSteamCacheEntry 同理）
export async function deleteGameRegistryEntry(appId) {
  await loadRegistryToMemory();
  if (appId && delete registryMemory[String(appId)]) {
    scheduleRegistryWrite();
  }
}

// 重置（备份恢复/导入/清除后调用）/ Reset
export function resetRegistry() {
  registryMemory = {};
  registryMemoryLoaded = false;
  registryDirty = false;
}
