/**
 * 游戏雷达 Game Radar - background/core/mechanisms 单测
 *
 * v10.7.0 批次1：机制工厂四件套（withLock/debounce/createTtlCache/withRetry）
 * ——收编 17 份同构实现后的行为契约测试。
 */
import { describe, it, expect } from 'vitest';
import { withLock, debounce, createTtlCache, withRetry } from '../../background/core/mechanisms.js';

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
});
