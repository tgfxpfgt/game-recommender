/**
 * 游戏雷达 Game Radar - 存储聚合落盘 / Aggregated Cache Flush
 *
 * v5.0.0：flushSteamCache + flushNameIndex + flushRegistry 三连调用
 * 此前在 handlers/ratings-batch 手写 10 处，收敛为单一聚合函数
 *（与 resetInMemoryCaches 对称的"落盘"侧）。
 * Aggregates the tripled cache flush (steam/name-index/registry) previously
 * hand-written in 10 call sites; the flush counterpart of resetInMemoryCaches.
 */
import { flushSteamCache } from './steam-cache.js';
import { flushNameIndex } from './name-index.js';
import { flushRegistry } from './registry.js';
import { flushUrlIndex } from './url-index.js';
import { flushWrongReports } from './wrong-reports.js';
import { flushLearnedNoise } from './learned-noise.js';
import { flushLogBuffer } from './logger.js';
import { flushAppStats } from './app-stats.js';

// v9.3.0：聚合落盘全覆盖——此前仅 steam/name-index/registry 三层；
// url-index（2s 防抖）/wrong-reports/learned-noise/logger（日志缓冲）不在
// 聚合范围，SW 休眠时存在防抖窗口内写入丢失。download-urls 为即时写（无需）。
// v10.5.0 P1-B：补 app-stats（2s 防抖计数）纳入聚合，供周期性兜底 flush 全覆盖。
// Flush every debounced store (SW-suspend safety net for debounce windows).
export async function flushAllCaches() {
  await flushSteamCache();
  await flushNameIndex();
  await flushRegistry();
  await flushUrlIndex();
  await flushWrongReports();
  await flushLearnedNoise();
  await flushAppStats();
  await flushLogBuffer();
}
