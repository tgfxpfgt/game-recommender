/**
 * Game Recommender - 设置管理 / Settings
 *
 * 扩展配置的读取（5s 内存缓存）、保存、初始化，以及缓存 TTL 配置的动态刷新。
 * Settings read (5s in-memory cache), save, init, and cache-TTL refresh.
 */
import { dataStore } from '../../data/data-store.js';
import { DEFAULT_SETTINGS, DB_KEYS, setTtlConfig } from './constants.js';

let settingsCache = null;
let settingsCacheTime = 0;
const SETTINGS_CACHE_TTL = 5000; // 5秒缓存

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
  settingsCache = { ...DEFAULT_SETTINGS, ...(stored || {}) };
  settingsCacheTime = now;
  return settingsCache;
}

// 保存设置（同步刷新 TTL 配置）/ Save settings (refresh TTL config)
export async function saveSettings(settings) {
  await dataStore.writeModule(DB_KEYS.SETTINGS, settings);
  settingsCache = { ...DEFAULT_SETTINGS, ...settings };
  settingsCacheTime = Date.now();
  await refreshTtlConfig();
}

// 从当前设置刷新缓存 TTL 配置 / Refresh cache-TTL config from settings
export async function refreshTtlConfig() {
  try {
    const s = await getSettings();
    setTtlConfig(s.cacheTtls);
  } catch (e) { /* 使用默认值 */ }
}

// 重置设置缓存（备份恢复/导入后调用）/ Reset the settings cache
export function resetSettingsCache() {
  settingsCache = null;
}
