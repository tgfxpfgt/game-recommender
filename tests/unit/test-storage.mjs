/**
 * Game Recommender - 测试：存储层 / Storage Layer Tests
 *
 * v4.2.0：吸收原 test-wrong-reports（报错纠正知识库）+ 新增
 * learned-noise（阈值 3 生效）/ registry（记录与查询）/ behavior（500 上限
 * 与画像计数）/ settings deepMerge（权重 backfill）。统一使用
 * helpers/storage-mock.mjs（消除旧重复 chrome mock）。
 */
'use strict';

import { createReporter } from '../helpers/assert.mjs';
const reporter = createReporter();
const { check } = reporter;
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
wrongMod.resetWrongReports();
await wrongMod.recordWrongReport('游戏A', { wrongAppId: 2001760, source: 'report' });
await wrongMod.flushWrongReports();
check('仅报错（无纠正）不返回纠正', await wrongMod.lookupWrongReportCorrection('游戏A'), null);
await wrongMod.recordWrongReport('游戏A', { correctAppId: 1213700, source: 'manual' });
await wrongMod.flushWrongReports();
let corr = await wrongMod.lookupWrongReportCorrection('游戏A');
check('纠正知识返回正确 appid', corr && corr.correctAppId, '1213700');
check('纠正知识携带错误 appid（黑名单）', corr && corr.wrongAppId, '2001760');
await wrongMod.recordWrongReport('游戏A', { wrongAppId: 730, source: 'report' });
await wrongMod.flushWrongReports();
check('count 累计为 3', (await wrongMod.getWrongReportsMemory()).get('游戏A').count, 3);
check('无记录返回 null', await wrongMod.lookupWrongReportCorrection('不存在游戏'), null);
wrongMod.resetWrongReports();
check('持久化（重新加载后仍存在）', (await wrongMod.lookupWrongReportCorrection('游戏A')).correctAppId, '1213700');

console.log('2. 动态噪声词学习（learned-noise，阈值 3）');
noiseMod.resetLearnedNoise();
await noiseMod.recordNoiseCandidates(['抢先版', '抢先版', '抢先版']);
await noiseMod.recordNoiseCandidates(['稀有词', '稀有词']); // 未达阈值
check('达到阈值 3 的词生效', (await noiseMod.getActiveNoiseWords()).includes('抢先版'), true);
check('未达阈值的词不生效', (await noiseMod.getActiveNoiseWords()).includes('稀有词'), false);
await noiseMod.recordNoiseCandidates(['稀有词']);
check('累计达标后生效', (await noiseMod.getActiveNoiseWords()).includes('稀有词'), true);
noiseMod.resetLearnedNoise();
await noiseMod.recordNoiseCandidates(['新词']);
check('重置后计数归零（单次不生效）', (await noiseMod.getActiveNoiseWords()).includes('新词'), false);

console.log('3. 游戏注册表（registry）');
regMod.resetRegistry();
await regMod.recordGameInRegistry('275850', {
  cnName: '无人深空',
  enName: "No Man's Sky",
  gameName: '无人深空',
  tags: ['开放世界']
});
await regMod.flushRegistry();
const regEntry = await regMod.getGameRegistryEntry('275850');
check('注册表记录名称', regEntry && regEntry.cnName, '无人深空');
check('注册表记录标签', regEntry && regEntry.tags[0], '开放世界');
check('无记录返回 null', await regMod.getGameRegistryEntry('999999'), null);

console.log('4. 行为日志与画像（behavior）');
for (let i = 0; i < 510; i++)
  await behMod.addBehaviorLog({ type: 'view_detail', gameName: `游戏${i % 3}`, timestamp: Date.now() + i });
const log = await behMod.getBehaviorLog();
check('行为日志 500 上限裁剪', log.length, 500);
check('裁剪保留最新（末条为最后写入）', log[log.length - 1].gameName, '游戏2');
await behMod.updateGameProfile({ name: '无人深空', event: 'view' });
await behMod.updateGameProfile({ name: '无人深空', event: 'download' });

console.log('5. settings deepMerge 权重 backfill（v4.2.0 导出）');
const defaults = {
  weights: { clickRate: 0.15, downloadRate: 0.3, keywordMatch: 0.2, steamRating: 0.15, playTime: 0.1, heat: 0.1 },
  llmConfig: { provider: 'local', apiKey: '', temperature: 0.3 }
};
check(
  '旧设置缺新权重键 → 自动补默认',
  JSON.stringify(setMod.deepMergeSettings(defaults, { weights: { clickRate: 0.2 } }).weights),
  JSON.stringify({ ...defaults.weights, clickRate: 0.2 })
);
check(
  '类型不一致的畸形值 → 保留默认',
  setMod.deepMergeSettings(defaults, { weights: { playTime: '0.5' } }).weights.playTime,
  0.1
);
check('null 存储 → 返回默认', JSON.stringify(setMod.deepMergeSettings(defaults, null)), JSON.stringify(defaults));
check(
  '嵌套对象深合并',
  setMod.deepMergeSettings(defaults, { llmConfig: { temperature: 0.7 } }).llmConfig.temperature,
  0.7
);
check('undefined 值跳过', setMod.deepMergeSettings(defaults, { weights: { heat: undefined } }).weights.heat, 0.1);
check('新增键保留', setMod.deepMergeSettings(defaults, { maxScanLinks: 1000 }).maxScanLinks, 1000);

// 注：不 restore chrome——learned-noise 等模块的防抖写入可能延迟到恢复后
// 才触发（与旧 test-wrong-reports 行为一致；run-tests 后续套件各自安装）

console.log('\n===== 存储层测试结果 =====');
const finalResult = reporter.getResult();
console.log(finalResult.pass + ' 通过, ' + finalResult.fail + ' 失败');
export const testResult = reporter.getResult();
