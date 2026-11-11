/**
 * 游戏雷达 Game Radar - 运行期诊断轨迹 / Runtime Diagnostic Trace
 *
 * v14.28.9（L4 运行期录制）：把"卡在哪、为什么卡"从日志文本变成结构化轨迹——
 * 每个阶段 enter/exit/失败/停滞/缓存命中/波次都是一条定长白名单事件，环形
 * 缓冲 500 条、2s 防抖落盘、随一键诊断包导出。目的是**不复现也能定位**：
 * 一份轨迹应能回答「最后一个有 enter 无 exit 的 stage」「该 stage 的 durMs 与
 * 最近 failKind」「波次 counts」「哪一层缓存命中」。
 *
 * 隐私硬约束：事件对象只允许 TRACE_KEYS 白名单字段；不记录 URL（仅 hostname）、
 * 页面正文、游戏名（gameKey 为稳定短哈希）、用户标识、appId 明文。
 * 本地、有界、零出站；clearOnDataReset 随"清除数据"一并清理，不进默认备份。
 *
 * v14.28.9 (L4 runtime trace): bounded, local, whitelisted-field events for
 * offline diagnosis; exported inside the diagnostic bundle. No URLs beyond the
 * hostname, no page text, no game titles (stable short hash only), no user ids.
 */
import { dataStore } from '../../data/data-store.js';
import { DB_KEYS, NAME_INDEX_WRITE_DEBOUNCE } from '../core/constants.js';
import { createDebouncedStore } from './debounced-store.js';

/** 轨迹结构版本（夹具保鲜门禁按此比对；不随业务版本递增） */
export const SCHEMA_VERSION = 1;
/** 环形缓冲上限（500 × ~200B ≈ 100KB 上限） */
export const MAX_EVENTS = 500;

/** 允许的 stage 枚举 / Allowed stages */
export const TRACE_STAGES = new Set(['search', 'ratings', 'detail', 'cache', 'applist', 'boot']);
/** 允许的 event 枚举 / Allowed events */
export const TRACE_EVENTS = new Set(['enter', 'exit', 'fail', 'stall', 'push', 'hit', 'miss', 'dump']);
/** 允许的 failKind 枚举（与故障语义一致）/ Allowed failure kinds */
export const TRACE_FAIL_KINDS = new Set(['network', 'timeout', 'ratelimit', 'empty', 'notfound', 'parse']);
/** 允许的缓存层枚举 / Allowed cache layers */
export const TRACE_CACHE_LAYERS = new Set(['memory', 'session', 'opfs', 'negative', 'miss']);

/** 事件白名单键（新增字段必须同步本表 + spec.md L4 数据点表） */
export const TRACE_KEYS = new Set([
  'seq',
  't',
  'stage',
  'event',
  'durMs',
  'failKind',
  'httpStatus',
  'host',
  'cacheLayer',
  'source',
  'confidence',
  'wave',
  'counts',
  'bytes',
  'entries',
  'swWakeId',
  'gameKey'
]);

/** 本次 SW 唤醒 id（时间戳单调递增；跨唤醒可据此统计次数与耗时） */
export const SW_WAKE_ID = Date.now();

/**
 * 游戏名 → 稳定短哈希（DJB2 → base36 取 6 位）。
 * 只用于同一会话内关联，不可逆推游戏名。
 * @param {string} name
 * @returns {string}
 */
export function gameKeyOf(name) {
  const s = String(name || '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(-6).padStart(6, '0');
}

/**
 * 白名单键守卫（开发期/测试期）：出现表外键即抛错。
 * 运行时写入走 sanitizeTraceEvent（剔除未知键）——不做重校验。
 * @param {any} event
 * @returns {boolean}
 */
export function assertAllowedKeys(event) {
  if (!event || typeof event !== 'object') throw new Error('诊断事件必须是对象');
  for (const k of Object.keys(event)) {
    if (!TRACE_KEYS.has(k)) throw new Error(`诊断事件含非白名单字段: ${k}`);
  }
  return true;
}

/**
 * 单条事件净化（白名单 + 枚举 + 截断）；非法事件返回 null。
 * @param {any} raw
 * @returns {any|null}
 */
export function sanitizeTraceEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const stage = String(raw.stage || '');
  const event = String(raw.event || '');
  if (!TRACE_STAGES.has(stage) || !TRACE_EVENTS.has(event)) return null;
  /** @type {any} */
  const out = { stage, event };
  for (const k of TRACE_KEYS) {
    if (k === 'stage' || k === 'event' || raw[k] === undefined) continue;
    const v = raw[k];
    switch (k) {
      case 'seq':
        break; // seq/t 由写入端统一分配
      case 't':
      case 'durMs':
      case 'httpStatus':
      case 'wave':
      case 'bytes':
      case 'entries':
      case 'swWakeId':
        if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v);
        break;
      case 'failKind':
        if (TRACE_FAIL_KINDS.has(String(v))) out[k] = String(v);
        break;
      case 'cacheLayer':
        if (TRACE_CACHE_LAYERS.has(String(v))) out[k] = String(v);
        break;
      case 'host':
        // 只保留 hostname（防调用方误传完整 URL）
        out[k] = String(v).split('/')[0].slice(0, 80);
        break;
      case 'source':
      case 'confidence':
      case 'gameKey':
        out[k] = String(v).slice(0, 40);
        break;
      case 'counts': {
        const c = v && typeof v === 'object' ? v : {};
        const num = (/** @type {any} */ n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0);
        out[k] = { total: num(c.total), done: num(c.done), failed: num(c.failed) };
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** @type {{schemaVersion: number, recordedAt: number, events: any[]}} */
let traceMemory = { schemaVersion: SCHEMA_VERSION, recordedAt: 0, events: [] };
let traceLoaded = false;
let traceDirty = false;
let seqCounter = 0;

async function loadTrace() {
  if (traceLoaded) return;
  const stored = /** @type {any} */ (await dataStore.readModule(DB_KEYS.DIAG_TRACE));
  if (stored && typeof stored === 'object' && Array.isArray(stored.events)) {
    traceMemory = {
      schemaVersion: SCHEMA_VERSION,
      recordedAt: stored.recordedAt || 0,
      events: stored.events.slice(-MAX_EVENTS)
    };
    seqCounter = traceMemory.events.reduce((m, e) => Math.max(m, Number(e && e.seq) || 0), 0);
  } else {
    traceMemory = { schemaVersion: SCHEMA_VERSION, recordedAt: 0, events: [] };
  }
  traceLoaded = true;
}

// 防抖写入三件套（写失败保留 dirty 待重试 + flushAllCaches 纳管 + reset 取消挂起）
const writer = createDebouncedStore({
  name: '诊断轨迹',
  debounceMs: NAME_INDEX_WRITE_DEBOUNCE,
  save: async () => {
    if (!traceDirty) return;
    traceMemory.recordedAt = Date.now();
    await dataStore.writeModule(DB_KEYS.DIAG_TRACE, {
      schemaVersion: SCHEMA_VERSION,
      recordedAt: traceMemory.recordedAt,
      events: traceMemory.events
    });
    traceDirty = false; // 仅成功后清除（失败保留待重试）
  }
});

// 记录 API 为 fire-and-forget（load-before-append）；apply 串行队列保序，
// flush 先排空在途记录再落盘（记录后立即 flush 不丢事件）。
let applyChain = Promise.resolve();
/** @param {() => Promise<void>} fn */
function enqueueApply(fn) {
  applyChain = applyChain.then(fn).catch(() => {});
}

/** @param {any} ev */
async function applyEvent(ev) {
  await loadTrace();
  ev.seq = ++seqCounter;
  ev.t = Date.now();
  ev.swWakeId = SW_WAKE_ID;
  traceMemory.events.push(ev);
  while (traceMemory.events.length > MAX_EVENTS) traceMemory.events.shift();
  traceDirty = true;
  writer.scheduleWrite();
}

/**
 * 记录一条诊断事件（白名单外字段剔除；非法 stage/event 丢弃）。
 * @param {any} event
 */
export function recordTrace(event) {
  const clean = sanitizeTraceEvent(event);
  if (!clean) return;
  enqueueApply(() => applyEvent(clean));
}

/** 强制落盘（先排空在途记录；flush 链尾）/ Drain then force flush */
export async function flushDiagTrace() {
  await applyChain;
  return writer.flush();
}

/** 清空轨迹（保留 schemaVersion；立即落盘空态）/ Clear and persist empty */
export async function clearTrace() {
  await applyChain;
  traceMemory = { schemaVersion: SCHEMA_VERSION, recordedAt: Date.now(), events: [] };
  seqCounter = 0;
  traceDirty = true;
  traceLoaded = true;
  await writer.flush();
}

/** 重置内存态（清除数据/备份恢复后调用）/ Reset in-memory state */
export function resetDiagTrace() {
  traceMemory = { schemaVersion: SCHEMA_VERSION, recordedAt: 0, events: [] };
  seqCounter = 0;
  traceLoaded = false;
  traceDirty = false;
  writer.reset();
}

/**
 * 读取轨迹快照（深拷贝；不暴露内部数组）。
 * @returns {Promise<{schemaVersion: number, recordedAt: number, events: any[]}>}
 */
export async function getTrace() {
  await applyChain;
  await loadTrace();
  return {
    schemaVersion: SCHEMA_VERSION,
    recordedAt: traceMemory.recordedAt,
    events: traceMemory.events.map((e) => ({ ...e }))
  };
}

/**
 * 轨迹判读（纯函数）：回答四件事——卡在哪个 stage / 卡了多久 / 最近失败类别 /
 * 缓存命中层 + 波次进度。
 * 卡点定义：存在 enter 而之后没有 exit 的 stage（fail/stall 不关闭 enter——
 * 失败或停滞的 stage 没有"完成退出"），取最后一个。durMs 以轨迹末事件时刻
 * 为终点（`now` 可注入；缺省用末事件时间，使历史夹具的判定与录制时一致）。
 * @param {any[]} events
 * @param {number} [now]
 * @returns {{verdict: string, stuckStage: string|null, stuckDurMs: number|null, lastFailKind: string|null, cacheLayer: string|null, counts: {total: number, done: number, failed: number}|null, summary: string}}
 */
export function classifyTrace(events, now) {
  const list = Array.isArray(events) ? events.filter((e) => e && typeof e === 'object') : [];
  /** @type {Map<string, {t: number}>} */
  const open = new Map();
  /** @type {string|null} */
  let lastFailKind = null;
  /** @type {string|null} */
  let lastCacheLayer = null;
  /** @type {{total: number, done: number, failed: number}|null} */
  let counts = null;
  let lastT = 0;
  for (const e of list) {
    if (typeof e.t === 'number' && Number.isFinite(e.t)) lastT = Math.max(lastT, e.t);
    if (e.counts && typeof e.counts === 'object') {
      counts = {
        total: Number(e.counts.total) || 0,
        done: Number(e.counts.done) || 0,
        failed: Number(e.counts.failed) || 0
      };
    }
    if (e.failKind) lastFailKind = String(e.failKind);
    if ((e.event === 'hit' || e.event === 'miss') && e.cacheLayer) lastCacheLayer = String(e.cacheLayer);
    if (e.stage && e.event === 'enter') open.set(String(e.stage), { t: Number(e.t) || 0 });
    else if (e.stage && e.event === 'exit') open.delete(String(e.stage));
  }
  /** @type {string|null} */
  let stuckStage = null;
  let stuckSince = 0;
  for (const [stage, v] of open) {
    if (!stuckStage || v.t >= stuckSince) {
      stuckStage = stage;
      stuckSince = v.t;
    }
  }
  const endT = typeof now === 'number' && Number.isFinite(now) ? now : lastT;
  const stuckDurMs = stuckStage ? Math.max(0, endT - stuckSince) : null;

  /** @type {string} */
  let verdict = 'ok';
  if (list.length === 0) verdict = 'empty';
  else if (stuckStage) {
    if (lastFailKind === 'network' || lastFailKind === 'timeout' || lastFailKind === 'ratelimit')
      verdict = lastFailKind;
    else verdict = 'stalled';
  } else if (lastFailKind && lastFailKind !== 'empty') {
    verdict = lastFailKind === 'empty' ? 'ok' : lastFailKind;
  }

  const countText = counts ? `${counts.done}/${counts.total}(失败${counts.failed})` : '无';
  const summary =
    `verdict=${verdict}` +
    (stuckStage ? ` 卡在=${stuckStage}(${stuckDurMs}ms)` : ' 无卡点') +
    ` 最近失败=${lastFailKind || '无'}` +
    ` 缓存层=${lastCacheLayer || '无'}` +
    ` 波次=${countText}`;
  return {
    verdict,
    stuckStage,
    stuckDurMs,
    lastFailKind,
    cacheLayer: lastCacheLayer,
    counts,
    summary
  };
}
