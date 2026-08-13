import { test, expect } from 'vitest';
/**
 * Game Recommender - 测试：内容脚本模拟 / Content Script Simulation
 *
 * 在 Node 中模拟浏览器环境（window/document/chrome），按 manifest 顺序加载
 * 全部内容脚本，验证：
 *   1. document_start 注入 + 顶层预热（warmup）执行无异常；
 *   2. 列表页两波好评率流程：缓存命中即时徽章 → 后台推送更新未命中；
 *   3. waitForListItems：AJAX 延迟渲染页面等待列表项出现。
 * Simulates the browser environment in Node, loads all content scripts in
 * manifest order and verifies: warm-up at document_start, the two-wave rating
 * flow (instant cache hits → push updates for misses), and AJAX list waiting.
 */
'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ============ Fake DOM / Fake DOM ============
class FakeEl {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this._text = '';
    this._html = '';
    this._attrs = {};
    this.classList = {
      add() {},
      contains() {
        return false;
      }
    };
  }
  get textContent() {
    return this._text;
  }
  set textContent(v) {
    this._text = String(v);
    this._html = String(v);
  }
  get innerHTML() {
    return this._html;
  }
  set innerHTML(v) {
    this._html = String(v);
  }
  getAttribute(n) {
    return this._attrs[n];
  }
  setAttribute(n, v) {
    this._attrs[n] = String(v);
  }
  get href() {
    return this._attrs['href'];
  }
  set href(v) {
    this._attrs['href'] = String(v);
  }
  get src() {
    return this._attrs['src'];
  }
  set src(v) {
    this._attrs['src'] = String(v);
  }
  appendChild(c) {
    if (c.parentNode) c.parentNode._removeChildFrom(c);
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  _removeChildFrom(c) {
    this.children = this.children.filter((x) => x !== c);
  }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode._removeChildFrom(c);
    c.parentNode = this;
    if (ref) {
      const idx = this.children.indexOf(ref);
      if (idx >= 0) this.children.splice(idx, 0, c);
      else this.children.push(c);
    } else {
      this.children.push(c);
    }
    return c;
  }
  get nextSibling() {
    if (!this.parentNode) return null;
    const idx = this.parentNode.children.indexOf(this);
    return idx >= 0 && idx < this.parentNode.children.length - 1 ? this.parentNode.children[idx + 1] : null;
  }
  get firstChild() {
    return this.children.length ? this.children[0] : null;
  }
  remove() {
    if (this.parentNode) {
      this.parentNode._removeChildFrom(this);
      this.parentNode = null;
    }
  }
  removeChild(c) {
    this._removeChildFrom(c);
    c.parentNode = null;
    return c;
  }
  // 向上查找祖先匹配（v3.4.1：原实现恒返回 this，掩盖真实 closest 行为）
  // Walk up the ancestor chain like the real API (was: always returns this)
  closest(sel) {
    let el = this;
    while (el) {
      if (el._matchesSel(sel)) return el;
      el = el.parentNode;
    }
    return null;
  }
  _matchesSel(sel) {
    const parts = String(sel)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.some((p) => {
      if (p.startsWith('.')) {
        return (this._attrs['class'] || this.className || '').split(/\s+/).includes(p.slice(1));
      }
      if (p.startsWith('[')) {
        const m = p.match(/^\[([\w-]+)(?:[^=\]]*)?\]/);
        return !!m && this._attrs[m[1]] !== undefined;
      }
      return this.tagName === p.toUpperCase();
    });
  }
  // 简化的选择器支持：a.tit / .class（含 className 属性匹配）/ 标签名
  querySelector(sel) {
    if (sel === 'a.tit')
      return this.children.find((c) => c.tagName === 'A' && (c._attrs['class'] || '').includes('tit')) || null;
    if (sel.startsWith('.')) {
      const cls = sel.slice(1).split(',')[0].trim();
      return (
        this.children.find(
          (c) => (c._attrs['class'] || '').split(/\s+/).includes(cls) || (c.className || '').split(/\s+/).includes(cls)
        ) || null
      );
    }
    return this.children.find((c) => c.tagName === sel.toUpperCase()) || null;
  }
  querySelectorAll(sel) {
    if (sel === 'img') return this._imgs || [];
    return [];
  }
  addEventListener(type, cb) {
    (this._listeners = this._listeners || {})[type] = this._listeners[type] || [];
    this._listeners[type].push(cb);
  }
  click() {
    const cbs = (this._listeners && this._listeners['click']) || [];
    cbs.forEach((cb) => cb({ preventDefault() {}, stopPropagation() {} }));
  }
}

// document 模拟：querySelectorAll 可插桩（列表页场景）/ stubbable querySelectorAll
let queryAllStub = null;
let queryOneStub = null;
const docReadyCallbacks = [];

const documentMock = {
  readyState: 'loading',
  body: new FakeEl('body'),
  head: new FakeEl('head'),
  title: '测试页面',
  createElement: (tag) => new FakeEl(tag),
  getElementById: () => null,
  querySelectorAll: (sel) => (queryAllStub ? queryAllStub(sel) : []),
  querySelector: (sel) => (queryOneStub ? queryOneStub(sel) : null),
  addEventListener: (type, cb) => {
    if (type === 'DOMContentLoaded') docReadyCallbacks.push(cb);
  },
  createTreeWalker: () => ({ nextNode: () => null }),
  createTextNode: (t) => ({ textContent: t, nodeType: 3 }),
  createDocumentFragment: () => new FakeEl('fragment')
};
globalThis.NodeFilter = { SHOW_TEXT: 4 };
globalThis.window = globalThis;
// v6.3.0：模拟浏览器 window.open（download-tracking 拦截链需要原始实现转发）
globalThis.window.open = () => null;
globalThis.location = { hostname: 'www.xianyudanji.gg', pathname: '/pcdj', href: 'https://www.xianyudanji.gg/pcdj' };
globalThis.document = documentMock;
globalThis.addEventListener = (type, cb) => documentMock.addEventListener(type, cb);
globalThis.MutationObserver = class {
  constructor(cb) {
    this.cb = cb;
    MutationObserver.instances.push(this);
  }
  observe() {}
  disconnect() {}
};
MutationObserver.instances = [];
// v4.0.0：IntersectionObserver mock（滚动调度；测试通过 fireSentinel() 触发）
globalThis.IntersectionObserver = class {
  constructor(cb) {
    this.cb = cb;
    IntersectionObserver.instances.push(this);
  }
  observe() {}
  disconnect() {}
  unobserve() {}
  fire() {
    this.cb([{ isIntersecting: true }], this);
  }
};
IntersectionObserver.instances = [];

const DEFAULT_SETTINGS = {
  enabled: true,
  enableVmFilter: false,
  enableRatingFilter: false,
  minSteamRatingFilter: 0,
  showStatusBar: true,
  showDebugPanel: false,
  trackedSites: [],
  steamSiteSearch: [],
  highlightThreshold: 0.6,
  badgeVisibility: { recent: true, all: true, update: true, rec: true }
};

// ============ Fake chrome API（预设按 action 分发）/ fake chrome with presets ============
let msgListener = null;
const presets = {}; // action → 响应函数（每次调用都生效）/ response factory per action
const sentMessages = [];
globalThis.chrome = {
  runtime: {
    sendMessage: async (msg) => {
      sentMessages.push(msg);
      if (presets[msg.action]) return presets[msg.action](msg);
      if (msg.action === 'GET_SETTINGS') return { settings: DEFAULT_SETTINGS };
      if (msg.action === 'GET_RECOMMENDATIONS') return { results: [] };
      return { success: true };
    },
    onMessage: {
      addListener: (cb) => {
        msgListener = cb;
      }
    },
    getManifest: () => ({ version: '2.1.3' })
  },
  storage: {
    local: { get: async () => ({ adapterRules: null }) }
  },
  tabs: { sendMessage: async () => ({}) }
};

// 简化站点规则（模拟咸鱼单机）/ simplified site rule
const SITE_RULES = [
  {
    key: 'xianyudanji',
    name: '咸鱼单机',
    domains: ['xianyudanji.gg'],
    imageAppId: true,
    listPage: { urlPatterns: ['/pcdj'] },
    detailUrlPatterns: ['\\/\\d+\\.html?$'],
    listItem: { containers: ['li.game-item'], titleLink: 'a.tit', minLen: 2, maxLen: 200 }
  }
];
globalThis.__GAME_RECOMMENDER_SITES__ = { version: 1, sites: SITE_RULES };

// ============ 按 manifest 顺序加载内容脚本 / Load content scripts in order ============
// v6.0.0：内容脚本 ESM 化——经典入口 tracker.js eval + 模块动态 import
// v6.2.0：SCRIPT_FILES 含 shared×2（与 manifest 注入顺序一致）——
// __GR_PATTERNS__/escapeHtml 权威源真实注入，content 侧不再走降级副本
const SCRIPT_FILES = ['shared/patterns.js', 'shared/escape.js', 'content/tracker.js'];
// 模块加载（动态 import + GR shim 兼容层；固定 ?t= 与 tracker 的 getURL 共享实例）
let MODULE_T = Date.now();
const MODULE_FILES = [
  'content/core/common.js', 'content/core/floats.js', 'content/core/status-bar.js',
  'content/core/debug.js', 'content/adapters/builder.js', 'content/list/badges.js',
  'content/list/list-batch.js', 'content/list/list-page.js',
  'content/detail/detail-templates.js', 'content/detail/detail-page.js',
  'content/tracking/download-tracking.js'
];
const MODULE_KEYS = ['common', 'float', 'status', 'debug', 'builder', 'badges', 'listBatch', 'list', 'detailTemplates', 'detail', 'tracking'];

async function loadModules() {
  // getURL mock：映射 content/... → file:// URL + ?t=（与 tracker 共享模块实例）
  globalThis.chrome.runtime.getURL = (path) =>
    new URL('../../' + path, import.meta.url).href;
  const mods = await Promise.all(MODULE_FILES.map((f) => import(new URL('../../' + f, import.meta.url).href)));
  // GR shim：模块句柄挂回 __GR__（测试体 GR.x.y 引用零改动）
  const GR = (globalThis.__GR__ = globalThis.__GR__ || {});
  MODULE_KEYS.forEach((k, i) => { GR[k] = mods[i]; });
  return GR;
}

// 重载内容脚本（模拟页面重载：新模块实例 + 重置 tracker 守卫）
// v6.2.0：__grImport 注入——eval 的 tracker.js 内变量动态 import() 在
// vite-node 的 vm 执行器无 import 回调（ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING），
// 字符串替换为全局 provider（真实 import 由本文件转换域承担）后兼容 vitest
async function reloadContentScripts() {
  docReadyCallbacks.length = 0;
  globalThis.__gameRecommenderTracker = false;
  // v6.0.0：vitest 环境下重置模块缓存实现重载；node 直跑复用实例（DOM 共享）
  if (typeof vi !== 'undefined') vi.resetModules();
  await loadModules();
  for (const f of SCRIPT_FILES) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf-8');
    evalWithGrImport(code);
  }
}

// import provider：eval 代码里的 import( → __grImport(（vitest 兼容层）
globalThis.__grImport = (spec) => import(spec);
function evalWithGrImport(code) {
  return (0, eval)(code.replace(/\bimport\(/g, '__grImport('));
}

let GR = null; // 节 1 赋值，后续节共享（文件级 let + test 顺序执行）

// v6.3.2：固定延时在全量并发下偶发不足（推送/批次异步链竞争）——
// 轮询等待条件（最多 2s）替代固定延时，根治偶发
async function waitFor(fn, timeoutMs = 2000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return fn();
}

// 构建列表页 DOM 项（Fake DOM）/ build a list item
// v6.2.0：makeItem 提升至文件级（节 2/2b/6/7/8b 共享）
function makeItem(name, id) {
  const li = new FakeEl('li');
  li._attrs['class'] = 'game-item';
  const a = new FakeEl('a');
  a._attrs['href'] = `https://www.xianyudanji.gg/${id}.html`;
  a._attrs['class'] = 'tit';
  a._text = name;
  li.appendChild(a);
  return { li, a };
}
// v6.2.0：跨节共享 DOM 变量/函数提升至文件级（节 2 赋值，节 3/6/8b 读取）
let itemA = null, itemB = null, itemC = null, allItems = null;
function isAllBadge(c) {
  return c.className.includes('gr-rating-badge') && !c.className.includes('gr-recent') && !c.className.includes('gr-update');
}

test('1. 顶层加载与预热', async () => {
console.log('1. 顶层加载与预热');
let loadError = null;
try {
  await loadModules();
  for (const f of SCRIPT_FILES) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf-8');
    evalWithGrImport(code);
  }
} catch (e) {
  loadError = e;
}
expect(loadError ? loadError.message : null).toEqual(null);

GR = globalThis.__GR__;
expect(MODULE_KEYS.filter((k) => GR && GR[k]).length).toEqual(MODULE_KEYS.length);;
// v6.2.0：等待 tracker warmup（bootPromise）完成——全量并发下监听器注册与
// 模块就绪存在竞争，固定短延时偶发不足导致推送丢失（单跑通过、全量偶发）
await new Promise((r) => setTimeout(r, 150));

// ============ 2. 列表页两波流程 / Two-wave rating flow ============
});

test('2. 列表页两波好评率流程', async () => {
console.log('2. 列表页两波好评率流程');

// 构建列表页 DOM：3 个游戏项 / build a 3-item list page
itemA = makeItem('游戏A', 1);
itemB = makeItem('游戏B', 2);
itemC = makeItem('游戏C', 3);
allItems = [itemA, itemB, itemC];
queryAllStub = (sel) => {
  if (sel === 'li.game-item') return allItems.map((x) => x.li);
  return [];
};
queryOneStub = () => null;

// 第一波：游戏A 缓存命中，B/C 未命中（后台分批拉取中）
presets['GET_STEAM_RATINGS'] = (msg) => {
  if (msg.cacheOnly) return { ratings: {}, pending: 0 }; // 兜底重查：无新命中
  return { ratings: { 游戏A: { appId: '111', positiveRate: 95, ratingDesc: '特别好评' } }, pending: 2 };
};

// 推荐计算：游戏A 高分、游戏B/C 中低分（含 breakdown 供悬停展示）。
// v4.1.0：后台回包携带 name（按名回填，替代 index 对齐）
presets['GET_RECOMMENDATIONS'] = (msg) => ({
  results: (msg.games || []).map((g) => ({
    name: g.name,
    recommendation:
      g.name === '游戏A'
        ? { score: 0.85, breakdown: { clickScore: 0.9, downloadScore: 0.8, keywordMatch: 0.7, steamRating: 0.9 } }
        : { score: 0.4, breakdown: { clickScore: 0.5, downloadScore: 0.3, keywordMatch: 0.4, steamRating: 0.4 } }
  }))
});

// 触发 DOMContentLoaded → init（warmup 已 resolve）
docReadyCallbacks.forEach((cb) => cb());
await waitFor(() => itemA.a.children.length > 0);

expect(itemA.a.children.some((c) => c.className.includes('gr-rating-badge'))).toEqual(true);;
expect(itemB.a.children.some((c) => c.className.includes('gr-rating-badge')) ||
    itemC.a.children.some((c) => c.className.includes('gr-rating-badge'))).toEqual(false);;

// 推荐值徽章（GET_RECOMMENDATIONS 响应后插入，好评率徽章之后）
await new Promise((r) => setTimeout(r, 100));
// v3.3.6 三段式徽章：近30天 → 全部 → 最近更新（游戏A 无 recent/lastUpdate 数据）
expect(itemA.a.children.length).toEqual(4);
expect(itemA.a.children[0].className.includes('gr-recent-badge') && itemA.a.children[0].textContent === '—').toEqual(true);;
expect(itemA.a.children[1].className.includes('gr-rating-badge') && itemA.a.children[1].textContent === '95%').toEqual(true);;
expect(itemA.a.children[2].className.includes('gr-update-badge') && itemA.a.children[2].textContent === '—').toEqual(true);;
expect(itemA.a.children[3].className.includes('gr-rec-badge')).toEqual(true);
expect(itemA.a.children[3].textContent).toEqual('🎯 85%');
expect(itemA.a.children[3].title.includes('点击率') &&
    itemA.a.children[3].title.includes('下载率') &&
    itemA.a.children[3].title.includes('Steam')).toEqual(true);;

// 后台推送第 1 波增量：游戏B 拉取完成（含近30天/最近更新数据） / background push wave 1
await msgListener(
  {
    action: 'STEAM_RATINGS_UPDATE',
    ratings: {
      游戏B: {
        appId: '222',
        positiveRate: 60,
        ratingDesc: '多半好评',
        totalReviews: 500,
        recentPositiveRate: 55,
        recentTotalReviews: 120,
        lastUpdate: '2026-08-01',
        releaseDate: '2025-03-30'
      }
    }
  },
  {},
  () => {}
);
// v6.0.0：推送处理可能经 bootPromise 微任务（模块未就绪兜底）
// v6.3.2：固定延时偶发不足 → 轮询等待徽章出现
await waitFor(() => itemB.a.children.some((c) => c.className.includes('gr-rating-badge')));

expect(itemB.a.children.some((c) => c.className.includes('gr-rating-badge'))).toEqual(true);;
expect(itemC.a.children.some((c) => c.className.includes('gr-rating-badge'))).toEqual(false);;
// v3.3.6：游戏B 三段徽章（近30天 55% / 全部 60% / 更新 08-01）
expect(itemB.a.children[0].className.includes('gr-recent-badge') && itemB.a.children[0].textContent === '55%').toEqual(true);;
expect(itemB.a.children[0].title.includes('55%') && itemB.a.children[0].title.includes('120')).toEqual(true);;
expect(itemB.a.children[1].className.includes('gr-rating-badge') && itemB.a.children[1].textContent === '60%').toEqual(true);;
expect(itemB.a.children[2].className.includes('gr-update-badge') && itemB.a.children[2].textContent === '🛠 08-01').toEqual(true);;
expect(itemB.a.children[2].title.includes('2026-08-01') && itemB.a.children[2].title.includes('2025-03-30')).toEqual(true);;

// 后台推送第 2 波增量：游戏C 为合集（bundle，无法解析本体）→ type 徽章 + done 收尾
await msgListener(
  {
    action: 'STEAM_RATINGS_UPDATE',
    ratings: { 游戏C: { positiveRate: null, appId: '333', name: '游戏C', type: 'bundle' } },
    done: true
  },
  {},
  () => {}
);

expect(itemC.a.children.some((c) => c.className.includes('gr-type-badge'))).toEqual(true);;
expect(itemC.a.children[0].className ? itemC.a.children[0].className.includes('gr-type-badge') : false).toEqual(true);;
expect(itemC.a.children.find((c) => c.className.includes('gr-type-badge')).textContent).toEqual('bundle');;
const barEl = documentMock.body.children.find((c) => c.id === 'gr-status-bar');
expect(barEl ? barEl.innerHTML.includes('Steam 好评率获取完成') : false).toEqual(true);
const batchMsg = sentMessages.find((m) => m.action === 'RECORD_DOWNLOAD_URLS_BATCH');
expect(batchMsg ? batchMsg.data.entries.length : 0).toEqual(2);

// ============ 2b. 批次调度（v4.0.0）/ Batch scheduling ============
});

test('2b. 批次调度（首屏 60 + 滚动衔接）', async () => {
console.log('2b. 批次调度（首屏 60 + 滚动衔接）');
// 100 个游戏项：首批只应请求 60 个，缓存全命中（pending=0）时自动衔接第二批 40 个
const manyItems = [];
for (let i = 1; i <= 100; i++) {
  const { li, a } = makeItem(`游戏${i}`, i);
  manyItems.push({ element: li, link: a, name: `游戏${i}`, url: `https://www.xianyudanji.gg/${i}.html`, titleEl: a });
}
const batchPreset = presets['GET_STEAM_RATINGS'];
const batchRequests = [];
presets['GET_STEAM_RATINGS'] = (msg) => {
  batchRequests.push((msg.names || []).slice());
  const ratings = {};
  (msg.names || []).forEach((n) => {
    ratings[n] = { appId: '999', positiveRate: 90 };
  });
  return { ratings, pending: 0 }; // 全部缓存命中 → 无推送，自动衔接下一批
};
GR.listBatch.requestSteamRatings(manyItems, DEFAULT_SETTINGS);
await waitFor(() => batchRequests.length >= 2); // 首批 60 + 全命中自动衔接第二批 40
expect(batchRequests[0] ? batchRequests[0].length : 0).toEqual(60);
expect(batchRequests[1] ? batchRequests[1].length : 0).toEqual(40);
expect((() => {
    if (batchRequests.length < 2) return false;
    const all = [...batchRequests[0], ...batchRequests[1]];
    return new Set(all).size === all.length && all.length === 100;
  })()).toEqual(true);;
const doneBar = documentMock.body.children.find((c) => c.id === 'gr-status-bar');
expect(doneBar ? doneBar.innerHTML.includes('Steam 好评率获取完成') : false).toEqual(true);

// done 衔接场景：首批部分未命中（pending>0）→ 等后台 done → 衔接第二批
const batchRequests2 = [];
presets['GET_STEAM_RATINGS'] = (msg) => {
  batchRequests2.push((msg.names || []).slice());
  const ratings = {};
  (msg.names || []).slice(0, 10).forEach((n) => {
    ratings[n] = { appId: '888', positiveRate: 80 };
  });
  return { ratings, pending: msg.names.length - 10 };
};
GR.listBatch.requestSteamRatings(manyItems, DEFAULT_SETTINGS);
await new Promise((r) => setTimeout(r, 100));
expect(batchRequests2.length).toEqual(1);
// 后台完成 → 推送 done → 应自动发起第二批
await msgListener({ action: 'STEAM_RATINGS_UPDATE', ratings: null, done: true }, {}, () => {});
await waitFor(() => batchRequests2.length >= 2);
expect(batchRequests2[1] ? batchRequests2[1].length : 0).toEqual(40);
presets['GET_STEAM_RATINGS'] = batchPreset;

// ============ 3. waitForListItems：AJAX 延迟渲染 / AJAX list wait ============
});

test('3. waitForListItems（AJAX 延迟渲染）', async () => {
console.log('3. waitForListItems（AJAX 延迟渲染）');
queryAllStub = () => []; // 初始列表为空
const waitPromise = GR.list.waitForListItems(GR.builder.getAdapter(), 4000);
// 模拟 250ms 后 DOM 渲染出列表项 / simulate the DOM rendering items after 250ms
setTimeout(() => {
  queryAllStub = (sel) => (sel === 'li.game-item' ? allItems.map((x) => x.li) : []);
}, 250);
setTimeout(() => {
  if (MutationObserver.instances.length) MutationObserver.instances[MutationObserver.instances.length - 1].cb();
}, 260);
const waitedItems = await waitPromise;
expect(waitedItems.length).toEqual(3);

// ============ 4. 调试视图关闭后不自动复活 / Debug view dismissal ============
});

test('4. 调试视图关闭后不自动复活', async () => {
console.log('4. 调试视图关闭后不自动复活');
GR.status.setDebugMode(true);
GR.status.showDebugView('<div>test debug</div>');
const dbgRoot = documentMock.body.children.find((c) => c.id === 'gr-status-bar');
expect(!!dbgRoot && !!dbgRoot.children[0]).toEqual(true);
// 模拟用户点击标题栏 ✕ 关闭
dbgRoot.children[0].children[2].click();
expect(documentMock.body.children.some((c) => c.id === 'gr-status-bar')).toEqual(false);;
// 关闭后 dbg 日志触发防抖刷新，不应复活浮窗
GR.debug.dbg('关闭后的测试日志');
await new Promise((r) => setTimeout(r, 350));
expect(documentMock.body.children.some((c) => c.id === 'gr-status-bar')).toEqual(false);;
// 重新开启调试模式 → 允许再次显示
GR.status.setDebugMode(true);
GR.status.showDebugView('<div>again</div>');
expect(documentMock.body.children.some((c) => c.id === 'gr-status-bar')).toEqual(true);;
GR.float.closeAll();

// ============ 5. lazyload 封面 appId 直取（v3.2.1：gamer520 114933） ============
});

test('5. lazyload 封面 appId 直取（data-src 优先）', async () => {
console.log('5. lazyload 封面 appId 直取（data-src 优先）');
const lazyScope = new FakeEl('div');
const lazyImg = new FakeEl('img');
lazyImg._attrs['src'] = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='; // 占位图
lazyImg._attrs['data-src'] =
  'https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/1297900/c68d4/capsule_616x353.jpg';
lazyScope._imgs = [lazyImg];
const lazyInfo = GR.builder.extractSteamImageInfo(lazyScope);
expect(lazyInfo ? lazyInfo.appId : null).toEqual('1297900');
expect(lazyInfo ? lazyInfo.cover.includes('1297900') : false).toEqual(true);
// 无 data-src 时回退 src
const plainImg = new FakeEl('img');
plainImg._attrs['src'] = 'https://cdn.akamai.steamstatic.com/steam/apps/111/header.jpg';
const plainScope = new FakeEl('div');
plainScope._imgs = [plainImg];
const plainInfo = GR.builder.extractSteamImageInfo(plainScope);
expect(plainInfo ? plainInfo.appId : null).toEqual('111');
// data-original（xdgame jQuery lazy，v3.2.5）
const xdImg = new FakeEl('img');
xdImg._attrs['src'] = '/images/defaultpic.gif';
xdImg._attrs['data-original'] =
  'https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/3613270/xxx/capsule_616x353.jpg';
const xdScope = new FakeEl('div');
xdScope._imgs = [xdImg];
const xdInfo = GR.builder.extractSteamImageInfo(xdScope);
expect(xdInfo ? xdInfo.appId : null).toEqual('3613270');

// ============ 6. 汇总贴过滤（v3.2.3：gamer520 56286 置顶汇总贴） ============
});

test('6. 汇总贴/索引贴过滤', async () => {
console.log('6. 汇总贴/索引贴过滤');
const pinItem = makeItem('[顶置]PC近期爆火游戏 汇总贴', 56286);
queryAllStub = (sel) => {
  if (sel === 'li.game-item') return [pinItem.li, itemA.li];
  return [];
};
const filteredItems = GR.builder.getAdapter().getListItems();
expect(filteredItems.some((i) => i.name.includes('汇总贴'))).toEqual(false);;
expect(filteredItems.some((i) => i.name === '游戏A')).toEqual(true);;
queryAllStub = (sel) => (sel === 'li.game-item' ? allItems.map((x) => x.li) : []);

// ============ 7. FORCE_REFRESH_PAGE（popup 强制刷新，v3.3.5） ============
});

test('7. FORCE_REFRESH_PAGE（popup 强制刷新）', async () => {
console.log('7. FORCE_REFRESH_PAGE（popup 强制刷新）');
let reloaded = false;
globalThis.location.reload = () => {
  reloaded = true;
};
let forceResp = null;
await msgListener({ action: 'FORCE_REFRESH_PAGE' }, {}, (r) => {
  forceResp = r;
});
await new Promise((r) => setTimeout(r, 100));
const clearMsg = sentMessages.find((m) => m.action === 'CLEAR_CACHE_FOR_PAGE');
expect(clearMsg ? clearMsg.names.length : 0).toEqual(3);
expect(clearMsg && clearMsg.names.includes('游戏A') && clearMsg.names.includes('游戏C')).toEqual(true);
expect(!!clearMsg).toEqual(true);
expect(forceResp ? forceResp.success : false).toEqual(true);
expect(reloaded).toEqual(true);

// ============ 8. 徽章开关与过滤/高亮联动（v3.3.8） ============
});

test('8. 徽章开关与过滤/高亮联动', async () => {
console.log('8. 徽章开关与过滤/高亮联动');
// 重新加载内容脚本（新 warmupPromise 读新设置；清空旧回调 + 清除 tracker 防重复守卫）
await reloadContentScripts();
const badgeSettings = {
  ...DEFAULT_SETTINGS,
  enableRatingFilter: true,
  minSteamRatingFilter: 70,
  badgeVisibility: { recent: false, all: true, update: true, rec: false }
};
presets['GET_SETTINGS'] = () => ({ settings: badgeSettings });
for (const f of SCRIPT_FILES) {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf-8');
  evalWithGrImport(code);
}
const itemE = makeItem('游戏E', 5);
queryAllStub = (sel) => (sel === 'li.game-item' ? [itemE.li] : []);
presets['GET_STEAM_RATINGS'] = (msg) => ({
  ratings: {
    游戏E: {
      appId: '555',
      positiveRate: 88,
      ratingDesc: '特别好评',
      totalReviews: 100,
      recentPositiveRate: 85,
      recentTotalReviews: 20,
      lastUpdate: '2026-08-01'
    }
  },
  pending: 0
});
presets['GET_RECOMMENDATIONS'] = (msg) => ({
  results: [
    {
      recommendation: {
        score: 0.85,
        breakdown: { clickScore: 0.9, downloadScore: 0.8, keywordMatch: 0.7, steamRating: 0.9 }
      }
    }
  ]
});
docReadyCallbacks.forEach((cb) => cb());
await new Promise((r) => setTimeout(r, 100));

expect(itemE.a.children.some((c) => c.className.includes('gr-recent-badge'))).toEqual(false);;
// isAllBadge 定义见文件级（v6.2.0 提升）
expect(itemE.a.children.some(isAllBadge)).toEqual(true);
expect(itemE.a.children.some((c) => c.className.includes('gr-update-badge'))).toEqual(true);;
expect(itemE.a.children.some((c) => c.className.includes('gr-rec-badge'))).toEqual(false);;
expect(itemE.li.classList.contains('gr-highlighted')).toEqual(false);
expect(itemE.a.children.some(isAllBadge)).toEqual(true);

// 8b：关闭"全部好评率"→ 好评率过滤停用（低好评率游戏不再被移除）
});

test('8b. 关全部好评率徽章 → 过滤停用', async () => {
console.log('8b. 关全部好评率徽章 → 过滤停用');
await reloadContentScripts();
const badgeSettings2 = {
  ...DEFAULT_SETTINGS,
  enableRatingFilter: true,
  minSteamRatingFilter: 70,
  badgeVisibility: { recent: true, all: false, update: true, rec: true }
};
presets['GET_SETTINGS'] = () => ({ settings: badgeSettings2 });
for (const f of SCRIPT_FILES) {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf-8');
  evalWithGrImport(code);
}
const itemF = makeItem('游戏F', 6);
documentMock.body.appendChild(itemF.li); // 模拟挂载（过滤会从 DOM 移除）
queryAllStub = (sel) => (sel === 'li.game-item' ? [itemF.li] : []);
presets['GET_STEAM_RATINGS'] = (msg) => ({
  ratings: {
    游戏F: {
      appId: '666',
      positiveRate: 50,
      ratingDesc: '褒贬不一',
      totalReviews: 100,
      recentPositiveRate: 40,
      recentTotalReviews: 10,
      lastUpdate: '2026-07-15'
    }
  },
  pending: 0
});
presets['GET_RECOMMENDATIONS'] = (msg) => ({
  results: [
    {
      name: '游戏F',
      recommendation: {
        score: 0.3,
        breakdown: { clickScore: 0.2, downloadScore: 0.1, keywordMatch: 0.3, steamRating: 0.4 }
      }
    }
  ]
});
docReadyCallbacks.forEach((cb) => cb());
await new Promise((r) => setTimeout(r, 100));

expect(itemF.a.children.some(isAllBadge)).toEqual(false);
expect(itemF.a.children.some((c) => c.className.includes('gr-recent-badge'))).toEqual(true);;
expect(documentMock.body.children.includes(itemF.li)).toEqual(true);
expect(itemF.a.children.some((c) => c.className.includes('gr-rec-badge'))).toEqual(true);;
expect((() => {
    const kids = itemF.a.children;
    const recIdx = kids.findIndex((c) => c.className.includes('gr-rec-badge'));
    const badgeIdx = kids.findIndex(
      (c) =>
        c.className.includes('gr-rating-badge') ||
        c.className.includes('gr-update-badge') ||
        c.className.includes('gr-recent-badge')
    );
    return recIdx > badgeIdx;
  })()).toEqual(true);;

// ============ 9. 详情页报错按钮（v3.3.11） ============
});

test('9. 详情页报错按钮（人工纠错重新检索）', async () => {
console.log('9. 详情页报错按钮（人工纠错重新检索）');
await reloadContentScripts();
presets['GET_SETTINGS'] = () => ({
  settings: { ...DEFAULT_SETTINGS, badgeVisibility: undefined, trackedSites: ['xianyudanji'] }
});
// 详情页 URL + 完整 Steam 数据 mock（域名用测试规则中的 xianyudanji）
globalThis.location = {
  hostname: 'www.xianyudanji.gg',
  pathname: '/16598.html',
  href: 'https://www.xianyudanji.gg/16598.html'
};
window.location = globalThis.location;
const h1El = new FakeEl('h1');
h1El._text = '北方之魂增强版/Spirit of the North- Switch520.com';
queryOneStub = (sel) => (sel === 'h1' || sel === '.entry-title' ? h1El : null);
queryAllStub = () => [];
const wrongData = {
  appId: '2001760',
  name: '轮回之兽',
  englishName: 'Beast of Reincarnation',
  positiveRate: 70,
  ratingDesc: '多半好评',
  totalReviews: 100,
  recentPositiveRate: 65,
  recentTotalReviews: 20,
  url: 'https://store.steampowered.com/app/2001760/',
  headerImage: 'https://cdn/h.jpg',
  genres: ['RPG'],
  userTags: ['RPG'],
  developers: ['Dev'],
  chineseSupported: true,
  releaseDate: '2024-01-01',
  description: 'x',
  steamspy: null,
  steamdb: null,
  type: 'game'
};
const correctData = {
  ...wrongData,
  appId: '1213700',
  name: '北方之魂',
  englishName: 'Spirit of the North',
  url: 'https://store.steampowered.com/app/1213700/'
};
let searchCalls = 0;
presets['SEARCH_STEAM'] = (msg) => {
  searchCalls++;
  return { data: searchCalls === 1 ? wrongData : correctData, cachedAt: Date.now() };
};
presets['GET_STEAM_BY_APPID'] = () => ({ data: null });
for (const f of SCRIPT_FILES) {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf-8');
  evalWithGrImport(code);
}
docReadyCallbacks.forEach((cb) => {
  try {
    cb();
  } catch (e) {
    console.log('⚠️ 第9节 init 抛错:', e.message);
  }
});
await new Promise((r) => setTimeout(r, 100));

// floats 结构：root(id) → [header, body(内容区)]；渲染 HTML 在 body.innerHTML
const steamRoot = documentMock.body.children.find((c) => c.id === 'gr-steam-float');
const steamBody = steamRoot ? steamRoot.children[1] : null;
const steamHtml = steamBody ? steamBody.innerHTML : '';
expect(!!steamRoot && steamHtml.length > 50).toEqual(true);
expect(steamHtml.includes('gr-report-issue-btn') && steamHtml.includes('信息有误')).toEqual(true);
expect(steamHtml.includes('gr-refresh-cache-btn')).toEqual(true);
expect(steamHtml.includes('2001760') || steamHtml.includes('轮回之兽')).toEqual(true);
// v3.4.1：原断言恒真（"由 E2E 验证"），改为源码级守护——报错按钮绑定 +
// REPORT_WRONG_APPID 消息流 + 手动选择面板兜底路径必须存在
const detailSrc = fs.readFileSync(path.join(ROOT, 'content/detail/detail-page.js'), 'utf-8');
expect(detailSrc.includes('#gr-report-issue-btn') && detailSrc.includes("action: 'REPORT_WRONG_APPID'")).toEqual(true);;
expect(detailSrc.includes('renderManualSelectPanel')).toEqual(true);
expect(searchCalls >= 1).toEqual(true);
// v3.4.2：demo 判定防误伤（源码级）——浮窗前端正则必须带词边界
// （\b），避免 Trials/Demons 等合法游戏名子串被误标为 Demo；后台 isDemo
// 以 appdetails type=demo 为权威信号，名称兜底同样带边界。
// v5.0.0：api.js 已拆分为 api-*.js 子块，聚合读取全部子块源码
// v5.1.0：detail 模板已拆至 detail-templates.js，聚合读取
const steamApiSrc =
  fs.readFileSync(path.join(ROOT, 'background/steam/api.js'), 'utf-8') +
  fs
    .readdirSync(path.join(ROOT, 'background/steam'))
    .filter((f) => /^api-.+\.js$/.test(f))
    .map((f) => fs.readFileSync(path.join(ROOT, 'background/steam', f), 'utf-8'))
    .join('\n');
const detailAllSrc = detailSrc + fs.readFileSync(path.join(ROOT, 'content/detail/detail-templates.js'), 'utf-8');
expect(detailAllSrc.includes('\\b(demo|trial)\\b')).toEqual(true);
expect(steamApiSrc.includes("gameData.type === 'demo'")).toEqual(true);


});

// ============ 10. 下载追踪 / Download tracking ============
console.log('10. 下载追踪（网盘识别 + window.open 拦截）');
test('10. 下载追踪（网盘识别 + window.open 拦截）', async () => {
  const { isDownloadUrl, isDownloadText } = GR.tracking;
  // 网盘/下载 URL 识别（纯函数）
  expect(isDownloadUrl('https://pan.baidu.com/s/abc')).toEqual(true);
  expect(isDownloadUrl('https://pan.xunlei.com/s/xyz')).toEqual(false);
  expect(isDownloadUrl('magnet:?xt=urn:btih:abc')).toEqual(true);
  expect(isDownloadUrl('https://www.example.com/game.html')).toEqual(false);
  expect(isDownloadUrl(null)).toEqual(false);
  // 下载相关文本识别
  expect(isDownloadText('百度网盘提取码')).toEqual(true);
  expect(isDownloadText('点击下载游戏')).toEqual(true);
  expect(isDownloadText('游戏介绍与截图')).toEqual(false);
  // window.open 拦截 → click_download 追踪（tracker init 已激活 setupDownloadTracking）
  const before = sentMessages.filter((m) => m.action === 'TRACK_EVENT' && m.data && m.data.type === 'click_download').length;
  window.open('https://pan.baidu.com/s/download123');
  await new Promise((r) => setTimeout(r, 100));
  const after = sentMessages.filter((m) => m.action === 'TRACK_EVENT' && m.data && m.data.type === 'click_download').length;
  expect(after > before).toEqual(true);
  const evt = sentMessages.filter((m) => m.action === 'TRACK_EVENT' && m.data && m.data.type === 'click_download').pop();
  expect(evt.data.downloadUrl.includes('pan.baidu.com')).toEqual(true);
  expect(!!evt.data.gameName).toEqual(true);
});

