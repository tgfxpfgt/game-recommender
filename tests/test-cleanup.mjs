/**
 * Game Recommender - 测试：规则校验与缓存清理 / Rule Validation & Cache Cleanup
 *
 * v3.0.0：validateAdapterRules（结构/类型白名单/函数拒绝/规模上限）与
 * 三类过期缓存清理纯函数（Steam 动态/名称负缓存/下载站网址）。
 * validateAdapterRules and the three expired-cache cleanup helpers.
 */
'use strict';

const ROOT = 'F:/data/browser extension/game-recommender';
let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name, '→ 实际:', JSON.stringify(actual), '期望:', JSON.stringify(expected)); }
}

// 加载真实模块（带查询串绕缓存）
const rulesMod = await import('file:///F:/data/browser%20extension/game-recommender/background/core/rules.js?t=' + Date.now());
const cleanupMod = await import('file:///F:/data/browser%20extension/game-recommender/background/storage/cleanup.js?t=' + Date.now());
const apiMod = await import('file:///F:/data/browser%20extension/game-recommender/background/steam/api.js?t=' + Date.now());

// ============ 0. 封面 URL 构造（v3.1.0）/ coverImageFor ============
console.log('0. 封面 URL 构造 coverImageFor');
check('已有 http 封面保留', apiMod.coverImageFor('111', 'https://xdgame.com/img/a.jpg'), 'https://xdgame.com/img/a.jpg');
check('按 appId 构造 CDN header 图', apiMod.coverImageFor('111', null), 'https://cdn.akamai.steamstatic.com/steam/apps/111/header.jpg');
check('非 http 封面回退构造', apiMod.coverImageFor('111', 'data:image/png;base64,xx'), 'https://cdn.akamai.steamstatic.com/steam/apps/111/header.jpg');
check('无 appId 返回空', apiMod.coverImageFor('', ''), '');

// ============ 0.5 名称相关性校验（v3.2.2）/ nameMatchesSearch ============
console.log('0.5 名称相关性校验 nameMatchesSearch');
const nm = apiMod.nameMatchesSearch;
check('正常中文匹配', nm('幻世录 重制版', '幻世录', '幻世录 重制版 抢先试玩'), true);
check('正常英文精确', nm('Kungfu Card', 'Kungfu Card', 'Kungfu Card'), true);
check('结果不含搜索词拒绝（装机模拟器2→1代）', nm('装机模拟器 (PC Building Simulator)', '装机模拟器2', '装机模拟器2'), false);
check('无关游戏拒绝（装机模拟器2→三国无双）', nm('真・三国无双８ 全季票版', '装机模拟器2', '装机模拟器2'), false);
check('续作防误匹配（删词变体精确等于前作名）', nm('PC Building Simulator', 'PC Building Simulator', '装机模拟器2 PC Building Simulator 2'), false);
check('完整名精确匹配含数字', nm('装机模拟器2', '装机模拟器2', '装机模拟器2'), true);
check('结果含搜索词且无数字差异', nm('装机模拟器 (PC Building Simulator)', '装机模拟器', '装机模拟器'), true);
check('空输入', nm('', 'x', 'x'), false);
check('短英文词需精确匹配（PC→Gunner HEAT PC!）', nm('Gunner, HEAT, PC!', 'PC', '[顶置]PC近期爆火游戏 汇总贴'), false);
check('短英文词精确匹配接受', nm('VR', 'VR', 'VR'), true);
check('跨语言信任（英文词命中官方中文名本体）', nm('角斗士公会经理', 'Gladiator Guild Manager', '角斗士公会经理/Gladiator Guild Manager'), true);
check('跨语言信任（星际采矿公司）', nm('星际采矿公司', 'Star Ores Inc', '星际采矿公司/Star Ores Inc'), true);
check('跨语言+数字差异仍拒绝（装机模拟器2→1代）', nm('装机模拟器 (PC Building Simulator)', '装机模拟器2', '装机模拟器2'), false);

// ============ 0.6 appId 本体解析（v3.2.6）/ baseAppIdFromDetails ============
console.log('0.6 appId 本体解析 baseAppIdFromDetails');
const bd = apiMod.baseAppIdFromDetails;
check('game 类型保留自身', bd({ type: 'game', appid: 2806120 }), '2806120');
check('demo 含 fullgame 解析本体（杀死影子 Demo→本体）', bd({ type: 'demo', appid: 2947640, fullgame: { appid: '2660230', name: '杀死影子' } }), '2660230');
check('独立 demo 无 fullgame 保留自身', bd({ type: 'demo', appid: 1332470 }), '1332470');
check('dlc 含 fullgame 解析本体', bd({ type: 'dlc', appid: 4818690, fullgame: { appid: '2389170', name: '华夏史诗：战国' } }), '2389170');
check('dlc 无 fullgame 无法解析', bd({ type: 'dlc', appid: 4145470 }), null);
check('bundle 无法解析', bd({ type: 'bundle', appid: 12345 }), null);
check('mod 无法解析', bd({ type: 'mod', appid: 12345 }), null);
check('music/soundtrack 无法解析', bd({ type: 'music', appid: 12345 }), null);
check('video 无法解析', bd({ type: 'video', appid: 12345 }), null);
check('software 无法解析', bd({ type: 'software', appid: 12345 }), null);
check('空输入', bd(null), null);
// v3.3.4：真实 appdetails 响应的 ID 字段是 steam_appid（无 appid 字段），
// 此前 game/demo 类型因此解析为 null → 详情页完整拉取全部失败（"获取详情失败"）
check('真实结构 game+steam_appid 保留自身', bd({ type: 'game', steam_appid: 3117820 }), '3117820');
check('真实结构 demo+fullgame+steam_appid 解析本体', bd({ type: 'demo', steam_appid: 2947640, fullgame: { appid: 2660230 } }), '2660230');
check('真实结构独立 demo 保留自身', bd({ type: 'demo', steam_appid: 2947640 }), '2947640');
check('真实结构 dlc+fullgame 解析本体', bd({ type: 'dlc', steam_appid: 4145470, fullgame: { appid: 3613270 } }), '3613270');
check('真实结构 bundle 无法解析', bd({ type: 'bundle', steam_appid: 888 }), null);

// ============ 0.7 失败固化检测（v3.2.9）/ isFailedRatingEntry ============
console.log('0.7 失败固化检测 isFailedRatingEntry');
const fe = apiMod.isFailedRatingEntry;
check('正常好评率条目有效', fe({ positiveRate: 90, ratingDesc: '特别好评' }), false);
check('0 评测条目有效（有描述）', fe({ positiveRate: null, ratingDesc: '无用户评测' }), false);
check('失败固化（双空）判定', fe({ positiveRate: null, ratingDesc: null }), true);
check('null 输入', fe(null), false);

// ============ 0.8 Steam API 状态监测（v3.3.0）/ api-monitor ============
console.log('0.8 Steam API 状态监测');
const monitor = await import('file:///F:/data/browser%20extension/game-recommender/background/core/api-monitor.js?t=' + Date.now());
monitor.resetApiMonitor();
let st = monitor.getSteamApiStatus();
check('空窗口状态', st.total === 0 && st.anomaly === false && st.failRate === 0, true);
// 正常调用
for (let i = 0; i < 10; i++) monitor.recordSteamCall(true);
st = monitor.getSteamApiStatus();
check('10 次成功：失败率 0、非异常', st.failRate === 0 && st.anomaly === false && st.total === 10, true);
// 高频失败 → 异常
monitor.resetApiMonitor();
for (let i = 0; i < 6; i++) monitor.recordSteamCall(false);
for (let i = 0; i < 4; i++) monitor.recordSteamCall(true);
st = monitor.getSteamApiStatus();
check('失败率 60% 判定异常', st.anomaly === true && st.failRate === 60, true);
// 样本不足不误报
monitor.resetApiMonitor();
monitor.recordSteamCall(false);
st = monitor.getSteamApiStatus();
check('样本不足（1 次失败）不判定异常', st.anomaly === false, true);
// 限流状态码统计
monitor.resetApiMonitor();
monitor.recordSteamCall(false, 429);
monitor.recordSteamCall(true);
monitor.recordSteamCall(false, 503);
st = monitor.getSteamApiStatus();
check('限流状态码统计（429/503）', st.limited, 2);

// ============ 0.9 无好评率缓存重新获取（v3.3.1）/ needsRatingRefetch ============
console.log('0.9 无好评率缓存重新获取 needsRatingRefetch');
const nr = apiMod.needsRatingRefetch;
const refetchNow = Date.now();
check('有好评率不重取', nr({ data: { positiveRate: 90, ratingDesc: '特别好评' } }), false);
check('失败固化立即重取', nr({ data: { positiveRate: null, ratingDesc: null } }), true);
check('0 评测冷却期内不重取', nr({ data: { positiveRate: null, ratingDesc: '无用户评测', ratingRetriedAt: refetchNow - 60 * 1000 } }), false);
check('0 评测冷却期外重取', nr({ data: { positiveRate: null, ratingDesc: '无用户评测', ratingRetriedAt: refetchNow - 11 * 60 * 1000 } }), true);
check('无缓存条目重取', nr(null), true);
check('无重试记录立即重取', nr({ data: { positiveRate: null, ratingDesc: '无用户评测' } }), true);

// ============ 0.10 详情页缓存完整性（v3.3.3）/ isCompleteCacheData ============
console.log('0.10 详情页缓存完整性 isCompleteCacheData');
const icd = apiMod.isCompleteCacheData;
const fullData = {
  url: 'https://store.steampowered.com/app/1/', name: 'Game', genres: ['RPG'],
  userTags: ['RPG'], developers: ['Dev'], chineseSupported: true,
  releaseDate: '2024-01-01', description: 'desc', headerImage: 'https://cdn/h.jpg'
};
check('完整数据判定通过', icd(fullData), true);
check('轻量缓存（列表页写入）判定失败', icd({ appId: '1', name: 'Game', positiveRate: 90, ratingDesc: 'x', headerImage: 'h' }), false);
check('缺 userTags 判定失败', icd({ ...fullData, userTags: undefined }), false);
check('缺 genres 判定失败', icd({ ...fullData, genres: null }), false);
check('缺 url 判定失败', icd({ ...fullData, url: '' }), false);
check('null 输入判定失败', icd(null), false);

// ============ 0.11 详情页独立 TTL（v3.3.3）/ detailSteamCacheTtlMs ============
console.log('0.11 详情页独立 TTL detailSteamCacheTtlMs');
const constMod = await import('file:///F:/data/browser%20extension/game-recommender/background/core/constants.js?t=' + Date.now());
check('默认 72 小时', constMod.detailSteamCacheTtlMs(), 72 * 3600e3);
check('detailSteam 0 = 长期', (() => { constMod.setTtlConfig({ detailSteam: { value: 0, unit: 'hours' } }); return constMod.detailSteamCacheTtlMs(); })(), Infinity);
check('detailSteam 3 天', (() => { constMod.setTtlConfig({ detailSteam: { value: 3, unit: 'days' } }); return constMod.detailSteamCacheTtlMs(); })(), 3 * 86400e3);
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
const cacheMod = await import('file:///F:/data/browser%20extension/game-recommender/background/storage/steam-cache.js?t=' + Date.now());
const modNow = Date.now();
const modEntry = {
  modules: {
    meta: { data: { appId: '3117820', name: '苏丹的游戏' }, ts: modNow },
    rating: { data: { positiveRate: 90 }, ts: modNow - 25 * 3600e3 },   // 25h 前（rating 24h 过期）
    detail: { data: { url: 'https://store.steampowered.com/app/1/' }, ts: modNow - 25 * 3600e3 } // 25h 前（detail 72h 有效）
  }
};
check('rating 模块 25h 前写入已过期（24h TTL）', cacheMod.isModuleValid(modEntry, 'rating'), false);
check('detail 模块 25h 前写入仍有效（72h TTL）', cacheMod.isModuleValid(modEntry, 'detail'), true);
check('meta 模块 30 天 TTL 有效', cacheMod.isModuleValid(modEntry, 'meta'), true);
check('条目整体有效（任一模块未过期）', cacheMod.isSteamCacheValid(modEntry), true);
check('合并视图含各模块字段', (() => { const m = cacheMod.getMergedData(modEntry); return m.appId === '3117820' && m.positiveRate === 90 && !!m.url; })(), true);
check('全部过期条目整体无效', cacheMod.isSteamCacheValid({ modules: { rating: { data: { positiveRate: 1 }, ts: modNow - 25 * 3600e3 } } }), false);

// 0.12b 字段归属路由（setSteamCacheEntry 自动拆分）
console.log('0.12b 字段归属路由 setSteamCacheEntry');
globalThis.chrome = {
  storage: { local: { get: async () => ({}), set: async () => {} } }
};
await cacheMod.resetSteamCache();
await cacheMod.setSteamCacheEntry('test-1', { appId: '1', positiveRate: 95, genres: ['RPG'], steamspy: { ccu: 100 } });
const e1 = await cacheMod.getSteamCacheEntry('test-1');
check('meta 模块路由（appId）', !!e1.modules.meta && e1.modules.meta.data.appId === '1', true);
check('rating 模块路由（positiveRate）', !!e1.modules.rating && e1.modules.rating.data.positiveRate === 95, true);
check('detail 模块路由（genres）', !!e1.modules.detail && e1.modules.detail.data.genres[0] === 'RPG', true);
check('spy 模块路由（steamspy）', !!e1.modules.spy && e1.modules.spy.data.steamspy.ccu === 100, true);
// 部分更新：只写 rating → 其他模块保留
await cacheMod.setSteamCacheEntry('test-1', { positiveRate: 96 });
const e2 = await cacheMod.getSteamCacheEntry('test-1');
check('部分更新保留其他模块', !!e2.modules.meta && !!e2.modules.detail && !!e2.modules.spy, true);
check('部分更新覆盖同模块字段', e2.modules.rating.data.positiveRate === 96 && e2.modules.rating.data.ratingDesc === undefined, true);

// 0.12c 旧平铺结构迁移（load 时自动迁移，旧缓存不立即失效）
console.log('0.12c 旧平铺结构迁移 migrateEntry');
const legacy = { data: { appId: '100', positiveRate: 88, genres: ['RPG'] }, timestamp: modNow - 10 * 3600e3, version: 5 };
const migrated = cacheMod.migrateEntry(legacy);
check('迁移为模块结构', !!migrated.modules, true);
check('迁移字段归属正确', migrated.modules.meta.data.appId === '100' && migrated.modules.rating.data.positiveRate === 88 && migrated.modules.detail.data.genres[0] === 'RPG', true);
check('迁移保留原时间戳', migrated.modules.rating.ts === modNow - 10 * 3600e3, true);
check('模块结构条目迁移不变', cacheMod.migrateEntry(modEntry) === modEntry, true);

// ============ 0.13 近30天评测统计（v3.3.6）/ summarizeRecentReviews ============
console.log('0.13 近30天评测统计 summarizeRecentReviews');
const srr = apiMod.summarizeRecentReviews;
const winSec = apiMod.RECENT_REVIEW_WINDOW_SEC;
const nowSec = Math.floor(Date.now() / 1000);
check('30天窗口内统计（2/3 好评 → 67%）', srr([
  { timestamp_created: nowSec - 86400, voted_up: true },
  { timestamp_created: nowSec - 2 * 86400, voted_up: false },
  { timestamp_created: nowSec - 10 * 86400, voted_up: true }
], nowSec - winSec), { total: 3, positive: 2, rate: 67 });
check('窗口外评测不计入（返回 null 率）', srr([{ timestamp_created: nowSec - 40 * 86400, voted_up: true }], nowSec - winSec), { total: 0, positive: 0, rate: null });
check('空数组', srr([], nowSec - winSec), { total: 0, positive: 0, rate: null });
check('无 timestamp 条目忽略', srr([{ voted_up: true }, { timestamp_created: nowSec - 86400, voted_up: true }], nowSec - winSec), { total: 1, positive: 1, rate: 100 });
check('100 条全近期统计（截断窗口近似）', srr(Array.from({ length: 100 }, (_, i) => ({ timestamp_created: nowSec - i * 3600, voted_up: i % 2 === 0 })), nowSec - winSec), { total: 100, positive: 50, rate: 50 });
check('null 输入', srr(null, nowSec - winSec), { total: 0, positive: 0, rate: null });

// ============ 0.14 检索匹配修复（v3.3.10）/ calcLinkMatchScore + namesRelated ============
console.log('0.14 检索匹配修复 calcLinkMatchScore + namesRelated');
const searchMod = await import('file:///F:/data/browser%20extension/game-recommender/background/sites/search.js?t=' + Date.now());
// 数字保护：二代搜索词 vs 一代页面 → 0 分（"spiritofthenorth2" 不再匹配 "spiritofthenorth"）
check('二代词 vs 一代页（数字保护 → 0 分）', searchMod.calcLinkMatchScore('北方之魂增强版/Spirit of the North- Switch520.com', 'Spirit of the North 2'), 0);
check('一代词 vs 一代页（正常命中）', searchMod.calcLinkMatchScore('北方之魂增强版/Spirit of the North- Switch520.com', 'Spirit of the North') >= 60, true);
check('正常英文命中', searchMod.calcLinkMatchScore('风启之旅/Windrose/支持网络联机', 'Windrose') >= 80, true);
check('无关游戏拒绝', searchMod.calcLinkMatchScore('轮回之兽|豪华中文', 'Spirit of the North 2'), 0);
// namesRelated：缓存命中名称校验（防名称索引粘性）
const nr2 = apiMod.namesRelated;
check('粘性条目拒绝（16598标题 vs 轮回之兽）', nr2('北方之魂增强版/Spirit of the North- Switch520.com', '轮回之兽'), false);
check('一代标题 vs 一代缓存名', nr2('北方之魂增强版/Spirit of the North- Switch520.com', 'Spirit of the North'), true);
check('正常下载站标题 vs 缓存名', nr2('泰坦之旅2|v0.7.0.136009|官方中文|Titan Quest II', 'Titan Quest II'), true);
check('纯英文标题 vs 纯中文缓存名（跨语言信任）', nr2('Gladiator Guild Manager', '角斗士公会经理'), true);
check('纯中文标题 vs 纯英文缓存名（跨语言信任）', nr2('角斗士公会经理', 'Gladiator Guild Manager'), true);
check('无关中文标题拒绝', nr2('奉魔', '轮回之兽'), false);
check('空输入', nr2('', ''), false);

// ============ 1. 适配规则校验 / Adapter-rule validation ============
console.log('1. 适配规则校验 validateAdapterRules');
const validRules = {
  version: 1,
  sites: [{
    key: 'xdgame', name: 'XDGame', domains: ['xdgame.com'], base: 'https://xdgame.com',
    searchUrl: 'https://xdgame.com/so/{q}.html',
    detailUrlPatterns: ['/game/\\d+\\.html?$'], imageAppId: true,
    listPage: { urlPatterns: ['^/so/'], minDetailLinks: 5 },
    listItem: { containers: ['.game-list li'], titleLink: 'a.tit', minLen: 2, maxLen: 200, fallbackLinks: true }
  }]
};
check('合法规则通过', rulesMod.validateAdapterRules(validRules).ok, true);
check('非对象拒绝', rulesMod.validateAdapterRules(null).ok, false);
check('缺 version 拒绝', rulesMod.validateAdapterRules({ sites: [] }).ok, false);
check('sites 非数组拒绝', rulesMod.validateAdapterRules({ version: 1, sites: {} }).ok, false);
check('sites 为空拒绝', rulesMod.validateAdapterRules({ version: 1, sites: [] }).ok, false);
check('站点缺 key 拒绝', rulesMod.validateAdapterRules({ version: 1, sites: [{ name: 'X' }] }).ok, false);
check('key 非法字符拒绝', rulesMod.validateAdapterRules({ version: 1, sites: [{ key: 'bad key!', name: 'X', domains: ['x.com'] }] }).ok, false);
check('缺 domains 拒绝', rulesMod.validateAdapterRules({ version: 1, sites: [{ key: 'x', name: 'X' }] }).ok, false);
check('domains 为空拒绝', rulesMod.validateAdapterRules({ version: 1, sites: [{ key: 'x', name: 'X', domains: [] }] }).ok, false);
check('类型错误拒绝（searchUrl 数字）', rulesMod.validateAdapterRules({ version: 1, sites: [{ key: 'x', name: 'X', domains: ['x.com'], searchUrl: 123 }] }).ok, false);
check('key 重复拒绝', rulesMod.validateAdapterRules({ version: 1, sites: [validRules.sites[0], { key: 'xdgame', name: 'B', domains: ['b.com'] }] }).ok, false);

// 函数注入拒绝（纯数据白名单）/ function injection rejected
const injected = { version: 1, sites: [{ key: 'x', name: 'X', domains: ['x.com'], onload: 'alert(1)' }] };
check('未知字段（含脚本字符串）不导致拒绝', rulesMod.validateAdapterRules(injected).ok, true);
const funcInjected = { version: 1, sites: [{ key: 'x', name: 'X', domains: ['x.com'], searchUrl: () => 'x' }] };
check('函数值拒绝（JSON 不可序列化）', rulesMod.validateAdapterRules(funcInjected).ok, false);

// 规模上限 / size limits
const tooMany = { version: 1, sites: Array.from({ length: 51 }, (_, i) => ({ key: 's' + i, name: 'S' + i, domains: ['s' + i + '.com'] })) };
check('sites 超 50 拒绝', rulesMod.validateAdapterRules(tooMany).ok, false);
const tooManyDomains = { version: 1, sites: [{ key: 'x', name: 'X', domains: Array.from({ length: 11 }, (_, i) => 'd' + i + '.com') }] };
check('domains 超 10 拒绝', rulesMod.validateAdapterRules(tooManyDomains).ok, false);
const tooDeep = { version: 1, sites: [{ key: 'x', name: 'X', domains: ['x.com'], listItem: { a: { b: { c: { d: { e: { f: { g: 'deep' } } } } } } } }] };
check('嵌套过深拒绝', rulesMod.validateAdapterRules(tooDeep).ok, false);

// ============ 2. Steam 缓存过期清理 / Steam-cache cleanup ============
console.log('2. Steam 缓存过期清理 collectExpiredSteamCache（v3.3.7 模块化）');
const now = Date.now();
const steamEntries = {
  // 全部模块未过期 → 保留
  '1': { modules: { meta: { data: { appId: '1' }, ts: now }, rating: { data: { positiveRate: 90 }, ts: now } } },
  // 仅 rating 且过期（无其他模块）→ 全过期删除
  '2': { modules: { rating: { data: { positiveRate: 80 }, ts: now - 25 * 3600e3 } } },
  // detail 25h 前（72h TTL 仍有效）→ 保留（部分有效，使用中自动刷新）
  '3': { modules: { detail: { data: { url: 'https://x' }, ts: now - 25 * 3600e3 } } },
  // 旧平铺结构 → 迁移后按模块判定（空 data 无字段 → 删除）
  '4': { data: {}, timestamp: now - 25 * 3600e3, version: 6 },
  // 旧平铺结构含有效模块字段（25h 前详情，迁移后 detail 仍有效）→ 保留
  '5': { data: { appId: '5', url: 'https://x' }, timestamp: now - 25 * 3600e3, version: 6 }
};
let steamResult = cleanupMod.collectExpiredSteamCache(steamEntries);
check('仅删除全过期条目（2 条）', steamResult.removed, 2);
check('保留全部有效条目', steamResult.map.has('1') && steamResult.map.has('3') && steamResult.map.has('5'), true);
check('删除仅 rating 过期条目', steamResult.map.has('2'), false);
check('删除空字段旧结构条目', steamResult.map.has('4'), false);
check('空输入', cleanupMod.collectExpiredSteamCache(null).removed, 0);

// ============ 3. 名称负缓存清理 / Negative-name cleanup ============
console.log('3. 名称负缓存清理 collectExpiredNegativeNames');
const nameEntries = {
  'a': { appId: null, lastSearched: now - 3 * 3600e3 },   // 负缓存过期（TTL 2h）
  'b': { appId: null, lastSearched: now },                // 负缓存未过期
  'c': { appId: '111', lastSearched: now - 100 * 3600e3 }, // 正向映射不清理
  'd': { appId: null, lastSearched: 0 }                   // 无时间戳 → 清理
};
let nameResult = cleanupMod.collectExpiredNegativeNames(nameEntries, 2 * 3600e3);
check('TTL 2h：移除 2 条负缓存', nameResult.removed, 2);
check('未过期负缓存保留', nameResult.map.has('b'), true);
check('正向映射不清理', nameResult.map.has('c'), true);
nameResult = cleanupMod.collectExpiredNegativeNames(nameEntries, Infinity);
check('0=长期：时间过期全保留，无时间戳异常条目仍清理', nameResult.removed, 1);

// ============ 4. 下载站网址清理 / Download-URL cleanup ============
console.log('4. 下载站网址清理 collectExpiredDownloadUrls');
const urlStore = {
  v: 2,
  sites: {
    xdgame: {
      '1': { url: 'https://xdgame.com/1.html', firstSeen: now - 40 * 86400e3, lastRefreshed: now - 40 * 86400e3, lastAccessed: now - 40 * 86400e3 }, // 过期（TTL 30d）
      '2': { url: 'https://xdgame.com/2.html', firstSeen: now - 10 * 86400e3, lastRefreshed: now, lastAccessed: now } // 未过期
    },
    empty: {} // 空桶
  }
};
let urlResult = cleanupMod.collectExpiredDownloadUrls(urlStore, 30 * 86400e3);
check('TTL 30d：移除 1 条', urlResult.removed, 1);
check('未过期条目保留', urlResult.store.sites.xdgame['2'] !== undefined, true);
check('空桶被移除', urlResult.store.sites.empty === undefined, true);
check('版本保留', urlResult.store.v, 2);
urlResult = cleanupMod.collectExpiredDownloadUrls(urlStore, Infinity);
check('0=长期：全保留', urlResult.removed, 0);
check('空输入', cleanupMod.collectExpiredDownloadUrls(null, 30 * 86400e3).removed, 0);

console.log('\n===== 规则校验与缓存清理测试结果 =====');
console.log(pass + ' 通过, ' + fail + ' 失败');

export const testResult = { pass, fail, ok: fail === 0 };
