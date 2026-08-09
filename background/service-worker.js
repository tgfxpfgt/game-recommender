/**
 * Game Recommender - Background Service Worker
 * 负责数据管理、Steam API调用、推荐计算协调
 *
 * 代码结构：
 *   1. 常量与配置
 *   2. 存储管理
 *   3. Steam 缓存工具
 *   4. 运行日志
 *   5. 自动备份
 *   6. 行为日志与游戏画像
 *   7. 用户偏好模型
 *   8. 游戏标题解析
 *   9. Steam API 子模块（搜索/详情/HTML解析/评测/SteamDB/SteamSpy）
 *  10. Steam API 编排器（searchSteamGame / getSteamPositiveRate）
 *  11. 推荐算法引擎
 *  12. 下载站搜索
 *  13. 限免游戏
 *  14. 消息处理（handler map）
 *  15. 初始化
 */

// ============ 1. 常量与配置 / Constants & Config ============

// 下载站适配规则来自 adapters/sites.js（规则文件化，便于分享和移植）。
// 副作用导入：执行后规则可通过 globalThis.__GAME_RECOMMENDER_SITES__ 读取。
// Download-site adapter rules come from adapters/sites.js (rules-as-files for
// easy sharing and porting). Side-effect import: rules are then available via
// globalThis.__GAME_RECOMMENDER_SITES__.
import '../adapters/sites.js';

// 请求目标校验：仅允许 http/https，且拒绝 localhost、环回、私有与保留地址。
// 防止外部数据（下载站链接、用户配置）诱导扩展请求内网资源（SSRF 防护）。
// Request-target validation: only http/https, rejecting localhost, loopback,
// private and reserved addresses, so external data can never make the extension
// probe internal networks (SSRF protection).
function isSafeFetchUrl(url) {
  if (typeof url !== 'string') return false;
  let parsed;
  try { parsed = new URL(url); } catch (e) { return false; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    // IPv4：排除环回/私有/保留段 / IPv4: exclude loopback/private/reserved ranges
    const octets = host.split('.').map(Number);
    const a = octets[0];
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && octets[1] >= 64 && octets[1] <= 127) return false; // CGNAT
    if (a === 169 && octets[1] === 254) return false; // link-local
    if (a === 172 && octets[1] >= 16 && octets[1] <= 31) return false;
    if (a === 192 && octets[1] === 168) return false;
    if (a === 198 && (octets[1] === 18 || octets[1] === 19)) return false;
    if (a >= 224) return false; // 组播/保留 / multicast/reserved
  } else if (host === '::1' || host.startsWith('::ffff:')) {
    return false;
  }
  return true;
}

// 带超时且经过安全校验的 fetch：
// - options.allowPrivateHosts = true 时跳过私有地址校验（仅用于用户显式配置的
//   本地 LLM 端点，如 Ollama 的 http://localhost:11434）
// 防止 Steam/SteamDB 等外部 API 挂起拖垮 Service Worker。
// Fetch with timeout + safety validation:
// - options.allowPrivateHosts = true skips the private-address check (used only
//   for user-configured local LLM endpoints such as Ollama on localhost:11434)
// Prevents external APIs (Steam/SteamDB) from hanging the SW.
const FETCH_DEFAULT_TIMEOUT = 15000; // 15s
function fetchWithTimeout(url, options = {}, timeout = FETCH_DEFAULT_TIMEOUT) {
  // 私有/环回地址校验（默认拒绝）；allowPrivateHosts 例外仅限 http(s) 协议
  // Private/loopback check (rejected by default); the allowPrivateHosts exception
  // still requires an http(s) scheme
  const allowPrivate = !!(options && options.allowPrivateHosts === true && /^https?:\/\//i.test(String(url)));
  if (!isSafeFetchUrl(url) && !allowPrivate) {
    return Promise.reject(new Error('blocked-url: ' + String(url).substring(0, 80)));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// 下载站配置：从规则文件构建，仅包含配置了站内搜索的站点
// Download-site config: built from the rules file; only sites with in-site search
const DOWNLOAD_SITES = (globalThis.__GAME_RECOMMENDER_SITES__?.sites || [])
  .filter(s => s.searchUrl)
  .map(s => ({
    key: s.key,
    name: s.name,
    searchUrl: q => s.searchUrl.replace('{q}', encodeURIComponent(q)),
    base: s.base
  }));

const DB_KEYS = {
  BEHAVIOR_LOG: 'behaviorLog',
  GAME_PROFILES: 'gameProfiles',
  USER_PREFERENCES: 'userPrefs',
  SETTINGS: 'settings',
  STEAM_CACHE: 'steamCache',
  KEYWORD_WEIGHTS: 'keywordWeights',
  FREE_GAMES: 'freeGames',
  RUNTIME_LOG: 'runtimeLog',
  BACKUPS: 'backups',
  DOWNLOAD_HISTORY: 'downloadHistory',
  MANUAL_MAPPINGS: 'manualMappings', // 旧版手动映射（兼容保留，新逻辑改用 NAME_INDEX）
  // === 新三层缓存（v5：以 appId 为唯一标识）/ New 3-layer cache (v5: appId-keyed) ===
  GAME_REGISTRY: 'gameRegistry', // appId → {cnName, enName, names[], firstSeen, lastConfirmed} 永久，30天重确认
  NAME_INDEX: 'nameIndex',       // name_lower → {appId, lastSearched} 名称反查 appId 的索引
  DOWNLOAD_URLS: 'downloadUrls'  // appId → {siteKey → {url, siteName, firstSeen, lastRefreshed, lastAccessed}} 30天有效
};

const DEFAULT_SETTINGS = {
  enabled: true,
  showDebugPanel: false,
  highlightThreshold: 0.6,
  maxBehaviorLog: 500,
  steamApiKey: '',
  useLLM: false,
  llmConfig: {
    provider: 'local',
    endpoint: 'http://localhost:11434/api/generate',
    apiKey: '',
    model: 'qwen2.5:7b',
    temperature: 0.3
  },
  weights: {
    clickRate: 0.2,
    downloadRate: 0.35,
    keywordMatch: 0.25,
    steamRating: 0.2
  },
  trackedSites: [
    '3dmgame.com', 'ali213.net', 'gamersky.com', 'yystv.cn',
    'fitgirl-repacks.site', 'rutracker.org',
    'gamer520.com', 'xianyudanji.gg', 'xdgame.com'
  ],
  enableLog: true,
  maxRuntimeLog: 300,
  autoBackup: true,
  backupIntervalHours: 24,
  maxBackups: 7,
  minSteamRatingFilter: 0, // 列表页最低Steam好评率过滤（0-100，0表示不过滤）
  enableRatingFilter: false, // 是否启用好评率过滤
  enableVmFilter: false, // 是否启用虚拟机标题过滤（隐藏标题含"虚拟机板""虚拟机"的游戏）
  vmFilterKeywords: ['虚拟机板', '虚拟机'], // 虚拟机过滤关键词列表（标题命中任一即过滤）
  steamSiteSearch: ['xdgame', 'xianyudanji', 'gamer520'] // Steam详情页检索的下载站（可自定义勾选）
};

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const BACKUP_DATA_KEYS = [
  DB_KEYS.BEHAVIOR_LOG,
  DB_KEYS.GAME_PROFILES,
  DB_KEYS.USER_PREFERENCES,
  DB_KEYS.SETTINGS,
  DB_KEYS.KEYWORD_WEIGHTS,
  DB_KEYS.FREE_GAMES,
  DB_KEYS.GAME_REGISTRY,   // 游戏注册表（中英文名映射，永久）
  DB_KEYS.NAME_INDEX,      // 名称→appId 反查索引
  DB_KEYS.DOWNLOAD_URLS    // 下载站详情页网址缓存
];

// Steam缓存版本号（匹配逻辑变更时递增，使旧缓存自动失效）
// v4: TTL 从 7 天改为 24 小时，配合内存缓存与防抖批量写入优化
// v5: 缓存键从"游戏名小写"改为"appId"，统一以 appId 为唯一标识；
//     新增 GAME_REGISTRY（永久，30天重确认）和 DOWNLOAD_URLS（30天有效）两层缓存
const STEAM_CACHE_VERSION = 5;
// Steam 缓存有效期：24 小时（好评率、评论等动态信息）。
// 缓存键为 appId，在不同下载站之间共用，减少对 Steam API 的调用。
// TTL: 24h for dynamic Steam info (ratings, reviews). Keyed by appId,
// shared across download sites to reduce Steam API calls.
const STEAM_CACHE_TTL = 24 * 3600 * 1000; // 24小时

// 名称负缓存有效期：搜索失败后 N 小时内不重复搜索（防 Steam API 限流）。
// 保持较短（6 小时），避免某名称临时失败（如新游戏刚上架）后长时间无法重试。
// Negative-cache TTL: a failed search is not retried within this window
// (API rate-limit protection). Kept short (6h) so temporary failures
// (e.g. brand-new games) don't block retries for a whole day.
const NAME_NEGATIVE_CACHE_TTL = 6 * 3600 * 1000; // 6小时

// 游戏注册表重确认周期：30 天。基础信息（中英文名）永久保留，
// 但超过 30 天会重新从 Steam 获取确认，确保名称未变更。
// Game registry re-confirm period: 30 days. Base info (CN/EN names) is kept
// permanently, but after 30 days it's re-fetched from Steam to confirm.
const REGISTRY_CONFIRM_TTL = 30 * 24 * 3600 * 1000; // 30天

// 下载站详情页网址有效期：30 天。超过后重新搜索确认。
// 若发现同 appId 的新详情页网址，替代旧网址并记录刷新时间。
// Download-site detail URL TTL: 30 days. Re-search after expiry.
// If a new URL for the same appId is found, replace the old one and record refresh time.
const DOWNLOAD_URL_TTL = 30 * 24 * 3600 * 1000; // 30天

// ============ 2. 存储管理 / Storage Management ============

let settingsCache = null;
let settingsCacheTime = 0;
const SETTINGS_CACHE_TTL = 5000; // 5秒缓存

async function initStorage() {
  const data = await chrome.storage.local.get(DB_KEYS.SETTINGS);
  if (!data[DB_KEYS.SETTINGS]) {
    await chrome.storage.local.set({ [DB_KEYS.SETTINGS]: DEFAULT_SETTINGS });
  }
}

async function getSettings() {
  const now = Date.now();
  if (settingsCache && (now - settingsCacheTime < SETTINGS_CACHE_TTL)) {
    return settingsCache;
  }
  const data = await chrome.storage.local.get(DB_KEYS.SETTINGS);
  settingsCache = { ...DEFAULT_SETTINGS, ...(data[DB_KEYS.SETTINGS] || {}) };
  settingsCacheTime = now;
  return settingsCache;
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ [DB_KEYS.SETTINGS]: settings });
  settingsCache = { ...DEFAULT_SETTINGS, ...settings };
  settingsCacheTime = Date.now();
}

// ============ 3. Steam 缓存工具 / Steam Cache Utils ============
// 缓存键为 appId（字符串），在不同下载站之间共用，避免重复获取 Steam 信息。
// v5 起统一以 appId 为唯一标识，替代旧版以游戏名为键的方式。
// Cache key is appId (string), shared across download sites to avoid redundant
// Steam API calls. Since v5, appId is the sole identifier, replacing the old
// game-name-keyed approach.

// 内存级缓存（read-through + 防抖批量写入，大幅减少 storage.local I/O）
// In-memory cache: read-through + debounced batch write to reduce storage I/O.
let steamCacheMemory = null;        // Map: appId -> entry
let steamCacheMemoryLoaded = false;
let steamCacheWriteTimer = null;
const STEAM_CACHE_WRITE_DEBOUNCE = 2000;  // 2秒防抖写入 / 2s debounced write
const STEAM_CACHE_MAX_ENTRIES = 2000;     // 最大条目数，超过时按 LRU 清理 / Max entries; LRU purge when exceeded

function isSteamCacheValid(entry) {
  return entry &&
    entry.version === STEAM_CACHE_VERSION &&
    (Date.now() - entry.timestamp < STEAM_CACHE_TTL);
}

// 加载缓存到内存（仅首次调用时从 storage 读取，后续直接命中内存）
// Load cache into memory (reads from storage only once, then serves from memory)
async function loadSteamCacheToMemory() {
  if (steamCacheMemoryLoaded) return;
  const cacheData = await chrome.storage.local.get(DB_KEYS.STEAM_CACHE);
  steamCacheMemory = new Map(Object.entries(cacheData[DB_KEYS.STEAM_CACHE] || {}));
  steamCacheMemoryLoaded = true;
}

async function getSteamCacheEntry(cacheKey) {
  await loadSteamCacheToMemory();
  return steamCacheMemory.get(cacheKey) || null;
}

async function setSteamCacheEntry(cacheKey, data) {
  await loadSteamCacheToMemory();
  steamCacheMemory.set(cacheKey, { data, timestamp: Date.now(), version: STEAM_CACHE_VERSION });
  scheduleSteamCacheWrite(); // 防抖批量写入 / Debounced batch write
}

// 防抖写入：短时间内多次 setSteamCacheEntry 只产生一次 storage 写入
// Debounced write: multiple setSteamCacheEntry calls within the window produce one storage write
function scheduleSteamCacheWrite() {
  if (steamCacheWriteTimer) clearTimeout(steamCacheWriteTimer);
  steamCacheWriteTimer = setTimeout(flushSteamCache, STEAM_CACHE_WRITE_DEBOUNCE);
}

// 强制立即写入：在批量查询结束时调用，确保 SW 休眠前数据不丢失
// Force flush: call after batch queries to persist before SW may go dormant
async function flushSteamCache() {
  if (steamCacheWriteTimer) {
    clearTimeout(steamCacheWriteTimer);
    steamCacheWriteTimer = null;
  }
  if (!steamCacheMemory) return;
  cleanupSteamCacheMemory(); // 写入前清理过期和超量条目 / Purge before persisting
  await chrome.storage.local.set({ [DB_KEYS.STEAM_CACHE]: Object.fromEntries(steamCacheMemory) });
}

// 内存缓存清理：移除过期条目和超量最旧条目（LRU）
// In-memory cleanup: remove expired entries and oldest entries when over limit (LRU)
function cleanupSteamCacheMemory() {
  if (!steamCacheMemory) return;
  const now = Date.now();
  // 1. 清理过期条目 / Remove expired entries
  for (const [key, entry] of steamCacheMemory) {
    if (!isSteamCacheValid(entry)) steamCacheMemory.delete(key);
  }
  // 2. 超量时删除最旧条目 / Remove oldest entries if over limit
  if (steamCacheMemory.size > STEAM_CACHE_MAX_ENTRIES) {
    const entries = [...steamCacheMemory.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = steamCacheMemory.size - STEAM_CACHE_MAX_ENTRIES;
    for (let i = 0; i < toRemove; i++) {
      steamCacheMemory.delete(entries[i][0]);
    }
  }
}

// ============ 3.5 游戏注册表 / Game Registry (Layer 1: permanent, 30-day re-confirm) ============
// 以 appId 为唯一标识，记录每个游戏的中英文名和已知名称变体。
// 基础信息永久保留，超过 30 天重新从 Steam 获取确认。
// 内存缓存 + 防抖批量写入：列表页批量查询时 recordGameInRegistry 会被高频调用，
// 直接写 storage 会造成大量 I/O 和读-改-写竞争，改为内存合并后定期落盘。
// Keyed by appId. Records CN/EN names and known name variants for each game.
// Base info is permanent; re-confirmed from Steam after 30 days.
// In-memory cache + debounced batch write: recordGameInRegistry is called at high
// frequency during list-page batch queries; direct storage writes would cause heavy
// I/O and read-modify-write races. Instead, merge in memory and persist periodically.

let registryMemory = null;
let registryMemoryLoaded = false;
let registryWriteTimer = null;
const REGISTRY_WRITE_DEBOUNCE = 2000; // 2秒防抖写入 / 2s debounced write

// 加载注册表到内存（仅首次调用时从 storage 读取）
// Load registry into memory (reads from storage only once)
async function loadRegistryToMemory() {
  if (registryMemoryLoaded) return;
  const data = await chrome.storage.local.get(DB_KEYS.GAME_REGISTRY);
  registryMemory = data[DB_KEYS.GAME_REGISTRY] || {};
  registryMemoryLoaded = true;
}

// 获取整个注册表 / Get the entire registry
async function getGameRegistry() {
  await loadRegistryToMemory();
  return registryMemory;
}

// 获取单个游戏注册条目 / Get a single registry entry by appId
async function getGameRegistryEntry(appId) {
  if (!appId) return null;
  const registry = await getGameRegistry();
  return registry[String(appId)] || null;
}

// 判断注册条目是否需要重新确认（超过 30 天）
// Check if a registry entry needs re-confirmation (older than 30 days)
function needsReconfirm(entry) {
  if (!entry || !entry.lastConfirmed) return true;
  return (Date.now() - entry.lastConfirmed) >= REGISTRY_CONFIRM_TTL;
}

// 记录/更新游戏到注册表
// cnName/enName 以 Steam 官方名为准（下载站名称可能有偏差）；
// 下载站标题等触发名加入 names 变体列表，用于跨站名称匹配兼容；
// tags 为 Steam 官方类型标签（genres），供缓存管理页多条件检索。
// Record/update a game in the registry.
// cnName/enName follow the Steam official names (download-site names may deviate);
// triggering names (download-site titles) are kept in the names variants list
// for cross-site matching compatibility; tags are Steam genres for cache-page filters.
async function recordGameInRegistry(appId, { cnName = '', enName = '', gameName = '', tags = null }) {
  if (!appId) return;
  await loadRegistryToMemory();
  const key = String(appId);
  const existing = registryMemory[key] || { firstSeen: Date.now(), names: [] };

  // 更新中英文名（仅在提供新值时覆盖）
  // Update CN/EN names only when new values are provided
  if (cnName) existing.cnName = cnName;
  if (enName) existing.enName = enName;

  // 更新 Steam 官方类型标签（去重合并，最多 20 个）
  // Merge Steam official genre tags (deduplicated, capped at 20)
  if (tags && Array.isArray(tags) && tags.length > 0) {
    existing.tags = [...new Set([...(existing.tags || []), ...tags])].slice(0, 20);
  }

  // 将触发名加入已知名称变体（去重）
  // Add the triggering name to known variants (deduplicated)
  if (gameName) {
    const lower = gameName.toLowerCase().trim();
    if (lower && !existing.names.includes(lower)) {
      existing.names.push(lower);
      if (existing.names.length > 10) existing.names.shift(); // 限制变体数量
    }
  }

  existing.lastConfirmed = Date.now();
  registryMemory[key] = existing;
  scheduleRegistryWrite(); // 防抖批量写入 / Debounced batch write
}

// 防抖写入：短时间内多次 recordGameInRegistry 只产生一次 storage 写入
// Debounced write: multiple recordGameInRegistry calls within the window produce one storage write
function scheduleRegistryWrite() {
  if (registryWriteTimer) clearTimeout(registryWriteTimer);
  registryWriteTimer = setTimeout(flushRegistry, REGISTRY_WRITE_DEBOUNCE);
}

// 强制立即写入注册表（批量查询结束、删除缓存时调用，防止 SW 休眠导致数据丢失）
// Force flush registry to storage (after batch queries or cache deletion; avoids data loss if SW goes dormant)
async function flushRegistry() {
  if (registryWriteTimer) { clearTimeout(registryWriteTimer); registryWriteTimer = null; }
  if (!registryMemory) return;
  await chrome.storage.local.set({ [DB_KEYS.GAME_REGISTRY]: registryMemory });
}

// ============ 3.6 名称索引 / Name Index (name → appId reverse lookup) ============
// 提供 O(1) 的"游戏名→appId"反查，带内存缓存减少 storage I/O。
// 列表页高频调用 getSteamPositiveRate 时依赖此索引快速定位 appId。
// O(1) "gameName→appId" reverse lookup with in-memory cache to reduce storage I/O.
// High-frequency list-page getSteamPositiveRate calls rely on this index.

let nameIndexMemory = null;
let nameIndexMemoryLoaded = false;
let nameIndexWriteTimer = null;
const NAME_INDEX_WRITE_DEBOUNCE = 2000;

async function loadNameIndexToMemory() {
  if (nameIndexMemoryLoaded) return;
  const data = await chrome.storage.local.get(DB_KEYS.NAME_INDEX);
  nameIndexMemory = new Map(Object.entries(data[DB_KEYS.NAME_INDEX] || {}));
  nameIndexMemoryLoaded = true;
}

// 查询游戏名对应的 appId（null 表示未找到或在负缓存期内）
// 精确名未命中时，回退用清理后的规范名再查一次，兼容不同下载站的
// 名称变体（如"铁巢重炮|完整版"与"铁巢重炮|官方中文"都命中同一 appId）。
// Lookup appId by game name (null = not found or in negative-cache window).
// Falls back to the cleaned canonical name, so name variants across sites
// (e.g. "铁巢重炮|完整版" vs "铁巢重炮|官方中文") hit the same appId.
async function lookupAppIdByName(gameName) {
  const name = (gameName || '').toLowerCase().trim();
  if (!name) return null;
  await loadNameIndexToMemory();
  let entry = nameIndexMemory.get(name);
  if (!entry) {
    const cleaned = cleanGameName(gameName).toLowerCase().trim();
    if (cleaned && cleaned !== name) {
      entry = nameIndexMemory.get(cleaned);
    }
  }
  if (!entry) return null;
  return entry.appId || null;
}

// 检查某游戏名是否在负缓存期内（近期搜索过但未找到）
// Check if a name is in the negative-cache window (searched recently, not found)
async function isRecentlySearchedNotFound(gameName) {
  const name = (gameName || '').toLowerCase().trim();
  if (!name) return false;
  await loadNameIndexToMemory();
  const entry = nameIndexMemory.get(name);
  return !!entry &&
    (entry.appId === null || entry.appId === undefined) &&
    entry.lastSearched &&
    (Date.now() - entry.lastSearched < NAME_NEGATIVE_CACHE_TTL);
}

// 记录"游戏名→appId"映射（appId 为 null 表示"搜索过但未找到"）
// 正向映射（appId 非 null）同时记录清理后的规范名，提升跨站变体命中率；
// 负缓存（appId null）不记录规范名——避免某个变体搜索失败误伤其他站点
// 的同名变体（如"铁巢重炮|完整版"失败不应挡住"铁巢重炮|官方中文"）。
// Record a name→appId mapping (appId=null means "searched, not found").
// Positive mappings also index the cleaned canonical name for cross-site hits;
// negative entries do NOT share the canonical name, so one variant failing to
// search never blocks other sites' variants of the same game.
async function recordNameIndex(gameName, appId) {
  const name = (gameName || '').toLowerCase().trim();
  if (!name) return;
  await loadNameIndexToMemory();
  const timestamp = Date.now();
  nameIndexMemory.set(name, { appId: appId || null, lastSearched: timestamp });
  if (appId) {
    const cleaned = cleanGameName(gameName).toLowerCase().trim();
    if (cleaned && cleaned !== name) {
      nameIndexMemory.set(cleaned, { appId, lastSearched: timestamp });
    }
  }
  // 防抖写入 / Debounced write
  if (nameIndexWriteTimer) clearTimeout(nameIndexWriteTimer);
  nameIndexWriteTimer = setTimeout(async () => {
    nameIndexWriteTimer = null;
    await chrome.storage.local.set({ [DB_KEYS.NAME_INDEX]: Object.fromEntries(nameIndexMemory) });
  }, NAME_INDEX_WRITE_DEBOUNCE);
}

// 强制立即写入名称索引 / Force flush name index to storage
async function flushNameIndex() {
  if (nameIndexWriteTimer) { clearTimeout(nameIndexWriteTimer); nameIndexWriteTimer = null; }
  if (!nameIndexMemory) return;
  await chrome.storage.local.set({ [DB_KEYS.NAME_INDEX]: Object.fromEntries(nameIndexMemory) });
}

// ============ 3.7 下载站详情页网址缓存 / Download URL Cache (Layer 3: 30-day TTL) ============
// 记录每个 appId 在各下载站的详情页网址，30 天有效。
// 若发现同 appId 的新网址，替代旧网址并记录刷新时间。
// 存储结构按站点分桶（v2）：{ v: 版本, sites: { siteKey: { appId: entry } } }。
// 更新某个站点时只读写该站点的桶，互不影响，也便于按站点单独清理。
// Records each appId's detail-page URL per download site, 30-day TTL.
// If a new URL for the same appId is found, replaces the old one and records refresh time.
// Storage is bucketed per site (v2): { v: version, sites: { siteKey: { appId: entry } } }.
// Updating one site touches only its own bucket; sites never interfere with each other.

// 结构版本：v2 起按站点分桶；旧版（appId → 站点映射）结构的数据自动失效重建。
// Structure version: bucketed per site since v2; legacy (appId-keyed) data is discarded.
const DOWNLOAD_URLS_VERSION = 2;

// 读取整个存储结构（含版本校验，版本不符视为空）
// Read the whole store (with version check; mismatched versions are treated as empty)
async function readDownloadUrlsStore() {
  const data = await chrome.storage.local.get(DB_KEYS.DOWNLOAD_URLS);
  const store = data[DB_KEYS.DOWNLOAD_URLS];
  if (!store || store.v !== DOWNLOAD_URLS_VERSION || !store.sites) {
    return { v: DOWNLOAD_URLS_VERSION, sites: {} };
  }
  return store;
}

// 获取某 appId 的所有下载站网址（合并各站点桶）
// Get all download-site URLs for an appId (merged across site buckets)
async function getDownloadUrls(appId) {
  if (!appId) return {};
  const store = await readDownloadUrlsStore();
  const key = String(appId);
  const result = {};
  for (const [siteKey, bucket] of Object.entries(store.sites)) {
    if (bucket[key]) result[siteKey] = bucket[key];
  }
  return result;
}

// 获取某 appId 在指定站点的网址（同时更新 lastAccessed）
// Get a specific site's URL for an appId (also updates lastAccessed)
async function getDownloadUrlForSite(appId, siteKey) {
  if (!appId || !siteKey) return null;
  const store = await readDownloadUrlsStore();
  const bucket = store.sites[siteKey];
  const entry = bucket ? bucket[String(appId)] : null;
  if (!entry) return null;
  // 更新上次调用缓存时间 / Update last accessed time
  entry.lastAccessed = Date.now();
  await chrome.storage.local.set({ [DB_KEYS.DOWNLOAD_URLS]: store });
  return entry;
}

// 记录/更新某 appId 在指定站点的详情页网址
// 仅操作该站点自己的桶：读取站点桶 → 更新 → 写回，不触碰其他站点数据。
// 若网址与已有不同，替代并记录 lastRefreshed；若相同，仅更新 lastAccessed。
// Record/update a detail-page URL for appId at a specific site.
// Touches only that site's bucket: read → update → write back, leaving other sites untouched.
// If the URL differs from the stored one, replace it and record lastRefreshed;
// if same, only update lastAccessed.
async function recordDownloadUrl(appId, siteKey, siteName, url) {
  // 仅接受 http/https 且非内网地址（SSRF 纵深防御）
  // Only http/https, non-private URLs are accepted (SSRF defense in depth)
  if (!appId || !siteKey || !isSafeFetchUrl(url)) return;
  const store = await readDownloadUrlsStore();
  const bucket = store.sites[siteKey] || (store.sites[siteKey] = {});
  const key = String(appId);
  const existing = bucket[key];
  const now = Date.now();

  if (existing && existing.url === url) {
    // 网址未变，仅更新调用时间 / URL unchanged, only update access time
    existing.lastAccessed = now;
  } else {
    // 新网址或网址变更，替代并记录刷新时间
    // New or changed URL: replace and record refresh time
    bucket[key] = {
      url,
      siteName: siteName || siteKey,
      firstSeen: existing ? existing.firstSeen : now,
      lastRefreshed: now,
      lastAccessed: now
    };
  }
  await chrome.storage.local.set({ [DB_KEYS.DOWNLOAD_URLS]: store });
}

// 批量记录/更新某站点下多个 appId 的详情页地址（列表页调用）。
// 一次读取、一次写入 storage，避免逐条读写造成 I/O 放大。
// Batch-record detail-page URLs for many appIds at one site (list-page call).
// Single read + single write, avoiding per-entry storage I/O.
async function recordDownloadUrlsBatch(siteKey, siteName, entries) {
  if (!siteKey || !entries || entries.length === 0) return;
  const store = await readDownloadUrlsStore();
  const bucket = store.sites[siteKey] || (store.sites[siteKey] = {});
  const now = Date.now();
  for (const entry of entries) {
    const appId = entry && entry.appId;
    const url = entry && entry.url;
    // 仅接受 http/https 且非内网地址（安全校验，防止缓存的内网地址被后续请求利用）
    // Only http/https, non-private URLs are accepted (SSRF defense in depth)
    if (!appId || !isSafeFetchUrl(url)) continue;
    const key = String(appId);
    const existing = bucket[key];
    if (existing && existing.url === url) {
      existing.lastAccessed = now; // 网址未变，仅更新调用时间 / URL unchanged
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
  await chrome.storage.local.set({ [DB_KEYS.DOWNLOAD_URLS]: store });
}
// 内存缓冲 + 防抖批量写入：高频日志（如批量好评率查询）不逐条写 storage，
// 而是累积到内存缓冲区，2 秒后一次性合并写入，大幅降低 I/O。
// In-memory buffer + debounced batch write: high-frequency logs (e.g. batch rating
// queries) are accumulated in memory and merged into storage once after 2s.

let logBuffer = [];
let logFlushTimer = null;
const LOG_FLUSH_DEBOUNCE = 2000; // 2秒防抖 / 2s debounce

// 立即将缓冲区合并写入 storage / Flush buffered logs into storage immediately
async function flushLogBuffer() {
  if (logFlushTimer) { clearTimeout(logFlushTimer); logFlushTimer = null; }
  if (logBuffer.length === 0) return;

  const pending = logBuffer;
  logBuffer = [];

  try {
    const settings = await getSettings();
    if (!settings.enableLog) return; // 日志开关已关闭，丢弃缓冲 / Logging disabled; drop buffer

    const stored = await chrome.storage.local.get(DB_KEYS.RUNTIME_LOG);
    let logs = stored[DB_KEYS.RUNTIME_LOG] || [];
    logs.push(...pending);

    const max = settings.maxRuntimeLog || 300;
    while (logs.length > max) logs.shift();

    await chrome.storage.local.set({ [DB_KEYS.RUNTIME_LOG]: logs });
  } catch (e) {
    // 日志写入失败不应影响主流程 / Log write failures must not affect the main flow
    // 尽力回填缓冲，避免日志丢失 / Best-effort refill to avoid losing logs
    logBuffer = [...pending, ...logBuffer];
  }
}

async function writeLog(level, module, message, data) {
  try {
    const entry = { timestamp: Date.now(), level, module, message };
    if (data !== undefined) {
      try {
        const s = typeof data === 'string' ? data : JSON.stringify(data);
        entry.data = s.length > 500 ? s.substring(0, 500) + '...' : s;
      } catch (e) { entry.data = String(data); }
    }

    logBuffer.push(entry);
    if (logFlushTimer) clearTimeout(logFlushTimer);
    logFlushTimer = setTimeout(flushLogBuffer, LOG_FLUSH_DEBOUNCE);
  } catch (e) {
    // 忽略日志记录异常 / Ignore logging exceptions
  }
}

const Logger = {
  debug: (module, msg, data) => writeLog('debug', module, msg, data),
  info:  (module, msg, data) => writeLog('info', module, msg, data),
  warn:  (module, msg, data) => writeLog('warn', module, msg, data),
  error: (module, msg, data) => writeLog('error', module, msg, data)
};

async function getRuntimeLogs(limit) {
  await flushLogBuffer(); // 先落盘缓冲中的日志，保证返回完整数据 / Flush buffer first for complete data
  const stored = await chrome.storage.local.get(DB_KEYS.RUNTIME_LOG);
  const logs = stored[DB_KEYS.RUNTIME_LOG] || [];
  return limit ? logs.slice(-limit) : logs;
}

async function clearRuntimeLogs() {
  logBuffer = []; // 清空内存缓冲 / Clear in-memory buffer
  if (logFlushTimer) { clearTimeout(logFlushTimer); logFlushTimer = null; }
  await chrome.storage.local.set({ [DB_KEYS.RUNTIME_LOG]: [] });
}

// ============ 5. 自动备份 / Auto Backup ============

async function createBackup(manual = false) {
  try {
    const data = await chrome.storage.local.get(BACKUP_DATA_KEYS);
    const snapshot = {};
    for (const key of BACKUP_DATA_KEYS) {
      if (data[key] !== undefined) snapshot[key] = data[key];
    }

    const backup = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      timestamp: Date.now(),
      manual,
      size: JSON.stringify(snapshot).length,
      data: snapshot
    };

    const stored = await chrome.storage.local.get(DB_KEYS.BACKUPS);
    const backups = stored[DB_KEYS.BACKUPS] || [];
    backups.push(backup);

    const settings = await getSettings();
    const max = settings.maxBackups || 7;
    while (backups.length > max) backups.shift();

    await chrome.storage.local.set({ [DB_KEYS.BACKUPS]: backups });
    Logger.info('Backup', `创建${manual ? '手动' : '自动'}备份 ${backup.id}`, { size: backup.size, count: backups.length });
    return backup;
  } catch (e) {
    Logger.error('Backup', '创建备份失败', e.message);
    return null;
  }
}

async function getBackupList() {
  const stored = await chrome.storage.local.get(DB_KEYS.BACKUPS);
  const backups = stored[DB_KEYS.BACKUPS] || [];
  return backups.map(b => ({
    id: b.id, timestamp: b.timestamp, manual: b.manual, size: b.size
  })).reverse();
}

async function restoreBackup(backupId) {
  try {
    const stored = await chrome.storage.local.get(DB_KEYS.BACKUPS);
    const backups = stored[DB_KEYS.BACKUPS] || [];
    const backup = backups.find(b => b.id === backupId);
    if (!backup || !backup.data) {
      Logger.warn('Backup', `备份不存在: ${backupId}`);
      return { success: false, error: '备份不存在' };
    }

    // 恢复前先创建当前状态的备份（安全网）
    // Create a safety-net backup of the current state before restoring
    await createBackup(true);

    await chrome.storage.local.set(backup.data);
    // 备份数据可能包含旧的 settings 及各层缓存，必须使所有内存缓存失效，
    // 避免恢复后仍命中恢复前的旧数据。
    // The backup may contain old settings and cache layers; invalidate ALL in-memory
    // caches so stale pre-restore data is never served afterwards.
    settingsCache = null;
    registryMemory = null; registryMemoryLoaded = false;
    if (registryWriteTimer) { clearTimeout(registryWriteTimer); registryWriteTimer = null; }
    nameIndexMemory = null; nameIndexMemoryLoaded = false;
    if (nameIndexWriteTimer) { clearTimeout(nameIndexWriteTimer); nameIndexWriteTimer = null; }
    steamCacheMemory = null; steamCacheMemoryLoaded = false;
    if (steamCacheWriteTimer) { clearTimeout(steamCacheWriteTimer); steamCacheWriteTimer = null; }
    logBuffer = [];
    if (logFlushTimer) { clearTimeout(logFlushTimer); logFlushTimer = null; }
    Logger.info('Backup', `已恢复备份 ${backupId}`);
    return { success: true };
  } catch (e) {
    Logger.error('Backup', '恢复备份失败', e.message);
    return { success: false, error: e.message };
  }
}

async function deleteBackup(backupId) {
  const stored = await chrome.storage.local.get(DB_KEYS.BACKUPS);
  let backups = stored[DB_KEYS.BACKUPS] || [];
  backups = backups.filter(b => b.id !== backupId);
  await chrome.storage.local.set({ [DB_KEYS.BACKUPS]: backups });
  return { success: true };
}

// ============ 6. 行为日志与游戏画像 / Behavior Log & Game Profiles ============

async function addBehaviorLog(entry) {
  const data = await chrome.storage.local.get(DB_KEYS.BEHAVIOR_LOG);
  const log = data[DB_KEYS.BEHAVIOR_LOG] || [];

  entry.timestamp = Date.now();
  log.push(entry);

  const settings = await getSettings();
  while (log.length > settings.maxBehaviorLog) {
    log.shift();
  }

  await chrome.storage.local.set({ [DB_KEYS.BEHAVIOR_LOG]: log });
  return log;
}

async function getBehaviorLog() {
  const data = await chrome.storage.local.get(DB_KEYS.BEHAVIOR_LOG);
  return data[DB_KEYS.BEHAVIOR_LOG] || [];
}

async function updateGameProfile(gameInfo) {
  const data = await chrome.storage.local.get(DB_KEYS.GAME_PROFILES);
  const profiles = data[DB_KEYS.GAME_PROFILES] || {};

  const key = gameInfo.name.toLowerCase().trim();
  if (!profiles[key]) {
    profiles[key] = {
      name: gameInfo.name,
      views: 0,
      downloads: 0,
      keywords: [],
      steamAppId: null,
      steamRating: null,
      lastSeen: Date.now()
    };
  }

  const profile = profiles[key];
  if (gameInfo.event === 'view') profile.views++;
  if (gameInfo.event === 'download') profile.downloads++;
  if (gameInfo.keywords) {
    profile.keywords = [...new Set([...profile.keywords, ...gameInfo.keywords])];
  }
  if (gameInfo.steamAppId) profile.steamAppId = gameInfo.steamAppId;
  if (gameInfo.steamRating) profile.steamRating = gameInfo.steamRating;
  profile.lastSeen = Date.now();

  await chrome.storage.local.set({ [DB_KEYS.GAME_PROFILES]: profiles });
  return profiles;
}

// ============ 7. 用户偏好模型 / User Preference Model ============

// 偏好模型更新节流：view_list 等高频事件会反复触发，限制为每 60s 最多一次，降低 CPU/IO 占用。
// Throttle preference model updates: high-frequency events (view_list) trigger this repeatedly;
// limit to at most once per 60s to reduce CPU/IO usage.
let lastPrefUpdate = 0;
const PREF_UPDATE_INTERVAL = 60000; // 60s

async function maybeUpdatePreferences(force = false) {
  const now = Date.now();
  if (!force && now - lastPrefUpdate < PREF_UPDATE_INTERVAL) return;
  lastPrefUpdate = now;
  await updateUserPreferences();
}

async function updateUserPreferences() {
  const log = await getBehaviorLog();
  const data = await chrome.storage.local.get(DB_KEYS.KEYWORD_WEIGHTS);
  const keywordWeights = data[DB_KEYS.KEYWORD_WEIGHTS] || {};

  const positiveKeywords = {};  // 下载过的游戏的关键词
  const negativeKeywords = {};  // 看过但没下载的关键词

  // 统计每个游戏的查看/下载状态和关键词。
  // 关键词用 Set 去重：同一游戏多次查看时，关键词不应重复累加（否则信号被放大）。
  // Track each game's viewed/downloaded state and keywords.
  // Keywords are deduplicated via Set: repeated views of the same game must not
  // accumulate duplicate keywords (which would amplify the signal unfairly).
  const gameEvents = {};
  log.forEach(entry => {
    if (!gameEvents[entry.gameName]) {
      gameEvents[entry.gameName] = { viewed: false, downloaded: false, keywords: new Set() };
    }
    if (entry.type === 'view_detail') {
      gameEvents[entry.gameName].viewed = true;
      if (entry.keywords) {
        entry.keywords.forEach(kw => gameEvents[entry.gameName].keywords.add(kw));
      }
    }
    if (entry.type === 'click_download') {
      gameEvents[entry.gameName].downloaded = true;
    }
  });

  Object.values(gameEvents).forEach(game => {
    game.keywords.forEach(kw => {
      if (game.downloaded) {
        positiveKeywords[kw] = (positiveKeywords[kw] || 0) + 2;
      } else if (game.viewed) {
        negativeKeywords[kw] = (negativeKeywords[kw] || 0) + 1;
      }
    });
  });

  Object.keys(positiveKeywords).forEach(kw => {
    const pos = positiveKeywords[kw] || 0;
    const neg = negativeKeywords[kw] || 0;
    keywordWeights[kw] = pos / (pos + neg + 1);
  });

  await chrome.storage.local.set({ [DB_KEYS.KEYWORD_WEIGHTS]: keywordWeights });
  return keywordWeights;
}

// ============ 8. 游戏标题解析 / Game Title Parser ============

function parseGameTitle(rawName) {
  if (!rawName) return [];

  let name = rawName.trim();

  // 移除括号内容（中英文括号）及书名号 / Strip bracket contents (CN/EN) and book-title marks
  name = name.replace(/[\(\[\【].*?[\)\]\】]/g, '');
  name = name.replace(/[《》]/g, '');

  // 只按 | 和 " - "/" – "/" — " 分段，不再按 : ： / 、 拆分
  // 避免 "王国历史：三国志"、"History of Kingdoms: Three Kingdoms" 等含冒号的完整名字被误拆
  const rawParts = name.split(/[|]+|\s+[-–—]\s+/).map(s => s.trim()).filter(s => s.length > 1);

  const noisePattern = /(中文|汉化|破解|免安装|绿色|学习|未加密|完整版|豪华版|豪华|终极|数字|典藏|年度|重制|复刻|增强|正式|官方|简繁|简体|繁体|中英|多语言|特别版|标准版|解压即撸|预购特典|预购|特典|版|v[\d.]+|V[\d.]+|\d+\.\d+[\d.]*|Build[.\s]*\d+|update\s*\d+|DLC.*|全DLC|整合|硬盘|免DVD|CODEX|FLT|RELOADED|SKIDROW|EMPRESS|GOG|Razor1911|FitGirl|\d+\s*GB|百度网盘|网盘|下载|迅雷|磁力|BT|种子|支持手柄|手柄|支持|新游发布|免安装绿色版|\s+The\s+Game\s*)/gi;

  // 判断整段是否仅由噪声词组成（如 "官方中文"、"中文版"、"v1.0"）
  function isPureNoise(text) {
    const stripped = text.replace(noisePattern, '').replace(/[\s\|\-:：、]+/g, '');
    return stripped.length === 0;
  }

  const candidates = [];
  const seen = new Set();
  function addCandidate(text) {
    const t = text.trim().replace(/\s+/g, ' ');
    if (t.length >= 2 && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      candidates.push(t);
    }
  }

  // 遍历每一段：跳过纯噪声段，对有效段同时保留整段清洗后的主名 + 中英子串作为候选
  for (const part of rawParts) {
    if (isPureNoise(part)) continue;

    // 1) 整段清洗后作为候选（保留主名，去掉噪声词）
    const cleaned = part.replace(noisePattern, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned.length >= 2) addCandidate(cleaned);

    // 2) 提取英文子串作为补充候选
    const en = part.match(/[A-Za-z][A-Za-z0-9\s':&.!\-]+[A-Za-z0-9'.!]?/g);
    if (en) en.forEach(m => {
      const cleanedEn = m.replace(noisePattern, ' ').replace(/\s+/g, ' ').trim();
      if (cleanedEn.length >= 2) addCandidate(cleanedEn);
    });

    // 3) 提取中文子串作为补充候选
    const cn = part.match(/[\u4e00-\u9fff\u3400-\u4dbf][\u4e00-\u9fff\u3400-\u4dbf0-9\s:：!！]+/g);
    if (cn) cn.forEach(m => addCandidate(m.trim()));
  }

  if (candidates.length === 0) {
    addCandidate(name.replace(noisePattern, ' ').replace(/\s+/g, ' ').trim());
  }

  const junkPattern = /^(豪华|解压即撸|预购特典|预购|特典|中文|汉化|破解|免安装|绿色|完整版|豪华版|终极|build[.\s]*\d+|\d+[\d.]*|v[\d.]+)$/i;
  const filtered = candidates.filter(c => !junkPattern.test(c.trim()));
  const finalCandidates = filtered.length > 0 ? filtered : candidates;

  const first = finalCandidates[0];
  const rest = finalCandidates.slice(1);
  // 优先英文（更易在Steam搜到），同语言时按长度降序（更具体的名字优先）
  rest.sort((a, b) => {
    const aIsEnglish = /^[A-Za-z]/.test(a);
    const bIsEnglish = /^[A-Za-z]/.test(b);
    if (aIsEnglish && !bIsEnglish) return -1;
    if (!aIsEnglish && bIsEnglish) return 1;
    return b.length - a.length;
  });

  return [first, ...rest].slice(0, 5);
}

function cleanGameName(name) {
  const candidates = parseGameTitle(name);
  return candidates[0] || name || '';
}

// ============ 9. Steam API 子模块 / Steam API Submodules ============

// --- 搜索 ---

// 在搜索结果中挑选目标游戏：
// Demo/试玩版没有完整评测数据，且常以较高相关性抢占完整版的位置
//（如"奉魔 Demo"排在"奉魔"前面），导致好评率永远查不到。
// 因此优先返回非 Demo 结果，仅在没有其他结果时回退到 Demo。
// Pick the target game from search results:
// Demo/trial editions have no full review data and often rank ahead of the
// full version (e.g. "奉魔 Demo" before "奉魔"), so ratings never resolve.
// Prefer non-Demo results; fall back to a Demo only when nothing else matches.
function pickSearchItem(items) {
  const nonDemo = items.find(i => !/demo|试玩|trial/i.test(i.name || ''));
  return nonDemo || items[0];
}

async function searchSteamAppId(searchTerms) {
  for (const term of searchTerms) {
    // 并行请求中英文搜索结果：中文名用于匹配与显示，英文名用于注册表记录
    //（l=english 时 name 为 Steam 官方英文名，弥补列表页轻量路径的英文名缺失）
    // Parallel CN/EN searches: the CN name drives matching/display, the EN name
    // feeds the registry (l=english returns the official EN name, fixing the
    // missing-EN-name issue on the lightweight list-page path).
    let cnData = null;
    let enData = null;
    try {
      cnData = await (await fetchWithTimeout(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=schinese&cc=cn`)).json();
    } catch (e) { /* 中文搜索失败不阻断流程 */ }
    try {
      enData = await (await fetchWithTimeout(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=cn`)).json();
    } catch (e) { /* 英文搜索失败回退中文名 */ }

    const cnItems = (cnData && cnData.items) || [];
    if (cnItems.length > 0) {
      const picked = pickSearchItem(cnItems);
      const enItems = (enData && enData.items) || [];
      const pickedEn = enItems.find(i => i.id === picked.id) || enItems[0];
      return {
        appId: picked.id,
        name: picked.name,
        englishName: pickedEn ? pickedEn.name : picked.name
      };
    }
  }
  return null;
}

// --- 应用详情 ---

// 获取应用详情（language: schinese/english 等，返回对应语言的 name 字段）
// Fetch app details (language: schinese/english etc.; `name` follows the locale)
async function fetchSteamAppDetails(appId, language = 'schinese') {
  const detailUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=${language}`;
  const response = await fetchWithTimeout(detailUrl);
  const detailData = await response.json();
  if (!detailData[appId] || !detailData[appId].success) return null;
  return detailData[appId].data;
}

// --- 商店页面 HTML ---

async function fetchStorePageHtml(appId) {
  try {
    const storePageUrl = `https://store.steampowered.com/app/${appId}/?cc=cn&l=schinese`;
    const resp = await fetchWithTimeout(storePageUrl, { headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' } });
    return await resp.text();
  } catch (e) {
    console.log('获取商店页面失败:', e);
    return '';
  }
}

// --- 中文语言支持解析 ---

function parseChineseLanguageSupport(storeHtml, gameData) {
  let chineseSupported = false;
  let simplifiedChinese = false;
  let chineseHasAudio = false;
  let chineseHasSubtitles = false;

  // 方法1：解析商店页语言支持表 (game_language_options)
  if (storeHtml) {
    const langTableMatch = storeHtml.match(/<table[^>]*class="[^"]*game_language_options[^"]*"[\s\S]*?<\/table>/i);
    if (langTableMatch) {
      const langTable = langTableMatch[0];
      const rows = langTable.match(/<tr[\s\S]*?<\/tr>/gi) || [];
      for (const row of rows) {
        const isSimplifiedRow = /简体中文|Chinese\s*\(Simplified\)/i.test(row);
        const isChineseRow = /中文|Chinese/i.test(row) && !/繁体|Traditional/i.test(row);
        if (isSimplifiedRow || isChineseRow) {
          const hasCheck = /✓|&#10003;|class="[^"]*check/i.test(row);
          const cells = row.match(/<td[\s\S]*?<\/td>/gi) || [];
          if (hasCheck || cells.some(c => /✓|&#10003;|check/i.test(c))) {
            chineseSupported = true;
            if (isSimplifiedRow) simplifiedChinese = true;
            if (cells.length >= 3) {
              chineseHasAudio = /✓|&#10003;|check/i.test(cells[2] || '');
              chineseHasSubtitles = /✓|&#10003;|check/i.test(cells[3] || '');
            }
          }
        }
      }
    }
  }

  // 方法2：回退到 supported_languages 字段
  if (!chineseSupported) {
    const supportedLangs = gameData.supported_languages || '';
    const cleanLangs = supportedLangs.replace(/<[^>]+>/g, ' ');
    chineseSupported = /简体中文|繁体中文|Chinese|中文/i.test(cleanLangs);
    simplifiedChinese = /简体中文|Simplified\s*Chinese/i.test(cleanLangs);
  }

  return { chineseSupported, simplifiedChinese, chineseHasAudio, chineseHasSubtitles };
}

// --- 用户标签解析 ---

function parseUserTags(storeHtml) {
  if (!storeHtml) return [];
  const tagMatches = storeHtml.match(/<a[^>]*class="[^"]*app_tag[^"]*"[^>]*>[\s\S]*?<\/a>/gi);
  if (!tagMatches) return [];

  const seenTags = new Set();
  return tagMatches
    .map(m => m
      .replace(/<[^>]+>/g, '')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(t => {
      if (t.length < 1 || t.length > 30) return false;
      const lower = t.toLowerCase();
      if (seenTags.has(lower)) return false;
      seenTags.add(lower);
      return true;
    })
    .slice(0, 10);
}

// --- 评测获取 ---

async function fetchReviewSummary(appId) {
  try {
    const reviewUrl = `https://store.steampowered.com/appreviews/${appId}?json=1&language=all&num_per_page=0`;
    const response = await fetchWithTimeout(reviewUrl);
    const data = await response.json();
    if (data.success === 1 && data.query_summary) {
      const qs = data.query_summary;
      return {
        total: qs.total_reviews,
        positive: qs.total_positive,
        negative: qs.total_negative,
        score: qs.review_score,
        desc: qs.review_score_desc
      };
    }
  } catch (e) {
    console.log('获取总体评价失败:', e);
  }
  return null;
}

async function fetchChineseReviews(appId) {
  let cnReviewSummary = null;
  let chineseReviews = [];
  try {
    const cnReviewUrl = `https://store.steampowered.com/appreviews/${appId}?json=1&language=schinese&num_per_page=10&filter=all`;
    const resp = await fetchWithTimeout(cnReviewUrl);
    const data = await resp.json();
    if (data.success === 1) {
      if (data.reviews && data.reviews.length > 0) {
        chineseReviews = data.reviews.slice(0, 5).map(r => ({
          recommended: r.voted_up === true,
          text: r.review.substring(0, 200),
          author: r.author?.steamid || '匿名',
          language: 'schinese'
        }));
      }
      if (data.query_summary) {
        const qs = data.query_summary;
        cnReviewSummary = {
          total: qs.total_reviews,
          positive: qs.total_positive,
          negative: qs.total_negative,
          score: qs.review_score,
          desc: qs.review_score_desc,
          positiveRate: qs.total_reviews > 0
            ? Math.round(qs.total_positive / qs.total_reviews * 100)
            : null
        };
      }
    }
  } catch (e) {
    console.log('获取中文评价失败:', e);
  }
  return { cnReviewSummary, chineseReviews };
}

async function fetchSteamReviews(appId) {
  const [reviewSummary, cnData] = await Promise.all([
    fetchReviewSummary(appId),
    fetchChineseReviews(appId)
  ]);
  return {
    reviewSummary,
    cnReviewSummary: cnData.cnReviewSummary,
    chineseReviews: cnData.chineseReviews
  };
}

// --- SteamDB 信息 ---

async function fetchSteamDbInfo(appId) {
  const steamdbUrl = `https://steamdb.info/app/${appId}/`;
  try {
    const resp = await fetchWithTimeout(steamdbUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    });
    const html = await resp.text();
    const isBlocked = !resp.ok ||
      /Just a moment|cf-browser-verification|challenge-platform|Checking your browser|Attention Required/i.test(html);

    if (isBlocked) {
      return { url: steamdbUrl, available: false, blocked: true };
    }

    const ratingMatch = html.match(/<div[^>]*class="[^"]*header-rating[^"]*"[^>]*>\s*<span[^>]*>([\d.]+)%?<\/span>/i) ||
                        html.match(/([\d.]+)%\s*(?:positive|好评)/i);
    const playersMatch = html.match(/([\d,]+)\s*(?:players|人在玩)/i);
    const priceMatch = html.match(/Lowest Price[\s\S]*?([\d.,]+\s*(?:¥|\$|USD|CNY))/i);
    const reviewCountMatch = html.match(/([\d,]+)\s*(?:reviews|评测|评价)/i);

    return {
      url: steamdbUrl,
      rating: ratingMatch ? ratingMatch[1] : null,
      reviewCount: reviewCountMatch ? reviewCountMatch[1] : null,
      currentPlayers: playersMatch ? playersMatch[1] : null,
      lowestPrice: priceMatch ? priceMatch[1] : null,
      available: true,
      blocked: false
    };
  } catch (e) {
    console.log('SteamDB获取失败:', e.message);
    return { url: steamdbUrl, available: false, blocked: true };
  }
}

// --- SteamSpy 信息（SteamDB 被拦截时的补充数据） ---

async function fetchSteamSpyInfo(appId) {
  try {
    const resp = await fetchWithTimeout(`https://steamspy.com/api.php?request=appdetails&appid=${appId}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data || !data.appid) return null;

    const total = (data.positive || 0) + (data.negative || 0);
    return {
      positiveRate: total > 0 ? Math.round(data.positive / total * 100) : null,
      reviewCount: total > 0 ? total.toLocaleString() : null,
      players2weeks: data.players_2weeks ? data.players_2weeks.toLocaleString() : null,
      playersForever: data.players_forever ? data.players_forever.toLocaleString() : null,
      averagePlaytime: data.average_forever ? Math.round(data.average_forever / 60) + '小时' : null
    };
  } catch (e) {
    console.log('SteamSpy获取失败:', e.message);
    return null;
  }
}

// --- 组装最终结果对象 ---

function buildSteamResult(appId, gameData, langInfo, userTags, reviews, steamdbInfo, steamspyInfo, enGameData) {
  const { reviewSummary, cnReviewSummary, chineseReviews } = reviews;
  const { chineseSupported, simplifiedChinese, chineseHasAudio, chineseHasSubtitles } = langInfo;

  return {
    appId,
    name: gameData.name,
    // 英文名：来自 english 语言的详情（注册表/缓存管理页使用；中文站点仍以中文名显示）
    // English name from the english-locale details (used by the registry/cache page)
    englishName: (enGameData && enGameData.name) || gameData.name,
    url: `https://store.steampowered.com/app/${appId}/`,
    steamdbUrl: steamdbInfo?.url || `https://steamdb.info/app/${appId}/`,
    rating: reviewSummary ? reviewSummary.score : null,
    ratingDesc: reviewSummary ? reviewSummary.desc : null,
    totalReviews: reviewSummary ? reviewSummary.total : 0,
    positiveRate: reviewSummary && reviewSummary.total > 0
      ? Math.round(reviewSummary.positive / reviewSummary.total * 100)
      : null,
    cnRatingDesc: cnReviewSummary ? cnReviewSummary.desc : null,
    cnPositiveRate: cnReviewSummary ? cnReviewSummary.positiveRate : null,
    cnTotalReviews: cnReviewSummary ? cnReviewSummary.total : 0,
    reviews: chineseReviews,
    genres: (gameData.genres || []).map(g => g.description),
    userTags,
    chineseSupported,
    simplifiedChinese,
    chineseHasAudio,
    chineseHasSubtitles,
    releaseDate: gameData.release_date?.date || '',
    developers: gameData.developers || [],
    description: gameData.short_description || '',
    headerImage: gameData.header_image || '',
    steamdb: steamdbInfo,
    steamspy: steamspyInfo
  };
}

// 通过 appId 获取完整的 Steam 详情（组装：详情/语言/标签/评测/SteamDB/SteamSpy）
// 提取为公共方法，供 searchSteamGame 和 handleGetSteamByAppId 复用，消除重复逻辑。
// Get full Steam details by appId (assembles details/language/tags/reviews/SteamDB/SteamSpy).
// Extracted as a shared helper for searchSteamGame and handleGetSteamByAppId to avoid duplication.
async function fetchSteamFullDetailsByAppId(appId) {
  // 并行获取中英文详情：中文用于页面显示，英文名写入游戏注册表
  // Fetch CN and EN details in parallel: CN for display, EN name for the registry
  const [gameData, enGameData] = await Promise.all([
    fetchSteamAppDetails(appId, 'schinese'),
    fetchSteamAppDetails(appId, 'english')
  ]);
  if (!gameData) return null;

  const storeHtml = await fetchStorePageHtml(appId);
  const [langInfo, userTags, reviews] = await Promise.all([
    Promise.resolve(parseChineseLanguageSupport(storeHtml, gameData)),
    Promise.resolve(parseUserTags(storeHtml)),
    fetchSteamReviews(appId)
  ]);
  const steamdbInfo = await fetchSteamDbInfo(appId);
  const steamspyInfo = (!steamdbInfo || !steamdbInfo.available)
    ? await fetchSteamSpyInfo(appId)
    : null;

  return buildSteamResult(appId, gameData, langInfo, userTags, reviews, steamdbInfo, steamspyInfo, enGameData);
}

// ============ 10. Steam API 编排器 / Steam API Orchestrator ============

// 判断缓存条目是否为"Demo 版且无评测"——这种条目表示历史匹配到了试玩版，
// 评分永远为 null，需要清除并重新搜索完整版（自愈）。
// Whether a cached entry is a "Demo edition without reviews" — it means a trial
// version was matched historically, the rating is permanently null, and a re-search
// for the full version is needed (self-heal).
function isDemoCacheWithoutRating(cachedData) {
  if (!cachedData) return false;
  if (cachedData.positiveRate !== null && cachedData.positiveRate !== undefined) return false;
  return /demo|试玩|trial/i.test(cachedData.name || '');
}

// 通过注册表判断 appId 是否为 Demo/试玩版（缓存缺失时的自愈依据）：
// 名称索引可能固化过 Demo 版映射（如"奉魔"→"奉魔 Demo"），缓存缺失时直接
// 用该 appId 查询只会得到 0 评测。注册表里的官方名/变体含 Demo 即判定为重搜。
// Determine from the registry whether an appId is a Demo/trial edition (used for
// self-healing when the cache entry is missing): the name index may hold a stale
// Demo mapping (e.g. "奉魔" → "奉魔 Demo"), and querying that appId directly
// yields zero reviews. A Demo marker in the registry names triggers a re-search.
async function isDemoAppId(appId) {
  if (!appId) return false;
  const entry = await getGameRegistryEntry(appId);
  if (!entry) return false;
  const text = [entry.cnName, entry.enName, ...(entry.names || [])].filter(Boolean).join(' ');
  return /demo|试玩|trial/i.test(text);
}

// 选择注册表英文名：优先取下载站标题中嵌入的英文名（与站点标题一致，
// 如"铁巢重炮|Iron Nest Heavy Turret Simulator"），
// 回退到 Steam 官方英文名（可能为全大写形式）。
// Pick the registry EN name: prefer the EN name embedded in the download-site
// title (e.g. "铁巢重炮|Iron Nest Heavy Turret Simulator"), falling back to the
// Steam official EN name (which may be ALL-CAPS).
function pickRegistryEnName(gameName, steamEnName) {
  const enFromTitle = parseGameTitle(gameName || '').find(t => /^[A-Za-z]/.test(t));
  return enFromTitle || steamEnName || '';
}

async function searchSteamGame(gameName) {
  // 1. 通过名称索引查找 appId（O(1)，带内存缓存）
  //    Lookup appId via name index (O(1), in-memory cached)
  let appId = await lookupAppIdByName(gameName);

  // 2. 若已有 appId，检查 Steam 动态缓存（24h 有效，以 appId 为键）。
  //    命中条件为 appId+name 即可——列表页写入的部分缓存（好评率等）也能被
  //    详情页复用，避免重复调用 Steam API（渲染端对缺失字段已容错）。
  //    If appId known, check Steam dynamic cache (24h TTL, appId-keyed).
  //    appId+name is enough to hit: partial entries written by the list page
  //    (ratings etc.) are reusable by detail pages, avoiding Steam API calls
  //    (the renderer tolerates missing fields).
  if (appId) {
    const cached = await getSteamCacheEntry(appId);
    if (isSteamCacheValid(cached) && cached.data && cached.data.appId && cached.data.name) {
      // 自愈：Demo 版缓存无好评率 → 忽略缓存，重新搜索完整版
      // Self-heal: Demo cache entry without rating → ignore cache, re-search the full version
      if (isDemoCacheWithoutRating(cached.data)) {
        appId = null;
      } else {
        return cached.data;
      }
    } else if (await isDemoAppId(appId)) {
      // 缓存缺失/过期且该 appId 是 Demo 版 → 重新搜索完整版
      // Cache missing/expired and the appId is a Demo edition → re-search the full version
      appId = null;
    }
  } else {
    // 3. 无 appId 时，检查是否在 24h 负缓存期内（近期搜索过但未找到）
    //    No appId: check 24h negative cache (searched recently, not found)
    if (await isRecentlySearchedNotFound(gameName)) {
      return null;
    }
  }

  try {
    // 4. 搜索 appId（若已有 appId 但缓存过期，跳过搜索直接获取详情）
    //    Search for appId (skip search if we already have one, just re-fetch details)
    if (!appId) {
      const searchResult = await searchSteamAppId(parseGameTitle(gameName));
      if (!searchResult) {
        // 记录负缓存，24h 内不再重复搜索 / Record negative cache
        await recordNameIndex(gameName, null);
        return null;
      }
      appId = searchResult.appId;
    }

    // 5. 获取完整 Steam 详情 / Fetch full Steam details
    const result = await fetchSteamFullDetailsByAppId(appId);
    if (!result) return null;

    // 6. 写入三层缓存：Steam 动态缓存(24h) + 游戏注册表(永久) + 名称索引
    //    注册表以 Steam 官方中英文名为准，下载站标题入 names 变体
    //    Write to all 3 cache layers; registry uses Steam official CN/EN names,
    //    the download-site title goes into the names variants list
    await setSteamCacheEntry(appId, result);
    await recordGameInRegistry(appId, {
      cnName: result.name,
      enName: result.englishName || result.name,
      gameName,
      tags: result.genres
    });
    await recordNameIndex(gameName, appId);

    return result;
  } catch (error) {
    console.error('Steam API 调用失败:', error);
    return null;
  }
}

// 轻量级Steam好评率查询（列表页用，复用缓存，仅获取好评率不做完整详情抓取）
async function getSteamPositiveRate(gameName) {
  if (!gameName) return null;

  // 1. 通过名称索引查找 appId（O(1)）
  //    Lookup appId via name index (O(1))
  const appId = await lookupAppIdByName(gameName);

  // 2. 若有 appId，检查 Steam 动态缓存（以 appId 为键）
  //    If appId known, check Steam dynamic cache (appId-keyed)
  let usableAppId = appId;
  if (appId) {
    const cached = await getSteamCacheEntry(appId);
    if (isSteamCacheValid(cached) && cached.data && cached.data.positiveRate !== undefined) {
      // 自愈：命中 Demo 版且无评测的缓存 → 视为无效，重新搜索完整版
      // Self-heal: Demo cache entry without rating → treat as invalid, re-search full version
      if (!isDemoCacheWithoutRating(cached.data)) {
        return {
          positiveRate: cached.data.positiveRate,
          ratingDesc: cached.data.ratingDesc || null,
          appId: cached.data.appId || appId,
          name: cached.data.name || gameName
        };
      }
      usableAppId = null;
    } else if (await isDemoAppId(appId)) {
      // 缓存缺失/过期且该 appId 是 Demo 版 → 重新搜索完整版
      //（直接查询 Demo 版只会得到 0 评测，显示错误的"暂无"）
      // Cache missing/expired and the appId is a Demo → re-search the full version
      // (querying the Demo directly only yields zero reviews → a wrong "N/A")
      usableAppId = null;
    }
  } else {
    // 3. 无 appId 时，检查 24h 负缓存 / No appId: check 24h negative cache
    if (await isRecentlySearchedNotFound(gameName)) {
      return null;
    }
  }

  try {
    // 4. 搜索 appId（若已有 appId 但缓存过期，跳过搜索直接获取评价）
    //    Search appId (skip if already known, just re-fetch review summary)
    let foundAppId = usableAppId;
    let foundName = gameName;
    let searchResult = null;
    if (!foundAppId) {
      searchResult = await searchSteamAppId(parseGameTitle(gameName));
      if (!searchResult) {
        // 记录负缓存 / Record negative cache
        await recordNameIndex(gameName, null);
        return null;
      }
      foundAppId = searchResult.appId;
      foundName = searchResult.name;
    }

    // 5. 获取评价统计（好评率）/ Fetch review summary (positive rate)
    const reviewSummary = await fetchReviewSummary(foundAppId);
    let positiveRate = null;
    let ratingDesc = null;
    if (reviewSummary) {
      ratingDesc = reviewSummary.desc || null;
      if (reviewSummary.total > 0) {
        positiveRate = Math.round(reviewSummary.positive / reviewSummary.total * 100);
      }
    }

    // 5.5 官方中英文名：搜索路径直接用搜索结果自带的英文名（零额外请求）；
    //     名称索引路径（无搜索）或 0 评测时，轻量获取官方名——同时用于
    //     Demo 验证（Demo 无完整评测会误报"暂无"）与注册表补全。
    //     Official CN/EN names: the search path reuses the search result's EN name
    //     (no extra requests); the index path (no search) or zero-review games fetch
    //     the official names lightly — used for both Demo detection and registry fill.
    let officialCn = foundName;
    let officialEn = searchResult ? (searchResult.englishName || foundName) : pickRegistryEnName(gameName, foundName);
    if (positiveRate === null) {
      const [cnData, enData] = await Promise.all([
        fetchSteamAppDetails(foundAppId, 'schinese').catch(() => null),
        fetchSteamAppDetails(foundAppId, 'english').catch(() => null)
      ]);
      officialCn = (cnData && cnData.name) || officialCn;
      officialEn = (enData && enData.name) || officialCn;
      const isDemo = /demo|试玩|trial/i.test(officialCn + ' ' + officialEn);
      if (isDemo) {
        // Demo 版：重新搜索完整版（搜索已排除 Demo）
        // Demo edition: re-search the full version (search already skips Demos)
        const reSearch = await searchSteamAppId(parseGameTitle(gameName));
        if (reSearch) {
          foundAppId = reSearch.appId;
          foundName = reSearch.name;
          officialCn = reSearch.name;
          officialEn = reSearch.englishName || officialCn;
          const rs2 = await fetchReviewSummary(foundAppId);
          if (rs2) {
            ratingDesc = rs2.desc || null;
            if (rs2.total > 0) positiveRate = Math.round(rs2.positive / rs2.total * 100);
          }
        }
      }
    }

    // 6. 合并写入 Steam 动态缓存（以 appId 为键，保留可能已有的完整数据）
    //    自愈场景（usableAppId 为 null）时不留存旧 Demo 数据，直接整体覆盖。
    //    Merge into Steam dynamic cache (appId-keyed, preserve any existing full data).
    //    In the self-heal case (usableAppId null) the old Demo entry is not kept.
    const existing = usableAppId ? ((await getSteamCacheEntry(usableAppId)) || {}).data || {} : {};
    const mergedData = { ...existing, appId: foundAppId, name: foundName, positiveRate, ratingDesc };
    await setSteamCacheEntry(foundAppId, mergedData);

    // 7. 同步更新游戏注册表和名称索引：cnName/enName 以 Steam 官方名为准，
    //    下载站标题入名称变体（兼容匹配）。
    //    Sync registry and name index: official CN/EN names, download-site title
    //    goes into the name variants (compatible matching).
    await recordGameInRegistry(foundAppId, {
      cnName: officialCn,
      enName: officialEn,
      gameName
    });
    await recordNameIndex(gameName, foundAppId);

    return { positiveRate, ratingDesc, appId: foundAppId, name: foundName };
  } catch (e) {
    console.log('获取Steam好评率失败:', e.message);
    return null;
  }
}

// ============ 11. 推荐算法引擎 / Recommendation Engine ============

// 关键词评分计算（提取为公共方法，消除重复逻辑）
function calculateKeywordScore(keywords, keywordWeights) {
  if (!keywords || keywords.length === 0) return null;
  let matchScore = 0;
  let matchCount = 0;
  keywords.forEach(kw => {
    if (keywordWeights[kw] !== undefined) {
      matchScore += keywordWeights[kw];
      matchCount++;
    }
  });
  return matchCount > 0 ? matchScore / matchCount : null;
}

async function calculateRecommendation(gameInfo, forceBuiltin = false) {
  const settings = await getSettings();
  const weights = settings.weights;

  // LLM 模式（非强制内置时）
  if (settings.useLLM && !forceBuiltin) {
    try {
      const llmScore = await calculateWithLLM(gameInfo, settings);
      if (llmScore !== null) return llmScore;
    } catch (e) {
      console.warn('LLM计算失败，回退到内置算法:', e);
    }
  }

  // 内置算法
  const data = await chrome.storage.local.get([
    DB_KEYS.BEHAVIOR_LOG,
    DB_KEYS.KEYWORD_WEIGHTS,
    DB_KEYS.GAME_PROFILES
  ]);

  const behaviorLog = data[DB_KEYS.BEHAVIOR_LOG] || [];
  const keywordWeights = data[DB_KEYS.KEYWORD_WEIGHTS] || {};
  const profiles = data[DB_KEYS.GAME_PROFILES] || {};

  // 1. 点击率得分
  let clickScore = 0.5;
  const totalViews = behaviorLog.filter(e => e.type === 'view_list').length;
  const totalClicks = behaviorLog.filter(e => e.type === 'view_detail').length;
  if (totalViews > 0) {
    clickScore = Math.min(totalClicks / totalViews, 1);
  }

  // 2. 下载率得分
  let downloadScore = 0.3;
  const gameKeywords = gameInfo.keywords || [];
  const kwDownloadScore = calculateKeywordScore(gameKeywords, keywordWeights);
  if (kwDownloadScore !== null) downloadScore = kwDownloadScore;

  // 3. 关键词匹配得分
  let keywordScore = 0.4;
  const kwMatchScore = calculateKeywordScore(gameKeywords, keywordWeights);
  if (kwMatchScore !== null) keywordScore = kwMatchScore;

  // 4. Steam评分得分
  let steamScore = 0.5;
  if (gameInfo.steamRating !== null && gameInfo.steamRating !== undefined) {
    steamScore = gameInfo.steamRating / 10;
  } else if (gameInfo.positiveRate !== null && gameInfo.positiveRate !== undefined) {
    steamScore = gameInfo.positiveRate / 100;
  }

  // 5. 历史画像加成（支持模糊匹配）
  const profileKey = (gameInfo.name || '').toLowerCase().trim();
  const cleanedKey = cleanGameName(gameInfo.name || '').toLowerCase().trim();
  let profileMatch = profiles[profileKey] || profiles[cleanedKey];

  if (!profileMatch && cleanedKey.length > 3) {
    for (const [key, profile] of Object.entries(profiles)) {
      if (key.includes(cleanedKey) || cleanedKey.includes(key) ||
          (key.length > 4 && cleanedKey.length > 4 &&
           (key.substring(0, 4) === cleanedKey.substring(0, 4)))) {
        profileMatch = profile;
        break;
      }
    }
  }

  if (profileMatch) {
    if (profileMatch.downloads > 0) {
      downloadScore = Math.min(downloadScore + 0.3, 1);
    }
    if (gameKeywords.length === 0 && profileMatch.keywords && profileMatch.keywords.length > 0) {
      const profileKwScore = calculateKeywordScore(profileMatch.keywords, keywordWeights);
      if (profileKwScore !== null) {
        keywordScore = profileKwScore;
        downloadScore = Math.max(downloadScore, profileKwScore);
      }
    }
  }

  // 加权计算最终得分
  const finalScore =
    clickScore * weights.clickRate +
    downloadScore * weights.downloadRate +
    keywordScore * weights.keywordMatch +
    steamScore * weights.steamRating;

  return {
    score: Math.round(finalScore * 100) / 100,
    breakdown: {
      clickScore: Math.round(clickScore * 100) / 100,
      downloadScore: Math.round(downloadScore * 100) / 100,
      keywordScore: Math.round(keywordScore * 100) / 100,
      steamScore: Math.round(steamScore * 100) / 100
    },
    method: 'builtin'
  };
}

// ============ LLM 计算 ============

async function calculateWithLLM(gameInfo, settings) {
  const { llmConfig } = settings;

  const kwData = await chrome.storage.local.get(DB_KEYS.KEYWORD_WEIGHTS);
  const keywordWeights = kwData[DB_KEYS.KEYWORD_WEIGHTS] || {};
  const topKeywords = Object.entries(keywordWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([kw, w]) => `${kw}(${Math.round(w * 100)}%)`)
    .join('、');

  const prompt = buildLLMPrompt(gameInfo, topKeywords);

  let response;
  // LLM 生成较慢，使用更长的超时时间（30s）避免请求挂起；
  // 端点为用户显式配置（可能是本地 Ollama），允许私有地址。
  // LLM generation is slow; use a longer timeout (30s) to avoid hanging.
  // The endpoint is user-configured (possibly a local Ollama), so private hosts are allowed.
  const LLM_FETCH_TIMEOUT = 30000;
  if (llmConfig.provider === 'local') {
    // Ollama 本地模型
    response = await fetchWithTimeout(llmConfig.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      allowPrivateHosts: true,
      body: JSON.stringify({
        model: llmConfig.model,
        prompt,
        stream: false,
        options: { temperature: llmConfig.temperature }
      })
    }, LLM_FETCH_TIMEOUT);
    const data = await response.json();
    return parseLLMResponse(data.response);
  } else {
    // OpenAI兼容接口
    response = await fetchWithTimeout(llmConfig.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${llmConfig.apiKey}`
      },
      allowPrivateHosts: true,
      body: JSON.stringify({
        model: llmConfig.model,
        messages: [
          { role: 'system', content: '你是一个游戏推荐评分系统。根据用户的游戏偏好和游戏信息，给出0-1之间的下载概率评分。只返回JSON格式：{"score": 0.85, "reason": "简短理由"}' },
          { role: 'user', content: prompt }
        ],
        temperature: llmConfig.temperature
      })
    }, LLM_FETCH_TIMEOUT);
    const data = await response.json();
    return parseLLMResponse(data.choices[0].message.content);
  }
}

function buildLLMPrompt(gameInfo, userKeywords) {
  return `请根据以下信息评估用户下载该游戏的概率（0-1）：

游戏名称：${gameInfo.name}
游戏类型：${(gameInfo.keywords || []).join('、') || '未知'}
游戏描述：${gameInfo.description || '无'}
Steam评分：${gameInfo.steamRating || '未知'}/10
Steam好评率：${gameInfo.positiveRate || '未知'}%

用户历史偏好关键词（括号内为匹配度）：${userKeywords || '学习中'}

请返回JSON格式：{"score": 数值, "reason": "理由"}`;
}

function parseLLMResponse(text) {
  try {
    const jsonMatch = text.match(/\{[\s\S]*?"score"[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        score: Math.max(0, Math.min(1, parsed.score)),
        reason: parsed.reason || '',
        method: 'llm'
      };
    }
  } catch (e) {
    console.warn('LLM响应解析失败:', e);
  }
  return null;
}

// ============ 12. 下载站搜索 / Download Site Search ============

function calcLinkMatchScore(linkText, searchName) {
  const norm = s => (s || '').toLowerCase().replace(/[\s\-_:：|\/\.''!！?？\[\]()（）]/g, '');
  const nt = norm(linkText);
  const ns = norm(searchName);
  if (!nt || !ns || nt.length < 2 || ns.length < 2) return 0;
  if (nt === ns) return 100;
  if (nt.includes(ns)) return 85;
  if (ns.includes(nt) && nt.length >= 4) return 70;

  // 分段比较（按 | 和 / 拆分的每一段）
  const segments = linkText.split(/[|\/]/).map(s => norm(s)).filter(s => s.length >= 2);
  for (const seg of segments) {
    if (seg === ns) return 95;
    if (seg.includes(ns)) return 80;
    if (ns.includes(seg) && seg.length >= 4) return 65;
  }

  // 跨语言匹配：分别提取中英文，独立比较
  // 用于处理 "History of Kingdoms: 三国志"(搜索名) vs "王国历史：三国志|...|History of Kingdoms: Three Kingdoms"(链接名)
  // 这种字符顺序不同但内容对应的情况
  function splitLang(s) {
    const en = (s.match(/[a-z][a-z0-9\s']+/gi) || []).map(m => norm(m)).filter(m => m.length >= 2);
    const cn = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf]+/g) || []).map(m => m).filter(m => m.length >= 2);
    return { en, cn };
  }

  const linkLang = splitLang(linkText);
  const searchLang = splitLang(searchName);

  let enScore = 0;
  let cnScore = 0;

  if (searchLang.en.length > 0 && linkLang.en.length > 0) {
    let bestEn = 0;
    for (const se of searchLang.en) {
      for (const le of linkLang.en) {
        if (le === se) { bestEn = Math.max(bestEn, 100); }
        else if (le.includes(se) && se.length >= 4) { bestEn = Math.max(bestEn, 85); }
        else if (se.includes(le) && le.length >= 4) { bestEn = Math.max(bestEn, 75); }
      }
    }
    enScore = bestEn;
  }

  if (searchLang.cn.length > 0 && linkLang.cn.length > 0) {
    let bestCn = 0;
    for (const sc of searchLang.cn) {
      for (const lc of linkLang.cn) {
        if (lc === sc) { bestCn = Math.max(bestCn, 100); }
        else if (lc.includes(sc) && sc.length >= 2) { bestCn = Math.max(bestCn, 85); }
        else if (sc.includes(lc) && lc.length >= 2) { bestCn = Math.max(bestCn, 75); }
      }
    }
    cnScore = bestCn;
  }

  if (enScore > 0 && cnScore > 0) {
    return Math.round((enScore + cnScore) / 2);
  }
  return Math.max(enScore, cnScore);
}

function extractDetailMeta(html, siteKey) {
  const meta = { updateDate: '', version: '', size: '', panUrl: '', panCode: '' };
  if (!html) return meta;

  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1Text = h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : '';

  // 更新日期
  const dateLabelMatch = html.match(/(?:更新时间|最近更新|发布日期)[^0-9]{0,15}([0-9]{4}[-\/年][0-9]{1,2}[-\/月][0-9]{1,2})/);
  if (dateLabelMatch) {
    meta.updateDate = dateLabelMatch[1].replace(/[年月]/g, '-').replace(/日$/, '');
  }

  // 版本 + 大小（按站点适配）
  if (siteKey === 'xdgame') {
    const verIntroMatch = html.match(/版本介绍<\/h[0-9]>\s*<p>([\s\S]*?)<\/p>/i);
    if (verIntroMatch) {
      const verLine = verIntroMatch[1].replace(/<[^>]+>/g, '');
      const vMatch = verLine.match(/\b([Vv]?\d+(?:\.\d+)+)\b/) || verLine.match(/(Build\.?\d+)/i);
      if (vMatch) meta.version = vMatch[1];
      const sizeMatch = verLine.match(/容量\s*([0-9.]+\s*(?:GB|MB|TB|G\b|M\b))/i);
      if (sizeMatch) meta.size = sizeMatch[1].trim();
    }
  }

  if (!meta.version && h1Text) {
    const h1Ver = h1Text.match(/\b([Vv]\d+(?:\.\d+)+)\b/) || h1Text.match(/(Build\.?\d+)/i);
    if (h1Ver) meta.version = h1Ver[1];
  }

  if (!meta.size) {
    const sizeLabelMatch = html.match(/(?:容量|游戏大小|文件大小|资源大小)[^0-9]{0,10}([0-9.]+\s*(?:GB|MB|TB))/i);
    if (sizeLabelMatch) meta.size = sizeLabelMatch[1].trim();
  }

  // 提取网盘链接（百度/阿里/115/夸克/微云）
  // 支持 <a href="..."> 和纯文本两种形式
  const panUrlPattern = /https?:\/\/(?:pan\.baidu\.com\/(?:s\/[\w-]+|share\/init\?surl=[\w-]+)|aliyundrive\.com\/s\/[\w]+|alipan\.com\/s\/[\w]+|115\.com\/s\/[\w-]+|quark\.cn\/s\/[\w]+|weiyun\.com\/[\w]+)/i;
  const panUrlMatch = html.match(panUrlPattern);
  if (panUrlMatch) {
    meta.panUrl = panUrlMatch[0].replace(/&amp;/g, '&');

    // 在网盘链接附近查找提取码（前后各扩大一段范围）
    const idx = html.indexOf(panUrlMatch[0]);
    const nearby = html.substring(Math.max(0, idx - 300), idx + panUrlMatch[0].length + 500);
    const codeMatch = nearby.match(/(?:提取码|密码|访问码|pwd|access\s*code)[：:\s]*([a-zA-Z0-9]{4,6})/i);
    if (codeMatch) meta.panCode = codeMatch[1];
  }

  return meta;
}

async function searchDownloadSites(gameName, appId, siteKeys = null) {
  const results = [];
  // 仅检索指定的站点（siteKeys 为 null 时检索全部启用的下载站）
  // Only search the given sites (siteKeys = null → all configured sites)
  const sitesToSearch = siteKeys
    ? DOWNLOAD_SITES.filter(s => siteKeys.includes(s.key))
    : DOWNLOAD_SITES;
  // 生成多个搜索词，按优先级排序，依次尝试
  // 1. 清洗后的主名  2. parseGameTitle 的所有候选  3. 原始名
  const searchTerms = [];
  const seenTerms = new Set();
  function addTerm(t) {
    const key = t.toLowerCase().trim();
    if (key.length >= 2 && !seenTerms.has(key)) {
      seenTerms.add(key);
      searchTerms.push(t);
    }
  }
  addTerm(cleanGameName(gameName) || gameName);
  parseGameTitle(gameName).forEach(t => addTerm(t));
  addTerm(gameName);

  for (const site of sitesToSearch) {
    const primaryTerm = searchTerms[0];
    const result = {
      key: site.key, name: site.name, found: false,
      detailUrl: '', searchUrl: site.searchUrl(primaryTerm),
      updateDate: '', version: '', size: '', panUrl: '', panCode: ''
    };
    try {
      // 依次尝试每个搜索词，找到匹配就停止
      let bestUrl = '';
      let bestScore = 0;
      let usedTerm = primaryTerm;

      for (let termIdx = 0; termIdx < searchTerms.length; termIdx++) {
        const term = searchTerms[termIdx];
        const resp = await fetchWithTimeout(site.searchUrl(term), {
          headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' }
        });
        if (!resp.ok) continue;
        const html = await resp.text();

        // 提取候选详情链接
        const candidates = [];
        const linkRe = /<a[^>]*href="([^"]*(?:\/\d+\.html?|\/game\/\d+[^"]*))"[^>]*>([\s\S]*?)<\/a>/gi;
        let lm;
        while ((lm = linkRe.exec(html)) !== null) {
          const href = lm[1];
          const text = lm[2].replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
          candidates.push({ href, text });
        }

        // 按文本匹配度选出最符合游戏名的链接
        for (const c of candidates) {
          // 用所有搜索词+原始名计算最高分
          let maxScore = 0;
          for (const t of searchTerms) {
            maxScore = Math.max(maxScore, calcLinkMatchScore(c.text, t));
          }
          maxScore = Math.max(maxScore, calcLinkMatchScore(c.text, gameName));
          if (maxScore > bestScore) {
            bestScore = maxScore;
            bestUrl = c.href;
            usedTerm = term;
          }
        }

        // 已经找到高分匹配，不再尝试更多搜索词
        if (bestScore >= 80) break;
      }

      // 更新搜索URL为实际使用的那个
      result.searchUrl = site.searchUrl(usedTerm);

      if (bestUrl && bestScore >= 60) {
        const detailUrl = bestUrl.startsWith('http') ? bestUrl : site.base + (bestUrl.startsWith('/') ? '' : '/') + bestUrl;
        result.found = true;
        result.detailUrl = detailUrl;
        // 记录到下载站网址缓存（以 appId 为键，30天有效，新网址替代旧网址）
        // Record to download URL cache (appId-keyed, 30-day TTL, new URL replaces old)
        if (appId) {
          await recordDownloadUrl(appId, site.key, site.name, detailUrl);
        }
        try {
          const dResp = await fetchWithTimeout(detailUrl, { headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' } });
          if (dResp.ok) {
            const dHtml = await dResp.text();
            const meta = extractDetailMeta(dHtml, site.key);
            result.updateDate = meta.updateDate;
            result.version = meta.version;
            result.size = meta.size;
            result.panUrl = meta.panUrl;
            result.panCode = meta.panCode;
            // 百度网盘自动拼接提取码
            if (result.panUrl && result.panCode && /pan\.baidu\.com/i.test(result.panUrl)) {
              result.panUrl = buildBaiduPanUrlWithPwd(result.panUrl, result.panCode);
            }
          }
        } catch (e) {
          // 详情页元信息抓取失败不影响搜索结果 / Detail-page meta fetch failure doesn't affect search results
          console.log(`获取${site.name}详情页元信息失败:`, e.message);
        }
      }
    } catch (e) {
      console.log(`搜索${site.name}失败:`, e.message);
    }
    results.push(result);
  }
  return results;
}

// ============ 12.5 百度网盘链接工具 / Baidu Pan URL Builder ============
// Concatenates extraction code into Baidu Pan URL for auto-fill.
// 将提取码拼接到百度网盘链接，支持打开后自动填充。
// Note: Deep extraction (chrome.tabs + chrome.scripting) was removed in v1.1.
// 注意：深度提取功能（后台标签页方式）已于 v1.1 移除，仅保留链接拼接工具。

// 百度网盘链接拼接提取码，支持自动填充 / Build Baidu Pan URL with extraction code
function buildBaiduPanUrlWithPwd(url, pwd) {
  if (!url || !pwd) return url;
  try {
    const u = new URL(url);
    // 安全检查：只允许百度网盘域名
    if (!/pan\.baidu\.com$/i.test(u.hostname)) {
      console.warn('buildBaiduPanUrlWithPwd: 非百度网盘链接被拒绝:', url);
      return url;
    }
    // 已经有pwd参数则不重复添加
    if (u.searchParams.has('pwd')) return url;
    u.searchParams.set('pwd', pwd);
    return u.toString();
  } catch (e) {
    // URL解析失败，简单拼接
    if (url.includes('?')) {
      return url + '&pwd=' + encodeURIComponent(pwd);
    } else {
      return url + '?pwd=' + encodeURIComponent(pwd);
    }
  }
}

// ============ 13. 限免游戏 / Free Games ============

async function fetchEpicFreeGames() {
  const games = [];
  try {
    const url = 'https://store-site-backend-official.ak.epicgames.com/freeGamesPromotions?locale=zh-CN&country=CN&allowCountries=CN';
    // 带超时获取，避免外部 API 挂起拖垮 SW / Timeout-wrapped fetch to avoid hanging the SW
    const resp = await fetchWithTimeout(url);
    const data = await resp.json();
    const elements = data?.data?.Catalog?.searchStore?.elements || [];
    for (const el of elements) {
      const promo = el.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0];
      if (!promo) continue;
      const now = Date.now();
      const start = new Date(promo.startDate).getTime();
      const end = new Date(promo.endDate).getTime();
      if (now < start || now > end) continue;

      const img = el.keyImages?.find(i => i.type === 'OfferImageWide')?.url ||
                  el.keyImages?.[0]?.url || '';
      games.push({
        id: 'epic-' + el.id,
        platform: 'epic',
        platformName: 'Epic Games',
        claimType: 'direct',
        source: 'Epic Games Store',
        name: el.title,
        description: el.description || '',
        image: img,
        url: `https://store.epicgames.com/zh-CN/p/${el.productSlug || el.urlSlug}`,
        originalPrice: el.price?.totalPrice?.fmtPrice?.originalPrice || '',
        endTime: promo.endDate,
        claimed: false
      });
    }
  } catch (e) {
    console.log('Epic限免获取失败:', e.message);
  }
  return games;
}

async function fetchGogFreeGames() {
  const games = [];
  try {
    const resp = await fetchWithTimeout('https://www.gog.com/games/ajax/filtered?mediaType=game&price=free&limit=25', {
      headers: { 'Accept': 'application/json' }
    });
    if (!resp.ok) return games;
    const data = await resp.json();
    const products = data?.products || [];
    for (const p of products.slice(0, 10)) {
      games.push({
        id: 'gog-' + p.id,
        platform: 'gog',
        platformName: 'GOG',
        claimType: 'direct',
        source: 'GOG',
        name: p.title,
        description: '',
        image: p.image ? `https:${p.image}.jpg` : '',
        url: `https://www.gog.com${p.url}`,
        originalPrice: p.price?.finalPrice ? `¥${p.price.finalPrice}` : '免费',
        endTime: '',
        claimed: false
      });
    }
  } catch (e) {
    console.log('GOG限免获取失败:', e.message);
  }
  return games;
}

async function fetchSteamFreeGames() {
  const games = [];
  try {
    const resp = await fetchWithTimeout('https://store.steampowered.com/api/featuredcategories/?l=schinese&cc=cn');
    if (!resp.ok) return games;
    const data = await resp.json();
    const specials = data?.specials?.items || [];
    for (const item of specials) {
      if (item.final_price === 0 || item.discount_percent === 100) {
        games.push({
          id: 'steam-' + item.id,
          platform: 'steam',
          platformName: 'Steam',
          claimType: 'direct',
          source: 'Steam',
          name: item.name,
          description: '',
          image: item.large_capsule_image || item.small_capsule_image || '',
          url: `https://store.steampowered.com/app/${item.id}/`,
          originalPrice: item.final_price === 0 ? '免费' : '',
          endTime: '',
          claimed: false
        });
      }
    }
  } catch (e) {
    console.log('Steam限免获取失败:', e.message);
  }
  return games;
}

function classifyGamerPowerGiveaway(item) {
  const title = (item.title || '').toLowerCase();
  const instructions = (item.instructions || '').toLowerCase();

  const hasKeyInTitle = /\bkey\b/.test(title);
  const thirdPartySignals = [
    'alienware', 'unlock your key', 'get your key', 'redeem the key',
    'redeem your key', 'indiegala', 'humble bundle', 'fanatical',
    'grabfree', 'key giveaway', 'claim your key', 'your free key'
  ];
  const hasThirdPartyInstruction = thirdPartySignals.some(kw => instructions.includes(kw));

  if (hasKeyInTitle || hasThirdPartyInstruction) return 'thirdparty';
  return 'direct';
}

function extractThirdPartySource(item) {
  const instructions = (item.instructions || '').toLowerCase();
  if (instructions.includes('alienware')) return 'Alienware Arena';
  if (instructions.includes('indiegala')) return 'IndieGala';
  if (instructions.includes('humble')) return 'Humble Bundle';
  if (instructions.includes('fanatical')) return 'Fanatical';
  return '第三方平台';
}

async function fetchGamerPowerFreeGames() {
  const games = [];
  try {
    const resp = await fetchWithTimeout('https://www.gamerpower.com/api/giveaways');
    if (!resp.ok) return games;
    const data = await resp.json();
    if (!Array.isArray(data)) return games;

    for (const item of data) {
      const platforms = (item.platforms || '').toLowerCase();
      let platform = 'other';
      let platformName = '其他';
      if (platforms.includes('epic')) { platform = 'epic'; platformName = 'Epic Games'; }
      else if (platforms.includes('steam')) { platform = 'steam'; platformName = 'Steam'; }
      else if (platforms.includes('gog')) { platform = 'gog'; platformName = 'GOG'; }
      else if (platforms.includes('itch')) { platform = 'itch'; platformName = 'Itch.io'; }
      else if (platforms.includes('drm-free') || platforms.includes('pc')) { platform = 'pc'; platformName = 'PC'; }

      if (platform === 'other') continue;

      const claimType = classifyGamerPowerGiveaway(item);
      const source = claimType === 'thirdparty' ? extractThirdPartySource(item) : platformName;

      games.push({
        id: 'gp-' + item.id,
        platform,
        platformName,
        claimType,
        source,
        name: item.title || '',
        description: item.description || '',
        image: item.image || '',
        url: item.open_giveaway_url || item.giveaway_url || '',
        originalPrice: item.worth || '',
        endTime: (item.end_date && item.end_date !== 'N/A') ? item.end_date : '',
        claimed: false
      });
    }
  } catch (e) {
    console.log('GamerPower限免获取失败:', e.message);
  }
  return games;
}

async function fetchAllFreeGames() {
  const [epic, gog, steam, gamerpower] = await Promise.all([
    fetchEpicFreeGames(),
    fetchGogFreeGames(),
    fetchSteamFreeGames(),
    fetchGamerPowerFreeGames()
  ]);

  const merged = [...epic, ...gog, ...steam];
  const seenNames = new Set(merged.map(g => normalizeGameName(g.name)));

  for (const gp of gamerpower) {
    const norm = normalizeGameName(gp.name);
    if (!seenNames.has(norm)) {
      seenNames.add(norm);
      merged.push(gp);
    }
  }

  return merged;
}

function normalizeGameName(name) {
  return (name || '').toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/giveaway|free|限免|领取/gi, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
    .trim();
}

async function refreshFreeGames(force = false) {
  const data = await chrome.storage.local.get(DB_KEYS.FREE_GAMES);
  const existing = data[DB_KEYS.FREE_GAMES] || { lastUpdate: 0, games: [] };

  const ONE_DAY = 24 * 3600 * 1000;
  if (!force && existing.lastUpdate && (Date.now() - existing.lastUpdate < ONE_DAY)) {
    await updateFreeGamesBadge();
    return existing;
  }

  const newGames = await fetchAllFreeGames();
  const existingMap = new Map(existing.games.map(g => [g.id, g]));
  const now = Date.now();
  newGames.forEach(g => {
    const old = existingMap.get(g.id);
    if (old) {
      g.claimed = old.claimed || false;
      g.firstSeen = old.firstSeen || now;
    } else {
      g.firstSeen = now;
    }
  });

  const result = { lastUpdate: now, games: newGames };
  await chrome.storage.local.set({ [DB_KEYS.FREE_GAMES]: result });
  await updateFreeGamesBadge();
  return result;
}

async function updateFreeGamesBadge() {
  try {
    const data = await chrome.storage.local.get(DB_KEYS.FREE_GAMES);
    const games = data[DB_KEYS.FREE_GAMES]?.games || [];
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();
    const newToday = games.filter(g => g.firstSeen && g.firstSeen >= todayStartMs).length;
    chrome.action.setBadgeText({ text: newToday > 0 ? String(newToday) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
  } catch (e) {
    console.log('更新badge失败:', e.message);
  }
}

// ============ 14. 消息处理 / Message Handlers ============

// --- 下载历史管理 / Download History Management ---
async function getDownloadHistory() {
  const data = await chrome.storage.local.get(DB_KEYS.DOWNLOAD_HISTORY);
  return data[DB_KEYS.DOWNLOAD_HISTORY] || {};
}

async function saveDownloadHistory(history) {
  await chrome.storage.local.set({ [DB_KEYS.DOWNLOAD_HISTORY]: history });
}

// 从domain推断站点key和名称
function inferSiteFromDomain(domain) {
  if (!domain) return { key: 'unknown', name: '未知站点' };
  if (domain.includes('xdgame')) return { key: 'xdgame', name: 'XDGame' };
  if (domain.includes('xianyudanji')) return { key: 'xianyudanji', name: '咸鱼单机' };
  if (domain.includes('gamer520') || domain.includes('gamers520')) return { key: 'gamer520', name: 'Gamer520' };
  return { key: 'unknown', name: domain };
}

async function recordDownloadHistory(data) {
  if (!data.gameName) return;
  const gameName = data.gameName.trim();
  if (gameName.length < 2) return;

  const history = await getDownloadHistory();
  const existing = history[gameName] || { totalDownloads: 0 };
  const siteInfo = inferSiteFromDomain(data.domain);

  history[gameName] = {
    ...existing,
    lastDownloadTime: Date.now(),
    lastDownloadSite: data.siteKey || siteInfo.key,
    lastDownloadSiteName: data.siteName || siteInfo.name,
    lastDownloadUrl: data.detailUrl || data.url || '',
    lastPanUrl: data.downloadUrl || '',
    totalDownloads: (existing.totalDownloads || 0) + 1
  };

  // 限制历史记录数量（最多保留200条）
  const keys = Object.keys(history);
  if (keys.length > 200) {
    const sorted = keys.sort((a, b) =>
      (history[b].lastDownloadTime || 0) - (history[a].lastDownloadTime || 0)
    );
    for (let i = 200; i < sorted.length; i++) {
      delete history[sorted[i]];
    }
  }

  await saveDownloadHistory(history);
}

async function handleGetDownloadHistory(message) {
  const history = await getDownloadHistory();
  if (message.gameName) {
    return { record: history[message.gameName] || null };
  }
  return { history };
}

// 详情页访问记录：把当前详情页网址记录到该 appId 的下载站网址缓存，
// 并更新 lastAccessed，供游戏缓存管理页展示"上次调用"。
// 此前详情页访问不会写 downloadUrls 缓存，导致管理页调用记录为空。
// Record a detail-page visit: save the current page URL into the appId's
// download-URL cache and refresh lastAccessed, powering the "last accessed"
// column in the game-cache page. Previously detail-page visits never wrote
// the downloadUrls cache, so the cache page showed no access records.
async function handleTrackDownloadSiteVisit(message) {
  const data = message.data || {};
  const appId = data.appId;
  const url = data.url || '';
  if (!appId || !url) return { success: false };
  const siteInfo = inferSiteFromDomain(data.domain || '');
  if (siteInfo.key === 'unknown') return { success: false };
  await recordDownloadUrl(String(appId), siteInfo.key, siteInfo.name, url);
  return { success: true };
}

// 列表页批量记录：一条消息写入多个 appId 的下载页地址（含站点推断）
// List-page batch record: write many appId → detail-page URL mappings in one message
async function handleRecordDownloadUrlsBatch(message) {
  const data = message.data || {};
  const siteInfo = inferSiteFromDomain(data.domain || '');
  if (siteInfo.key === 'unknown') return { success: false };
  await recordDownloadUrlsBatch(siteInfo.key, siteInfo.name, data.entries || []);
  return { success: true };
}

// --- 各消息类型的独立 handler / Individual message handlers ---

async function handleTrackEvent(message) {
  await addBehaviorLog(message.data);

  if (message.data.type === 'click_download') {
    await updateGameProfile({
      name: message.data.gameName,
      event: 'download',
      keywords: message.data.keywords
    });
    // 记录下载历史
    await recordDownloadHistory(message.data);
    Logger.info('Download', `下载"${message.data.gameName}"`, { method: message.data.method, domain: message.data.domain });
  }
  if (message.data.type === 'view_detail') {
    await updateGameProfile({
      name: message.data.gameName,
      event: 'view',
      keywords: message.data.keywords
    });
  }
  // Steam标签回写
  if (message.data.type === 'steam_tags_update') {
    await updateGameProfile({
      name: message.data.gameName,
      event: 'view',
      keywords: message.data.keywords,
      steamAppId: message.data.steamAppId,
      steamRating: message.data.steamRating
    });
  }
  // 节流更新偏好模型；下载事件强制刷新（更具信号价值）
  // Throttled preference update; force-refresh on downloads (stronger signal)
  await maybeUpdatePreferences(message.data.type === 'click_download');
  return { success: true };
}

async function handleGetRecommendations(message) {
  const games = message.games || [];
  const useBuiltinOnly = games.length > 1; // 批量时强制内置算法
  const results = [];
  for (const game of games) {
    const score = await calculateRecommendation(game, useBuiltinOnly);
    results.push({ ...game, recommendation: score });
  }
  return { results };
}

async function handleSearchSteam(message) {
  const steamResult = await searchSteamGame(message.gameName);
  if (steamResult) {
    Logger.info('Steam', `匹配"${message.gameName}" → ${steamResult.name}`, { appId: steamResult.appId, rating: steamResult.ratingDesc });
  } else {
    Logger.warn('Steam', `未找到"${message.gameName}"`);
  }
  // 详情页单游戏查询也写入缓存，强制刷新以防丢失
  // Single-game query also writes cache; force flush to avoid data loss
  await flushSteamCache();
  await flushNameIndex();
  await flushRegistry();
  // 返回缓存时间戳供详情页浮窗显示"缓存于 xx 分钟前"（以 appId 为键）
  // Return cache timestamp (appId-keyed) for the detail panel's "cached xx minutes ago"
  const cachedEntry = steamResult ? await getSteamCacheEntry(steamResult.appId) : null;
  return { data: steamResult, cachedAt: cachedEntry ? cachedEntry.timestamp : null };
}

// 强制刷新单个游戏的 Steam 缓存：删除缓存条目后重新抓取，供详情页"手动更新"按钮调用。
// Force refresh a single game's Steam cache: delete the entry then re-fetch,
// invoked by the detail panel's "manual update" button.
async function handleRefreshSteamCache(message) {
  // 通过名称索引查找 appId，以 appId 为键删除缓存
  // Lookup appId via name index, delete cache by appId key
  const appId = await lookupAppIdByName(message.gameName);
  if (appId) {
    await loadSteamCacheToMemory();
    steamCacheMemory.delete(appId);
  }
  const steamResult = await searchSteamGame(message.gameName);
  await flushSteamCache();
  await flushNameIndex();
  await flushRegistry();
  const cachedEntry = steamResult ? await getSteamCacheEntry(steamResult.appId) : null;
  if (steamResult) {
    Logger.info('Steam', `手动刷新缓存"${message.gameName}" → ${steamResult.name}`, { appId: steamResult.appId });
  }
  return { data: steamResult, cachedAt: cachedEntry ? cachedEntry.timestamp : null };
}

// 直接通过 appId 获取 Steam 详情（绕过名称搜索）
// 当下载站图片 URL 中包含 Steam appId 时，可直接用此接口获取详情，
// 无需依赖标题提取和搜索匹配，大幅提高准确率和响应速度。
// Fetch Steam details directly by appId (bypasses name search).
// When a download site's image URL contains the Steam appId, use this to get
// details without relying on title extraction or search matching.
async function handleGetSteamByAppId(message) {
  const appId = message.appId;
  const gameName = message.gameName || '';

  // 1. 检查 Steam 动态缓存（以 appId 为键，24h 有效）
  //    Check Steam dynamic cache (appId-keyed, 24h TTL)
  const cached = await getSteamCacheEntry(appId);
  if (isSteamCacheValid(cached) && cached.data && cached.data.url && cached.data.appId) {
    return { data: cached.data, cachedAt: cached.timestamp };
  }

  try {
    // 2. 直接获取完整详情（跳过搜索步骤，复用公共方法）
    //    Fetch full details directly (skip search, reuse shared helper)
    const result = await fetchSteamFullDetailsByAppId(appId);
    if (!result) return { data: null, cachedAt: null };

    // 3. 写入三层缓存：Steam 动态缓存 + 游戏注册表 + 名称索引
    //    注册表以 Steam 官方中英文名为准
    //    Write to all 3 cache layers; registry uses Steam official CN/EN names
    await setSteamCacheEntry(appId, result);
    await recordGameInRegistry(appId, {
      cnName: result.name,
      enName: result.englishName || result.name,
      gameName,
      tags: result.genres
    });
    if (gameName) await recordNameIndex(gameName, appId);

    await flushSteamCache();
    await flushNameIndex();
    await flushRegistry();
    const newEntry = await getSteamCacheEntry(appId);
    Logger.info('Steam', `通过 appId ${appId} 直接获取: ${result.name}`);
    return { data: result, cachedAt: newEntry ? newEntry.timestamp : null };
  } catch (e) {
    Logger.error('Steam', `通过 appId ${appId} 获取失败: ${e.message}`);
    return { data: null, cachedAt: null };
  }
}

// 保存用户手动选择的"游戏名→appId"映射（v5 起写入名称索引和游戏注册表）
// 当自动搜索无法匹配时，用户可从候选列表中手动选择正确游戏，
// 映射被持久化后，后续搜索同一游戏名时可直接通过名称索引命中 appId。
// Persist a user-selected "gameName→appId" mapping (v5: writes to name index + registry).
// When auto-search fails, the user picks the correct game from candidates;
// the mapping is persisted so future searches for the same name hit the appId directly.
async function handleSaveManualMapping(message) {
  const gameName = (message.gameName || '').trim();
  const appId = message.appId;
  if (!gameName || !appId) return { success: false };

  // 写入名称索引和游戏注册表 / Write to name index and game registry
  await recordNameIndex(gameName, appId);
  await recordGameInRegistry(appId, { cnName: gameName, gameName });
  await flushNameIndex();
  await flushRegistry();
  Logger.info('Steam', `保存手动映射: "${gameName}" → appId ${appId}`);
  return { success: true };
}

// 搜索候选游戏列表（用于手动选择浮窗）
// 返回多个候选结果供用户选择，而不是只返回第一个匹配。
// Search candidate games (for the manual-select panel).
// Returns multiple candidates for the user to choose from.
async function handleSearchSteamCandidates(message) {
  const searchTerms = parseGameTitle(message.gameName || '');
  const candidates = [];
  const seen = new Set();
  for (const term of searchTerms.slice(0, 3)) {
    const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=schinese&cc=cn`;
    try {
      const response = await fetchWithTimeout(searchUrl);
      const data = await response.json();
      if (data.total > 0 && data.items) {
        for (const item of data.items) {
          if (!seen.has(item.id)) {
            seen.add(item.id);
            candidates.push({
              appId: item.id,
              name: item.name,
              price: item.price ? item.price.final / 100 : null,
              image: item.tiny_image || ''
            });
          }
        }
      }
    } catch (e) {}
  }
  return { candidates: candidates.slice(0, 10) };
}

async function handleGetSteamRatings(message) {
  const ratingNames = message.names || [];
  const ratings = {};
  const batchSize = 5;
  for (let i = 0; i < ratingNames.length; i += batchSize) {
    const batch = ratingNames.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(async (name) => {
      try {
        const r = await getSteamPositiveRate(name);
        return [name, r];
      } catch (e) {
        return [name, null];
      }
    }));
    batchResults.forEach(([name, r]) => { ratings[name] = r; });
  }
  // 批量查询结束，强制写入缓存以防 SW 休眠导致数据丢失
  // Force flush after batch queries to persist before SW may go dormant
  await flushSteamCache();
  await flushNameIndex();
  await flushRegistry();
  return { ratings };
}

// 预热Steam缓存：与 GET_STEAM_RATINGS 相同的查询逻辑，但以更小批次、更低优先级
// 运行，仅填充缓存不返回数据，供列表页预载下一页使用。
// 效率优化：先过滤掉已有有效缓存或处于负缓存期的名称，只对真正需要的名称发请求，
// 大幅减少翻页时的 API 调用（翻页后几乎全部命中缓存）。
// Prefetch Steam cache: same query logic as GET_STEAM_RATINGS but with smaller
// batches and lower priority; only fills cache without returning data.
// Efficiency: names with a valid cache entry or inside the negative-cache window
// are filtered out first, so only genuinely missing data triggers API calls
// (nearly all hits after flipping to the next page).
async function handlePrefetchSteamRatings(message) {
  const ratingNames = message.names || [];
  if (ratingNames.length === 0) return { success: true };

  // 过滤：跳过已有有效缓存 / 负缓存期内的名称
  // Filter: skip names already cached or inside the negative-cache window
  const needsPrefetch = [];
  for (const name of ratingNames) {
    try {
      const appId = await lookupAppIdByName(name);
      if (appId) {
        const cached = await getSteamCacheEntry(appId);
        if (isSteamCacheValid(cached) && cached.data && cached.data.positiveRate !== undefined) continue;
        needsPrefetch.push(name); // 有 appId 但缓存过期/缺失 → 仍需预载
      } else if (await isRecentlySearchedNotFound(name)) {
        continue; // 负缓存期内，跳过 / within negative-cache window, skip
      } else {
        needsPrefetch.push(name);
      }
    } catch (e) {
      needsPrefetch.push(name);
    }
  }
  if (needsPrefetch.length === 0) return { success: true };

  const batchSize = 6; // 并发批次：平衡网络与 SW 压力 / batch size balancing network and SW load
  for (let i = 0; i < needsPrefetch.length; i += batchSize) {
    const batch = needsPrefetch.slice(i, i + batchSize);
    await Promise.all(batch.map(async (name) => {
      try { await getSteamPositiveRate(name); } catch (e) {}
    }));
  }
  // 预载结束，强制写入缓存 / Force flush after prefetch to persist
  await flushSteamCache();
  await flushNameIndex();
  await flushRegistry();
  return { success: true };
}

async function handleGetSettings() {
  return { settings: await getSettings() };
}

async function handleSaveSettings(message) {
  await saveSettings(message.settings);
  return { success: true };
}

async function handleResetSettings() {
  // 恢复默认设置（保留 trackedSites 之外的运行时数据不变）
  // Reset to default settings (runtime data other than settings is untouched)
  await saveSettings({ ...DEFAULT_SETTINGS });
  return { success: true, settings: { ...DEFAULT_SETTINGS } };
}

async function handleGetStats() {
  const log = await getBehaviorLog();
  const profilesData = await chrome.storage.local.get(DB_KEYS.GAME_PROFILES);
  const kwData = await chrome.storage.local.get(DB_KEYS.KEYWORD_WEIGHTS);
  const profiles = profilesData[DB_KEYS.GAME_PROFILES] || {};
  const keywordWeights = kwData[DB_KEYS.KEYWORD_WEIGHTS] || {};

  const viewDetailCount = log.filter(e => e.type === 'view_detail').length;
  const downloadCount = log.filter(e => e.type === 'click_download').length;
  const listViewCount = log.filter(e => e.type === 'view_list').length;

  const gameList = Object.values(profiles)
    .sort((a, b) => b.downloads - a.downloads || b.views - a.views)
    .slice(0, 50);

  const downloadMethods = {};
  log.filter(e => e.type === 'click_download').forEach(e => {
    const method = e.method || 'unknown';
    downloadMethods[method] = (downloadMethods[method] || 0) + 1;
  });

  return {
    totalEvents: log.length,
    totalGames: Object.keys(profiles).length,
    viewDetailCount,
    downloadCount,
    listViewCount,
    downloadRate: viewDetailCount > 0 ? Math.round(downloadCount / viewDetailCount * 100) : 0,
    topKeywords: Object.entries(keywordWeights)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([kw, weight]) => ({ keyword: kw, weight })),
    gameList,
    downloadMethods,
    recentLog: log.slice(-30).reverse()
  };
}

async function handleGetSteamRecommendations() {
  const kwData = await chrome.storage.local.get(DB_KEYS.KEYWORD_WEIGHTS);
  const weights = kwData[DB_KEYS.KEYWORD_WEIGHTS] || {};
  const topTags = Object.entries(weights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([kw]) => kw);

  if (topTags.length === 0) {
    return { games: [], message: '还没有足够的学习数据，请先浏览一些游戏网站' };
  }

  try {
    const recGames = [];
    for (const tag of topTags.slice(0, 3)) {
      const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(tag)}&l=schinese&cc=cn`;
      const resp = await fetchWithTimeout(searchUrl);
      const data = await resp.json();

      if (data.total > 0 && data.items) {
        for (const item of data.items.slice(0, 4)) {
          if (recGames.some(g => g.appId === item.id)) continue;

          let detail = null;
          try {
            const detUrl = `https://store.steampowered.com/api/appdetails?appids=${item.id}&l=schinese&filters=basic,price_overview`;
            const detResp = await fetchWithTimeout(detUrl);
            const detData = await detResp.json();
            if (detData[item.id]?.success) {
              detail = detData[item.id].data;
            }
          } catch (e) {
        console.log(`搜索候选"${term}"失败:`, e.message);
      }

          recGames.push({
            appId: item.id,
            name: detail?.name || item.name,
            image: detail?.header_image || `https://cdn.akamai.steamstatic.com/steam/apps/${item.id}/header.jpg`,
            price: detail?.price_overview ? detail.price_overview.final_formatted : '免费',
            reviewSummary: '',
            url: `https://store.steampowered.com/app/${item.id}/`,
            matchTags: [tag]
          });
        }
      }
      if (recGames.length >= 9) break;
    }

    return { games: recGames.slice(0, 9), basedOnTags: topTags };
  } catch (e) {
    console.error('Steam推荐失败:', e);
    return { games: [], error: '获取Steam推荐失败: ' + e.message };
  }
}

async function handleClearData() {
  await chrome.storage.local.remove([
    DB_KEYS.BEHAVIOR_LOG,
    DB_KEYS.GAME_PROFILES,
    DB_KEYS.KEYWORD_WEIGHTS,
    DB_KEYS.STEAM_CACHE,
    DB_KEYS.GAME_REGISTRY,
    DB_KEYS.NAME_INDEX,
    DB_KEYS.DOWNLOAD_URLS,
    DB_KEYS.MANUAL_MAPPINGS
  ]);
  // 重置所有内存缓存，避免清除后仍命中旧数据 / Reset all in-memory caches
  steamCacheMemory = null;
  steamCacheMemoryLoaded = false;
  if (steamCacheWriteTimer) { clearTimeout(steamCacheWriteTimer); steamCacheWriteTimer = null; }
  nameIndexMemory = null;
  nameIndexMemoryLoaded = false;
  if (nameIndexWriteTimer) { clearTimeout(nameIndexWriteTimer); nameIndexWriteTimer = null; }
  registryMemory = null;
  registryMemoryLoaded = false;
  if (registryWriteTimer) { clearTimeout(registryWriteTimer); registryWriteTimer = null; }
  return { success: true };
}

async function handleSearchDownloadSites(message, sender) {
  // 仅检索设置中勾选的下载站（Steam 详情页资源检索范围可自定义）
  // Only search the sites enabled in settings (customizable Steam-page scope)
  const settings = await getSettings();
  const enabledKeys = settings.steamSiteSearch || DOWNLOAD_SITES.map(s => s.key);
  const sites = await searchDownloadSites(message.gameName, message.appId, enabledKeys);
  Logger.info('DownloadSites', `搜索"${message.gameName}"`, { found: sites.filter(s => s.found).map(s => s.key) });

  return { sites };
}

async function handleGetFreeGames(message) {
  const freeData = await refreshFreeGames(message.force === true);
  Logger.info('FreeGames', `获取限免游戏`, { count: freeData.games ? freeData.games.length : 0 });
  return { data: freeData };
}

async function handleClaimFreeGame(message) {
  const fgData = await chrome.storage.local.get(DB_KEYS.FREE_GAMES);
  const fg = fgData[DB_KEYS.FREE_GAMES] || { games: [] };
  const game = fg.games.find(g => g.id === message.gameId);
  if (game) {
    game.claimed = true;
    await chrome.storage.local.set({ [DB_KEYS.FREE_GAMES]: fg });
    await updateFreeGamesBadge();
  }
  return { success: true };
}

// ============ 14.5 游戏缓存管理 / Game Cache Management ============
// 供设置页"游戏缓存"标签页调用，支持检索、分页、删除已记录的游戏信息。
// Powers the "Game Cache" tab in the options page: search, paginate, delete.

// 获取已记录游戏列表（支持关键词、好评率、标签、下载站多条件检索和分页）
// 参数：keyword（匹配 appId/中文名/英文名/名称变体）
//      minRating（最低好评率 0-100，0 表示不限）、tag（Steam 标签包含）
//      siteKey（仅显示有该下载站网址的条目）
//      page（页码，从1开始）、pageSize（每页条数，默认20）
// Get recorded games list (multi-condition: keyword/rating/tag/site + pagination).
// Args: keyword (matches appId/CN name/EN name/variants),
//       minRating (0-100, 0 = any), tag (Steam tag containment),
//       siteKey (only entries having that site's URL), page (1-based), pageSize.
async function handleGetGameCacheList(message) {
  const keyword = (message.keyword || '').toLowerCase().trim();
  const minRating = Number(message.minRating) > 0 ? Number(message.minRating) : 0;
  const tag = (message.tag || '').trim().toLowerCase();
  const siteKey = (message.siteKey || '').trim().toLowerCase();
  const page = Math.max(1, message.page || 1);
  const pageSize = Math.max(1, Math.min(100, message.pageSize || 20));

  const registry = await getGameRegistry();
  const urlStore = await readDownloadUrlsStore();
  // 加载 Steam 缓存到内存，批量读取好评率（内存命中，开销小）
  // Load the Steam cache into memory for batched rating reads (cheap)
  await loadSteamCacheToMemory();

  // 将注册表转为数组并合并下载站网址信息（合并所有站点桶）与好评率
  // Convert registry to array, merging download-site URLs (across buckets) and ratings
  let games = Object.entries(registry).map(([appId, entry]) => {
    const urls = {};
    for (const [siteKey, bucket] of Object.entries(urlStore.sites)) {
      if (bucket[appId]) urls[siteKey] = bucket[appId];
    }
    // 取第一个有效下载站网址作为主展示 / Pick first valid download URL for display
    const primaryUrl = Object.values(urls).find(u => u && u.url) || null;
    // 从 Steam 动态缓存读取好评率（缓存缺失时为 null）
    // Read the positive rate from the Steam dynamic cache (null when absent)
    const cachedEntry = steamCacheMemory.get(String(appId)) || null;
    const cachedData = cachedEntry ? cachedEntry.data : null;
    return {
      appId,
      cnName: entry.cnName || '',
      enName: entry.enName || '',
      names: entry.names || [],
      tags: entry.tags || [],
      firstSeen: entry.firstSeen || null,
      lastConfirmed: entry.lastConfirmed || null,
      positiveRate: (cachedData && cachedData.positiveRate !== undefined) ? cachedData.positiveRate : null,
      downloadUrls: Object.entries(urls).map(([siteKey, u]) => ({
        siteKey,
        siteName: u.siteName || siteKey,
        url: u.url,
        firstSeen: u.firstSeen,
        lastRefreshed: u.lastRefreshed,
        lastAccessed: u.lastAccessed
      })),
      // 主下载站网址及上次调用缓存时间（用于列表展示）
      // Primary download URL + last cache access time (for list display)
      primaryDownloadUrl: primaryUrl ? primaryUrl.url : '',
      lastAccessed: primaryUrl ? primaryUrl.lastAccessed : null
    };
  });

  // 关键词过滤 / Keyword filtering
  if (keyword) {
    games = games.filter(g =>
      String(g.appId).includes(keyword) ||
      (g.cnName && g.cnName.toLowerCase().includes(keyword)) ||
      (g.enName && g.enName.toLowerCase().includes(keyword)) ||
      g.names.some(n => n.includes(keyword))
    );
  }

  // 好评率过滤：至少达到 minRating（未命中条件或缓存无评分数据时排除）
  // Rating filter: positive rate >= minRating (no-rating entries are excluded)
  if (minRating > 0) {
    games = games.filter(g => g.positiveRate !== null && g.positiveRate !== undefined && g.positiveRate >= minRating);
  }

  // 标签过滤：Steam 官方标签包含关键词（忽略大小写）
  // Tag filter: any Steam official tag contains the keyword (case-insensitive)
  if (tag) {
    games = games.filter(g => (g.tags || []).some(t => t.toLowerCase().includes(tag)));
  }

  // 下载站过滤：存在该站点的有效网址
  // Site filter: has a valid URL at the given site
  if (siteKey) {
    games = games.filter(g => g.downloadUrls.some(u => u.siteKey === siteKey && u.url));
  }

  // 按上次确认时间降序排序 / Sort by lastConfirmed descending
  games.sort((a, b) => (b.lastConfirmed || 0) - (a.lastConfirmed || 0));

  const total = games.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const pageItems = games.slice(start, start + pageSize);

  return { games: pageItems, total, page, pageSize, totalPages };
}

// 删除单个游戏的全部缓存（注册表 + Steam缓存 + 下载站网址 + 名称索引中的相关条目）
// Delete all cache for a single game (registry + Steam cache + download URLs + name index entries)
async function handleDeleteGameCacheEntry(message) {
  const appId = String(message.appId || '');
  if (!appId) return { success: false, error: 'appId required' };

  // 1. 从注册表获取已知名称，用于清理名称索引 / Get known names from registry for name index cleanup
  const registry = await getGameRegistry();
  const entry = registry[appId];
  const namesToClean = entry ? (entry.names || []) : [];

  // 2. 删除注册表条目（直接操作内存 + 强制落盘）/
  //    Delete registry entry (operate on memory directly, then force-flush)
  delete registry[appId];
  await flushRegistry();

  // 3. 删除 Steam 动态缓存 / Delete Steam dynamic cache
  await loadSteamCacheToMemory();
  steamCacheMemory.delete(appId);
  await flushSteamCache();

  // 4. 删除下载站网址（从所有站点桶中移除该 appId）
  //    Delete download URLs (remove appId from every site bucket)
  const urlStore = await readDownloadUrlsStore();
  for (const bucket of Object.values(urlStore.sites)) {
    delete bucket[appId];
  }
  await chrome.storage.local.set({ [DB_KEYS.DOWNLOAD_URLS]: urlStore });

  // 5. 清理名称索引中的相关条目 / Clean name index entries
  await loadNameIndexToMemory();
  for (const name of namesToClean) {
    const idxEntry = nameIndexMemory.get(name);
    if (idxEntry && String(idxEntry.appId) === appId) {
      nameIndexMemory.delete(name);
    }
  }
  await flushNameIndex();

  Logger.info('Cache', `删除游戏缓存: appId ${appId}`);
  return { success: true };
}

// 清空全部游戏缓存（注册表 + Steam缓存 + 下载站网址 + 名称索引）
// Clear all game cache (registry + Steam cache + download URLs + name index)
async function handleClearGameCache() {
  await chrome.storage.local.remove([
    DB_KEYS.GAME_REGISTRY,
    DB_KEYS.STEAM_CACHE,
    DB_KEYS.DOWNLOAD_URLS,
    DB_KEYS.NAME_INDEX,
    DB_KEYS.MANUAL_MAPPINGS
  ]);
  steamCacheMemory = null;
  steamCacheMemoryLoaded = false;
  if (steamCacheWriteTimer) { clearTimeout(steamCacheWriteTimer); steamCacheWriteTimer = null; }
  nameIndexMemory = null;
  nameIndexMemoryLoaded = false;
  if (nameIndexWriteTimer) { clearTimeout(nameIndexWriteTimer); nameIndexWriteTimer = null; }
  registryMemory = null;
  registryMemoryLoaded = false;
  if (registryWriteTimer) { clearTimeout(registryWriteTimer); registryWriteTimer = null; }
  Logger.info('Cache', '清空全部游戏缓存');
  return { success: true };
}

// 手动刷新单个游戏的缓存条目：重新获取 Steam 官方中英文名与标签，
// 并按设置中启用的下载站范围重新检索下载页地址。
// 供缓存管理页"手动更新"按钮调用。
// Manually refresh one cache entry: re-fetch Steam official CN/EN names and tags,
// then re-search detail-page URLs across the sites enabled in settings.
// Invoked by the cache page's "refresh" button.
async function handleRefreshGameCacheEntry(message) {
  const appId = String(message.appId || '');
  if (!appId) return { success: false, error: 'appId required' };
  try {
    // 1. 重新获取 Steam 完整详情（中英文名以官方为准）
    //    Re-fetch full Steam details (official CN/EN names)
    const result = await fetchSteamFullDetailsByAppId(appId);
    if (!result) return { success: false, error: '获取 Steam 信息失败' };

    // 2. 更新 Steam 动态缓存与注册表（含标签）
    //    Update the Steam dynamic cache and the registry (incl. tags)
    await setSteamCacheEntry(appId, result);
    await recordGameInRegistry(appId, {
      cnName: result.name,
      enName: result.englishName || result.name,
      tags: result.genres
    });

    // 3. 按设置中启用的下载站重新检索详情页网址（更新网址缓存）
    //    Re-search detail-page URLs across the sites enabled in settings
    const settings = await getSettings();
    const enabledKeys = settings.steamSiteSearch || DOWNLOAD_SITES.map(s => s.key);
    const sites = await searchDownloadSites(result.name, appId, enabledKeys);

    // 4. 强制落盘，防止 SW 休眠丢失 / Force-flush to persist before dormancy
    await flushSteamCache();
    await flushNameIndex();
    await flushRegistry();

    Logger.info('Cache', `手动刷新缓存条目: appId ${appId} → ${result.name}`);
    return {
      success: true,
      name: result.name,
      englishName: result.englishName || '',
      positiveRate: result.positiveRate,
      sites: sites.map(s => ({ key: s.key, found: s.found, detailUrl: s.detailUrl }))
    };
  } catch (e) {
    Logger.error('Cache', `手动刷新缓存条目失败: ${e.message}`);
    return { success: false, error: e.message };
  }
}

// --- 消息分发映射表 / Message dispatch map ---

const MESSAGE_HANDLERS = {
  TRACK_EVENT:            handleTrackEvent,
  GET_RECOMMENDATIONS:    handleGetRecommendations,
  SEARCH_STEAM:           handleSearchSteam,
  REFRESH_STEAM_CACHE:    handleRefreshSteamCache,
  GET_STEAM_BY_APPID:     handleGetSteamByAppId,
  SAVE_MANUAL_MAPPING:    handleSaveManualMapping,
  SEARCH_STEAM_CANDIDATES: handleSearchSteamCandidates,
  GET_STEAM_RATINGS:      handleGetSteamRatings,
  PREFETCH_STEAM_RATINGS: handlePrefetchSteamRatings,
  GET_SETTINGS:           handleGetSettings,
  SAVE_SETTINGS:          handleSaveSettings,
  RESET_SETTINGS:         handleResetSettings,
  GET_STATS:              handleGetStats,
  GET_STEAM_RECOMMENDATIONS: handleGetSteamRecommendations,
  CLEAR_DATA:             handleClearData,
  SEARCH_DOWNLOAD_SITES:  handleSearchDownloadSites,
  GET_FREE_GAMES:         handleGetFreeGames,
  CLAIM_FREE_GAME:        handleClaimFreeGame,
  GET_DOWNLOAD_HISTORY:   handleGetDownloadHistory,
  TRACK_DOWNLOAD_SITE_VISIT: handleTrackDownloadSiteVisit,
  RECORD_DOWNLOAD_URLS_BATCH: handleRecordDownloadUrlsBatch,
  // 游戏缓存管理 / Game cache management
  GET_GAME_CACHE_LIST:    handleGetGameCacheList,
  DELETE_GAME_CACHE_ENTRY: handleDeleteGameCacheEntry,
  CLEAR_GAME_CACHE:       handleClearGameCache,
  REFRESH_GAME_CACHE_ENTRY: handleRefreshGameCacheEntry,
  GET_RUNTIME_LOGS:       async (msg) => ({ logs: await getRuntimeLogs(msg.limit) }),
  CLEAR_RUNTIME_LOGS:     async () => { await clearRuntimeLogs(); return { success: true }; },
  EXPORT_LOGS:            async () => ({ logs: await getRuntimeLogs() }),
  CREATE_BACKUP:          async () => {
    const b = await createBackup(true);
    return { success: !!b, backup: b ? { id: b.id, timestamp: b.timestamp } : null };
  },
  GET_BACKUPS:            async () => ({ backups: await getBackupList() }),
  RESTORE_BACKUP:         async (msg) => restoreBackup(msg.backupId),
  DELETE_BACKUP:          async (msg) => deleteBackup(msg.backupId),
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    console.error('消息处理错误:', err);
    sendResponse({ error: err.message });
  });
  return true; // 保持消息通道开放
});

async function handleMessage(message, sender) {
  const handler = MESSAGE_HANDLERS[message.action];
  if (handler) return await handler(message, sender);
  return { error: 'Unknown action: ' + message.action };
}

// ============ 15. 初始化 / Initialization ============

initStorage();

// 每日刷新限免游戏 / Refresh free games daily
chrome.alarms.create('refreshFreeGames', { periodInMinutes: 24 * 60 });

// 自动备份定时器 / Auto backup alarm setup
async function setupBackupAlarm() {
  const settings = await getSettings();
  const intervalMinutes = (settings.backupIntervalHours || 24) * 60;
  chrome.alarms.create('autoBackup', { periodInMinutes: intervalMinutes });
}
setupBackupAlarm();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refreshFreeGames') {
    refreshFreeGames(true);
  }
  if (alarm.name === 'autoBackup') {
    getSettings().then(settings => {
      if (settings.autoBackup) createBackup(false);
    });
  }
});

// 启动时刷新限免游戏并更新badge
refreshFreeGames(false);

Logger.info('System', 'Service Worker 已启动');
console.log('[Game Recommender] Service Worker 已启动');
