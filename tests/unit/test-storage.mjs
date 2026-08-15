import { test, expect, describe, beforeAll } from 'vitest';
/**
 * 游戏雷达 Game Radar - 测试：存储层 / Storage Layer Tests
 *
 * v4.2.0：吸收原 test-wrong-reports（报错纠正知识库）+ 新增
 * learned-noise（阈值 3 生效）/ registry（记录与查询）/ behavior（500 上限
 * 与画像计数）/ settings deepMerge（权重 backfill）。统一使用
 * helpers/storage-mock.mjs（消除旧重复 chrome mock）。
 * v6.1.1：wrong-reports/learned-noise 节结构化——每 test 自包含准备
 *（check 线性脚本的顶层流程在 vitest 收集阶段全部提前执行，断言运行阶段
 * 读到最终状态；准备移入各 test 后检查点语义恢复）。
 */
('use strict');

import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';

// OPFS 不可用 → dataStore 降级 chrome.storage.local（统一 mock）
const storage = createStorageMock();
const restoreChrome = installChromeStorageMock(storage);

const wrongMod = await import(
  new URL('../../background/storage/wrong-reports.js', import.meta.url).href + '?t=' + Date.now()
);
const noiseMod = await import(
  new URL('../../background/storage/learned-noise.js', import.meta.url).href + '?t=' + Date.now()
);
const regMod = await import(new URL('../../background/storage/registry.js', import.meta.url).href + '?t=' + Date.now());
const behMod = await import(new URL('../../background/storage/behavior.js', import.meta.url).href + '?t=' + Date.now());
const setMod = await import(new URL('../../background/core/settings.js', import.meta.url).href + '?t=' + Date.now());

test('仅报错（无纠正）不返回纠正', async () => {
  storage._reset();
  wrongMod.resetWrongReports();
  await wrongMod.recordWrongReport('游戏A', { wrongAppId: 2001760, source: 'report' });
  await wrongMod.flushWrongReports();
  expect(await wrongMod.lookupWrongReportCorrection('游戏A')).toEqual(null);
});
test('纠正知识返回正确 appid', async () => {
  storage._reset();
  wrongMod.resetWrongReports();
  await wrongMod.recordWrongReport('游戏A', { wrongAppId: 2001760, source: 'report' });
  await wrongMod.recordWrongReport('游戏A', { correctAppId: 1213700, source: 'manual' });
  await wrongMod.flushWrongReports();
  const corr = await wrongMod.lookupWrongReportCorrection('游戏A');
  expect(corr && corr.correctAppId).toEqual('1213700');
});
test('纠正知识携带错误 appid（黑名单）', async () => {
  storage._reset();
  wrongMod.resetWrongReports();
  await wrongMod.recordWrongReport('游戏A', { wrongAppId: 2001760, source: 'report' });
  await wrongMod.recordWrongReport('游戏A', { correctAppId: 1213700, source: 'manual' });
  await wrongMod.flushWrongReports();
  const corr = await wrongMod.lookupWrongReportCorrection('游戏A');
  expect(corr && corr.wrongAppId).toEqual('2001760');
});
test('count 累计为 3', async () => {
  storage._reset();
  wrongMod.resetWrongReports();
  await wrongMod.recordWrongReport('游戏A', { wrongAppId: 2001760, source: 'report' });
  await wrongMod.recordWrongReport('游戏A', { correctAppId: 1213700, source: 'manual' });
  await wrongMod.recordWrongReport('游戏A', { wrongAppId: 730, source: 'report' });
  await wrongMod.flushWrongReports();
  expect((await wrongMod.getWrongReportsMemory()).get('游戏A').count).toEqual(3);
});
test('无记录返回 null', async () => {
  storage._reset();
  wrongMod.resetWrongReports();
  expect(await wrongMod.lookupWrongReportCorrection('不存在游戏')).toEqual(null);
});
test('持久化（重置后从存储恢复）', async () => {
  storage._reset();
  wrongMod.resetWrongReports();
  await wrongMod.recordWrongReport('游戏A', { wrongAppId: 2001760, source: 'report' });
  await wrongMod.recordWrongReport('游戏A', { correctAppId: 1213700, source: 'manual' });
  await wrongMod.flushWrongReports();
  wrongMod.resetWrongReports();
  expect((await wrongMod.lookupWrongReportCorrection('游戏A')).correctAppId).toEqual('1213700');
});

test('达到阈值 3 的词生效', async () => {
  storage._reset();
  noiseMod.resetLearnedNoise();
  await noiseMod.recordNoiseCandidates(['抢先版', '抢先版', '抢先版']);
  expect((await noiseMod.getActiveNoiseWords()).includes('抢先版')).toEqual(true);
});
test('未达阈值的词不生效', async () => {
  storage._reset();
  noiseMod.resetLearnedNoise();
  await noiseMod.recordNoiseCandidates(['稀有词', '稀有词']); // 未达阈值
  expect((await noiseMod.getActiveNoiseWords()).includes('稀有词')).toEqual(false);
});
test('累计达标后生效', async () => {
  storage._reset();
  noiseMod.resetLearnedNoise();
  await noiseMod.recordNoiseCandidates(['稀有词', '稀有词']);
  await noiseMod.recordNoiseCandidates(['稀有词']); // 第三次 → 达阈值
  expect((await noiseMod.getActiveNoiseWords()).includes('稀有词')).toEqual(true);
});
test('重置后计数归零（单次不生效）', async () => {
  storage._reset();
  noiseMod.resetLearnedNoise();
  await noiseMod.recordNoiseCandidates(['新词']);
  expect((await noiseMod.getActiveNoiseWords()).includes('新词')).toEqual(false);
});

test('注册表记录名称', async () => {
  regMod.resetRegistry();
  await regMod.recordGameInRegistry('275850', {
    cnName: '无人深空',
    enName: "No Man's Sky",
    gameName: '无人深空',
    tags: ['开放世界']
  });
  await regMod.flushRegistry();
  const regEntry = await regMod.getGameRegistryEntry('275850');
  expect(regEntry && regEntry.cnName).toEqual('无人深空');
});
test('注册表记录标签', async () => {
  regMod.resetRegistry();
  await regMod.recordGameInRegistry('275850', {
    cnName: '无人深空',
    enName: "No Man's Sky",
    gameName: '无人深空',
    tags: ['开放世界']
  });
  await regMod.flushRegistry();
  const regEntry = await regMod.getGameRegistryEntry('275850');
  expect(regEntry && regEntry.tags[0]).toEqual('开放世界');
});
test('无记录返回 null', async () => {
  regMod.resetRegistry();
  expect(await regMod.getGameRegistryEntry('999999')).toEqual(null);
});

test('行为日志 500 上限裁剪', async () => {
  for (let i = 0; i < 510; i++)
    await behMod.addBehaviorLog({ type: 'view_detail', gameName: `游戏${i % 3}`, timestamp: Date.now() + i });
  const log = await behMod.getBehaviorLog();
  expect(log.length).toEqual(500);
});
test('裁剪保留最新（末条为最后写入）', async () => {
  for (let i = 0; i < 510; i++)
    await behMod.addBehaviorLog({ type: 'view_detail', gameName: `游戏${i % 3}`, timestamp: Date.now() + i });
  const log = await behMod.getBehaviorLog();
  expect(log[log.length - 1].gameName).toEqual('游戏2');
});
await behMod.updateGameProfile({ name: '无人深空', event: 'view' });
await behMod.updateGameProfile({ name: '无人深空', event: 'download' });

const defaults = {
  weights: { clickRate: 0.15, downloadRate: 0.3, keywordMatch: 0.2, steamRating: 0.15, playTime: 0.1, heat: 0.1 },
  llmConfig: { provider: 'local', apiKey: '', temperature: 0.3 }
};
test('旧设置缺新权重键 → 自动补默认', () => {
  expect(JSON.stringify(setMod.deepMergeSettings(defaults, { weights: { clickRate: 0.2 } }).weights)).toEqual(
    JSON.stringify({ ...defaults.weights, clickRate: 0.2 })
  );
});
test('类型不一致的畸形值 → 保留默认', () => {
  expect(setMod.deepMergeSettings(defaults, { weights: { playTime: '0.5' } }).weights.playTime).toEqual(0.1);
});
test('null 存储 → 返回默认', () => {
  expect(JSON.stringify(setMod.deepMergeSettings(defaults, null))).toEqual(JSON.stringify(defaults));
});
test('嵌套对象深合并', () => {
  expect(setMod.deepMergeSettings(defaults, { llmConfig: { temperature: 0.7 } }).llmConfig.temperature).toEqual(0.7);
});
test('undefined 值跳过', () => {
  expect(setMod.deepMergeSettings(defaults, { weights: { heat: undefined } }).weights.heat).toEqual(0.1);
});
test('新增键保留', () => {
  expect(setMod.deepMergeSettings(defaults, { maxScanLinks: 1000 }).maxScanLinks).toEqual(1000);
});

// 注：不 restore chrome——learned-noise 等模块的防抖写入可能延迟到恢复后
// 才触发（与旧 test-wrong-reports 行为一致；run-tests 后续套件各自安装）

// ============ 并入：设置深路径工具（v6.4.11，v7.0.5 合并自 test-settings-utils） ============
import '../../shared/settings-utils.js';
const utils = globalThis.__GR_SETTINGS_UTILS__;
const { deepSet, getByPath, applyPatch } = utils;

describe('settings-utils deepSet', () => {
  test('点号路径深写入已存在嵌套 / deep set into existing nested object', () => {
    const obj = { badgeVisibility: { recent: true, all: true }, llmConfig: { provider: 'local' } };
    deepSet(obj, 'badgeVisibility.recent', false);
    expect(obj.badgeVisibility.recent).toBe(false);
    expect(obj.badgeVisibility.all).toBe(true); // 兄弟字段不受影响
    expect(Object.keys(obj)).not.toContain('badgeVisibility.recent'); // 不残留字面量键
  });

  test('中间层不存在时自动创建 / intermediate objects are created', () => {
    const obj = {};
    deepSet(obj, 'llmConfig.endpoint', 'http://localhost:11434');
    expect(obj.llmConfig.endpoint).toBe('http://localhost:11434');
    expect(obj.llmConfig).toEqual({ endpoint: 'http://localhost:11434' });
  });

  test('单层键等同普通赋值 / single-level key behaves like plain assign', () => {
    const obj = { enabled: true };
    deepSet(obj, 'enabled', false);
    expect(obj.enabled).toBe(false);
  });

  test('三层路径 / three-level path', () => {
    const obj = {};
    deepSet(obj, 'a.b.c', 42);
    expect(obj.a.b.c).toBe(42);
  });
});

describe('settings-utils getByPath', () => {
  test('读取嵌套值 / read nested value', () => {
    const obj = { llmConfig: { temperature: 0.3 } };
    expect(getByPath(obj, 'llmConfig.temperature')).toBe(0.3);
  });

  test('缺失路径返回 fallback / missing path returns fallback', () => {
    expect(getByPath({}, 'a.b.c', 7)).toBe(7);
    expect(getByPath(null, 'a.b', 'x')).toBe('x');
  });

  test('值为 undefined 时返回 fallback / undefined value falls back', () => {
    expect(getByPath({ a: undefined }, 'a', 1)).toBe(1);
  });
});

describe('settings-utils applyPatch', () => {
  test('点号键与普通键混合合并 / dotted and plain keys merge together', () => {
    const obj = { enabled: true, badgeVisibility: { recent: true } };
    applyPatch(obj, { enabled: false, 'badgeVisibility.recent': false, 'llmConfig.model': 'qwen2.5:7b' });
    expect(obj.enabled).toBe(false);
    expect(obj.badgeVisibility.recent).toBe(false);
    expect(obj.llmConfig.model).toBe('qwen2.5:7b');
    // 不得残留字面量点号键 / no literal dotted keys remain
    expect(Object.keys(obj)).not.toContain('badgeVisibility.recent');
    expect(Object.keys(obj)).not.toContain('llmConfig.model');
  });

  test('空补丁不改变对象 / empty patch is a no-op', () => {
    const obj = { a: 1 };
    applyPatch(obj, {});
    expect(obj).toEqual({ a: 1 });
  });
});

// ============ 并入：详情页网址索引（v7.0.2，v7.0.5 合并自 test-url-index） ============
const idxMod = await import(new URL('../../background/storage/url-index.js', import.meta.url).href);

describe('url-index 详情页网址索引（v7.0.2，v7.0.5 合并自 test-url-index）', () => {
  beforeAll(() => {
    storage._reset({});
    idxMod.resetUrlIndex();
  });

  test('set 后 get 命中', async () => {
    await idxMod.setUrlAppId('https://www.gamer520.com/109515.html', 3764200);
    expect(await idxMod.getAppIdByUrl('https://www.gamer520.com/109515.html')).toEqual(3764200);
  });

  test('URL 规范化：hash/query 不影响命中（同一页面同一缓存）', async () => {
    expect(await idxMod.getAppIdByUrl('https://www.gamer520.com/109515.html#comment')).toEqual(3764200);
    expect(await idxMod.getAppIdByUrl('https://www.gamer520.com/109515.html?from=nav')).toEqual(3764200);
  });

  test('无记录返回 null', async () => {
    expect(await idxMod.getAppIdByUrl('https://www.gamer520.com/999999.html')).toEqual(null);
    expect(await idxMod.getAppIdByUrl('')).toEqual(null);
  });

  test('覆盖更新：同一 URL 重新匹配后指向新 appId', async () => {
    await idxMod.setUrlAppId('https://www.gamer520.com/109515.html', 4021140);
    expect(await idxMod.getAppIdByUrl('https://www.gamer520.com/109515.html')).toEqual(4021140);
    await idxMod.setUrlAppId('https://www.gamer520.com/109515.html', 3764200);
  });

  test('reset 清空', async () => {
    idxMod.resetUrlIndex();
    expect(await idxMod.getAppIdByUrl('https://www.gamer520.com/109515.html')).toEqual(null);
  });
});

// ============ 并入：备份管理（v6.3.0，v7.0.5 合并自 test-backups） ============
const backups = await import(new URL('../../background/storage/backups.js', import.meta.url).href);

describe('备份管理', () => {
  test('创建全量备份（含数据快照与密钥剔除）', async () => {
    storage._reset({
      settings: { enabled: true, maxBackups: 7, llmConfig: { provider: 'local', apiKey: 'sk-secret' } },
      behaviorLog: [{ t: 1000, type: 'view_detail', gameName: '游戏A' }]
    });
    const backup = await backups.createBackup(false);
    expect(!!backup && !!backup.id).toEqual(true);
    expect(backup.manual).toEqual(false);
    expect(backup.modules.includes('settings')).toEqual(true);
    // 密钥剔除：备份数据中 apiKey 为空
    expect(backup.data.settings.llmConfig.apiKey).toEqual('');
    // 原始存储不受影响（仅备份副本剔除）
    expect(storage._dump().settings.llmConfig.apiKey).toEqual('sk-secret');
    expect(backup.data.behaviorLog.length).toEqual(1);
  });

  test('勾选模块备份（moduleKeys 过滤）', async () => {
    storage._reset({ behaviorLog: [{ t: 1 }], gameRegistry: { a: 1 } });
    const backup = await backups.createBackup(true, ['behaviorLog']);
    expect(backup.modules).toEqual(['behaviorLog']);
    expect(backup.data.behaviorLog).toBeDefined();
    expect(backup.data.gameRegistry).toBeUndefined();
  });

  test('备份数量上限裁剪（maxBackups）', async () => {
    storage._reset({ settings: { enabled: true }, behaviorLog: [{ t: 1 }] });
    // settings 有内存缓存，用 saveSettings 走业务路径更新 maxBackups
    const setMod = await import(new URL('../../background/core/settings.js', import.meta.url).href);
    await setMod.saveSettings({ enabled: true, maxBackups: 3 });
    for (let i = 0; i < 5; i++) await backups.createBackup(false);
    const list = await backups.getBackupList();
    expect(list.length).toEqual(3);
  });

  test('恢复备份（安全网备份 + 数据还原）', async () => {
    storage._reset({
      settings: { enabled: true, maxBackups: 7 },
      behaviorLog: [{ t: 1000, type: 'view_detail', gameName: '游戏A' }],
      gameRegistry: { 275850: { cnName: '无人深空' } }
    });
    const backup = await backups.createBackup(false);
    // 修改数据
    await storage._data.set('behaviorLog', [{ t: 9999, type: 'view_detail', gameName: '被改' }]);
    const restored = await backups.restoreBackup(backup.id);
    expect(restored.success).toEqual(true);
    const log = storage._dump().behaviorLog;
    expect(log[0].gameName).toEqual('游戏A'); // 已还原
    // 安全网备份已创建（恢复前的状态被保护）
    const list = await backups.getBackupList();
    expect(list.length >= 2).toEqual(true);
  });

  test('恢复不存在的备份返回失败', async () => {
    storage._reset({ settings: { enabled: true, maxBackups: 7 } });
    const r = await backups.restoreBackup('no-such-id');
    expect(r.success).toEqual(false);
  });

  test('删除备份', async () => {
    storage._reset({ settings: { enabled: true, maxBackups: 7 }, behaviorLog: [{ t: 1 }] });
    const backup = await backups.createBackup(false);
    const r = await backups.deleteBackup(backup.id);
    expect(r.success).toEqual(true);
    const list = await backups.getBackupList();
    expect(list.find((b) => b.id === backup.id)).toBeUndefined();
  });
});

// ============ v7.1.0：缓存命中率分模块统计 ============
console.log('9b. 分模块缓存命中率 getCacheStats');
test('getSteamCacheEntry 带 moduleKey 按模块计数', async () => {
  storage._reset({});
  const scMod = await import(
    new URL('../../background/storage/steam-cache.js', import.meta.url).href + '?t=' + Date.now()
  );
  await scMod.setSteamCacheEntry('100', { appId: 100, name: '测试', positiveRate: 90 });
  await scMod.flushSteamCache();
  // 命中 rating 模块（positiveRate 属 rating 模块）
  const hit = await scMod.getSteamCacheEntry('100', 'rating');
  expect(!!hit).toEqual(true);
  const stats = scMod.getCacheStats();
  expect(stats.modules.rating.hits).toEqual(1);
  expect(stats.modules.rating.misses).toEqual(0);
  // 未命中 rating 模块
  await scMod.getSteamCacheEntry('999', 'rating');
  const stats2 = scMod.getCacheStats();
  expect(stats2.modules.rating.misses).toEqual(1);
  // 不带 moduleKey → 全局计数
  await scMod.getSteamCacheEntry('100');
  const stats3 = scMod.getCacheStats();
  expect(stats3.hits).toEqual(1);
  expect(stats3.modules.rating.hits).toEqual(1); // 分模块不受全局影响
});
