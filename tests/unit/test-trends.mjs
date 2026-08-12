/**
 * Game Recommender - 测试：行为趋势聚合 / Trend Aggregation Tests
 *
 * v4.2.0：aggregateTrends（day/week 粒度）——周桶键=周一、无效时间戳忽略、
 * 转化率计算、排序。background/core/trends.js 为零依赖纯函数。
 */
'use strict';

import { createReporter } from '../helpers/assert.mjs';
const reporter = createReporter();
const { check } = reporter;

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
check('按天分桶为 3 天', daily.length, 3);
check('首条日期 2026-08-11', daily[0].date, '2026-08-11');
check('8-11 view 计入', daily[0].views, 1);
check('8-12 download 计入', daily[1].downloads, 1);
check(
  '按日期升序',
  daily.map((d) => d.date),
  ['2026-08-11', '2026-08-12', '2026-08-17']
);
// 同日双事件 → 转化率
const sameDay = aggregateDailyTrends([
  { type: 'view_detail', timestamp: TUE },
  { type: 'click_download', timestamp: TUE + 60000 }
]);
check('同日 view+download 归并', [sameDay[0].views, sameDay[0].downloads], [1, 1]);
check('同日转化率 100%（1 浏览 1 下载）', sameDay[0].rate, 100);

console.log('2. 按周聚合（week，桶键=周一）');
const weekly = aggregateTrends(dayLog, 'week');
check('周二+周三归入同周（周一 8-10）', weekly.length, 2);
check('周桶键为周一日期', weekly[0].date, '2026-08-10');
check('周桶聚合浏览/下载', [weekly[0].views, weekly[0].downloads], [1, 1]);
check('下周一独立成桶', weekly[1].date, '2026-08-17');
check('周转化率', weekly[0].rate, 100);

console.log('3. 边界与防御');
check('空日志返回空数组', aggregateDailyTrends([]).length, 0);
check('null 日志返回空数组', aggregateDailyTrends(null).length, 0);
check(
  '无效时间戳忽略',
  aggregateDailyTrends([
    { type: 'view_detail', timestamp: 'bad' },
    { type: 'view_detail', timestamp: null }
  ]).length,
  0
);
// 未知 type 会建空桶（不计数）——断言为空桶而非无桶
const unknownBucket = aggregateDailyTrends([{ type: 'steam_tags_update', timestamp: TUE }])[0];
check('未知 type 建空桶（不计入）', [unknownBucket.views, unknownBucket.downloads], [0, 0]);
check('缺 timestamp 忽略', aggregateDailyTrends([{ type: 'view_detail' }]).length, 0);
check('downloads 无 views 时 rate 为 0', aggregateDailyTrends([{ type: 'click_download', timestamp: TUE }])[0].rate, 0);

console.log('\n===== 趋势聚合测试结果 =====');
const finalResult = reporter.getResult();
console.log(finalResult.pass + ' 通过, ' + finalResult.fail + ' 失败');
export const testResult = reporter.getResult();
