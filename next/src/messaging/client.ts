/**
 * game-radar v2 — 内容/页面侧类型化客户端
 * Typed client: send<A>() is compile-checked against the protocol.
 */
import type { ActionName, MessageMap } from './protocol.js';

const DEFAULT_TIMEOUT_MS = 10_000;

/** 发送一条协议内消息（超时 + 错误归一） */
export async function send<A extends ActionName>(
  action: A,
  req: MessageMap[A]['req'],
  opts: { timeoutMs?: number } = {}
): Promise<MessageMap[A]['res']> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise<MessageMap[A]['res']>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${action} ${timeoutMs}ms`)), timeoutMs);
    try {
      chrome.runtime.sendMessage({ action, ...req }, (raw) => {
        clearTimeout(timer);
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        const res = raw as { error?: string } & MessageMap[A]['res'];
        if (res && typeof res === 'object' && 'error' in res && res.error) {
          reject(new Error(String(res.error)));
          return;
        }
        resolve(res as MessageMap[A]['res']);
      });
    } catch (e) {
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}
