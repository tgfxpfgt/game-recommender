/**
 * 游戏雷达 Game Radar - 测试：早期消息路由（批次 7）
 *
 * v14.7 批次 7：early-message-router 的三段语义——attach 前排队（通道保活
 * return true）、attach 时冲放积压、attach 后直通。SW 首消息快路径的契约
 * 锚点：图就绪窗口到达的消息不丢、应答不悬空。
 * Early-router semantics: queue before attach, flush on attach, direct after.
 */
import { describe, test, expect } from 'vitest';

// chrome 桩须先于模块导入（模块顶层即注册监听器）
const listeners = [];
globalThis.chrome = {
  runtime: {
    onMessage: {
      addListener: (cb) => listeners.push(cb)
    }
  }
};

const { attachEarlyMessageRouter } = await import('../../background/core/early-message-router.js');

describe('early-message-router（SW 首消息快路径）', () => {
  test('attach 前到达的消息排队，attach 后冲放应答', async () => {
    expect(listeners.length).toEqual(1);
    const listener = listeners[0];
    /** @type {any[]} */
    const responses = [];
    // 图未就绪：两条消息到达 → 排队，返回 true（通道保活）
    const p1 = new Promise((res) => {
      const keepOpen = listener({ action: 'GET_SETTINGS' }, {}, (r) => res(r));
      expect(keepOpen).toEqual(true);
    });
    const p2 = new Promise((res) => {
      listener({ action: 'GET_API_STATUS' }, {}, (r) => res(r));
    });
    p2.then((r) => responses.push(r));
    // 图就绪：接管并冲放 / attach flushes the queue
    attachEarlyMessageRouter(async (msg) => ({ echo: msg.action, ok: true }));
    expect(await p1).toEqual({ echo: 'GET_SETTINGS', ok: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(responses[0]).toEqual({ echo: 'GET_API_STATUS', ok: true });
  });

  test('attach 后消息直通（不再排队）+ 处理器异常应答 error', async () => {
    const listener = listeners[0];
    // 重新 attach（模块允许接管替换）——本处理器对 BOOM 抛错
    attachEarlyMessageRouter(async (msg) => {
      if (msg.action === 'BOOM') throw new Error('boom');
      return { echo: msg.action, ok: true };
    });
    const direct = await new Promise((res) => {
      listener({ action: 'PING' }, {}, (r) => res(r));
    });
    expect(direct).toEqual({ echo: 'PING', ok: true });
    const failed = await new Promise((res) => {
      listener({ action: 'BOOM' }, {}, (r) => res(r));
    });
    expect(failed.error).toContain('boom');
  });
});
