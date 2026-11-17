// @ts-strict
/**
 * 游戏雷达 Game Radar - dist 产物 E2E 冒烟入口（绿地阶段 0 验收）
 *
 * 以 dist/ 构建产物为被测扩展跑 MOCK E2E。v14.33.1 起为 gate E2E 步骤唯一入口：
 * 源码树直跑（npm run e2e）无法解析 Preact 组件的裸模块说明符（'preact'——浏览器
 * 无 importmap/node_modules 解析，v15 阶段 3 ESM 组件化后直跑必撞 Failed to
 * resolve module specifier，5 例 console error 假红）——E2E 验收对象 = 构建产物
 * （发版用户真实加载的 dist），本入口先构建最新 dist 再跑（自足化，防 stale dist 假绿）。
 * Runs the MOCK E2E pipeline against a freshly built dist/ output — the bundler
 * acceptance gate; builds first so the target always matches current sources.
 */
import { execFileSync } from 'node:child_process';

execFileSync('npm', ['run', 'build'], { stdio: 'inherit', shell: process.platform === 'win32' });
process.env.GR_EXTENSION_DIR = 'dist';
process.env.E2E_MOCK = '1';
await import('../tests/e2e-smoke.mjs');
