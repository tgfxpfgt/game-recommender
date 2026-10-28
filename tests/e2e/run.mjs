import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
/**
 * 游戏雷达 Game Radar - E2E 冒烟 runner 聚合 / E2E smoke runner
 *
 * 第五轮 B9 自 e2e-smoke.mjs 拆分：本文件只做启动引导（fixture 服务、浏览器
 * 启动、SW 等待、路由拦截安装）与分节管线编排；各节逻辑见 section-*.mjs。
 * 节序保持原 runChecks 语义：install → pages → list(3/3b/3c) → detail(4，
 * E2E_FAST&&!MOCK 时断链) → scroll(5a) → dashboard(5b) → persist(6，重启浏览器
 * 并重赋 state.context/extId) → custom-site(7)。
 * Boot + section pipeline; per-section logic lives in section-*.mjs modules.
 * Run: npm run e2e （需本机 Chromium/Chrome；E2E_MOCK=1 离线回放）
 */
('use strict');

import {
  createChecks,
  launchOpts,
  routeHandler,
  startFixtureServer,
  EXTENSION_DIR,
  MOCK,
  RECORD,
  FAST,
  MOCK_RE,
  USER_DATA_DIR
} from './helpers.mjs';
import { runInstall } from './section-install.mjs';
import { runPages } from './section-pages.mjs';
import { runListChecks, runScrollBatch } from './section-list.mjs';
import { runDetail } from './section-detail.mjs';
import { runDashboard } from './section-dashboard.mjs';
import { runPersist } from './section-persist.mjs';
import { runCustomSite } from './section-custom-site.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf-8'));
console.log(`1. 扩展 ${manifest.name} v${manifest.version}`);

// 清理上次运行残留的 profile（否则默认设置断言会受旧状态影响）
fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
const { server, FIXTURE_URL, FIXTURE_ROOT } = await startFixtureServer();

let context = null;
const checks = createChecks();
const state = {
  context: null,
  extId: null,
  check: checks.check,
  MOCK,
  RECORD,
  FAST,
  FIXTURE_URL,
  FIXTURE_ROOT,
  userDataDir: USER_DATA_DIR
};

try {
  context = await chromium.launchPersistentContext(USER_DATA_DIR, launchOpts());
} catch (e) {
  console.log('⚠️ 浏览器启动失败（需本机安装 Edge 或设置 E2E_CHANNEL=chrome）:', e.message.split('\n')[0]);
  // v3.4.1：启动失败必须失败退出——此前 exit(0) 使 e2e 在"根本没测"时假绿
  process.exit(1);
}
state.context = context;

try {
  // v7.3.0：录制/回放模式安装路由拦截（须在页面打开前）
  if (MOCK || RECORD) {
    await context.route(MOCK_RE, routeHandler);
  }

  // 等待扩展加载并获取扩展 id（service worker 就绪）
  // v14.7 批次 2（C-P2）：等待轮数可配置（E2E_SW_WAIT_ROUNDS，默认 30 轮
  // =15s 不变）——重负载机上 SW 冷启动慢，提额消除假红。
  const swWaitRounds = Number(process.env.E2E_SW_WAIT_ROUNDS) || 30;
  let extId = null;
  for (let i = 0; i < swWaitRounds; i++) {
    const workers = context.serviceWorkers();
    if (workers.length > 0) {
      extId = new URL(workers[0].url()).host;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  state.extId = extId;
  state.check('扩展后台 Service Worker 已启动', !!extId, `(id=${extId || '未获取'})`);

  if (extId) {
    // 分节管线（顺序 = 原 runChecks；detail 返回 false 断链跳过其后全部节）
    const pipeline = [
      ['install', runInstall],
      ['pages', runPages],
      ['list', runListChecks],
      ['detail', runDetail],
      ['scroll', runScrollBatch],
      ['dashboard', runDashboard],
      ['persist', runPersist],
      ['custom-site', runCustomSite]
    ];
    // v14.7 批次 2（C-P2）：节级超时（E2E_SECTION_TIMEOUT_MS，默认 120s）——
    // 节挂起不再拖死整段 E2E（此前仅 Playwright 单操作 30s 兜底，节内自旋
    // 等待可无限挂起）。
    const sectionTimeoutMs = Number(process.env.E2E_SECTION_TIMEOUT_MS) || 120000;
    for (const [name, run] of pipeline) {
      const runP = run(state);
      runP.catch(() => {}); // 超时胜出后原 promise 拒绝不得成为 unhandled
      const timerP = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`节 ${name} 超时(${sectionTimeoutMs}ms)`)), sectionTimeoutMs)
      );
      timerP.catch(() => {}); // 同上：run 先完成时 timer 的 reject 无人消费
      let ok = false;
      try {
        ok = await Promise.race([runP, timerP]);
      } catch (e) {
        state.check(`节 ${name}（超时防护）`, false, String((e && e.message) || e));
        break;
      }
      if (ok === false) {
        console.log(`  ⏹ 节 ${name} 触发断链（E2E_FAST 离线模式）——其后节跳过`);
        break;
      }
    }
  }
} finally {
  // v3.4.1：中途异常也清理 profile/HTTP server，避免残留
  if (state.context) await state.context.close().catch(() => {});
  server.close();
  fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
}
const { pass, fail } = checks.summary();
console.log(`\n===== E2E 冒烟结果 =====\n${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
