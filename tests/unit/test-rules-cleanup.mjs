/**
 * Game Recommender - 测试：规则校验与缓存清理 / Rule Validation & Cache Cleanup
 *
 * v4.2.0：由原 test-cleanup 拆分（1~4 节）——validateAdapterRules（结构/类型
 * 白名单/函数拒绝/规模上限/正则试编译）+ sanitizeImportedModule（导入限额）
 * + 三类过期缓存清理纯函数。
 */
'use strict';

import { createReporter } from '../helpers/assert.mjs';
const reporter = createReporter();
const { check } = reporter;

const rulesMod = await import(new URL('../../background/core/rules.js', import.meta.url).href + '?t=' + Date.now());
const cleanupMod = await import(new URL('../../background/storage/cleanup.js', import.meta.url).href + '?t=' + Date.now());
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

// ============ 5. 导入清洗（v4.2.0）/ sanitizeImportedModule ============
console.log('5. 导入清洗 sanitizeImportedModule');
const cleanSettings = await rulesMod.sanitizeImportedModule('settings', { enabled: true, weights: { clickRate: 0.2 } });
check('settings 白名单清洗保留已知键', cleanSettings.enabled === true && cleanSettings.weights.clickRate === 0.2, true);
check('settings 密钥剔除（apiKey 清空）', rulesMod.sanitizeImportedModule('settings', { llmConfig: { apiKey: 'sk-secret' } }).llmConfig.apiKey, '');
check('adapterRules 走规则校验（非法返回 null）', rulesMod.sanitizeImportedModule('adapterRules', { version: 1, sites: [{ key: 'x' }] }), null);
check('adapterRules 合法通过', rulesMod.sanitizeImportedModule('adapterRules', validRules) !== null, true);
check('未知模块非纯 JSON 拒绝', rulesMod.sanitizeImportedModule('steamCache', () => 1), null);
check('未知模块纯 JSON 通过', JSON.stringify(rulesMod.sanitizeImportedModule('steamCache', { a: 1 })), JSON.stringify({ a: 1 }));
check('null 值未知模块拒绝', rulesMod.sanitizeImportedModule('behaviorLog', null), null);

console.log('\n===== 规则校验与缓存清理测试结果 =====');
const finalResult = reporter.getResult();
console.log(finalResult.pass + ' 通过, ' + finalResult.fail + ' 失败');
export const testResult = reporter.getResult();
