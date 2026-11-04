/**
 * 游戏雷达 Game Radar - 测试：N5 纠正映射导出/导入 / Mappings export/import tests
 *
 * v14.15.0：importCorrections 逐条校验（appId 形态/双空拒绝/名称长度）+ 合并
 * upsert 语义（导入值优先、reportedAt 保留更早、count 取大）+ 导出形状。
 * Per-entry validation + merge-upsert semantics + export shape.
 */
import { describe, expect, test, beforeAll } from 'vitest';
import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';
import {
  exportAllCorrections,
  importCorrections,
  resetWrongReports,
  recordWrongReport,
  getWrongReportsMemory
} from '../../background/storage/wrong-reports.js';

beforeAll(() => {
  // 防抖落盘（scheduleWrite）在 Node 测试环境需要 chrome.storage 兜底
  installChromeStorageMock(createStorageMock());
});

describe('N5 纠正映射导入校验与合并（importCorrections）', () => {
  test('合法条目导入 + 形状归一（数字 appId 转字符串）', () => {
    resetWrongReports();
    const r = importCorrections({
      游戏A: { correctAppId: 1091500, wrongAppId: null, count: 2 },
      游戏B: { wrongAppId: '292030', correctAppId: null }
    });
    expect(r).toEqual({ imported: 2, rejected: 0 });
    const mem = getWrongReportsMemory();
    expect(mem.get('游戏A').correctAppId).toEqual('1091500');
    expect(mem.get('游戏B').wrongAppId).toEqual('292030');
  });

  test('拒绝形态：双空/非法 appId/超长名/非对象条目/数组入参', () => {
    resetWrongReports();
    const longName = 'x'.repeat(201);
    const r = importCorrections({
      双空: { wrongAppId: null, correctAppId: null },
      坏正: { correctAppId: 'abc' },
      坏错: { wrongAppId: '12345678901' },
      '': { correctAppId: '1091500' },
      [longName]: { correctAppId: '1091500' }
    });
    expect(r.rejected).toEqual(5);
    expect(r.imported).toEqual(0);
    expect(importCorrections([])).toEqual({ imported: 0, rejected: 0 }); // 数组入参
    expect(importCorrections(null)).toEqual({ imported: 0, rejected: 0 });
  });

  test('合并 upsert：导入值优先、count 取大、已有 reportedAt 保留', async () => {
    resetWrongReports();
    await recordWrongReport('游戏A', { correctAppId: '1111111', source: 'manual' });
    const before = getWrongReportsMemory().get('游戏A');
    importCorrections({ 游戏A: { correctAppId: '2222222', count: 99 } });
    const after = getWrongReportsMemory().get('游戏A');
    expect(after.correctAppId).toEqual('2222222'); // 导入值优先
    expect(after.count).toEqual(99); // count 取大
    expect(after.reportedAt).toEqual(before.reportedAt); // 保留更早
  });

  test('导出形状：键为游戏名、值为条目对象（roundtrip）', async () => {
    resetWrongReports();
    await recordWrongReport('游戏C', { correctAppId: '3333333', source: 'manual' });
    const exported = exportAllCorrections();
    expect(exported['游戏C'].correctAppId).toEqual('3333333');
    // roundtrip：清空 → 导入导出件 → 记录还原
    resetWrongReports();
    const r = importCorrections(exported);
    expect(r.imported).toEqual(1);
    expect(getWrongReportsMemory().get('游戏C').correctAppId).toEqual('3333333');
  });
});
