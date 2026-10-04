// @ts-strict
/**
 * 游戏雷达 Game Radar - 存储健康指标 / Storage Health Metrics
 *
 * v10.0.0：各存储模块 flush 写失败计数（v9.7.0 引入回滚重试，失败此前只
 * console.error 不可见）+ OPFS/降级模式当前态，供 dashboard 存储健康卡片。
 * 计数器持久化到 storage.session（诊断类数据，会话级即可；防抖落盘）。
 * Flush-failure counters per storage module plus the OPFS/fallback mode flag.
 * Counters persist to session storage (diagnostics; session-scoped is enough).
 */
import { createSessionPersist } from '../core/session-persist.js';
import { dataStore } from '../../data/data-store.js';

// v14 B5：显式标注 initial 形状——null 字面量会把 @template T 推窄成 null
/** @type {{steamCacheWriteFails: number, registryWriteFails: number, nameIndexWriteFails: number, urlIndexWriteFails: number, lastFailAt: number|null, lastFailModule: string|null}} */
const FLUSH_HEALTH_INITIAL = {
  steamCacheWriteFails: 0,
  registryWriteFails: 0,
  nameIndexWriteFails: 0,
  urlIndexWriteFails: 0,
  lastFailAt: null,
  lastFailModule: null
};
const persist = createSessionPersist('grFlushHealth', { initial: FLUSH_HEALTH_INITIAL });

// 记录一次 flush 写失败 / Record one flush write failure
export function recordFlushFailure(moduleName) {
  const counters = persist.peek();
  const key = String(moduleName || '').replace(/WriteFails$/, '') + 'WriteFails';
  if (key in counters) counters[key] = (counters[key] || 0) + 1;
  else counters[key] = 1;
  counters.lastFailAt = Date.now();
  counters.lastFailModule = String(moduleName || '');
  persist.scheduleSave();
}

// 读取存储健康（dashboard 用）/ Read storage health
export function getFlushHealth() {
  const counters = persist.peek();
  return { ...counters, opfsAvailable: !!dataStore.isOpfsAvailable() };
}

// 重置（测试/清理用）/ Reset
export function resetFlushHealth() {
  persist.reset();
}
