import { test, expect } from 'vitest';
/**
 * 游戏雷达 Game Radar - 测试：限免平台分类 / Free-Games Classification Tests
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

// ============ 3. 限免推送通知（v6.3.2 C2） ============
console.log('3. 新限免推送通知（chrome.notifications）');
test('新限免触发推送通知（聚合一条）', async () => {
  storage._reset({
    freeGames: { lastUpdate: Date.now() - 86400e3 * 2, games: [{ id: 'epic-old', name: '旧游戏', platform: 'epic' }] }
  });
  const notified = [];
  globalThis.chrome.notifications = { create: (id, opts) => notified.push({ id, opts }) };
  const fetchMock = createFetchMock({
    'freeGamesPromotions': {
      data: { Catalog: { searchStore: { elements: [
        {
          id: 'new1', title: '新限免A', productSlug: 'new-a',
          promotions: { promotionalOffers: [{ promotionalOffers: [{ startDate: new Date(Date.now() - 3600e3).toISOString(), endDate: new Date(Date.now() + 86400e3).toISOString() }] }] },
          keyImages: [{ type: 'OfferImageWide', url: 'https://img.epic.com/new-a.jpg' }]
        }
      ] } } }
    }
  });
  const restoreFetch = installFetchMock(fetchMock);
  try {
    await mod.refreshFreeGames(true);
    expect(notified.length).toEqual(1);
    expect(notified[0].id).toEqual('gr-free-games');
    expect(notified[0].opts.title).toContain('新增 1 款');
    expect(notified[0].opts.message).toContain('新限免A');
  } finally {
    restoreFetch();
    delete globalThis.chrome.notifications;
  }
});
test('无新游戏不触发通知', async () => {
  storage._reset({
    freeGames: { lastUpdate: Date.now() - 86400e3 * 2, games: [{ id: 'epic-old', name: '旧游戏', platform: 'epic' }] }
  });
  const notified = [];
  globalThis.chrome.notifications = { create: (id, opts) => notified.push({ id, opts }) };
  const fetchMock = createFetchMock({
    'freeGamesPromotions': { data: { Catalog: { searchStore: { elements: [] } } } }
  });
  const restoreFetch = installFetchMock(fetchMock);
  try {
    await mod.refreshFreeGames(true);
    expect(notified.length).toEqual(0);
  } finally {
    restoreFetch();
    delete globalThis.chrome.notifications;
  }
});

// ============ 4. 限免类型区分（v6.3.3） ============
console.log('4. 三类区分 classifyFreeType（limited/weekend/f2p/key）');
test('标题含 Free Weekend → weekend', () => {
  expect(mod.classifyFreeType({ title: 'Cyberpunk 2077 Free Weekend', instructions: '' }, true)).toEqual('weekend');
});
test('无结束时间 + F2P 特征 → f2p', () => {
  expect(mod.classifyFreeType({ title: 'Warframe', description: 'Free to Play 游戏', instructions: '' }, false)).toEqual('f2p');
});
test('有限时 + 无特征 → limited', () => {
  expect(mod.classifyFreeType({ title: '古墓丽影', instructions: '登录领取' }, true)).toEqual('limited');
});
test('key 活动（instructions 含 redeem key）→ key', () => {
  expect(mod.classifyFreeType({ title: '某游戏', instructions: 'Redeem your key on Steam' }, true)).toEqual('key');
});
test('GamerPower 源：key 活动被过滤（不收录）', async () => {
  storage._reset();
  const fetchMock = createFetchMock({
    'api/giveaways': [
      { id: 3001, title: '垃圾 Key 活动', platforms: 'Steam', thumbnail: 'https://x.jpg', instructions: 'Get your key at Fanatical', end_date: '2026-09-01' },
      { id: 3002, title: '正当限免', platforms: 'Steam', thumbnail: 'https://x.jpg', instructions: '登录 Steam 领取', end_date: '2026-09-01' }
    ]
  });
  const restoreFetch = installFetchMock(fetchMock);
  try {
    const result = await mod.refreshFreeGames(true);
    const names = result.games.map((g) => g.name);
    expect(names.includes('垃圾 Key 活动')).toEqual(false);
    expect(names.includes('正当限免')).toEqual(true);
    const good = result.games.find((g) => g.name === '正当限免');
    expect(good.freeType).toEqual('limited');
  } finally {
    restoreFetch();
  }
});
test('通知仅限时领取（weekend/f2p 不推送）', async () => {
  storage._reset({ freeGames: { lastUpdate: Date.now() - 86400e3 * 2, games: [] } });
  const notified = [];
  globalThis.chrome.notifications = { create: (id, opts) => notified.push({ id, opts }) };
  const fetchMock = createFetchMock({
    'freeGamesPromotions': { data: { Catalog: { searchStore: { elements: [
      { id: 'w1', title: '周末游戏', productSlug: 'w', promotions: { promotionalOffers: [{ promotionalOffers: [{ startDate: new Date(Date.now() - 3600e3).toISOString(), endDate: new Date(Date.now() + 86400e3).toISOString() }] }] }, keyImages: [] }
    ] } } } },
    'ajax/filtered': { products: [] },
    'featuredcategories': { specials: { items: [] } },
    'api/giveaways': [
      { id: 4001, title: '真限免', platforms: 'Steam', thumbnail: 'https://x.jpg', instructions: '登录领取', end_date: '2026-09-01' }
    ]
  });
  const restoreFetch = installFetchMock(fetchMock);
  try {
    // 预置 weekend/f2p 游戏（旧数据），新抓取只有 limited → 通知仅限时
    await mod.refreshFreeGames(true);
    // 通知只应包含 limited 游戏（本场景 GamerPower 真限免）
    const titles = notified.map((n) => n.opts.title).join('');
    expect(notified.length).toEqual(1);
    expect(titles).toContain('新增');
  } finally {
    restoreFetch();
    delete globalThis.chrome.notifications;
  }
});

// ============ 5. Steam 官方判定（v6.4.2：喜加一 vs 免费周末 vs F2P） ============
console.log('5. determineSteamFreeType（Steam 官方接口判定）');
test('is_free=true → f2p（永久免费）', async () => {
  const fetchMock = createFetchMock({
    '/api/appdetails': { '999': { success: true, data: { is_free: true } } }
  });
  const restoreFetch = installFetchMock(fetchMock);
  try {
    expect(await mod.determineSteamFreeType('999')).toEqual('f2p');
  } finally { restoreFetch(); }
});
test('原价>0 现价 0 + 商店页 Add to Cart → limited（喜加一入库）', async () => {
  const fetchMock = createFetchMock({
    '/api/appdetails': { '1245620': { success: true, data: { is_free: false, price_overview: { initial: 29800, final: 0, discount_percent: 100 } } } },
    '/app/1245620/': '<html><body><div class="btn_addtocart">Add to Cart</div></body></html>'
  });
  const restoreFetch = installFetchMock(fetchMock);
  try {
    expect(await mod.determineSteamFreeType('1245620')).toEqual('limited');
  } finally { restoreFetch(); }
});
test('原价>0 现价 0 + 商店页 Play Now → weekend（免费周末）', async () => {
  const fetchMock = createFetchMock({
    '/api/appdetails': { '730': { success: true, data: { is_free: false, price_overview: { initial: 5800, final: 0, discount_percent: 100 } } } },
    '/app/730/': '<html><body><div class="playbtn">Play Now 立即游玩</div></body></html>'
  });
  const restoreFetch = installFetchMock(fetchMock);
  try {
    expect(await mod.determineSteamFreeType('730')).toEqual('weekend');
  } finally { restoreFetch(); }
});
test('现价 0 无原价 → weekend（Play Now 模式保守处理）', async () => {
  const fetchMock = createFetchMock({
    '/api/appdetails': { '123': { success: true, data: { is_free: false, price_overview: { initial: 0, final: 0 } } } }
  });
  const restoreFetch = installFetchMock(fetchMock);
  try {
    expect(await mod.determineSteamFreeType('123')).toEqual('weekend');
  } finally { restoreFetch(); }
});
test('当前非免费 → null（数据过期）', async () => {
  const fetchMock = createFetchMock({
    '/api/appdetails': { '456': { success: true, data: { is_free: false, price_overview: { initial: 5800, final: 5800 } } } }
  });
  const restoreFetch = installFetchMock(fetchMock);
  try {
    expect(await mod.determineSteamFreeType('456')).toEqual(null);
  } finally { restoreFetch(); }
});
test('通知：Steam 官方判定 weekend 的候选不推送', async () => {
  storage._reset({ freeGames: { lastUpdate: Date.now() - 86400e3 * 2, games: [] } });
  const notified = [];
  globalThis.chrome.notifications = { create: (id, opts) => notified.push({ id, opts }) };
  const fetchMock = createFetchMock({
    'freeGamesPromotions': { data: { Catalog: { searchStore: { elements: [] } } } },
    'ajax/filtered': { products: [] },
    'featuredcategories': { specials: { items: [] } },
    'api/giveaways': [
      // 周末活动：标题无特征词（靠官方判定拦截）
      { id: 5001, title: '神秘周末游戏', platforms: 'Steam', thumbnail: 'https://x.jpg', instructions: '登录 Steam 领取', end_date: '2026-09-01', open_giveaway_url: 'https://store.steampowered.com/app/730/' },
      // 真喜加一：官方判定 limited
      { id: 5002, title: '真喜加一', platforms: 'Steam', thumbnail: 'https://x.jpg', instructions: '登录 Steam 领取', end_date: '2026-09-01', open_giveaway_url: 'https://store.steampowered.com/app/1245620/' }
    ],
    '/api/appdetails': {
      '730': { success: true, data: { is_free: false, price_overview: { initial: 5800, final: 0, discount_percent: 100 } } },
      '1245620': { success: true, data: { is_free: false, price_overview: { initial: 29800, final: 0, discount_percent: 100 } } }
    },
    '/app/730/': '<html><body><div class="playbtn">Play Now 立即游玩</div></body></html>',
    '/app/1245620/': '<html><body><div class="btn_addtocart">Add to Cart</div></body></html>'
  });
  const restoreFetch = installFetchMock(fetchMock);
  try {
    const result = await mod.refreshFreeGames(true);
    // 两个候选都进列表（展示），但通知只发喜加一
    expect(notified.length).toEqual(1);
    expect(notified[0].opts.message).toContain('真喜加一');
    expect(notified[0].opts.message).not.toContain('神秘周末游戏');
  } finally {
    restoreFetch();
    delete globalThis.chrome.notifications;
  }
});
