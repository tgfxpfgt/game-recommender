// @ts-strict
/**
 * 游戏雷达 Game Radar - 设置管理 / Settings
 *
 * 扩展配置的读取（5s 内存缓存）、保存、初始化，以及缓存 TTL 配置的动态刷新。
 * Settings read (5s in-memory cache), save, init, and cache-TTL refresh.
 */
import { dataStore } from '../../data/data-store.js';
import { isPlainObject } from './utils.js';
import { DEFAULT_SETTINGS, DB_KEYS, setTtlConfig } from './constants.js';

/** @type {import('./types.js').AppSettings|null} */
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
    // v9.7.0：undefined 与 null 一律跳过——typeof null === 'object' 会绕过
    // 下方类型判等，把对象型默认值（weights/llmConfig/badgeVisibility 等）
    // 覆盖为 null（SAVE_SETTINGS 契约只校验顶层，嵌套 null 可入库；此后
    // engine 读 settings.weights.clickRate 直接抛错，整批推荐请求失败）
    if (v === undefined || v === null) continue;
    if (isPlainObject(base[k]) && isPlainObject(v)) {
      out[k] = deepMergeSettings(base[k], v);
    } else if (typeof v === typeof base[k] || base[k] === undefined) {
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

/**
 * 读取设置（带缓存）/ Read settings (cached)
 * @returns {Promise<import('./types.js').AppSettings>} - 合并默认后的完整设置
 */
export async function getSettings() {
  const now = Date.now();
  if (settingsCache && now - settingsCacheTime < SETTINGS_CACHE_TTL) {
    return settingsCache;
  }
  const stored = await dataStore.readModule(DB_KEYS.SETTINGS);
  settingsCache = deepMergeSettings(DEFAULT_SETTINGS, stored || {});
  settingsCacheTime = now;
  return /** @type {import('./types.js').AppSettings} */ (settingsCache);
}

// v10.8 B-2：数值设置键范围表（纵深防御——前端已回默认，后台保存时二次钳制，
// 防特权调用方存入越界值；[min, max, 默认]）
// Server-side range clamps for known numeric keys (defense in depth).
const NUMERIC_RANGES = {
  ratingsBatchSize: [10, 200, 60],
  qrImageMaxKb: [512, 30720, 3072],
  uiThemeNightStart: [0, 23, 19],
  uiThemeNightEnd: [0, 23, 7],
  redTitleRating: [0, 100, 95],
  maxScanLinks: [50, 5000, 500],
  maxRuntimeLog: [50, 5000, 300],
  maxBehaviorLog: [50, 5000, 500],
  logRetentionDays: [0, 365, 7],
  maxBackups: [1, 50, 7],
  backupIntervalHours: [1, 168, 24],
  appStatDedupHours: [0, 168, 24],
  appStatDownloadCap: [10, 10000, 100],
  appStatDetailViewCap: [10, 10000, 100]
};

/**
 * 保存侧数值钳制（纯函数，可单测）——仅对已知数值键、值为有限数字时生效；
 * 非法类型/缺失键原样保留（deepMergeSettings 负责类型回退）。
 * Pure clamp applied on save; unknown keys and non-numbers pass through.
 * @param {any} settings
 * @returns {any}
 */
export function clampNumericSettings(settings) {
  if (!isPlainObject(settings)) return settings;
  const out = { ...settings };
  for (const [key, [min, max, dflt]] of Object.entries(NUMERIC_RANGES)) {
    const v = out[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    out[key] = v < min ? dflt : v > max ? dflt : v;
  }
  return out;
}

// 保存设置（同步刷新 TTL 配置）/ Save settings (refresh TTL config)
export async function saveSettings(settings) {
  const clamped = clampNumericSettings(settings); // v10.8 B-2
  await dataStore.writeModule(DB_KEYS.SETTINGS, clamped);
  settingsCache = deepMergeSettings(DEFAULT_SETTINGS, clamped || {});
  settingsCacheTime = Date.now();
  await refreshTtlConfig();
}

// v10.9：xdgrid 过滤滑块窄化持久化——内容侧 sender 门禁不允许全量 SAVE_SETTINGS，
// 此 action 只落这两个键（钳制后经 saveSettings 全流程含数值范围表）
// Narrow persistence for the float filter controls (content-safe action).
export async function saveRatingFilterCfg(enabled, minRating) {
  const s = await getSettings();
  s.enableRatingFilter = enabled === true;
  s.minSteamRatingFilter = Math.min(100, Math.max(0, Math.round(Number(minRating) || 0)));
  await saveSettings(s);
  return { success: true, enableRatingFilter: s.enableRatingFilter, minSteamRatingFilter: s.minSteamRatingFilter };
}

// 从当前设置刷新缓存 TTL 配置 / Refresh cache-TTL config from settings
export async function refreshTtlConfig() {
  try {
    const s = (await getSettings()) || { cacheTtls: {} };
    setTtlConfig(s.cacheTtls);
  } catch {
    /* 使用默认值 */
  }
}

// 重置设置缓存（备份恢复/导入后调用）/ Reset the settings cache
export function resetSettingsCache() {
  settingsCache = null;
}
