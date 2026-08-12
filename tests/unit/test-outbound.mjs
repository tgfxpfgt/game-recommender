import { test, expect, describe, beforeAll, afterAll } from 'vitest';
/**
 * Game Recommender - 测试：出站审计与限速 / Outbound Audit & Rate Limit Tests
 *
 * v3.4.1：验证 outbound-audit 环形缓冲/统计/限速窗口，以及
 * fetchWithTimeout 的审计接入（成功/网络错误/被拦截/被限速四条路径）。
 * v6.1.1：结构化重写——准备移入 beforeAll/各 test（check 线性脚本的
 * 顶层准备在 vitest 收集阶段全部提前执行，断言运行阶段读到最终状态）。
 * Verifies the audit ring buffer, stats, rate-limit window, and the four
 * fetchWithTimeout audit paths (ok / network error / blocked / rate-limited).
 */
'use strict';

// 注意：outbound-audit 必须不带查询参数导入——utils.js 内部以静态 import
// 引用它（无参数 URL），带 ?t= 会生成独立模块实例，审计状态互不可见。
// The audit module must be imported WITHOUT a cache-busting query — utils.js
// references it via a static (parameter-less) import; a ?t= URL would create a
// second module instance whose audit state the tests cannot see.
const mod = await import(new URL('../../background/core/outbound-audit.js', import.meta.url).href);
const utils = await import(new URL('../../background/core/utils.js', import.meta.url).href + '?t=' + Date.now());
const { AUDIT_MAX, RATE_WINDOW_MS, RATE_MAX, recordOutbound, getOutboundAudit, resetOutboundAudit, checkRateLimit } =
  mod;

// ============ 1. 审计环形缓冲与统计 ============

describe('1. 审计环形缓冲与统计', () => {
  beforeAll(() => {
    resetOutboundAudit();
    recordOutbound('api.steampowered.com', true, 120, 200);
    recordOutbound('store.steampowered.com', false, 0, 0);
    recordOutbound('store.steampowered.com', true, 80, 200);
  });

  test('entries 倒序（最新在前）', () => {
    const r = getOutboundAudit();
    expect(
      r.entries.map((e) => e.host)
    ).toEqual(['store.steampowered.com', 'store.steampowered.com', 'api.steampowered.com']);
  });
  test('统计 total/failed', () => {
    const r = getOutboundAudit();
    expect([r.stats.total, r.stats.failed]).toEqual([3, 1]);
  });
  test('统计 failRate（33%）', () => {
    const r = getOutboundAudit();
    expect(r.stats.failRate).toEqual(33);
  });
  test('每主机聚合（按次数排序）', () => {
    const r = getOutboundAudit();
    expect(
      r.stats.hosts.map((h) => h.host + ':' + h.count)
    ).toEqual(['store.steampowered.com:2', 'api.steampowered.com:1']);
  });
  test('主机失败计数', () => {
    const r = getOutboundAudit();
    expect(r.stats.hosts[0].failed).toEqual(1);
  });
  test('limit 截断（取最近 2 条）', () => {
    expect(getOutboundAudit(2).entries.length).toEqual(2);
  });
});

// ============ 2. 环形缓冲上限（超限裁剪最旧） ============

describe('2. 环形缓冲上限（超限裁剪最旧）', () => {
  beforeAll(() => {
    resetOutboundAudit();
    for (let i = 0; i < AUDIT_MAX + 20; i++) recordOutbound('host.example.com', true, 1, 200, 1000 + i);
  });

  test('缓冲不超上限', () => {
    expect(getOutboundAudit().stats.total).toEqual(AUDIT_MAX);
  });
  test('最旧 20 条被裁剪（最早保留第 21 条 t=1020）', () => {
    const all = getOutboundAudit(AUDIT_MAX).entries; // 取全量（默认 limit=100）
    expect(all[all.length - 1].t).toEqual(1020);
  });
  test('最新一条保留（t=1319）', () => {
    const all = getOutboundAudit(AUDIT_MAX).entries;
    expect(all[0].t).toEqual(1319);
  });
});

// ============ 3. 每主机滑动窗口限速 ============

describe('3. 每主机滑动窗口限速', () => {
  test('窗口放行上限与第 RATE_MAX+1 次拒绝', () => {
    resetOutboundAudit();
    const t0 = 1_000_000;
    let allowed = 0;
    for (let i = 0; i < RATE_MAX; i++) if (checkRateLimit('steam.example.com', t0 + i)) allowed++;
    expect(allowed).toEqual(RATE_MAX);
    expect(checkRateLimit('steam.example.com', t0 + RATE_MAX)).toEqual(false);
  });
  test('窗口滑动后恢复（过期时间戳过滤）', () => {
    resetOutboundAudit();
    const t0 = 1_000_000;
    for (let i = 0; i < RATE_MAX; i++) checkRateLimit('steam.example.com', t0 + i);
    expect(checkRateLimit('steam.example.com', t0 + RATE_MAX + RATE_WINDOW_MS)).toEqual(true);
  });
  test('不同主机互不影响', () => {
    resetOutboundAudit();
    const t0 = 1_000_000;
    for (let i = 0; i < RATE_MAX; i++) checkRateLimit('steam.example.com', t0 + i);
    expect(checkRateLimit('other.example.com', t0)).toEqual(true);
  });
  test('reset 后限速计数清空', () => {
    resetOutboundAudit();
    const t0 = 1_000_000;
    for (let i = 0; i < RATE_MAX; i++) checkRateLimit('steam.example.com', t0 + i);
    resetOutboundAudit();
    expect(checkRateLimit('steam.example.com', t0)).toEqual(true);
  });
  test('空 host 不限制', () => {
    resetOutboundAudit();
    const t0 = 1_000_000;
    expect(checkRateLimit('', t0)).toEqual(true);
  });
});

// ============ 4. fetchWithTimeout 审计接入（mock fetch） ============
// 每条路径独立 reset + 独立 mock，test 自包含（无顺序依赖）

describe('4. fetchWithTimeout 审计接入（mock fetch）', () => {
  const realFetch = globalThis.fetch;
  const fakeResp = (status) => ({ status, headers: { has: () => false }, url: 'https://mock.example.com/x' });
  afterAll(() => {
    globalThis.fetch = realFetch;
    resetOutboundAudit();
  });

  test('成功请求返回 200 且审计成功路径', async () => {
    resetOutboundAudit();
    globalThis.fetch = async () => fakeResp(200);
    const resp = await utils.fetchWithTimeout('https://api.example.com/games', {}, 2000);
    expect(resp.status).toEqual(200);
    const a = getOutboundAudit().entries[0];
    expect([a.host, a.ok, a.status]).toEqual(['api.example.com', true, 200]);
  });

  test('网络错误上抛且审计失败路径', async () => {
    resetOutboundAudit();
    globalThis.fetch = async () => {
      throw new Error('network down');
    };
    let threw = false;
    try {
      await utils.fetchWithTimeout('https://api.example.com/games', {}, 2000);
    } catch (e) {
      threw = /network down/.test(e.message);
    }
    expect(threw).toEqual(true);
    const a = getOutboundAudit().entries[0];
    expect([a.host, a.ok]).toEqual(['api.example.com', false]);
  });

  test('内网地址被拦截且审计 localhost', async () => {
    resetOutboundAudit();
    let threw = false;
    try {
      await utils.fetchWithTimeout('http://localhost:11434/api/generate', {}, 2000);
    } catch (e) {
      threw = /blocked-url/.test(e.message);
    }
    expect(threw).toEqual(true);
    const a = getOutboundAudit().entries[0];
    expect([a.host, a.ok]).toEqual(['localhost', false]);
  });

  test('超限请求被拒绝且审计失败路径', async () => {
    resetOutboundAudit();
    globalThis.fetch = async () => fakeResp(200);
    for (let i = 0; i < RATE_MAX; i++) await utils.fetchWithTimeout('https://rate.example.com/games', {}, 2000);
    let threw = false;
    try {
      await utils.fetchWithTimeout('https://rate.example.com/games', {}, 2000);
    } catch (e) {
      threw = /rate-limited/.test(e.message);
    }
    expect(threw).toEqual(true);
    const a = getOutboundAudit().entries[0];
    expect(a.ok).toEqual(false);
  });

  test('其他主机不受限速影响', async () => {
    resetOutboundAudit();
    globalThis.fetch = async () => fakeResp(200);
    const resp2 = await utils.fetchWithTimeout('https://other.example.com/games', {}, 2000);
    expect(resp2.status).toEqual(200);
  });
});
