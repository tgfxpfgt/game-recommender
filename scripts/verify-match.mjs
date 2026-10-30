/**
 * 游戏雷达 Game Radar - 匹配规则检验命令（第九轮 B10 / 用户需求）
 *
 * 规则及相关代码更新后：从错题库（三源）挑最容易错的前 10 条回放检验。
 * 错题来源三源合并——①错题库 fixtures（历史事故）②三站第一页基准 ③
 * wrong-report-samples.json（dashboard 错题卡复制的自动采集样本，人工
 * 入册后放 tests/fixtures/ 即自动并入）。
 * 用法：npm run verify:match [-- --topN=20]
 * 输出逐条结果 + 汇总；硬失败（有期望值却错配/未中）exit 1。
 */
import { runMismatchReplay } from '../tests/helpers/mismatch-replay.mjs';

const topN = Number(process.argv.find((a) => a.startsWith('--topN='))?.split('=')[1]) || 10;
const r = await runMismatchReplay({ topN });

console.log(`\n===== 匹配规则检验（Top ${topN} 最易错样本）=====`);
for (const row of r.results) {
  const mark = row.ok ? '✅' : '❌';
  console.log(`${mark} ${row.id}: got=${row.got ?? '未命中'} expected=${row.expected}`);
}
const hardFails = r.results.filter((x) => !x.ok && x.expected !== 'miss(改进度量)');
const missImprovements = r.results.filter((x) => x.ok && x.expected === 'miss(改进度量)' && x.got);
console.log(
  `\n硬失败: ${hardFails.length} · 未命中样本改进命中: ${missImprovements.length} · 总样本: ${r.results.length}`
);
if (r.applyErrors && r.applyErrors.length > 0) console.log('词表应用错误:', r.applyErrors);
if (hardFails.length > 0) process.exit(1);
console.log('✅ 检验通过');
