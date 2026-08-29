/**
 * 游戏雷达 Game Radar - AppID 维度行为统计 / Per-AppId Behavior Stats
 *
 * v10.1.0：按 appId 聚合的跨站点行为计数——a = 下载次数（click_download），
 * b = 详情页打开次数（TRACK_DOWNLOAD_SITE_VISIT）。不同下载站的行为都
 * 聚合到同一 appId（统计键只有 appId，天然跨站）。永不过期（无 TTL、
 * 不参与清理），防抖 OPFS 落盘 + 读-改-写串行锁（同 download-urls 模式）。
 * 用途：列表页 "a-b" 徽章 + 推荐引擎信号（a>0 正向；a=0 且 b>0 负向——
 * 只看不下 = 负信号，b 越大越不推荐）。
 *
 * v10.2.0：防重复计数——同一 appId 在**同一站点** 24h 内重复下载/重复打开
 * 详情页不重复计数；**跨站点分别计数**（xdgame 打开详情页 b+1，再打开
 * xianyudanji 的 b 再 +1）。去重键 = appId + 站点 + 24h 窗口；站点键来自
 * 事件 domain（未识别站点用 domain 本身，各自独立去重）。
 * Per-appId cross-site counters with dedup: repeating the same action on the
 * same site within 24h does not count again; a different site counts afresh.
 */
import { dataStore } from '../../data/data-store.js';
import { DB_KEYS } from '../core/constants.js';
import { createDebouncedStore } from './debounced-store.js';
import { bumpDataVersion } from './behavior.js'; // v10.1.0：统计变化推进数据版本（推荐缓存失效）
import { getSettings } from '../core/settings.js'; // v10.3.0：开关与去重窗口可配置

// 上限（防无界膨胀；按 updatedAt 最旧淘汰——正常使用远达不到）
const APP_STATS_MAX_ENTRIES = 20000;
// v10.2.0：同站点去重窗口默认值（24h；v10.3.0 起可由 settings.appStatDedupHours 覆盖）
export const DEDUP_WINDOW_MS = 24 * 3600 * 1000;

// v10.3.0：总开关（settings.appStatsEnabled，默认开）——关闭后不计数、
// 徽章无数据不渲染、推荐信号回中性，互不影响其他功能
async function isEnabled() {
  try {
    const settings = await getSettings();
    return settings.appStatsEnabled !== false;
  } catch {
    return true;
  }
}

// v10.3.0：去重窗口（settings.appStatDedupHours 小时；0 = 关闭去重每次都计）
async function dedupWindowMs() {
  try {
    const settings = await getSettings();
    const hours = Number(settings.appStatDedupHours);
    if (!Number.isFinite(hours) || hours <= 0) return 0;
    return hours * 3600 * 1000;
  } catch {
    return DEDUP_WINDOW_MS;
  }
}
// 每条目的站点去重表上限（LRU 淘汰最旧站点；站点总数远小于此）
const SITES_PER_ENTRY_MAX = 24;

/** @type {Record<string, {downloads: number, detailViews: number, updatedAt: number, dlSites: Object, viewSites: Object}>|null} */
let statsMemory = null;
let statsLoaded = false;

const writer = createDebouncedStore({
  name: 'AppID 行为统计',
  debounceMs: 2000,
  save: () => dataStore.writeModule(DB_KEYS.APP_STATS, statsMemory || {})
});

// 读-改-写串行锁（并发递增不互相覆盖）/ RMW lock (concurrent increments)
let statsLock = Promise.resolve();
function withStatsLock(task) {
  const prev = statsLock;
  let release;
  statsLock = new Promise((res) => {
    release = res;
  });
  return prev.then(() => task()).finally(release);
}

async function load() {
  if (statsLoaded) return;
  try {
    const stored = await dataStore.readModule(DB_KEYS.APP_STATS);
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) statsMemory = stored;
  } catch {
    /* 损坏数据按空处理 */
  }
  statsLoaded = true;
}

function enforceLimit() {
  if (!statsMemory) return;
  const mem = statsMemory;
  const keys = Object.keys(mem);
  if (keys.length <= APP_STATS_MAX_ENTRIES) return;
  const sorted = keys.sort((a, b) => (mem[a].updatedAt || 0) - (mem[b].updatedAt || 0));
  for (const k of sorted.slice(0, keys.length - APP_STATS_MAX_ENTRIES)) delete mem[k];
}

// 站点去重表 LRU 淘汰（超限时删最旧时间戳的站点）/ evict oldest site keys
function enforceSiteLimit(siteMap) {
  const keys = Object.keys(siteMap);
  if (keys.length <= SITES_PER_ENTRY_MAX) return;
  const sorted = keys.sort((a, b) => (siteMap[a] || 0) - (siteMap[b] || 0));
  for (const k of sorted.slice(0, keys.length - SITES_PER_ENTRY_MAX)) delete siteMap[k];
}

/**
 * v10.2.0：带去重的计数（field: 'downloads' | 'detailViews'）
 * 同 appId + 同站点 + 24h 内重复 → 不计数（返回 false）；跨站点分别计数。
 * Deduped increment: same app+site within the window is a no-op; a different
 * site counts afresh (per-site maps live on the entry, never expire).
 */
async function incrementDeduped(appId, field, siteKey) {
  const key = String(appId || '').trim();
  if (!key || (field !== 'downloads' && field !== 'detailViews')) return false;
  const site = String(siteKey || 'unknown').slice(0, 64) || 'unknown';
  const siteMapKey = field === 'downloads' ? 'dlSites' : 'viewSites';
  // v10.3.0：总开关关闭 → 不计数（返回 false 与去重未命中同语义）
  if (!(await isEnabled())) return false;
  const windowMs = await dedupWindowMs();
  let counted = false;
  await withStatsLock(async () => {
    await load();
    if (!statsMemory) statsMemory = {};
    const now = Date.now();
    const entry = statsMemory[key] || {
      downloads: 0,
      detailViews: 0,
      updatedAt: 0,
      dlSites: {},
      viewSites: {}
    };
    if (!entry.dlSites) entry.dlSites = {};
    if (!entry.viewSites) entry.viewSites = {};
    const siteMap = entry[siteMapKey];
    const last = siteMap[site] || 0;
    // v10.3.0：窗口可配置；windowMs=0 表示关闭去重（每次都计数）
    if (windowMs > 0 && now - last < windowMs) return; // 同站窗口内重复 → 不计数
    siteMap[site] = now;
    enforceSiteLimit(siteMap);
    entry[field] = (entry[field] || 0) + 1;
    entry.updatedAt = now;
    statsMemory[key] = entry;
    enforceLimit();
    bumpDataVersion();
    writer.scheduleWrite();
    counted = true;
  });
  return counted;
}

// 记录一次下载（跨站点聚合到 appId；同站 24h 去重）/ Record one download
export function recordAppDownload(appId, siteKey) {
  return incrementDeduped(appId, 'downloads', siteKey);
}

// 记录一次详情页打开（跨站点分别计数）/ Record one detail-page open
export function recordAppDetailView(appId, siteKey) {
  return incrementDeduped(appId, 'detailViews', siteKey);
}

// v10.0.0 预热（SW 启动时调用）/ warm-up on SW start
export async function warmupAppStats() {
  await load();
}

/**
 * 批量读取统计（徽章/推荐引擎用）/ Batch read (badges + recommendation)
 * @param {Array<string|number>} [appIds] - 缺省返回全表
 * @returns {Promise<Record<string, {downloads: number, detailViews: number, updatedAt: number, dlSites: Object, viewSites: Object}>>}
 */
export async function getAppStats(appIds) {
  // v10.3.0：总开关关闭 → 返回空表（徽章无数据不渲染、推荐信号中性）
  if (!(await isEnabled())) return {};
  await load();
  const mem = statsMemory || {};
  if (!Array.isArray(appIds)) return mem;
  const out = {};
  for (const id of appIds) {
    const key = String(id || '');
    if (key && mem[key]) out[key] = mem[key];
  }
  return out;
}

// 重置（导入/清除数据后调用）/ Reset (after import/clear)
export function resetAppStats() {
  statsMemory = {};
  statsLoaded = true;
  writer.reset && writer.reset();
  dataStore.removeModule(DB_KEYS.APP_STATS).catch(() => {});
}
