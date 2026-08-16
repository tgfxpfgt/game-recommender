/**
 * 游戏雷达 Game Radar - 统一消息层 / Unified Message Layer
 *
 * v8.2.0：所有 chrome.runtime.sendMessage 调用统一走本封装——
 * 超时兜底（后台异常挂起不再无限等待）+ 错误归一（后台不可达/失败
 * 返回明确错误）。Promise 风格（MV3 原生支持），兼容测试 mock 与
 * 真实浏览器。
 * Unified message layer: timeout guard + normalized errors. Promise-style,
 * works with both the MV3 native promise API and test mocks.
 */
(function (global) {
  'use strict';

  const DEFAULT_TIMEOUT = 10000;

  /**
   * 发送消息（超时兜底 + 错误归一）
   * @param {string|object} action 消息 action 或完整消息对象
   * @param {object} [payload] action 模式的附加字段
   * @param {{timeout?: number}} [opts] 超时毫秒（0 = 不超时）
   * @returns {Promise<any>} 后台响应（失败/超时抛 Error）
   */
  function sendMessage(action, payload, opts = {}) {
    const timeout = opts.timeout === undefined ? DEFAULT_TIMEOUT : opts.timeout;
    const msg = typeof action === 'object' ? /** @type {any} */ (action) : { action, ...(payload || {}) };
    const p = chrome.runtime.sendMessage(msg).catch((e) => {
      throw new Error(`消息失败 ${msg.action}: ${String((e && e.message) || e)}`);
    });
    if (!timeout) return p;
    return Promise.race([
      p,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`消息超时: ${msg.action} (>${timeout}ms)`)), timeout)
      )
    ]);
  }

  global.__GR_MSG__ = { sendMessage };
})(typeof globalThis !== 'undefined' ? globalThis : this);
