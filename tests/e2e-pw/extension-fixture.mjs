import { test as base } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
/**
 * 游戏雷达 Game Radar - Playwright 扩展 fixtures（B4 阶段 1）
 *
 * 复用 tests/e2e/helpers.mjs 单源语义（EXTENSION_DIR/launchOpts/routeHandler/
 * startFixtureServer/MOCK_RE——不复制实现，保证与现役管线同一套 MOCK 数据与
 * 启动参数）；本文件只补 runner 层胶水：
 * - worker 级 fixture HTTP 服务（随机端口 × host-resolver-rules 映射）
 * - worker 级持久上下文：MV3 扩展装载 + SW 就绪等待（镜像 run.mjs 轮询语义）
 * - MOCK 路由拦截（与 run.mjs 同一 routeHandler——fixture 回放/未命中 404）
 * - trace 失败保留：每测试 start，失败 stop 落盘 test-results/e2e-pw/<spec>/
 *   trace.zip（trace viewer 回放定位——单次跑数排障的替代面）
 */
import { MOCK, MOCK_RE, routeHandler, startFixtureServer, launchOpts } from '../e2e/helpers.mjs';

const TESTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 独立 profile 目录（与现役管线 .e2e-profile 隔离——两管线并行互不污染）
export const USER_DATA_DIR_PW = path.join(TESTS_DIR, '.e2e-profile-pw');

/** 轮询 SW 就绪并取 extId（镜像 run.mjs workerToId 语义） */
async function waitForServiceWorker(context, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const sw = context
      .serviceWorkers()
      .find((w) => w.url().includes('service-worker.js') || w.url().includes('background'));
    if (sw) return { sw, extId: new URL(sw.url()).host };
    const raced = await Promise.race([
      context.waitForEvent('serviceworker', { timeout: 2000 }).catch(() => null),
      new Promise((r) => setTimeout(() => r(null), 2000))
    ]);
    if (raced && raced.url()) {
      return { sw: raced, extId: new URL(raced.url()).host };
    }
  }
  return { sw: null, extId: null };
}

export const test = base.extend({
  /** worker 级 fixture HTTP 服务（helpers.startFixtureServer 单源） */
  fixture: [
    async ({}, use) => {
      const s = await startFixtureServer();
      await use(s);
      s.server.close();
    },
    { scope: 'worker', auto: true }
  ],
  /**
   * worker 级扩展持久上下文：{ context, extId, sw }。
   * trace：worker 级 start + 每测试 teardown 按失败落盘。
   */
  ext: [
    async ({}, use, testInfo) => {
      fs.rmSync(USER_DATA_DIR_PW, { recursive: true, force: true });
      const context = await chromium.launchPersistentContext(USER_DATA_DIR_PW, launchOpts());
      // MOCK 路由（与 run.mjs 同一 routeHandler 单源；须在页面打开前安装）
      if (MOCK) await context.route(MOCK_RE, routeHandler);
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      const { sw, extId } = await waitForServiceWorker(context);
      await use({ context, extId, sw });
      const failed = testInfo.status !== testInfo.expectedStatus;
      await context.tracing.stop(failed ? { path: testInfo.outputPath('trace.zip') } : {});
      await context.close();
    },
    { scope: 'worker' }
  ]
});
export const expect = base.expect;
