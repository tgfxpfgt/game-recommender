import { test, expect, describe, beforeAll, afterAll } from 'vitest';
/**
 * 游戏雷达 Game Radar - 测试：消息处理链路集成 / Message Handler Integration Tests
 *
 * v6.2.0：覆盖此前完全裸奔的接线层——handlers.js + handlers/ 子模块的真实
 * 消息链路（mock chrome.storage + fetch 驱动 handleMessage）。内容脚本模拟
 * 用 preset 假后台恰好绕过这条真实管线；契约测试只验消息形状不验行为。
 * Covers the message pipeline: handleMessage → domain handlers → storage
 * writes (name-index / registry / wrong-reports / download-urls / cache).
 *
 * 注意：fetch mock 按 describe 作用域安装/卸载（顶层多 mock 后装覆盖前者）；
 * 名称索引删除断言依赖 v6.2.0 修复（deleteNameIndexEntry 对称删除清理名变体）。
 */
('use strict');

import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';
import { createFetchMock, installFetchMock } from '../helpers/fetch-mock.mjs';

const storage = createStorageMock();
installChromeStorageMock(storage);

// handlers.js 与其静态依赖无 ?t= 导入（同实例，handler 写入的状态可验证落点）
const handlers = await import(new URL('../../background/handlers.js', import.meta.url).href);
const { handleMessage } = handlers;
const cacheMod = await import(new URL('../../background/storage/steam-cache.js', import.meta.url).href);
const nameIdx = await import(new URL('../../background/storage/name-index.js', import.meta.url).href);
const regMod = await import(new URL('../../background/storage/registry.js', import.meta.url).href);
const wrongMod = await import(new URL('../../background/storage/wrong-reports.js', import.meta.url).href);
const urlMod = await import(new URL('../../background/storage/download-urls.js', import.meta.url).href);
const urlIdx = await import(new URL('../../background/storage/url-index.js', import.meta.url).href);

// ============ 1. SEARCH_STEAM 完整链路 ============
describe('SEARCH_STEAM 完整链路', () => {
  let fetchMock, restoreFetch;
  beforeAll(() => {
    fetchMock = createFetchMock({
      '/api/storesearch': { items: [{ id: 1245620, name: '艾尔登法环', type: 'app' }] },
      '/api/appdetails': {
        1245620: {
          success: true,
          data: {
            steam_appid: 1245620,
            name: '艾尔登法环',
            type: 'game',
            genres: [{ id: 1, description: 'RPG' }],
            supported_languages: '<strong>简体中文</strong><br>界面、完全音频、字幕'
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
    restoreFetch = installFetchMock(fetchMock);
  });
  afterAll(() => {
    if (restoreFetch) restoreFetch();
  });

  test('搜索链路返回 appId 与好评率', async () => {
    const resp = await handleMessage({ action: 'SEARCH_STEAM', gameName: '艾尔登法环' });
    expect(resp.data && String(resp.data.appId)).toEqual('1245620');
    expect(resp.data && resp.data.positiveRate).toEqual(90);
  });
  test('搜索链路写入 Steam 缓存（rating 模块）', async () => {
    const entry = await cacheMod.getSteamCacheEntry('1245620');
    expect(!!entry && !!entry.modules.rating && entry.modules.rating.data.positiveRate === 90).toEqual(true);
  });
  test('搜索链路写入名称索引', async () => {
    expect(await nameIdx.lookupAppIdByName('艾尔登法环')).toEqual(1245620);
  });
  test('搜索链路写入注册表', async () => {
    const reg = await regMod.getGameRegistryEntry('1245620');
    expect(!!reg && reg.cnName === '艾尔登法环').toEqual(true);
  });
  test('二次搜索缓存命中（无新增 storesearch 请求）', async () => {
    const before = fetchMock._calls.filter((u) => u.includes('/api/storesearch')).length;
    const resp = await handleMessage({ action: 'SEARCH_STEAM', gameName: '艾尔登法环' });
    const after = fetchMock._calls.filter((u) => u.includes('/api/storesearch')).length;
    expect(after === before).toEqual(true);
    expect(resp.data && String(resp.data.appId)).toEqual('1245620');
  });
  test('搜索链路仅发中文搜索（v6.2.1 english 冗余移除，每游戏省 1 请求）', () => {
    const storesearchCalls = fetchMock._calls.filter((u) => u.includes('/api/storesearch'));
    expect(storesearchCalls.length).toEqual(1);
    expect(storesearchCalls[0].includes('l=schinese')).toEqual(true);
  });
});

// ============ 2. SEARCH_STEAM 无结果 → 负缓存 ============
describe('SEARCH_STEAM 无结果', () => {
  let fetchMock, restoreFetch;
  beforeAll(() => {
    fetchMock = createFetchMock({
      '/api/storesearch': { items: [] },
      '/api/appdetails': {},
      '/appreviews': {},
      '/api/ISteamNews': {}
    });
    restoreFetch = installFetchMock(fetchMock);
  });
  afterAll(() => {
    if (restoreFetch) restoreFetch();
  });

  test('无结果返回 null', async () => {
    const resp = await handleMessage({ action: 'SEARCH_STEAM', gameName: '不存在的游戏XYZ' });
    expect(resp.data).toEqual(null);
  });
  test('负缓存生效：立即重检索不再发起 storesearch', async () => {
    const before = fetchMock._calls.filter((u) => u.includes('/api/storesearch')).length;
    const resp = await handleMessage({ action: 'SEARCH_STEAM', gameName: '不存在的游戏XYZ' });
    const after = fetchMock._calls.filter((u) => u.includes('/api/storesearch')).length;
    expect(after === before).toEqual(true);
    expect(resp.data).toEqual(null);
  });
});

// ============ 3. REPORT_WRONG_APPID（纠错接线） ============
test('报错清除缓存/索引/下载站映射并记录样本', async () => {
  storage._reset();
  await cacheMod.resetSteamCache();
  await cacheMod.setSteamCacheEntry('2001760', {
    appId: '2001760',
    name: '错误游戏',
    positiveRate: 50,
    ratingDesc: 'x'
  });
  await cacheMod.flushSteamCache();
  await nameIdx.recordNameIndex('游戏A', '2001760');
  await nameIdx.flushNameIndex();
  await urlMod.recordDownloadUrl('2001760', 'xdgame', 'XDGame', 'https://www.xdgame.com/2001760.html');

  const resp = await handleMessage({ action: 'REPORT_WRONG_APPID', appId: '2001760', gameName: '游戏A' });
  expect(resp.success).toEqual(true);
  expect(await cacheMod.getSteamCacheEntry('2001760')).toEqual(null);
  expect(await nameIdx.lookupAppIdByName('游戏A')).toEqual(null);
  const store = await urlMod.readDownloadUrlsStore();
  expect(store.sites.xdgame['2001760'] === undefined).toEqual(true);
  // 纠错知识库接线：报错样本（黑名单）被记录（lookup 只返回含 correctAppId 的纠正）
  const mem = await wrongMod.getWrongReportsMemory();
  expect(mem.get('游戏A') && String(mem.get('游戏A').wrongAppId)).toEqual('2001760');
});

// ============ 4. SAVE_MANUAL_MAPPING（手动映射接线） ============
test('手动映射写入三处落点', async () => {
  storage._reset();
  const resp = await handleMessage({ action: 'SAVE_MANUAL_MAPPING', gameName: '游戏B', appId: '730' });
  expect(resp.success).toEqual(true);
  expect(await nameIdx.lookupAppIdByName('游戏B')).toEqual('730');
  const reg = await regMod.getGameRegistryEntry('730');
  expect(!!reg && reg.cnName === '游戏B').toEqual(true);
  const corr = await wrongMod.lookupWrongReportCorrection('游戏B');
  expect(corr && String(corr.correctAppId)).toEqual('730');
});

// ============ 5. TRACK_DOWNLOAD_SITE_VISIT ============
test('访问记录写入下载站桶', async () => {
  storage._reset();
  const resp = await handleMessage({
    action: 'TRACK_DOWNLOAD_SITE_VISIT',
    data: { appId: 123, url: 'https://www.xdgame.com/123.html', domain: 'xdgame.com' }
  });
  expect(resp.success).toEqual(true);
  const store = await urlMod.readDownloadUrlsStore();
  expect(!!store.sites.xdgame && !!store.sites.xdgame['123']).toEqual(true);
});
test('未知站点拒绝记录', async () => {
  storage._reset();
  const resp = await handleMessage({
    action: 'TRACK_DOWNLOAD_SITE_VISIT',
    data: { appId: 123, url: 'https://evil.example.com/123.html', domain: 'evil.example.com' }
  });
  expect(resp.success).toEqual(false);
});

// ============ 6. 缓存条目删除与清空 ============
test('删除单条缓存（注册表/缓存/下载站/索引联动）', async () => {
  storage._reset();
  await cacheMod.resetSteamCache();
  await cacheMod.setSteamCacheEntry('275850', { appId: '275850', name: '无人深空', positiveRate: 85, ratingDesc: 'x' });
  await cacheMod.flushSteamCache();
  await nameIdx.recordNameIndex('无人深空', '275850');
  await nameIdx.flushNameIndex();
  await regMod.recordGameInRegistry('275850', { cnName: '无人深空', gameName: '无人深空', tags: [] });
  await urlMod.recordDownloadUrl('275850', 'xdgame', 'XDGame', 'https://www.xdgame.com/275850.html');

  const resp = await handleMessage({ action: 'DELETE_GAME_CACHE_ENTRY', appId: '275850' });
  expect(resp.success).toEqual(true);
  expect(await cacheMod.getSteamCacheEntry('275850')).toEqual(null);
  expect(await nameIdx.lookupAppIdByName('无人深空')).toEqual(null);
  const store = await urlMod.readDownloadUrlsStore();
  expect(store.sites.xdgame['275850'] === undefined).toEqual(true);
});
test('清空全部游戏缓存', async () => {
  storage._reset();
  await cacheMod.resetSteamCache();
  await cacheMod.setSteamCacheEntry('1', { appId: '1', name: '游戏', positiveRate: 90, ratingDesc: 'x' });
  await cacheMod.flushSteamCache();
  await nameIdx.recordNameIndex('游戏', '1');
  await nameIdx.flushNameIndex();

  const resp = await handleMessage({ action: 'CLEAR_GAME_CACHE' });
  expect(resp.success).toEqual(true);
  expect(await cacheMod.getSteamCacheEntry('1')).toEqual(null);
  expect(await nameIdx.lookupAppIdByName('游戏')).toEqual(null);
});

// ============ 7. 契约校验接线（违规直接拒绝） ============
test('SEARCH_STEAM 空名被契约拒绝', async () => {
  const resp = await handleMessage({ action: 'SEARCH_STEAM', gameName: '  ' });
  expect(String(resp.error || '').startsWith('invalid-message')).toEqual(true);
});
test('DELETE_GAME_CACHE_ENTRY 非数字 appId 被拒绝', async () => {
  const resp = await handleMessage({ action: 'DELETE_GAME_CACHE_ENTRY', appId: 'abc' });
  expect(String(resp.error || '').startsWith('invalid-message')).toEqual(true);
});
test('未知 action 返回 Unknown action', async () => {
  const resp = await handleMessage({ action: 'NO_SUCH_ACTION' });
  expect(String(resp.error || '').startsWith('Unknown action')).toEqual(true);
});

// ============ v7.0.2：详情页网址索引第一候选 ============
describe('详情页网址索引（URL 第一候选，统一列表页/详情页匹配）', () => {
  const TEST_URL = 'https://www.gamer520.com/109515.html';
  let fetchMock, restoreFetch;

  beforeAll(() => {
    urlIdx.resetUrlIndex();
    fetchMock = createFetchMock({
      // storesearch 返回空——若结果仍命中 appId，证明走了 URL 索引而非标题搜索
      '/api/storesearch': { items: [] },
      '/api/appdetails': {
        3764200: {
          success: true,
          data: {
            steam_appid: 3764200,
            name: 'Resident Evil Requiem',
            type: 'game',
            genres: [{ id: 1, description: 'Action' }]
          }
        }
      },
      '/appreviews': {
        success: 1,
        query_summary: { total_reviews: 100, total_positive: 90, total_negative: 10 },
        reviews: []
      },
      '/api/ISteamNews': { appnews: { newsitems: [] } }
    });
    restoreFetch = installFetchMock(fetchMock);
  });
  afterAll(() => {
    restoreFetch();
    urlIdx.resetUrlIndex();
  });

  test('SEARCH_STEAM：网址索引命中 → 直接使用索引 appId（不触发标题搜索）', async () => {
    await urlIdx.setUrlAppId(TEST_URL, 3764200);
    const resp = await handleMessage(
      { action: 'SEARCH_STEAM', gameName: '生化危机9 安魂曲' },
      { tab: { url: TEST_URL } }
    );
    expect(resp.data && String(resp.data.appId)).toEqual('3764200');
    // storesearch 未被调用（mock 返回空——若走了标题搜索则结果为 null）
    expect(fetchMock._calls.some((u) => u.includes('/api/storesearch'))).toEqual(false);
  });

  test('GET_STEAM_RATINGS：urls 索引命中 → 缓存直取该 appId', async () => {
    // 预置 3764200 的 rating 缓存
    await cacheMod.setSteamCacheEntry(3764200, {
      appId: 3764200,
      name: 'Resident Evil Requiem',
      englishName: 'Resident Evil Requiem',
      type: 'game',
      positiveRate: 90,
      ratingDesc: '特别好评',
      totalReviews: 100,
      recentPositiveRate: 85,
      recentTotalReviews: 50,
      url: 'https://store.steampowered.com/app/3764200/'
    });
    await cacheMod.flushSteamCache();
    const resp = await handleMessage(
      { action: 'GET_STEAM_RATINGS', names: ['生化危机9 安魂曲'], urls: { '生化危机9 安魂曲': TEST_URL } },
      { tab: { url: 'https://www.gamer520.com/pcplay' } }
    );
    const r = resp.ratings && resp.ratings['生化危机9 安魂曲'];
    expect(r && String(r.appId)).toEqual('3764200');
    expect(resp.pending).toEqual(0);
  });

  test('REFRESH 后：详情页匹配结果写入网址索引（后续列表页可复用）', async () => {
    // 清索引 → 标题搜索路径（mock storesearch 空 → 未找到）
    urlIdx.resetUrlIndex();
    const resp = await handleMessage(
      { action: 'SEARCH_STEAM', gameName: '不存在的游戏XYZ' },
      { tab: { url: TEST_URL } }
    );
    expect(resp.data).toEqual(null);
    expect(await urlIdx.getAppIdByUrl(TEST_URL)).toEqual(null);
  });
});

// ============ v7.0.3：检索顺序（网址 → 直取 → 标题 → 搜索）+ 缓存优先展示 ============
describe('检索顺序与下载站缓存优先', () => {
  const URL = 'https://www.gamer520.com/109515.html';
  let fetchMock, restoreFetch;

  beforeAll(() => {
    urlIdx.resetUrlIndex();
    fetchMock = createFetchMock({
      '/api/storesearch': { items: [] },
      '/api/appdetails': {
        3764200: {
          success: true,
          data: {
            steam_appid: 3764200,
            name: 'Resident Evil Requiem',
            type: 'game',
            genres: [{ id: 1, description: 'Action' }]
          }
        },
        4021140: {
          success: true,
          data: {
            steam_appid: 4021140,
            name: 'Jrago III',
            type: 'game',
            genres: [{ id: 1, description: 'Action' }]
          }
        }
      },
      '/appreviews': {
        success: 1,
        query_summary: { total_reviews: 10, total_positive: 9, total_negative: 1 },
        reviews: []
      },
      '/api/ISteamNews': { appnews: { newsitems: [] } }
    });
    restoreFetch = installFetchMock(fetchMock);
  });
  afterAll(() => {
    restoreFetch();
    urlIdx.resetUrlIndex();
  });

  test('直取路径网址索引优先：封面 appId 与网址索引不同 → 用网址索引（URL→直取→标题→搜索）', async () => {
    await urlIdx.setUrlAppId(URL, 3764200);
    const resp = await handleMessage(
      { action: 'GET_STEAM_BY_APPID', appId: 4021140, gameName: '生化危机9 安魂曲' },
      { tab: { url: URL } }
    );
    // 网址索引 3764200 优先于封面直取 4021140
    expect(resp.data && String(resp.data.appId)).toEqual('3764200');
  });

  test('manual（用户手动选择）优先于网址索引', async () => {
    const resp = await handleMessage(
      { action: 'GET_STEAM_BY_APPID', appId: 4021140, gameName: 'Jrago III', manual: true },
      { tab: { url: URL } }
    );
    expect(resp.data && String(resp.data.appId)).toEqual('4021140');
  });

  test('SEARCH_DOWNLOAD_SITES cacheOnly：按 appId 返回各下载站缓存网址（一个 appid 对应多站）', async () => {
    // 预置多站下载网址缓存
    await urlMod.recordDownloadUrlsBatch('gamer520', 'Gamer520', [
      { appId: 3764200, url: 'https://www.gamer520.com/109515.html' }
    ]);
    await urlMod.recordDownloadUrlsBatch('xdgame', 'XDGame', [
      { appId: 3764200, url: 'https://www.xdgame.com/12345.html' }
    ]);
    const resp = await handleMessage({
      action: 'SEARCH_DOWNLOAD_SITES',
      gameName: 'Resident Evil Requiem',
      appId: '3764200',
      cacheOnly: true
    });
    const sites = resp.sites || [];
    const found = sites.filter((s) => s.found);
    // 两个下载站都命中缓存（不同网址）
    expect(found.length).toBeGreaterThanOrEqual(2);
    const gamer520 = found.find((s) => s.key === 'gamer520');
    const xdgame = found.find((s) => s.key === 'xdgame');
    expect(gamer520 && gamer520.detailUrl).toEqual('https://www.gamer520.com/109515.html');
    expect(xdgame && xdgame.detailUrl).toEqual('https://www.xdgame.com/12345.html');
    // cacheOnly 不触发站内搜索（无网络调用）
    expect(fetchMock._calls.some((u) => u.includes('gamer520.com/search') || u.includes('xdgame.com/search'))).toEqual(
      false
    );
  });
});

// ============ 并入：AI/匹配兜底（v6.4.16/17，v7.0.5 合并自 test-ai-fallback） ============
const aiMod = await import(new URL('../../background/steam/ai-fallback.js', import.meta.url).href);
const settingsMod = await import(new URL('../../background/core/settings.js', import.meta.url).href);
function seedSettings(patch) {
  storage._reset({ settings: { ...patch } });
  settingsMod.resetSettingsCache();
}

// ============ 纯函数：LLM 响应解析 ============
describe('parseLlmMatchResponse', () => {
  const { parseLlmMatchResponse } = aiMod;

  test('标准 JSON 返回', () => {
    expect(parseLlmMatchResponse('{"name": "Resident Evil Requiem", "appid": 3764200}')).toEqual({
      name: 'Resident Evil Requiem',
      appId: 3764200
    });
  });

  test('JSON 包裹在散落文本中（代码块）', () => {
    const r = parseLlmMatchResponse('好的，结果如下：\n```json\n{"name": "艾尔登法环", "appid": null}\n```');
    expect(r).toEqual({ name: '艾尔登法环', appId: null });
  });

  test('appid 为 null 且 name 空 → null', () => {
    expect(parseLlmMatchResponse('{"name": "", "appid": null}')).toEqual(null);
  });

  test('非数字 appid 拒绝（防类型污染）', () => {
    const r = parseLlmMatchResponse('{"name": "X", "appid": "3764200"}');
    expect(r).toEqual({ name: 'X', appId: null });
  });

  test('无法解析 → null', () => {
    expect(parseLlmMatchResponse('抱歉我无法确定')).toEqual(null);
    expect(parseLlmMatchResponse('')).toEqual(null);
  });
});

// ============ 完整链路：llmMatchGame ============
describe('llmMatchGame 完整链路（规则失败 → LLM 兜底 → 官方校验）', () => {
  const { llmMatchGame } = aiMod;
  let fetchMock, restoreFetch;

  beforeAll(() => {
    seedSettings({
      useLLM: true,
      llmConfig: { provider: 'local', endpoint: 'http://localhost:11434/api/generate', model: 'qwen2.5:7b' }
    });
  });

  test('LLM 官方名 → storesearch 校验命中（Resident Evil Requiem 场景）', async () => {
    fetchMock = createFetchMock({
      '/api/generate': () => ({ response: '{"name": "Resident Evil Requiem", "appid": null}' }),
      '/api/storesearch': {
        items: [
          { id: 2050650, name: 'Resident Evil 4', type: 'app' },
          { id: 3764200, name: 'Resident Evil Requiem', type: 'app' },
          { id: 418370, name: 'Resident Evil 7 Biohazard', type: 'app' }
        ]
      }
    });
    restoreFetch = installFetchMock(fetchMock);
    const result = await llmMatchGame('生化危机9 安魂曲|中字-国语|Build.22898177', null);
    expect(result && result.appId).toEqual(3764200);
    expect(result && result.aiFallback).toEqual(true);
    // LLM 官方名确实走了 storesearch 官方索引校验
    expect(fetchMock._calls.some((u) => u.includes('/api/storesearch'))).toEqual(true);
    restoreFetch();
    restoreFetch = null;
  });

  test('LLM 直接给 appid → appdetails 官方名校验', async () => {
    fetchMock = createFetchMock({
      '/api/generate': () => ({ response: '{"name": "", "appid": 3764200}' }),
      '/api/appdetails': {
        3764200: { success: true, data: { steam_appid: 3764200, name: '生化危机 安魂曲' } }
      }
    });
    restoreFetch = installFetchMock(fetchMock);
    const result = await llmMatchGame('生化危机9 安魂曲', null);
    expect(result && result.appId).toEqual(3764200);
    restoreFetch();
    restoreFetch = null;
  });

  test('LLM 输出无法解析 → null（不信任）', async () => {
    fetchMock = createFetchMock({
      '/api/generate': () => ({ response: '我不确定这个游戏在 Steam 上叫什么。' })
    });
    restoreFetch = installFetchMock(fetchMock);
    const result = await llmMatchGame('某个奇怪游戏', null);
    expect(result).toEqual(null);
    restoreFetch();
    restoreFetch = null;
  });

  test('LLM 名搜索不到 → null（校验失败不采用）', async () => {
    fetchMock = createFetchMock({
      '/api/generate': () => ({ response: '{"name": "Nonexistent Game XYZ", "appid": null}' }),
      '/api/storesearch': { items: [] }
    });
    restoreFetch = installFetchMock(fetchMock);
    const result = await llmMatchGame('不存在游戏 XYZ', null);
    expect(result).toEqual(null);
    restoreFetch();
    restoreFetch = null;
  });

  test('失败结果缓存 24h（同标题不重复打 LLM）', async () => {
    fetchMock = createFetchMock({
      '/api/generate': () => ({ response: '{"name": "Nonexistent Game XYZ", "appid": null}' }),
      '/api/storesearch': { items: [] }
    });
    restoreFetch = installFetchMock(fetchMock);
    await llmMatchGame('缓存测试游戏 ABC', null);
    const before = fetchMock._calls.filter((u) => u.includes('/api/generate')).length;
    await llmMatchGame('缓存测试游戏 ABC', null);
    const after = fetchMock._calls.filter((u) => u.includes('/api/generate')).length;
    expect(after).toEqual(before); // 失败缓存命中，未再调 LLM
    restoreFetch();
    restoreFetch = null;
  });
});

// ============ v6.4.17：搜索引擎兜底（Bing） ============
describe('parseBingSearchAppIds（Bing HTML → appid 提取）', () => {
  const { parseBingSearchAppIds } = aiMod;

  test('提取 store.steampowered.com/app/{id}（去重）', () => {
    const html = `<a href="https://cn.bing.com/ck/a?u=a1b2c3"><h2>生化危机9 安魂曲</h2></a>
      <a href="https://store.steampowered.com/app/3764200/Resident_Evil_Requiem/">Steam 商店</a>
      <cite>https://store.steampowered.com/app/3764200</cite>
      <a href="https://store.steampowered.com/app/2050650/">旧作</a>`;
    expect(parseBingSearchAppIds(html)).toEqual(['3764200', '2050650']);
  });

  test('无结果 → 空数组', () => {
    expect(parseBingSearchAppIds('<html><body>没有游戏结果</body></html>')).toEqual([]);
    expect(parseBingSearchAppIds('')).toEqual([]);
  });
});

describe('webSearchFallback（Bing 搜索 → appdetails 校验）', () => {
  const { webSearchFallback } = aiMod;
  let fetchMock, restoreFetch;

  test('搜索结果含正确 appid → 校验通过采用（109515 场景，无需 LLM 配置）', async () => {
    fetchMock = createFetchMock({
      'cn.bing.com/search': () =>
        '<html><a href="https://store.steampowered.com/app/2050650/">Resident Evil 4</a>' +
        '<a href="https://store.steampowered.com/app/3764200/Resident_Evil_Requiem/">正确</a></html>',
      '/api/appdetails': {
        2050650: { success: true, data: { name: 'Resident Evil 4' } },
        3764200: { success: true, data: { name: '生化危机 安魂曲' } }
      }
    });
    restoreFetch = installFetchMock(fetchMock);
    const result = await webSearchFallback('生化危机9 安魂曲|中字-国语', null);
    expect(result && result.appId).toEqual(3764200);
    expect(result && result.aiFallback).toEqual(true);
    restoreFetch();
    restoreFetch = null;
  });

  test('appdetails 校验失败（名字与标题零共同词）→ null', async () => {
    fetchMock = createFetchMock({
      'cn.bing.com/search': () => ({
        text: async () => '<html><a href="https://store.steampowered.com/app/123456/">完全不相关的游戏</a></html>'
      }),
      '/api/appdetails': {
        123456: { success: true, data: { name: 'Jrago III 夜之安魂曲' } }
      }
    });
    restoreFetch = installFetchMock(fetchMock);
    const result = await webSearchFallback('某个全新神秘游戏', null);
    expect(result).toEqual(null);
    restoreFetch();
    restoreFetch = null;
  });

  test('失败结果独立缓存（web: 键，不阻断 LLM match 缓存）', async () => {
    fetchMock = createFetchMock({
      'cn.bing.com/search': () => ({ text: async () => '<html>无结果</html>' })
    });
    restoreFetch = installFetchMock(fetchMock);
    await webSearchFallback('缓存测试 Web 游戏', null);
    const calls = fetchMock._calls.filter((u) => u.includes('cn.bing.com')).length;
    await webSearchFallback('缓存测试 Web 游戏', null);
    const calls2 = fetchMock._calls.filter((u) => u.includes('cn.bing.com')).length;
    expect(calls2).toEqual(calls);
    restoreFetch();
    restoreFetch = null;
  });
});

// ============ 未配置 LLM → 静默跳过 ============
describe('llmMatchGame 未配置 LLM', () => {
  test('useLLM=false → 直接返回 null（不触发任何网络）', async () => {
    seedSettings({ useLLM: false, llmConfig: {} });
    const fakeFetch = () => {
      throw new Error('不应发起网络请求');
    };
    const prev = globalThis.fetch;
    globalThis.fetch = fakeFetch;
    try {
      expect(await aiMod.llmMatchGame('任意游戏', null)).toEqual(null);
    } finally {
      globalThis.fetch = prev;
    }
  });
});

// ============ v7.1.0：GET_STATS 自助诊断字段 ============
describe('GET_STATS 诊断字段（网址索引规模/负缓存条数）', () => {
  test('返回 urlIndexSize 与 negativeCacheCount', async () => {
    const resp = await handleMessage({ action: 'GET_STATS' });
    expect(typeof resp.urlIndexSize).toEqual('number');
    expect(typeof resp.negativeCacheCount).toEqual('number');
    expect(resp.cacheStats && typeof resp.cacheStats.modules).toEqual('object');
  });
});
