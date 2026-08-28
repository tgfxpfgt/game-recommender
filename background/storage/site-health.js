/**
 * 游戏雷达 Game Radar - 站点适配器健康 / Site Adapter Health
 *
 * v10.0.0：聚合内容侧 SITE_ADAPTER_ALERT 上报（列表项提取为 0 = 站点疑似
 * 改版），供 dashboard 健康看板展示与规则面板自检。OPFS 持久化（防抖），
 * 上限 50 站点（按 lastAlertAt 淘汰最旧）。
 * Aggregates content-side adapter alerts (zero extractions = site redesign
 * suspected) for the dashboard health board; debounced OPFS persistence.
 */
import { dataStore } from '../../data/data-store.js';
import { DB_KEYS } from '../core/constants.js';
import { createDebouncedStore } from './debounced-store.js';

const MAX_SITES = 50;

/** @type {Record<string, {siteKey: string, host: string, alertCount: number, firstAlertAt: number, lastAlertAt: number}>|null} */
let healthMemory = null;
let healthLoaded = false;

const writer = createDebouncedStore({
  name: '站点健康',
  debounceMs: 2000,
  save: () => dataStore.writeModule(DB_KEYS.SITE_HEALTH, healthMemory || {})
});

async function load() {
  if (healthLoaded) return;
  try {
    const stored = await dataStore.readModule(DB_KEYS.SITE_HEALTH);
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) healthMemory = stored;
  } catch {
    /* 损坏数据忽略 */
  }
  healthLoaded = true;
}

// 记录一次站点告警（幂等 upsert）/ Record one site alert (idempotent upsert)
export async function recordSiteAlert(siteKey, host) {
  const key = String(siteKey || '').slice(0, 32);
  if (!key) return;
  await load();
  if (!healthMemory) healthMemory = {};
  const now = Date.now();
  const existing = healthMemory[key];
  if (existing) {
    existing.alertCount = (existing.alertCount || 0) + 1;
    existing.lastAlertAt = now;
    if (host) existing.host = String(host).slice(0, 100);
  } else {
    healthMemory[key] = {
      siteKey: key,
      host: String(host || '').slice(0, 100),
      alertCount: 1,
      firstAlertAt: now,
      lastAlertAt: now
    };
  }
  // 超限淘汰最旧 / evict oldest beyond cap
  const mem = healthMemory;
  const keys = Object.keys(mem);
  if (keys.length > MAX_SITES) {
    const sorted = keys.sort((a, b) => (mem[a].lastAlertAt || 0) - (mem[b].lastAlertAt || 0));
    for (const k of sorted.slice(0, keys.length - MAX_SITES)) delete mem[k];
  }
  writer.scheduleWrite();
}

// 读取站点健康（dashboard/规则面板自检用）/ Read site health
export async function getSiteHealth() {
  await load();
  const mem = healthMemory || {};
  const sites = Object.values(mem).sort((a, b) => (b.lastAlertAt || 0) - (a.lastAlertAt || 0));
  return { sites, total: sites.length };
}

// 重置（导入/清除数据后调用）/ Reset (after import/clear)
export function resetSiteHealth() {
  healthMemory = {};
  healthLoaded = true;
}
