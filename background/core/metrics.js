// @ts-strict
/**
 * 游戏雷达 Game Radar - 运行指标 / Runtime Metrics
 *
 * v10.7.0 批次5：轻量指标框架（内存计数 + 直方图，session-persist 防抖落盘）——
 * 把"写放大/SW 唤醒/消息量/批次耗时"等优化收益变成可观测数字。
 * 契约：metricInc(name[, by]) 计数；metricObserve(name, ms) 耗时样本；
 * snapshot() 汇总 {counters, hist}（直方图保留 min/max/avg/p95/样本数）。
 * 全部有界（计数键 ≤64、直方图 ≤16、样本环形 200）防内存膨胀。
 *
 * Lightweight metrics (in-memory counters + histograms, debounced persist via
 * session-persist). metricInc/metricObserve/snapshot; all bounded.
 */
import { createSessionPersist } from './session-persist.js';

const MAX_COUNTER_KEYS = 64;
const MAX_HIST_KEYS = 16;
const MAX_SAMPLES = 200; // 每指标环形样本上限

const persist = createSessionPersist('grMetrics', {
  initial: {
    /** @type {Object<string, number>} */
    counters: {},
    /** @type {Object<string, number[]>} */
    hist: {}
  }
});

export async function warmupMetrics() {
  await persist.load();
}

/** 计数器递增 / increment a counter */
export function metricInc(name, by = 1) {
  const s = persist.peek();
  const counters = s.counters;
  // 键数有界：新键超过上限丢弃（诊断数据不应对抗业务内存）
  if (counters[name] === undefined && Object.keys(counters).length >= MAX_COUNTER_KEYS) return;
  counters[name] = (counters[name] || 0) + by;
  persist.scheduleSave();
}

/** 耗时样本（ms）/ record a duration sample */
export function metricObserve(name, ms) {
  const s = persist.peek();
  const hist = s.hist;
  if (!hist[name] && Object.keys(hist).length >= MAX_HIST_KEYS) return;
  const arr = hist[name] || (hist[name] = []);
  if (arr.length >= MAX_SAMPLES) arr.shift();
  arr.push(Number(ms) || 0);
  persist.scheduleSave();
}

/**
 * 快照（GET_RUNTIME_METRICS 响应体）：
 * hist 项 → {count, min, max, avg, p95}
 * Snapshot: raw counters + per-histogram summary stats.
 */
export function metricsSnapshot() {
  const { counters, hist } = persist.peek();
  const histOut = {};
  for (const [name, arr] of Object.entries(hist || {})) {
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const sorted = [...arr].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    histOut[name] = {
      count: sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: Math.round(sum / sorted.length),
      p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
    };
  }
  return { counters: { ...(counters || {}) }, hist: histOut };
}

// v10.7.0 批次5：OPFS 写指标聚合（data-store 钩子消费）——按模块计数与字节
// （计数键有界由 metricInc 保证；模块名聚合为 opfs.<file>）
export function trackOpfsWrite(fileName, bytes) {
  const mod = String(fileName || 'unknown').replace(/\.(json|ndjson)(\.corrupt-.*)?$/, '');
  metricInc('opfs.writeCount.' + mod);
  metricInc('opfs.writeBytes.' + mod, Number(bytes) || 0);
}

// 重置（测试/清理用）/ Reset
export function resetMetrics() {
  persist.reset();
}
