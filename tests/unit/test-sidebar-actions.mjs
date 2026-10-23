/**
 * 游戏雷达 Game Radar - 浮窗回调工厂单测（sidebar-actions.js）
 *
 * v14.5.0 B7 拆分物的确定性覆盖：sim 节 9 只驱动渲染路径（工厂内层回调
 * 仅在按钮点击后执行，sim 时序 flake 会击穿 coverage:gate）——本套件直调
 * 工厂锁语义：状态存取 / 手动刷新（成功+失败）/ 报错重检索（纠正成功 +
 * 同 appId 进手动选择）。
 * Deterministic unit coverage for the callback factory (B7): state accessors,
 * manual refresh (success + failure), report-issue re-search (corrected vs
 * same-appId → manual select).
 */
import { describe, test, expect } from 'vitest';

// escape 全局先注入（common.escapeHtml 回退本地实现需要 document——IIFE 版纯字符串）
await import('../../shared/escape.js');

// DOM 桩：builder 图片提取（querySelectorAll('img') → 空）与 candidates 面板操作的最小面
globalThis.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
  getElementById: () => null,
  body: { contains: () => false },
  documentElement: {},
  head: { appendChild: () => {} },
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, remove() {} })
};
if (!globalThis.window) globalThis.window = {};
// candidates.renderManualSelectPanel 的 issue 链接需要 location/chrome.runtime
globalThis.location = globalThis.location || { href: 'http://test/detail' };
globalThis.chrome = globalThis.chrome || { runtime: { getManifest: () => ({ version: '0-test' }) } };

const { createSteamActions } = await import('../../content/detail/sidebar-actions.js');

// 消息预设（按 action 分发；未预设的 action 返回 undefined——同后台无响应语义）
let presets = {};
globalThis.window.__GR_MSG__ = {
  sendMessage: async (msg) => (presets[msg.action] ? presets[msg.action](msg) : undefined)
};

function makePanel() {
  return { innerHTML: '', style: {}, querySelector: () => null, querySelectorAll: () => [] };
}

function makeDeps() {
  const calls = { render: [], andShow: [], show: 0, hide: 0 };
  const deps = {
    panel: makePanel(),
    hidePanel: () => calls.hide++,
    showPanel: () => calls.show++,
    renderSteamSidebar: (...a) => calls.render.push(a),
    renderAndShow: (...a) => calls.andShow.push(a)
  };
  return { deps, calls };
}

describe('sidebar-actions 回调工厂', () => {
  test('状态存取：steamData / reportIssue 互通', async () => {
    const { deps } = makeDeps();
    const actions = createSteamActions(deps);
    expect(actions.steamData).toEqual(null);
    actions.setSteamData({ appId: '1', name: 'X' });
    expect(actions.steamData).toEqual({ appId: '1', name: 'X' });
    const fn = async () => {};
    actions.setReportIssue(fn);
    expect(actions.reportIssue).toBe(fn);
  });

  test('手动刷新：REFRESH_STEAM_CACHE 成功 → 渲染 + 状态更新；无数据 → 抛错', async () => {
    const { deps, calls } = makeDeps();
    const actions = createSteamActions(deps);
    presets = { REFRESH_STEAM_CACHE: () => ({ data: { appId: '9', name: 'Y', positiveRate: 80 }, cachedAt: 123 }) };
    await actions.makeOnRefresh('Y')();
    expect(calls.render.length).toEqual(1);
    expect(calls.render[0][1].name).toEqual('Y'); // 渲染收到刷新数据
    expect(actions.steamData.name).toEqual('Y');
    presets = { REFRESH_STEAM_CACHE: () => ({}) };
    await expect(actions.makeOnRefresh('Y')()).rejects.toThrow('刷新后未获取到数据');
  });

  test('报错重检索：纠正成功 → 渲染 + showPanel + 数据替换', async () => {
    const { deps, calls } = makeDeps();
    const actions = createSteamActions(deps);
    actions.setSteamData({ appId: '2001760', name: 'wrong' });
    const sent = [];
    presets = {
      REPORT_WRONG_APPID: (msg) => {
        sent.push(msg);
        return { ok: true };
      },
      GET_STEAM_BY_APPID: () => ({ data: null }),
      SEARCH_STEAM: () => ({ data: { appId: '1213700', name: '北方之魂' }, cachedAt: 5 })
    };
    await actions.makeReportIssue('北方之魂增强版')();
    expect(sent.length).toEqual(1);
    expect(sent[0].appId).toEqual('2001760'); // 清缓存带旧 appId
    expect(calls.render.length).toEqual(1);
    expect(calls.show).toEqual(1);
    expect(actions.steamData.appId).toEqual('1213700'); // 纠正后数据替换
  });

  test('报错重检索：同 appId（自动纠正失败）→ 进入手动选择面板', async () => {
    const { deps, calls } = makeDeps();
    const actions = createSteamActions(deps);
    actions.setSteamData({ appId: '1', name: 'same' });
    presets = {
      REPORT_WRONG_APPID: () => ({}),
      SEARCH_STEAM: () => ({ data: { appId: '1', name: 'same' } }) // 与旧 appId 相同
    };
    // 不抛错即通过（renderManualSelectPanel 以桩面板执行——幂等路径）
    await actions.makeReportIssue('同名校正')();
    expect(calls.render.length).toEqual(0); // 未重渲染主浮窗
  });

  test('报错重检索：未找到（无 data）→ 进入手动选择面板', async () => {
    const { deps, calls } = makeDeps();
    const actions = createSteamActions(deps);
    actions.setSteamData({ appId: '2', name: 'missing' });
    presets = { REPORT_WRONG_APPID: () => ({}), SEARCH_STEAM: () => ({}) };
    await actions.makeReportIssue('不存在的游戏')();
    expect(calls.render.length).toEqual(0);
  });
});
