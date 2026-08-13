import { test, expect } from 'vitest';
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
'use strict';

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

console.log('1. 报错纠正知识库（wrong-reports，原 test-wrong-reports）');
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

console.log('2. 动态噪声词学习（learned-noise，阈值 3）');
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

console.log('3. 游戏注册表（registry）');
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

console.log('4. 行为日志与画像（behavior）');
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

console.log('5. settings deepMerge 权重 backfill（v4.2.0 导出）');
const defaults = {
  weights: { clickRate: 0.15, downloadRate: 0.3, keywordMatch: 0.2, steamRating: 0.15, playTime: 0.1, heat: 0.1 },
  llmConfig: { provider: 'local', apiKey: '', temperature: 0.3 }
};
test('旧设置缺新权重键 → 自动补默认', () => { expect(JSON.stringify(setMod.deepMergeSettings(defaults, { weights: { clickRate: 0.2 } }).weights)).toEqual(JSON.stringify({ ...defaults.weights, clickRate: 0.2 })); });
test('类型不一致的畸形值 → 保留默认', () => { expect(setMod.deepMergeSettings(defaults, { weights: { playTime: '0.5' } }).weights.playTime).toEqual(0.1); });
test('null 存储 → 返回默认', () => { expect(JSON.stringify(setMod.deepMergeSettings(defaults, null))).toEqual(JSON.stringify(defaults)); });
test('嵌套对象深合并', () => { expect(setMod.deepMergeSettings(defaults, { llmConfig: { temperature: 0.7 } }).llmConfig.temperature).toEqual(0.7); });
test('undefined 值跳过', () => { expect(setMod.deepMergeSettings(defaults, { weights: { heat: undefined } }).weights.heat).toEqual(0.1); });
test('新增键保留', () => { expect(setMod.deepMergeSettings(defaults, { maxScanLinks: 1000 }).maxScanLinks).toEqual(1000); });

// 注：不 restore chrome——learned-noise 等模块的防抖写入可能延迟到恢复后
// 才触发（与旧 test-wrong-reports 行为一致；run-tests 后续套件各自安装）
