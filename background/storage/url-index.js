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
import { DB_KEYS, STORAGE_CAPS } from '../core/constants.js';
import { createDebouncedStore } from './debounced-store.js';
import { recordFlushFailure } from './flush-health.js'; // v10.0.0：写失败计数

/** @type {Record<string, string|number|{a: string|number, h?: string, at?: number}>} */
let urlIndexMemory = {};
let loaded = false;
// v10.7.0 批次2：dirty 标记——flushAllCaches/告警落盘此前无条件全量重写本文件
//（上限 5000 条 ≈ 100-300KB/次），是写放大热点之一
let urlIndexDirty = false;
// v8.2.0：网址索引上限（对象键序 = 插入序，超限淘汰最旧——URL→appId
// 映射为缓存性质数据，无界增长无意义）
const URL_INDEX_MAX_ENTRIES = STORAGE_CAPS.urlIndex; // v14 B4：单源 STORAGE_CAPS（原硬编码 5000）
// v14.29.0：条目值双形态——旧 = 纯 appId；新 = {a: appId, h: 标题哈希, at}。
// h 用于"同标题转载不算冲突"判定（同站两页同标题大概率是同一游戏的重发）；
// 旧数据无 h → 保守参与冲突判定。读取统一走 entryAppId。
// Entry values: legacy plain appId vs new {a, h(title hash), at}. h exempts
// same-title reposts from host-conflict detection; legacy entries participate
// conservatively. Reads go through entryAppId.
/** @param {string|number|{a: string|number, h?: string, at?: number}|undefined} v @returns {string|number|null} */
function entryAppId(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return v.a !== undefined && v.a !== null ? v.a : null;
  return v;
}

// v14.29.0：appId → URL 反向索引（内存维护，冲突检测 O(该 appId 的 URL 数)）
/** @type {Map<string, Set<string>>} */
const appIdUrls = new Map();
/** @param {string} key @param {string|number|{a?: string|number}} v */
function reverseIndexAdd(key, v) {
  const a = entryAppId(/** @type {any} */ (v));
  if (a === null) return;
  const set = appIdUrls.get(String(a)) || new Set();
  set.add(key);
  appIdUrls.set(String(a), set);
}
function rebuildReverseIndex() {
  appIdUrls.clear();
  for (const [k, v] of Object.entries(urlIndexMemory)) reverseIndexAdd(k, /** @type {any} */ (v));
}

function enforceUrlIndexLimit() {
  const keys = Object.keys(urlIndexMemory);
  if (keys.length <= URL_INDEX_MAX_ENTRIES) return;
  for (const k of keys.slice(0, keys.length - URL_INDEX_MAX_ENTRIES)) delete urlIndexMemory[k];
  rebuildReverseIndex(); // 淘汰后反向索引同步重建（避免悬挂引用）
}

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
  enforceUrlIndexLimit();
  rebuildReverseIndex();
}

const writer = createDebouncedStore({
  name: '网址索引',
  debounceMs: 2000,
  save: async () => {
    if (!urlIndexDirty) return;
    try {
      await dataStore.writeModule(DB_KEYS.URL_APPID_INDEX, urlIndexMemory);
      urlIndexDirty = false; // v10.7.0：仅成功后清除（失败保留待重试）
    } catch (e) {
      // v10.0.0：写失败计数可见（flush-health）——此前静默失败
      recordFlushFailure('urlIndexWriteFails');
      throw e; // 交由工厂记录日志
    }
  }
});
// v9.3.0：显式 flush（SW 休眠前/聚合落盘时调用，消除 2s 防抖丢失窗口）
export const flushUrlIndex = writer.flush;

// 规范化详情页 URL（去掉 hash/query 尾参——同一页面对应同一缓存）
// v14.29.0：导出（冲突检测/会话级声明复用同一规范化单源）
export function normalizeUrl(url) {
  const u = String(url || '');
  return u.split('#')[0].split('?')[0];
}

// v14.29.0：URL → host（解析失败返回空串——host 未知即无法建立"同站"关系，
// 冲突检测保守放行，不误杀奇异 URL）
/** @param {string} url @returns {string} */
export function hostOfUrl(url) {
  try {
    return new URL(String(url || '')).hostname.toLowerCase();
  } catch {
    return '';
  }
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
  return entryAppId(urlIndexMemory[key]);
}

// 记录网址 → appId（防抖落盘；v14.29.0 起生产写入走 setUrlAppIdArbitrated，
// 本函数保留为原语 + 旧调用兼容）
export async function setUrlAppId(url, appId) {
  const key = normalizeUrl(url);
  if (!key || appId === null || appId === undefined) return;
  await load();
  const prev = urlIndexMemory[key];
  if (prev !== undefined) {
    const prevA = entryAppId(prev);
    if (prevA !== null && String(prevA) !== String(appId)) {
      const set = appIdUrls.get(String(prevA));
      if (set) set.delete(key);
    }
  }
  urlIndexMemory[key] = appId;
  reverseIndexAdd(key, appId);
  enforceUrlIndexLimit();
  urlIndexDirty = true;
  writer.scheduleWrite();
}

// v14.29.0：同 host 冲突检测——**同站不同页命中同一 appId 在逻辑上至多一侧
// 正确**（例：xianyudanji.gg/107968.html 与 /107966.html 是两篇不同游戏帖，
// 标题检索把两页都匹配到同一 appId = 至少一侧错配）。返回已占用该 appId 的
// 另一 URL；同标题哈希（转载重发）豁免；旧数据无哈希保守参与。
// Host-conflict detection: two different pages of one site resolving to the
// same appId cannot both be right — return the other URL already bound to it.
// Same-title-hash reposts are exempt; legacy entries (no hash) participate.
/** @param {string} url @param {string|number} appId @param {string} [titleHash] @returns {Promise<{url: string}|null>} */
export async function findHostUrlConflict(url, appId, titleHash) {
  const key = normalizeUrl(url);
  const host = hostOfUrl(key);
  if (!key || !host || appId === null || appId === undefined) return null;
  await load();
  const urls = appIdUrls.get(String(appId));
  if (!urls) return null;
  for (const other of urls) {
    if (other === key) continue;
    if (hostOfUrl(other) !== host) continue; // 跨站同 gameId 正常（同游戏多站收录）
    const meta = urlIndexMemory[other];
    const otherHash = meta && typeof meta === 'object' ? String(meta.h || '') : '';
    if (titleHash && otherHash && otherHash === String(titleHash)) continue; // 同标题转载 = 同一游戏两页
    return { url: other };
  }
  return null;
}

// v14.29.0：仲裁写入——①已有不同绑定且本次为推测级 → 拒绝（推测不得顶掉
// 已有绑定，防"漂移钉死"：错误推测覆盖正确绑定后被 URL 第一候选永久复用）；
// ②同 host 冲突（findHostUrlConflict 命中）→ 拒绝（至少一侧错配，不固化第
// 二侧）；③确认级（confirmed）允许换绑。返回写入结果供调用方留证。
// Arbitrated write: a suspected-level match never overwrites an existing
// different binding (no drift-pinning), and a host-conflicting appId is never
// persisted; only confirmed matches may rebind.
/**
 * @param {string} url
 * @param {string|number} appId
 * @param {{confidence?: string|null, titleHash?: string}} [options]
 * @returns {Promise<{written: boolean, reason: string, existingAppId?: string|number, existingUrl?: string}>}
 */
export async function setUrlAppIdArbitrated(url, appId, options = {}) {
  const key = normalizeUrl(url);
  if (!key || appId === null || appId === undefined) return { written: false, reason: 'invalid' };
  await load();
  const prev = urlIndexMemory[key];
  const prevAppId = prev === undefined ? null : entryAppId(prev);
  const hash = String(options.titleHash || '');
  if (prevAppId !== null && String(prevAppId) === String(appId)) {
    // 同一绑定 → 刷新元数据（标题哈希补齐旧空缺）
    urlIndexMemory[key] = { a: appId, h: hash || (prev && typeof prev === 'object' && prev.h) || '', at: Date.now() };
    enforceUrlIndexLimit();
    urlIndexDirty = true;
    writer.scheduleWrite();
    return { written: true, reason: 'refresh' };
  }
  if (prevAppId !== null && options.confidence !== 'confirmed') {
    return { written: false, reason: 'suspected-keep', existingAppId: prevAppId };
  }
  const conflict = await findHostUrlConflict(key, appId, hash);
  if (conflict) return { written: false, reason: 'host-conflict', existingUrl: conflict.url };
  urlIndexMemory[key] = { a: appId, h: hash, at: Date.now() };
  reverseIndexAdd(key, appId);
  enforceUrlIndexLimit();
  urlIndexDirty = true;
  writer.scheduleWrite();
  return { written: true, reason: prevAppId !== null ? 'confirmed-overwrite' : 'fresh' };
}

// 删除单条网址映射（v9.7.0：人工报错/名称校验不相关时清除错误绑定——
// 否则 URL 索引命中无校验短路返回，错误 appId 被永久固化）
export async function deleteUrlAppId(url) {
  const key = normalizeUrl(url);
  if (!key) return;
  await load();
  const prev = urlIndexMemory[key];
  if (prev !== undefined) {
    const prevA = entryAppId(prev);
    if (prevA !== null) {
      const set = appIdUrls.get(String(prevA));
      if (set) {
        set.delete(key);
        if (set.size === 0) appIdUrls.delete(String(prevA));
      }
    }
    delete urlIndexMemory[key];
    urlIndexDirty = true;
    writer.scheduleWrite();
  }
}

// v7.1.0：网址索引规模（dashboard 诊断展示）
export async function getUrlIndexSize() {
  await load();
  return Object.keys(urlIndexMemory).length;
}

// 清空（导入/清除数据时调用）
// v9.3.0：同步清除磁盘（此前仅清内存——惰性 load() 会把防抖落盘的旧数据
// 读回，清除数据后索引"复活"；reset.js 同步调用点不 await 亦可（remove 幂等））
export async function resetUrlIndex() {
  urlIndexMemory = {};
  loaded = false;
  urlIndexDirty = false;
  appIdUrls.clear(); // v14.29.0：反向索引同步清空
  writer.reset && writer.reset();
  await dataStore.removeModule(DB_KEYS.URL_APPID_INDEX).catch(() => {});
}
