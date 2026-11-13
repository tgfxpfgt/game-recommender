import { test, expect, describe, beforeAll, afterAll } from 'vitest';
/**
 * 游戏雷达 Game Radar - 测试：批量好评率任务可恢复化（v10.0.0）
 *
 * 覆盖：session 任务检查点 / SW 冷启动续跑（resumeRatingsBatch）/
 * 陈旧任务丢弃 / 无任务幂等早退。真实批次链路（fetch mock 驱动
 * orchestrator → getSteamPositiveRate → 推送 → 清任务）。
 * Resumable rating job: session checkpoint, cold-start resume, stale-job
 * discard and no-job no-op, driven through the real orchestrator pipeline.
 */
('use strict');

import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';
import { createFetchMock, installFetchMock } from '../helpers/fetch-mock.mjs';
import { resetApiMonitor } from '../../background/core/api-monitor.js';
import { PERF_CONFIG } from '../../background/core/constants.js';

const storage = createStorageMock();
installChromeStorageMock(storage);

// tabs.sendMessage 收集器（任务推送断言用）/ collect job pushes
const pushed = [];
globalThis.chrome.tabs = {
  sendMessage: async (tabId, msg) => {
    pushed.push({ tabId, msg });
  }
};
globalThis.chrome.runtime.getPlatformInfo = async () => ({ os: 'win' });
globalThis.chrome.alarms = {
  create: () => {},
  clear: () => {}
};

const ratingsBatch = await import(
  new URL('../../background/steam/ratings-batch.js', import.meta.url).href + '?t=' + Date.now()
);

const JOB_KEY = 'grRatingsBatchJob';

function sessionGet(key) {
  return chrome.storage.session._data.get(key);
}

// ============ v14.28.3：SW 饱和修复（全 miss 批量链）回归 ============
// 置于文件最前：api-monitor 的失败计数与 anomalyGate 是模块级状态，后面
// "死 tab/失败请求"类用例会留下脏状态，污染这两个用例的耗时判定。
// Kept first: api-monitor failure counters and anomalyGate are module-level,
// and later failing-request cases would pollute the timing assertions here.
describe('v14.28.3 SW 饱和修复：批量链全 miss', () => {
  /** 等待全局链空闲 / wait for the global chain to idle */
  async function waitIdle() {
    for (let i = 0; i < 200; i++) {
      const s = ratingsBatch.getRatingsQueueStatus();
      if (!s.running && s.pending === 0) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  // 此前进重试队列的条件是 `!r || r.failed`，全 miss（检索无命中 → null，
  // 非 failed:true）会让整批被第二轮原样重打：90 项批量链耗时翻倍、限流
  // 队列二次打满。修复后确定性 miss 由内容侧"未找到·点击重查"承接。
  // Deterministic misses (null) must not trigger the second pass.
  test('确定性 miss 不进重试轮（每项只推送一次）', async () => {
    await waitIdle();
    storage._reset();
    pushed.length = 0;
    const prevFetch = globalThis.fetch;
    // 空候选 + 空目录镜像 → 纯确定性 miss，零 API 失败（不触发异常暂停）
    globalThis.fetch = createFetchMock({ '/api/storesearch': { items: [] }, games_appid: [] });
    const names = ['不存在的游戏甲', '不存在的游戏乙', '不存在的游戏丙'];
    try {
      const started = ratingsBatch.startRatingJob({
        tabId: 12,
        queue: names,
        retried: false,
        urlAppIds: {},
        imageData: {},
        appIds: {},
        startedAt: Date.now()
      });
      expect(started).toEqual(true);
      for (let i = 0; i < 300; i++) {
        const s = ratingsBatch.getRatingsQueueStatus();
        if (!sessionGet(JOB_KEY) && !s.running && s.pending === 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(sessionGet(JOB_KEY)).toEqual(undefined);
      for (const n of names) {
        // 第二轮重打会再次推送同名项 → 计数为 2；修复后恒为 1
        const times = pushed.filter(
          (p) => p.msg.ratings && Object.prototype.hasOwnProperty.call(p.msg.ratings, n)
        ).length;
        expect(times).toEqual(1);
      }
      expect(!!pushed.find((p) => p.msg.done)).toEqual(true);
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  // v14.28.3：重试轮数组别名导致的无界循环回归。此前 runPool(retryNames)
  // 与 retryNames 同一数组，重试失败的条目 push 回自身 → 数组长度随游标
  // 增长，`cursor < passNames.length` 永不满足（实测 20 项 233s 未收尾、
  // 堆 4GB OOM）。修复传快照副本后，重试轮只跑一遍。
  // Regression for the aliased-array unbounded retry pass (233s/OOM observed).
  test('失败条目的重试轮有界（429 全失败也不无限重打）', async () => {
    await waitIdle();
    storage._reset();
    pushed.length = 0;
    const prevFetch = globalThis.fetch;
    const base = createFetchMock({
      '/api/storesearch': { items: [{ id: 999001, name: '限流测试游戏', type: 'game' }] },
      '/api/appdetails': {
        999001: { success: true, data: { steam_appid: 999001, name: '限流测试游戏', type: 'game' } }
      }
    });
    let reviewCalls = 0;
    globalThis.fetch = async (/** @type {any} */ url, /** @type {any} */ opts) => {
      if (String(url).includes('/appreviews')) {
        reviewCalls++;
        return { ok: false, status: 429, json: async () => ({}), text: async () => '' };
      }
      return base(url, opts);
    };
    try {
      const started = ratingsBatch.startRatingJob({
        tabId: 13,
        queue: ['限流测试游戏'],
        retried: false,
        urlAppIds: {},
        imageData: {},
        appIds: {},
        startedAt: Date.now()
      });
      expect(started).toEqual(true);
      // 上限 30s（含 6s 退避）：无界循环时任务永不收尾
      for (let i = 0; i < 600; i++) {
        const s = ratingsBatch.getRatingsQueueStatus();
        if (!sessionGet(JOB_KEY) && !s.running && s.pending === 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(sessionGet(JOB_KEY)).toEqual(undefined);
      expect(!!pushed.find((p) => p.msg.done)).toEqual(true);
      // 首轮 1 次 + 重试 1 次；无界循环会数百次（每次重打都再请求评价）
      expect(reviewCalls).toBeLessThanOrEqual(4);
    } finally {
      globalThis.fetch = prevFetch;
      resetApiMonitor(); // 模块级失败计数会污染后续用例 / module-level counter cleanup
    }
  });
});

describe('批量好评率任务可恢复化（v10.0.0）', () => {
  let restoreFetch;
  beforeAll(() => {
    const fetchMock = createFetchMock({
      '/api/storesearch': { items: [{ id: 1245620, name: '艾尔登法环', type: 'game' }] },
      '/api/appdetails': {
        1245620: {
          success: true,
          data: {
            steam_appid: 1245620,
            name: '艾尔登法环',
            type: 'game',
            genres: [{ id: 1, description: 'RPG' }],
            supported_languages: '<strong>简体中文</strong>'
          }
        }
      },
      '/appreviews': {
        success: 1,
        query_summary: { total_reviews: 100, total_positive: 90, total_negative: 10, review_score_desc: '特别好评' },
        reviews: []
      }
    });
    restoreFetch = installFetchMock(fetchMock);
  });
  afterAll(() => restoreFetch());

  test('SW 冷启动续跑：从 session 任务继续拉取并推送 done', async () => {
    storage._reset();
    pushed.length = 0;
    // 模拟上个 SW 实例留下的检查点（队列剩 1 个名字）
    await chrome.storage.session.set({
      [JOB_KEY]: {
        tabId: 7,
        queue: ['艾尔登法环'],
        retried: false,
        urlAppIds: {},
        imageData: {},
        appIds: {},
        startedAt: Date.now()
      }
    });
    const resp = await ratingsBatch.resumeRatingsBatch();
    expect(resp.resumed).toEqual(true);
    // 轮询等待任务完成（v14.17.0：全局链空闲信号，防检查点未写入的空转竞态）
    for (let i = 0; i < 50; i++) {
      const s = ratingsBatch.getRatingsQueueStatus();
      if (!sessionGet(JOB_KEY) && !s.running && s.pending === 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(sessionGet(JOB_KEY)).toEqual(undefined);
    // 推送包含第一波评分与 done 收尾
    const ratingsPush = pushed.find((p) => p.msg.ratings && p.msg.ratings['艾尔登法环']);
    expect(ratingsPush && ratingsPush.tabId).toEqual(7);
    expect(!!pushed.find((p) => p.msg.done)).toEqual(true);
    const r = ratingsPush && ratingsPush.msg.ratings['艾尔登法环'];
    expect(r && String(r.appId)).toEqual('1245620');
  });

  test('陈旧任务（>1h）丢弃不续跑', async () => {
    storage._reset();
    pushed.length = 0;
    await chrome.storage.session.set({
      [JOB_KEY]: { tabId: 7, queue: ['游戏X'], retried: false, startedAt: Date.now() - 2 * 60 * 60 * 1000 }
    });
    const resp = await ratingsBatch.resumeRatingsBatch();
    expect(resp.resumed).toEqual(false);
    expect(resp.reason).toEqual('stale');
    expect(sessionGet(JOB_KEY)).toEqual(undefined);
    expect(pushed.length).toEqual(0);
  });

  test('无任务幂等早退', async () => {
    storage._reset();
    const resp = await ratingsBatch.resumeRatingsBatch();
    expect(resp.resumed).toEqual(false);
  });
  // v10.5.2 回归修复：本测试原位于 describe 顶层——vitest 先运行 describe 的
  // afterAll（恢复真实 fetch）再运行顶层测试，导致两个任务通过名称自愈路径
  // 发起真实 Steam 请求（网络延迟 0.5~7s），在负载下超出轮询预算而间歇失败。
  // 移入 describe 后 fetch mock 覆盖全部用例（配 applyCacheHit 自愈后台化双保险）。
  // Regression fix: this test was top-level, so the describe's afterAll restored
  // the real fetch before it ran — jobs then made real Steam calls via the name
  // self-heal path (0.5-7s each) and blew the polling budget under load.
  test('v10.0.0：连续两个任务——第一个 done 后守卫必须复位（滚动衔接第二批回归）', async () => {
    storage._reset();
    pushed.length = 0;
    // 第一个任务：经 startRatingJob 发起（与真实 GET_STEAM_RATINGS 路径一致）
    const started = ratingsBatch.startRatingJob({
      tabId: 8,
      queue: ['艾尔登法环'],
      retried: false,
      urlAppIds: {},
      imageData: {},
      appIds: {},
      startedAt: Date.now()
    });
    expect(started).toEqual(true);
    // v10.3.0：按 tab 队列化——job2 同 tab 排队接档（立即入队即返回 true，
    // 不会像旧 jobRunning 守卫那样被丢弃）；等待两个任务都完成
    const started2 = ratingsBatch.startRatingJob({
      tabId: 8,
      queue: ['艾尔登法环'],
      retried: false,
      urlAppIds: {},
      imageData: {},
      appIds: {},
      startedAt: Date.now()
    });
    expect(started2).toEqual(true);
    // v14.17.0：轮询改全局链空闲信号（running=false 且 pending=0）——仅轮询
    // session 清除会碰到"检查点尚未写入"的空转竞态（开跑推送移入任务体后
    // persistJob 前多一个 await hop，轮询首查必空）
    for (let i = 0; i < 80; i++) {
      const s = ratingsBatch.getRatingsQueueStatus();
      if (!s.running && s.pending === 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(sessionGet(JOB_KEY)).toEqual(undefined); // 全部任务 done 后检查点清除
    // 两次任务的评分推送都到达
    const ratingsPushes = pushed.filter((p) => p.msg.ratings && p.msg.ratings['艾尔登法环']);
    expect(ratingsPushes.length).toBeGreaterThanOrEqual(2);
  });
});

// ============ v14.28.8：停滞期边沿心跳（C 类门禁） ============
// 缺陷样本：20s 软阈值只写日志、UI 40s 无变化。此用例把条目软阈值压到
// 120ms（仅测试内覆盖 PERF_CONFIG，不改生产默认），断言"越过软阈值后
// 必然出现一次 progress.stalled 推送"——若删除 scheduleStallCheck 调用，
// 该推送永远不会发生，用例变红。
// Regression for the log-only watchdog: crossing the soft threshold must emit
// a stalled progress push instead of only writing a log line.
describe('v14.28.8 停滞边沿心跳', () => {
  test('条目越过软阈值 → 立即推送 progress.stalled（无需等成波）', async () => {
    for (let i = 0; i < 50; i++) {
      const s = ratingsBatch.getRatingsQueueStatus();
      if (!s.running && s.pending === 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    storage._reset();
    pushed.length = 0;
    resetApiMonitor();
    const prevSoft = PERF_CONFIG.ratingsItemSoftWarnMs;
    const prevHard = PERF_CONFIG.ratingsItemHardTimeoutMs;
    const prevFetch = globalThis.fetch;
    PERF_CONFIG.ratingsItemSoftWarnMs = 120;
    PERF_CONFIG.ratingsItemHardTimeoutMs = 900;
    // 永远挂起的 fetch：条目停在检索阶段（模拟慢网/黑洞）
    globalThis.fetch = () => new Promise(() => {});
    try {
      const started = ratingsBatch.startRatingJob({
        tabId: 21,
        queue: ['停滞测试游戏'],
        retried: false,
        urlAppIds: {},
        imageData: {},
        appIds: {},
        startedAt: Date.now()
      });
      expect(started).toEqual(true);
      let stallPush = null;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 50));
        stallPush = pushed.find((p) => p.msg && p.msg.progress && p.msg.progress.stalled);
        if (stallPush) break;
      }
      expect(stallPush, '越过软阈值后未出现 stalled 推送（看门狗只写日志的缺陷回归）').toBeTruthy();
      expect(stallPush.tabId).toEqual(21);
      expect(stallPush.msg.ratings).toBe(null); // 纯进度推送，不伪造结果
      expect(stallPush.msg.progress.stalled.elapsedMs).toBeGreaterThanOrEqual(120);
      // 20s 目标：软阈值 + 排程余量内必须到达（此处 120ms → ≤500ms）
    } finally {
      globalThis.fetch = prevFetch;
      PERF_CONFIG.ratingsItemSoftWarnMs = prevSoft;
      PERF_CONFIG.ratingsItemHardTimeoutMs = prevHard;
      for (let i = 0; i < 60; i++) {
        const s = ratingsBatch.getRatingsQueueStatus();
        if (!s.running && s.pending === 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      resetApiMonitor();
    }
  }, 20000);
});

// ============ v14.8.1：全局队列状态快照（等待徽章实时队列信息数据源） ============
describe('getRatingsQueueStatus（v14.8.1 等待检测队列信息）', () => {
  test('空闲态形状：running=false / pending=0 / current=null / degraded 布尔', () => {
    const s = ratingsBatch.getRatingsQueueStatus();
    expect(s.running).toBe(false);
    expect(s.pending).toBe(0);
    expect(s.current).toBe(null);
    expect(typeof s.degraded).toBe('boolean');
  });
});

// ============ v14.29.0：整队信封持久化 + 同 tab 任务替换 + 本页视角快照 ============
// 缺陷 1（检查点单槽）：多 tab 排队时只有运行中任务被持久化，SW 被杀后排队
// 任务全部蒸发 → 对应页面全部等 45s 强制收尾转"未返回"。修复 = 信封
// {v:2, jobs:[运行中, ...排队...]}，恢复时按序重入全局链。
// 缺陷 2（同 tab 旧任务不替换）：页面刷新/翻页后旧任务占位跑完，旧推送与
// 新批次交错。修复 = 同 tab 最新任务顶替旧任务。
describe('v14.29.0 整队持久化 + 同 tab 替换 + 本页视角快照', () => {
  /** 等待全局链空闲 / wait for the global chain to idle */
  async function waitForIdle() {
    for (let i = 0; i < 50; i++) {
      const s = ratingsBatch.getRatingsQueueStatus();
      if (!s.running && s.pending === 0) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  test('信封恢复：排队任务随运行任务一起续跑（SW 重启不再丢队）', async () => {
    await waitForIdle();
    storage._reset();
    pushed.length = 0;
    const fetchMock = createFetchMock({
      '/api/storesearch': { items: [{ id: 1245620, name: '艾尔登法环', type: 'game' }] },
      '/api/appdetails': {
        1245620: {
          success: true,
          data: { steam_appid: 1245620, name: '艾尔登法环', type: 'game', genres: [{ id: 1, description: 'RPG' }] }
        }
      },
      '/appreviews': {
        success: 1,
        query_summary: { total_reviews: 100, total_positive: 90, total_negative: 10, review_score_desc: '特别好评' },
        reviews: []
      }
    });
    const restore = installFetchMock(fetchMock);
    try {
      // 模拟上个 SW 实例留下的整队信封：tab41 运行中 + tab42 排队
      await chrome.storage.session.set({
        [JOB_KEY]: {
          v: 2,
          jobs: [
            {
              tabId: 41,
              queue: ['艾尔登法环'],
              retried: false,
              urlAppIds: {},
              imageData: {},
              appIds: {},
              startedAt: Date.now()
            },
            {
              tabId: 42,
              queue: ['艾尔登法环'],
              retried: false,
              urlAppIds: {},
              imageData: {},
              appIds: {},
              startedAt: Date.now()
            }
          ]
        }
      });
      const resp = await ratingsBatch.resumeRatingsBatch();
      expect(resp.resumed).toEqual(true);
      expect(resp.remaining).toEqual(2);
      for (let i = 0; i < 80; i++) {
        const s = ratingsBatch.getRatingsQueueStatus();
        if (!sessionGet(JOB_KEY) && !s.running && s.pending === 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(sessionGet(JOB_KEY)).toEqual(undefined);
      // 两个 tab 各自收到评分与 done；全局 FIFO 次序：tab41 先于 tab42
      const p41 = pushed.findIndex((p) => p.tabId === 41 && p.msg.ratings && p.msg.ratings['艾尔登法环']);
      const p42 = pushed.findIndex((p) => p.tabId === 42 && p.msg.ratings && p.msg.ratings['艾尔登法环']);
      expect(p41).toBeGreaterThanOrEqual(0);
      expect(p42).toBeGreaterThan(p41);
      expect(!!pushed.find((p) => p.tabId === 41 && p.msg.done)).toEqual(true);
      expect(!!pushed.find((p) => p.tabId === 42 && p.msg.done)).toEqual(true);
    } finally {
      restore();
      await waitForIdle();
    }
  });

  test('同 tab 排队任务替换：最新任务顶替旧任务（刷新/翻页后不占位）', async () => {
    await waitForIdle();
    storage._reset();
    pushed.length = 0;
    resetApiMonitor();
    const prevFetch = globalThis.fetch;
    const base = createFetchMock({
      '/api/storesearch': { items: [{ id: 1245620, name: '艾尔登法环', type: 'game' }] },
      '/api/appdetails': {
        1245620: {
          success: true,
          data: { steam_appid: 1245620, name: '艾尔登法环', type: 'game', genres: [{ id: 1, description: 'RPG' }] }
        }
      },
      '/appreviews': {
        success: 1,
        query_summary: { total_reviews: 100, total_positive: 90, total_negative: 10, review_score_desc: '特别好评' },
        reviews: []
      }
    });
    // 挂起门：首个任务占住运行位（fetch 挂起），排队语义在确定性冻结下断言
    let release = () => {};
    const gate = new Promise((res) => {
      release = res;
    });
    globalThis.fetch = async (/** @type {any} */ url, /** @type {any} */ opts) => {
      await gate;
      return base(url, opts);
    };
    try {
      ratingsBatch.startRatingJob({
        tabId: 51,
        queue: ['挂起占位游戏'],
        retried: false,
        urlAppIds: {},
        imageData: {},
        appIds: {},
        startedAt: Date.now()
      });
      for (let i = 0; i < 40; i++) {
        const s = ratingsBatch.getRatingsQueueStatus();
        if (s.running && s.current && s.current.tabId === 51) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      // 同 tab 连入两个任务 → 第二个顶替第一个（旧任务不占队列位）
      ratingsBatch.startRatingJob({
        tabId: 51,
        queue: ['游戏甲'],
        retried: false,
        urlAppIds: {},
        imageData: {},
        appIds: {},
        startedAt: Date.now()
      });
      ratingsBatch.startRatingJob({
        tabId: 51,
        queue: ['游戏乙', '游戏丙'],
        retried: false,
        urlAppIds: {},
        imageData: {},
        appIds: {},
        startedAt: Date.now()
      });
      const s = ratingsBatch.getRatingsQueueStatus(51);
      expect(s.pending).toEqual(1); // 只剩最新任务一个排队位
      expect(s.you).toBeTruthy();
      expect(s.you.position).toEqual(0); // 前方排队任务 0 个（旧任务已被顶替）
      expect(s.you.running).toEqual(false);
      expect(s.you.total).toEqual(2); // 保留的是最新任务的队列
      expect(s.you.aheadItems).toBeGreaterThanOrEqual(1); // 运行中任务剩余条目计入前方
      release();
      for (let i = 0; i < 100; i++) {
        const s2 = ratingsBatch.getRatingsQueueStatus();
        if (!sessionGet(JOB_KEY) && !s2.running && s2.pending === 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      // 最新任务的条目照常推送到同 tab（含确定性 miss 的 null 值条目）；
      // 被顶替的旧任务条目无推送
      const ethas = pushed.some(
        (p) => p.tabId === 51 && p.msg.ratings && Object.prototype.hasOwnProperty.call(p.msg.ratings, '游戏乙')
      );
      expect(ethas).toEqual(true);
      const jiaLeak = pushed.some(
        (p) => p.tabId === 51 && p.msg.ratings && Object.prototype.hasOwnProperty.call(p.msg.ratings, '游戏甲')
      );
      expect(jiaLeak).toEqual(false);
      expect(!!pushed.find((p) => p.tabId === 51 && p.msg.done)).toEqual(true);
    } finally {
      release();
      globalThis.fetch = prevFetch;
      await waitForIdle();
      resetApiMonitor();
    }
  }, 20000);
});

// ============ v14.17.0：任务时长治理（硬截止 + 死 tab 中止——多标签页排队卡死修复） ============
// v14.17.0: job runtime governance. A preset/past deadlineAt drops remaining
// names and pushes done immediately; a dead tab (push fails) skips/aborts its
// job instead of grinding the global chain for minutes while later tabs wait.
describe('v14.17.0 任务治理：硬截止 + 死 tab 中止', () => {
  /** 等待全局链空闲（前序用例可能仍在收尾）/ wait for the global chain to idle */
  async function waitForIdle() {
    for (let i = 0; i < 50; i++) {
      const s = ratingsBatch.getRatingsQueueStatus();
      if (!s.running && s.pending === 0) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  test('硬截止（deadlineAt 已过）：丢项立即 done 收尾并清检查点', async () => {
    await waitForIdle();
    storage._reset();
    pushed.length = 0;
    const started = ratingsBatch.startRatingJob({
      tabId: 9,
      queue: ['艾尔登法环', '游戏X', '游戏Y'],
      retried: false,
      urlAppIds: {},
      imageData: {},
      appIds: {},
      startedAt: Date.now(),
      // 预置已过期的硬截止（runNextGlobal 对已预置的 deadlineAt 继承不重置）
      deadlineAt: Date.now() - 1
    });
    expect(started).toEqual(true);
    // v14.17.0：全局链空闲信号轮询（防"检查点尚未写入"的空转竞态）
    for (let i = 0; i < 50; i++) {
      const s = ratingsBatch.getRatingsQueueStatus();
      if (!sessionGet(JOB_KEY) && !s.running && s.pending === 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(sessionGet(JOB_KEY)).toEqual(undefined);
    // worker 循环未跑（截止已过）→ 无评分波次；但必有 done 终态推送（内容侧立即收尾）
    expect(pushed.find((p) => p.msg.ratings && p.msg.ratings['艾尔登法环'])).toEqual(undefined);
    const donePush = pushed.find((p) => p.msg.done);
    expect(!!donePush).toEqual(true);
    expect(donePush && donePush.tabId).toEqual(9);
  });

  test('死 tab 中止（推送失败）：任务跳过/排队任务出队，链复位空闲', async () => {
    await waitForIdle();
    storage._reset();
    pushed.length = 0;
    const prevSend = globalThis.chrome.tabs.sendMessage;
    // 模拟 tab 已关闭：sendMessage 全部拒绝（无接收端）
    globalThis.chrome.tabs.sendMessage = async () => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    };
    try {
      ratingsBatch.startRatingJob({
        tabId: 10,
        queue: ['艾尔登法环'],
        retried: false,
        urlAppIds: {},
        imageData: {},
        appIds: {},
        startedAt: Date.now()
      });
      // 同步紧随的第二个任务走排队分支——排队位置推送失败应被就地出队
      ratingsBatch.startRatingJob({
        tabId: 10,
        queue: ['游戏X'],
        retried: false,
        urlAppIds: {},
        imageData: {},
        appIds: {},
        startedAt: Date.now()
      });
      for (let i = 0; i < 50; i++) {
        const s = ratingsBatch.getRatingsQueueStatus();
        if (!s.running && s.pending === 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const s = ratingsBatch.getRatingsQueueStatus();
      expect(s.running).toBe(false);
      expect(s.pending).toBe(0);
      expect(sessionGet(JOB_KEY)).toEqual(undefined);
      expect(pushed.length).toEqual(0); // 全部推送失败——无评分/进度写入
    } finally {
      globalThis.chrome.tabs.sendMessage = prevSend;
    }
  });

  test('v14.18.0：分类页平台提示——无标记标题经 platformHint 命中模拟器分支', async () => {
    await waitForIdle();
    storage._reset();
    pushed.length = 0;
    // 咸鱼单机 /pcdj/mnqzh 真实标题（"模拟器版"标签在标题外）——无提示词时
    // 标题级识别落空当 PC；携带 platformHint 后零网络直达 platformOnly 终态
    const name = '宝可梦传说：阿尔宙斯|v1.1.1|官方中文|支持手柄|Pokemon Legends: Arceus';
    const started = ratingsBatch.startRatingJob({
      tabId: 11,
      queue: [name],
      retried: false,
      urlAppIds: {},
      imageData: {},
      appIds: {},
      startedAt: Date.now(),
      platformHint: '模拟器版'
    });
    expect(started).toEqual(true);
    for (let i = 0; i < 50; i++) {
      const s = ratingsBatch.getRatingsQueueStatus();
      if (!sessionGet(JOB_KEY) && !s.running && s.pending === 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const platPush = pushed.find((p) => p.msg.ratings && p.msg.ratings[name]);
    expect(platPush && platPush.tabId).toEqual(11);
    const r = platPush && platPush.msg.ratings[name];
    expect(r && r.platformOnly).toBe(true);
    expect(r && r.platformTag).toEqual('模拟器');
    expect(!!pushed.find((p) => p.msg.done)).toEqual(true);
  });
});
