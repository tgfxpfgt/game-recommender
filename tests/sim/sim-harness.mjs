import { Window } from 'happy-dom';
import { test } from 'vitest';
/**
 * 游戏雷达 Game Radar - 内容脚本模拟共享 harness / Content Script Simulation Harness
 *
 * v15 阶段 2（测试栈换血）：FakeEl（161 行手写 DOM 模拟）退役 → happy-dom
 * 真实 DOM（innerHTML 解析 / #id 与复合选择器 / closest 语义 / 事件委托全部
 * 真实）。生产代码零改动直载；FakeEl 保留为兼容垫片（测试体 12 处 `new
 * FakeEl` + `_text/_imgs/_rect` 内部钩子经真 DOM 元素增强实现，后续批次
 * 逐套件改写为原生 API 后删除）。
 * Stage-2 test-stack swap: hand-written FakeEl is replaced by happy-dom real
 * DOM (innerHTML parsing, #id/compound selectors, closest semantics, event
 * delegation all real). Production code loads unchanged; FakeEl stays as a
 * compatibility shim backing 12 suite references until each suite migrates
 * to native APIs.
 *
 * 覆盖：
 *   1. happy-dom Window 注入（window/document/location/observer 全局）；
 *   2. chrome API mock（presets 按 action 分发）+ 测试站点规则；
 *   3. 按 manifest 顺序加载内容脚本（动态 import + GR shim 兼容层）。
 *
 * 状态模型（v14 B9 保持）：显式 access 函数 getGR / getMsgListener /
 * setQueryStubs / fireDomReady；跨文件隔离由 vitest isolate:true 提供。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ============ happy-dom 真实 DOM / real DOM ============
// url 注入模拟咸鱼单机页面（与原 location mock 同域同路径）
const win = new Window({ url: 'https://www.xianyudanji.gg/pcdj' });
export const happyWindow = win;
// v15 阶段 2：location 切换兼容层——套件以平面对象覆写 globalThis.location，
// happy-dom Location 为宿主对象无法整体替换；用 defineProperty 拦截赋值并
// 镜像 hostname/pathname/href 到真实 win.location（getCurrentDomain/URL 解析
// 与生产一致）。window.location 的赋值同步走同一镜像。
try {
  const realLocation = win.location;
  const applyLoc = (src) => {
    if (!src || typeof src !== 'object') return src;
    if (src.href && realLocation.href !== src.href) {
      try {
        realLocation.href = src.href;
      } catch {
        /* happy-dom 最低限度接受 href 赋值 */
      }
    }
    return realLocation;
  };
  Object.defineProperty(globalThis, 'location', {
    get: () => realLocation,
    set: (v) => applyLoc(v),
    configurable: true
  });
  Object.defineProperty(win, 'location', {
    get: () => realLocation,
    set: (v) => applyLoc(v),
    configurable: true
  });
} catch {
  /* 不可覆写环境保持原生 */
}
export const documentMock = win.document; // 真实 Document（套件直用，导出名保持）
globalThis.window = win;
globalThis.document = win.document;
globalThis.location = win.location;
globalThis.NodeFilter = win.NodeFilter;
globalThis.MutationObserver = win.MutationObserver;
globalThis.IntersectionObserver = win.IntersectionObserver;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 16);
// 视口默认值（浮窗拖拽/调宽钳位计算读取；happy-dom 默认 1024x768 不符旧断言）
win.innerWidth = 1400;
win.innerHeight = 900;
globalThis.innerWidth = 1400;
globalThis.innerHeight = 900;
// 模拟浏览器 window.open（download-tracking 拦截链需要原始实现转发）
globalThis.window.open = () => null;
// v15 阶段 2：readyState 冻结 loading——旧 FakeEl 语义（页面自动流不自发跑，
// 测试经手动 inject/fireDomReady 驱动）。happy-dom 加载即 interactive，
// tracker eval 后 startInit 会立即跑 initPage → 与手动驱动双重流程污染
//（9 节 SEARCH_STEAM ×2、118 wrong 痕迹被 correct 覆盖）。
// 生产语义不受影响（真实浏览器 document_start 注入时 readyState=loading）。
try {
  Object.defineProperty(win.document, 'readyState', {
    get: () => 'loading',
    configurable: true
  });
  Object.defineProperty(documentMock, 'readyState', {
    get: () => 'loading',
    configurable: true
  });
} catch {
  /* 极端环境不可覆写时保持原值 */
}

// ============ FakeEl 兼容垫片 / FakeEl compatibility shim ============
// v15 阶段 2：真实元素 + 测试私有钩子（_text/_html/_imgs/_rect/_listeners）。
// 旧测试体的 `new FakeEl('h1')`、`el._text = ...`、`scope._imgs = [...]`、
// `el._listeners['click']` 语义逐一保留；生产代码只走标准 API
// （innerHTML/textContent/querySelectorAll/addEventListener），垫片对其完全透明。
export class FakeEl {
  constructor(tag = 'div') {
    const el = win.document.createElement(tag);
    installChildrenArray(el); // 63 处 children 数组方法兼容
    // 测试私有钩子桥（getter/setter 落到真实 API）
    Object.defineProperties(el, {
      _text: {
        get() {
          return el.textContent;
        },
        set(v) {
          el.textContent = String(v);
        },
        configurable: true
      },
      _html: {
        get() {
          return el.innerHTML;
        },
        set(v) {
          el.innerHTML = String(v);
        },
        configurable: true
      },
      _imgs: {
        get() {
          return el.__grImgs || [];
        },
        set(v) {
          el.__grImgs = v;
        },
        configurable: true
      },
      _rect: {
        get() {
          return el.__grRect;
        },
        set(v) {
          el.__grRect = v;
        },
        configurable: true
      }
    });
    // 旧 getBoundingClientRect 的可覆盖语义（_rect 优先，默认零位矩形）
    const origRect = el.getBoundingClientRect.bind(el);
    el.getBoundingClientRect = () => {
      const r = el.__grRect || {};
      const left = r.left || 0;
      const top = r.top || 0;
      const width = r.width || 100;
      const height = r.height || 40;
      return { left, top, right: left + width, bottom: top + height, width, height };
    };
    void origRect;
    // _listeners 注册表桥（真实 addEventListener 外同步登记，F4/F9 直调 fire 用）
    el.__grListeners = {};
    const origAdd = el.addEventListener.bind(el);
    el.addEventListener = (type, cb, ...rest) => {
      (el.__grListeners[type] = el.__grListeners[type] || []).push(cb);
      return origAdd(type, cb, ...rest);
    };
    Object.defineProperty(el, '_listeners', {
      get() {
        return el.__grListeners;
      },
      configurable: true
    });
    return el;
  }
}
// children 数组化（HTMLCollection → Array 实例）：旧套件 63 处
// children.find/some/filter/indexOf/map 数组方法依赖——生产代码仅用
// children[i]/length（已全库 grep 确认），真实 DOM 上仅测试元素增强，
// 对生产语义零影响。原生 getter 保底 + 快照刷新（appendChild/remove 后新取）。
function installChildrenArray(el) {
  const proto = Object.getPrototypeOf(el);
  const desc =
    Object.getOwnPropertyDescriptor(proto, 'children') ||
    Object.getOwnPropertyDescriptor(win.Element.prototype, 'children');
  if (!desc || !desc.get) return;
  Object.defineProperty(el, 'children', {
    get() {
      return Array.prototype.slice.call(desc.get.call(el));
    },
    configurable: true
  });
}
// querySelectorAll('img') 桥：生产 builder.extractSteamImageInfo 读 scope.querySelectorAll('img')——
// 垫片 _imgs 注入后经此透出（真实 img 元素也天然可查，双轨并存）
const origCreate = win.document.createElement.bind(win.document);
win.document.createElement = (tag, opts) => {
  const el = origCreate(tag, opts);
  installChildrenArray(el); // children 数组方法兼容（生产/测试通用）
  // _listeners 注册表桥（真实 addEventListener 外同步登记；套件直调 fire 用）
  el.__grListeners = {};
  const origAdd = el.addEventListener.bind(el);
  el.addEventListener = (type, cb, ...rest) => {
    (el.__grListeners[type] = el.__grListeners[type] || []).push(cb);
    return origAdd(type, cb, ...rest);
  };
  Object.defineProperty(el, '_listeners', {
    get() {
      return el.__grListeners;
    },
    configurable: true
  });
  // _html/_text 桥（套件对生产元素的旧断言 hook——信号 body._html.includes 等）
  Object.defineProperties(el, {
    _text: {
      get() {
        return el.textContent;
      },
      set(v) {
        el.textContent = String(v);
      },
      configurable: true
    },
    _html: {
      get() {
        return el.innerHTML;
      },
      set(v) {
        el.innerHTML = String(v);
      },
      configurable: true
    }
  });
  const origQsa = el.querySelectorAll.bind(el);
  el.querySelectorAll = (sel) => {
    const real = origQsa(sel);
    if (sel === 'img' && el.__grImgs && el.__grImgs.length > 0) return el.__grImgs;
    return real;
  };
  return el;
};

// ============ document 级插桩（真实 DOM 上保留桩语义） ============
// v15 阶段 2：querySelectorAll/Selector 桩改打在真实 document 上——原 stub
// 直接决定返回值（测试体 52 行 `sel === 'h1' ? h1El : null` 形态依赖此语义），
// 真实 DOM 的 qSA 无法表达"指定选择器返回固定元素"，故保留拦截层。
let queryAllStub = null;
let queryOneStub = null;
const docReadyCallbacks = [];
const docListeners = {};
const realDocAdd = win.document.addEventListener.bind(win.document);
const realDocRemove = win.document.removeEventListener.bind(win.document);
win.document.addEventListener = (type, cb, ...rest) => {
  if (type === 'DOMContentLoaded') docReadyCallbacks.push(cb);
  else {
    (docListeners[type] = docListeners[type] || []).push(cb);
    realDocAdd(type, cb, ...rest);
  }
};
win.document.removeEventListener = (type, cb, ...rest) => {
  const arr = docListeners[type];
  if (arr) {
    const i = arr.indexOf(cb);
    if (i >= 0) arr.splice(i, 1);
  }
  realDocRemove(type, cb, ...rest);
};
win.document.querySelectorAll = (sel) => (queryAllStub ? queryAllStub(sel) : []);
win.document.querySelector = (sel) => (queryOneStub ? queryOneStub(sel) : null);
win.document.getElementById = () => null; // v15：保持旧语义（套件按需覆盖）
installChildrenArray(win.document.body); // 套件对 body/head 的 children 数组方法
installChildrenArray(win.document.head);

export function setQueryStubs(allFn, oneFn) {
  if (allFn) queryAllStub = allFn;
  if (oneFn) queryOneStub = oneFn;
}
// 触发 DOMContentLoaded（happy-dom 加载即 complete——测试手动派发保持时序控制）
export function fireDomReady() {
  [...docReadyCallbacks].forEach((cb) => cb());
  // v15 阶段 2：tracker startInit 挂在 window 的真实 DCL 监听（readyState=loading
  // 冻结下唯一触发路径）——happy-dom 上派发真实事件驱动页面自动流
  try {
    win.document.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
    win.dispatchEvent(new win.Event('DOMContentLoaded'));
  } catch {
    /* 派发环境异常时登记表路径已覆盖 */
  }
}
// v14.23.0：触发文档级事件（真实派发 + 登记表直调双轨——target 是 Event
// 只读属性，happy-dom 的 MouseEvent 构造器接收 target/init 细节不全，
// 故真实派发走 MouseEvent；ev.target 直调保底走登记表）
export function fireDocEvent(type, ev) {
  const evObj = ev || { preventDefault() {}, stopPropagation() {} };
  // 套件传自定义 target（外点/内点判定）→ 走登记表直调（Event.target 只读，
  // 真实派发无法注入；拖拽/外点关闭的登记回调在 document 上，直调语义精确）
  (docListeners[type] || []).forEach((cb) => cb(evObj));
}
// 文档级监听计数（泄漏断言：remove 后外点关闭监听应自摘）
export function docListenerCount(type) {
  return (docListeners[type] || []).length;
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

// ============ Fake chrome API（预设按 action 分发）============
let msgListener = null;
export const presets = {}; // action → 响应函数（每次调用都生效）
export const sentMessages = [];
// storage.local 真实化（内存 store；浮窗折叠/位置/宽度/缩放持久化测试依赖读写往返）
export const chromeLocalStore = {};
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
    local: {
      get: async (keys) => {
        if (keys == null) return { ...chromeLocalStore };
        const out = {};
        (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
          if (k in chromeLocalStore) out[k] = chromeLocalStore[k];
        });
        return out;
      },
      set: async (obj) => {
        Object.keys(obj || {}).forEach((k) => {
          if (obj[k] === undefined) delete chromeLocalStore[k];
          else chromeLocalStore[k] = obj[k];
        });
      },
      remove: async (keys) => {
        (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete chromeLocalStore[k]);
      }
    }
  },
  tabs: { sendMessage: async () => ({}) }
};

// fetch 桩（目录索引未命中确定性 404 降级——同 v14.6 语义）
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
export function getMsgListener() {
  return msgListener;
}

// 简化站点规则（模拟咸鱼单机）
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
chromeLocalStore['adapterRules'] = { version: 1, sites: SITE_RULES };

// ============ 按 manifest 顺序加载内容脚本 ============
export const SCRIPT_FILES = ['shared/patterns.js', 'shared/escape.js', 'shared/msg.js', 'content/tracker.js'];
import { CORE_MODULES, OPTIONAL_MODULES } from '../../content/module-manifest.js';
const MODULE_FILES = [...CORE_MODULES, ...OPTIONAL_MODULES].map((mod) => mod.file);

export const MODULE_KEYS = [
  'common',
  'float',
  'status',
  'debug',
  'messages',
  'pageInit',
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

export function getGR() {
  return globalThis.__GR__;
}

// tracker 副作用 import 会覆盖测试规则——每次 tracker 加载后重注入并重建适配器
export async function resetSiteRulesForTests() {
  globalThis.__GAME_RECOMMENDER_SITES__ = { version: 1, sites: SITE_RULES };
  try {
    const GR = globalThis.__GR__;
    const b = GR && GR.builder;
    if (b) {
      await b.loadSiteRules(true);
      b.buildSiteAdapters(b.getSITE_RULES());
    }
  } catch {
    /* 忽略 */
  }
}

async function loadModules() {
  // getURL mock：content/... → file:// URL（v15：真实 happy-dom 下保持同语义）
  globalThis.chrome.runtime.getURL = (p) => new URL('../../' + p, import.meta.url).href;
  let mods = null;
  for (let attempt = 0; attempt < 3 && !mods; attempt++) {
    try {
      mods = await Promise.all(MODULE_FILES.map((f) => import(new URL('../../' + f, import.meta.url).href)));
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
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

export function loadClassicScripts() {
  for (const f of SCRIPT_FILES) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf-8');
    evalWithGrImport(code);
  }
  // v15 阶段 2：经典脚本经 globalThis 挂载（__GR_MSG__/__GR_PATTERNS__/…），
  // 生产模块读 window.__GR_*——旧 harness window===globalThis 天然同对象；
  // happy-dom 下 window 是独立实例，需镜像回 win（生产代码语义不变）
  for (const k of Object.keys(globalThis)) {
    if (k.startsWith('__GR_') && win[k] !== globalThis[k]) {
      try {
        win[k] = globalThis[k];
      } catch {
        /* 只读属性跳过 */
      }
    }
  }
}

export async function reloadContentScripts() {
  docReadyCallbacks.length = 0;
  globalThis.__gameRecommenderTracker = false;
  await loadModules();
  await resetSiteRulesForTests();
  loadClassicScripts();
}

export { loadModules };

// v14.24.1：默认 60s（提额处方见 AGENTS；批量挂起时 GR_SIM_SIGNAL_TIMEOUT_MS 提额）
const SIM_SIGNAL_TIMEOUT_MS = Number(process.env.GR_SIM_SIGNAL_TIMEOUT_MS) || 90000; // v15 阶段 2：真实 DOM 双流重试余量（60s→90s）
export async function waitForSignal(fn, desc, timeoutMs = SIM_SIGNAL_TIMEOUT_MS) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`waitForSignal 超时(${timeoutMs}ms): ${desc || '(未命名信号)'}`);
}

// 构建列表页 DOM 项（真实 DOM 版 makeItem——返回真元素，旧字段 a 保留）
export function makeItem(name, id) {
  const li = win.document.createElement('li');
  li.className = 'game-item';
  const a = win.document.createElement('a');
  a.setAttribute('href', `https://www.xianyudanji.gg/${id}.html`);
  a.className = 'tit';
  a.textContent = name;
  li.appendChild(a);
  return { li, a };
}

export const simTest = (name, fn, opts) => test(name, opts, fn);
