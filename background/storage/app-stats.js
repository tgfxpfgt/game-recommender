/**
 * 游戏雷达 Game Radar - AppID 维度行为统计 / Per-AppId Behavior Stats
 *
 * v10.1.0：按 appId 聚合的跨站点行为计数——a = 下载次数（click_download），
 * b = 详情页打开次数（TRACK_DOWNLOAD_SITE_VISIT）。不同下载站的行为都
 * 聚合到同一 appId（统计键只有 appId，天然跨站）。永不过期（无 TTL、
 * 不参与清理），防抖 OPFS 落盘 + 读-改-写串行锁（同 download-urls 模式）。
 * 用途：列表页 "a-b" 徽章 + 推荐引擎信号（a>0 正向；a=0 且 b>0 负向——
 * 只看不下 = 负信号，b 越大越不推荐）。
 * Per-appId cross-site counters: a = downloads, b = detail-page opens.
 * Never expires; debounced OPFS persistence with an RMW lock.
 */
import { dataStore } from '../../data/data-store.js';
import { DB_KEYS } from '../core/constants.js';
import { createDebouncedStore } from './debounced-store.js';
import { bumpDataVersion } from './behavior.js'; // v10.1.0：统计变化推进数据版本（推荐缓存失效）

// 上限（防无界膨胀；按 updatedAt 最旧淘汰——正常使用远达不到）
const APP_STATS_MAX_ENTRIES = 20000;

/** @type {Record<string, {downloads: number, detailViews: number, updatedAt: number}>|null} */
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

// 递增一个计数（downloads | detailViews）/ Increment one counter
async function increment(appId, field) {
  const key = String(appId || '').trim();
  if (!key || (field !== 'downloads' && field !== 'detailViews')) return;
  await withStatsLock(async () => {
    await load();
    if (!statsMemory) statsMemory = {};
    const entry = statsMemory[key] || { downloads: 0, detailViews: 0, updatedAt: 0 };
    entry[field] = (entry[field] || 0) + 1;
    entry.updatedAt = Date.now();
    statsMemory[key] = entry;
    enforceLimit();
    bumpDataVersion();
    writer.scheduleWrite();
  });
}

// 记录一次下载（跨站点聚合到 appId）/ Record one download
export function recordAppDownload(appId) {
  return increment(appId, 'downloads');
}

// 记录一次详情页打开（跨站点聚合到 appId）/ Record one detail-page open
export function recordAppDetailView(appId) {
  return increment(appId, 'detailViews');
}

// v10.0.0 预热（SW 启动时调用）/ warm-up on SW start
export async function warmupAppStats() {
  await load();
}

/**
 * 批量读取统计（徽章/推荐引擎用）/ Batch read (badges + recommendation)
 * @param {Array<string|number>} [appIds] - 缺省返回全表
 * @returns {Promise<Record<string, {downloads: number, detailViews: number, updatedAt: number}>>}
 */
export async function getAppStats(appIds) {
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
