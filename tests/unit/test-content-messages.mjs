/**
 * 游戏雷达 Game Radar - 内容消息路由单测（messages.js）
 *
 * v14.5.0 B8：路由器工厂的确定性覆盖（sim 只走 happy-path 推送，分支覆盖
 * 击不穿 coverage:gate）——四类 action 的就绪/延迟双路径、首页/列表页门控、
 * 未知 action 不占通道。
 * Deterministic coverage for the router factory: per-action ready/deferred
 * paths, page gating, unknown-action channel semantics.
 */
import { describe, test, expect, beforeEach } from 'vitest';

// escape 全局（FORCE_REFRESH 分支的 dbg/消息链会触及 common 工具）
await import('../../shared/escape.js');

globalThis.window = globalThis.window || {};
globalThis.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
  getElementById: () => null,
  documentElement: { dataset: {} },
  body: { contains: () => false },
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, remove() {} })
};
globalThis.location = globalThis.location || { href: 'http://test/list', reload: () => {} };
globalThis.chrome = globalThis.chrome || { runtime: { getManifest: () => ({ version: '0-test' }) } };

const { createMessageRouter } = await import('../../content/core/messages.js');

// 模块句柄桩（按用例覆写行为）
let M;
let settingsResp;
let msgLog;
const readyMods = () => ({ status: {}, ...M }); // 就绪快路径判定用（status 存在即视为就绪）

/** 组装路由器 + 双通道依赖 */
function makeRouter({ ready = true } = {}) {
  msgLog = [];
  globalThis.window.__GR_MSG__ = {
    sendMessage: async (msg) => {
      msgLog.push(msg);
      if (msg.action === 'GET_SETTINGS') return settingsResp;
      if (msg.action === 'CLEAR_CACHE_FOR_PAGE') return { cleared: msg.names.length + msg.appIds.length };
      return { success: true };
    }
  };
  const bootPromise = Promise.resolve({ M });
  const route = createMessageRouter({
    bootPromise,
    getModules: ready ? readyMods : () => null
  });
  return route;
}

function makeM(overrides = {}) {
  return {
    status: { showLastStats: () => {}, ...overrides.status },
    debug: { dbg: () => {} },
    builder: {
      getAdapter: () => ({ isListPage: () => overrides.isListPage !== false }),
      extractSteamImageInfo: () => overrides.imageInfo || null,
      ...overrides.builder
    },
    list: {
      isHomePageUrl: () => overrides.isHome === true,
      isListPageByUrl: () => overrides.isListPage !== false,
      isDetailPageByUrl: () => overrides.isDetail === true,
      getListItemsSmart: () => overrides.items || [],
      applyVmFilter: (items) => items.map((i) => ({ ...i, vm: true })),
      requestRecommendations: () => {},
      applySteamRatingsUpdate: () => {},
      ...overrides.list
    },
    detail: {
      detectGameName: () => overrides.gameName || '游戏X',
      ...overrides.detail
    },
    ...overrides.extra
  };
}

beforeEach(() => {
  M = makeM();
  settingsResp = { settings: { enableVmFilter: false } };
});

describe('内容消息路由 createMessageRouter', () => {
  test('REFRESH_RECOMMENDATIONS：列表页 + vm 过滤 → requestRecommendations', async () => {
    settingsResp = { settings: { enableVmFilter: true } };
    const route = makeRouter();
    const items = [{ name: 'A' }];
    M.list.getListItemsSmart = () => items;
    let applied = null;
    M.list.applyVmFilter = (list) => {
      applied = list;
      return list;
    };
    let recd = null;
    M.list.requestRecommendations = (items2) => {
      recd = items2;
    };
    let resp;
    const keepOpen = route({ action: 'REFRESH_RECOMMENDATIONS' }, {}, (r) => {
      resp = r;
    });
    expect(keepOpen).toEqual(true); // 异步响应保持通道
    await new Promise((r) => setTimeout(r, 0));
    expect(resp).toEqual({ success: true });
    expect(applied).toEqual(items); // vm 过滤已应用
    expect(recd.length).toEqual(1);
  });

  test('REFRESH_RECOMMENDATIONS：首页不响应 / 设置缺失返回失败', async () => {
    M = makeM({ isHome: true });
    let recd = 0;
    M.list.requestRecommendations = () => {
      recd++;
    };
    const route = makeRouter();
    let resp;
    route({ action: 'REFRESH_RECOMMENDATIONS' }, {}, (r) => (resp = r));
    await new Promise((r) => setTimeout(r, 0));
    expect(resp).toEqual({ success: true });
    expect(recd).toEqual(0); // 首页跳过推荐

    settingsResp = null; // 设置缺失
    let resp2;
    route({ action: 'REFRESH_RECOMMENDATIONS' }, {}, (r) => (resp2 = r));
    await new Promise((r) => setTimeout(r, 0));
    expect(resp2).toEqual({ success: false });
  });

  test('SHOW_LAST_STATS：就绪快路径同步重显', async () => {
    let shown = 0;
    M = makeM({ status: { showLastStats: () => shown++ } });
    const route = makeRouter();
    let resp;
    const keepOpen = route({ action: 'SHOW_LAST_STATS' }, {}, (r) => {
      resp = r;
    });
    expect(keepOpen).toEqual(undefined); // 同步响应不占通道
    expect(resp).toEqual({ success: true });
    expect(shown).toEqual(1);
  });

  test('STEAM_RATINGS_UPDATE：就绪快路径同步应用（B7 前语义）', async () => {
    let applied = null;
    M = makeM({
      list: { applySteamRatingsUpdate: (ratings, done) => (applied = { ratings, done }) }
    });
    const route = makeRouter();
    route({ action: 'STEAM_RATINGS_UPDATE', ratings: { 游戏B: { appId: '2' } }, done: false }, {}, () => {});
    expect(applied).toEqual({ ratings: { 游戏B: { appId: '2' } }, done: false }); // 同步应用
  });

  test('STEAM_RATINGS_UPDATE：boot 未完成走延迟路径', async () => {
    let applied = false;
    M = makeM({
      list: { applySteamRatingsUpdate: () => (applied = true) }
    });
    const route = makeRouter({ ready: false }); // getModules 返回 null → 延迟
    route({ action: 'STEAM_RATINGS_UPDATE', ratings: {}, done: true }, {}, () => {});
    expect(applied).toEqual(false); // 未立即应用
    await new Promise((r) => setTimeout(r, 0));
    expect(applied).toEqual(true); // boot 后补应用
  });

  test('FORCE_REFRESH_PAGE：详情页收集 + 清缓存 + 响应', async () => {
    M = makeM({
      isDetail: true,
      gameName: '北方之魂',
      imageInfo: { appId: '1213700' }
    });
    const route = makeRouter();
    let resp;
    route({ action: 'FORCE_REFRESH_PAGE' }, {}, (r) => (resp = r));
    await new Promise((r) => setTimeout(r, 0));
    expect(resp).toEqual({ success: true, cleared: 2 }); // 1 名 + 1 appId
    const clear = msgLog.find((m) => m.action === 'CLEAR_CACHE_FOR_PAGE');
    expect(clear.names).toContain('北方之魂');
    expect(clear.appIds).toContain('1213700');
  });

  test('未知 action：不占消息通道', () => {
    const route = makeRouter();
    let responded = false;
    const keepOpen = route({ action: 'NO_SUCH_ACTION' }, {}, () => {
      responded = true;
    });
    expect(keepOpen).toEqual(undefined);
    expect(responded).toEqual(false);
  });
});
