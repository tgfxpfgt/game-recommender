/**
 * 游戏雷达 Game Radar - background/core/metrics 单测
 *
 * v10.7.0 批次5：运行指标框架——计数/直方图/有界性/快照汇总。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { metricInc, metricObserve, metricsSnapshot, resetMetrics } from '../../background/core/metrics.js';

describe('metrics（批次5 运行指标）', () => {
  beforeEach(() => resetMetrics());

  it('计数递增与快照读取', () => {
    metricInc('msg.GET_SETTINGS');
    metricInc('msg.GET_SETTINGS', 2);
    const snap = metricsSnapshot();
    expect(snap.counters['msg.GET_SETTINGS']).toEqual(3);
  });

  it('直方图汇总 min/max/avg/p95', () => {
    for (let i = 1; i <= 100; i++) metricObserve('batch.ms', i);
    const h = metricsSnapshot().hist['batch.ms'];
    expect(h.count).toEqual(100);
    expect(h.min).toEqual(1);
    expect(h.max).toEqual(100);
    expect(h.avg).toEqual(51); // Math.round(50.5)
    expect(h.p95).toEqual(96); // floor(100*0.95)=95 → sorted[95]（第 96 个样本）
  });

  it('直方图环形上限（超限淘汰最旧）', () => {
    for (let i = 1; i <= 250; i++) metricObserve('ring', i);
    const h = metricsSnapshot().hist['ring'];
    expect(h.count).toEqual(200);
    expect(h.min).toEqual(51); // 前 50 条被环形淘汰
    expect(h.max).toEqual(250);
  });

  it('计数键有界（≤64，新键丢弃防膨胀）', () => {
    for (let i = 0; i < 80; i++) metricInc('c.' + i);
    const counters = metricsSnapshot().counters;
    expect(Object.keys(counters).length).toEqual(64);
  });

  it('直方图键有界（≤16）', () => {
    for (let i = 0; i < 20; i++) metricObserve('h.' + i, 1);
    expect(Object.keys(metricsSnapshot().hist).length).toEqual(16);
  });
});
