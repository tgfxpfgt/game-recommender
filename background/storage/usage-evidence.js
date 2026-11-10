/**
 * 游戏雷达 Game Radar - 使用证据档案 / Usage Evidence Ledger
 *
 * v14.25.0（用户需求：扩展记录使用中的所有信息，作为后续优化依据）：本地
 * 结构化使用档案——三层记录，全部有界、全本地、零出站：
 *   - counters：关键路径累计计数（键 allowlist 封顶 64，防键失控）
 *   - durations：性能样本环形（每键 ≤50：检索/直取耗时——"有缓存也慢"类
 *     报告的量化依据）
 *   - events：高信号离散事件 FIFO（≤300：未命中原因/好评率回退层级/评论
 *     结构漂移/机型声明/人工报错——问题定位与默认参数调整的原始证据）
 * 隐私边界：不记录页面 URL 与游戏标题（appId 可选）；随"清除数据"一并清理
 * （clearOnDataReset），随备份导出（backup）。记录开关遵循 metrics.js 先例
 * （常开 + 有界 + 本地，无设置键）。
 * 消费端：GET_USAGE_EVIDENCE_REPORT（扩展页）+ GET_DIAGNOSTIC_BUNDLE 附带
 * ——后续优化会话读取报告作为改默认参数/修问题的依据。
 * Local, bounded usage evidence: cumulative counters (key allowlist), duration
 * rings per key, high-signal event FIFO. Exported via report action and the
 * diagnostic bundle; consumed by later optimization passes.
 */
import { dataStore } from '../../data/data-store.js';
import { DB_KEYS, NAME_INDEX_WRITE_DEBOUNCE, STORAGE_CAPS } from '../core/constants.js';
import { createDebouncedStore } from './debounced-store.js';

/** @typedef {{v: number, since: number, counters: Record<string, number>, durations: Record<string, number[]>, events: Array<{t: number, cat: string, k: string, kind?: string, appId?: string}>}} UsageEvidenceStore */

// 计数键 allowlist（未知键丢弃——防调用点笔误撑爆键空间；新增记录点先在此登记）
const COUNTER_KEYS = new Set([
  'match.urlCacheServe', // 详情页 URL 索引命中且缓存先行直返（零出站）
  'match.urlFetch', // URL 索引命中但缓存未命中转全量拉取
  'match.searchOk', // 标题检索命中
  'match.miss', // 检索未命中（事件流带原因 kind）
  'direct.cacheServe', // GET_STEAM_BY_APPID 缓存直返
  'direct.fetch', // GET_STEAM_BY_APPID 全量拉取
  'refresh.forced', // forceRefresh（菜单"手动更新/重新检索"）
  'refresh.named', // REFRESH_STEAM_CACHE（无 appId 的名称刷新）
  'retry.lookup', // 未找到徽章点击重查
  'cache.forceClearPage', // popup 强制刷新当前页
  'mapping.manual', // 手动绑定/候选选择保存映射
  'rating.liveApi', // appreviews 活端点命中（回退未启用）
  'reviews.communityOk', // 社区评论页回退成功
  'reviews.communityFail', // 社区评论页抓取失败
  'mismatch.captured' // 错题样本采集
]);

const DURATION_KEYS = new Set(['search', 'direct']); // 检索/直取耗时环形

/** @type {UsageEvidenceStore} */
let evidenceMemory = { v: 1, since: 0, counters: {}, durations: {}, events: [] };
let evidenceLoaded = false;
let evidenceDirty = false;

async function loadEvidence() {
  if (evidenceLoaded) return;
  const stored = /** @type {any} */ (await dataStore.readModule(DB_KEYS.USAGE_EVIDENCE));
  if (stored && typeof stored === 'object' && stored.counters) {
    evidenceMemory = {
      v: 1,
      since: stored.since || Date.now(),
      counters: stored.counters || {},
      durations: stored.durations || {},
      events: Array.isArray(stored.events) ? stored.events : []
    };
  } else {
    evidenceMemory = { v: 1, since: Date.now(), counters: {}, durations: {}, events: [] };
  }
  evidenceLoaded = true;
}

// 防抖写入三件套（写失败回滚 dirty 重试 + flushAllCaches 纳管 + reset 取消挂起）
const writer = createDebouncedStore({
  name: '使用证据档案',
  debounceMs: NAME_INDEX_WRITE_DEBOUNCE,
  save: async () => {
    if (!evidenceDirty) return;
    await dataStore.writeModule(DB_KEYS.USAGE_EVIDENCE, evidenceMemory);
    evidenceDirty = false; // 仅成功后清除（失败保留待重试）
  }
});
const scheduleWrite = writer.scheduleWrite;

// v14.25.0（flush 排空，铁律 6 同源教训）：记录 API 是 fire-and-forget 异步
//（apply 先 await ensureLoaded 再置 dirty）——若 flush 不等在途 apply，
// "记录后立即 flushAllCaches"会早退丢记录（单测实证）。apply 串行队列：
// 保序（事件流时序语义）+ flush 先排空再落盘。
// v14.25.0: serialized apply queue — fire-and-forget recorders resolve async
// (load-before-dirty), so flush must drain in-flight applies before saving or
// a record-then-flush loses the record (proven by unit test).
let applyChain = Promise.resolve();
/** @param {() => Promise<void>} fn */
function enqueueApply(fn) {
  applyChain = applyChain.then(fn).catch(() => {});
}

/** 强制立即写入（先排空在途 apply；flush 链尾纳管）/ Drain then force flush */
export async function flushUsageEvidence() {
  await applyChain;
  return writer.flush();
}

/** 重置（清除数据/备份恢复后调用）/ Reset */
export function resetUsageEvidence() {
  evidenceMemory = { v: 1, since: 0, counters: {}, durations: {}, events: [] };
  evidenceDirty = false;
  evidenceLoaded = false;
  writer.reset();
}

// v14.25.0 内部：装载后应用（记录点均 fire-and-forget；装载一次后同步内存路径）
/** @returns {Promise<void>} */
function ensureLoaded() {
  return loadEvidence();
}

/** @param {string} key @param {number} inc */
async function applyCounter(key, inc) {
  await ensureLoaded();
  evidenceMemory.counters[key] = (evidenceMemory.counters[key] || 0) + inc;
  evidenceDirty = true;
  scheduleWrite();
}

/** @param {string} key @param {number} ms */
async function applyDuration(key, ms) {
  await ensureLoaded();
  const ring = evidenceMemory.durations[key] || (evidenceMemory.durations[key] = []);
  ring.push(Math.max(0, Math.round(ms)));
  while (ring.length > STORAGE_CAPS.usageEvidenceDurations) ring.shift(); // 环形淘汰最旧
  evidenceDirty = true;
  scheduleWrite();
}

/**
 * @param {string} cat
 * @param {string} k
 * @param {{kind?: string, appId?: string}} [extra]
 */
async function applyEvent(cat, k, extra) {
  await ensureLoaded();
  /** @type {{t: number, cat: string, k: string, kind?: string, appId?: string}} */
  const ev = { t: Date.now(), cat, k };
  if (extra && extra.kind) ev.kind = String(extra.kind).slice(0, 40);
  if (extra && extra.appId) ev.appId = String(extra.appId).slice(0, 20);
  evidenceMemory.events.push(ev);
  while (evidenceMemory.events.length > STORAGE_CAPS.usageEvidenceEvents) evidenceMemory.events.shift();
  evidenceDirty = true;
  scheduleWrite();
}

// ---- 对外记录 API（fire-and-forget；allowlist/环形/FIFO 全部有界） ----

/**
 * 记录累计计数（allowlist 外静默丢弃——防调用点笔误撑爆键空间）。
 * @param {string} key - COUNTER_KEYS 内的键
 * @param {number} [inc]
 */
export function recordUsageCounter(key, inc = 1) {
  if (!COUNTER_KEYS.has(key)) return;
  enqueueApply(() => applyCounter(key, inc));
}

/**
 * 记录耗时样本（环形 ≤STORAGE_CAPS.usageEvidenceDurations；键外静默丢弃）。
 * @param {string} key - DURATION_KEYS 内的键
 * @param {number} ms
 */
export function recordUsageDuration(key, ms) {
  if (!DURATION_KEYS.has(key) || typeof ms !== 'number' || !Number.isFinite(ms)) return;
  enqueueApply(() => applyDuration(key, ms));
}

/**
 * 记录高信号事件（FIFO ≤STORAGE_CAPS.usageEvidenceEvents；kind/appId 截断）。
 * @param {string} cat - 类别（match/reviews/rating/platform/report）
 * @param {string} k - 事件键
 * @param {{kind?: string, appId?: string}} [extra]
 */
export function recordUsageEvent(cat, k, extra) {
  enqueueApply(() => applyEvent(cat, k, extra));
}

// ---- 报告聚合（纯函数，可单测）/ Report aggregation (pure) ----

/**
 * 单键耗时统计（纯）：n/p50/p90/max（升序取分位；空数组 → n=0 null 分位）。
 * @param {number[]} ring
 * @returns {{n: number, p50: number|null, p90: number|null, max: number|null}}
 */
export function durationStats(ring) {
  const list = (Array.isArray(ring) ? ring : [])
    .filter((n) => typeof n === 'number' && Number.isFinite(n))
    .slice()
    .sort((a, b) => a - b);
  const n = list.length;
  if (n === 0) return { n: 0, p50: null, p90: null, max: null };
  const at = (q) => list[Math.min(n - 1, Math.floor(q * n))];
  return { n, p50: at(0.5), p90: at(0.9), max: list[n - 1] };
}

/**
 * 构建证据报告（纯）：计数 + 耗时分位 + 事件近 7 天分布 + 原始事件尾。
 * 报告 = 后续优化会话的直接输入（读此结构即可定位问题/调默认参数）。
 * @param {UsageEvidenceStore} store
 * @param {number} [now] - 当前时间（默认 Date.now()；测试注入）
 */
export function buildEvidenceReport(store, now = Date.now()) {
  const durations = {};
  for (const [k, ring] of Object.entries(store.durations || {})) durations[k] = durationStats(ring);
  // 事件近 7 天分布：cat.k（含 kind）→ 计数（优化关注的"最近发生了什么"）
  const weekAgo = now - 7 * 24 * 3600e3;
  /** @type {Record<string, number>} */
  const recentByKind = {};
  for (const ev of store.events || []) {
    if (!ev || ev.t < weekAgo) continue;
    const key = ev.kind ? `${ev.cat}.${ev.k}:${ev.kind}` : `${ev.cat}.${ev.k}`;
    recentByKind[key] = (recentByKind[key] || 0) + 1;
  }
  return {
    since: store.since || null,
    generatedAt: now,
    counters: { ...(store.counters || {}) },
    durations,
    recentEvents7d: recentByKind,
    events: (store.events || []).slice(-80) // 原始事件尾（最新 80 条，供逐条研判）
  };
}

/** 装载 + 构建报告（handler 消费入口）/ Load then build (handler entry). */
export async function buildUsageEvidenceReport() {
  await ensureLoaded();
  return buildEvidenceReport(evidenceMemory);
}

// 供测试/管理页读取的内存引用 / In-memory reference (tests)
export function getUsageEvidenceMemory() {
  return evidenceMemory;
}
