/**
 * Game Recommender - vitest 聚合入口 / Vitest Aggregator
 *
 * v6.0.0：以 vitest runner 运行 13 个测试套件（content-sim 除外——其 eval + 动态
 * import 模拟机制与 vite-node 运行器不兼容，由 node tests/run-tests.js 直跑）（保留 check 断言体系，
 * 断言级失败明细由各套件 console 输出 + vitest 失败展示）。--grep 由
 * `vitest -t <关键词>` 承担；模块缓存由 vitest 每文件隔离自动管理。
 * Runs the existing 14 suites under the vitest runner (check-based assertions
 * preserved; per-assertion detail comes from each suite's console output).
 */
import { describe, test, expect } from 'vitest';

const suites = [
  { name: '标题解析 Title Parser', file: './unit/test-title-parser.mjs' },
  { name: '推荐算法 Recommendation Engine', file: './unit/test-engine.mjs' },
  { name: '消息契约 Message Contract', file: './unit/test-contract.mjs' },
  { name: '行为趋势 Trend Aggregation', file: './unit/test-trends.mjs' },
  { name: 'Steam API 纯函数 Steam API Pure', file: './unit/test-api-pure.mjs' },
  { name: '规则与清理 Rules & Cleanup', file: './unit/test-rules-cleanup.mjs' },
  { name: '存储层 Storage Layer', file: './unit/test-storage.mjs' },
  { name: '出站审计与限速 Outbound Audit', file: './unit/test-outbound.mjs' },
  { name: '限免分类 Free-Games', file: './unit/test-freegames.mjs' },
  { name: '站点元信息 Site Detail-Meta', file: './unit/test-sites.mjs' },
  { name: '安全与工具 Security & Utility', file: './unit/test-security.mjs' },
  { name: 'Steam 编排器 Orchestrator', file: './integration/test-orchestrator.mjs' },
  { name: '项目完整性 Project Integrity', file: './integration/test-integrity.mjs' }
];

for (const s of suites) {
  describe(s.name, () => {
    test('套件通过', async () => {
      const mod = await import(s.file);
      const result = mod.testResult;
      expect(result, `${s.name} 失败明细见上方 console 输出（失败 ${result ? result.fail : '?'} 项）`).toBeDefined();
      expect(result.ok, `${s.name} 失败 ${result ? result.fail : '?'} 项`).toBe(true);
    }, 120000); // content-sim 等重套件放宽超时
  });
}
