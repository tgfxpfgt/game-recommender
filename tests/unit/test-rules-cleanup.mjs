import { test, expect } from 'vitest';
/**
 * Game Recommender - 测试：规则校验与缓存清理 / Rule Validation & Cache Cleanup
 *
 * v4.2.0：由原 test-cleanup 拆分（1~4 节）——validateAdapterRules（结构/类型
 * 白名单/函数拒绝/规模上限/正则试编译）+ sanitizeImportedModule（导入限额）
 * + 三类过期缓存清理纯函数。
 */
'use strict';


const rulesMod = await import(new URL('../../background/core/rules.js', import.meta.url).href + '?t=' + Date.now());
const cleanupMod = await import(
  new URL('../../background/storage/cleanup.js', import.meta.url).href + '?t=' + Date.now()
);
console.log('1. 适配规则校验 validateAdapterRules');
const validRules = {
  version: 1,
  sites: [
    {
      key: 'xdgame',
      name: 'XDGame',
      domains: ['xdgame.com'],
      base: 'https://xdgame.com',
      searchUrl: 'https://xdgame.com/so/{q}.html',
      detailUrlPatterns: ['/game/\\d+\\.html?$'],
      imageAppId: true,
      listPage: { urlPatterns: ['^/so/'], minDetailLinks: 5 },
      listItem: { containers: ['.game-list li'], titleLink: 'a.tit', minLen: 2, maxLen: 200, fallbackLinks: true }
    }
  ]
};
test('合法规则通过', () => { expect(rulesMod.validateAdapterRules(validRules).ok).toEqual(true); });
test('非对象拒绝', () => { expect(rulesMod.validateAdapterRules(null).ok).toEqual(false); });
test('缺 version 拒绝', () => { expect(rulesMod.validateAdapterRules({ sites: [] }).ok).toEqual(false); });
test('sites 非数组拒绝', () => { expect(rulesMod.validateAdapterRules({ version: 1, sites: {} }).ok).toEqual(false); });
test('sites 为空拒绝', () => { expect(rulesMod.validateAdapterRules({ version: 1, sites: [] }).ok).toEqual(false); });
test('站点缺 key 拒绝', () => { expect(rulesMod.validateAdapterRules({ version: 1, sites: [{ name: 'X' }] }).ok).toEqual(false); });
test('key 非法字符拒绝', () => { expect(rulesMod.validateAdapterRules({ version: 1, sites: [{ key: 'bad key!', name: 'X', domains: ['x.com'] }] }).ok).toEqual(false); });
test('缺 domains 拒绝', () => { expect(rulesMod.validateAdapterRules({ version: 1, sites: [{ key: 'x', name: 'X' }] }).ok).toEqual(false); });
test('domains 为空拒绝', () => { expect(rulesMod.validateAdapterRules({ version: 1, sites: [{ key: 'x', name: 'X', domains: [] }] }).ok).toEqual(false); });
test('类型错误拒绝（searchUrl 数字）', () => { expect(rulesMod.validateAdapterRules({ version: 1, sites: [{ key: 'x', name: 'X', domains: ['x.com'], searchUrl: 123 }] })
    .ok).toEqual(false); });
test('key 重复拒绝', () => { expect(rulesMod.validateAdapterRules({
    version: 1,
    sites: [validRules.sites[0], { key: 'xdgame', name: 'B', domains: ['b.com'] }]
  }).ok).toEqual(false); });

// 函数注入拒绝（纯数据白名单）/ function injection rejected
const injected = { version: 1, sites: [{ key: 'x', name: 'X', domains: ['x.com'], onload: 'alert(1)' }] };
test('未知字段（含脚本字符串）不导致拒绝', () => { expect(rulesMod.validateAdapterRules(injected).ok).toEqual(true); });
const funcInjected = { version: 1, sites: [{ key: 'x', name: 'X', domains: ['x.com'], searchUrl: () => 'x' }] };
test('函数值拒绝（JSON 不可序列化）', () => { expect(rulesMod.validateAdapterRules(funcInjected).ok).toEqual(false); });

// 规模上限 / size limits
const tooMany = {
  version: 1,
  sites: Array.from({ length: 51 }, (_, i) => ({ key: 's' + i, name: 'S' + i, domains: ['s' + i + '.com'] }))
};
test('sites 超 50 拒绝', () => { expect(rulesMod.validateAdapterRules(tooMany).ok).toEqual(false); });
const tooManyDomains = {
  version: 1,
  sites: [{ key: 'x', name: 'X', domains: Array.from({ length: 11 }, (_, i) => 'd' + i + '.com') }]
};
test('domains 超 10 拒绝', () => { expect(rulesMod.validateAdapterRules(tooManyDomains).ok).toEqual(false); });
const tooDeep = {
  version: 1,
  sites: [
    { key: 'x', name: 'X', domains: ['x.com'], listItem: { a: { b: { c: { d: { e: { f: { g: 'deep' } } } } } } } }
  ]
};
test('嵌套过深拒绝', () => { expect(rulesMod.validateAdapterRules(tooDeep).ok).toEqual(false); });

// ============ 2. Steam 缓存过期清理 / Steam-cache cleanup ============
console.log('2. Steam 缓存过期清理 collectExpiredSteamCache（v3.3.7 模块化）');
const now = Date.now();
const steamEntries = {
  // 全部模块未过期 → 保留
  1: { modules: { meta: { data: { appId: '1' }, ts: now }, rating: { data: { positiveRate: 90 }, ts: now } } },
  // 仅 rating 且过期（无其他模块）→ 全过期删除
  2: { modules: { rating: { data: { positiveRate: 80 }, ts: now - 25 * 3600e3 } } },
  // detail 25h 前（72h TTL 仍有效）→ 保留（部分有效，使用中自动刷新）
  3: { modules: { detail: { data: { url: 'https://x' }, ts: now - 25 * 3600e3 } } },
  // 旧平铺结构 → 迁移后按模块判定（空 data 无字段 → 删除）
  4: { data: {}, timestamp: now - 25 * 3600e3, version: 6 },
  // 旧平铺结构含有效模块字段（25h 前详情，迁移后 detail 仍有效）→ 保留
  5: { data: { appId: '5', url: 'https://x' }, timestamp: now - 25 * 3600e3, version: 6 }
};
let steamResult = cleanupMod.collectExpiredSteamCache(steamEntries);
test('仅删除全过期条目（2 条）', () => { expect(steamResult.removed).toEqual(2); });
test('保留全部有效条目', () => { expect(steamResult.map.has('1') && steamResult.map.has('3') && steamResult.map.has('5')).toEqual(true); });
test('删除仅 rating 过期条目', () => { expect(steamResult.map.has('2')).toEqual(false); });
test('删除空字段旧结构条目', () => { expect(steamResult.map.has('4')).toEqual(false); });
test('空输入', () => { expect(cleanupMod.collectExpiredSteamCache(null).removed).toEqual(0); });

// ============ 3. 名称负缓存清理 / Negative-name cleanup ============
console.log('3. 名称负缓存清理 collectExpiredNegativeNames');
const nameEntries = {
  a: { appId: null, lastSearched: now - 3 * 3600e3 }, // 负缓存过期（TTL 2h）
  b: { appId: null, lastSearched: now }, // 负缓存未过期
  c: { appId: '111', lastSearched: now - 100 * 3600e3 }, // 正向映射不清理
  d: { appId: null, lastSearched: 0 } // 无时间戳 → 清理
};
test('TTL 2h：移除 2 条负缓存', () => {
  const r = cleanupMod.collectExpiredNegativeNames(nameEntries, 2 * 3600e3);
  expect(r.removed).toEqual(2);
});
test('未过期负缓存保留', () => {
  const r = cleanupMod.collectExpiredNegativeNames(nameEntries, 2 * 3600e3);
  expect(r.map.has('b')).toEqual(true);
});
test('正向映射不清理', () => {
  const r = cleanupMod.collectExpiredNegativeNames(nameEntries, 2 * 3600e3);
  expect(r.map.has('c')).toEqual(true);
});
test('0=长期：时间过期全保留，无时间戳异常条目仍清理', () => {
  const r = cleanupMod.collectExpiredNegativeNames(nameEntries, Infinity);
  expect(r.removed).toEqual(1);
});

// ============ 4. 下载站网址清理 / Download-URL cleanup ============
console.log('4. 下载站网址清理 collectExpiredDownloadUrls');
const urlStore = {
  v: 2,
  sites: {
    xdgame: {
      1: {
        url: 'https://xdgame.com/1.html',
        firstSeen: now - 40 * 86400e3,
        lastRefreshed: now - 40 * 86400e3,
        lastAccessed: now - 40 * 86400e3
      }, // 过期（TTL 30d）
      2: { url: 'https://xdgame.com/2.html', firstSeen: now - 10 * 86400e3, lastRefreshed: now, lastAccessed: now } // 未过期
    },
    empty: {} // 空桶
  }
};
test('TTL 30d：移除 1 条', () => {
  const r = cleanupMod.collectExpiredDownloadUrls(urlStore, 30 * 86400e3);
  expect(r.removed).toEqual(1);
});
test('未过期条目保留', () => {
  const r = cleanupMod.collectExpiredDownloadUrls(urlStore, 30 * 86400e3);
  expect(r.store.sites.xdgame['2'] !== undefined).toEqual(true);
});
test('空桶被移除', () => {
  const r = cleanupMod.collectExpiredDownloadUrls(urlStore, 30 * 86400e3);
  expect(r.store.sites.empty === undefined).toEqual(true);
});
test('版本保留', () => {
  const r = cleanupMod.collectExpiredDownloadUrls(urlStore, 30 * 86400e3);
  expect(r.store.v).toEqual(2);
});
test('0=长期：全保留', () => {
  const r = cleanupMod.collectExpiredDownloadUrls(urlStore, Infinity);
  expect(r.removed).toEqual(0);
});
test('空输入', () => { expect(cleanupMod.collectExpiredDownloadUrls(null, 30 * 86400e3).removed).toEqual(0); });

// ============ 5. 导入清洗（v4.2.0）/ sanitizeImportedModule ============
console.log('5. 导入清洗 sanitizeImportedModule');
const cleanSettings = await rulesMod.sanitizeImportedModule('settings', { enabled: true, weights: { clickRate: 0.2 } });
test('settings 白名单清洗保留已知键', () => { expect(cleanSettings.enabled === true && cleanSettings.weights.clickRate === 0.2).toEqual(true); });
test('settings 密钥剔除（apiKey 清空）', () => { expect(rulesMod.sanitizeImportedModule('settings', { llmConfig: { apiKey: 'sk-secret' } }).llmConfig.apiKey).toEqual(''); });
test('adapterRules 走规则校验（非法返回 null）', () => { expect(rulesMod.sanitizeImportedModule('adapterRules', { version: 1, sites: [{ key: 'x' }] })).toEqual(null); });
test('adapterRules 合法通过', () => { expect(rulesMod.sanitizeImportedModule('adapterRules', validRules) !== null).toEqual(true); });
test('未知模块非纯 JSON 拒绝', () => { expect(rulesMod.sanitizeImportedModule('steamCache', () => 1)).toEqual(null); });
test('未知模块纯 JSON 通过', () => { expect(JSON.stringify(rulesMod.sanitizeImportedModule('steamCache', { a: 1 }))).toEqual(JSON.stringify({ a: 1 })); });
test('null 值未知模块拒绝', () => { expect(rulesMod.sanitizeImportedModule('behaviorLog', null)).toEqual(null); });

