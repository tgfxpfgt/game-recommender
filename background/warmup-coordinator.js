/**
 * 游戏雷达 Game Radar - 分层预热协调器（v14.13 B2，报告 A W2）
 *
 * SW 顶层此前 34 imports 中 15 个是温层预热目标（v14.5.0 B2 起"静态 import +
 * setTimeout 延迟调用"），import 声明与 setTimeout 体内清单分散两处，新增
 * 温层模块要同时改两处。本模块收敛：热层/温层目标单源数组 + runHotTier/
 * runWarmTier 入口；后续新增温层模块只改本文件。
 * Warmup coordinator: hot/warm tier target arrays + run entry points, so
 * adding a warm-tier module touches only this file.
 *
 * 语义不变：静态 import（MV3 SW 禁动态 import）+ 延迟调用（热层立即、温层
 * 15s）；Promise.allSettled 容错（单模块失败不拖垮预热）。
 */
import { loadSteamCacheToMemory } from './storage/steam-cache.js';
import { warmupRegistry as warmupRegistryModule } from './storage/registry.js';
import { warmupWrongReports } from './storage/wrong-reports.js';
import { warmupLearnedNoise } from './storage/learned-noise.js';
import { warmupUrlIndex } from './storage/url-index.js';
import { warmupBehavior } from './storage/behavior.js';
import { warmupDownloadUrls } from './storage/download-urls.js';
import { warmupOutboundAudit } from './core/outbound-audit.js';
import { createSessionPersist } from './core/session-persist.js';
// v14.13 B2：siteAlert 载入从 handlers/diag-status 下沉——background 底层
// （core/storage）不得反向 import handlers 层（分层矩阵），此处直连同源
// session-persist 实例的 load()
const siteAlertPersist = createSessionPersist('grSiteAlertLast', { initial: {} });
import { ensureAppListIndex } from './steam/app-list-index.js';
import { warmupNameIndex } from './storage/name-index.js';
import { warmupApiMonitor } from './core/api-monitor.js';
import { warmupMetrics } from './core/metrics.js';
import { warmupTabGames } from './core/tab-game.js';
import { resumeRatingsBatch } from './steam/ratings-batch.js';
import { ensureRetrievalVocabOverride } from './steam/retrieval-override.js';

// 热层（SW 启动即调）：列表页首波所需的 meta+rating 与消息可用性
const HOT_TIER_TARGETS = [
  () => loadSteamCacheToMemory({ hotOnly: true }), // v14.7 批次 10：热层先行
  warmupNameIndex,
  warmupApiMonitor,
  warmupMetrics, // v10.7.0：运行指标
  warmupTabGames, // v14.1.0：SidePanel tab 快照
  () => ensureRetrievalVocabOverride(), // v14.7 批次 12：R2 词表覆盖装载
  resumeRatingsBatch
];

// 温层（15s 后补载）：detail/spy 补载与低频模块
const WARM_TIER_TARGETS = [
  () => loadSteamCacheToMemory(), // v14.7 批次 10：温层补载 detail/spy
  warmupRegistryModule,
  warmupWrongReports,
  warmupLearnedNoise,
  warmupUrlIndex,
  warmupBehavior,
  warmupDownloadUrls,
  warmupOutboundAudit,
  () => siteAlertPersist.load(), // 原 handlers/diag-status warmupSiteAlertPersist
  () => ensureAppListIndex() // v14.6：目录索引温层加载（仅读盘，无网络）
];

const WARM_TIER_DELAY_MS = 15000;

/** 热层运行（SW 启动即调）/ Run the hot tier immediately at SW startup. */
export function runHotTier() {
  return Promise.allSettled(HOT_TIER_TARGETS.map((fn) => fn()));
}

/** 温层运行（15s 延迟）/ Run the warm tier after the 15s defer. */
export function runWarmTier() {
  return new Promise((resolve) => {
    setTimeout(() => {
      Promise.allSettled(WARM_TIER_TARGETS.map((fn) => fn())).then(resolve, resolve);
    }, WARM_TIER_DELAY_MS);
  });
}
