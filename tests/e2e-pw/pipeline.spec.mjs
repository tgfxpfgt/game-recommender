import { test } from './extension-fixture.mjs';
import { expect } from '@playwright/test';
import { waitSwResponsive, withTimeout, isTimeout } from '../e2e/helpers.mjs';
import { runInstall } from '../e2e/section-install.mjs';
import { runPages } from '../e2e/section-pages.mjs';
import { runListChecks, runScrollBatch } from '../e2e/section-list.mjs';
import { runDetail } from '../e2e/section-detail.mjs';
import { runDashboard } from '../e2e/section-dashboard.mjs';
import { runPersist } from '../e2e/section-persist.mjs';
import { runCustomSite } from '../e2e/section-custom-site.mjs';
/**
 * 游戏雷达 Game Radar - Playwright 节管线（B4 阶段 2：薄适配层移植）
 *
 * **节函数零重写**——runInstall…runCustomSite 原样复用（语义零漂移），本文件
 * 只做 runner 编排桥接：
 * - 每节一个 test（serial 保序）：trace 失败保留 per-test、HTML 报告分节、
 *   test.setTimeout 取代 run.mjs 的 Promise.race 节超时（超时即红且留 trace）
 * - state.check 桥 → expect.soft：软断言失败**继续跑完** + 终态红——精确对应
 *   旧 check 计数器汇总语义（不因首错丢后续检查面）
 * - persist 节内部重启浏览器重赋 state.context/extId——后续节自动用新实例
 *   （worker state teardown 关闭最新实例；原始实例由 persist/ext teardown 收走）
 * - detail 断链（E2E_FAST&&!MOCK）→ state.broken → 其后节 test.skip
 * - 终局转储（SEARCH_STEAM/任务/flush 生命周期日志）挂在末节尾部（纯诊断零断言）
 *
 * 阶段 3（gate e2e:dist 切换 + 现役 run.mjs 退役）单独批次。
 */

const SECTIONS = [
  ['install', runInstall],
  ['pages', runPages],
  ['list', runListChecks],
  ['detail', runDetail],
  ['scroll', runScrollBatch],
  ['dashboard', runDashboard],
  ['persist', runPersist],
  ['custom-site', runCustomSite]
];

test.describe.serial('E2E 节管线（@playwright/test 移植——节函数零重写）', () => {
  test.setTimeout(180000); // 节级超时（run.mjs 默认 120s + trace 落盘余量）

  for (const [name, run] of SECTIONS) {
    test(name, async ({ state }) => {
      // check 桥注入（beforeEach 等价的 test 内首行——soft 断言须在测试上下文内）
      state.check = (n, ok, extra = '') => expect.soft(Boolean(ok), extra ? `${n} ${extra}` : n);
      test.skip(state.broken, '前序节断链——其后节跳过（run.mjs 同语义）');
      // SW 响应门（run.mjs：MOCK 且非 install 节开工前轮询至 SW 可应答）
      if (state.MOCK && state.extId && name !== 'install' && state.context) {
        await waitSwResponsive(state.context, state.extId).catch(() => {});
      }
      const ok = await run(state);
      if (ok === false) {
        state.broken = true;
        console.log(`  ⏹ 节 ${name} 触发断链（E2E_FAST 离线模式）——其后节跳过`);
      }
      // 终局转储（run.mjs 管线后诊断——无论成败可复核；纯日志零断言）
      if (name === 'custom-site' && state.extId && state.context) {
        try {
          const dumpPage = await withTimeout(state.context.newPage(), 10000, 'dump newPage');
          if (isTimeout(dumpPage)) throw new Error('终局转储 newPage 超时 10s');
          await withTimeout(
            dumpPage.goto(`chrome-extension://${state.extId}/popup/popup.html`, { timeout: 10000 }),
            15000,
            'dump goto'
          );
          const dump = await withTimeout(
            dumpPage.evaluate(async () => {
              const resp = await chrome.runtime.sendMessage({ action: 'GET_RUNTIME_LOGS', limit: 500 });
              const logs = (resp && resp.logs) || [];
              return logs.filter((l) => /SEARCH_STEAM|评分任务|评分波次|flush|熔断/.test(l.message || ''));
            }),
            15000,
            'dump eval'
          );
          await dumpPage.close().catch(() => {});
          if (!isTimeout(dump)) {
            console.log('===== 终局转储：SEARCH_STEAM/任务/flush 生命周期 =====');
            for (const l of dump) console.log(`  [${l.module}] ${l.level} ${String(l.message).slice(0, 150)}`);
          }
        } catch (e) {
          console.log('  ⚠️ 终局转储失败:', String(e).slice(0, 80));
        }
      }
    });
  }
});
