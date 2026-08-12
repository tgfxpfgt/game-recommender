/**
 * Game Recommender - 设置管理 / Settings
 *
 * 扩展配置的读取（5s 内存缓存）、保存、初始化，以及缓存 TTL 配置的动态刷新。
 * Settings read (5s in-memory cache), save, init, and cache-TTL refresh.
 */
import { dataStore } from '../../data/data-store.js';
import { isPlainObject } from './utils.js';
import { DEFAULT_SETTINGS, DB_KEYS, setTtlConfig } from './constants.js';

let settingsCache = null;
let settingsCacheTime = 0;
const SETTINGS_CACHE_TTL = 5000; // 5秒缓存

// v3.4.1：深合并——旧版本存储缺少新增嵌套字段（weights/llmConfig/cacheTtls/
// badgeVisibility 等）时自动用默认值补齐，避免设置页对 undefined 调用
// toFixed() 等崩溃；类型不一致的畸形值按默认值处理（防御坏数据）。
// Deep merge: nested keys added in newer versions are back-filled from the
// defaults so stale stored settings never crash the UI; malformed values with
// a mismatched type fall back to the default.
// v4.2.0：导出供单测（纯函数）
export function deepMergeSettings(base, stored) {
  // v4.2.0：null 存储同样回退默认（此前仅 undefined 回退，直接调用方传
  // null 会得到 null；getSettings 内部有 `|| {}` 保护，此处更健壮）
  if (!isPlainObject(base) || !isPlainObject(stored)) {
    return stored === undefined || stored === null ? base : stored;
  }
  const out = { ...base };
  for (const [k, v] of Object.entries(stored)) {
    if (v === undefined) continue;
    if (isPlainObject(base[k]) && isPlainObject(v)) {
      out[k] = deepMergeSettings(base[k], v);
    } else if (typeof v === typeof base[k] || (base[k] === undefined && v !== null)) {
      out[k] = v;
    }
    // 类型不一致：保留默认值 / type mismatch: keep the default
  }
  return out;
}

// 初始化存储与设置 / Init the data store and default settings
export async function initStorage() {
  await dataStore.init();
  const settings = await dataStore.readModule(DB_KEYS.SETTINGS);
  if (!settings) {
    await dataStore.writeModule(DB_KEYS.SETTINGS, DEFAULT_SETTINGS);
  }
  await refreshTtlConfig(); // 加载缓存 TTL 配置 / Load cache TTL config
}

// 读取设置（带缓存）/ Read settings (cached)
export async function getSettings() {
  const now = Date.now();
  if (settingsCache && (now - settingsCacheTime < SETTINGS_CACHE_TTL)) {
    return settingsCache;
  }
  const stored = await dataStore.readModule(DB_KEYS.SETTINGS);
  settingsCache = deepMergeSettings(DEFAULT_SETTINGS, stored || {});
  settingsCacheTime = now;
  return settingsCache;
}

// 保存设置（同步刷新 TTL 配置）/ Save settings (refresh TTL config)
export async function saveSettings(settings) {
  await dataStore.writeModule(DB_KEYS.SETTINGS, settings);
  settingsCache = deepMergeSettings(DEFAULT_SETTINGS, settings || {});
  settingsCacheTime = Date.now();
  await refreshTtlConfig();
}

// 从当前设置刷新缓存 TTL 配置 / Refresh cache-TTL config from settings
export async function refreshTtlConfig() {
  try {
    const s = await getSettings();
    setTtlConfig(s.cacheTtls);
  } catch { /* 使用默认值 */ }
}

// 重置设置缓存（备份恢复/导入后调用）/ Reset the settings cache
export function resetSettingsCache() {
  settingsCache = null;
}
