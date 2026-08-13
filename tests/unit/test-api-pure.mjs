import { test, expect } from 'vitest';
/**
 * 游戏雷达 Game Radar - 测试：Steam API 纯函数 / Steam API Pure Functions
 *
 * v4.2.0：由原 test-cleanup 拆分（0~0.14 节）——coverImageFor /
 * nameMatchesSearch / baseAppIdFromDetails / isFailedRatingEntry /
 * api-monitor / needsRatingRefetch / isCompleteCacheData / TTL /
 * 模块化缓存（isModuleValid/getMergedData/setSteamCacheEntry 路由/migrateEntry）/
 * summarizeRecentReviews / calcLinkMatchScore / namesRelated。
 */
'use strict';


const apiMod = await import(new URL('../../background/steam/api.js', import.meta.url).href + '?t=' + Date.now());
console.log('0. 封面 URL 构造 coverImageFor');
test('已有 http 封面保留', () => { expect(apiMod.coverImageFor('111', 'https://xdgame.com/img/a.jpg')).toEqual('https://xdgame.com/img/a.jpg'); });
test('按 appId 构造 CDN header 图', () => { expect(apiMod.coverImageFor('111', null)).toEqual('https://cdn.akamai.steamstatic.com/steam/apps/111/header.jpg'); });
test('非 http 封面回退构造', () => { expect(apiMod.coverImageFor('111', 'data:image/png;base64,xx')).toEqual('https://cdn.akamai.steamstatic.com/steam/apps/111/header.jpg'); });
test('无 appId 返回空', () => { expect(apiMod.coverImageFor('', '')).toEqual(''); });

// ============ 0.5 名称相关性校验（v3.2.2）/ nameMatchesSearch ============
console.log('0.5 名称相关性校验 nameMatchesSearch');
const nm = apiMod.nameMatchesSearch;
test('正常中文匹配', () => { expect(nm('幻世录 重制版', '幻世录', '幻世录 重制版 抢先试玩')).toEqual(true); });
test('正常英文精确', () => { expect(nm('Kungfu Card', 'Kungfu Card', 'Kungfu Card')).toEqual(true); });
test('结果不含搜索词拒绝（装机模拟器2→1代）', () => { expect(nm('装机模拟器 (PC Building Simulator)', '装机模拟器2', '装机模拟器2')).toEqual(false); });
test('无关游戏拒绝（装机模拟器2→三国无双）', () => { expect(nm('真・三国无双８ 全季票版', '装机模拟器2', '装机模拟器2')).toEqual(false); });
test('续作防误匹配（删词变体精确等于前作名）', () => { expect(nm('PC Building Simulator', 'PC Building Simulator', '装机模拟器2 PC Building Simulator 2')).toEqual(false); });
test('完整名精确匹配含数字', () => { expect(nm('装机模拟器2', '装机模拟器2', '装机模拟器2')).toEqual(true); });
test('结果含搜索词且无数字差异', () => { expect(nm('装机模拟器 (PC Building Simulator)', '装机模拟器', '装机模拟器')).toEqual(true); });
test('空输入', () => { expect(nm('', 'x', 'x')).toEqual(false); });
test('短英文词需精确匹配（PC→Gunner HEAT PC!）', () => { expect(nm('Gunner, HEAT, PC!', 'PC', '[顶置]PC近期爆火游戏 汇总贴')).toEqual(false); });
test('短英文词精确匹配接受', () => { expect(nm('VR', 'VR', 'VR')).toEqual(true); });
test('跨语言信任（英文词命中官方中文名本体）', () => { expect(nm('角斗士公会经理', 'Gladiator Guild Manager', '角斗士公会经理/Gladiator Guild Manager')).toEqual(true); });
test('跨语言信任（星际采矿公司）', () => { expect(nm('星际采矿公司', 'Star Ores Inc', '星际采矿公司/Star Ores Inc')).toEqual(true); });
test('跨语言+数字差异仍拒绝（装机模拟器2→1代）', () => { expect(nm('装机模拟器 (PC Building Simulator)', '装机模拟器2', '装机模拟器2')).toEqual(false); });

// ============ 0.6 appId 本体解析（v3.2.6）/ baseAppIdFromDetails ============
console.log('0.6 appId 本体解析 baseAppIdFromDetails');
const bd = apiMod.baseAppIdFromDetails;
test('game 类型保留自身', () => { expect(bd({ type: 'game', appid: 2806120 })).toEqual('2806120'); });
test('demo 含 fullgame 解析本体（杀死影子 Demo→本体）', () => { expect(bd({ type: 'demo', appid: 2947640, fullgame: { appid: '2660230', name: '杀死影子' } })).toEqual('2660230'); });
test('独立 demo 无 fullgame 保留自身', () => { expect(bd({ type: 'demo', appid: 1332470 })).toEqual('1332470'); });
test('dlc 含 fullgame 解析本体', () => { expect(bd({ type: 'dlc', appid: 4818690, fullgame: { appid: '2389170', name: '华夏史诗：战国' } })).toEqual('2389170'); });
test('dlc 无 fullgame 无法解析', () => { expect(bd({ type: 'dlc', appid: 4145470 })).toEqual(null); });
test('bundle 无法解析', () => { expect(bd({ type: 'bundle', appid: 12345 })).toEqual(null); });
test('mod 无法解析', () => { expect(bd({ type: 'mod', appid: 12345 })).toEqual(null); });
test('music/soundtrack 无法解析', () => { expect(bd({ type: 'music', appid: 12345 })).toEqual(null); });
test('video 无法解析', () => { expect(bd({ type: 'video', appid: 12345 })).toEqual(null); });
test('software 无法解析', () => { expect(bd({ type: 'software', appid: 12345 })).toEqual(null); });
test('空输入', () => { expect(bd(null)).toEqual(null); });
// v3.3.4：真实 appdetails 响应的 ID 字段是 steam_appid（无 appid 字段），
// 此前 game/demo 类型因此解析为 null → 详情页完整拉取全部失败（"获取详情失败"）
test('真实结构 game+steam_appid 保留自身', () => { expect(bd({ type: 'game', steam_appid: 3117820 })).toEqual('3117820'); });
test('真实结构 demo+fullgame+steam_appid 解析本体', () => { expect(bd({ type: 'demo', steam_appid: 2947640, fullgame: { appid: 2660230 } })).toEqual('2660230'); });
test('真实结构独立 demo 保留自身', () => { expect(bd({ type: 'demo', steam_appid: 2947640 })).toEqual('2947640'); });
test('真实结构 dlc+fullgame 解析本体', () => { expect(bd({ type: 'dlc', steam_appid: 4145470, fullgame: { appid: 3613270 } })).toEqual('3613270'); });
test('真实结构 bundle 无法解析', () => { expect(bd({ type: 'bundle', steam_appid: 888 })).toEqual(null); });

// ============ 0.7 失败固化检测（v3.2.9）/ isFailedRatingEntry ============
console.log('0.7 失败固化检测 isFailedRatingEntry');
const fe = apiMod.isFailedRatingEntry;
test('正常好评率条目有效', () => { expect(fe({ positiveRate: 90, ratingDesc: '特别好评' })).toEqual(false); });
test('0 评测条目有效（有描述）', () => { expect(fe({ positiveRate: null, ratingDesc: '无用户评测' })).toEqual(false); });
test('失败固化（双空）判定', () => { expect(fe({ positiveRate: null, ratingDesc: null })).toEqual(true); });
test('null 输入', () => { expect(fe(null)).toEqual(false); });

// ============ 0.8 Steam API 状态监测（v3.3.0）/ api-monitor ============
console.log('0.8 Steam API 状态监测');
const monitor = await import(
  new URL('../../background/core/api-monitor.js', import.meta.url).href + '?t=' + Date.now()
);
test('空窗口状态', () => {
  monitor.resetApiMonitor();
  const st = monitor.getSteamApiStatus();
  expect(st.total === 0 && st.anomaly === false && st.failRate === 0).toEqual(true);
});
test('10 次成功：失败率 0、非异常', () => {
  monitor.resetApiMonitor();
  for (let i = 0; i < 10; i++) monitor.recordSteamCall(true);
  const st = monitor.getSteamApiStatus();
  expect(st.failRate === 0 && st.anomaly === false && st.total === 10).toEqual(true);
});
test('失败率 60% 判定异常', () => {
  monitor.resetApiMonitor();
  for (let i = 0; i < 6; i++) monitor.recordSteamCall(false);
  for (let i = 0; i < 4; i++) monitor.recordSteamCall(true);
  const st = monitor.getSteamApiStatus();
  expect(st.anomaly === true && st.failRate === 60).toEqual(true);
});
test('样本不足（1 次失败）不判定异常', () => {
  monitor.resetApiMonitor();
  monitor.recordSteamCall(false);
  const st = monitor.getSteamApiStatus();
  expect(st.anomaly === false).toEqual(true);
});
test('限流状态码统计（429/503）', () => {
  monitor.resetApiMonitor();
  monitor.recordSteamCall(false, 429);
  monitor.recordSteamCall(true);
  monitor.recordSteamCall(false, 503);
  const st = monitor.getSteamApiStatus();
  expect(st.limited).toEqual(2);
});

// ============ 0.9 无好评率缓存重新获取（v3.3.1）/ needsRatingRefetch ============
console.log('0.9 无好评率缓存重新获取 needsRatingRefetch');
const nr = apiMod.needsRatingRefetch;
const refetchNow = Date.now();
test('有好评率不重取', () => { expect(nr({ data: { positiveRate: 90, ratingDesc: '特别好评' } })).toEqual(false); });
test('失败固化立即重取', () => { expect(nr({ data: { positiveRate: null, ratingDesc: null } })).toEqual(true); });
test('0 评测冷却期内不重取', () => { expect(nr({ data: { positiveRate: null, ratingDesc: '无用户评测', ratingRetriedAt: refetchNow - 60 * 1000 } })).toEqual(false); });
test('0 评测冷却期外重取', () => { expect(nr({ data: { positiveRate: null, ratingDesc: '无用户评测', ratingRetriedAt: refetchNow - 11 * 60 * 1000 } })).toEqual(true); });
test('无缓存条目重取', () => { expect(nr(null)).toEqual(true); });
test('无重试记录立即重取', () => { expect(nr({ data: { positiveRate: null, ratingDesc: '无用户评测' } })).toEqual(true); });

// ============ 0.10 详情页缓存完整性（v3.3.3）/ isCompleteCacheData ============
console.log('0.10 详情页缓存完整性 isCompleteCacheData');
const icd = apiMod.isCompleteCacheData;
const fullData = {
  url: 'https://store.steampowered.com/app/1/',
  name: 'Game',
  genres: ['RPG'],
  userTags: ['RPG'],
  developers: ['Dev'],
  chineseSupported: true,
  releaseDate: '2024-01-01',
  description: 'desc',
  headerImage: 'https://cdn/h.jpg'
};
test('完整数据判定通过', () => { expect(icd(fullData)).toEqual(true); });
test('轻量缓存（列表页写入）判定失败', () => { expect(icd({ appId: '1', name: 'Game', positiveRate: 90, ratingDesc: 'x', headerImage: 'h' })).toEqual(false); });
test('缺 userTags 判定失败', () => { expect(icd({ ...fullData, userTags: undefined })).toEqual(false); });
test('缺 genres 判定失败', () => { expect(icd({ ...fullData, genres: null })).toEqual(false); });
test('缺 url 判定失败', () => { expect(icd({ ...fullData, url: '' })).toEqual(false); });
test('null 输入判定失败', () => { expect(icd(null)).toEqual(false); });

// ============ 0.11 详情页独立 TTL（v3.3.3）/ detailSteamCacheTtlMs ============
console.log('0.11 详情页独立 TTL detailSteamCacheTtlMs');
const constMod = await import(new URL('../../background/core/constants.js', import.meta.url).href + '?t=' + Date.now());
test('默认 72 小时', () => { expect(constMod.detailSteamCacheTtlMs()).toEqual(72 * 3600e3); });
test('detailSteam 0 = 长期', () => { expect((() => {
    constMod.setTtlConfig({ detailSteam: { value: 0, unit: 'hours' } });
    return constMod.detailSteamCacheTtlMs();
  })() === Infinity).toEqual(true); });
test('detailSteam 3 天', () => { expect((() => {
    constMod.setTtlConfig({ detailSteam: { value: 3, unit: 'days' } });
    return constMod.detailSteamCacheTtlMs();
  })()).toEqual(3 * 86400e3); });
// 恢复默认，避免污染后续测试（模块化后 TTL 为模块级全局配置）
constMod.setTtlConfig({
  steamDynamic: { value: 24, unit: 'hours' },
  detailSteam: { value: 72, unit: 'hours' },
  spySteam: { value: 7, unit: 'days' },
  metaSteam: { value: 30, unit: 'days' },
  registryConfirm: { value: 30, unit: 'days' },
  downloadUrls: { value: 30, unit: 'days' },
  negativeCache: { value: 2, unit: 'hours' }
});

// ============ 0.12 模块化缓存（v3.3.7）/ isModuleValid / getMergedData ============
console.log('0.12 模块化缓存 isModuleValid / getMergedData');
const cacheMod = await import(
  new URL('../../background/storage/steam-cache.js', import.meta.url).href + '?t=' + Date.now()
);
const modNow = Date.now();
const modEntry = {
  modules: {
    meta: { data: { appId: '3117820', name: '苏丹的游戏' }, ts: modNow },
    rating: { data: { positiveRate: 90 }, ts: modNow - 25 * 3600e3 }, // 25h 前（rating 24h 过期）
    detail: { data: { url: 'https://store.steampowered.com/app/1/' }, ts: modNow - 25 * 3600e3 } // 25h 前（detail 72h 有效）
  }
};
test('rating 模块 25h 前写入已过期（24h TTL）', () => { expect(cacheMod.isModuleValid(modEntry, 'rating')).toEqual(false); });
test('detail 模块 25h 前写入仍有效（72h TTL）', () => { expect(cacheMod.isModuleValid(modEntry, 'detail')).toEqual(true); });
test('meta 模块 30 天 TTL 有效', () => { expect(cacheMod.isModuleValid(modEntry, 'meta')).toEqual(true); });
test('条目整体有效（任一模块未过期）', () => { expect(cacheMod.isSteamCacheValid(modEntry)).toEqual(true); });
test('合并视图含各模块字段', () => { expect((() => {
    const m = cacheMod.getMergedData(modEntry);
    return m.appId === '3117820' && m.positiveRate === 90 && !!m.url;
  })()).toEqual(true); });
test('全部过期条目整体无效', () => { expect(cacheMod.isSteamCacheValid({ modules: { rating: { data: { positiveRate: 1 }, ts: modNow - 25 * 3600e3 } } })).toEqual(false); });

// 0.12b 字段归属路由（setSteamCacheEntry 自动拆分）
// v6.1.1：每 test 自包含准备——getSteamCacheEntry 返回内存对象引用，顶层
// 准备 + 延迟断言会读到后续部分更新后的值（check 线性脚本时序语义丢失）
console.log('0.12b 字段归属路由 setSteamCacheEntry');
globalThis.chrome = {
  storage: { local: { get: async () => ({}), set: async () => {} } }
};
test('meta 模块路由（appId）', async () => {
  await cacheMod.resetSteamCache();
  await cacheMod.setSteamCacheEntry('test-1', { appId: '1', positiveRate: 95, genres: ['RPG'], steamspy: { ccu: 100 } });
  const e = await cacheMod.getSteamCacheEntry('test-1');
  expect(!!e.modules.meta && e.modules.meta.data.appId === '1').toEqual(true);
});
test('rating 模块路由（positiveRate）', async () => {
  await cacheMod.resetSteamCache();
  await cacheMod.setSteamCacheEntry('test-1', { appId: '1', positiveRate: 95, genres: ['RPG'], steamspy: { ccu: 100 } });
  const e = await cacheMod.getSteamCacheEntry('test-1');
  expect(!!e.modules.rating && e.modules.rating.data.positiveRate === 95).toEqual(true);
});
test('detail 模块路由（genres）', async () => {
  await cacheMod.resetSteamCache();
  await cacheMod.setSteamCacheEntry('test-1', { appId: '1', positiveRate: 95, genres: ['RPG'], steamspy: { ccu: 100 } });
  const e = await cacheMod.getSteamCacheEntry('test-1');
  expect(!!e.modules.detail && e.modules.detail.data.genres[0] === 'RPG').toEqual(true);
});
test('spy 模块路由（steamspy）', async () => {
  await cacheMod.resetSteamCache();
  await cacheMod.setSteamCacheEntry('test-1', { appId: '1', positiveRate: 95, genres: ['RPG'], steamspy: { ccu: 100 } });
  const e = await cacheMod.getSteamCacheEntry('test-1');
  expect(!!e.modules.spy && e.modules.spy.data.steamspy.ccu === 100).toEqual(true);
});
test('部分更新保留其他模块', async () => {
  await cacheMod.resetSteamCache();
  await cacheMod.setSteamCacheEntry('test-1', { appId: '1', positiveRate: 95, genres: ['RPG'], steamspy: { ccu: 100 } });
  // 部分更新：只写 rating → 其他模块保留
  await cacheMod.setSteamCacheEntry('test-1', { positiveRate: 96 });
  const e2 = await cacheMod.getSteamCacheEntry('test-1');
  expect(!!e2.modules.meta && !!e2.modules.detail && !!e2.modules.spy).toEqual(true);
});
test('部分更新覆盖同模块字段', async () => {
  await cacheMod.resetSteamCache();
  await cacheMod.setSteamCacheEntry('test-1', { appId: '1', positiveRate: 95, genres: ['RPG'], steamspy: { ccu: 100 } });
  await cacheMod.setSteamCacheEntry('test-1', { positiveRate: 96 });
  const e2 = await cacheMod.getSteamCacheEntry('test-1');
  expect(e2.modules.rating.data.positiveRate === 96 && e2.modules.rating.data.ratingDesc === undefined).toEqual(true);
});

// 0.12c 旧平铺结构迁移（load 时自动迁移，旧缓存不立即失效）
console.log('0.12c 旧平铺结构迁移 migrateEntry');
const legacy = {
  data: { appId: '100', positiveRate: 88, genres: ['RPG'] },
  timestamp: modNow - 10 * 3600e3,
  version: 5
};
const migrated = cacheMod.migrateEntry(legacy);
test('迁移为模块结构', () => { expect(!!migrated.modules).toEqual(true); });
test('迁移字段归属正确', () => { expect(migrated.modules.meta.data.appId === '100' &&
    migrated.modules.rating.data.positiveRate === 88 &&
    migrated.modules.detail.data.genres[0] === 'RPG').toEqual(true); });
test('迁移保留原时间戳', () => { expect(migrated.modules.rating.ts === modNow - 10 * 3600e3).toEqual(true); });
test('模块结构条目迁移不变', () => { expect(cacheMod.migrateEntry(modEntry) === modEntry).toEqual(true); });

// ============ 0.13 近30天评测统计（v3.3.6）/ summarizeRecentReviews ============
console.log('0.13 近30天评测统计 summarizeRecentReviews');
const srr = apiMod.summarizeRecentReviews;
const winSec = apiMod.RECENT_REVIEW_WINDOW_SEC;
const nowSec = Math.floor(Date.now() / 1000);
test('30天窗口内统计（2/3 好评 → 67%）', () => { expect(srr(
    [
      { timestamp_created: nowSec - 86400, voted_up: true },
      { timestamp_created: nowSec - 2 * 86400, voted_up: false },
      { timestamp_created: nowSec - 10 * 86400, voted_up: true }
    ],
    nowSec - winSec
  )).toEqual({ total: 3, positive: 2, rate: 67 }); });
test('窗口外评测不计入（返回 null 率）', () => { expect(srr([{ timestamp_created: nowSec - 40 * 86400, voted_up: true }], nowSec - winSec)).toEqual({ total: 0, positive: 0, rate: null }); });
test('空数组', () => { expect(srr([], nowSec - winSec)).toEqual({ total: 0, positive: 0, rate: null }); });
test('无 timestamp 条目忽略', () => { expect(srr([{ voted_up: true }, { timestamp_created: nowSec - 86400, voted_up: true }], nowSec - winSec)).toEqual({ total: 1, positive: 1, rate: 100 }); });
test('100 条全近期统计（截断窗口近似）', () => { expect(srr(
    Array.from({ length: 100 }, (_, i) => ({ timestamp_created: nowSec - i * 3600, voted_up: i % 2 === 0 })),
    nowSec - winSec
  )).toEqual({ total: 100, positive: 50, rate: 50 }); });
test('null 输入', () => { expect(srr(null, nowSec - winSec)).toEqual({ total: 0, positive: 0, rate: null }); });

// ============ 0.14 检索匹配修复（v3.3.10）/ calcLinkMatchScore + namesRelated ============
console.log('0.14 检索匹配修复 calcLinkMatchScore + namesRelated');
const searchMod = await import(new URL('../../background/sites/search.js', import.meta.url).href + '?t=' + Date.now());
// 数字保护：二代搜索词 vs 一代页面 → 0 分（"spiritofthenorth2" 不再匹配 "spiritofthenorth"）
test('二代词 vs 一代页（数字保护 → 0 分）', () => { expect(searchMod.calcLinkMatchScore('北方之魂增强版/Spirit of the North- Switch520.com', 'Spirit of the North 2')).toEqual(0); });
test('一代词 vs 一代页（正常命中）', () => { expect(searchMod.calcLinkMatchScore('北方之魂增强版/Spirit of the North- Switch520.com', 'Spirit of the North') >= 60).toEqual(true); });
test('正常英文命中', () => { expect(searchMod.calcLinkMatchScore('风启之旅/Windrose/支持网络联机', 'Windrose') >= 80).toEqual(true); });
test('无关游戏拒绝', () => { expect(searchMod.calcLinkMatchScore('轮回之兽|豪华中文', 'Spirit of the North 2')).toEqual(0); });
// namesRelated：缓存命中名称校验（防名称索引粘性）
const nr2 = apiMod.namesRelated;
test('粘性条目拒绝（16598标题 vs 轮回之兽）', () => { expect(nr2('北方之魂增强版/Spirit of the North- Switch520.com', '轮回之兽')).toEqual(false); });
test('一代标题 vs 一代缓存名', () => { expect(nr2('北方之魂增强版/Spirit of the North- Switch520.com', 'Spirit of the North')).toEqual(true); });
test('正常下载站标题 vs 缓存名', () => { expect(nr2('泰坦之旅2|v0.7.0.136009|官方中文|Titan Quest II', 'Titan Quest II')).toEqual(true); });
test('纯英文标题 vs 纯中文缓存名（跨语言信任）', () => { expect(nr2('Gladiator Guild Manager', '角斗士公会经理')).toEqual(true); });
test('纯中文标题 vs 纯英文缓存名（跨语言信任）', () => { expect(nr2('角斗士公会经理', 'Gladiator Guild Manager')).toEqual(true); });
test('无关中文标题拒绝', () => { expect(nr2('奉魔', '轮回之兽')).toEqual(false); });
test('空输入', () => { expect(nr2('', '')).toEqual(false); });

// ============ 1. 适配规则校验 / Adapter-rule validation ============

console.log('8. 版本后缀补搜 findVersionVariant（mock Steam）');
const realFetch = globalThis.fetch;
// mock：appdetails 返回英文名（Legacy 后缀）；storesearch 返回增强版条目
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/api/appdetails')) {
    return { ok: true, json: async () => ({ 271590: { success: true, data: { name: 'Grand Theft Auto V Legacy' } } }) };
  }
  if (u.includes('/api/storesearch')) {
    return {
      ok: true,
      json: async () => ({ items: [{ id: 3240220, name: 'Grand Theft Auto V 增强版', type: 'app' }] })
    };
  }
  return { ok: false };
};
try {
  const v = await apiMod.findVersionVariant(271590, '侠盗猎车手V 增强版|中字-国语|V1.0.1158.13');
  test('封面旧版+增强版标题 → 命中新版 3240220', () => { expect(v ? String(v.appId) : 'null').toEqual('3240220'); });
  test('无版本后缀标题 → 不触发', async () => { expect(await apiMod.findVersionVariant(271590, '侠盗猎车手V')).toEqual(null); });
  test('标题为空 → 不触发', async () => { expect(await apiMod.findVersionVariant(271590, '')).toEqual(null); });
} finally {
  globalThis.fetch = realFetch;
}


// ============ 0.15 解析健壮性（v6.3.0 C 收尾）/ Parser robustness ============
console.log('0.15 解析健壮性（异常输入不抛错 + 官方字段降级）');
const detailsMod = await import(new URL('../../background/steam/api-details.js', import.meta.url).href + '?t=1');
test('supported_languages 非字符串（异常响应）不抛错', () => {
  const r = detailsMod.parseChineseLanguageSupport('', { supported_languages: { schinese: { full_audio: true } } });
  expect(typeof r.chineseSupported).toEqual('boolean');
  expect(r.chineseSupported).toEqual(false);
});
test('空 storeHtml + 无 supported_languages → 默认不支持', () => {
  const r = detailsMod.parseChineseLanguageSupport('', {});
  expect(r.chineseSupported).toEqual(false);
  expect(r.simplifiedChinese).toEqual(false);
});
test('supported_languages 字符串含简体中文 → 识别', () => {
  const r = detailsMod.parseChineseLanguageSupport('', { supported_languages: '<strong>简体中文</strong><br>界面' });
  expect(r.chineseSupported).toEqual(true);
  expect(r.simplifiedChinese).toEqual(true);
});
test('storeHtml 为空 → userTags 走 categories 兜底（官方字段）', () => {
  const gameData = { categories: [{ description: '单人' }, { description: 'RPG' }] };
  const tags = detailsMod.parseUserTags('', gameData);
  expect(tags.includes('单人') && tags.includes('RPG')).toEqual(true);
});
test('storeHtml 异常标签 → 过滤非法标签且不抛错', () => {
  const gameData = { categories: [] };
  const tags = detailsMod.parseUserTags('<a class="app_tag">RPG</a><a class="app_tag">&nbsp;</a>', gameData);
  expect(tags.includes('RPG')).toEqual(true);
  expect(tags.every((t) => t.length >= 1 && t.length <= 30)).toEqual(true);
});

// ============ 0.16 好评率重试机制（v6.4.10：刷新重试上限 3 次） ============
console.log('0.16 好评率重试机制（失败固化上限 3 次）');
test('失败固化 count 0 → 需重取（首次刷新）', () => {
  const d = { positiveRate: null, ratingDesc: null };
  expect(apiMod.needsRatingRefetch({ data: d })).toEqual(true);
});
test('失败固化 count 2 → 仍重取（第 3 次刷新）', () => {
  const d = { positiveRate: null, ratingDesc: null, ratingFailCount: 2 };
  expect(apiMod.needsRatingRefetch({ data: d })).toEqual(true);
});
test('失败固化 count 3 → 停止重试（上限）', () => {
  const d = { positiveRate: null, ratingDesc: null, ratingFailCount: 3 };
  expect(apiMod.needsRatingRefetch({ data: d })).toEqual(false);
});
test('失败固化冷却期内不重取（防同次刷新连打）', () => {
  const d = { positiveRate: null, ratingDesc: null, ratingRetriedAt: Date.now() - 1000 };
  expect(apiMod.needsRatingRefetch({ data: d })).toEqual(false);
});
