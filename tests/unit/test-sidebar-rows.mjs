/**
 * 游戏雷达 Game Radar - 浮窗数据行填充单测（sidebar-rows.js）
 *
 * v14.3.0（第五轮 B1 拆分配套）：ITAD/收藏行与 Steam250 行的填充逻辑——
 * 无数据/异型时行隐藏、有数据时渲染转义后的 HTML（shop 转义、price 异型防御）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const msgHandlers = {};
globalThis.window = globalThis;
// escapeHtml 全局（真实环境由 shared/escape.js 注入；此处以同语义纯字符串实现）
globalThis.escapeHtml = (t) =>
  String(t ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
globalThis.__GR_MSG__ = {
  sendMessage: vi.fn((msg) => (msgHandlers[msg.action] || (() => ({})))(msg))
};

function makeRowEl(id) {
  const el = {
    id,
    style: {},
    innerHTML: '',
    textContent: '',
    parentNode: { insertBefore(child, ref) {} },
    children: []
  };
  return el;
}
const rows = {};
globalThis.document = {
  getElementById(id) {
    return rows[id] || null;
  },
  createElement() {
    return { style: {}, innerHTML: '', textContent: '', appendChild() {}, addEventListener() {} };
  }
};

const mod = await import('../../content/detail/sidebar-rows.js');
const { fillItadAndFavorites, fillSteam250Info } = mod;

beforeEach(() => {
  vi.clearAllMocks();
  rows['gr-itad-row'] = makeRowEl('gr-itad-row');
  rows['gr-steam250-row'] = makeRowEl('gr-steam250-row');
  rows['gr-steam250-inline'] = makeRowEl('gr-steam250-inline');
});

describe('fillItadAndFavorites（ITAD 最低价行 + 收藏按钮）', () => {
  it('有价格数据：渲染转义后的 ITAD 行', async () => {
    msgHandlers.GET_ITAD_LOWEST = async () => ({ info: { price: 99.5, shop: '<img onerror>' } });
    msgHandlers.GET_FAVORITES = async () => ({ favorites: {} });
    await fillItadAndFavorites('730', 'CS2', '');
    expect(rows['gr-itad-row'].innerHTML).toContain('99.50');
    expect(rows['gr-itad-row'].innerHTML).not.toContain('<img onerror>'); // shop 已转义
    expect(rows['gr-itad-row'].innerHTML).toContain('&lt;img');
  });

  it('无数据/查询失败：行隐藏不抛错', async () => {
    msgHandlers.GET_ITAD_LOWEST = async () => ({ info: null });
    msgHandlers.GET_FAVORITES = async () => ({ favorites: {} });
    await fillItadAndFavorites('730', 'CS2', '');
    expect(rows['gr-itad-row'].style.display).toEqual('none');
  });

  it('price 异型（NaN）：行隐藏（v10.9.1 防线）', async () => {
    msgHandlers.GET_ITAD_LOWEST = async () => ({ info: { price: 'not-a-number' } });
    msgHandlers.GET_FAVORITES = async () => ({ favorites: {} });
    await fillItadAndFavorites('730', 'CS2', '');
    expect(rows['gr-itad-row'].style.display).toEqual('none');
  });

  it('行锚点缺失：直接返回（模板未渲染场景）', async () => {
    delete rows['gr-itad-row'];
    msgHandlers.GET_FAVORITES = async () => ({ favorites: {} });
    await expect(fillItadAndFavorites('730', 'CS2', '')).resolves.toBeUndefined();
  });
});

describe('fillSteam250Info（Steam250 排名行）', () => {
  it('有排名：双挂点同填', async () => {
    msgHandlers.GET_STEAM250_RANK = async () => ({ info: { rank: 42, score: 8.8, votes: 1200 } });
    await fillSteam250Info('730');
    expect(rows['gr-steam250-row'].innerHTML).toContain('#42');
    expect(rows['gr-steam250-inline'].innerHTML).toContain('#42');
  });

  it('无排名/无 appId：行隐藏', async () => {
    msgHandlers.GET_STEAM250_RANK = async () => ({ info: null });
    await fillSteam250Info('730');
    expect(rows['gr-steam250-row'].style.display).toEqual('none');
    await fillSteam250Info('');
    expect(rows['gr-steam250-inline'].style.display).toEqual('none');
  });
});
