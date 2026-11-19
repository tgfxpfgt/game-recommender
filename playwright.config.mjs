import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * 游戏雷达 Game Radar - Playwright Test runner 配置（B4 阶段 1，v14.34.6）
 *
 * 现役 E2E 验收入口仍是 `npm run e2e:dist`（tests/e2e/run.mjs 节管线）；
 * 本 runner 为 B4 runner 语义升级载体：trace 失败保留 / expect 自动等待 /
 * 报告语义，先运行 boot 冒烟（tests/e2e-pw/boot.spec.mjs），后续阶段逐节
 * 移植（B4 阶段 2/3）后切换 gate 步骤。
 *
 * 语义锚点：
 * - GR_EXTENSION_DIR 默认 **dist**（对齐 e2e:dist 教训：验收对象 = 构建产物；
 *   源码树直跑撞 Preact 裸 specifier）——helpers.mjs EXTENSION_DIR 单源消费。
 * - E2E_MOCK 默认 1（离线确定性契约；E2E_MOCK=0 显式关闭走真网络）——
 *   必须在 helpers.mjs 模块加载前设置（其 MOCK 常量在 import 时读取）。
 */
const ROOT = path.dirname(fileURLToPath(import.meta.url));
process.env.GR_EXTENSION_DIR = process.env.GR_EXTENSION_DIR || 'dist';
process.env.E2E_MOCK = process.env.E2E_MOCK ?? '1';

export default defineConfig({
  testDir: path.join(ROOT, 'tests/e2e-pw'),
  fullyParallel: false, // 扩展 + 共享 profile + SW 状态 → 串行（与现役节管线同口径）
  workers: 1,
  timeout: 60000,
  retries: 0, // MOCK 离线确定性——失败即失败，不重试掩蔽
  reporter: [['list']],
  outputDir: path.join(ROOT, 'test-results/e2e-pw')
  // trace 由 extension-fixture 手动管理（launchPersistentContext 自建上下文，
  // 不走 test 内置 browser fixture——trace: 'retain-on-failure' 不适用）
});
