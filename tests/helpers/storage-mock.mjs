/**
 * Game Recommender - 测试：chrome.storage mock 统一抽象 / Shared Storage Mock
 *
 * v4.2.0：消除此前 3 份重复的 chrome.storage mock（test-wrong-reports /
 * test-content-sim / test-cleanup 各写一份）。内存 Map 实现，支持预置数据、
 * 读写追踪与重置；模拟 chrome.storage.local.get/set/remove 语义（get 返回
 * 对象、缺失键不报错、set 合并）。
 * Unifies the previously triplicated chrome.storage.local mocks: in-memory Map
 * with preset data, read/write tracing and reset.
 */
'use strict';

export function createStorageMock(initial = {}) {
  const data = new Map(Object.entries(initial || {}));
  const writes = []; // 写入追踪（测试断言用）/ write trace
  const api = {
    get: async (keys) => {
      if (keys === null || keys === undefined) return Object.fromEntries(data);
      const keyList = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of keyList) if (data.has(k)) out[k] = data.get(k);
      return out;
    },
    set: async (items) => {
      for (const [k, v] of Object.entries(items || {})) {
        data.set(k, v);
        writes.push(k);
      }
    },
    remove: async (keys) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
    },
    // 测试辅助 / test helpers
    _data: data,
    _writes: writes,
    _reset: (next = {}) => {
      data.clear();
      for (const [k, v] of Object.entries(next)) data.set(k, v);
      writes.length = 0;
    },
    _dump: () => Object.fromEntries(data)
  };
  return api;
}

// 安装到 globalThis.chrome（local + runtime 最小面）；返回可卸载的清理函数
// Installs the mock onto globalThis.chrome (local + minimal runtime surface).
export function installChromeStorageMock(storage) {
  const prev = globalThis.chrome;
  globalThis.chrome = {
    storage: { local: storage },
    runtime: {
      sendMessage: async () => ({ success: true }),
      onMessage: { addListener: () => {} },
      getManifest: () => ({ version: '0.0.0-test' })
    }
  };
  return () => {
    if (prev === undefined) delete globalThis.chrome;
    else globalThis.chrome = prev;
  };
}
