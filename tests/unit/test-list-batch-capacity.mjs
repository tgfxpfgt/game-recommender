/**
 * 游戏雷达 Game Radar - list-batch 批次容量解析单测
 *
 * v10.7.1 缺口6 回归：settings.ratingsBatchSize 注入与 10-200 钳制
 * （resolveBatchCapacity 纯函数——非法/越界值回退默认 60）。
 */
import { describe, it, expect } from 'vitest';
import { resolveBatchCapacity } from '../../content/list/list-batch.js';

describe('resolveBatchCapacity（批次容量钳制）', () => {
  it('界内值原样通过（含向下取整）', () => {
    expect(resolveBatchCapacity(60)).toEqual(60);
    expect(resolveBatchCapacity(10)).toEqual(10);
    expect(resolveBatchCapacity(200)).toEqual(200);
    expect(resolveBatchCapacity(60.9)).toEqual(60);
  });
  it('越界/非法值回退默认 60', () => {
    expect(resolveBatchCapacity(9)).toEqual(60);
    expect(resolveBatchCapacity(201)).toEqual(60);
    expect(resolveBatchCapacity(0)).toEqual(60);
    expect(resolveBatchCapacity(-5)).toEqual(60);
    expect(resolveBatchCapacity('abc')).toEqual(60);
    expect(resolveBatchCapacity(undefined)).toEqual(60);
    expect(resolveBatchCapacity(null)).toEqual(60);
  });
});
