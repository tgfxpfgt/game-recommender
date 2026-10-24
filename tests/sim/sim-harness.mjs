import { test } from 'vitest';
/**
 * 游戏雷达 Game Radar - 内容脚本模拟共享 harness / Content Script Simulation Harness
 *
 * 在 Node 中模拟浏览器环境（window/document/chrome），供 tests/sim/ 下各流程
 * 套件共享（第五轮 B9：由 test-content-sim.mjs 拆出）。覆盖：
 *   1. FakeEl DOM 模拟 + window/document/observer 全局 mock；
 *   2. chrome API mock（presets 按 action 分发）+ 测试站点规则；
 *   3. 按 manifest 顺序加载内容脚本（动态 import + GR shim 兼容层）。
 * Simulates the browser environment in Node, shared by the sim suites under
 * tests/sim/: Fake DOM + global mocks, chrome API presets, and manifest-order
 * content script loading with the GR shim.
 *
 * 状态模型（v14 B9 重设计）：原 test-content-sim.mjs 为文件级顺序状态机
 *（`let GR = null; // 节 1 赋值，后续节共享`）——拆分后改为显式 access/reset
 * 函数：getGR / getMsgListener / setQueryStubs / fireDomReady。跨文件状态由
 * vitest isolate:true 天然隔离（每文件独立模块注册表 + 独立 fork）。
 * State model: the old single-file sequential state machine is replaced by
 * explicit accessor functions; cross-file isolation comes from vitest isolate.
 */
('use strict');

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ============ Fake DOM / Fake DOM ============
export class FakeEl {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this._text = '';
    this._html = '';
    this._attrs = {};
    // v10.1.0：classList 真实跟踪（此前 add 无操作/contains 恒 false——
    // 绿标题 gr-title-green 等类断言无法验证）
    this.classList = {
      _set: new Set(),
      add(...cs) {
        cs.forEach((c) => this._set.add(c));
      },
      remove(...cs) {
        cs.forEach((c) => this._set.delete(c));
      },
      contains(c) {
        return this._set.has(c);
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

export const documentMock = {
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

// 显式插桩函数（v14 B9：替代原文件级 let queryAllStub/queryOneStub 直接赋值；
// 传 null/undefined = 保持现状，便于单参设置）
export function setQueryStubs(allFn, oneFn) {
  if (allFn) queryAllStub = allFn;
  if (oneFn) queryOneStub = oneFn;
}
// 触发 DOMContentLoaded → init（warmup 已 resolve）/ fire pending DOMContentLoaded
export function fireDomReady() {
  [...docReadyCallbacks].forEach((cb) => cb());
}

export const DEFAULT_SETTINGS = {
  enabled: true,
  enableVmFilter: false,
  enableRatingFilter: false,
  minSteamRatingFilter: 0,
  showStatusBar: true,
  showDebugPanel: false,
  trackedSites: [],
  steamSiteSearch: [],
  highlightThreshold: 0.6,
  badgeVisibility: { recent: true, all: true, update: true, rec: true, score: true }
};

// ============ Fake chrome API（预设按 action 分发）/ fake chrome with presets ============
let msgListener = null;
export const presets = {}; // action → 响应函数（每次调用都生效）/ response factory per action
export const sentMessages = [];
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
    // v7.2.0：返回测试规则——loadSiteRules 从 storage 读取，免疫 tracker
    // 副作用 import（adapters/index.js）对 __GAME_RECOMMENDER_SITES__ 的覆盖
    local: { get: async () => ({ adapterRules: { version: 1, sites: SITE_RULES } }) }
  },
  tabs: { sendMessage: async () => ({}) }
};

// v14.6：fetch 桩——目录索引（app-list-index）未命中触发的后台刷新在此
// 确定性 404 降级（否则 sim 内发起真实 20MB 网络拉取，写队列竞争干扰
// 节 2/2b 批次时序）。目录层逻辑由 tests/unit/test-app-list-index 覆盖。
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
// 显式读取（v14 B9：替代原文件级 let msgListener 直接引用）
export function getMsgListener() {
  return msgListener;
}

// 简化站点规则（模拟咸鱼单机）/ simplified site rule
// v10.7.0 批次4：features.inlineSteamCard 与内置规则同步（内嵌卡门控已
// 改由规则 features 声明驱动）
export const SITE_RULES = [
  {
    key: 'xianyudanji',
    name: '咸鱼单机',
    domains: ['xianyudanji.gg'],
    imageAppId: true,
    features: { inlineSteamCard: true },
    listPage: { urlPatterns: ['/pcdj'] },
    detailUrlPatterns: ['\\/\\d+\\.html?$'],
    listItem: { containers: ['li.game-item'], titleLink: 'a.tit', minLen: 2, maxLen: 200 }
  }
];
globalThis.__GAME_RECOMMENDER_SITES__ = { version: 1, sites: SITE_RULES };

// ============ 按 manifest 顺序加载内容脚本 / Load content scripts in order ============
// v6.0.0：内容脚本 ESM 化——经典入口 tracker.js eval + 模块动态 import
// v7.2.0 回退：Chromium 的 content_scripts 不支持 type:module（运行时忽略）——
// 恢复动态 import 方案；storage mock 返回测试规则（更健壮）
export const SCRIPT_FILES = ['shared/patterns.js', 'shared/escape.js', 'shared/msg.js', 'content/tracker.js'];
// 模块加载（动态 import + GR shim 兼容层；固定 ?t= 与 tracker 的 getURL 共享实例）
// v10.7.0 批次4：加载文件表由 content/module-manifest.js 单源派生（核心 +
// 可选；模拟环境可选模块恒加载）。MODULE_KEYS 保持 GR shim 契约（顺序与清单一致）。
import { CORE_MODULES, OPTIONAL_MODULES } from '../../content/module-manifest.js';
const MODULE_FILES = [...CORE_MODULES, ...OPTIONAL_MODULES].map((mod) => mod.file);
export const MODULE_KEYS = [
  'common',
  'float',
  'status',
  'debug',
  'messages', // v14.5.0 B7：入站消息路由域（键序与 manifest 对齐）
  'pageInit', // v14.5.0 B7：页面检测与功能分发域
  'builder',
  'badges',
  'listBatch',
  'list',
  'listState',
  'detailTemplates',
  'detail',
  'tracking',
  'qrUnlock',
  'xdgrid'
];

// GR shim 访问器（v14 B9：替代原文件级 `let GR = null; // 节 1 赋值，后续节共享`
// 顺序状态机——各测试体内 `const GR = getGR()` 显式取当前模块句柄表）。
// GR accessor: replaces the file-level sequential `let GR` state machine.
export function getGR() {
  return globalThis.__GR__;
}

// v7.2.0：tracker 的副作用 import（adapters/index.js）会把 __GAME_RECOMMENDER_SITES__
// 覆盖为内置规则——每次 tracker 加载后需重注入测试规则并重建适配器
export async function resetSiteRulesForTests() {
  globalThis.__GAME_RECOMMENDER_SITES__ = { version: 1, sites: SITE_RULES };
  try {
    const GR = globalThis.__GR__;
    const b = GR && GR.builder;
    if (b) {
      await b.loadSiteRules(true); // 强制重读（覆盖 tracker 副作用 import 的内置规则）
      b.buildSiteAdapters(b.getSITE_RULES());
    }
  } catch {
    /* 忽略 */
  }
}

async function loadModules() {
  // getURL mock：映射 content/... → file:// URL（tracker 动态 import 使用）
  globalThis.chrome.runtime.getURL = (p) => new URL('../../' + p, import.meta.url).href;
  // v7.0.5：全量并行下偶发 import 失败（循环依赖加载竞态，GR.listBatch null）——
  // 整体失败重试 3 次（50ms 退避），根治偶发；仍失败则抛错（测试可见）
  let mods = null;
  for (let attempt = 0; attempt < 3 && !mods; attempt++) {
    try {
      mods = await Promise.all(MODULE_FILES.map((f) => import(new URL('../../' + f, import.meta.url).href)));
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  // GR shim：模块句柄挂回 __GR__（测试体 GR.x.y 引用零改动）
  const GR = (globalThis.__GR__ = globalThis.__GR__ || {});
  MODULE_KEYS.forEach((k, i) => {
    GR[k] = mods[i];
  });
  return GR;
}

// import provider：eval 代码里的 import( → __grImport(（vitest 兼容层）
globalThis.__grImport = (spec) => import(spec);
export function evalWithGrImport(code) {
  return (0, eval)(code.replace(/import\(/g, '__grImport('));
}

// 经典脚本 eval 注入（节 1 加载与 reloadContentScripts 共用；v14 B9 提取）
export function loadClassicScripts() {
  for (const f of SCRIPT_FILES) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf-8');
    evalWithGrImport(code);
  }
}

// 重载内容脚本（模拟页面重载）
// v7.2.0：tracker.js 为原生 ESM（type:module）——直接 import 加载（其静态
// import 由 Node ESM 解析）；经典脚本 eval 注入（无 import 语句）
// v14 B9 实证：此处**不得** vi.resetModules()——原文件的 `typeof vi` 守卫在
// globals:false 下从不触发（重载 = 复用已缓存实例）；且 shared/ 未列入
// server.deps.inline（Node 原生单例），reset 会造成 content/shared 实例分裂
//（徽章/浮窗渲染链断裂，9a/9d 超时）。
export async function reloadContentScripts() {
  docReadyCallbacks.length = 0;
  globalThis.__gameRecommenderTracker = false;
  await loadModules();
  await resetSiteRulesForTests(); // storage 已返回测试规则（保险重注入）
  loadClassicScripts();
}

export { loadModules };

// v6.3.2：固定延时在全量并发下偶发不足（推送/批次异步链竞争）——
// 轮询等待条件替代固定延时，根治偶发
// v14 B6：waitFor → waitForSignal——必须携带 desc，超时抛错并打印描述定位
//（原返回 false 由调用方兜底转储的模式废弃：失败信息统一进超时错误）
export async function waitForSignal(fn, desc, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`waitForSignal 超时(${timeoutMs}ms): ${desc || '(未命名信号)'}`);
}

// 构建列表页 DOM 项（Fake DOM）/ build a list item
// v6.2.0：makeItem 提升至共享层（列表/徽章/排序各节共用）
export function makeItem(name, id) {
  const li = new FakeEl('li');
  li._attrs['class'] = 'game-item';
  const a = new FakeEl('a');
  a._attrs['href'] = `https://www.xianyudanji.gg/${id}.html`;
  a._attrs['class'] = 'tit';
  a._text = name;
  li.appendChild(a);
  return { li, a };
}

// v14 B6 遗产：原 simTest 包装（retry 2 绷带移除后的透传——保留调用点零改动）
// Passthrough test wrapper kept so suite call sites stay unchanged.
export const simTest = (name, fn, opts) => test(name, opts, fn);
