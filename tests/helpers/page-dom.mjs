/**
 * 游戏雷达 Game Radar - 页面单测 happy-dom 基建（v15 阶段 3 全量迁移）
 *
 * options/dashboard 页面单测的 DOM 底座：happy-dom 真实 DOM（Preact render
 * 需真实树）+ lazy-create getElementById（沿用 fake-dom 懒建语义）+ __GR_PREACT__
 * 全局注入。替代 tests/helpers/fake-dom.mjs（innerHTML 字符串存储不支持
 * Preact render 的真实 DOM 操作）。
 * happy-dom based page-test DOM: real tree for Preact render, lazy-create ids,
 * __GR_PREACT__ global injection. Replaces helpers/fake-dom.mjs.
 */
import { Window } from 'happy-dom';
import { h, render, Fragment } from 'preact';

/**
 * 安装页面测试 DOM（返回 document 包装 + win + 捕获数组）
 * 参数 documentTarget：host 全局挂载点（globalThis.document / 沙箱.document）
 */
export function installPageDom() {
  const win = new Window({ url: 'https://page.local/' });
  const realDoc = win.document;
  const docListeners = [];
  const docCreated = [];

  /** @param {string} id */
  function lazyById(id) {
    let el = realDoc.getElementById(id);
    if (!el) {
      el = realDoc.createElement('div');
      el.id = id;
      realDoc.body.appendChild(el);
    }
    return el;
  }

  const document = {
    getElementById: (/** @type {string} */ id) => lazyById(id),
    createElement: (/** @type {string} */ t) => {
      const el = realDoc.createElement(t);
      docCreated.push(el);
      return el;
    },
    createTextNode: (/** @type {string} */ t) => realDoc.createTextNode(t),
    querySelector: (/** @type {string} */ sel) => realDoc.querySelector(sel),
    querySelectorAll: (/** @type {string} */ sel) => realDoc.querySelectorAll(sel),
    addEventListener: (/** @type {string} */ t, /** @type {Function} */ f) => {
      docListeners.push({ type: t, fn: f });
      realDoc.addEventListener(t, f);
    },
    removeEventListener: (/** @type {string} */ t, /** @type {Function} */ f) => realDoc.removeEventListener(t, f),
    body: realDoc.body,
    head: realDoc.head
  };

  return {
    win,
    document,
    realDoc,
    lazyById,
    listeners: docListeners,
    getElementById: (/** @type {string} */ id) => lazyById(id),
    preact: { h, render, Fragment },
    created: docCreated,
    /** @param {string} file 相对 ROOT 的页面脚本路径 */
    getURL: (/** @type {string} */ file) => new URL('../../' + file, import.meta.url).href
  };
}

/** 页面测试的全局注入（document/window/__GR_PREACT__/escapeHtml/escapeAttr） */
export function installPageGlobals(dom) {
  globalThis.document = dom.document;
  globalThis.__GR_PREACT__ = { h, render, Fragment };
  // Preact 插值天然转义——但页面既有代码可能仍引用全局 escape（渐进期共存）
  globalThis.escapeHtml = (/** @type {unknown} */ t) =>
    String(t ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  globalThis.escapeAttr = (/** @type {unknown} */ t) =>
    String(t ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
}

export { h, render, Fragment };
