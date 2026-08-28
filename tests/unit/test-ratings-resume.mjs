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
    // 轮询等待任务完成（session 任务被清除 = done）
    for (let i = 0; i < 50 && sessionGet(JOB_KEY); i++) await new Promise((r) => setTimeout(r, 50));
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
});

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
  for (let i = 0; i < 50 && sessionGet(JOB_KEY); i++) await new Promise((r) => setTimeout(r, 50));
  expect(sessionGet(JOB_KEY)).toEqual(undefined); // 第一个任务 done
  // 第二个任务必须能发起（回归：jobRunning 未复位时 startRatingJob 返回 false）
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
  for (let i = 0; i < 50 && sessionGet(JOB_KEY); i++) await new Promise((r) => setTimeout(r, 50));
  expect(sessionGet(JOB_KEY)).toEqual(undefined);
  // 两次任务的评分推送都到达
  const ratingsPushes = pushed.filter((p) => p.msg.ratings && p.msg.ratings['艾尔登法环']);
  expect(ratingsPushes.length).toBeGreaterThanOrEqual(2);
});
