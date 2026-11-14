// @ts-strict
/**
 * 游戏雷达 Game Radar - dist 产物 E2E 冒烟入口（绿地阶段 0 验收）
 *
 * 以 dist/ 构建产物为被测扩展跑 MOCK E2E（源模式 E2E 继续走 tests/e2e-smoke.mjs）。
 * Runs the MOCK E2E pipeline against the dist/ build output instead of the
 * unpacked source tree — the stage-0 acceptance gate for the bundler.
 */
process.env.GR_EXTENSION_DIR = 'dist';
process.env.E2E_MOCK = '1';
await import('../tests/e2e-smoke.mjs');
