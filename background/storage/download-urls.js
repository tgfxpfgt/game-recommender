/**
 * 游戏雷达 Game Radar - 下载站网址缓存 / Download URL Cache
 *
 * 按站点分桶存储（v2）：{ v, sites: { siteKey: { appId: entry } } }。
 * 列表页批量写入、详情页访问更新；新网址替代旧网址，30 天 TTL（设置可调）。
 * Bucketed per site (v2); batch writes from list pages, updates from detail
 * visits; new URLs replace old ones; TTL configurable in settings.
 */
import { dataStore } from '../../data/data-store.js';
import { DB_KEYS, DOWNLOAD_URLS_VERSION } from '../core/constants.js';
import { isSafeFetchUrl } from '../core/utils.js';

// v3.4.1：整个存储的读-改-写串行锁（并发 record* 调用不互相覆盖）。
// 注意 dataStore.writeModule 的串行化只保护写入本身，无法覆盖
// 读→改→写三段；这里在业务层加锁，让批量写入与详情页访问互斥。
// Module-wide read-modify-write lock (concurrent record* calls cannot
// overwrite each other; the store-level write serialization alone cannot
// cover the read→modify→write span, so we lock at the business layer)
let storeLock = Promise.resolve();
function withStoreLock(task) {
  const prev = storeLock;
  let release;
  storeLock = new Promise((res) => {
    release = res;
  });
  return prev.then(() => task()).finally(release);
}

// 读取整个存储结构（含版本校验，版本不符视为空）
// Read the whole store (version-checked; mismatches treated as empty)
// v7.0.4：内存缓存（内存换延迟——Steam 页缓存优先展示/列表页推送不再每次
// 读盘；写操作经 withStoreLock 修改同一内存引用后落盘，读写一致）
/** @type {{v: number, sites: Object}|null} */
let urlsStoreMemory = null;
export async function readDownloadUrlsStore() {
  if (urlsStoreMemory) return urlsStoreMemory;
  const store = await dataStore.readModule(DB_KEYS.DOWNLOAD_URLS);
  if (!store || store.v !== DOWNLOAD_URLS_VERSION || !store.sites) {
    urlsStoreMemory = { v: DOWNLOAD_URLS_VERSION, sites: {} };
    return urlsStoreMemory;
  }
  urlsStoreMemory = store;
  return store;
}

// 预热内存缓存（SW 启动时调用）/ warm the in-memory store
export async function warmupDownloadUrls() {
  await readDownloadUrlsStore();
}

// 清空内存缓存（导入/清除数据后调用，避免读到旧数据）
export function resetDownloadUrlsMemory() {
  urlsStoreMemory = null;
}

// 获取某 appId 的所有下载站网址（合并各站点桶；Steam 页检索缓存优先用）
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

// 记录/更新某 appId 在指定站点的详情页网址（仅操作该站点桶）
// Record/update a detail-page URL for appId at a site (site-bucket only)
/**
 * 记录/更新某 appId 在指定站点的详情页网址（可选 meta：搜索结果合并——
 * v6.4.4 起下载站网址与上次调用合并：网址缓存携带搜索元数据 + lastCalled）
 * @param {string|number} appId
 * @param {string} siteKey
 * @param {string} siteName
 * @param {string} url
 * @param {{updateDate?: string, version?: string, size?: string, panUrl?: string, panCode?: string}} [meta] - 搜索结果元数据
 */
export async function recordDownloadUrl(appId, siteKey, siteName, url, meta) {
  // 仅接受 http/https 且非内网地址（SSRF 纵深防御）
  if (!appId || !siteKey || !isSafeFetchUrl(url)) return;
  return withStoreLock(async () => {
    const store = await readDownloadUrlsStore();
    const bucket = store.sites[siteKey] || (store.sites[siteKey] = {});
    const key = String(appId);
    const existing = bucket[key];
    const now = Date.now();

    if (existing && existing.url === url) {
      existing.lastAccessed = now; // 网址未变，仅更新调用时间 / URL unchanged
      if (meta) Object.assign(existing, meta); // 合并搜索结果元数据
      existing.lastCalled = now;
    } else {
      bucket[key] = {
        url,
        siteName: siteName || siteKey,
        firstSeen: existing ? existing.firstSeen : now,
        lastRefreshed: now,
        lastAccessed: now,
        lastCalled: now, // v6.4.4：上次搜索调用时间 / last search call
        ...(meta || {})
      };
    }
    await dataStore.writeModule(DB_KEYS.DOWNLOAD_URLS, store);
  });
}

// 批量记录某站点下多个 appId 的详情页地址（列表页调用，一次读写）
// Batch-record many appIds at one site (single read + write)
export async function recordDownloadUrlsBatch(siteKey, siteName, entries) {
  if (!siteKey || !entries || entries.length === 0) return;
  return withStoreLock(async () => {
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
  });
}
