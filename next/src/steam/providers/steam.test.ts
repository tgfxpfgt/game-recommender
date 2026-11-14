import { describe, expect, it } from 'vitest';
import { createSteamProvider } from './steam.js';

/** fetch 桩：URL 路由 + 调用计数（桩只模拟响应内容；URL 参与断言） */
function mockFetch(routes: Array<{ match: RegExp; body: unknown; status?: number }>) {
  const calls: string[] = [];
  const impl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    const hit = routes.find((r) => r.match.test(url));
    if (!hit) throw new Error(`stub 缺路由: ${url}`);
    return new Response(JSON.stringify(hit.body), { status: hit.status ?? 200 });
  };
  return { calls, impl };
}

const SEARCH_OK = {
  items: [
    { type: 'app', name: 'Elden Ring', id: 1245620 },
    { type: 'app', name: 'Elden Ring Deluxe', id: 999 }
  ]
};
const REVIEWS_ALL = { query_summary: { total_reviews: 712340, total_positive: 669597, total_negative: 42743 } };
const REVIEWS_RECENT = { query_summary: { total_reviews: 8210, total_positive: 7553 } };

function steamRoutes(): Array<{ match: RegExp; body: unknown }> {
  return [
    { match: /storesearch.*Elden%20Ring/, body: SEARCH_OK },
    { match: /storesearch.*elden/, body: SEARCH_OK },
    { match: /appreviews\/1245620.*filter=recent/, body: REVIEWS_RECENT },
    { match: /appreviews\/1245620/, body: REVIEWS_ALL }
  ];
}

describe('SteamProvider', () => {
  it('storesearch → 择优 → appreviews 全量+近期（好评率与近期率正确）', async () => {
    const { calls, impl } = mockFetch(steamRoutes());
    const p = createSteamProvider({ fetchImpl: impl, minIntervalMs: 0 });
    const r = await p.resolve(['艾尔登法环|Elden Ring|官方中文']);
    const hit = r[0];
    if (!hit || hit.kind !== 'steam') throw new Error(`期望 steam 命中，实际 ${JSON.stringify(hit)}`);
    expect(hit.appId).toEqual(1245620);
    expect(hit.positiveRate).toEqual(94);
    expect(hit.recent).toEqual({ rate: 92, total: 8210 });
    expect(hit.confidence).toEqual('confirmed');
    expect(calls.some((u) => u.includes('storesearch'))).toBe(true);
    expect(calls.filter((u) => u.includes('appreviews')).length).toEqual(2);
  });

  it('零相关候选 → not-found 并入负缓存（第二次零出站）', async () => {
    const { calls, impl } = mockFetch([
      { match: /storesearch/, body: { items: [{ type: 'app', name: ' Totally Different', id: 42 }] } }
    ]);
    const p = createSteamProvider({ fetchImpl: impl, minIntervalMs: 0 });
    const r1 = await p.resolve(['绝对不存在的游戏']);
    expect(r1[0]?.kind).toEqual('not-found');
    const before = calls.length;
    const r2 = await p.resolve(['绝对不存在的游戏']);
    expect(r2[0]?.kind).toEqual('not-found');
    expect(calls.length).toEqual(before); // 负缓存命中：零出站
  });

  it('零评测形态 → positiveRate null（暂无整体评价语义）', async () => {
    const { impl } = mockFetch([
      { match: /storesearch/, body: { items: [{ type: 'app', name: 'Elden Ring', id: 1 }] } },
      { match: /appreviews/, body: { query_summary: { total_reviews: 0, total_positive: 0 } } }
    ]);
    const p = createSteamProvider({ fetchImpl: impl, minIntervalMs: 0 });
    const r = await p.resolve(['Elden Ring']);
    const hit = r[0];
    if (!hit || hit.kind !== 'steam') throw new Error(`期望 steam 命中，实际 ${JSON.stringify(hit)}`);
    expect(hit.positiveRate).toEqual(null);
  });

  it('熔断：连续 5 次网络失败 → 后续 circuit-open 零出站（快速失败）', async () => {
    let calls = 0;
    const impl: typeof fetch = async () => {
      calls++;
      throw new TypeError('fetch failed');
    };
    const p = createSteamProvider({ fetchImpl: impl, minIntervalMs: 0, breakerThreshold: 5, breakerOpenMs: 60_000 });
    for (let i = 0; i < 5; i++) {
      const r = await p.resolve([`Elden Ring 尝试${i}`]);
      expect(r[0]?.kind).toEqual('failed');
    }
    const before = calls;
    const r = await p.resolve(['Elden Ring 尝试最终']);
    expect(r[0]).toEqual({ kind: 'failed', title: 'Elden Ring 尝试最终', error: 'ratelimit' });
    expect(calls).toEqual(before); // 熔断开启：零出站
  });
});
