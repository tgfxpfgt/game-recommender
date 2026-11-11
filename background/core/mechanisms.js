// @ts-strict
/**
 * 游戏雷达 Game Radar - 通用机制工厂 / Generic Mechanism Factories
 *
 * v10.7.0 批次1：收敛全项目同构实现——promise 串行锁（5 份）、防抖（4 份）、
 * Map+TTL 内存缓存（4 份）、重试（散装 4+ 处）统一为可注入时钟的纯函数工厂，
 * 供 storage/steam/freegames 各层复用；新代码一律引用本文件，不再手写同构。
 * Consolidates the duplicated lock/debounce/TTL-cache/retry implementations
 * into clock-injectable pure factories; new code must use these.
 *
 * @invariant withLock 返回的锁禁止嵌套持有（同一锁链内再取锁 = 自死锁）；同一时刻至多持有一把锁
 * @invariant 时钟可注入（纯工厂）——模块不得直接 import Logger/Date.now 之外的运行环境依赖，告警出口由调用方注入
 */

/**
 * 串行互斥锁工厂（promise 链）——同刻只允许一个 task 在临界区内。
 * Serial mutex via promise chaining; one task inside the critical section.
 *
 * v14.30.0 R4-A（用户裁决：卡死不能无界等待）：`locked` 新增可选第二参数
 * `{ timeoutMs, warnMs, label, onWarn }`，**默认行为完全不变**（无超时）。
 * - timeoutMs > 0：排队超过该时长仍未轮到 → 调用方 reject `锁等待超时`；
 *   该排队项在前序释放后**不执行 task**（cancelled 标记），仅推进链——
 *   避免"调用方已放弃、任务迟到写入"。
 * - warnMs > 0 且提供 onWarn：等待超过该时长告警一次（携带 label 与已等时长），
 *   任务继续等待。模块保持纯（不 import Logger），告警出口由调用方注入。
 * 注意：锁持有者本身无限挂起时，本机制只能让**等待者**不再无界阻塞，链尾仍
 * 卡在持有者上——这是 JS 无法撤销 Promise 的固有边界，故持有者内部必须依赖
 * fetchWithTimeout 等自带超时的调用。
 * Optional queue-wait timeout (default off): the queued task is cancelled (never
 * runs later) and the caller rejects; a warn callback fires once past warnMs.
 * @returns {<T>(task: () => Promise<T>, opts?: { timeoutMs?: number, warnMs?: number, label?: string, onWarn?: (info: { label: string, waitedMs: number }) => void }) => Promise<T>}
 */
export function withLock() {
  /** @type {Promise<void>} */
  let tail = Promise.resolve();
  return function locked(task, opts = {}) {
    const timeoutMs = Math.max(0, Number(opts && opts.timeoutMs) || 0);
    const warnMs = Math.max(0, Number(opts && opts.warnMs) || 0);
    const label = (opts && opts.label) || '';
    const onWarn = opts && typeof opts.onWarn === 'function' ? opts.onWarn : null;
    const waitStart = Date.now();
    let released = false; // 已轮到本任务（此后超时/告警定时器一律失效）
    let cancelled = false;
    /** @type {ReturnType<typeof setTimeout>|null} */
    let waitTimer = null;
    /** @type {ReturnType<typeof setTimeout>|null} */
    let warnTimer = null;
    const clearTimers = () => {
      if (waitTimer) clearTimeout(waitTimer);
      if (warnTimer) clearTimeout(warnTimer);
      waitTimer = null;
      warnTimer = null;
    };
    const run = tail.then(() => {
      released = true;
      clearTimers();
      if (cancelled) throw new Error(`锁等待超时（${label || 'task'}）`);
      return task();
    });
    // 链推进与错误隔离：前序失败不阻塞后续任务
    tail = run.then(
      () => undefined,
      () => undefined
    );
    if (warnMs > 0 && onWarn) {
      warnTimer = setTimeout(() => {
        warnTimer = null;
        if (released || cancelled) return;
        try {
          onWarn({ label, waitedMs: Date.now() - waitStart });
        } catch {
          /* 告警出口异常不影响锁语义 */
        }
      }, warnMs);
    }
    if (timeoutMs > 0) {
      return new Promise((resolve, reject) => {
        waitTimer = setTimeout(() => {
          waitTimer = null;
          if (released) return;
          cancelled = true;
          clearTimers();
          reject(new Error(`锁等待超时（${label || 'task'}，已等 ${Date.now() - waitStart}ms）`));
        }, timeoutMs);
        run.then(resolve, reject);
      });
    }
    return run;
  };
}

/**
 * 单任务看门狗（两级阈值，纯工厂）。
 * Two-level watchdog: soft threshold only warns (keeps waiting), hard threshold
 * settles the awaited promise with a timeout marker.
 *
 * v14.30.0 R4-A（用户裁决）：**软阈值只告警留证、硬阈值才放弃**——误杀正常长
 * 任务的代价高于晚发现。与 withLock 不同，本工厂无法撤销底层 Promise（JS 固有
 * 边界），硬阈值只让**等待方**不再无界阻塞；被放弃的任务可能仍会完成并写缓存，
 * 调用方必须按"结果可能迟到"处理（幂等写入 + 不重复推送）。
 * @template T
 * @param {() => Promise<T>} task 被监控任务 / monitored task
 * @param {{ label?: string, softMs?: number, hardMs?: number,
 *   onSoftWarn?: (info: { label: string, elapsedMs: number, thresholdMs: number }) => void,
 *   onTimeout?: (info: { label: string, elapsedMs: number, thresholdMs: number }) => void }} [opts]
 * @returns {Promise<T | { __watchdogTimeout: true, label: string, elapsedMs: number, thresholdMs: number }>}
 */
export function withWatchdog(task, opts = {}) {
  const label = opts.label || '';
  const softMs = Math.max(0, Number(opts.softMs) || 0);
  const hardMs = Math.max(0, Number(opts.hardMs) || 0);
  const onSoftWarn = typeof opts.onSoftWarn === 'function' ? opts.onSoftWarn : null;
  const onTimeout = typeof opts.onTimeout === 'function' ? opts.onTimeout : null;
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;
    /** @type {ReturnType<typeof setTimeout>|null} */
    let softTimer = null;
    /** @type {ReturnType<typeof setTimeout>|null} */
    let hardTimer = null;
    const clearTimers = () => {
      if (softTimer) clearTimeout(softTimer);
      if (hardTimer) clearTimeout(hardTimer);
      softTimer = null;
      hardTimer = null;
    };
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimers();
      fn(value);
    };
    if (softMs > 0 && onSoftWarn) {
      softTimer = setTimeout(() => {
        softTimer = null;
        if (settled) return;
        try {
          onSoftWarn({ label, elapsedMs: Date.now() - startedAt, thresholdMs: softMs });
        } catch {
          /* 告警出口异常不改变任务语义 */
        }
      }, softMs);
    }
    if (hardMs > 0) {
      hardTimer = setTimeout(() => {
        hardTimer = null;
        if (settled) return;
        const info = { label, elapsedMs: Date.now() - startedAt, thresholdMs: hardMs };
        settle(resolve, { __watchdogTimeout: /** @type {const} */ (true), ...info });
        if (onTimeout) {
          try {
            onTimeout(info);
          } catch {
            /* 超时出口异常不影响已结算结果 */
          }
        }
      }, hardMs);
    }
    Promise.resolve()
      .then(task)
      .then(
        (v) => settle(resolve, v),
        (e) => settle(reject, e)
      );
  });
}

/**
 * 防抖工厂（尾缘触发）。返回的函数带 flush()/cancel()（测试/卸载用）。
 * Trailing-edge debounce; the wrapped fn gains flush()/cancel().
 * @param {(...args: any[]) => void} fn
 * @param {number} waitMs
 * @returns {((...args: any[]) => void) & { flush: () => void, cancel: () => void }}
 */
export function debounce(fn, waitMs, { maxWaitMs = 0 } = {}) {
  /** @type {ReturnType<typeof setTimeout>|null} */
  let timer = null;
  /** 首个待触发调用的时间戳（maxWait 计时起点）/ first pending call timestamp */
  let pendingSince = 0;
  /** @type {any[]} */
  let lastArgs = [];
  /** @param {any[]} args */
  const wrapped = (...args) => {
    lastArgs = args;
    const now = Date.now();
    if (!pendingSince) pendingSince = now;
    if (timer) clearTimeout(timer);
    // v14.29.1：maxWaitMs > 0 时给连续调用设上界——纯防抖在持续调用下会无限
    // 推迟（日志这类"调用流不断"的场景，崩溃前可能整窗日志未落盘）。
    // Bounded wait: pure debounce postpones forever under a continuous call
    // stream; maxWaitMs caps how long the first call may wait.
    const delay = maxWaitMs > 0 ? Math.min(waitMs, Math.max(0, pendingSince + maxWaitMs - now)) : waitMs;
    timer = setTimeout(() => {
      timer = null;
      pendingSince = 0;
      fn(...lastArgs);
    }, delay);
  };
  wrapped.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      pendingSince = 0;
      fn(...lastArgs);
    }
  };
  wrapped.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      pendingSince = 0;
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
 * v10.7.1 注记：当前为**预留 API**（存量重试点为"候选名降级序列"等业务语义
 * 流程，非同构 retry，未强收编）——新代码需要重试一律用本工厂，不再手写。
 * task 抛错时重试 retries 次（不含首跑）；delayMs > 0 且 backoff > 1 时指数退避。
 * Retry with fixed/exponential backoff and injectable clock. Reserved API:
 * existing retry sites are business-level degradation sequences; new code
 * must use this factory instead of hand-rolling.
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

// v14.12 B4（报告 B P2-04）：LRU 裁剪单源——llm-cache ×2 / search-cache 三份
// 手写"全量排序 + 逐个删除"拷贝收敛于此（保守按 entry.ts 升序裁剪，兼容
// ts 缺失的旧条目；返回裁剪条数）。
/**
 * 按 entry.ts 升序裁剪 Map 至 max 条（原位修改）。
 * @template {{ts?: number}} V
 * @param {Map<string, V>} map
 * @param {number} max
 * @returns {number} 裁剪条数
 */
export function evictOldestByTs(map, max) {
  if (!max || map.size <= max) return 0;
  const entries = [...map.entries()].sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
  let evicted = 0;
  for (let i = 0; i < map.size - max; i++) {
    map.delete(entries[i][0]);
    evicted++;
  }
  return evicted;
}
