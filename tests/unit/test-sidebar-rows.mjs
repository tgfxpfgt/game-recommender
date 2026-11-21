/**
 * 游戏雷达 Game Radar - 浮窗数据行填充单测（sidebar-rows.js）
 *
 * v14.3.0（第五轮 B1 拆分配套）：ITAD/收藏行与 Steam250 行的填充逻辑——
 * 无数据/异型时行隐藏、有数据时渲染转义后的 HTML（shop 转义、price 异型防御）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Window } from 'happy-dom';

const msgHandlers = {};
const win = new Window();
globalThis.window = win;
globalThis.document = win.document;
// escapeHtml 全局（真实环境由 shared/escape.js 注入；此处以同语义纯字符串实现）
globalThis.escapeHtml = (/** @type {unknown} */ t) =>
  String(t ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
globalThis.__GR_MSG__ = {
  sendMessage: vi.fn((/** @type {any} */ msg) => (msgHandlers[msg.action] || (() => ({})))(msg))
};
// 页面经 window.__GR_MSG__ 取消息层——happy-dom Window 是独立实例，需镜像
/** @type {any} */ (win).__GR_MSG__ = globalThis.__GR_MSG__;
// 页面 Preact 渲染经 __GR_PREACT__（sidebar-rows v15 阶段 3 迁移面）
const { h, render, Fragment } = await import('preact');
/** @type {any} */ (globalThis).__GR_PREACT__ = { h, render, Fragment };

// v15 阶段 3：手写 DOM 桩 → happy-dom 真实元素（Preact mountView 需
// createElementNS/createElement/appendChild 真实面）
const rows = {};
function makeRowEl(/** @type {string} */ id) {
  const el = win.document.createElement('div');
  el.id = id;
  return el;
}

const mod = await import('../../content/detail/sidebar-rows.js');
const { fillItadAndFavorites, fillSteam250Info } = mod;

beforeEach(() => {
  vi.clearAllMocks();
  // 真实 DOM 语义：getElementById 取文档序首个同 id 元素——上一用例残留元素
  // 会吞掉本用例的行锚点，body 必须先清场再挂新锚点
  win.document.body.replaceChildren();
  rows['gr-itad-row'] = makeRowEl('gr-itad-row');
  rows['gr-steam250-row'] = makeRowEl('gr-steam250-row');
  rows['gr-steam250-inline'] = makeRowEl('gr-steam250-inline');
  // 行锚点必须挂入文档——fillItadAndFavorites 的 favRow 插入走
  // parentNode.insertBefore（脱文档元素 parentNode=null 即抛）
  win.document.body.appendChild(rows['gr-itad-row']);
  win.document.body.appendChild(rows['gr-steam250-row']);
  win.document.body.appendChild(rows['gr-steam250-inline']);
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
  it('有排名：双挂点同填 + 游戏专属深链（v14.22.1）+ 整行可点（v14.22.2）', async () => {
    msgHandlers.GET_STEAM250_RANK = async () => ({ info: { rank: 42, score: 8.8, votes: 1200 } });
    await fillSteam250Info('730');
    expect(rows['gr-steam250-row'].innerHTML).toContain('#42');
    expect(rows['gr-steam250-inline'].innerHTML).toContain('#42');
    // v14.22.1：链接 = 该游戏 steam250 专属页（top250 通用榜单页缺未入榜游戏）
    expect(rows['gr-steam250-row'].innerHTML).toContain('https://club.steam250.com/app/730');
    expect(rows['gr-steam250-inline'].innerHTML).toContain('https://club.steam250.com/app/730');
    // v14.22.2：整行并入深链——锚点开标签先于排名文案、闭标签收尾（命中区 = 整行）
    const html = rows['gr-steam250-row'].innerHTML;
    const openIdx = html.indexOf('<a href="https://club.steam250.com/app/730"');
    expect(openIdx).toBeGreaterThanOrEqual(0);
    expect(openIdx).toBeLessThan(html.indexOf('🏆'));
    expect(html.lastIndexOf('</a>')).toBeGreaterThan(html.indexOf('条评价'));
  });

  it('未入榜（loaded）：整行深链提示行（250 名外扩展排名可看）', async () => {
    msgHandlers.GET_STEAM250_RANK = async () => ({ info: null, loaded: true });
    await fillSteam250Info('1091500');
    const html = rows['gr-steam250-row'].innerHTML;
    expect(html).toContain('未入 Steam250 前 250 名');
    expect(html).toContain('https://club.steam250.com/app/1091500');
    expect(html.indexOf('<a href=')).toBeLessThan(html.indexOf('🏆')); // 整行可点（v14.22.2）
  });

  it('快照不可用：保底可点榜单链接行，不再整行隐藏（v14.22.2）', async () => {
    msgHandlers.GET_STEAM250_RANK = async () => ({ info: null });
    await fillSteam250Info('730');
    const html = rows['gr-steam250-row'].innerHTML;
    expect(html).toContain('Steam250 榜单');
    expect(html).toContain('https://club.steam250.com/app/730');
    expect(rows['gr-steam250-row'].style.display).toEqual('');
    expect(rows['gr-steam250-inline'].style.display).toEqual('');
  });

  it('消息失败：渲染保底榜单链接行，不再整行静默（v14.28.12 B2-F6）；无 appId 早退不触行', async () => {
    msgHandlers.GET_STEAM250_RANK = async () => {
      throw new Error('boom');
    };
    await expect(fillSteam250Info('730')).resolves.toBeUndefined();
    const html = rows['gr-steam250-row'].innerHTML;
    expect(html).toContain('Steam250 榜单');
    expect(html).toContain('https://club.steam250.com/app/730');
    expect(rows['gr-steam250-row'].style.display).toEqual('');
    expect(rows['gr-steam250-inline'].style.display).toEqual('');
    await fillSteam250Info('');
    expect(rows['gr-steam250-inline'].innerHTML).toEqual(html); // 无 appId 早退未重写
  });
});

// ============ v14.28.12（B-2 审计 B2-F3）：ITAD reason 三态化 ============
describe('fillItadAndFavorites：reason 保底行（四态不再同形隐藏）', () => {
  it("reason:'no-key' → 灰色「未配置 API Key」行 + 保底链接", async () => {
    msgHandlers.GET_ITAD_LOWEST = async () => ({ info: null, reason: 'no-key' });
    msgHandlers.GET_FAVORITES = async () => ({ favorites: {} });
    await fillItadAndFavorites('730', 'CS2', '');
    expect(rows['gr-itad-row'].style.display).toEqual('');
    expect(rows['gr-itad-row'].innerHTML).toContain('未配置 API Key');
    expect(rows['gr-itad-row'].innerHTML).toContain('isthereanydeal.com');
  });

  it("reason:'network' → 灰色「网络暂不可用」行", async () => {
    msgHandlers.GET_ITAD_LOWEST = async () => ({ info: null, reason: 'network' });
    msgHandlers.GET_FAVORITES = async () => ({ favorites: {} });
    await fillItadAndFavorites('730', 'CS2', '');
    expect(rows['gr-itad-row'].style.display).toEqual('');
    expect(rows['gr-itad-row'].innerHTML).toContain('网络暂不可用');
  });

  it('无 reason（旧后台形状兼容）→ 仍整行隐藏', async () => {
    msgHandlers.GET_ITAD_LOWEST = async () => ({ info: null });
    msgHandlers.GET_FAVORITES = async () => ({ favorites: {} });
    await fillItadAndFavorites('730', 'CS2', '');
    expect(rows['gr-itad-row'].style.display).toEqual('none');
  });
});
