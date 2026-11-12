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
import { createFetchMock, installFetchMock } from '../helpers/fetch-mock.mjs';

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
// v14.28.7 R4 补测：详情链路（浮窗/详情面板的真实挂点）与平台判定纯函数
const orchestratorDetail = await import(
  new URL('../../background/steam/orchestrator-detail.js', import.meta.url).href + '?t=' + Date.now()
);
const { detectOffSteamPlatform } = await import(new URL('../../shared/platform-detect.js', import.meta.url).href);
// 测试隔离：appdetails 有 10s 去重表（跨用例复用会串味），注册表内存同为单例
const { resetAppDetailsDedupForTest } = await import(
  new URL('../../background/steam/api-details.js', import.meta.url).href
);
const { resetRegistry } = await import(new URL('../../background/storage/registry.js', import.meta.url).href);

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

// v14.28.7 R4 补测：详情链路的 Steam 出站替身。名称索引命中错误 appId 后，
// 管线真实执行「检索 → 详情组装 → 置信度打标」——这正是用户症状
// 「一直去匹配 appid 结果错误」所走的路径。不用缓存 seed：详情缓存命中判定
// 要求 detail 模块含 name，而 name 按 FIELD_MODULES 落在 meta 模块（恒不命中）。
// Steam API stand-in for the detail pipeline (mirrors the reported symptom path).
function mockSteam(appId, name, englishName, releaseDate) {
  const mock = createFetchMock({
    '/api/storesearch': { items: [{ id: Number(appId), name: englishName, type: 'app' }] },
    '/api/appdetails': (u) => {
      const id = (String(u).match(/appids=(\d+)/) || [])[1] || appId;
      return {
        [id]: {
          success: true,
          data: {
            steam_appid: Number(id),
            name,
            type: 'game',
            genres: [{ id: 1, description: '动作' }],
            release_date: { date: releaseDate },
            supported_languages: '<strong>简体中文</strong><br>界面、完全音频、字幕'
          }
        }
      };
    },
    '/appreviews': {
      success: 1,
      query_summary: {
        total_reviews: 1000,
        total_positive: 900,
        total_negative: 100,
        review_score: 9,
        review_score_desc: '特别好评'
      },
      reviews: []
    },
    '/api/ISteamNews': { appnews: { newsitems: [{ date: 1754900000 }] } }
  });
  return installFetchMock(mock);
}

beforeEach(async () => {
  storage._reset();
  nameIdx.resetNameIndex();
  resetRegistry();
  resetAppDetailsDedupForTest();
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

  // v14.28.13（三目标审查 P1-2）：人工纠正来源强制 confirmed——用户确认的映射
  // 优先于相似度/平台/年份自动判定（纠正后仍标「推测」语义不合理）。
  test('P1-2：correction 来源强制 confirmed（相似度不足也不降级）', () => {
    const m = mc.rateMatchConfidence({
      gameName: '生化危机4 重制版',
      resultName: 'Resident Evil 4', // 跨语言相似度低——storesearch 来源会判 title-mismatch
      platform: 'pc',
      source: 'correction'
    });
    expect(m.confidence).toEqual('confirmed');
    expect(m.reason).toEqual('user-correction');
    expect(m.sourceLabel).toEqual('用户报错纠正记录');
  });

  test('P1-2：correction 且页面判非 PC 也 confirmed（用户判断优先于平台门）', () => {
    const m = mc.rateMatchConfidence({
      gameName: '某主机同名游戏',
      resultName: 'Some Game',
      platform: 'non-pc',
      source: 'correction'
    });
    expect(m.confidence).toEqual('confirmed');
    expect(m.reason).toEqual('user-correction');
  });

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

// ============ v14.28.7 R4 补测：平台误配主路径 ============
// 用户指出的缺口：既有 42 条夹具里 platform-unconfirmed 一次都没触发——修复针对的
// 主路径（主机/移动/云游戏标题命中 Steam 同名条目）无覆盖。本组逐条锁定
// 「判定 + 命中条目（appId/标题）+ 平台字段 + 理由文案」，任一判 confirmed 即缺陷。
// Regression fixtures for the platform-mismatch main path (previously untested).
describe('平台误配夹具：判定 + 命中条目 + 平台字段 + 理由', () => {
  const FIXTURES = [
    {
      id: '主机独占·同名不同游戏',
      page: '猎天使魔女3 Switch|官方中文',
      appId: '460790',
      steamName: '猎天使魔女',
      englishName: 'Bayonetta',
      releaseDate: '2017-04-11',
      kind: 'console'
    },
    {
      id: '同系列·差 1 代',
      page: '斯普拉遁3 Switch|官方中文',
      appId: '900101',
      steamName: '斯普拉遁2',
      englishName: 'Splatoon 2',
      releaseDate: '2017-07-21',
      kind: 'console'
    },
    {
      id: '同系列·差 2 代',
      page: '生化危机9 Switch|官方中文',
      appId: '900102',
      steamName: '生化危机7',
      englishName: 'Resident Evil 7',
      releaseDate: '2017-01-24',
      kind: 'console'
    },
    {
      id: '重制版/决定版（Steam 只有重制）',
      page: '恶魔之魂 PS5|官方中文',
      appId: '900103',
      steamName: '恶魔之魂：重制版',
      englishName: 'Demon\u2019s Souls Remake',
      releaseDate: '2020-11-12',
      kind: 'console'
    },
    {
      id: '云游戏标题命中同名条目',
      page: '赛博朋克2077 云游戏|官方中文',
      appId: '1091500',
      steamName: '赛博朋克2077',
      englishName: 'Cyberpunk 2077',
      releaseDate: '2020-12-10',
      kind: 'cloud'
    },
    {
      id: '移动端标题命中同名条目',
      page: '死亡细胞 安卓版|官方中文',
      appId: '588650',
      steamName: '死亡细胞',
      englishName: 'Dead Cells',
      releaseDate: '2018-08-07',
      kind: 'mobile'
    }
  ];

  for (const fx of FIXTURES) {
    test(`${fx.id} → 推测（命中 ${fx.steamName} / ${fx.appId}）`, async () => {
      await nameIdx.recordNameIndex(fx.page, fx.appId);
      const restore = mockSteam(fx.appId, fx.steamName, fx.englishName, fx.releaseDate);
      let r;
      try {
        r = await orchestratorDetail.searchSteamGame(fx.page, { rawTitle: fx.page, ignoreNegativeCache: true });
      } finally {
        restore();
      }
      // 平台判定字段
      const off = detectOffSteamPlatform(fx.page);
      expect(off && off.kind).toEqual(fx.kind);
      // 判定 + 理由文案
      expect(r).toBeTruthy();
      expect(r.matchConfidence).toEqual('suspected');
      expect(r.matchNote).toEqual('未能确认是 PC 版本（主机/移动/云游戏同名条目）');
      expect(r.matchPlatform).toEqual('非 PC（主机/移动/云游戏）');
      // 命中条目（appId + 标题）
      expect(String(r.appId)).toEqual(fx.appId);
      expect(r.name).toEqual(fx.steamName);
      expect(r.matchName).toEqual(fx.steamName);
    });
  }

  test('第一波：主机三例 → 未找到（null，不得返回可展示条目）', async () => {
    const restore = noNetwork();
    try {
      for (const fx of FIXTURES.filter((f) => f.kind === 'console')) {
        storage._reset();
        nameIdx.resetNameIndex();
        cacheMod.resetSteamCache();
        await cacheMod.loadSteamCacheToMemory();
        await seed(fx.appId, { name: fx.steamName, releaseDate: fx.releaseDate });
        await nameIdx.recordNameIndex(fx.page, fx.appId);
        const hit = await orchestratorList.getSteamRatingsFromCacheOnly(fx.page, {});
        expect(hit).toEqual(null);
      }
    } finally {
      restore();
    }
  });

  test('第一波：云游戏/移动 → 命中但推测（不得 confirmed）', async () => {
    const restore = noNetwork();
    try {
      for (const fx of FIXTURES.filter((f) => f.kind !== 'console')) {
        storage._reset();
        nameIdx.resetNameIndex();
        cacheMod.resetSteamCache();
        await cacheMod.loadSteamCacheToMemory();
        await seed(fx.appId, { name: fx.steamName, releaseDate: fx.releaseDate });
        await nameIdx.recordNameIndex(fx.page, fx.appId);
        const hit = await orchestratorList.getSteamRatingsFromCacheOnly(fx.page, {});
        expect(hit && hit.matchConfidence).toEqual('suspected');
        expect(hit && hit.matchNote).toEqual('未能确认是 PC 版本（主机/移动/云游戏同名条目）');
        expect(String(hit && hit.appId)).toEqual(fx.appId);
      }
    } finally {
      restore();
    }
  });
});

// 对照：多平台作品不得被平台规则误伤（避免"正常情况也打成推测"）
describe('对照：多平台作品保持确认', () => {
  test('多平台同时发售、页面无主机标记 → confirmed', async () => {
    await nameIdx.recordNameIndex('艾尔登法环|官方中文', '1245620');
    const restore = mockSteam('1245620', '艾尔登法环', 'Elden Ring', '2022-02-25');
    let r;
    try {
      r = await orchestratorDetail.searchSteamGame('艾尔登法环|官方中文', {
        rawTitle: '艾尔登法环|官方中文',
        ignoreNegativeCache: true
      });
    } finally {
      restore();
    }
    expect(detectOffSteamPlatform('艾尔登法环|官方中文')).toEqual(null);
    expect(r && r.matchConfidence).toEqual('confirmed');
    expect(r && r.matchPlatform).toEqual('PC');
    expect(r && r.matchNote).toEqual('标题一致，平台为 PC；发行年份仅一侧可知（不降级）');
  });

  test('页面显式 PC 标记 + 主机标记（PC|PS5）→ PC 优先，confirmed', async () => {
    await nameIdx.recordNameIndex('艾尔登法环 PC|PS5 官方中文', '1245620');
    const restore = mockSteam('1245620', '艾尔登法环', 'Elden Ring', '2022-02-25');
    let r;
    try {
      r = await orchestratorDetail.searchSteamGame('艾尔登法环 PC|PS5 官方中文', {
        rawTitle: '艾尔登法环 PC|PS5 官方中文',
        ignoreNegativeCache: true
      });
    } finally {
      restore();
    }
    expect(detectOffSteamPlatform('艾尔登法环 PC|PS5 官方中文')).toEqual(null);
    expect(r && r.matchConfidence).toEqual('confirmed');
    expect(r && r.matchPlatform).toEqual('PC');
  });
});
