import { test, expect } from 'vitest';
/**
 * 游戏雷达 Game Radar - 测试：Steam 编排器集成 / Orchestrator Integration Tests
 *
 * v4.2.0：两波好评率流程的真实后台逻辑（此前 content-sim 用 presets mock
 * 整个后台，orchestrator 零覆盖）。mock fetch（Steam API）+ storage mock
 * 驱动 getSteamRatingsFromCacheOnly（缓存命中/过期）与 getSteamPositiveRate
 * （缓存优先 → 搜索 → 写缓存链路）。
 */
('use strict');

import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';
import { createFetchMock, installFetchMock } from '../helpers/fetch-mock.mjs';

const storage = createStorageMock();
installChromeStorageMock(storage);

// 注意：cache/name-index 必须不带 ?t= 导入——orchestrator 以静态 import 引用
// 它们（无参数 URL），带 ?t= 会生成独立实例，写入的状态互不可见
// （与 test-outbound 的 outbound-audit 教训相同）。
const orchMod = await import(
  new URL('../../background/steam/orchestrator.js', import.meta.url).href + '?t=' + Date.now()
);
const cacheMod = await import(new URL('../../background/storage/steam-cache.js', import.meta.url).href);
const { getSteamRatingsFromCacheOnly, getSteamPositiveRate } = orchMod;

test('空名称返回 null', async () => {
  expect(await await getSteamRatingsFromCacheOnly('')).toEqual(null);
});
test('无索引无缓存返回 null', async () => {
  expect(await await getSteamRatingsFromCacheOnly('不存在的游戏')).toEqual(null);
});

// 预置缓存：名称索引 + rating 模块（用真实 setSteamCacheEntry 写入）
await cacheMod.loadSteamCacheToMemory();
await cacheMod.setSteamCacheEntry('275850', {
  appId: '275850',
  name: '无人深空',
  type: 'game',
  positiveRate: 85,
  ratingDesc: '特别好评',
  totalReviews: 1000,
  recentPositiveRate: 80,
  recentTotalReviews: 100,
  lastUpdate: '2026-08-01'
});
await cacheMod.flushSteamCache();
// 名称索引：写入 名称→appId（同样不带 ?t=，共享实例）
const nameIdx = await import(new URL('../../background/storage/name-index.js', import.meta.url).href);
await nameIdx.recordNameIndex('无人深空', '275850');
await nameIdx.flushNameIndex();

const cached = await getSteamRatingsFromCacheOnly('无人深空');
test('缓存命中返回好评率', () => {
  expect(cached && cached.positiveRate).toEqual(85);
});
test('缓存命中携带 appId', () => {
  expect(cached && cached.appId).toEqual('275850');
});
test('缓存命中携带近30天', () => {
  expect(cached && cached.recentPositiveRate).toEqual(80);
});

// 新游戏：无缓存 → mock Steam 搜索与详情 → 返回并写缓存
const fetchMock = createFetchMock({
  '/api/storesearch': { items: [{ id: 1245620, name: '艾尔登法环', type: 'app' }] },
  '/api/appdetails': {
    1245620: {
      success: true,
      data: {
        steam_appid: 1245620,
        name: '艾尔登法环',
        type: 'game',
        genres: [{ id: 1, description: 'RPG' }],
        supported_languages: { schinese: { full_audio: true, subtitles: true } }
      }
    }
  },
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
  '/api/ISteamNews': { appnews: { newsitems: [{ date: 1754900000 }] } }
});
const restoreFetch = installFetchMock(fetchMock);

const result = await getSteamPositiveRate('艾尔登法环', { ignoreNegativeCache: true });
test('搜索+详情链路返回 appId', () => {
  expect(result && String(result.appId)).toEqual('1245620');
});
test('好评率计算正确（900/1000）', () => {
  expect(result && result.positiveRate).toEqual(90);
});
// 写缓存后：二次查询应缓存命中（不再发起 storesearch 搜索）
const searchCallsBefore = fetchMock._calls.filter((u) => u.includes('/api/storesearch')).length;
const cached2 = await getSteamPositiveRate('艾尔登法环', { ignoreNegativeCache: true });
const searchCallsAfter = fetchMock._calls.filter((u) => u.includes('/api/storesearch')).length;
test('二次查询缓存命中（无新增搜索请求）', () => {
  expect(searchCallsAfter === searchCallsBefore).toEqual(true);
});
test('缓存命中好评率一致', () => {
  expect(cached2 && cached2.positiveRate).toEqual(90);
});

test('空名称返回 null', async () => {
  expect(await await getSteamPositiveRate('')).toEqual(null);
});
restoreFetch();

// ===== v10.5.2 回归：缓存命中零网络阻塞 + 名称自愈退避 =====
// 背景：applyCacheHit 此前同步 await 名称自愈（最多 2 次 Steam 请求），
// 列表页第一波 getSteamRatingsFromCacheOnly 的"零网络请求"契约被打破；
// Steam 不可达时每次缓存命中阻塞数秒并持续消耗 API 配额。
// Regression: applyCacheHit awaited name self-heal (up to 2 Steam calls),
// breaking the zero-network wave-1 contract; every cache hit blocked for
// seconds and burned quota while Steam was unreachable.
const healMod = await import(new URL('../../background/steam/api-registry-heal.js', import.meta.url).href);

// 1) 名称不健康（enName 为中文）的缓存条目 + 永久挂起的 fetch mock：
//    若缓存命中路径仍 await 自愈，下面的查询将无法在时限内返回
const hangEntry = {
  appId: '999001',
  name: '健康游戏',
  englishName: '健康游戏', // 无拉丁字母 → 触发自愈条件 / no Latin letters: heal trigger
  type: 'game',
  positiveRate: 88,
  ratingDesc: '特别好评',
  totalReviews: 500,
  recentPositiveRate: 84,
  recentTotalReviews: 50,
  lastUpdate: '2026-08-01'
};
await cacheMod.setSteamCacheEntry('999001', hangEntry);
await nameIdx.recordNameIndex('健康游戏', '999001');
const hangingFetch = async () => new Promise(() => {});
const restoreHanging = installFetchMock(hangingFetch);
const t0 = Date.now();
const hangHit = await getSteamRatingsFromCacheOnly('健康游戏');
const hangMs = Date.now() - t0;
test('缓存命中不被名称自愈阻塞（零网络契约，挂起 fetch 下瞬时返回）', () => {
  expect(hangHit && hangHit.positiveRate).toEqual(88);
  expect(hangMs < 1000).toEqual(true);
});
restoreHanging();

// 2) 自愈退避：官方名无改进（两语言均返回中文名）时，窗口内第二次
//    healRegistryNames 不再发起请求（防每次缓存命中空耗 2 次配额）
const healFetch = createFetchMock({
  '/api/appdetails': {
    999002: { success: true, data: { steam_appid: 999002, name: '某游戏', type: 'game' } }
  }
});
const restoreHeal = installFetchMock(healFetch);
const healCallCount = () => healFetch._calls.filter((u) => u.includes('/api/appdetails')).length;
await healMod.healRegistryNames('999002', { cnName: '某游戏', enName: '某游戏', gameName: '某游戏' });
const afterFirst = healCallCount();
await healMod.healRegistryNames('999002', { cnName: '某游戏', enName: '某游戏', gameName: '某游戏' });
test('自愈退避：首次尝试后窗口内不重复请求', () => {
  expect(afterFirst > 0).toEqual(true);
  expect(healCallCount() === afterFirst).toEqual(true);
});
restoreHeal();
