/**
 * Game Recommender - 测试：Steam API fetch mock / Shared Steam Fetch Mock
 *
 * v4.2.0：按 URL 分发的 fetch mock（appdetails / storesearch 等），
 * 统一 security §8 与 outbound §4 的既有模式。传入 handlers 表
 * （URL 子串 → 响应对象或工厂函数），未命中的 URL 返回 {ok:false}。
 * URL-routed fetch mock for Steam API tests (appdetails/storesearch, ...);
 * unhandled URLs return {ok:false}.
 */
'use strict';

export function createFetchMock(handlers) {
  const calls = []; // 调用追踪（测试断言用）/ call trace
  const mock = async (url) => {
    const u = String(url);
    calls.push(u);
    for (const [needle, handler] of Object.entries(handlers)) {
      if (u.includes(needle)) {
        const payload = typeof handler === 'function' ? handler(u) : handler;
        return { ok: true, json: async () => payload, text: async () => JSON.stringify(payload), status: 200 };
      }
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  mock._calls = calls;
  return mock;
}

// 安装到 globalThis.fetch（返回清理函数）/ install onto globalThis.fetch
export function installFetchMock(mock) {
  const prev = globalThis.fetch;
  globalThis.fetch = mock;
  return () => { globalThis.fetch = prev; };
}
