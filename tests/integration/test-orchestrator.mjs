import { test, expect, vi } from 'vitest';
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

// ============ v14.7 批次 4：负缓存分级退避（15min → 1h → 2h 封顶） ============
test('负缓存分级退避：首次 miss 仅 cap/8（15min），连续 miss 指数退避至 cap 封顶', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T00:00:00'));
  nameIdx.resetNameIndex();
  const T0 = Date.now();
  await nameIdx.recordNameIndex('分级游戏X', null); // miss ×1 → TTL cap/8 = 15min
  expect(await nameIdx.isRecentlySearchedNotFound('分级游戏X')).toEqual(true);
  vi.setSystemTime(new Date(T0 + 16 * 60e3)); // 16min > 15min → 可重试
  expect(await nameIdx.isRecentlySearchedNotFound('分级游戏X')).toEqual(false);
  await nameIdx.recordNameIndex('分级游戏X', null); // miss ×2 → TTL cap/2 = 1h
  vi.setSystemTime(new Date(T0 + 20 * 60e3)); // 距 2nd miss 仅 4min → 仍在负缓存
  expect(await nameIdx.isRecentlySearchedNotFound('分级游戏X')).toEqual(true);
  vi.setSystemTime(new Date(T0 + 61 * 60e3)); // 距 2nd miss 41min < 1h → 仍在
  expect(await nameIdx.isRecentlySearchedNotFound('分级游戏X')).toEqual(true);
  vi.setSystemTime(new Date(T0 + 80 * 60e3)); // 距 2nd miss 60min → 过期可重试
  expect(await nameIdx.isRecentlySearchedNotFound('分级游戏X')).toEqual(false);
  await nameIdx.recordNameIndex('分级游戏X', null); // miss ×3 → TTL cap = 2h
  vi.setSystemTime(new Date(T0 + 100 * 60e3)); // 距 3rd miss 20min → 仍在
  expect(await nameIdx.isRecentlySearchedNotFound('分级游戏X')).toEqual(true);
  // 正缓存写入清零退避计数 / A positive hit resets the backoff count.
  await nameIdx.recordNameIndex('分级游戏X', '12345');
  expect(await nameIdx.lookupAppIdByName('分级游戏X')).toEqual('12345');
  vi.useRealTimers();
  nameIdx.resetNameIndex();
});

// ===== v14.28.9 L4：运行期诊断轨迹录制证明（真实管线 + 全网络失败） =====
// 真实驱动 getSteamPositiveRate（fetch 全部 reject），从真实事件流中读 fail/
// 卡点判定。夹具 tests/fixtures/diag-trace-network.json 由本用例一次录制后
// 落盘；测试本身只读夹具做回放（不写夹具）。
// Recording proof: drive the real pipeline with every fetch rejecting, then
// assert the produced trace exposes fail(network) and the stuck stage. The
// fixture was recorded once from this case; the test only reads it back.
const diagMod = await import(new URL('../../background/storage/diag-trace.js', import.meta.url).href);
const traceBaseline = (await diagMod.getTrace()).events.length;
const networkFailFetch = async (url) => {
  networkFailFetch._calls.push(String(url));
  throw new Error('network down');
};
networkFailFetch._calls = [];
const restoreNetworkFail = installFetchMock(networkFailFetch);
const failedResult = await getSteamPositiveRate('断网诊断样本', { ignoreNegativeCache: true });
restoreNetworkFail();
await diagMod.flushDiagTrace();
const recorded = (await diagMod.getTrace()).events.slice(traceBaseline);

test('全网络失败：轨迹含 fail(network)，classifyTrace 指出卡在 search', () => {
  expect(failedResult && failedResult.failed).toEqual(true);
  expect(failedResult && failedResult.errorType).toEqual('network');
  const networkFails = recorded.filter((e) => e.event === 'fail' && e.failKind === 'network');
  expect(networkFails.length > 0).toEqual(true);
  const verdict = diagMod.classifyTrace(recorded);
  expect(verdict.verdict).toEqual('network');
  expect(verdict.stuckStage).toEqual('search');
  expect(verdict.lastFailKind).toEqual('network');
});

// ===== v14.28.10 P1-1：首波 miss 分桶落证据档案（热载 1/4 未命中定位） =====
// 置于文件末尾：上方用例的顶层流程会预写缓存/索引（999001=健康游戏 88 分等），
// 本组用例用独立 appId/名称隔离；usage-evidence 记录为 fire-and-forget
//（applyChain 队列），断言前必须 flushUsageEvidence 排空——v14.25.0 同源教训。
const evMod = await import(new URL('../../background/storage/usage-evidence.js', import.meta.url).href);
test('P1-1：无索引 miss 分桶落证据档案', async () => {
  evMod.resetUsageEvidence();
  expect(await getSteamRatingsFromCacheOnly('P1无索引占位名甲')).toEqual(null);
  await evMod.flushUsageEvidence();
  const mem = evMod.getUsageEvidenceMemory();
  expect(mem.counters['match.wave1Miss']).toEqual(1);
  expect(mem.events.some((e) => e.k === 'wave1Miss' && e.kind === 'no-index-entry')).toEqual(true);
});
test('P1-1：残缺缓存 miss 分桶（cache-* 类）', async () => {
  evMod.resetUsageEvidence();
  await cacheMod.setSteamCacheEntry('999003', { appId: '999003', name: 'P1残缺占位名乙', type: 'game' });
  await nameIdx.recordNameIndex('P1残缺占位名乙', '999003');
  expect(await getSteamRatingsFromCacheOnly('P1残缺占位名乙')).toEqual(null);
  await evMod.flushUsageEvidence();
  const mem = evMod.getUsageEvidenceMemory();
  // reset 仅清内存，后端旧值会被重载读回（v14.25.0 教训）——断言非零而非精确值
  expect(mem.counters['match.wave1Miss'] || 0).toBeGreaterThan(0);
  const kind = (mem.events.find((e) => e.k === 'wave1Miss' && String(e.kind).startsWith('cache-')) || {}).kind || '';
  expect(kind.startsWith('cache-')).toEqual(true);
});

// ===== v14.29.0：同站 appId 冲突防线（逻辑不变式：同站两页至多一侧同游戏） =====
// 用户实证：xianyudanji.gg/107968.html 与 /107966.html 是两篇不同游戏帖，
// 标题检索把两页匹配到同一 appId = 至少一侧错配。防线：冲突命中 → 结果强制
// 「推测」+ matchConflict 标记 + 不写名称索引/注册表变体（防错误一侧固化；
// 跳写以证据档案 match.hostConflict 计数佐证）；会话声明表补足持久索引尚未
// 落盘的同批场景。密封性：前序用例留下熔断/名称索引污染——本节显式重置
// api-monitor 并预写名称索引（usableAppId 直取路径，零搜索/零出站依赖）。
const urlIdx = await import(new URL('../../background/storage/url-index.js', import.meta.url).href);
const conflictsMod = await import(new URL('../../background/steam/match-conflicts.js', import.meta.url).href);
const apiMon = await import(new URL('../../background/core/api-monitor.js', import.meta.url).href);

test('v14.29.0：同站另一页已绑定同一 appId → 降级推测 + 拦截计数', async () => {
  apiMon.resetApiMonitor();
  await urlIdx.resetUrlIndex();
  conflictsMod.resetMatchConflictsForTest();
  evMod.resetUsageEvidence();
  await nameIdx.recordNameIndex('艾尔登法环', '1245620'); // 显式预写（防前序污染）
  // 预置：107968 页已绑定 1245620（先前的匹配写入，标题哈希不同）
  await urlIdx.setUrlAppIdArbitrated('https://www.xianyudanji.gg/107968.html', 1245620, {
    confidence: 'confirmed',
    titleHash: 'aaaaaa'
  });
  const r = await getSteamPositiveRate('艾尔登法环', {
    pageUrl: 'https://www.xianyudanji.gg/107966.html',
    ignoreNegativeCache: true
  });
  expect(String(r && r.appId)).toEqual('1245620');
  expect(r && r.matchConflict).toEqual(true);
  expect(r && r.matchConfidence).toEqual('suspected');
  await evMod.flushUsageEvidence();
  const mem = evMod.getUsageEvidenceMemory();
  expect(mem.counters['match.hostConflict'] || 0).toBeGreaterThan(0);
  expect(mem.events.some((e) => e.k === 'hostConflict' && e.kind === 'url-index')).toEqual(true);
});

test('v14.29.0：无冲突页面同链路 → 照常出结果（无冲突标记）', async () => {
  apiMon.resetApiMonitor();
  await urlIdx.resetUrlIndex();
  conflictsMod.resetMatchConflictsForTest();
  evMod.resetUsageEvidence();
  await nameIdx.recordNameIndex('艾尔登法环', '1245620');
  const r = await getSteamPositiveRate('艾尔登法环', {
    pageUrl: 'https://www.xianyudanji.gg/107970.html',
    ignoreNegativeCache: true
  });
  expect(String(r && r.appId)).toEqual('1245620');
  expect(r && r.matchConflict).toEqual(undefined);
});

test('v14.29.0：同批次会话级冲突（持久索引尚未落盘也能拦）', async () => {
  apiMon.resetApiMonitor();
  await urlIdx.resetUrlIndex();
  conflictsMod.resetMatchConflictsForTest();
  evMod.resetUsageEvidence();
  await nameIdx.recordNameIndex('艾尔登法环', '1245620');
  // 同名异名双预写（第二个标题走精确键，零搜索依赖）
  await nameIdx.recordNameIndex('艾尔登法环 官方中文版', '1245620');
  const first = await getSteamPositiveRate('艾尔登法环', {
    pageUrl: 'https://www.xianyudanji.gg/107980.html',
    ignoreNegativeCache: true
  });
  expect(first && first.matchConflict).toEqual(undefined); // 首个命中方正常
  // 同批另一页（不同标题 → 哈希不同，不触发同标题转载豁免）命中同一 appId
  const second = await getSteamPositiveRate('艾尔登法环 官方中文版', {
    pageUrl: 'https://www.xianyudanji.gg/107981.html',
    ignoreNegativeCache: true
  });
  expect(second && second.matchConflict).toEqual(true);
  expect(second && second.matchConfidence).toEqual('suspected');
  await evMod.flushUsageEvidence();
  const mem = evMod.getUsageEvidenceMemory();
  expect(mem.events.some((e) => e.k === 'hostConflict' && e.kind === 'session')).toEqual(true);
  conflictsMod.resetMatchConflictsForTest();
});
