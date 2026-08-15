// @ts-strict
/**
 * 游戏雷达 Game Radar - 详情页网址索引 / Detail-URL AppID Index
 *
 * v7.0.2：详情页网址 → appId 映射——**网址作为检索的第一候选**。
 * 列表页与详情页此前走两条独立匹配路径（标题搜索 + 封面直取），同一
 * 网址可能对应不同 appId；本索引统一两条路径：任何一侧匹配成功后记录
 * URL → appId，另一侧查询时优先按 URL 命中（不再重新搜索）。
 * 内存 Map + 防抖写穿持久化（与 steam-cache 同模式）。
 *
 * Detail-page URL → appId index used as the FIRST lookup candidate on both
 * list and detail pages, unifying the two independent match paths.
 */
import { dataStore } from '../../data/data-store.js';
import { DB_KEYS } from '../core/constants.js';
import { createDebouncedStore } from './debounced-store.js';

/** @type {Record<string, string|number>} */
let urlIndexMemory = {};
let loaded = false;

async function load() {
  if (loaded) return;
  try {
    const stored = await dataStore.readModule(DB_KEYS.URL_APPID_INDEX);
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      urlIndexMemory = stored;
    }
  } catch {
    /* 损坏缓存忽略 */
  }
  loaded = true;
}

const writer = createDebouncedStore({
  name: '网址索引',
  debounceMs: 2000,
  save: () => dataStore.writeModule(DB_KEYS.URL_APPID_INDEX, urlIndexMemory)
});

// 规范化详情页 URL（去掉 hash/query 尾参——同一页面对应同一缓存）
function normalizeUrl(url) {
  const u = String(url || '');
  return u.split('#')[0].split('?')[0];
}

// v7.0.4：预热内存缓存（SW 启动时调用）
export async function warmupUrlIndex() {
  await load();
}

// 按网址查 appId（第一候选；无记录返回 null）
export async function getAppIdByUrl(url) {
  const key = normalizeUrl(url);
  if (!key) return null;
  await load();
  return urlIndexMemory[key] ?? null;
}

// 记录网址 → appId（防抖落盘）
export async function setUrlAppId(url, appId) {
  const key = normalizeUrl(url);
  if (!key || appId === null || appId === undefined) return;
  await load();
  urlIndexMemory[key] = appId;
  writer.scheduleWrite();
}

// 清空（导入/清除数据时调用）
export function resetUrlIndex() {
  urlIndexMemory = {};
  loaded = false;
  writer.reset && writer.reset();
}
