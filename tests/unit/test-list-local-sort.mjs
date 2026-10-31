/**
 * 游戏雷达 Game Radar - 列表页本地排序回归单测
 *
 * v14.0.0 P2-4 回归：applyLocalSort('none') 此前掉入"更新日期"排序分支
 * （取消排序行为错误）；现按 domOrder 基线恢复原始顺序——含收尾自动排序
 * （enableSortByRating）先于手动排序时基线不被破坏的场景。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// list-state 的四个依赖全部桩化（避免加载 content 侧 DOM/chrome 依赖链）
vi.mock('../../content/list/badges/core.js', () => ({
  removeItemFromDom: vi.fn(),
  removeWorkingBadge: vi.fn(),
  prependBadge: vi.fn()
}));
vi.mock('../../content/adapters/builder.js', () => ({
  getAdapterKey: vi.fn(() => null),
  getAdapter: vi.fn(() => ({ name: 'test' }))
}));
vi.mock('../../content/core/status-bar.js', () => ({
  showStats: vi.fn()
}));
vi.mock('../../content/core/debug.js', () => ({
  dbg: vi.fn()
}));

import { applyLocalSort, finishRatings, _state, formatQueueStatusText } from '../../content/list/list-state.js';

// 最小父容器模拟：appendChild 从旧父摘除后追加到末尾（真实 DOM 语义）
function makeParent() {
  const children = [];
  const parent = {
    children,
    appendChild(el) {
      // 真实 DOM appendChild 是移动语义：先从原父（含自身）摘除再追加
      if (el.parentNode) {
        const arr = el.parentNode.children;
        const i = arr.indexOf(el);
        if (i >= 0) arr.splice(i, 1);
      }
      el.parentNode = parent;
      children.push(el);
    }
  };
  return parent;
}

function makeItem(name, parent) {
  const element = { name, parentNode: parent };
  parent.children.push(element);
  return { name, element };
}

const order = (parent) => parent.children.map((el) => el.name);

function makeJob(parent, items, ratingMap, settings = {}) {
  return {
    processItems: items,
    settings,
    uniqueNames: items.map((i) => i.name),
    ratingMap,
    ratingsByName: {},
    container: parent,
    processed: new Set(items.map((i) => i.name)),
    shown: items.length,
    filtered: 0,
    filteredNames: [],
    notFoundNames: [],
    urlEntries: [],
    finished: false,
    domOrder: null,
    forceTimer: null
  };
}

beforeEach(() => {
  _state.ratingsJob = null;
  _state.batchState = null;
});

describe('applyLocalSort（本地排序 / 恢复原序）', () => {
  it("sort 'none' 恢复原始顺序（此前错误地按更新日期重排）", () => {
    const parent = makeParent();
    const items = ['a', 'b', 'c', 'd'].map((n) => makeItem(n, parent));
    _state.ratingsJob = makeJob(parent, items, { a: 90, b: 10, c: 50 });
    _state.batchState = {};

    expect(applyLocalSort('rating')).toBe(4);
    expect(order(parent)).toEqual(['a', 'c', 'b', 'd']); // 无评分的 d 沉底

    expect(applyLocalSort('none')).toBe(4);
    expect(order(parent)).toEqual(['a', 'b', 'c', 'd']); // 回到提取序
  });

  it("sort 'update' 仍按更新日期排序（不受 'none' 修复影响）", () => {
    const parent = makeParent();
    const items = ['a', 'b'].map((n) => makeItem(n, parent));
    const job = makeJob(parent, items, {});
    job.ratingsByName = {
      a: { lastUpdate: '2024-01-01' },
      b: { lastUpdate: '2025-06-01' }
    };
    _state.ratingsJob = job;
    _state.batchState = {};

    expect(applyLocalSort('update')).toBe(2);
    expect(order(parent)).toEqual(['b', 'a']);
  });

  it("未排序先点 'none'：当前序即基线（幂等不动）", () => {
    const parent = makeParent();
    const items = ['a', 'b', 'c'].map((n) => makeItem(n, parent));
    _state.ratingsJob = makeJob(parent, items, {});
    _state.batchState = {};

    expect(applyLocalSort('none')).toBe(3);
    expect(order(parent)).toEqual(['a', 'b', 'c']);
  });

  it('收尾自动排序不破坏基线：自动排序后 "none" 仍回到原始顺序', () => {
    const parent = makeParent();
    const items = ['a', 'b', 'c'].map((n) => makeItem(n, parent));
    _state.ratingsJob = makeJob(parent, items, { a: 95, b: 88, c: 40 }, { enableSortByRating: true });
    _state.batchState = {};

    finishRatings(); // 自动按好评率降序 → [a, b, c] 恰与原始一致，再造差异
    _state.ratingsJob.ratingMap = { a: 40, b: 88, c: 95 };
    applyLocalSort('rating'); // 手动排序 → [c, b, a]
    expect(order(parent)).toEqual(['c', 'b', 'a']);

    applyLocalSort('none');
    expect(order(parent)).toEqual(['a', 'b', 'c']); // 原始提取序，而非自动排序序
  });

  it('无任务/批次状态时返回 0（不抛错）', () => {
    expect(applyLocalSort('none')).toBe(0);
    _state.ratingsJob = makeJob(makeParent(), [], {});
    expect(applyLocalSort('none')).toBe(0);
  });
});

// ============ v14.8.1：等待徽章可见队列信息格式化（用户反馈改进） ============
describe('formatQueueStatusText（等待徽章实时队列信息）', () => {
  it('全局队列快照优先：running 任务进度 + 排队数', () => {
    const qs = { running: true, pending: 2, current: { tabId: 1, total: 60, done: 12 }, degraded: false };
    expect(formatQueueStatusText(null, qs)).toBe('⏳ 检索中 12/60 · 排队 2');
  });

  it('无全局快照时回落推送进度（done 钳到 total）', () => {
    expect(formatQueueStatusText({ done: 70, total: 60, degraded: false }, null)).toBe('⏳ 检索中 60/60');
  });

  it('推送携带 position（链忙入队即时推送）→ 排队中·前方 N 项', () => {
    expect(formatQueueStatusText({ done: 0, total: 4, degraded: false, position: 3 }, null)).toBe(
      '⏳ 检索中 0/4 · 排队中·前方 3 项'
    );
  });

  it('限流降速标记（qs 或 prog 任一携带即显示）', () => {
    const qs = { running: true, pending: 0, current: { tabId: 1, total: 60, done: 5 }, degraded: true };
    expect(formatQueueStatusText(null, qs)).toBe('⏳ 检索中 5/60 · 限流降速');
    expect(
      formatQueueStatusText(
        { done: 1, total: 4, degraded: true },
        { running: false, pending: 0, current: null, degraded: false }
      )
    ).toBe('⏳ 检索中 1/4 · 限流降速');
  });

  it('两者皆缺/空 → 回落静态"等待检索"', () => {
    expect(formatQueueStatusText(null, null)).toBe('⏳ 等待检索');
    expect(
      formatQueueStatusText(
        { done: 0, total: 0, degraded: false },
        { running: false, pending: 0, current: null, degraded: false }
      )
    ).toBe('⏳ 等待检索');
  });

  it('degraded + 排队组合齐全', () => {
    const qs = { running: true, pending: 1, current: { tabId: 2, total: 130, done: 0 }, degraded: true };
    expect(formatQueueStatusText({ done: 0, total: 60, degraded: false, position: 0 }, qs)).toBe(
      '⏳ 检索中 0/130 · 排队 1 · 限流降速'
    );
  });
});
