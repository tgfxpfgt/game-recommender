import { test, expect } from 'vitest';
/**
 * Game Recommender - 测试：限免平台分类 / Free-Games Classification Tests
 *
 * v4.2.0：classifyGamerPowerGiveaway（官方直领 vs 第三方 key 领取）与
 * extractThirdPartySource（来源识别）——v4.1.0 起已导出纯函数。
 */
'use strict';


const mod = await import(new URL('../../background/freegames/manager.js', import.meta.url).href + '?t=' + Date.now());
const { classifyGamerPowerGiveaway, extractThirdPartySource } = mod;

console.log('1. 官方直领 vs 第三方（classifyGamerPowerGiveaway）');
test('无 key 标记 → direct', () => { expect(classifyGamerPowerGiveaway({ title: '某游戏', instructions: '登录 Epic 领取' })).toEqual('direct'); });
test('标题含 key → thirdparty', () => { expect(classifyGamerPowerGiveaway({ title: 'Free Game Key', instructions: '' })).toEqual('thirdparty'); });
test('instructions 含 alienware → thirdparty', () => { expect(classifyGamerPowerGiveaway({ title: 'X', instructions: 'Get your key at Alienware Arena' })).toEqual('thirdparty'); });
test('instructions 含 redeem your key → thirdparty', () => { expect(classifyGamerPowerGiveaway({ title: 'X', instructions: 'Redeem your key on Steam' })).toEqual('thirdparty'); });
test('instructions 含 humble bundle → thirdparty', () => { expect(classifyGamerPowerGiveaway({ title: 'X', instructions: 'Claim on Humble Bundle' })).toEqual('thirdparty'); });
test('instructions 含 fanatical → thirdparty', () => { expect(classifyGamerPowerGiveaway({ title: 'X', instructions: 'Your free key at Fanatical' })).toEqual('thirdparty'); });
test('空对象 → direct', () => { expect(classifyGamerPowerGiveaway({})).toEqual('direct'); });
test('大小写不敏感', () => { expect(classifyGamerPowerGiveaway({ title: 'FREE GAME KEY', instructions: '' })).toEqual('thirdparty'); });

console.log('2. 第三方来源识别（extractThirdPartySource）');
test('alienware → Alienware Arena', () => { expect(extractThirdPartySource({ instructions: 'claim at Alienware' })).toEqual('Alienware Arena'); });
test('indiegala → IndieGala', () => { expect(extractThirdPartySource({ instructions: 'get key at IndieGala' })).toEqual('IndieGala'); });
test('humble → Humble Bundle', () => { expect(extractThirdPartySource({ instructions: 'redeem on humble bundle' })).toEqual('Humble Bundle'); });
test('fanatical → Fanatical', () => { expect(extractThirdPartySource({ instructions: 'key via Fanatical' })).toEqual('Fanatical'); });
test('未知来源 → 第三方平台', () => { expect(extractThirdPartySource({ instructions: 'something else' })).toEqual('第三方平台'); });
test('无 instructions → 第三方平台', () => { expect(extractThirdPartySource({})).toEqual('第三方平台'); });


// ============ 2. 限免抓取与领取主体（v6.3.0 盲区补强） ============
console.log('2. refreshFreeGames / claimFreeGame（mock 四源抓取）');
import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';
import { createFetchMock, installFetchMock } from '../helpers/fetch-mock.mjs';

const storage = createStorageMock();
installChromeStorageMock(storage);

test('refreshFreeGames 聚合四源并去重', async () => {
  storage._reset();
  const fetchMock = createFetchMock({
    'freeGamesPromotions': {
      data: { Catalog: { searchStore: { elements: [
        {
          id: 'epic1', title: '免费游戏A', productSlug: 'game-a',
          promotions: { promotionalOffers: [{ promotionalOffers: [{ startDate: new Date(Date.now() - 86400e3).toISOString(), endDate: new Date(Date.now() + 86400e3).toISOString() }] }] },
          keyImages: [{ type: 'OfferImageWide', url: 'https://img.epic.com/a.jpg' }]
        }
      ] } } }
    },
    'ajax/filtered': { products: [{ title: '免费游戏B', url: '/game/b', image: 'https://img.gog.com/b.jpg' }] },
    'featuredcategories': { specials: { items: [{ id: 999, name: '免费游戏C', final_price: 0, large_capsule_image: 'https://cdn.steam.com/c.jpg' }] } },
    'api/giveaways': [
      { id: 1001, title: '免费游戏D', platforms: 'Epic Games', thumbnail: 'https://img.gp.com/d.jpg', instructions: '登录 Epic 领取', open_giveaway_url: 'https://www.gamerpower.com/click/1001' }
    ]
  });
  const restoreFetch = installFetchMock(fetchMock);
  try {
    const result = await mod.refreshFreeGames(true);
    const games = result.games;
    expect(games.length).toEqual(4);
    expect(games.some((g) => g.platform === 'epic' && g.name === '免费游戏A')).toEqual(true);
    expect(games.some((g) => g.platform === 'gog')).toEqual(true);
    expect(games.some((g) => g.platform === 'steam')).toEqual(true);
    expect(games.some((g) => g.name === '免费游戏D' && g.platform === 'epic')).toEqual(true); // gamerpower 数据源 → 内容平台 epic
    expect(!!result.lastUpdate).toEqual(true);
  } finally {
    restoreFetch();
  }
});

test('一天内缓存命中（不重新抓取）', async () => {
  storage._reset({
    freeGames: { lastUpdate: Date.now() - 3600e3, games: [{ id: 'epic-1', name: '旧数据', platform: 'epic' }] }
  });
  const fetchMock = createFetchMock({});
  const restoreFetch = installFetchMock(fetchMock);
  try {
    const result = await mod.refreshFreeGames(false);
    expect(result.games[0].name).toEqual('旧数据');
    expect(fetchMock._calls.length).toEqual(0); // 未触发任何抓取
  } finally {
    restoreFetch();
  }
});

test('force 强制刷新（突破一天缓存）', async () => {
  storage._reset({
    freeGames: { lastUpdate: Date.now() - 3600e3, games: [] }
  });
  const fetchMock = createFetchMock({ 'freeGamesPromotions': { data: { Catalog: { searchStore: { elements: [] } } } } });
  const restoreFetch = installFetchMock(fetchMock);
  try {
    const result = await mod.refreshFreeGames(true);
    expect(fetchMock._calls.length).toBeGreaterThan(0);
    expect(result.lastUpdate).toBeGreaterThanOrEqual(Date.now() - 5000);
  } finally {
    restoreFetch();
  }
});

test('claimFreeGame 标记领取并持久化', async () => {
  storage._reset({
    freeGames: { lastUpdate: 1, games: [{ id: 'epic-1', name: '免费游戏A', platform: 'epic', claimed: false }] }
  });
  const r = await mod.claimFreeGame('epic-1');
  expect(r.success).toEqual(true);
  const stored = storage._dump().freeGames;
  expect(stored.games[0].claimed).toEqual(true);
});

test('第三方 URL 协议白名单净化（恶意协议拒绝）', async () => {
  storage._reset();
  const fetchMock = createFetchMock({
    'api/giveaways': [
      { id: 2001, title: '恶意游戏', platforms: 'Epic Games', thumbnail: 'javascript:alert(1)', instructions: '登录领取', open_giveaway_url: 'javascript:alert(2)' }
    ]
  });
  const restoreFetch = installFetchMock(fetchMock);
  try {
    const result = await mod.refreshFreeGames(true);
    const g = result.games.find((x) => x.id === 'gp-2001') || result.games[0];
    expect(String(g.url).startsWith('javascript')).toEqual(false);
    expect(String(g.image).startsWith('javascript')).toEqual(false);
  } finally {
    restoreFetch();
  }
});
