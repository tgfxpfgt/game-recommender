/**
 * Game Recommender - 测试：Steam 编排器集成 / Orchestrator Integration Tests
 *
 * v4.2.0：两波好评率流程的真实后台逻辑（此前 content-sim 用 presets mock
 * 整个后台，orchestrator 零覆盖）。mock fetch（Steam API）+ storage mock
 * 驱动 getSteamRatingsFromCacheOnly（缓存命中/过期）与 getSteamPositiveRate
 * （缓存优先 → 搜索 → 写缓存链路）。
 */
'use strict';

import { createReporter } from '../helpers/assert.mjs';
const reporter = createReporter();
const { check } = reporter;
import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';
import { createFetchMock, installFetchMock } from '../helpers/fetch-mock.mjs';

const storage = createStorageMock();
installChromeStorageMock(storage);

// 注意：cache/name-index 必须不带 ?t= 导入——orchestrator 以静态 import 引用
// 它们（无参数 URL），带 ?t= 会生成独立实例，写入的状态互不可见
// （与 test-outbound 的 outbound-audit 教训相同）。
const orchMod = await import(new URL('../../background/steam/orchestrator.js', import.meta.url).href + '?t=' + Date.now());
const cacheMod = await import(new URL('../../background/storage/steam-cache.js', import.meta.url).href);
const { getSteamRatingsFromCacheOnly, getSteamPositiveRate } = orchMod;

console.log('1. 缓存只读查询（getSteamRatingsFromCacheOnly）');
check('空名称返回 null', await getSteamRatingsFromCacheOnly(''), null);
check('无索引无缓存返回 null', await getSteamRatingsFromCacheOnly('不存在的游戏'), null);

// 预置缓存：名称索引 + rating 模块（用真实 setSteamCacheEntry 写入）
await cacheMod.loadSteamCacheToMemory();
await cacheMod.setSteamCacheEntry('275850', {
  appId: '275850', name: '无人深空', type: 'game',
  positiveRate: 85, ratingDesc: '特别好评', totalReviews: 1000,
  recentPositiveRate: 80, recentTotalReviews: 100, lastUpdate: '2026-08-01'
});
await cacheMod.flushSteamCache();
// 名称索引：写入 名称→appId（同样不带 ?t=，共享实例）
const nameIdx = await import(new URL('../../background/storage/name-index.js', import.meta.url).href);
await nameIdx.recordNameIndex('无人深空', '275850');
await nameIdx.flushNameIndex();

const cached = await getSteamRatingsFromCacheOnly('无人深空');
check('缓存命中返回好评率', cached && cached.positiveRate, 85);
check('缓存命中携带 appId', cached && cached.appId, '275850');
check('缓存命中携带近30天', cached && cached.recentPositiveRate, 80);

console.log('2. 全流程拉取（getSteamPositiveRate：缓存优先 → 搜索 → 写缓存）');
// 新游戏：无缓存 → mock Steam 搜索与详情 → 返回并写缓存
const fetchMock = createFetchMock({
  '/api/storesearch': { items: [{ id: 1245620, name: '艾尔登法环', type: 'app' }] },
  '/api/appdetails': {
    '1245620': {
      success: true,
      data: {
        steam_appid: 1245620, name: '艾尔登法环', type: 'game',
        genres: [{ id: 1, description: 'RPG' }],
        supported_languages: { schinese: { full_audio: true, subtitles: true } }
      }
    }
  },
  '/appreviews': { success: 1, query_summary: { total_reviews: 1000, total_positive: 900, total_negative: 100, review_score: 9, review_score_desc: '特别好评' }, reviews: [] },
  '/api/ISteamNews': { appnews: { newsitems: [{ date: 1754900000 }] } }
});
const restoreFetch = installFetchMock(fetchMock);

const result = await getSteamPositiveRate('艾尔登法环', { ignoreNegativeCache: true });
check('搜索+详情链路返回 appId', result && String(result.appId), '1245620');
check('好评率计算正确（900/1000）', result && result.positiveRate, 90);
// 写缓存后：二次查询应缓存命中（不再发起 storesearch 搜索）
const searchCallsBefore = fetchMock._calls.filter(u => u.includes('/api/storesearch')).length;
const cached2 = await getSteamPositiveRate('艾尔登法环', { ignoreNegativeCache: true });
const searchCallsAfter = fetchMock._calls.filter(u => u.includes('/api/storesearch')).length;
check('二次查询缓存命中（无新增搜索请求）', searchCallsAfter === searchCallsBefore, true);
check('缓存命中好评率一致', cached2 && cached2.positiveRate, 90);

console.log('3. 边界');
check('空名称返回 null', await getSteamPositiveRate(''), null);
restoreFetch();

console.log('\n===== 编排器集成测试结果 =====');
const finalResult = reporter.getResult();
console.log(finalResult.pass + ' 通过, ' + finalResult.fail + ' 失败');
export const testResult = reporter.getResult();
