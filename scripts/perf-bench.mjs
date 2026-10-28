/**
 * 游戏雷达 Game Radar - 性能基准 / Performance Bench (v14.7 批次 13)
 *
 * 模拟 60 游戏列表页批量检索全链路（mock 网络），输出三段耗时：
 *   ① 首波缓存命中（阶段 1 cache-only 响应）
 *   ② 批次完成（首响应 → done 推送，含 worker pool 拉取）
 *   ③ 总收尾（发起 → done）
 * 用法：node scripts/perf-bench.mjs [--games=60]；gate 可选步骤
 * （npm run gate -- --bench），用于回归对比批次 6/8/10 的优化效果。
 * mock 端点集与 test-orchestrator 同源（storesearch/appdetails/appreviews/
 * ISteamNews）；未缓存游戏经名称索引解析（免 storesearch）。
 */
import { performance } from 'node:perf_hooks';
import { createStorageMock, installChromeStorageMock } from '../tests/helpers/storage-mock.mjs';
import { createFetchMock, installFetchMock } from '../tests/helpers/fetch-mock.mjs';

const storage = createStorageMock();
installChromeStorageMock(storage);

const GAME_COUNT = Number(process.argv.find((a) => a.startsWith('--games='))?.split('=')[1]) || 60;
const CACHE_RATIO = 0.5; // 一半已缓存（冷热混合最贴近真实浏览场景）

// chrome 桩：捕获 STEAM_RATINGS_UPDATE 推送时间线（tabs.sendMessage）
const pushTimes = [];
let doneAt = null;
globalThis.chrome = globalThis.chrome || {};
globalThis.chrome.runtime = globalThis.chrome.runtime || {};
globalThis.chrome.runtime.getManifest = () => ({ version: '0.0.0-bench' });
globalThis.chrome.runtime.getPlatformInfo = async () => ({ os: 'win' });
globalThis.chrome.storage = globalThis.chrome.storage || {
  local: { get: async () => ({}), set: async () => {} },
  session: { get: async () => ({}), set: async () => {} }
};
globalThis.chrome.tabs = {
  sendMessage: async (_tabId, msg) => {
    if (msg && msg.action === 'STEAM_RATINGS_UPDATE') {
      pushTimes.push(performance.now());
      if (msg.done) doneAt = performance.now();
    }
    return {};
  }
};

const apps = Array.from({ length: GAME_COUNT }, (_, i) => ({
  appid: 700000 + i,
  name: `Bench Game ${String(i).padStart(3, '0')}`
}));

// 端点 mock（与 test-orchestrator 同源）——appdetails 需按 appid 动态返回
const appdetailsHandlers = {};
for (const a of apps) {
  appdetailsHandlers[a.appid] = {
    success: true,
    data: {
      steam_appid: a.appid,
      name: a.name,
      type: 'game',
      genres: [{ id: 1, description: 'RPG' }],
      supported_languages: { schinese: { subtitles: true } }
    }
  };
}
const fetchMock = createFetchMock({
  '/api/storesearch': { total: 0, items: [] }, // 名称索引已覆盖——不触达
  '/api/appdetails': appdetailsHandlers,
  '/appreviews': {
    success: 1,
    query_summary: {
      total_reviews: 1000,
      total_positive: 900,
      total_negative: 100,
      review_score: 9,
      review_score_desc: '特别好评'
    },
    reviews: []
  },
  '/api/ISteamNews': { appnews: { newsitems: [] } }
});
const restoreFetch = installFetchMock(fetchMock);

const { handleGetSteamRatings } = await import('../background/steam/ratings-batch.js');
const cacheMod = await import('../background/storage/steam-cache.js');
const nameIdx = await import('../background/storage/name-index.js');

// 播种：全部名称入索引（免 storesearch）；前 CACHE_RATIO 入 rating 缓存
await cacheMod.loadSteamCacheToMemory();
for (const a of apps) {
  await nameIdx.recordNameIndex(a.name, String(a.appid));
}
await nameIdx.flushNameIndex();
const cachedCount = Math.floor(GAME_COUNT * CACHE_RATIO);
for (const a of apps.slice(0, cachedCount)) {
  await cacheMod.setSteamCacheEntry(String(a.appid), {
    appId: String(a.appid),
    name: a.name,
    type: 'game',
    positiveRate: 80,
    ratingDesc: '特别好评',
    totalReviews: 1000,
    recentPositiveRate: 80,
    recentTotalReviews: 100,
    lastUpdate: '2026-10-01'
  });
}
await cacheMod.flushSteamCache();

const names = apps.map((a) => a.name);
const t0 = performance.now();
let firstRespAt = null;
await handleGetSteamRatings({ names, urls: {}, imageData: {} }, { tab: { id: 1 } }).then(() => {
  firstRespAt = performance.now();
});
// done 推送由后台任务异步到达——轮询等待（上限 30s）
const deadline = Date.now() + 30000;
while (!doneAt && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
restoreFetch();

const fmt = (ms) => `${Math.round(ms)}ms`;
console.log(`\n===== perf-bench（${GAME_COUNT} 游戏，${Math.round(CACHE_RATIO * 100)}% 预缓存）=====`);
console.log('① 首波缓存命中（阶段1响应）:', firstRespAt ? fmt(firstRespAt - t0) : '无');
console.log('② 批次完成（首响应→done）:', doneAt ? fmt(doneAt - firstRespAt) : '未完成（30s 超时）');
console.log('③ 总收尾（发起→done）:', doneAt ? fmt(doneAt - t0) : '未完成（30s 超时）');
console.log('推送波次数:', pushTimes.length);
console.log(
  'storesearch 调用次数（应为 0——目录/索引覆盖）:',
  fetchMock._calls.filter((u) => u.includes('/api/storesearch')).length
);
if (!doneAt) process.exit(1);
