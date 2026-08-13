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

// 三层缓存全部落盘 / flush all three caches
export async function flushAllCaches() {
  await flushSteamCache();
  await flushNameIndex();
  await flushRegistry();
}
