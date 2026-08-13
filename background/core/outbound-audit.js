// @ts-strict
/**
 * 游戏雷达 Game Radar - 出站请求审计与限速 / Outbound Request Audit & Rate Limit
 *
 * v3.4.1：fetchWithTimeout 唯一出站通道的配套模块——
 *   ① 环形缓冲审计：记录每次出站请求（主机/耗时/状态/成败），供 dashboard
 *      查看与异常外联溯源（此前仅 api-monitor 记 Steam 成败计数，无 URL）。
 *   ② 每主机滑动窗口限速：防止误配端点/失控循环打爆外部服务（兜底，
 *      阈值远宽于正常使用；Steam 批处理另有自身异常降速）。
 * Companion module of the single outbound fetch channel: ring-buffer audit
 * (host/duration/status) for traceability, and a per-host sliding-window rate
 * limit as a safety net (generous threshold; Steam batches have their own
 * anomaly-based throttling).
 */

// 审计缓冲上限（防内存膨胀）/ audit ring-buffer cap
export const AUDIT_MAX = 300;
// 限速窗口与每主机上限 / rate-limit window & per-host cap
export const RATE_WINDOW_MS = 10000; // 10s
export const RATE_MAX = 100; // 每窗口每主机 100 次（10/s 兜底）

let audit = []; // [{t, host, ok, ms, status}]
const rateCalls = new Map(); // host -> [t, ...]（窗口内时间戳）

// 记录一次出站请求（fetchWithTimeout 调用；含被拦截/限速/网络错误路径）
// Record one outbound request (called by fetchWithTimeout; covers blocked,
// rate-limited and network-error paths).
export function recordOutbound(host, ok, ms, status = 0, t = Date.now()) {
  audit.push({ t, host: String(host).slice(0, 80), ok: !!ok, ms: ms | 0, status: status | 0 });
  if (audit.length > AUDIT_MAX) audit = audit.slice(-AUDIT_MAX);
}

// 获取审计（entries 倒序，最新在前）+ 聚合统计
// Get audit entries (newest first) plus aggregate stats.
export function getOutboundAudit(limit = 100) {
  const total = audit.length;
  const failed = audit.filter((e) => !e.ok).length;
  const hosts = new Map();
  for (const e of audit) {
    const h = hosts.get(e.host) || { host: e.host, count: 0, failed: 0 };
    h.count++;
    if (!e.ok) h.failed++;
    hosts.set(e.host, h);
  }
  return {
    entries: audit.slice(-limit).reverse(),
    stats: {
      total,
      failed,
      failRate: total > 0 ? Math.round((failed / total) * 100) : 0,
      hosts: [...hosts.values()].sort((a, b) => b.count - a.count)
    }
  };
}

// 清空审计（测试/清理用；接入 resetInMemoryCaches）
// Clear the audit buffer (tests/cleanup; wired into resetInMemoryCaches).
export function resetOutboundAudit() {
  audit = [];
  rateCalls.clear();
}

// 每主机滑动窗口限速：窗口内超过 RATE_MAX 次则拒绝（now 可注入便于单测）
// Per-host sliding-window rate limit; returns false when the window is full.
export function checkRateLimit(host, now = Date.now()) {
  const key = String(host || '').slice(0, 80);
  if (!key) return true;
  let ts = rateCalls.get(key) || [];
  const cutoff = now - RATE_WINDOW_MS;
  ts = ts.filter((t) => t > cutoff);
  if (ts.length >= RATE_MAX) {
    rateCalls.set(key, ts);
    return false;
  }
  ts.push(now);
  rateCalls.set(key, ts);
  return true;
}
