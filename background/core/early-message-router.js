/**
 * 游戏雷达 Game Radar - 早期消息路由 / Early Message Router
 *
 * v14.7 批次 7（SW 首消息快路径）：MV3 SW 冷启动时全部静态 import 求值完成
 * 后入口体才注册 onMessage（GRAPH_READY_MS 300-500ms+）——该窗口到达的首
 * 消息要么等 SW 重启要么排队无门。本模块被 service-worker.js **最先**
 * import（ESM 依赖图按 import 顺序求值——本模块体先于全部重依赖运行），
 * 顶层即注册 onMessage：图就绪前到达的消息排队冲放，语义与旧路径一致
 *（flush 发生在 handleMessage 可用之后，处理器全依赖就绪）。
 * Early router registered at module top level; messages arriving during
 * module-graph evaluation queue here and flush once the real handler attaches.
 */

/** @type {Array<[any, any, (resp: any) => void]>} */
const earlyQueue = [];
/** @type {((msg: any, sender: any) => Promise<any>)|null} */
let realHandler = null;

/**
 * 图就绪后由入口调用：接管后续消息并冲放积压队列。
 * Attach the real handler and flush the early queue.
 * @param {(msg: any, sender: any) => Promise<any>} handler
 */
export function attachEarlyMessageRouter(handler) {
  realHandler = handler;
  const pending = earlyQueue.splice(0);
  for (const [msg, sender, sendResponse] of pending) {
    Promise.resolve()
      .then(() => handler(msg, sender))
      .then(sendResponse)
      .catch((err) => {
        console.error('消息处理错误:', err);
        sendResponse({ error: err && err.message });
      });
  }
}

// 顶层注册（本模块是依赖图首个求值点）/ Top-level registration (first
// evaluated module in the graph).
/** @param {any} message @param {any} sender @param {(resp: any) => void} sendResponse */
function onMessage(message, sender, sendResponse) {
  if (realHandler) {
    realHandler(message, sender)
      .then(sendResponse)
      .catch((err) => {
        console.error('消息处理错误:', err);
        sendResponse({ error: err && err.message });
      });
    return true; // 保持消息通道开放 / keep the message channel open
  }
  // 图就绪前到达：排队保活通道，attach 后冲放应答 / Queue until attach.
  earlyQueue.push([message, sender, sendResponse]);
  return true;
}
chrome.runtime.onMessage.addListener(onMessage);
