/**
 * Game Recommender - 测试总入口 / Test Runner
 *
 * v4.2.0：按领域分组（unit/ 纯函数单测 + integration/ 集成与完整性）。
 * --grep <关键词> 只运行名称匹配的套件（快速迭代）。
 * 运行：node tests/run-tests.js [--grep 关键词]
 */
'use strict';

// v4.2.0：--grep 子集运行（按套件名/文件名关键词过滤）
const grepArg = process.argv.find((a) => a.startsWith('--grep='));
const grepFilter = grepArg ? grepArg.slice('--grep='.length).toLowerCase() : null;

// v6.1.0：node 直跑套件（5 个）——线性脚本 + 共享模块状态语义，
// 与 vitest 的模块执行模型不兼容；其余 9 套件由 vitest run 覆盖
const tests = [
  { name: 'Steam API 纯函数 Steam API Pure', file: './unit/test-api-pure.mjs' },
  { name: '规则与清理 Rules & Cleanup', file: './unit/test-rules-cleanup.mjs' },
  { name: '存储层 Storage Layer', file: './unit/test-storage.mjs' },
  { name: '出站审计与限速 Outbound Audit', file: './unit/test-outbound.mjs' },
  { name: '内容脚本模拟 Content Script Sim', file: './integration/test-content-sim.mjs' }
];

let allPass = true;
let totalPass = 0;
let totalFail = 0;
let skipped = 0;
if (grepFilter) {
  console.log(`🔎 --grep 过滤: "${grepFilter}"`);
}
const startedAt = performance.now();
console.log('🎮 Game Recommender 测试套件\n' + '='.repeat(50));

for (const t of tests) {
  // v4.2.0：--grep 过滤（套件名/文件名）
  if (grepFilter && !(t.name.toLowerCase().includes(grepFilter) || t.file.toLowerCase().includes(grepFilter))) {
    skipped++;
    continue;
  }
  const t0 = performance.now();
  console.log(`\n▶ ${t.name}`);
  try {
    const mod = await import(t.file + '?t=' + Date.now());
    const result = mod.testResult;
    const elapsed = (performance.now() - t0).toFixed(0);
    if (result && result.ok) {
      console.log(`  ✔ ${t.name} 通过 (${result.pass} 项, ${elapsed}ms)`);
      totalPass += result.pass;
    } else if (result) {
      console.log(`  ✘ ${t.name} 失败 (${result.fail} 项失败, ${elapsed}ms)`);
      totalFail += result.fail;
      totalPass += result.pass;
      // v4.1.2：失败明细汇总（前 10 条，含实际/期望）
      const failures = result.failures || [];
      for (const f of failures.slice(0, 10)) {
        console.log(
          `    ✘ ${f.name}\n      实际: ${JSON.stringify(f.actual)}\n      期望: ${JSON.stringify(f.expected)}`
        );
      }
      if (failures.length > 10) console.log(`    ... 另有 ${failures.length - 10} 条失败`);
      allPass = false;
    } else {
      console.log(`  ? ${t.name} 未返回结果 (${elapsed}ms)`);
      allPass = false;
    }
  } catch (e) {
    console.log(`  ✘ ${t.name} 加载失败: ${e.message}`);
    if (e.stack) console.log('    ' + e.stack.split('\n').slice(0, 3).join('\n    '));
    allPass = false;
  }
}

console.log('\n' + '='.repeat(50));
const skipNote = skipped > 0 ? `（--grep 跳过 ${skipped} 个套件）` : '';
console.log(
  allPass
    ? `✅ 全部测试通过（${totalPass} 项, 总耗时 ${(performance.now() - startedAt).toFixed(0)}ms）${skipNote}`
    : `❌ 存在失败的测试（通过 ${totalPass} 项, 失败 ${totalFail} 项, 总耗时 ${(performance.now() - startedAt).toFixed(0)}ms）${skipNote}`
);
process.exit(allPass ? 0 : 1);
