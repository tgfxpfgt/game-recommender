/**
 * 游戏雷达 Game Radar - 全量目录离线索引单测（app-list-index.js）
 *
 * v14.6（调研建议 1 落地）：归一化/精确匹配/excludeAppId/持久化往返/
 * 双源刷新降级（dump→IStoreService→失败）/过期触发后台刷新。
 * Deterministic coverage for the catalog index: normalization, exact match,
 * exclusion, persistence round-trip, dual-source refresh degradation.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';

// escape 全局（logger 链）
await import('../../shared/escape.js');

const storage = createStorageMock();
installChromeStorageMock(storage);

// fetch 桩：按 URL 片段分发（dump / IStoreService）
let fetchResponses = {};
let fetchCalls = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  fetchCalls.push(u);
  for (const [fragment, resp] of Object.entries(fetchResponses)) {
    if (u.includes(fragment)) return resp();
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

const DUMP_URL = 'raw.githubusercontent.com/jsnli/steamappidlist';
const SERVICE_URL = 'IStoreService/GetAppList';

// 具名游戏（断言用）+ 程序化填充到 ≥10000 条（模块的异常数据阈值）
const NAMED_APPS = [
  { appid: 435090, name: 'The Culling' }, // 已下架游戏（storesearch 盲区）
  { appid: 1091500, name: 'Cyberpunk 2077' },
  { appid: 1213700, name: '北方之魂 Spirit of the North' },
  { appid: 578080, name: 'PUBG: BATTLEGROUNDS' }
];
const FILLER_COUNT = 10050;
const DUMP_APPS = [
  ...NAMED_APPS,
  ...Array.from({ length: FILLER_COUNT }, (_, i) => ({ appid: 900000 + i, name: `Filler Game ${i}` }))
];

function dumpResponse(apps = DUMP_APPS) {
  return { ok: true, status: 200, json: async () => apps };
}

// 两套独立实例（?t= 隔离）：A 用于刷新写入，B 验证持久化跨实例读取
const modA = await import('../../background/steam/app-list-index.js?t=a');
const modB = await import('../../background/steam/app-list-index.js?t=b');

beforeEach(() => {
  storage._reset();
  // v14.6.2：失败退避时间戳存 session——跨用例残留会挡住后续刷新断言
  if (globalThis.chrome && globalThis.chrome.storage && globalThis.chrome.storage.session) {
    globalThis.chrome.storage.session._reset();
  }
  fetchResponses = {};
  fetchCalls = [];
});

describe('normalizeTitle 归一化', () => {
  test('全角/大小写/符号/空白归一', async () => {
    const { normalizeTitle } = modA;
    expect(normalizeTitle('The Culling')).toEqual('the culling');
    expect(normalizeTitle('ＴＨＥ　ＣＵＬＬＩＮＧ！')).toEqual('the culling'); // NFKC + 符号
    expect(normalizeTitle('赛博朋克：2077（限定版）')).toEqual('赛博朋克 2077 限定版');
    expect(normalizeTitle('  PUBG:   BATTLEGROUNDS ')).toEqual('pubg battlegrounds');
    expect(normalizeTitle('')).toEqual('');
  });
});

describe('目录刷新与匹配', () => {
  test('主源 dump 刷新 → 归一化精确命中（含下架游戏）', async () => {
    fetchResponses = { [DUMP_URL]: () => dumpResponse() };
    const ok = await modA.refreshAppListIndex(true);
    expect(ok).toEqual(true);
    // 精确命中
    const hit = await modA.matchAppListExact('The Culling');
    expect(hit).toEqual({ appId: '435090', name: 'The Culling' });
    // 归一化命中（全角/符号差异）
    const hit2 = await modA.matchAppListExact('ＰＵＢＧ：BATTLEGROUNDS！');
    expect(hit2 && hit2.appId).toEqual('578080');
    // 未命中
    expect(await modA.matchAppListExact('不存在的游戏 XYZ')).toEqual(null);
  });

  test('excludeAppId 黑名单排除', async () => {
    fetchResponses = { [DUMP_URL]: () => dumpResponse() };
    await modA.refreshAppListIndex(true);
    expect(await modA.matchAppListExact('The Culling', '435090')).toEqual(null);
  });

  test('持久化往返：A 实例刷新 → B 实例（未刷新）经存储读到同目录', async () => {
    fetchResponses = { [DUMP_URL]: () => dumpResponse() };
    await modA.refreshAppListIndex(true);
    // B 实例从 chrome.storage（OPFS 降级后端）加载
    const hit = await modB.matchAppListExact('Cyberpunk 2077');
    expect(hit && hit.appId).toEqual('1091500');
  });

  test('主源 404 → 备源 IStoreService（有 key 时）→ 无 key 双失败返回 false', async () => {
    // settings 单例缓存按首次 getSettings 固化——用例内先重置再写入 key
    const { resetSettingsCache } = await import('../../background/core/settings.js');

    // 无 key：dump 404 → 双失败
    fetchResponses = { [DUMP_URL]: () => ({ ok: false, status: 404, json: async () => ({}) }) };
    storage._reset();
    resetSettingsCache();
    expect(await modA.refreshAppListIndex(true)).toEqual(false);

    // 有 key：dump 404 → IStoreService 分页成功（两页，验证 last_appid 续传）
    await storage.set({ settings: { steamApiKey: 'test-key' } });
    resetSettingsCache();
    let page = 0;
    const servicePages = [DUMP_APPS.slice(0, 2), DUMP_APPS.slice(2)];
    fetchResponses = {
      [DUMP_URL]: () => ({ ok: false, status: 404, json: async () => ({}) }),
      [SERVICE_URL]: () => {
        const apps = servicePages[page] || [];
        page++;
        const body = { response: { apps: apps.map((a) => ({ appid: Number(a.appid), name: a.name })) } };
        if (page < servicePages.length) {
          body.response.have_more_results = true;
          body.response.last_appid = '1091500';
        }
        return { ok: true, status: 200, json: async () => body };
      }
    };
    expect(await modA.refreshAppListIndex(true)).toEqual(true);
    expect(page).toEqual(2); // 分页两页都拉取
    const hit = await modA.matchAppListExact('北方之魂 Spirit of the North');
    expect(hit && hit.appId).toEqual('1213700');
  });

  test('dump 条目过少（异常数据）→ 拒绝并降级 + miss 触发后台刷新尝试', async () => {
    storage._reset();
    fetchResponses = { [DUMP_URL]: () => dumpResponse([{ appid: 1, name: 'Only One' }]) };
    expect(await modA.refreshAppListIndex(true)).toEqual(false);
    // v14.6.2：首败记录退避——清 session（模拟退避窗口已过）后再验证
    // miss → 触发刷新的链路（退避挡下行为由"刷新失败退避"describe 覆盖）
    globalThis.chrome.storage.session._reset();
    const fetchCountBefore = fetchCalls.filter((u) => u.includes(DUMP_URL)).length;
    const modE = await import('../../background/steam/app-list-index.js?t=e');
    expect(await modE.matchAppListExact('The Culling')).toEqual(null);
    await new Promise((r) => setTimeout(r, 0));
    const fetchCountAfter = fetchCalls.filter((u) => u.includes(DUMP_URL)).length;
    expect(fetchCountAfter).toBeGreaterThan(fetchCountBefore); // miss → 刷新尝试
  });

  test('保鲜期内重复刷新跳过（force=false）', async () => {
    fetchResponses = { [DUMP_URL]: () => dumpResponse() };
    await modA.refreshAppListIndex(true);
    fetchCalls = [];
    await modA.refreshAppListIndex(false); // 保鲜期内 → 不发请求
    expect(fetchCalls.length).toEqual(0);
  });
});

// ============ v14.6.2：刷新失败退避（跨 SW 重启，session 级） ============
// 事故回放：dump 源 404/被墙时，"每 SW 生命周期至多一次"在 SW 频繁冷启动下
// 等于反复重试（每次 45s 挂起）；失败时间戳入 chrome.storage.session，
// 退避窗口（6h）内不再发请求，浏览器重启后允许再试。
describe('刷新失败退避（v14.6.2）', () => {
  test('失败后 force=false 的刷新被退避挡下（不发请求）；force=true 穿透', async () => {
    storage._reset();
    globalThis.chrome.storage.session._reset();
    // dump 404 + 无 key → 双源失败
    fetchResponses = { [DUMP_URL]: () => ({ ok: false, status: 404, json: async () => ({}) }) };
    const modF = await import('../../background/steam/app-list-index.js?t=f');
    expect(await modF.refreshAppListIndex(true)).toEqual(false);
    // 失败时间戳已记录
    const sess = globalThis.chrome.storage.session._dump();
    expect(typeof sess.appListRefreshFailAt).toEqual('number');
    // 退避窗口内：非 force 刷新直接失败，零网络请求
    fetchCalls = [];
    expect(await modF.refreshAppListIndex(false)).toEqual(false);
    expect(fetchCalls.filter((u) => u.includes(DUMP_URL)).length).toEqual(0);
    // force=true 穿透退避（测试/手动路径）——重新发起请求
    expect(await modF.refreshAppListIndex(true)).toEqual(false);
    expect(fetchCalls.filter((u) => u.includes(DUMP_URL)).length).toBeGreaterThan(0);
  });
  test('浏览器会话重置（session 清空）后退避解除', async () => {
    storage._reset();
    globalThis.chrome.storage.session._reset();
    fetchResponses = { [DUMP_URL]: () => ({ ok: false, status: 404, json: async () => ({}) }) };
    const modG = await import('../../background/steam/app-list-index.js?t=g');
    await modG.refreshAppListIndex(true); // 失败 → 记退避
    globalThis.chrome.storage.session._reset(); // 模拟浏览器重启
    fetchResponses = { [DUMP_URL]: () => dumpResponse() }; // 源恢复
    fetchCalls = [];
    expect(await modG.refreshAppListIndex(false)).toEqual(true); // 解除后成功
    expect(fetchCalls.filter((u) => u.includes(DUMP_URL)).length).toEqual(1);
  });
});
