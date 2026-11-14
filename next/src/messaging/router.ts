/**
 * game-radar v2 — 后台消息路由（类型化 + fail-closed）
 * Typed router: unknown actions are rejected by default (fail-closed, kept
 * from the old doctrine); handlers get exact req/res types.
 */
import type { ActionName, AnyMessage, MessageMap } from './protocol.js';

/** 单个动作处理器：入参已按协议收敛，返回即响应体 */
export type Handler<A extends ActionName> = (
  req: MessageMap[A]['req'],
  sender: chrome.runtime.MessageSender
) => Promise<MessageMap[A]['res']> | MessageMap[A]['res'];

type AnyHandler = (req: any, sender: chrome.runtime.MessageSender) => Promise<unknown> | unknown;

/** 创建路由：register 时的泛型保证 handler 形状与协议一致 */
export class Router {
  private readonly handlers = new Map<ActionName, AnyHandler>();

  register<A extends ActionName>(action: A, handler: Handler<A>): void {
    this.handlers.set(action, handler as AnyHandler);
  }

  /** chrome.runtime.onMessage 监听器（恒 async-true：全部走 promise 应答） */
  listener(): (msg: unknown, sender: chrome.runtime.MessageSender) => Promise<unknown> {
    return async (raw: unknown, sender) => {
      const msg = raw as Partial<AnyMessage>;
      if (!msg || typeof msg.action !== 'string') {
        return { error: 'bad-message: 缺 action' };
      }
      const handler = this.handlers.get(msg.action as ActionName);
      if (!handler) {
        return { error: `unknown-action: ${msg.action}` };
      }
      try {
        return await handler(msg as any, sender);
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    };
  }
}
