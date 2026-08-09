/**
 * Game Recommender - 下载站网址缓存 / Download URL Cache
 *
 * 按站点分桶存储（v2）：{ v, sites: { siteKey: { appId: entry } } }。
 * 列表页批量写入、详情页访问更新；新网址替代旧网址，30 天 TTL（设置可调）。
 * Bucketed per site (v2); batch writes from list pages, updates from detail
 * visits; new URLs replace old ones; TTL configurable in settings.
 */
import { dataStore } from '../../data/data-store.js';
import { DB_KEYS, DOWNLOAD_URLS_VERSION } from '../core/constants.js';
import { isSafeFetchUrl } from '../core/utils.js';

// 读取整个存储结构（含版本校验，版本不符视为空）
// Read the whole store (version-checked; mismatches treated as empty)
export async function readDownloadUrlsStore() {
  const store = await dataStore.readModule(DB_KEYS.DOWNLOAD_URLS);
  if (!store || store.v !== DOWNLOAD_URLS_VERSION || !store.sites) {
    return { v: DOWNLOAD_URLS_VERSION, sites: {} };
  }
  return store;
}

// 获取某 appId 的所有下载站网址（合并各站点桶）
// Get all download-site URLs for an appId (merged across buckets)
export async function getDownloadUrls(appId) {
  if (!appId) return {};
  const store = await readDownloadUrlsStore();
  const key = String(appId);
  const result = {};
  for (const [siteKey, bucket] of Object.entries(store.sites)) {
    if (bucket[key]) result[siteKey] = bucket[key];
  }
  return result;
}

// 获取某 appId 在指定站点的网址（更新 lastAccessed）
// Get a specific site's URL for an appId (updates lastAccessed)
export async function getDownloadUrlForSite(appId, siteKey) {
  if (!appId || !siteKey) return null;
  const store = await readDownloadUrlsStore();
  const bucket = store.sites[siteKey];
  const entry = bucket ? bucket[String(appId)] : null;
  if (!entry) return null;
  entry.lastAccessed = Date.now();
  await dataStore.writeModule(DB_KEYS.DOWNLOAD_URLS, store);
  return entry;
}

// 记录/更新某 appId 在指定站点的详情页网址（仅操作该站点桶）
// Record/update a detail-page URL for appId at a site (site-bucket only)
export async function recordDownloadUrl(appId, siteKey, siteName, url) {
  // 仅接受 http/https 且非内网地址（SSRF 纵深防御）
  if (!appId || !siteKey || !isSafeFetchUrl(url)) return;
  const store = await readDownloadUrlsStore();
  const bucket = store.sites[siteKey] || (store.sites[siteKey] = {});
  const key = String(appId);
  const existing = bucket[key];
  const now = Date.now();

  if (existing && existing.url === url) {
    existing.lastAccessed = now; // 网址未变，仅更新调用时间 / URL unchanged
  } else {
    bucket[key] = {
      url,
      siteName: siteName || siteKey,
      firstSeen: existing ? existing.firstSeen : now,
      lastRefreshed: now,
      lastAccessed: now
    };
  }
  await dataStore.writeModule(DB_KEYS.DOWNLOAD_URLS, store);
}

// 批量记录某站点下多个 appId 的详情页地址（列表页调用，一次读写）
// Batch-record many appIds at one site (single read + write)
export async function recordDownloadUrlsBatch(siteKey, siteName, entries) {
  if (!siteKey || !entries || entries.length === 0) return;
  const store = await readDownloadUrlsStore();
  const bucket = store.sites[siteKey] || (store.sites[siteKey] = {});
  const now = Date.now();
  for (const entry of entries) {
    const appId = entry && entry.appId;
    const url = entry && entry.url;
    if (!appId || !isSafeFetchUrl(url)) continue;
    const key = String(appId);
    const existing = bucket[key];
    if (existing && existing.url === url) {
      existing.lastAccessed = now;
    } else {
      bucket[key] = {
        url: String(url),
        siteName: siteName || siteKey,
        firstSeen: existing ? existing.firstSeen : now,
        lastRefreshed: now,
        lastAccessed: now
      };
    }
  }
  await dataStore.writeModule(DB_KEYS.DOWNLOAD_URLS, store);
}
