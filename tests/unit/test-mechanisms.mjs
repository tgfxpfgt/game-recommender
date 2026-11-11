/**
 * 游戏雷达 Game Radar - background/core/mechanisms 单测
 *
 * v10.7.0 批次1：机制工厂四件套（withLock/debounce/createTtlCache/withRetry）
 * ——收编 17 份同构实现后的行为契约测试。
 */
import { describe, it, expect, vi } from 'vitest';
import { withLock, debounce, createTtlCache, withRetry, withWatchdog } from '../../background/core/mechanisms.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('mechanisms（批次1 机制工厂）', () => {
  it('withLock：并发任务串行执行且错误不阻塞后续', async () => {
    const locked = withLock();
    const order = [];
    const t1 = locked(async () => {
      await sleep(30);
      order.push('a');
      return 1;
    });
    const t2 = locked(async () => {
      order.push('b');
      return 2;
    });
    const t3 = locked(async () => {
      order.push('c');
      throw new Error('boom');
    });
    const t4 = locked(async () => order.push('d'));
    expect(await t1).toEqual(1);
    expect(await t2).toEqual(2);
    await expect(t3).rejects.toThrow('boom');
    await t4; // 前序抛错不得阻塞后续任务
    expect(order).toEqual(['a', 'b', 'c', 'd']);
  });

  it('debounce：尾缘触发 + flush/cancel', async () => {
    let calls = 0;
    const fn = debounce((v) => {
      calls += v;
    }, 20);
    fn(1);
    fn(2); // 尾缘：只触发一次，取最后参数
    await sleep(40);
    expect(calls).toEqual(2);
    fn(5);
    fn.flush(); // 立即触发
    expect(calls).toEqual(7);
    fn(9);
    fn.cancel(); // 取消
    await sleep(30);
    expect(calls).toEqual(7);
  });

  it('debounce maxWaitMs：连续调用也必须在上界内落盘（v14.28.4 日志留存）', async () => {
    const t0 = Date.now();
    /** @type {number[]} */
    const fires = [];
    const fn = debounce(() => fires.push(Date.now() - t0), 20, { maxWaitMs: 50 });
    // 每 10ms 调一次（< 20ms 窗，纯防抖会一直被推迟 → 全程不触发）
    while (Date.now() - t0 < 120) {
      fn();
      await sleep(10);
    }
    // 上界契约：首个触发不得晚于 maxWaitMs + 调度抖动（纯防抖此时为 0 次）
    expect(fires.length).toBeGreaterThanOrEqual(1);
    expect(fires[0]).toBeLessThanOrEqual(50 + 40);
    fn.cancel();
  });

  it('createTtlCache：过期惰性清除 / null 负缓存 / LRU 容量', async () => {
    let t = 1000;
    const cache = createTtlCache({ ttlMs: 100, max: 2, now: () => t });
    cache.set('a', null); // null 负缓存：peek 区分命中（null）与未命中（undefined）
    expect(cache.peek('a')).toEqual(null);
    t += 101;
    expect(cache.peek('a')).toEqual(undefined); // 过期清除
    cache.set('x', 1);
    cache.set('y', 2);
    cache.set('z', 3); // 超容量 → 淘汰最旧 x
    expect(cache.peek('x')).toEqual(undefined);
    expect(cache.peek('y')).toEqual(2);
    expect(cache.peek('z')).toEqual(3);
    expect(cache.size).toEqual(2);
  });

  it('withRetry：重试次数/退避间隔/onRetry 回调/成功即返', async () => {
    const sleeps = [];
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error('fail-' + attempts);
        return 'ok';
      },
      { retries: 3, delayMs: 10, backoff: 2, sleep: async (ms) => sleeps.push(ms) }
    );
    expect(result).toEqual('ok');
    expect(attempts).toEqual(3);
    expect(sleeps).toEqual([10, 20]); // 指数退避
  });

  it('withRetry：超出次数抛最后错误', async () => {
    const err = await withRetry(
      async () => {
        throw new Error('always');
      },
      { retries: 1, sleep: async () => {} }
    ).catch((e) => e);
    expect(err.message).toEqual('always');
  });

  // v14.28.6 R4-A：看门狗两级阈值（软阈值只告警、硬阈值才放弃）
  it('withWatchdog：软阈值只告警不结算，任务照常完成', async () => {
    const warns = [];
    const r = await withWatchdog(
      async () => {
        await sleep(80);
        return 'done';
      },
      {
        label: 'gameX',
        softMs: 20,
        hardMs: 200,
        onSoftWarn: (info) => warns.push(info)
      }
    );
    expect(r).toEqual('done');
    expect(warns.length).toEqual(1);
    expect(warns[0].label).toEqual('gameX');
    expect(warns[0].elapsedMs).toBeGreaterThanOrEqual(20);
  });

  it('withWatchdog：硬阈值放弃并返回超时标记，任务异常正常透传', async () => {
    const timeouts = [];
    const r = await withWatchdog(() => new Promise(() => {}), {
      label: 'stuck',
      softMs: 10,
      hardMs: 30,
      onSoftWarn: () => {},
      onTimeout: (info) => timeouts.push(info)
    });
    expect(r.__watchdogTimeout).toEqual(true);
    expect(r.label).toEqual('stuck');
    expect(timeouts.length).toEqual(1);
    await expect(
      withWatchdog(
        async () => {
          throw new Error('boom');
        },
        { hardMs: 1000 }
      )
    ).rejects.toThrow('boom');
  });

  it('withLock 超时：排队项不执行 task 且链继续推进', async () => {
    const locked = withLock();
    const order = [];
    const holder = locked(async () => {
      await sleep(60);
      order.push('holder');
    });
    const opts = { timeoutMs: 15, label: 'flush' };
    const timedOut = locked(async () => order.push('late'), opts);
    const after = locked(async () => order.push('after'));
    await expect(timedOut).rejects.toThrow('锁等待超时');
    await holder;
    await after;
    // 超时项在轮到时被取消（不得迟到执行），后续任务不受影响
    expect(order).toEqual(['holder', 'after']);
  });

  it('withLock 告警：等待超过 warnMs 告警一次，任务仍执行', async () => {
    const locked = withLock();
    const warns = [];
    const holder = locked(async () => {
      await sleep(50);
    });
    const r = await locked(async () => 'ok', {
      warnMs: 10,
      label: 'db-write',
      onWarn: (info) => warns.push(info)
    });
    expect(r).toEqual('ok');
    expect(warns.length).toEqual(1);
    expect(warns[0].label).toEqual('db-write');
    await holder;
  });
});

// ============ v12 B1：Steam 接口熔断器（per-domain + 半开探测） ============
import { recordDomainCall, isCircuitOpen, circuitState, resetDomainStatus } from '../../background/core/api-monitor.js';
describe('api-monitor 熔断器（v12 B1 per-domain）', () => {
  it('连续 5 次网络级失败 → 该域熔断；另一域不受连坐', () => {
    resetDomainStatus();
    expect(isCircuitOpen('store')).toEqual(false);
    for (let i = 0; i < 4; i++) recordDomainCall('store', false);
    expect(isCircuitOpen('store')).toEqual(false); // 未达阈值
    recordDomainCall('store', true); // 成功复位连败
    for (let i = 0; i < 5; i++) recordDomainCall('store', false);
    expect(isCircuitOpen('store')).toEqual(true); // 熔断
    expect(isCircuitOpen('api')).toEqual(false); // api 域不连坐
  });

  it('半开探测：到期放行 1 个请求，失败重开/成功闭合', () => {
    resetDomainStatus();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00'));
    for (let i = 0; i < 5; i++) recordDomainCall('api', false);
    expect(isCircuitOpen('api')).toEqual(true);
    vi.setSystemTime(new Date('2026-01-01T00:01:01')); // 61s 后到期
    expect(isCircuitOpen('api')).toEqual(false); // 半开放行探测
    recordDomainCall('api', false); // 探测失败 → 立即重开
    expect(circuitState('api')).toEqual('open');
    vi.setSystemTime(new Date('2026-01-01T00:02:02'));
    expect(isCircuitOpen('api')).toEqual(false); // 再次半开
    recordDomainCall('api', true); // 探测成功 → 闭合
    expect(circuitState('api')).toEqual('closed');
    vi.useRealTimers();
    resetDomainStatus();
  });

  // v14.7 批次 1（A-P3）：半开单探测令牌——并发场景仅放行 1 个探测
  it('半开单探测：探测进行中其余并发调用者仍被短路', () => {
    resetDomainStatus();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00'));
    for (let i = 0; i < 5; i++) recordDomainCall('store', false);
    expect(isCircuitOpen('store')).toEqual(true);
    vi.setSystemTime(new Date('2026-01-01T00:01:01')); // 到期
    expect(isCircuitOpen('store')).toEqual(false); // 首个调用者 = 探测请求
    expect(circuitState('store')).toEqual('half-open');
    // 探测未 resolve 期间（recordDomainCall 未调用），并发调用者全部短路
    expect(isCircuitOpen('store')).toEqual(true);
    expect(isCircuitOpen('store')).toEqual(true);
    recordDomainCall('store', true); // 探测成功 → 闭合，令牌回收
    expect(isCircuitOpen('store')).toEqual(false);
    expect(circuitState('store')).toEqual('closed');
    vi.useRealTimers();
    resetDomainStatus();
  });
});

// v14.7 批次 1（A-P3）：DOMAIN_WINDOW 真滑动窗口——滑出窗口的成功要衰减 ok，
// 饱和后连续失败必须能报 'down'（原钳制实现恒报 'ok'）。
describe('api-monitor DOMAIN_WINDOW 滑动窗口', () => {
  it('8 成功饱和后连续 8 失败 → down（旧钳制会恒 ok）', async () => {
    const monitor = await import('../../background/core/api-monitor.js');
    monitor.resetDomainStatus();
    for (let i = 0; i < 8; i++) monitor.recordDomainCall('store', true);
    expect(monitor.getDomainStatus().store).toEqual('ok');
    for (let i = 0; i < 8; i++) monitor.recordDomainCall('store', false);
    expect(monitor.getDomainStatus().store).toEqual('down');
    monitor.resetDomainStatus();
  });
});
