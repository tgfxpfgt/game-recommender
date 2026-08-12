/**
 * Game Recommender - 测试：报错纠正记录（v3.3.13）/ Wrong-Report Corrections
 *
 * recordWrongReport / lookupWrongReportCorrection：记录、合并更新、纠正知识
 * 查询、count 累计。OPFS 探测失败 → 降级 chrome.storage.local（mock）。
 */
'use strict';

import { createReporter } from './helpers/assert.mjs';
const reporter = createReporter();
const { check } = reporter;
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// chrome.storage mock（OPFS 不可用 → dataStore 降级 storage.local）
const storageData = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        const out = {};
        for (const k of Array.isArray(keys) ? keys : [keys]) out[k] = storageData[k];
        return out;
      },
      set: async (obj) => Object.assign(storageData, obj),
      remove: async (keys) => { for (const k of Array.isArray(keys) ? keys : [keys]) delete storageData[k]; }
    }
  }
};

const mod = await import(new URL('../background/storage/wrong-reports.js', import.meta.url).href + '?t=' + Date.now());

// 1. 记录报错样本
console.log('1. 报错记录 recordWrongReport');
mod.resetWrongReports();
await mod.recordWrongReport('北方之魂增强版/Spirit of the North- Switch520.com', { wrongAppId: 2001760, source: 'report' });
await mod.flushWrongReports();
let corr = await mod.lookupWrongReportCorrection('北方之魂增强版/Spirit of the North- Switch520.com');
check('仅报错（无纠正）不返回纠正', corr, null);

// 2. 记录纠正样本（手动选择确认正确 appid）
console.log('2. 纠正记录（手动确认）');
await mod.recordWrongReport('北方之魂增强版/Spirit of the North- Switch520.com', { correctAppId: 1213700, source: 'manual' });
await mod.flushWrongReports();
corr = await mod.lookupWrongReportCorrection('北方之魂增强版/Spirit of the North- Switch520.com');
check('纠正知识返回正确 appid', corr && corr.correctAppId, '1213700');
check('纠正知识携带错误 appid（黑名单）', corr && corr.wrongAppId, '2001760');

// 3. 再次报错 → count 累计、错误 appid 更新
console.log('3. count 累计与字段合并');
await mod.recordWrongReport('北方之魂增强版/Spirit of the North- Switch520.com', { wrongAppId: 730, source: 'report' });
await mod.flushWrongReports();
corr = await mod.lookupWrongReportCorrection('北方之魂增强版/Spirit of the North- Switch520.com');
check('count 累计为 3（report+manual+report）', (await mod.getWrongReportsMemory()).get('北方之魂增强版/Spirit of the North- Switch520.com').count, 3);
check('错误 appid 更新为最近一次', corr && corr.wrongAppId, '730');
check('纠正 appid 保留', corr && corr.correctAppId, '1213700');

// 4. 无记录标题 / 空输入
console.log('4. 边界');
check('无记录返回 null', await mod.lookupWrongReportCorrection('不存在游戏'), null);
check('空标题不记录', await mod.recordWrongReport('', { wrongAppId: 1 }), undefined);
check('持久化（重新加载后仍存在）', await (async () => {
  mod.resetWrongReports();
  const c = await mod.lookupWrongReportCorrection('北方之魂增强版/Spirit of the North- Switch520.com');
  return c ? c.correctAppId : null;
})(), '1213700');

console.log('\n===== 报错纠正记录测试结果 =====');
const finalResult = reporter.getResult();
console.log(finalResult.pass + ' 通过, ' + finalResult.fail + ' 失败');

// 导出结果供 run-tests.js 聚合 / Export results for the test runner
export const testResult = reporter.getResult();
