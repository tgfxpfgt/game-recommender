// @ts-strict
/**
 * 游戏雷达 Game Radar - Steam API 状态监测 / Steam API Monitor
 *
 * v3.3.0：滑动窗口统计 Steam API 调用（成功/失败/限流状态码），
 * 失败率超阈值判定为"异常/限流"状态，供弹窗提醒与批量检索降速。
 * Sliding-window stats over Steam API calls; a fail-rate above the threshold
 * flags an anomaly (rate limiting), surfaced in the popup and used to slow
 * down batch fetches.
 * v10.0.0：调用窗口持久化到 storage.session（防抖）——SW 冷启动后限流
 * 检测连续，不再从空窗口重新统计。
 */
import { createSessionPersist } from './session-persist.js';

// 统计窗口 / stats window
const WINDOW_MS = 5 * 60 * 1000; // 5 分钟
// 判定阈值 / thresholds
const FAIL_RATE_THRESHOLD = 0.4; // 失败率 > 40% 视为异常
const MIN_SAMPLES = 8; // 至少 8 次采样才判定（避免小样本误报）
const MAX_SAMPLES = 200; // 窗口内样本上限（防内存膨胀）

const persist = createSessionPersist('grApiMonitor', { initial: [] });

// 预热（SW 启动时调用——从 session 读回调用窗口）
export async function warmupApiMonitor() {
  await persist.load();
}

// 记录一次 Steam API 调用（status 为 HTTP 状态码，0 = 网络异常）
// Record one Steam API call (status = HTTP code; 0 = network error)
// v3.4.1：惰性清理——不再每次调用都全量 filter（批量检索时高频调用，
// 此前每次 O(n) 扫描；现仅在超上限 64 条时压缩一次，读取时再惰性过期）
export function recordSteamCall(ok, status = 0) {
  const now = Date.now();
  const calls = persist.peek();
  calls.push({ t: now, ok: !!ok, status: status || 0 });
  if (calls.length > MAX_SAMPLES + 64) {
    const kept = calls.filter((c) => now - c.t < WINDOW_MS).slice(-MAX_SAMPLES);
    calls.length = 0;
    calls.push(...kept);
  }
  persist.scheduleSave();
}

// 获取当前 API 状态（纯函数，可单测）
// Current API status (pure; unit-testable)
export function getSteamApiStatus() {
  const now = Date.now();
  const recent = persist.peek();
  if (recent.length > 0 && now - recent[0].t >= WINDOW_MS) {
    const kept = recent.filter((c) => now - c.t < WINDOW_MS);
    recent.length = 0;
    recent.push(...kept);
  }
  const total = recent.length;
  const failed = recent.filter((c) => !c.ok).length;
  // 限流迹象：HTTP 429/503（0 = 网络异常，不并入限流）
  const limited = recent.filter((c) => c.status === 429 || c.status === 503).length;
  const failRate = total >= MIN_SAMPLES ? failed / total : 0;
  const anomaly = total >= MIN_SAMPLES && failRate > FAIL_RATE_THRESHOLD;
  let lastFailedAt = null;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (!recent[i].ok) {
      lastFailedAt = recent[i].t;
      break;
    }
  }
  return {
    total,
    failed,
    limited,
    failRate: Math.round(failRate * 100),
    anomaly,
    windowSec: Math.round(WINDOW_MS / 1000),
    lastFailedAt
  };
}

// 重置（测试/清理用）/ Reset
export function resetApiMonitor() {
  persist.reset();
}
