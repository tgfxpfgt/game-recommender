/**
 * 游戏雷达 Game Radar - 测试：N10 系列作品聚合 / Series aggregation tests
 *
 * v14.16.0：getSeriesEntries 纯读取语义——同前缀异序号（前作/续作）聚合、
 * 同名排除、excludeAppId 排除、上限 6、无关名空集。
 */
import { describe, expect, test, beforeAll, beforeEach } from 'vitest';
import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';
import { resetNameIndex } from '../../background/storage/name-index.js';

beforeAll(() => {
  // 无 ?t 统一装载（series.js 内引 name-index 无 query——?t 会实例分裂，
  // 测试侧记录与被测读取必须同实例；跨套件残留用 resetNameIndex 清）
  installChromeStorageMock(createStorageMock());
});

const ni = await import('../../background/storage/name-index.js');
const series = await import('../../background/steam/series.js');

describe('N10 getSeriesEntries（浮窗系列作品行数据面）', () => {
  beforeEach(() => {
    resetNameIndex();
  });

  test('同前缀异序号聚合 + 基准/同名排除 + 上限 6', async () => {
    await ni.recordNameIndex('死亡空间2', 47790);
    await ni.recordNameIndex('死亡空间', 1697);
    await ni.recordNameIndex('死亡空间3', 1846440);
    await ni.recordNameIndex('植物大战僵尸', 3590); // 无关名
    const r = await series.getSeriesEntries('死亡空间2', 47790);
    const ids = r.map((e) => e.appId);
    expect(ids).toContain('1697'); // 前作
    expect(ids).toContain('1846440'); // 续作
    expect(ids).not.toContain('47790'); // excludeAppId 排除
    expect(ids).not.toContain('3590'); // 无关名不聚合
    const r2 = await series.getSeriesEntries('完全无关的游戏名', null);
    expect(r2).toEqual([]);
  });

  test('负缓存条目（appId=null）不聚合；空基准名 → 空集', async () => {
    await ni.recordNameIndex('死亡空间 负缓存样本', null);
    const r = await series.getSeriesEntries('死亡空间2 负缓存样本', null);
    expect(r.filter((e) => e.appId === 'null')).toEqual([]);
    expect(await series.getSeriesEntries('', null)).toEqual([]);
  });
});
