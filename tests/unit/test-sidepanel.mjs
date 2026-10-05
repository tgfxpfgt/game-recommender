/**
 * 游戏雷达 Game Radar - SidePanel 页单测
 *
 * v14.2.0（复审轮 P0-1：sidepanel 目录此前逃出 lint/typecheck/coverage/测试
 * 四道门禁）——chrome stub + DOM stub 驱动页面 IIFE 的三个刷新链路：
 * 当前页游戏（tab 联动 + 收藏态）、收藏清单、限免速览（异型数据守卫）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 转义全局（与 shared/escape.js 同语义的纯字符串实现——原实现依赖 DOM createElement）
globalThis.escapeHtml = (t) =>
  String(t ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
globalThis.escapeAttr = globalThis.escapeHtml;
globalThis.window = globalThis; // sidepanel.js 经 window.__GR_MSG__ 取消息层（node 无 window）

// 消息路由桩
const handlers = {
  GET_SETTINGS: async () => ({ settings: { uiTheme: 'steam' } }),
  GET_TAB_GAME: async () => ({ game: { appId: '730', name: 'CS2', positiveRate: 88, headerImage: 'https://img' } }),
  GET_FAVORITES: async () => ({ favorites: { 730: { name: 'CS2', addedAt: 1 } } }),
  TOGGLE_FAVORITE: async () => ({ favorited: true }),
  GET_FREE_GAMES: async () => ({ data: { games: [{ title: 'Game X', platformName: 'Steam', url: 'https://x' }] } })
};
globalThis.__GR_MSG__ = { sendMessage: vi.fn((msg) => (handlers[msg.action] || (() => ({})))()) };

// chrome stub
const listeners = {};
globalThis.chrome = {
  tabs: {
    query: vi.fn(async () => [{ id: 7 }]),
    onActivated: { addListener: (fn) => (listeners.activated = fn) },
    onUpdated: { addListener: (fn) => (listeners.updated = fn) }
  },
  runtime: { getURL: (p) => 'chrome-extension://x/' + p }
};

// DOM stub（按 id 建面板）
const panels = {};
function panel(id) {
  if (!panels[id]) {
    panels[id] = {
      id,
      innerHTML: '',
      textContent: '',
      dataset: {},
      lastQuery: '',
      querySelector() {
        return { addEventListener() {} };
      },
      querySelectorAll(sel) {
        // 收藏移除按钮场景：innerHTML 有内容时返回一个可点击行
        if (sel === '.rm' && panels[id].innerHTML.includes('sp-row')) {
          return [
            {
              addEventListener() {},
              closest() {
                return { dataset: { appid: '730' } };
              }
            }
          ];
        }
        return [];
      },
      addEventListener() {}
    };
  }
  return panels[id];
}
globalThis.document = {
  getElementById: (id) => panel(id),
  addEventListener() {}
};

await import('../../sidepanel/sidepanel.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SidePanel 页面 IIFE（三个刷新链路）', () => {
  it('当前页游戏：渲染 tab 快照 + 收藏态按钮', async () => {
    await vi.waitFor(() => expect(panels.spGameBody.innerHTML).toContain('CS2'));
    expect(panels.spGameBody.innerHTML).toContain('好评率 88%');
    expect(panels.spGameBody.innerHTML).toContain('已收藏');
  });

  it('tab 无快照：显示空态文案（不抛错）', async () => {
    handlers.GET_TAB_GAME = async () => ({ game: null });
    await chrome.tabs.query({ active: true });
    listeners.activated();
    await vi.waitFor(() => expect(panels.spGameBody.innerHTML).toContain('自动显示'));
    handlers.GET_TAB_GAME = async () => ({
      game: { appId: '730', name: 'CS2', positiveRate: 88, headerImage: 'https://img' }
    });
  });

  it('收藏清单：渲染条目与移除按钮', async () => {
    await vi.waitFor(() => expect(panels.spFavBody.innerHTML).toContain('CS2'));
  });

  it('限免速览：data.games 形态归一（v10.9 同款异型守卫）', async () => {
    await vi.waitFor(() => expect(panels.spFreeBody.innerHTML).toContain('Game X'));
  });

  it('限免速览：games 缺失 → 空态文案（模块重载驱动异型分支）', async () => {
    handlers.GET_FREE_GAMES = async () => ({ data: {} }); // games 缺失
    await import('../../sidepanel/sidepanel.js?reload=' + Date.now()); // 重新执行 IIFE
    await vi.waitFor(() => expect(panels.spFreeBody.textContent).toContain('没有限免'));
    handlers.GET_FREE_GAMES = async () => ({
      data: { games: [{ title: 'Game X', platformName: 'Steam', url: 'https://x' }] }
    });
  });

  it('tabs 事件已接线（tab 联动）', () => {
    expect(typeof listeners.activated).toEqual('function');
    expect(typeof listeners.updated).toEqual('function');
  });
});
