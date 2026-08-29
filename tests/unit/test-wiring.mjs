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

// ============ v10.1.0：AppID 行为统计（a 下载 / b 详情页打开，永不过期） ============
const appStatsMod = await import(
  new URL('../../background/storage/app-stats.js', import.meta.url).href + '?t=' + Date.now()
);

test('v10.2.0：appStats 去重——同站 24h 不重复、跨站分别计数', async () => {
  storage._reset();
  appStatsMod.resetAppStats();
  await appStatsMod.recordAppDownload('730', 'xdgame');
  await appStatsMod.recordAppDownload('730', 'xdgame'); // 同站重复 → 不计
  await appStatsMod.recordAppDownload('730', 'xianyudanji'); // 跨站 → 计
  await appStatsMod.recordAppDetailView('730', 'xdgame');
  await appStatsMod.recordAppDetailView('730', 'xdgame'); // 同站重复 → 不计
  await appStatsMod.recordAppDetailView('730', 'xianyudanji'); // 跨站 → 计
  await appStatsMod.recordAppDetailView('730', '3dmgame'); // 跨站 → 计
  await appStatsMod.recordAppDetailView('275850', 'gamersky');
  const all = await appStatsMod.getAppStats();
  expect(all['730'].downloads).toEqual(2);
  expect(all['730'].detailViews).toEqual(3);
  expect(all['275850'].detailViews).toEqual(1);
  // 按 appId 子集读取
  const subset = await appStatsMod.getAppStats(['730']);
  expect(subset['275850']).toEqual(undefined);
  appStatsMod.resetAppStats();
  const empty = await appStatsMod.getAppStats();
  expect(Object.keys(empty).length).toEqual(0);
});

test('v10.2.0：无 siteKey 用 unknown 桶去重 + 无效 appId 拒绝', async () => {
  storage._reset();
  appStatsMod.resetAppStats();
  await appStatsMod.recordAppDownload('730');
  await appStatsMod.recordAppDownload('730'); // 同 unknown 桶 24h 内重复 → 不计
  const all = await appStatsMod.getAppStats();
  expect(all['730'].downloads).toEqual(1);
  await appStatsMod.recordAppDownload('');
  await appStatsMod.recordAppDetailView(null);
  expect(Object.keys(await appStatsMod.getAppStats()).length).toEqual(1);
  appStatsMod.resetAppStats();
});

test('appStats：无效 appId 拒绝', async () => {
  storage._reset();
  appStatsMod.resetAppStats();
  await appStatsMod.recordAppDownload('');
  await appStatsMod.recordAppDetailView(null);
  expect(Object.keys(await appStatsMod.getAppStats()).length).toEqual(0);
});

// ============ v10.2.0：XDGAME 列表布局自定义（油猴脚本移植） ============
const xdgrid = await import(new URL('../../content/list/xdgrid.js', import.meta.url).href + '?t=' + Date.now());

test('v10.4.0：xdgrid computeContainerStyle——固定宽度模式（容器随列数加宽）', () => {
  const css = xdgrid.computeContainerStyle({ cols: 6, iconW: 258, iconH: 0, gap: 18 });
  expect(css).toContain('display:grid');
  expect(css).toContain('repeat(6, 258px)');
  expect(css).toContain('width:' + (6 * 258 + 5 * 18 + 36) + 'px');
  expect(css).toContain('gap:18px');
});

test('v10.4.0：xdgrid computeContainerStyle——自适应压缩模式', () => {
  const css = xdgrid.computeContainerStyle({ cols: 8, iconW: 0, iconH: 0, gap: 10 });
  expect(css).toContain('repeat(8, minmax(0, 1fr))');
  expect(css).not.toContain('width:');
});

test('v10.4.0：xdgrid migrateLegacy——旧扁平配置迁移为按站点且默认启用', () => {
  const legacy = { cols: 4, iconW: 200, iconH: 0, gap: 12 };
  const migrated = xdgrid.migrateLegacy(legacy, 'www.xdgame.com');
  expect(migrated.sites['www.xdgame.com'].enabled).toEqual(true);
  expect(migrated.sites['www.xdgame.com'].cols).toEqual(4);
  // 新形状原样返回
  const modern = { sites: { a: { enabled: true, cols: 3 } } };
  expect(xdgrid.migrateLegacy(modern, 'b.com')).toEqual(modern);
  // 空输入 → 空站点表
  expect(xdgrid.migrateLegacy(null, 'x.com').sites).toEqual({});
});

test('v10.4.0：xdgrid commonAncestor——公共祖先与 disjoint', () => {
  const mk = (tag) => {
    const el = { tagName: tag, parentNode: null, children: [] };
    return el;
  };
  const parent = mk('UL');
  const a = mk('LI');
  const b = mk('LI');
  a.parentNode = parent;
  b.parentNode = parent;
  expect(xdgrid.commonAncestor([a, b])).toEqual(parent);
  // 无公共祖先 → null
  const other = mk('DIV');
  const c = mk('LI');
  c.parentNode = other;
  expect(xdgrid.commonAncestor([a, c])).toEqual(null);
});

// ============ v10.3.0：a-b 统计开关 + 去重窗口可调 ============
const settingsModWiring = await import(
  new URL('../../background/core/settings.js', import.meta.url).href + '?t=' + Date.now()
);

test('v10.3.0：appStatsEnabled=false → 不计数且读取为空（其余功能不受影响）', async () => {
  storage._reset();
  appStatsMod.resetAppStats();
  await settingsModWiring.saveSettings({ appStatsEnabled: false }); // deepMerge 自动补默认
  expect(await appStatsMod.recordAppDownload('730', 'xdgame')).toEqual(false);
  await appStatsMod.recordAppDetailView('730', 'xdgame');
  expect(await appStatsMod.getAppStats()).toEqual({}); // 读取也为空（徽章/信号无数据）
  // 重新开启 → 恢复计数
  await settingsModWiring.saveSettings({ appStatsEnabled: true });
  expect(await appStatsMod.recordAppDownload('730', 'xdgame')).toEqual(true);
  const stats = await appStatsMod.getAppStats(['730']);
  expect(stats['730'] && stats['730'].downloads).toEqual(1);
});

test('v10.3.0：appStatDedupHours=0 → 关闭去重（同站重复也计数）', async () => {
  storage._reset();
  appStatsMod.resetAppStats();
  await settingsModWiring.saveSettings({ appStatDedupHours: 0 });
  await appStatsMod.recordAppDownload('730', 'xdgame');
  await appStatsMod.recordAppDownload('730', 'xdgame');
  await appStatsMod.recordAppDownload('730', 'xdgame');
  const stats = await appStatsMod.getAppStats(['730']);
  expect(stats['730'].downloads).toEqual(3);
  // 恢复默认 24h 窗口 → 同站重复被去重
  await settingsModWiring.saveSettings({ appStatDedupHours: 24 });
  await appStatsMod.recordAppDownload('888', 'xdgame');
  await appStatsMod.recordAppDownload('888', 'xdgame');
  const stats2 = await appStatsMod.getAppStats(['888']);
  expect(stats2['888'].downloads).toEqual(1);
});
