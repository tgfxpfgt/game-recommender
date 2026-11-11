import { test, expect, describe, beforeEach } from 'vitest';
/**
 * 游戏雷达 Game Radar - 测试：匹配置信度三态（v14.28.6 R4-B）
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

describe('置信度规则（纯函数，v14.28.7 二次校准）', () => {
  const base = {
    gameName: '艾尔登法环 2022 官方中文',
    resultName: '艾尔登法环',
    platform: 'pc',
    source: 'storesearch'
  };

  test('平台+标题+发行年份一致 → confirmed', () => {
    const m = mc.rateMatchConfidence({ ...base, pageYear: 2022, steamYear: 2022 });
    expect(m.confidence).toEqual('confirmed');
    expect(m.reason).toEqual('all-match');
    expect(m.sourceLabel).toEqual('Steam 商店搜索');
    expect(m.platformLabel).toEqual('PC');
  });

  test('一侧年份缺失不降级 → confirmed（year-unknown）', () => {
    const noPage = mc.rateMatchConfidence({ ...base, pageYear: null, steamYear: 2022 });
    expect(noPage.confidence).toEqual('confirmed');
    expect(noPage.reason).toEqual('year-unknown');
    const noSteam = mc.rateMatchConfidence({ ...base, pageYear: 2022, steamYear: null });
    expect(noSteam.confidence).toEqual('confirmed');
    expect(noSteam.reason).toEqual('year-unknown');
  });

  test('两侧年份都在且相差 ≤1 年 → confirmed；相差 >1 年 → suspected', () => {
    const one = mc.rateMatchConfidence({ ...base, pageYear: 2022, steamYear: 2021 });
    expect(one.confidence).toEqual('confirmed');
    expect(one.reason).toEqual('all-match');
    const two = mc.rateMatchConfidence({
      gameName: '某游戏 2024 官方中文',
      resultName: '某游戏',
      platform: 'pc',
      pageYear: 2024,
      steamYear: 2021
    });
    expect(two.confidence).toEqual('suspected');
    expect(two.reason).toEqual('year-mismatch');
  });

  test('标题相似度不足 → suspected，且保留依据（匹配标题+来源）', () => {
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
    expect(m.similarity).toBeLessThan(mc.TITLE_SIMILARITY_THRESHOLD);
  });

  test('平台不一致最优先 → suspected（即便标题完全一致）', () => {
    const m = mc.rateMatchConfidence({
      gameName: '战神：诸神黄昏 PS5|官方中文',
      resultName: '',
      platform: 'non-pc',
      pageYear: 2022,
      steamYear: 2022
    });
    expect(m.confidence).toEqual('suspected');
    expect(m.reason).toEqual('platform-unconfirmed');
    expect(m.platformLabel).toEqual('非 PC（主机/移动/云游戏）');
  });

  test('页面标题含英文并列段：英文 Steam 名可确认（逐段比对）', () => {
    const m = mc.rateMatchConfidence({
      gameName: '人类/Humankind - 咸鱼单机',
      resultName: 'HUMANKIND™',
      platform: 'pc',
      pageYear: null,
      steamYear: 2021
    });
    expect(m.confidence).toEqual('confirmed');
    expect(m.reason).toEqual('year-unknown');
  });

  test('标题相似度门槛本身可测：包含/相等过门，续作序号不过门', () => {
    expect(mc.titleSimilarity('艾尔登法环', '艾尔登法环 2022 官方中文')).toEqual(1);
    expect(mc.titleSimilarity('HUMANKIND™', '人类/Humankind - 咸鱼单机')).toEqual(1);
    expect(mc.titleMatches('赛博朋克2077', '赛博朋克2077：终极版|官方中文')).toBe(true);
    expect(mc.titleMatches('塞尔达传说 旷野之息', '塞尔达传说：王国之泪|官方中文')).toBe(false);
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
      expect(hit && hit.matchNote).toEqual('匹配标题与页面标题相似度不足');
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
      expect(hit && hit.matchNote).toEqual('标题一致，平台为 PC，发行年份相符');
      expect(hit && hit.matchPlatform).toEqual('PC');
    } finally {
      restore();
    }
  });

  test('页面无年份不降级 → confirmed（year-unknown，替换旧裁决 3）', async () => {
    await seed('1245620', { name: '艾尔登法环', releaseDate: '2022-02-25' });
    await nameIdx.recordNameIndex('艾尔登法环|官方中文', '1245620');
    const restore = noNetwork();
    try {
      const hit = await orchestratorList.getSteamRatingsFromCacheOnly('艾尔登法环|官方中文', {});
      expect(hit && hit.matchConfidence).toEqual('confirmed');
      expect(hit && hit.matchNote).toEqual('标题一致，平台为 PC；发行年份仅一侧可知（不降级）');
      expect(hit && hit.matchSource).toEqual('名称索引缓存');
    } finally {
      restore();
    }
  });

  test('移动版标题命中同名 Steam 缓存 → suspected（平台最优先）', async () => {
    await seed('1245620', { name: '艾尔登法环', releaseDate: '2022-02-25' });
    await nameIdx.recordNameIndex('艾尔登法环 安卓版|官方中文', '1245620');
    const restore = noNetwork();
    try {
      const hit = await orchestratorList.getSteamRatingsFromCacheOnly('艾尔登法环 安卓版|官方中文', {});
      expect(hit && hit.matchConfidence).toEqual('suspected');
      expect(hit && hit.matchNote).toEqual('未能确认是 PC 版本（主机/移动/云游戏同名条目）');
      expect(hit && hit.matchPlatform).toEqual('非 PC（主机/移动/云游戏）');
    } finally {
      restore();
    }
  });
});
