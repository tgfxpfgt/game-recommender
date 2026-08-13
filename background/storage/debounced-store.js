/**
 * Game Recommender - 防抖写入工厂 / Debounced-Store Factory
 *
 * v5.1.0：收敛 storage 层"定时器 + flush + 错误打印"同构模式。
 * 工厂返回 { scheduleWrite, flush, reset }；save 由调用方提供
 *（内存 → dataStore.writeModule 的具体逻辑）。
 * Collapses the storage layer's debounced-write boilerplate (timer + flush +
 * error logging). save is provided by the caller.
 */
'use strict';

export function createDebouncedStore({ name, save, debounceMs }) {
  /** @type {ReturnType<typeof setTimeout>|null} */
  let timer = null;

  // 防抖排程：debounceMs 内重复调用只触发一次写入 / schedule a write
  function scheduleWrite() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      try {
        await save();
      } catch (e) {
        console.error(`${name}写入失败:`, String(e));
      }
    }, debounceMs);
  }

  // 强制立即写入（外部显式 flush 后清除定时器）/ force an immediate write
  async function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    await save();
  }

  // 取消挂起写入（重置/测试用）/ cancel a pending write
  function reset() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return { scheduleWrite, flush, reset };
}
