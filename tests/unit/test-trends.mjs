import { test, expect } from 'vitest';
/**
 * Game Recommender - 测试：行为趋势聚合 / Trend Aggregation Tests
 *
 * v4.2.0：aggregateTrends（day/week 粒度）——周桶键=周一、无效时间戳忽略、
 * 转化率计算、排序。background/core/trends.js 为零依赖纯函数。
 */
'use strict';


const mod = await import(new URL('../../background/core/trends.js', import.meta.url).href + '?t=' + Date.now());
const { aggregateDailyTrends, aggregateTrends } = mod;

// 2026-08-10 是周一；8-11 周二、8-12 周三同周；8-17 下周一
const TUE = new Date('2026-08-11T10:00:00').getTime();
const WED = new Date('2026-08-12T15:00:00').getTime();
const NEXT_MON = new Date('2026-08-17T09:00:00').getTime();

console.log('1. 按天聚合（day）');
const dayLog = [
  { type: 'view_detail', timestamp: TUE },
  { type: 'click_download', timestamp: WED },
  { type: 'view_detail', timestamp: NEXT_MON }
];
const daily = aggregateDailyTrends(dayLog);
test('按天分桶为 3 天', () => { expect(daily.length).toEqual(3); });
test('首条日期 2026-08-11', () => { expect(daily[0].date).toEqual('2026-08-11'); });
test('8-11 view 计入', () => { expect(daily[0].views).toEqual(1); });
test('8-12 download 计入', () => { expect(daily[1].downloads).toEqual(1); });
test('按日期升序', () => { expect(daily.map((d) => d.date)).toEqual(['2026-08-11', '2026-08-12', '2026-08-17']); });
// 同日双事件 → 转化率
const sameDay = aggregateDailyTrends([
  { type: 'view_detail', timestamp: TUE },
  { type: 'click_download', timestamp: TUE + 60000 }
]);
test('同日 view+download 归并', () => { expect([sameDay[0].views, sameDay[0].downloads]).toEqual([1, 1]); });
test('同日转化率 100%（1 浏览 1 下载）', () => { expect(sameDay[0].rate).toEqual(100); });

console.log('2. 按周聚合（week，桶键=周一）');
const weekly = aggregateTrends(dayLog, 'week');
test('周二+周三归入同周（周一 8-10）', () => { expect(weekly.length).toEqual(2); });
test('周桶键为周一日期', () => { expect(weekly[0].date).toEqual('2026-08-10'); });
test('周桶聚合浏览/下载', () => { expect([weekly[0].views, weekly[0].downloads]).toEqual([1, 1]); });
test('下周一独立成桶', () => { expect(weekly[1].date).toEqual('2026-08-17'); });
test('周转化率', () => { expect(weekly[0].rate).toEqual(100); });

console.log('3. 边界与防御');
test('空日志返回空数组', () => { expect(aggregateDailyTrends([]).length).toEqual(0); });
test('null 日志返回空数组', () => { expect(aggregateDailyTrends(null).length).toEqual(0); });
test('无效时间戳忽略', () => { expect(aggregateDailyTrends([
    { type: 'view_detail', timestamp: 'bad' },
    { type: 'view_detail', timestamp: null }
  ]).length).toEqual(0); });
// 未知 type 会建空桶（不计数）——断言为空桶而非无桶
const unknownBucket = aggregateDailyTrends([{ type: 'steam_tags_update', timestamp: TUE }])[0];
test('未知 type 建空桶（不计入）', () => { expect([unknownBucket.views, unknownBucket.downloads]).toEqual([0, 0]); });
test('缺 timestamp 忽略', () => { expect(aggregateDailyTrends([{ type: 'view_detail' }]).length).toEqual(0); });
test('downloads 无 views 时 rate 为 0', () => { expect(aggregateDailyTrends([{ type: 'click_download', timestamp: TUE }])[0].rate).toEqual(0); });

