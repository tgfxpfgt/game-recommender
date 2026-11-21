/**
 * 游戏雷达 Game Radar - SidePanel 页单测
 *
 * v14.2.0（复审轮 P0-1：sidepanel 目录此前逃出 lint/typecheck/coverage/测试
 * 四道门禁）——chrome stub + DOM 驱动页面 IIFE 的三个刷新链路：
 * 当前页游戏（tab 联动 + 收藏态）、收藏清单、限免速览（异型数据守卫）。
 * v15 阶段 3 全量迁移：手写 DOM 桩 → happy-dom 真实 DOM + __GR_PREACT__ 注入
 * （页面渲染面已 Preact 化——真实元素才能承接 render/onClick）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Window } from 'happy-dom';
import { h, render, Fragment } from 'preact';

const win = new Window();
globalThis.window = win;
globalThis.document = win.document;
// 转义全局（页面已 Preact 化——不再消费，但 escape.js 全局注入面保持完整）
globalThis.escapeHtml = (/** @type {unknown} */ t) =>
  String(t ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
globalThis.escapeAttr = globalThis.escapeHtml;
// Preact 垫片（页面 P() 经 globalThis.__GR_PREACT__ 取——preact-globals 同源）
/** @type {any} */ (globalThis).__GR_PREACT__ = { h, render, Fragment };

// 消息路由桩
const handlers = {
  GET_SETTINGS: async () => ({ settings: { uiTheme: 'steam' } }),
  GET_TAB_GAME: async () => ({ game: { appId: '730', name: 'CS2', positiveRate: 88, headerImage: 'https://img' } }),
  GET_FAVORITES: async () => ({ favorites: { 730: { name: 'CS2', addedAt: 1 } } }),
  TOGGLE_FAVORITE: async () => ({ favorited: true }),
  GET_FREE_GAMES: async () => ({ data: { games: [{ title: 'Game X', platformName: 'Steam', url: 'https://x' }] } })
};
globalThis.__GR_MSG__ = { sendMessage: vi.fn((/** @type {any} */ msg) => (handlers[msg.action] || (() => ({})))()) };
// 页面经 window.__GR_MSG__ 取消息层——happy-dom Window 是独立实例，需镜像
/** @type {any} */ (win).__GR_MSG__ = globalThis.__GR_MSG__;

// chrome stub
const listeners = {};
globalThis.chrome = {
  tabs: {
    query: vi.fn(async () => [{ id: 7 }]),
    onActivated: { addListener: (/** @type {any} */ fn) => (listeners.activated = fn) },
    onUpdated: { addListener: (/** @type {any} */ fn) => (listeners.updated = fn) }
  },
  runtime: { getURL: (/** @type {string} */ p) => 'chrome-extension://x/' + p }
};

// 面板挂点（真实 DOM 元素——sidepanel.html 的四个 body 区）
for (const id of ['spGameBody', 'spFavBody', 'spFreeBody', 'spOpenSettings']) {
  const el = win.document.createElement('div');
  el.id = id;
  win.document.body.appendChild(el);
}

await import('../../sidepanel/sidepanel.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SidePanel 页面 IIFE（三个刷新链路）', () => {
  it('当前页游戏：渲染 tab 快照 + 收藏态按钮', async () => {
    const body = win.document.getElementById('spGameBody');
    await vi.waitFor(() => expect(body && body.innerHTML).toContain('CS2'));
    expect(body && body.innerHTML).toContain('好评率 88%');
    expect(body && body.innerHTML).toContain('已收藏');
  });

  it('tab 无快照：显示空态文案（不抛错）', async () => {
    handlers.GET_TAB_GAME = async () => ({ game: null });
    await chrome.tabs.query({ active: true });
    listeners.activated();
    const body = win.document.getElementById('spGameBody');
    await vi.waitFor(() => expect(body && body.innerHTML).toContain('自动显示'));
    handlers.GET_TAB_GAME = async () => ({
      game: { appId: '730', name: 'CS2', positiveRate: 88, headerImage: 'https://img' }
    });
  });

  it('收藏清单：渲染条目与移除按钮', async () => {
    const el = win.document.getElementById('spFavBody');
    await vi.waitFor(() => expect(el && el.innerHTML).toContain('CS2'));
    expect(el && el.querySelector('.rm')).toBeTruthy();
  });

  it('限免速览：data.games 形态归一（v10.9 同款异型守卫）', async () => {
    const el = win.document.getElementById('spFreeBody');
    await vi.waitFor(() => expect(el && el.innerHTML).toContain('Game X'));
  });

  it('限免速览：games 缺失 → 空态文案（模块重载驱动异型分支）', async () => {
    handlers.GET_FREE_GAMES = async () => ({ data: {} }); // games 缺失
    await import('../../sidepanel/sidepanel.js?reload=' + Date.now()); // 重新执行 IIFE
    const el = win.document.getElementById('spFreeBody');
    await vi.waitFor(() => expect(el && el.textContent).toContain('没有限免'));
    handlers.GET_FREE_GAMES = async () => ({
      data: { games: [{ title: 'Game X', platformName: 'Steam', url: 'https://x' }] }
    });
  });

  it('tabs 事件已接线（tab 联动）', () => {
    expect(typeof listeners.activated).toEqual('function');
    expect(typeof listeners.updated).toEqual('function');
  });
});
