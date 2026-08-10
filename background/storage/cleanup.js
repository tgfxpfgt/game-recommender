/**
 * Game Recommender - 缓存过期清理 / Expired Cache Cleanup
 *
 * v3.0.0：纯函数收集三类过期条目（Steam 动态缓存 / 名称负缓存 / 下载站网址），
 * 由 handlers 组装后写回。0 = 长期有效（Infinity）时全部保留。
 * v3.3.7：Steam 缓存模块化——仅删除**所有模块均过期**的条目（部分有效的
 * 条目保留，使用中按模块 TTL 自动刷新），不再检查全局版本号。
 * Pure functions collecting expired entries across the three cache types
 * (Steam dynamic / name negative / download URLs); handlers persist the result.
 * A TTL of 0 (Infinity) keeps everything. Since v3.3.7 a Steam entry is dropped
 * only when ALL its modules are expired (partly-valid entries stay and refresh
 * per-module on use); the global version check is gone.
 */
import { DOWNLOAD_URLS_VERSION } from '../core/constants.js';
import { allModulesExpired, migrateEntry } from './steam-cache.js';

// 清理 Steam 动态缓存：所有模块均过期的条目收集并移除，返回统计。
// 模块 TTL 由各模块自身配置决定（0=长期 的模块永不视为过期）；部分有效的
// 条目保留，后续使用中按模块 TTL 自动刷新（部分刷新语义）。旧平铺结构
// 先迁移再判定——迁移后仍有效的模块不被删除（旧缓存不立即失效）。
// Purge Steam-cache entries whose modules are ALL expired. Each module's TTL
// comes from its own config (0=forever modules never expire); partly-valid
// entries stay and refresh per-module on use. Legacy flat entries are migrated
// first so their still-valid modules survive (no whole-entry invalidation).
export function collectExpiredSteamCache(entries) {
  const map = new Map(Object.entries(entries || {}));
  const now = Date.now();
  let removed = 0;
  for (const [key, entry] of map) {
    const migrated = migrateEntry(entry);
    if (allModulesExpired(migrated, now)) { map.delete(key); removed++; }
  }
  return { removed, map };
}

// 清理名称索引中的过期负缓存条目（appId=null 且超 TTL）
// Purge expired negative-cache entries in the name index (appId=null, beyond TTL)
export function collectExpiredNegativeNames(entries, ttlMs) {
  const map = new Map(Object.entries(entries || {}));
  const now = Date.now();
  let removed = 0;
  for (const [key, entry] of map) {
    const isNegative = entry && (entry.appId === null || entry.appId === undefined);
    if (!isNegative) continue;
    // 0 = 长期有效：仅清理无时间戳的异常条目；否则按 TTL 判定（无时间戳视为过期）
    const expired = ttlMs === Infinity
      ? !entry.lastSearched
      : (!entry.lastSearched || (now - entry.lastSearched >= ttlMs));
    if (expired) {
      map.delete(key);
      removed++;
    }
  }
  return { removed, map };
}

// 清理下载站网址缓存：lastRefreshed 超 TTL 的条目（空桶一并移除）
// Purge expired download-URL entries (lastRefreshed beyond TTL; empty buckets dropped)
export function collectExpiredDownloadUrls(store, ttlMs) {
  const now = Date.now();
  let removed = 0;
  const sites = {};
  for (const [siteKey, bucket] of Object.entries((store && store.sites) || {})) {
    const kept = {};
    for (const [appId, entry] of Object.entries(bucket || {})) {
      const expired = ttlMs !== Infinity && (now - (entry && entry.lastRefreshed || 0) >= ttlMs);
      if (expired) { removed++; continue; }
      kept[appId] = entry;
    }
    if (Object.keys(kept).length > 0) sites[siteKey] = kept;
  }
  const version = (store && store.v) || DOWNLOAD_URLS_VERSION;
  return { removed, store: { v: version, sites } };
}
