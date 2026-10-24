// @ts-strict
/**
 * 游戏雷达 Game Radar - Steam 全量目录离线索引 / Steam App Catalog Index
 *
 * v14.6（调研 docs/标题检索AppID-准确率与效率调研-2026-10.md 建议 1）：
 * 在 nameIndex（学到的映射）与 storesearch（在线检索）之间插入"全量目录"
 * 离线层——
 *   · 准确率：在线搜索端点搜不到**已下架游戏**（The Culling 实证），目录层
 *     是唯一免 Bing/LLM 的覆盖手段；归一化精确命中直接作为检索结果
 *   · 效率：大列表批量场景免网络往返（原每 miss 一次 storesearch + 限速）
 * 数据源双保险：jsnli 每日镜像（免 key，主源）→ IStoreService/GetAppList
 * （settings.steamApiKey，备源）→ 双双失败则本 SW 生命周期内回退纯在线
 * 管线（熔断式降级，不阻塞主流程）。
 * Steam app catalog offline index (research recommendation 1): a normalized
 * exact-match layer between the learned name index and the online search —
 * covers delisted games (invisible to storesearch) and skips network for
 * catalog hits. Dual sources with circuit-style degradation.
 */

import { dataStore } from '../../data/data-store.js';
import { DB_KEYS, ENDPOINTS, PERF_CONFIG } from '../core/constants.js';
import { getSettings } from '../core/settings.js';
import { fetchWithTimeout } from '../core/utils.js';
import { metricInc } from '../core/metrics.js';
import { Logger } from '../storage/logger.js';

/** 目录条目（持久化为 [normName, appId, name] 紧凑数组） */
/**
 * 归一化标题：NFKC（全角→半角）+ 小写 + 符号→空格（保留 CJK/字母/数字）+
 * 压缩空白。目录键与查询共用同一函数。
 * Normalize: NFKC + lowercase + symbols→space + whitespace collapse. Shared
 * by index keys and queries so both sides always agree.
 * @param {string} title
 * @returns {string}
 */
export function normalizeTitle(title) {
  return String(title || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** @type {Map<string, {appId: string, name: string}>|null} */
let indexMap = null;
let loaded = false; // 本 SW 生命周期内不再读盘（刷新可重建）
/** @type {Promise<Map<string, {appId: string, name: string}>|null>|null} */
let loadPromise = null;
/** @type {Promise<boolean>|null} */
let refreshInFlight = null; // 防并发刷新（fire-and-forget，finally 复位）
let refreshAttempted = false; // 本 SW 生命周期内至多主动刷新一次（防 miss 风暴）

/** @type {{updatedAt: number, source: string}|null} */
let meta = null;

/**
 * 确保索引已从存储加载（幂等；不触发网络——刷新只在匹配未命中时按需触发，
 * 冷启动零成本）。返回当前索引（未加载成功 → null，调用方回退在线管线）。
 * Load the persisted index (idempotent, no network at boot). Returns null
 * when unavailable — callers fall through to the online pipeline.
 * @returns {Promise<Map<string, {appId: string, name: string}>|null>}
 */
export async function ensureAppListIndex() {
  if (loaded) return indexMap;
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const stored = await dataStore.readModule(DB_KEYS.APP_LIST_INDEX);
        if (stored && Array.isArray(stored.entries) && stored.entries.length > 0) {
          indexMap = hydrate(stored.entries);
          meta = { updatedAt: stored.updatedAt || 0, source: stored.source || '' };
          return indexMap;
        }
        return null;
      } catch (e) {
        Logger.warn('AppListIndex', `目录索引读取失败（回退在线管线）: ${String(e)}`);
        return null;
      }
    })();
  }
  await loadPromise;
  loaded = true; // 成败都不再读盘——刷新成功可原地重建
  return indexMap;
}

/**
 * @param {Array<[string, string, string]>} entries
 * @returns {Map<string, {appId: string, name: string}>}
 */
function hydrate(entries) {
  const map = new Map();
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    const [norm, appId, name] = entry;
    if (norm && appId && name && !map.has(norm)) map.set(norm, { appId, name });
  }
  return map;
}

/**
 * 目录是否已过期（超过 PERF_CONFIG.appListIndexMaxAgeDays）。
 * @param {{updatedAt: number}|null} m
 */
function isStale(m) {
  return !m || Date.now() - m.updatedAt > PERF_CONFIG.appListIndexMaxAgeDays * 86400000;
}

/**
 * 归一化精确匹配（管线在 nameIndex/纠错之后、storesearch 之前调用）。
 * 未命中或索引缺失/过期时按需触发一次后台刷新（本 SW 生命周期至多一次，
 * 防 miss 风暴）；当前调用返回 null 回退在线管线，刷新完成后后续查询命中。
 * @param {string} title - 清洗后的游戏名（cleanPageTitle 产物）
 * @param {string|number|null} [excludeAppId] - 报错纠正黑名单
 * @returns {Promise<{appId: string, name: string}|null>}
 */
export async function matchAppListExact(title, excludeAppId = null) {
  if (!title) return null;
  // 快路径：索引已加载（含"确认无索引"）→ 零 await 返回——列表批量场景每 miss
  // 一次 await ensure 都会在批次等待窗口塞微任务（sim 节 2/2b 竞态实证）
  if (loaded) {
    if (isStale(meta) && !refreshInFlight && !refreshAttempted) {
      refreshAppListIndex().catch(() => {});
    }
    if (!indexMap) {
      metricInc('appListIndex.miss');
      return null;
    }
    const fast = indexMap.get(normalizeTitle(title));
    if (!fast || (excludeAppId != null && String(fast.appId) === String(excludeAppId))) {
      metricInc('appListIndex.miss');
      return null;
    }
    metricInc('appListIndex.hit');
    return { appId: fast.appId, name: fast.name };
  }
  const map = await ensureAppListIndex();
  if (isStale(meta) && !refreshInFlight && !refreshAttempted) {
    // 过期/缺失 → 后台刷新（不阻塞当前查询；完成后后续查询命中）
    refreshAppListIndex().catch(() => {});
  }
  if (!map) {
    metricInc('appListIndex.miss');
    return null;
  }
  const hit = map.get(normalizeTitle(title));
  if (!hit || (excludeAppId != null && String(hit.appId) === String(excludeAppId))) {
    metricInc('appListIndex.miss');
    return null;
  }
  metricInc('appListIndex.hit');
  return { appId: hit.appId, name: hit.name };
}

/**
 * 刷新目录（主源 jsnli 每日镜像 → 备源 IStoreService+用户 key）。
 * 成功后原地重建索引并持久化；两源均失败返回 false（调用方降级）。
 * @param {boolean} [force=false] - 忽略保鲜期强制刷新（测试/手动）
 * @returns {Promise<boolean>}
 */
export async function refreshAppListIndex(force = false) {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      if (!force && !isStale(meta) && indexMap) return true; // 保鲜期内跳过
      refreshAttempted = true;
      const t0 = Date.now();
      /** @type {{entries: Array<{appId: string, name: string}>}|null} */
      let payload = null;
      let source = '';
      try {
        payload = await fetchDumpPayload();
        source = 'jsnli-dump';
      } catch (e) {
        Logger.warn('AppListIndex', `镜像 dump 拉取失败: ${String(e).slice(0, 120)}`);
      }
      if (!payload) {
        // 备源：IStoreService/GetAppList（需用户 key——settings.steamApiKey 遗留键复活）
        const key = (await getSettings().catch(() => null))?.steamApiKey;
        if (key) {
          try {
            payload = await fetchStoreServicePayload(key);
            source = 'istoreservice';
          } catch (e) {
            Logger.warn('AppListIndex', `IStoreService 拉取失败: ${String(e).slice(0, 120)}`);
          }
        }
      }
      if (!payload || payload.entries.length < 10000) {
        metricInc('appListIndex.refresh.fail');
        Logger.warn('AppListIndex', '目录刷新失败（双源均不可用或数据异常），回退纯在线管线');
        return false;
      }
      // 紧凑持久化：[normName, appId, name]；归一化去重（同名不同 appid 取先见——
      // IStoreService 顺序即 Steam 官方顺序）
      /** @type {Array<[string, string, string]>} */
      const entries = [];
      const seen = new Set();
      for (const { appId, name } of payload.entries) {
        const norm = normalizeTitle(name);
        if (!norm || seen.has(norm)) continue;
        seen.add(norm);
        entries.push([norm, appId, name]);
      }
      const record = { v: 1, updatedAt: Date.now(), source, entries };
      await dataStore.writeModule(DB_KEYS.APP_LIST_INDEX, record);
      indexMap = hydrate(entries);
      meta = { updatedAt: record.updatedAt, source };
      loaded = true;
      metricInc('appListIndex.refresh.ok');
      Logger.info('AppListIndex', `目录刷新完成: ${entries.length} 条（${source}，${Date.now() - t0}ms）`);
      return true;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/**
 * 主源：jsnli 每日镜像（IStoreService 快照，[{appid, name}] 数组）。
 * @returns {Promise<{entries: Array<{appId: string, name: string}>}>}
 */
async function fetchDumpPayload() {
  const resp = await fetchWithTimeout(ENDPOINTS.steamAppListDump, {}, PERF_CONFIG.appListDumpTimeoutMs);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const raw = await resp.json();
  if (!Array.isArray(raw)) throw new Error('dump 格式异常（非数组）');
  const entries = [];
  for (const item of raw) {
    // 防御式解析：IStoreService 条目 {appid, name}——缺任一即跳过
    if (!item || item.appid == null || typeof item.name !== 'string' || !item.name) continue;
    entries.push({ appId: String(item.appid), name: item.name });
  }
  if (entries.length < 10000) throw new Error(`dump 条目过少（${entries.length}），疑似异常数据`);
  return { entries };
}

/**
 * 备源：IStoreService/GetAppList/v1（用户 key，last_appid 分页 5 万/页）。
 * @param {string} key
 * @returns {Promise<{entries: Array<{appId: string, name: string}>}>}
 */
async function fetchStoreServicePayload(key) {
  const entries = [];
  /** @type {string|null} */
  let lastAppid = null;
  for (let page = 0; page < PERF_CONFIG.appListServiceMaxPages; page++) {
    const url = new URL(ENDPOINTS.steamStoreServiceList);
    url.searchParams.set('key', key);
    url.searchParams.set('include_games', 'true');
    url.searchParams.set('max_results', '50000');
    if (lastAppid) url.searchParams.set('last_appid', lastAppid);
    const resp = await fetchWithTimeout(url.href, {}, PERF_CONFIG.appListDumpTimeoutMs);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const apps = (data && data.response && data.response.apps) || [];
    for (const a of apps) {
      if (a && a.appid != null && typeof a.name === 'string' && a.name) {
        entries.push({ appId: String(a.appid), name: a.name });
      }
    }
    const res = data && data.response ? data.response : {};
    if (!res.have_more_results || !res.last_appid) break;
    lastAppid = String(res.last_appid);
  }
  if (entries.length < 10000) throw new Error(`IStoreService 条目过少（${entries.length}）`);
  return { entries };
}
