/**
 * Game Recommender - 测试总入口 / Test Runner
 *
 * 顺序执行全部测试并汇总结果（通过动态 import 加载，无子进程）：
 *   1. 标题解析（parseGameTitle 等）
 *   2. 安全与存储（SSRF/ND-JSON/TDZ/语法/manifest）
 * 运行：node tests/run-tests.js
 */
'use strict';

const tests = [
  { name: '标题解析 Title Parser', file: './test-title-parser.mjs' },
  { name: '依赖分层 Layering', file: './test-layers.mjs' },
  { name: '安全与存储 Security & Storage', file: './test-security.mjs' },
  { name: '内容脚本模拟 Content Script Sim', file: './test-content-sim.mjs' },
  { name: '规则校验与缓存清理 Rules & Cleanup', file: './test-cleanup.mjs' },
  { name: '报错纠正记录 Wrong Reports', file: './test-wrong-reports.mjs' },
  { name: '出站审计与限速 Outbound Audit', file: './test-outbound.mjs' },
  { name: '消息契约 Message Contract', file: './test-contract.mjs' },
  { name: '推荐算法 Recommendation Engine', file: './test-engine.mjs' }
];

let allPass = true;
let totalPass = 0;
let totalFail = 0;
const startedAt = performance.now();
console.log('🎮 Game Recommender 测试套件\n' + '='.repeat(50));

for (const t of tests) {
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
        console.log(`    ✘ ${f.name}\n      实际: ${JSON.stringify(f.actual)}\n      期望: ${JSON.stringify(f.expected)}`);
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
console.log(allPass
  ? `✅ 全部测试通过（${totalPass} 项, 总耗时 ${(performance.now() - startedAt).toFixed(0)}ms）`
  : `❌ 存在失败的测试（通过 ${totalPass} 项, 失败 ${totalFail} 项, 总耗时 ${(performance.now() - startedAt).toFixed(0)}ms）`);
process.exit(allPass ? 0 : 1);
