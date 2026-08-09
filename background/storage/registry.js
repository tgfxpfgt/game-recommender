/**
 * Game Recommender - 游戏注册表 / Game Registry
 *
 * 以 appId 为唯一标识的游戏信息（中英文名以 Steam 官方为准、名称变体、
 * Steam 标签、封面图）。永久保留，超过重确认周期后重新从 Steam 确认。
 * 内存缓存 + 防抖批量写入。
 * appId-keyed game info (official CN/EN names, name variants, tags, cover).
 * Permanent, re-confirmed after the TTL; in-memory cache + debounced writes.
 */
import { dataStore } from '../../data/data-store.js';
import { DB_KEYS, REGISTRY_WRITE_DEBOUNCE } from '../core/constants.js';

let registryMemory = null;
let registryMemoryLoaded = false;
let registryWriteTimer = null;

// 加载注册表到内存 / Load registry into memory (once)
async function loadRegistryToMemory() {
  if (registryMemoryLoaded) return;
  const stored = await dataStore.readModule(DB_KEYS.GAME_REGISTRY);
  registryMemory = stored || {};
  registryMemoryLoaded = true;
}

// 获取整个注册表 / Get the entire registry
export async function getGameRegistry() {
  await loadRegistryToMemory();
  return registryMemory;
}

// 获取单个游戏注册条目 / Get a single registry entry
export async function getGameRegistryEntry(appId) {
  if (!appId) return null;
  const registry = await getGameRegistry();
  return registry[String(appId)] || null;
}

// 记录/更新游戏到注册表 / Record/update a game in the registry
export async function recordGameInRegistry(appId, { cnName = '', enName = '', gameName = '', tags = null, coverImage = null }) {
  if (!appId) return;
  await loadRegistryToMemory();
  const key = String(appId);
  const existing = registryMemory[key] || { firstSeen: Date.now(), names: [] };

  if (cnName) existing.cnName = cnName;
  if (enName) existing.enName = enName;

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
  scheduleRegistryWrite();
}

// 防抖写入 / Debounced write
function scheduleRegistryWrite() {
  if (registryWriteTimer) clearTimeout(registryWriteTimer);
  registryWriteTimer = setTimeout(flushRegistry, REGISTRY_WRITE_DEBOUNCE);
}

// 强制立即写入 / Force flush
export async function flushRegistry() {
  if (registryWriteTimer) { clearTimeout(registryWriteTimer); registryWriteTimer = null; }
  if (!registryMemory) return;
  try {
    await dataStore.writeModule(DB_KEYS.GAME_REGISTRY, registryMemory);
  } catch (e) {
    console.error('注册表写入失败:', e.message);
  }
}

// 重置（备份恢复/导入/清除后调用）/ Reset
export function resetRegistry() {
  registryMemory = null;
  registryMemoryLoaded = false;
  if (registryWriteTimer) { clearTimeout(registryWriteTimer); registryWriteTimer = null; }
}
