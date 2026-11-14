import { test, expect, describe, beforeEach } from 'vitest';
/**
 * 游戏雷达 Game Radar - 测试：使用证据档案（v14.25.0）
 *
 * 覆盖：三层记录的有界性（计数键 allowlist 拒绝未知键 / 耗时环形 50 淘汰 /
 * 事件 FIFO 300 淘汰）/ buildEvidenceReport 纯聚合（分位/近 7 天分布/事件尾）/
 * 落盘往返（flush 后 readModule 读回）。
 * Usage evidence ledger: bounded recording (counter allowlist, duration ring,
 * event FIFO), pure report aggregation, flush roundtrip.
 */

import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';

const storage = createStorageMock();
installChromeStorageMock(storage);

const evidence = await import(
  new URL('../../background/storage/usage-evidence.js', import.meta.url).href + '?t=' + Date.now()
);
const NOW = 1762700000000;

beforeEach(() => {
  storage._reset();
  evidence.resetUsageEvidence();
});

describe('有界记录', () => {
  test('计数：allowlist 内键累加；未知键静默丢弃（防键空间失控）', async () => {
    evidence.recordUsageCounter('match.searchOk');
    evidence.recordUsageCounter('match.searchOk', 2);
    evidence.recordUsageCounter('bogus.key.does-not-exist', 99); // 未登记键
    await new Promise((r) => setTimeout(r, 0));
    const mem = evidence.getUsageEvidenceMemory();
    expect(mem.counters['match.searchOk']).toEqual(3);
    expect(mem.counters['bogus.key.does-not-exist']).toBeUndefined();
  });

  test('耗时环形：每键 ≤50 样本，淘汰最旧', async () => {
    for (let i = 0; i < 55; i++) evidence.recordUsageDuration('search', i + 1);
    await new Promise((r) => setTimeout(r, 0));
    const ring = evidence.getUsageEvidenceMemory().durations.search;
    expect(ring.length).toEqual(50);
    expect(ring[0]).toEqual(6); // 最旧 5 个已淘汰（1-5 移除，6 为新头）
    expect(ring[ring.length - 1]).toEqual(55);
    evidence.recordUsageDuration('bogus', 1); // 键外丢弃
    await new Promise((r) => setTimeout(r, 0));
    expect(evidence.getUsageEvidenceMemory().durations.bogus).toBeUndefined();
  });

  test('事件 FIFO：≤300 淘汰最旧；kind/appId 截断', async () => {
    for (let i = 0; i < 305; i++) evidence.recordUsageEvent('rating', 'fallback', { kind: 'alltime' });
    evidence.recordUsageEvent('report', 'wrongAppId', {
      appId: 'X'.repeat(50)
    });
    await new Promise((r) => setTimeout(r, 0));
    const events = evidence.getUsageEvidenceMemory().events;
    expect(events.length).toEqual(300);
    expect(events[events.length - 1].cat).toEqual('report'); // 最新在尾
    expect(events[events.length - 1].appId.length).toEqual(20); // 截断
  });
});

describe('buildEvidenceReport 纯聚合', () => {
  test('耗时分位：p50/p90/max 升序取位', () => {
    const stats = evidence.durationStats([30, 10, 20, 100, 40, 50, 60, 70, 80, 90]);
    expect(stats.n).toEqual(10);
    expect(stats.p50).toEqual(60);
    expect(stats.p90).toEqual(100);
    expect(stats.max).toEqual(100);
    expect(evidence.durationStats([]).p50).toEqual(null);
    expect(evidence.durationStats(null).n).toEqual(0);
  });

  test('报告：计数/分位/近 7 天事件分布/事件尾齐备；过期事件不入分布', () => {
    const now = NOW;
    const report = evidence.buildEvidenceReport(
      {
        v: 1,
        since: now - 3600e3,
        counters: { 'match.searchOk': 12, 'match.miss': 3 },
        durations: { search: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000] },
        events: [
          { t: now - 1000, cat: 'rating', k: 'fallback', kind: 'cnProxy' },
          { t: now - 2000, cat: 'rating', k: 'fallback', kind: 'cnProxy' },
          { t: now - 8 * 24 * 3600e3, cat: 'rating', k: 'fallback', kind: 'recentProxy' }, // 8 天前 → 不入近 7 天
          { t: now - 3000, cat: 'match', k: 'miss', kind: 'not-found' }
        ]
      },
      now
    );
    expect(report.counters['match.searchOk']).toEqual(12);
    expect(report.durations.search.p50).toEqual(600);
    expect(report.recentEvents7d['rating.fallback:cnProxy']).toEqual(2);
    expect(report.recentEvents7d['rating.fallback:recentProxy']).toBeUndefined();
    expect(report.recentEvents7d['match.miss:not-found']).toEqual(1);
    expect(report.events.length).toEqual(4);
    expect(report.since).toEqual(now - 3600e3);
  });
});

describe('落盘往返', () => {
  test('flush 写入模块键；reset 清空内存与挂起写', async () => {
    evidence.recordUsageCounter('match.searchOk', 5);
    evidence.recordUsageEvent('platform', 'declared', { kind: 'console' });
    await evidence.flushUsageEvidence();
    // v14.25.0：直读 chrome.storage mock（所有 dataStore 实例共享的落盘后端，
    // 避免 ?t= 实例分裂干扰）——验证"flush 后数据在后端"
    const stored = (await globalThis.chrome.storage.local.get('usageEvidence'))['usageEvidence'];
    expect(stored.counters['match.searchOk']).toEqual(5);
    expect(stored.events.length).toEqual(1);
    evidence.resetUsageEvidence();
    expect(evidence.getUsageEvidenceMemory().counters).toEqual({});
  });
});
