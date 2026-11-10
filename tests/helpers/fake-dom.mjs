/**
 * 游戏雷达 Game Radar - 最小 Fake DOM（unit 测试用）/ Minimal fake DOM for unit tests
 *
 * v14.27.0（P2-4）：options/dashboard 的 DOM 渲染与保存映射单测共用。元素按 id
 * 懒创建（settings-render 的 ~60 个 getElementById 无需逐项预置），innerHTML
 * 仅做字符串存储（断言用），querySelectorAll 默认空数组（需要时由用例覆写）。
 * Lazy element registry shared by the options/dashboard DOM unit tests; innerHTML
 * is stored as a plain string and querySelectorAll is overridable per test.
 */

class FakeClassList {
  constructor() {
    /** @type {Set<string>} */
    this._set = new Set();
  }
  /** @param {...string} names */
  add(...names) {
    names.forEach((n) => this._set.add(n));
  }
  /** @param {...string} names */
  remove(...names) {
    names.forEach((n) => this._set.delete(n));
  }
  /** @param {string} name */
  contains(name) {
    return this._set.has(name);
  }
}

/** 创建单个假元素 / Create one fake element */
export function makeEl(id = '') {
  return {
    id,
    value: '',
    checked: false,
    textContent: '',
    className: '',
    innerHTML: '',
    style: {},
    dataset: {},
    classList: new FakeClassList(),
    /** @type {Record<string, Function[]>} */
    handlers: {},
    /** @param {string} type @param {Function} fn */
    addEventListener(type, fn) {
      (this.handlers[type] = this.handlers[type] || []).push(fn);
    },
    removeEventListener() {},
    /** 触发 click 监听（事件对象最小化）/ Fire click handlers */
    click() {
      (this.handlers.click || []).forEach((fn) => fn({ target: this, preventDefault() {} }));
    },
    /** @type {any[]} */
    querySelectorAll() {
      return [];
    },
    /** @type {any[]} */
    querySelector() {
      return null;
    },
    closest() {
      return null;
    },
    appendChild() {},
    insertAdjacentHTML() {},
    getAttribute() {
      return null;
    },
    setAttribute() {}
  };
}

/**
 * 安装 Fake DOM 到 globalThis.document 之外的表（由调用方赋值）/
 * Build a fake document; assign it where needed.
 */
export function installFakeDom() {
  /** @type {Map<string, any>} */
  const byId = new Map();
  /** @type {{type: string, fn: Function}[]} */
  const listeners = [];
  /** @type {any[]} */
  const created = [];

  /** @param {string} id */
  function getElementById(id) {
    if (!byId.has(id)) byId.set(id, makeEl(id));
    return byId.get(id);
  }

  const document = {
    getElementById,
    /** @type {any[]} */
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    /** @param {string} tag */
    createElement(tag) {
      const el = makeEl('');
      el.tagName = String(tag).toUpperCase();
      created.push(el);
      return el;
    },
    /** @param {string} type @param {Function} fn */
    addEventListener(type, fn) {
      listeners.push({ type, fn });
    },
    removeEventListener() {},
    body: { insertAdjacentHTML() {} }
  };

  return { document, byId, listeners, created, getElementById };
}
