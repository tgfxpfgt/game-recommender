/**
 * 游戏雷达 Game Radar - 防抖写入工厂 / Debounced-Store Factory
 *
 * v5.1.0：收敛 storage 层"定时器 + flush + 错误打印"同构模式。
 * 工厂返回 { scheduleWrite, flush, reset }；save 由调用方提供
 *（内存 → dataStore.writeModule 的具体逻辑）。
 * Collapses the storage layer's debounced-write boilerplate (timer + flush +
 * error logging). save is provided by the caller.
 *
 * v14.2.0（补充轮 P1-1）：防抖排程改用 mechanisms.debounce 工厂（此前手写
 * timer + clearTimeout 与工厂同构，9 个存储模块共用这份重复实现）。对外形状
 * 与语义不变——flush 仍是"取消挂起 + 无条件保存"（比 debounce.flush 的
 * "仅有挂起时触发"更强，调用方依赖该语义），错误日志保留在工厂内。
 */
'use strict';

import { debounce } from '../core/mechanisms.js';

export function createDebouncedStore({ name, save, debounceMs }) {
  // 防抖排程：debounceMs 内重复调用只触发一次写入；save 的失败日志在此统一打印
  const debouncedSave = debounce(() => {
    Promise.resolve(save()).catch((e) => console.error(`${name}写入失败:`, String(e)));
  }, debounceMs);

  // 强制立即写入（取消挂起 + 无条件保存）/ force an immediate write
  async function flush() {
    debouncedSave.cancel();
    await save();
  }

  // 取消挂起写入（重置/测试用）/ cancel a pending write
  function reset() {
    debouncedSave.cancel();
  }

  return { scheduleWrite: debouncedSave, flush, reset };
}
