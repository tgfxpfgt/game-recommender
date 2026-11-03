/**
 * 游戏雷达 Game Radar - 测试：chrome.storage mock 统一抽象 / Shared Storage Mock
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
      // v14.14（报告 D P1-10）：返回结构化克隆——真实 chrome.storage 与
      // 调用方不共享引用；此前返回内部引用使测试可就地改值而不 set 便
      // "通过"，掩盖"忘记持久化"类缺陷
      const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
      if (keys === null || keys === undefined) return clone(Object.fromEntries(data));
      const keyList = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of keyList) if (data.has(k)) out[k] = clone(data.get(k));
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

// 安装到 globalThis.chrome（local + session + runtime 最小面）；返回可卸载的清理函数
// Installs the mock onto globalThis.chrome (local + session + minimal runtime surface).
export function installChromeStorageMock(storage) {
  const prev = globalThis.chrome;
  // v10.0.0：session 区与 local 同构（诊断持久化测试用）
  const session = createStorageMock();
  globalThis.chrome = {
    storage: { local: storage, session },
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
