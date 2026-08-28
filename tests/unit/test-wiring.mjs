import { test, expect, describe, beforeAll } from 'vitest';
/**
 * 游戏雷达 Game Radar - 测试：接线层补强（v10.0.0 批次 C）
 *
 * 覆盖 data-modules（清单/导出剔密钥/导入校验/清数据）、site-scripts
 * （动态注册幂等）、history（站点推断纯函数）、stats（趋势/推荐兜底）。
 * Wiring-layer tests: data-modules handlers, dynamic site-script
 * registration, site inference and stats fallbacks.
 */
('use strict');

import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';

const storage = createStorageMock();
installChromeStorageMock(storage);

// 动态注册 mock（site-scripts 用）/ dynamic registration mock
const registeredScripts = [];
globalThis.chrome.scripting = {
  registerContentScripts: async (scripts) => {
    registeredScripts.push(...scripts);
  },
  getRegisteredContentScripts: async () => registeredScripts.slice()
};

const dataModules = await import(
  new URL('../../background/handlers/data-modules.js', import.meta.url).href + '?t=' + Date.now()
);
const siteScripts = await import(
  new URL('../../background/core/site-scripts.js', import.meta.url).href + '?t=' + Date.now()
);
const rulesMod = await import(new URL('../../background/core/rules.js', import.meta.url).href + '?t=' + Date.now());
const historyMod = await import(
  new URL('../../background/storage/history.js', import.meta.url).href + '?t=' + Date.now()
);
const statsMod = await import(new URL('../../background/handlers/stats.js', import.meta.url).href + '?t=' + Date.now());

beforeAll(() => {
  globalThis.__GAME_RECOMMENDER_SITES__ = {
    version: 1,
    sites: [{ key: 'xdgame', name: 'XDGame', displayName: 'XDGame', domains: ['xdgame.com'] }]
  };
});

describe('data-modules 数据模块 handler', () => {
  test('countModuleItems 纯函数：数组/对象/标量/空', () => {
    expect(dataModules.countModuleItems([1, 2, 3])).toEqual(3);
    expect(dataModules.countModuleItems({ a: 1, b: 2 })).toEqual(2);
    expect(dataModules.countModuleItems('x')).toEqual(1);
    expect(dataModules.countModuleItems(undefined)).toEqual(0);
    expect(dataModules.countModuleItems(null)).toEqual(0);
  });

  test('handleGetDataModules 返回全部模块清单', async () => {
    storage._reset();
    const resp = await dataModules.handleGetDataModules();
    expect(resp.modules.length).toBeGreaterThan(15);
    const settings = resp.modules.find((m) => m.key === 'settings');
    expect(settings && settings.name).toEqual('扩展配置');
  });

  test('handleExportData 剔除 API 密钥', async () => {
    storage._reset();
    await storage.set({
      settings: { llmConfig: { apiKey: 'sk-secret', endpoint: 'https://api.example.com' }, steamApiKey: 'steam-key' }
    });
    const resp = await dataModules.handleExportData({ moduleKeys: ['settings'] });
    expect(resp.success).toEqual(true);
    expect(resp.data.modules.settings.llmConfig.apiKey).toEqual('');
    expect(resp.data.modules.settings.steamApiKey).toEqual('');
    // 导出不含备份模块（未勾选）
    expect(resp.data.modules.backups).toEqual(undefined);
  });

  test('handleImportData：坏格式拒绝 / 合法数据写入', async () => {
    storage._reset();
    const bad1 = await dataModules.handleImportData({ data: null });
    expect(bad1.success).toEqual(false);
    const bad2 = await dataModules.handleImportData({ data: { format: 'other', version: 1, modules: {} } });
    expect(bad2.success).toEqual(false);
    const ok = await dataModules.handleImportData({
      data: { format: 'game-recommender-backup', version: 1, modules: { gameProfiles: { 游戏: { views: 1 } } } }
    });
    expect(ok.success).toEqual(true);
    expect(ok.imported).toContain('gameProfiles');
    const stored = await dataModules.handleGetDataModules();
    const profiles = stored.modules.find((m) => m.key === 'gameProfiles');
    expect(profiles && profiles.count).toEqual(1);
  });

  test('handleClearData 清空学习数据并返回 success', async () => {
    storage._reset();
    await storage.set({ behaviorLog: [{ type: 'view_detail' }], gameProfiles: { a: { views: 1 } } });
    const resp = await dataModules.handleClearData();
    expect(resp.success).toEqual(true);
    const dump = storage._dump();
    expect(dump.behaviorLog).toEqual(undefined);
    expect(dump.gameProfiles).toEqual(undefined);
  });
});

describe('site-scripts 动态注册', () => {
  test('自定义域名注册 + 幂等重跑不重复 + 内置域跳过', async () => {
    rulesMod.resetRulesCache(); // siteRulesCache 跨测试缓存——改 __GAME_RECOMMENDER_SITES__ 后必须重置
    globalThis.__GAME_RECOMMENDER_SITES__ = {
      version: 1,
      sites: [
        { key: 'xdgame', name: 'XDGame', domains: ['xdgame.com'] }, // 内置 → 跳过
        { key: 'mysite', name: 'My', domains: ['example-custom.com'] } // 自定义 → 注册
      ]
    };
    await siteScripts.syncSiteScripts();
    expect(registeredScripts.length).toEqual(1);
    expect(registeredScripts[0].id).toEqual('gr-site-example-custom.com');
    expect(registeredScripts[0].matches).toContain('*://*.example-custom.com/*');
    // 幂等：重跑不再注册
    await siteScripts.syncSiteScripts();
    expect(registeredScripts.length).toEqual(1);
  });

  test('仅内置站点时不注册', async () => {
    rulesMod.resetRulesCache();
    registeredScripts.length = 0;
    globalThis.__GAME_RECOMMENDER_SITES__ = {
      version: 1,
      sites: [{ key: 'xdgame', name: 'XDGame', domains: ['xdgame.com'] }]
    };
    await siteScripts.syncSiteScripts();
    expect(registeredScripts.length).toEqual(0);
  });
});

describe('history 站点推断（v9.7.0 六站）', () => {
  test('内置六站全部识别', () => {
    expect(historyMod.inferSiteFromDomain('www.xdgame.com').key).toEqual('xdgame');
    expect(historyMod.inferSiteFromDomain('xianyudanji.gg').key).toEqual('xianyudanji');
    expect(historyMod.inferSiteFromDomain('www.gamer520.com').key).toEqual('gamer520');
    expect(historyMod.inferSiteFromDomain('gamers520.com').key).toEqual('gamer520');
    expect(historyMod.inferSiteFromDomain('www.3dmgame.com').key).toEqual('3dmgame');
    expect(historyMod.inferSiteFromDomain('www.ali213.net').key).toEqual('ali213');
    expect(historyMod.inferSiteFromDomain('www.gamersky.com').key).toEqual('gamersky');
  });
  test('未知域与空值', () => {
    expect(historyMod.inferSiteFromDomain('evil.example.com').key).toEqual('unknown');
    expect(historyMod.inferSiteFromDomain('').key).toEqual('unknown');
    expect(historyMod.inferSiteFromDomain(null).name).toEqual('未知站点');
  });
});

describe('stats 趋势与推荐兜底', () => {
  test('handleGetTrends 按天聚合（含转化率）', async () => {
    storage._reset();
    const ts = new Date('2026-08-28T10:00:00').getTime();
    await storage.set({
      behaviorLog: [
        { type: 'view_detail', gameName: 'A', timestamp: ts },
        { type: 'click_download', gameName: 'A', timestamp: ts }
      ]
    });
    const resp = await statsMod.handleGetTrends({ granularity: 'day' });
    expect(resp.granularity).toEqual('day');
    expect(resp.daily.length).toEqual(1);
    expect(resp.daily[0].views).toEqual(1);
    expect(resp.daily[0].rate).toEqual(100);
  });

  test('handleGetTrends 周粒度', async () => {
    storage._reset();
    const resp = await statsMod.handleGetTrends({ granularity: 'week' });
    expect(resp.granularity).toEqual('week');
  });

  test('handleGetSteamRecommendations 无学习数据返回提示', async () => {
    storage._reset();
    const resp = await statsMod.handleGetSteamRecommendations();
    expect(resp.games).toEqual([]);
    expect(!!resp.message).toEqual(true);
  });
});

// ============ v10.0.0 批次 C 补强：history / behavior 写路径 ============
const behaviorMod = await import(
  new URL('../../background/storage/behavior.js', import.meta.url).href + '?t=' + Date.now()
);

test('recordDownloadHistory：下载计数与站点推断落库', async () => {
  storage._reset();
  await historyMod.recordDownloadHistory({
    gameName: '艾尔登法环',
    domain: 'www.gamersky.com',
    detailUrl: 'https://www.gamersky.com/1.html'
  });
  await historyMod.recordDownloadHistory({ gameName: '艾尔登法环', domain: 'www.gamersky.com' });
  const history = await historyMod.getDownloadHistory();
  const entry = history['艾尔登法环'];
  expect(entry && entry.totalDownloads).toEqual(2);
  expect(entry && entry.lastDownloadSite).toEqual('gamersky');
  // 短名与空名拒绝
  await historyMod.recordDownloadHistory({ gameName: 'A' });
  await historyMod.recordDownloadHistory({});
  const history2 = await historyMod.getDownloadHistory();
  expect(Object.keys(history2).length).toEqual(1);
});

test('updateGameProfile / maybeUpdatePreferences：偏好模型更新', async () => {
  storage._reset();
  behaviorMod.resetBehaviorMemory();
  behaviorMod.resetBehaviorState();
  // 关键词仅从 view_detail 采集；同一游戏有下载 → 该游戏全部关键词 +2
  await behaviorMod.addBehaviorLog({ type: 'view_detail', gameName: '游戏X', keywords: ['开放世界'] });
  await behaviorMod.addBehaviorLog({ type: 'click_download', gameName: '游戏X' });
  await behaviorMod.addBehaviorLog({ type: 'view_detail', gameName: '游戏Y', keywords: ['开放世界'] });
  await behaviorMod.maybeUpdatePreferences(true);
  const weights = await behaviorMod.readKeywordWeights();
  // 下载 +2、仅浏览 +1 → pos=2 neg=1 → 2/(2+1+1)=0.5
  expect(weights['开放世界']).toEqual(0.5);
});
