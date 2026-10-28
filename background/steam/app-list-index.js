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

// v14.6.2：刷新失败退避窗口（PERF_CONFIG 单源别名——本文件多处消费）
const APP_LIST_REFRESH_BACKOFF_MS = PERF_CONFIG.appListRefreshBackoffMs;

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
// v14.7 批次 11：受控空格变体索引——"GTA5" vs "GTA 5" 归一化后空格不对称
// 必 miss 的根治。secondary key = 归一化名去全部空格（确定性变换，零误配；
// 编辑距离近邻因噪声风险高且错题库门禁下收益不明，不做）。构建时对**含
// 空格**的归一化名建立（无空格名与主键相同，无需重复）。
// Controlled space-variant index: secondary key = normalized name without
// spaces (deterministic, zero false-positives). No edit-distance layer —
// noise risk outweighs benefit under the mismatch-replay gate.
/** @type {Map<string, {appId: string, name: string}>|null} */
let deSpaceMap = null;
let loaded = false; // 本 SW 生命周期内不再读盘（刷新可重建）
/** @type {Promise<Map<string, {appId: string, name: string}>|null>|null} */
let loadPromise = null;
/** @type {Promise<boolean>|null} */
let refreshInFlight = null; // 防并发刷新（fire-and-forget，finally 复位）
let refreshAttempted = false; // 本 SW 生命周期内至多主动刷新一次（防 miss 风暴）

/** @type {{updatedAt: number, source: string}|null} */
let meta = null;

/** 归一化名 → 去空格 secondary key（含空格名才有区分价值）*/
function deSpaceKey(normTitle) {
  return normTitle.includes(' ') ? normTitle.replace(/\s+/g, '') : '';
}

/** 构建双索引（主键 + 去空格变体键）*/
function buildMaps(entries) {
  const map = new Map();
  const deSpace = new Map();
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    const [norm, appId, name] = entry;
    if (!norm || !appId || !name) continue;
    if (!map.has(norm)) map.set(norm, { appId, name });
    const dsk = deSpaceKey(norm);
    if (dsk && !deSpace.has(dsk)) deSpace.set(dsk, { appId, name });
  }
  deSpaceMap = deSpace;
  return map;
}

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
          indexMap = buildMaps(stored.entries);
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
  return buildMaps(entries);
}

/**
 * 双层查找（主键精确 → 去空格变体）/ Two-tier lookup: exact → space-variant.
 * 注意：查询侧**无条件**探测去空格键——查询名本身可能不含空格（"GTA5"型），
 * 与索引侧"含空格才建 secondary"的优化无关。
 * The query side always probes the de-spaced key (the query itself may have
 * no spaces); the index side only builds secondary keys for spaced names.
 * @param {Map<string, {appId: string, name: string}>} map
 * @param {string} normTitle
 * @returns {{appId: string, name: string}|null}
 */
function lookupTiered(map, normTitle) {
  const exact = map.get(normTitle);
  if (exact) return exact;
  if (!deSpaceMap) return null;
  return deSpaceMap.get(normTitle.replace(/\s+/g, '')) || null;
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
    const fast = lookupTiered(indexMap, normalizeTitle(title));
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
  const hit = lookupTiered(map, normalizeTitle(title));
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
    let refreshOk = false;
    try {
      if (!force && !isStale(meta) && indexMap) return true; // 保鲜期内跳过
      // v14.6.2 修复：失败退避跨 SW 重启——"每 SW 生命周期至多一次"在 SW 频繁
      // 冷启动下等于反复重试（dump 源 404/被墙时每次 45s 挂起 × 每次冷启动）；
      // 失败时间戳存 chrome.storage.session（浏览器会话级，重启清零允许再试），
      // 退避窗口内直接跳过
      if (!force) {
        try {
          const backoff = await chrome.storage.session.get('appListRefreshFailAt');
          const failAt = backoff && backoff.appListRefreshFailAt;
          if (failAt && Date.now() - failAt < APP_LIST_REFRESH_BACKOFF_MS) {
            // v14.6.2 修复（审查 A9-b）：退避命中同样置 attempted——与"本 SW
            // 生命周期内至多主动刷新一次"注释语义一致，防每个 miss 再发 session IPC
            refreshAttempted = true;
            return false;
          }
        } catch {
          /* session 不可读按无退避处理 */
        }
      }
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
      // v14.6.2 修复（审查 A9-a）：写失败（~10MB 超出 storage.local 配额的降级
      // 路径）不再 reject——内存索引照常生效，失败仅告警
      try {
        await dataStore.writeModule(DB_KEYS.APP_LIST_INDEX, record);
      } catch (e) {
        Logger.warn('AppListIndex', `目录写入失败（仅内存生效）: ${String(e).slice(0, 120)}`);
      }
      indexMap = hydrate(entries);
      meta = { updatedAt: record.updatedAt, source };
      loaded = true;
      metricInc('appListIndex.refresh.ok');
      Logger.info('AppListIndex', `目录刷新完成: ${entries.length} 条（${source}，${Date.now() - t0}ms）`);
      refreshOk = true;
      return true;
    } finally {
      // v14.6.2 修复（审查 A9-a）：失败也记退避（session 级，防每次冷启动重拉
      // 20MB）；成功路径不记（保鲜期自身即节流）
      if (!refreshOk) {
        try {
          await chrome.storage.session.set({ appListRefreshFailAt: Date.now() });
        } catch {
          /* session 不可写忽略 */
        }
      }
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/**
 * 主源：jsnli 每日镜像（IStoreService 快照，[{appid, name}] 数组）。
 * v14.7 批次 11：流式解析——20MB JSON.parse 一次阻塞事件循环 ~1-2s（刷新
 * 期间消息处理 P99 失守）；改为顶层对象切分（深度计数+字符串转义感知），
 * 每 PERF_CONFIG.appListStreamYieldEvery 条让出事件循环。对象级 JSON.parse
 * 总耗时相近，但消息处理不再被长任务阻塞。
 * Streamed parse: split top-level objects (depth counter, string-escape
 * aware) and yield the event loop every N entries — no long task.
 * @returns {Promise<{entries: Array<{appId: string, name: string}>}>}
 */
async function fetchDumpPayload() {
  const resp = await fetchWithTimeout(ENDPOINTS.steamAppListDump, {}, PERF_CONFIG.appListDumpTimeoutMs);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const raw = await resp.text();
  const yieldEvery = PERF_CONFIG.appListStreamYieldEvery;
  /** @type {Array<{appId: string, name: string}>} */
  const entries = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let objStart = -1;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart >= 0) {
        /** @type {{appid?: number|string, name?: string}|null} */
        let item = null;
        try {
          item = JSON.parse(raw.slice(objStart, i + 1));
        } catch {
          item = null; // 单条异常跳过（不拖垮整批）
        }
        objStart = -1;
        // 防御式解析：IStoreService 条目 {appid, name}——缺任一即跳过
        if (item && item.appid != null && typeof item.name === 'string' && item.name) {
          entries.push({ appId: String(item.appid), name: item.name });
        }
        if (entries.length % yieldEvery === 0) {
          // 让出事件循环（消息处理不被长任务阻塞）/ yield the event loop
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    }
  }
  if (!Array.isArray(entries) || entries.length < 10000) {
    throw new Error(`dump 条目过少（${entries.length}），疑似异常数据`);
  }
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
