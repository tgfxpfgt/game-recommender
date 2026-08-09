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

const ROOT = 'F:/data/browser extension/game-recommender';
let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name, '→ 实际:', JSON.stringify(actual), '期望:', JSON.stringify(expected)); }
}

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
    this.classList = { add() {}, contains() { return false; } };
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); this._html = String(v); }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); }
  getAttribute(n) { return this._attrs[n]; }
  setAttribute(n, v) { this._attrs[n] = String(v); }
  get href() { return this._attrs['href']; }
  set href(v) { this._attrs['href'] = String(v); }
  get src() { return this._attrs['src']; }
  set src(v) { this._attrs['src'] = String(v); }
  appendChild(c) { if (c.parentNode) c.parentNode._removeChildFrom(c); c.parentNode = this; this.children.push(c); return c; }
  _removeChildFrom(c) { this.children = this.children.filter(x => x !== c); }
  insertBefore(c, ref) { if (c.parentNode) c.parentNode._removeChildFrom(c); c.parentNode = this; this.children.push(c); return c; }
  remove() { if (this.parentNode) { this.parentNode._removeChildFrom(this); this.parentNode = null; } }
  removeChild(c) { this._removeChildFrom(c); c.parentNode = null; return c; }
  closest() { return this; }
  // 简化的选择器支持：a.tit / img / 标签名
  querySelector(sel) {
    if (sel === 'a.tit') return this.children.find(c => c.tagName === 'A' && (c._attrs['class'] || '').includes('tit')) || null;
    if (sel.startsWith('.')) return this.children.find(c => (c._attrs['class'] || '').includes(sel.slice(1))) || null;
    return this.children.find(c => c.tagName === sel.toUpperCase()) || null;
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
    cbs.forEach(cb => cb({ preventDefault() {}, stopPropagation() {} }));
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
  querySelectorAll: (sel) => queryAllStub ? queryAllStub(sel) : [],
  querySelector: (sel) => queryOneStub ? queryOneStub(sel) : null,
  addEventListener: (type, cb) => {
    if (type === 'DOMContentLoaded') docReadyCallbacks.push(cb);
  },
  createTreeWalker: () => ({ nextNode: () => null }),
  createTextNode: (t) => ({ textContent: t, nodeType: 3 }),
  createDocumentFragment: () => new FakeEl('fragment')
};
globalThis.NodeFilter = { SHOW_TEXT: 4 };
globalThis.window = globalThis;
globalThis.location = { hostname: 'www.xianyudanji.gg', pathname: '/pcdj', href: 'https://www.xianyudanji.gg/pcdj' };
globalThis.document = documentMock;
globalThis.addEventListener = (type, cb) => documentMock.addEventListener(type, cb);
globalThis.MutationObserver = class {
  constructor(cb) { this.cb = cb; MutationObserver.instances.push(this); }
  observe() {}
  disconnect() {}
};
MutationObserver.instances = [];

const DEFAULT_SETTINGS = {
  enabled: true, enableVmFilter: false, enableRatingFilter: false,
  minSteamRatingFilter: 0, showStatusBar: true, showDebugPanel: false,
  trackedSites: [], steamSiteSearch: [], highlightThreshold: 0.6
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
    onMessage: { addListener: (cb) => { msgListener = cb; } },
    getManifest: () => ({ version: '2.1.3' })
  },
  storage: {
    local: { get: async () => ({ adapterRules: null }) }
  },
  tabs: { sendMessage: async () => ({}) }
};

// 简化站点规则（模拟咸鱼单机）/ simplified site rule
const SITE_RULES = [{
  key: 'xianyudanji', name: '咸鱼单机', domains: ['xianyudanji.gg'],
  imageAppId: true,
  listPage: { urlPatterns: ['/pcdj'] },
  detailUrlPatterns: ['\\/\\d+\\.html?$'],
  listItem: { containers: ['li.game-item'], titleLink: 'a.tit', minLen: 2, maxLen: 200 }
}];
globalThis.__GAME_RECOMMENDER_SITES__ = { version: 1, sites: SITE_RULES };

// ============ 按 manifest 顺序加载内容脚本 / Load content scripts in order ============
const SCRIPT_FILES = [
  'content/core/common.js',
  'content/core/floats.js',
  'content/core/status-bar.js',
  'content/core/debug.js',
  'content/adapters/builder.js',
  'content/list/list-page.js',
  'content/detail/detail-page.js',
  'content/tracking/download-tracking.js',
  'content/tracker.js'
];

console.log('1. 顶层加载与预热');
let loadError = null;
try {
  for (const f of SCRIPT_FILES) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf-8');
    (0, eval)(code);
  }
} catch (e) {
  loadError = e;
}
check('内容脚本链加载无异常（含 warmup 顶层执行）', loadError ? loadError.message : null, null);

const GR = globalThis.__GR__;
check('GR 命名空间完整', ['common', 'status', 'debug', 'builder', 'list', 'detail', 'tracking', 'float']
  .filter(k => GR && GR[k]).length, 8);

// ============ 2. 列表页两波流程 / Two-wave rating flow ============
console.log('2. 列表页两波好评率流程');

// 构建列表页 DOM：3 个游戏项 / build a 3-item list page
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
const itemA = makeItem('游戏A', 1);
const itemB = makeItem('游戏B', 2);
const itemC = makeItem('游戏C', 3);
const allItems = [itemA, itemB, itemC];
queryAllStub = (sel) => {
  if (sel === 'li.game-item') return allItems.map(x => x.li);
  return [];
};
queryOneStub = () => null;

// 第一波：游戏A 缓存命中，B/C 未命中（后台分批拉取中）
presets['GET_STEAM_RATINGS'] = (msg) => {
  if (msg.cacheOnly) return { ratings: {}, pending: 0 }; // 兜底重查：无新命中
  return { ratings: { '游戏A': { appId: '111', positiveRate: 95, ratingDesc: '特别好评' } }, pending: 2 };
};

// 触发 DOMContentLoaded → init（warmup 已 resolve）
docReadyCallbacks.forEach(cb => cb());
await new Promise(r => setTimeout(r, 30));

check('第一波：缓存命中游戏A 徽章已插入', itemA.a.children.length, 1);
check('第一波：未命中游戏B/C 暂不显示徽章', itemB.a.children.length + itemC.a.children.length, 0);

// 后台推送第 1 波增量：游戏B 拉取完成 / background push wave 1: game B ready
await msgListener({ action: 'STEAM_RATINGS_UPDATE', ratings: { '游戏B': { appId: '222', positiveRate: 60, ratingDesc: '多半好评' } } }, {}, () => {});

check('第二波（增量1）：游戏B 徽章已插入', itemB.a.children.length, 1);
check('第二波（增量1）：游戏C 仍未处理', itemC.a.children.length, 0);

// 后台推送第 2 波增量：游戏C 确认为未找到 + done 收尾 / wave 2: C not found + done
await msgListener({ action: 'STEAM_RATINGS_UPDATE', ratings: { '游戏C': null }, done: true }, {}, () => {});

check('第二波（增量2）：游戏C 显示未找到徽章', itemC.a.children.length, 1);
check('未找到徽章样式正确', itemC.a.children[0].className ? itemC.a.children[0].className.includes('gr-not-found') : false, true);
const barEl = documentMock.body.children.find(c => c.id === 'gr-status-bar');
check('完成统计浮窗已显示', barEl ? (barEl.innerHTML.includes('Steam 好评率获取完成') && barEl.innerHTML.includes('2 个好评率')) : false, true);
const batchMsg = sentMessages.find(m => m.action === 'RECORD_DOWNLOAD_URLS_BATCH');
check('下载站网址缓存批量写入（2 条）', batchMsg ? batchMsg.data.entries.length : 0, 2);

// ============ 3. waitForListItems：AJAX 延迟渲染 / AJAX list wait ============
console.log('3. waitForListItems（AJAX 延迟渲染）');
queryAllStub = () => []; // 初始列表为空
const waitPromise = GR.list.waitForListItems(GR.builder.getAdapter(), 4000);
// 模拟 250ms 后 DOM 渲染出列表项 / simulate the DOM rendering items after 250ms
setTimeout(() => { queryAllStub = (sel) => sel === 'li.game-item' ? allItems.map(x => x.li) : []; }, 250);
setTimeout(() => { if (MutationObserver.instances.length) MutationObserver.instances[MutationObserver.instances.length - 1].cb(); }, 260);
const waitedItems = await waitPromise;
check('等待到列表项出现', waitedItems.length, 3);

// ============ 4. 调试视图关闭后不自动复活 / Debug view dismissal ============
console.log('4. 调试视图关闭后不自动复活');
GR.status.setDebugMode(true);
GR.status.showDebugView('<div>test debug</div>');
const dbgRoot = documentMock.body.children.find(c => c.id === 'gr-status-bar');
check('调试视图已创建（chrome 标题栏）', !!dbgRoot && !!dbgRoot.children[0], true);
// 模拟用户点击标题栏 ✕ 关闭
dbgRoot.children[0].children[2].click();
check('点击关闭后浮窗已移除', documentMock.body.children.some(c => c.id === 'gr-status-bar'), false);
// 关闭后 dbg 日志触发防抖刷新，不应复活浮窗
GR.debug.dbg('关闭后的测试日志');
await new Promise(r => setTimeout(r, 350));
check('关闭后日志不再复活调试视图', documentMock.body.children.some(c => c.id === 'gr-status-bar'), false);
// 重新开启调试模式 → 允许再次显示
GR.status.setDebugMode(true);
GR.status.showDebugView('<div>again</div>');
check('重新开启后调试视图可显示', documentMock.body.children.some(c => c.id === 'gr-status-bar'), true);
GR.float.closeAll();

// ============ 5. lazyload 封面 appId 直取（v3.2.1：gamer520 114933） ============
console.log('5. lazyload 封面 appId 直取（data-src 优先）');
const lazyScope = new FakeEl('div');
const lazyImg = new FakeEl('img');
lazyImg._attrs['src'] = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='; // 占位图
lazyImg._attrs['data-src'] = 'https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/1297900/c68d4/capsule_616x353.jpg';
lazyScope._imgs = [lazyImg];
const lazyInfo = GR.builder.extractSteamImageInfo(lazyScope);
check('占位 src 时从 data-src 提取 appId', lazyInfo ? lazyInfo.appId : null, '1297900');
check('返回真实封面 URL', lazyInfo ? lazyInfo.cover.includes('1297900') : false, true);
// 无 data-src 时回退 src
const plainImg = new FakeEl('img');
plainImg._attrs['src'] = 'https://cdn.akamai.steamstatic.com/steam/apps/111/header.jpg';
const plainScope = new FakeEl('div');
plainScope._imgs = [plainImg];
const plainInfo = GR.builder.extractSteamImageInfo(plainScope);
check('无 data-src 时回退 src', plainInfo ? plainInfo.appId : null, '111');

console.log('\n===== 内容脚本模拟测试结果 =====');
console.log(pass + ' 通过, ' + fail + ' 失败');

// 导出结果供 run-tests.js 聚合 / Export results for the test runner
export const testResult = { pass, fail, ok: fail === 0 };
