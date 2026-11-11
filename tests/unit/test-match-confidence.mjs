import { test, expect, describe, beforeEach } from 'vitest';
/**
 * 游戏雷达 Game Radar - 测试：匹配置信度三态（v14.30.0 R4-B）
 *
 * 覆盖用户裁决：确认 = 平台 + 标题 + 发行年份三者一致（缺任一 → 推测，年份
 * 缺失按缺失处理）；第一波平台预检拦下主机条目（不得被名称索引钉住的错误
 * Steam 缓存"看起来成功"）。
 * Covers the 3-factor confidence rule and the wave-1 platform pre-check.
 */

import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';
import { installFetchMock } from '../helpers/fetch-mock.mjs';

const storage = createStorageMock();
installChromeStorageMock(storage);

globalThis.chrome.runtime = globalThis.chrome.runtime || {};
globalThis.chrome.runtime.getPlatformInfo = async () => ({ os: 'win' });
globalThis.chrome.alarms = { create: () => {}, clear: () => {} };
globalThis.chrome.tabs = globalThis.chrome.tabs || { sendMessage: async () => ({}) };

const mc = await import(
  new URL('../../background/steam/match-confidence.js', import.meta.url).href + '?t=' + Date.now()
);
const orchestratorList = await import(
  new URL('../../background/steam/orchestrator-list.js', import.meta.url).href + '?t=' + Date.now()
);
// 不带 ?t=：与 orchestrator 的静态 import 共享实例（状态互不可见的教训见 test-orchestrator）
const cacheMod = await import(new URL('../../background/storage/steam-cache.js', import.meta.url).href);
const nameIdx = await import(new URL('../../background/storage/name-index.js', import.meta.url).href);

// 第一波是零网络语义：任何 fetch 都是缺陷（mock 直接抛错暴露）
const noNetwork = () =>
  installFetchMock(async (url) => {
    throw new Error('第一波不应发起网络请求: ' + String(url));
  });

async function seed(appId, fields) {
  await cacheMod.loadSteamCacheToMemory();
  await cacheMod.setSteamCacheEntry(String(appId), {
    appId: String(appId),
    type: 'game',
    ratingDesc: '特别好评',
    positiveRate: 88,
    totalReviews: 1000,
    lastUpdate: '2026-08-01',
    ...fields
  });
  await cacheMod.flushSteamCache();
}

beforeEach(async () => {
  storage._reset();
  nameIdx.resetNameIndex();
  if (typeof cacheMod.resetSteamCache === 'function') cacheMod.resetSteamCache();
  await cacheMod.loadSteamCacheToMemory();
});

describe('三要素判定（纯函数）', () => {
  const base = {
    gameName: '艾尔登法环 2022 官方中文',
    resultName: '艾尔登法环',
    platform: 'pc',
    source: 'storesearch'
  };

  test('平台+标题+发行年份三者一致 → confirmed', () => {
    const m = mc.rateMatchConfidence({ ...base, pageYear: 2022, steamYear: 2022 });
    expect(m.confidence).toEqual('confirmed');
    expect(m.reason).toEqual('all-match');
    expect(m.sourceLabel).toEqual('Steam 商店搜索');
  });

  test('年份缺失按缺失处理 → suspected（禁止近似补齐）', () => {
    const m = mc.rateMatchConfidence({ ...base, pageYear: null, steamYear: 2022 });
    expect(m.confidence).toEqual('suspected');
    expect(m.reason).toEqual('no-page-year');
  });

  test('Steam 年份缺失 → suspected', () => {
    const m = mc.rateMatchConfidence({ ...base, pageYear: 2022, steamYear: null });
    expect(m.confidence).toEqual('suspected');
    expect(m.reason).toEqual('no-steam-year');
  });

  test('年份不一致 → suspected', () => {
    const m = mc.rateMatchConfidence({
      gameName: '某游戏 2024 官方中文',
      resultName: '某游戏',
      platform: 'pc',
      pageYear: 2024,
      steamYear: 2021
    });
    expect(m.confidence).toEqual('suspected');
    expect(m.reason).toEqual('year-mismatch');
  });

  test('标题不一致 → suspected，且保留依据（匹配标题+来源）', () => {
    const m = mc.rateMatchConfidence({
      gameName: '塞尔达传说：王国之泪 2023 官方中文',
      resultName: '塞尔达传说 旷野之息',
      platform: 'pc',
      pageYear: 2023,
      steamYear: 2017,
      source: 'index'
    });
    expect(m.confidence).toEqual('suspected');
    expect(m.reason).toEqual('title-mismatch');
    expect(m.resultName).toEqual('塞尔达传说 旷野之息');
    expect(m.sourceLabel).toEqual('名称索引缓存');
  });

  test('平台未确认（主机）→ suspected', () => {
    const m = mc.rateMatchConfidence({ ...base, platform: 'non-pc', pageYear: 2022, steamYear: 2022 });
    expect(m.confidence).toEqual('suspected');
    expect(m.reason).toEqual('platform-unconfirmed');
  });

  test('页面年份只认独立段：游戏名数字不当年份', () => {
    expect(mc.extractTitleYear('赛博朋克2077|官方中文')).toEqual(null);
    expect(mc.extractTitleYear('赛博朋克2077 2020 官方中文')).toEqual(2020);
    expect(mc.extractTitleYear('艾尔登法环（2022）|中文')).toEqual(2022);
    expect(mc.extractTitleYear('某游戏|v1.0.3')).toEqual(null);
  });

  test('Steam 日期串 → 年份', () => {
    expect(mc.yearOfDateString('2022-02-25')).toEqual(2022);
    expect(mc.yearOfDateString('2022年2月25日')).toEqual(2022);
    expect(mc.yearOfDateString('')).toEqual(null);
    expect(mc.yearOfDateString('即将推出')).toEqual(null);
  });
});

describe('第一波（零网络）：平台预检与置信度', () => {
  test('主机条目不得命中名称索引钉住的无关 Steam 缓存（看起来成功的错误匹配）', async () => {
    await seed('110000', { name: 'God of War', releaseDate: '2018-01-14' });
    await nameIdx.recordNameIndex('战神：诸神黄昏 PS5|官方中文', '110000');
    const restore = noNetwork();
    try {
      const hit = await orchestratorList.getSteamRatingsFromCacheOnly('战神：诸神黄昏 PS5|官方中文', {});
      expect(hit).toEqual(null); // 交第二波 phasePlatform（Metacritic）
    } finally {
      restore();
    }
  });

  test('同名不同平台：去掉主机标记后 PC 条目正常命中（证明拦下的是平台而非缓存）', async () => {
    await seed('110000', { name: 'God of War', releaseDate: '2018-01-14' });
    await nameIdx.recordNameIndex('战神：诸神黄昏|官方中文', '110000');
    const restore = noNetwork();
    try {
      const hit = await orchestratorList.getSteamRatingsFromCacheOnly('战神：诸神黄昏|官方中文', {});
      expect(hit && hit.positiveRate).toEqual(88);
      expect(hit && typeof hit.matchConfidence).toEqual('string');
    } finally {
      restore();
    }
  });

  test('重名续作：索引钉到前作缓存 → 返回但标推测（标题不一致）', async () => {
    await seed('900001', { name: '塞尔达传说 旷野之息', releaseDate: '2017-03-03' });
    await nameIdx.recordNameIndex('塞尔达传说：王国之泪|官方中文', '900001');
    const restore = noNetwork();
    try {
      const hit = await orchestratorList.getSteamRatingsFromCacheOnly('塞尔达传说：王国之泪|官方中文', {});
      expect(hit && hit.positiveRate).toEqual(88);
      expect(hit && hit.matchConfidence).toEqual('suspected');
      expect(hit && hit.matchNote).toEqual('匹配标题与页面标题不一致');
      expect(hit && hit.matchName).toEqual('塞尔达传说 旷野之息');
    } finally {
      restore();
    }
  });

  test('版本后缀+年份一致 → confirmed（标题可比、年份可核）', async () => {
    await seed('1245620', { name: '艾尔登法环', releaseDate: '2022-02-25' });
    await nameIdx.recordNameIndex('艾尔登法环 2022 官方中文', '1245620');
    const restore = noNetwork();
    try {
      const hit = await orchestratorList.getSteamRatingsFromCacheOnly('艾尔登法环 2022 官方中文', {});
      expect(hit && hit.matchConfidence).toEqual('confirmed');
      expect(hit && hit.matchNote).toEqual('平台、标题、发行年份三项一致');
    } finally {
      restore();
    }
  });

  test('页面无年份 → suspected（裁决 3 的直接后果，记录在案）', async () => {
    await seed('1245620', { name: '艾尔登法环', releaseDate: '2022-02-25' });
    await nameIdx.recordNameIndex('艾尔登法环|官方中文', '1245620');
    const restore = noNetwork();
    try {
      const hit = await orchestratorList.getSteamRatingsFromCacheOnly('艾尔登法环|官方中文', {});
      expect(hit && hit.matchConfidence).toEqual('suspected');
      expect(hit && hit.matchNote).toEqual('页面标题未含发行年份，无法核对年份');
      expect(hit && hit.matchSource).toEqual('名称索引缓存');
    } finally {
      restore();
    }
  });
});
