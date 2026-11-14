import { describe, expect, it } from 'vitest';
import { Pipeline } from './pipeline.js';

describe('Pipeline', () => {
  it('平台识别零网络短路（提供方不被调用）', async () => {
    let calls = 0;
    const p = new Pipeline({
      id: 'spy',
      async resolve(t) {
        calls++;
        return t.map((title) => ({ kind: 'not-found', title }));
      }
    });
    const r = await p.resolve(['塞尔达传说|模拟器整合', '巫师3']);
    expect(calls).toEqual(1); // 仅巫师3（PC）进了提供方
    expect(r['塞尔达传说|模拟器整合']?.kind).toEqual('platform');
  });

  it('正缓存命中计入 cacheHits；failed 不缓存（失败未知语义）', async () => {
    let flip = false;
    const p = new Pipeline({
      id: 'flaky',
      async resolve(t) {
        return t.map((title) => {
          flip = !flip;
          return flip
            ? { kind: 'steam', title, appId: 1, name: 'X', positiveRate: 90, totalReviews: 10, recent: null, confidence: 'confirmed', reason: '' }
            : { kind: 'failed', title, error: 'network' };
        });
      }
    });
    await p.resolve(['A']);
    const r2 = await p.resolve(['A', 'B']);
    expect(r2['A']?.kind).toEqual('steam'); // 缓存命中
    expect(r2['B']?.kind).toEqual('failed');
    const again = await p.resolve(['B']);
    expect(again['B']?.kind).toEqual('steam'); // B 未被缓存 → 提供方重试成功
    const s = p.getStats();
    expect(s.cacheHits).toEqual(1);
  });

  it('提供方抛错 → 全批 failed（失败未知，不写入缓存）', async () => {
    const p = new Pipeline({
      id: 'throwing',
      async resolve() {
        throw new Error('boom');
      }
    });
    const r = await p.resolve(['X', 'Y']);
    expect(r['X']).toEqual({ kind: 'failed', title: 'X', error: 'network' });
    expect(r['Y']).toEqual({ kind: 'failed', title: 'Y', error: 'network' });
    const r2 = await p.resolve(['X']);
    expect(r2['X']?.kind).toEqual('failed'); // 未缓存，重试仍走提供方
  });
});
