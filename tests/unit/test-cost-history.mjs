import { test, expect } from 'vitest';
/**
 * 游戏雷达 Game Radar - 测试：测试开销历史与异常发现 / Test Cost History Tests
 *
 * v14.28.11（用户指令 2026-11-12）：gate 步骤耗时历史（gitignored jsonl）+
 * 滚动中位数异常告警——拦静态预算 cap 之下的缓慢漂移。本套件锁纯函数语义：
 * 中位数 / 可判定条件（样本数、噪声下限、失败运行排除）/ 1.5× 异常阈值 /
 * 记录写入（可注入路径）。
 */
import {
  median,
  analyzeStepCost,
  recordStepCost,
  readCostHistory,
  ANOMALY_RATIO
} from '../../scripts/test-cost-history.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('median：奇数/偶数/空数组', () => {
  expect(median([3, 1, 2])).toEqual(2);
  expect(median([4, 1, 2, 3])).toEqual(2.5);
  expect(median([])).toEqual(0);
});

test('analyzeStepCost：样本不足 5 条不可判定', () => {
  const h = [80, 82, 81, 83].map((ms) => ({ step: 'coverage:gate（新增文件行覆盖）', ms: ms * 1000, code: 0 }));
  const r = analyzeStepCost('coverage:gate（新增文件行覆盖）', 90 * 1000, h);
  expect(r.analyzable).toEqual(false);
});

test('analyzeStepCost：失败运行（code≠0）不入中位数样本', () => {
  const ok = [80, 82, 81, 83, 80].map((ms) => ({ step: 'visual（视觉回归）', ms: ms * 1000, code: 0 }));
  const bad = { step: 'visual（视觉回归）', ms: 300 * 1000, code: 1 };
  const r = analyzeStepCost('visual（视觉回归）', 82 * 1000, [...ok, bad]);
  expect(r.analyzable).toEqual(true);
  expect(r.anomaly).toEqual(false); // 失败巨慢样本被排除，中位数仍 ~81s
});

test(`analyzeStepCost：超过 ${ANOMALY_RATIO}× 中位数即异常`, () => {
  const h = [80, 82, 81, 83, 80].map((ms) => ({ step: 'E2E 冒烟（MOCK 离线）', ms: ms * 1000, code: 0 }));
  const hot = analyzeStepCost('E2E 冒烟（MOCK 离线）', 130 * 1000, h); // 中位数 81s，130s ≈ 1.60×
  expect(hot.analyzable).toEqual(true);
  expect(hot.anomaly).toEqual(true);
  const normal = analyzeStepCost('E2E 冒烟（MOCK 离线）', 90 * 1000, h); // ≈1.11×
  expect(normal.anomaly).toEqual(false);
});

test('analyzeStepCost：中位数低于 10s 噪声下限不判定', () => {
  const h = [2, 2, 2, 2, 2].map((ms) => ({ step: 'lint', ms: ms * 1000, code: 0 }));
  const r = analyzeStepCost('lint', 8 * 1000, h); // 4× 于 2s 中位数，但低于噪声下限
  expect(r.analyzable).toEqual(false);
});

test('recordStepCost/readCostHistory：追加可读回 + 损坏行容错', () => {
  // v14.31.3（CodeQL insecure-temporary-file）：可预测文件名加随机段防碰撞/劫持
  const tmp = path.join(os.tmpdir(), `gr-costs-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`);
  try {
    fs.writeFileSync(tmp, '{"broken json\n', 'utf-8'); // 预置损坏行
    recordStepCost('fast', 'lint', 1234, 0, tmp);
    recordStepCost('fast', 'lint', 2345, 1, tmp);
    const rows = readCostHistory(tmp);
    expect(rows.length).toEqual(2);
    expect(rows[0]).toEqual({ ts: expect.any(Number), mode: 'fast', step: 'lint', ms: 1234, code: 0 });
    expect(rows[1].code).toEqual(1);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});
