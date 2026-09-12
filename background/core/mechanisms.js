// @ts-strict
/**
 * 游戏雷达 Game Radar - 通用机制工厂 / Generic Mechanism Factories
 *
 * v10.7.0 批次1：收敛全项目同构实现——promise 串行锁（5 份）、防抖（4 份）、
 * Map+TTL 内存缓存（4 份）、重试（散装 4+ 处）统一为可注入时钟的纯函数工厂，
 * 供 storage/steam/freegames 各层复用；新代码一律引用本文件，不再手写同构。
 * Consolidates the duplicated lock/debounce/TTL-cache/retry implementations
 * into clock-injectable pure factories; new code must use these.
 */

/**
 * 串行互斥锁工厂（promise 链）——同刻只允许一个 task 在临界区内。
 * Serial mutex via promise chaining; one task inside the critical section.
 * @returns {<T>(task: () => Promise<T>) => Promise<T>}
 */
export function withLock() {
  /** @type {Promise<void>} */
  let tail = Promise.resolve();
  return function locked(/** @type {() => Promise<any>} */ task) {
    const run = tail.then(() => task());
    // 链推进与错误隔离：前序失败不阻塞后续任务
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}

/**
 * 防抖工厂（尾缘触发）。返回的函数带 flush()/cancel()（测试/卸载用）。
 * Trailing-edge debounce; the wrapped fn gains flush()/cancel().
 * @param {(...args: any[]) => void} fn
 * @param {number} waitMs
 * @returns {((...args: any[]) => void) & { flush: () => void, cancel: () => void }}
 */
export function debounce(fn, waitMs) {
  /** @type {ReturnType<typeof setTimeout>|null} */
  let timer = null;
  /** @type {any[]} */
  let lastArgs = [];
  /** @param {any[]} args */
  const wrapped = (...args) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...lastArgs);
    }, waitMs);
  };
  wrapped.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      fn(...lastArgs);
    }
  };
  wrapped.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return wrapped;
}

/**
 * 内存 TTL 缓存工厂（惰性过期 + 可选容量上限 LRU 淘汰）。
 * 支持缓存 null 值（负缓存）——命中与否以 has/peek 返回为准，值可为 null。
 * In-memory TTL cache (lazy expiry, optional LRU cap); null values allowed
 * (negative caching) — presence is signalled by peek() !== undefined.
 * @template V
 * @param {{ ttlMs: number, max?: number, now?: () => number }} options
 */
export function createTtlCache({ ttlMs, max = 0, now = () => Date.now() }) {
  /** @type {Map<string, { v: V, t: number }>} */
  const map = new Map();
  function evictIfNeeded() {
    while (max > 0 && map.size > max) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }
  return {
    /** 存在且未过期 → 值（可为 null）；否则 undefined 并惰性清除 */
    peek(key) {
      const e = map.get(key);
      if (!e) return undefined;
      if (now() - e.t >= ttlMs) {
        map.delete(key);
        return undefined;
      }
      // LRU 触点：命中后移到队尾
      map.delete(key);
      map.set(key, e);
      return e.v;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, { v: value, t: now() });
      evictIfNeeded();
    },
    delete(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    }
  };
}

/**
 * 重试工厂（固定/指数退避，可注入时钟便于单测）。
 * task 抛错时重试 retries 次（不含首跑）；delayMs > 0 且 backoff > 1 时指数退避。
 * Retry with fixed/exponential backoff and injectable clock.
 * @template T
 * @param {(attempt: number) => Promise<T>} task
 * @param {{ retries?: number, delayMs?: number, backoff?: number, onRetry?: (err: unknown, attempt: number) => void, sleep?: (ms: number) => Promise<void> }} [options]
 * @returns {Promise<T>}
 */
export async function withRetry(task, options = {}) {
  const { retries = 1, delayMs = 0, backoff = 2, onRetry } = options;
  // sleep 可注入（测试零等待）/ injectable sleep (zero-delay in tests)
  const sleep = options.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await task(attempt);
    } catch (e) {
      lastErr = e;
      if (attempt >= retries) break;
      if (onRetry) onRetry(e, attempt + 1);
      if (delayMs > 0) await sleep(delayMs * Math.pow(backoff, attempt));
    }
  }
  throw lastErr;
}
