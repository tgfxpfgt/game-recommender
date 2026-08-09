/**
 * Game Recommender - 缓存过期清理 / Expired Cache Cleanup
 *
 * v3.0.0：纯函数收集三类过期条目（Steam 动态缓存 / 名称负缓存 / 下载站网址），
 * 由 handlers 组装后写回。0 = 长期有效（Infinity）时全部保留。
 * Pure functions collecting expired entries across the three cache types
 * (Steam dynamic / name negative / download URLs); handlers persist the result.
 * A TTL of 0 (Infinity) keeps everything.
 */
import { STEAM_CACHE_VERSION, DOWNLOAD_URLS_VERSION } from '../core/constants.js';

// 清理 Steam 动态缓存：过期条目（版本不符或超 TTL）收集并移除，返回统计
// Purge expired Steam-cache entries (bad version or beyond TTL)
export function collectExpiredSteamCache(entries, ttlMs) {
  const map = new Map(Object.entries(entries || {}));
  const now = Date.now();
  let removed = 0;
  for (const [key, entry] of map) {
    const expired = !entry || entry.version !== STEAM_CACHE_VERSION ||
      (ttlMs !== Infinity && (now - (entry.timestamp || 0) >= ttlMs));
    if (expired) { map.delete(key); removed++; }
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
