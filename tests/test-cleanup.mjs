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

// ============ 0.12 缓存有效性带 TTL 参数（v3.3.3）/ isSteamCacheValid ============
console.log('0.12 缓存有效性带 TTL 参数 isSteamCacheValid');
const cacheMod = await import('file:///F:/data/browser%20extension/game-recommender/background/storage/steam-cache.js?t=' + Date.now());
const V = constMod.STEAM_CACHE_VERSION;
check('25h 条目：列表页默认 TTL(24h) 过期', cacheMod.isSteamCacheValid({ version: V, timestamp: Date.now() - 25 * 3600e3, data: {} }), false);
check('25h 条目：详情页 TTL(72h) 有效', cacheMod.isSteamCacheValid({ version: V, timestamp: Date.now() - 25 * 3600e3, data: {} }, 72 * 3600e3), true);
check('100h 条目：详情页 TTL 过期', cacheMod.isSteamCacheValid({ version: V, timestamp: Date.now() - 100 * 3600e3, data: {} }, 72 * 3600e3), false);

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
console.log('2. Steam 缓存过期清理 collectExpiredSteamCache');
const now = Date.now();
const steamEntries = {
  '1': { data: {}, timestamp: now, version: 5 },                    // 未过期
  '2': { data: {}, timestamp: now - 25 * 3600e3, version: 5 },      // 过期（TTL 24h）
  '3': { data: {}, timestamp: now, version: 4 },                    // 版本不符 → 过期
  '4': { data: {}, timestamp: now - 25 * 3600e3, version: 5 }       // 过期
};
let steamResult = cleanupMod.collectExpiredSteamCache(steamEntries, 24 * 3600e3);
check('TTL 24h：移除 3 条', steamResult.removed, 3);
check('保留未过期条目', steamResult.map.has('1'), true);
check('移除过期条目', steamResult.map.has('2') || steamResult.map.has('3') || steamResult.map.has('4'), false);
steamResult = cleanupMod.collectExpiredSteamCache(steamEntries, Infinity);
check('0=长期：时间过期全保留，版本不符仍清理', steamResult.removed, 1);
check('空输入', cleanupMod.collectExpiredSteamCache(null, 24 * 3600e3).removed, 0);

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
