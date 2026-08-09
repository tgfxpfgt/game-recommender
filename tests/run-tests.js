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
  { name: '安全与存储 Security & Storage', file: './test-security.mjs' },
  { name: '内容脚本模拟 Content Script Sim', file: './test-content-sim.mjs' },
  { name: '规则校验与缓存清理 Rules & Cleanup', file: './test-cleanup.mjs' }
];

let allPass = true;
console.log('🎮 Game Recommender 测试套件\n' + '='.repeat(50));

for (const t of tests) {
  console.log(`\n▶ ${t.name}`);
  try {
    const mod = await import(t.file + '?t=' + Date.now());
    const result = mod.testResult;
    if (result && result.ok) {
      console.log(`  ✔ ${t.name} 通过 (${result.pass} 项)`);
    } else if (result) {
      console.log(`  ✘ ${t.name} 失败 (${result.fail} 项失败)`);
      allPass = false;
    } else {
      console.log(`  ? ${t.name} 未返回结果`);
      allPass = false;
    }
  } catch (e) {
    console.log(`  ✘ ${t.name} 加载失败: ${e.message}`);
    allPass = false;
  }
}

console.log('\n' + '='.repeat(50));
console.log(allPass ? '✅ 全部测试通过' : '❌ 存在失败的测试');
process.exit(allPass ? 0 : 1);
