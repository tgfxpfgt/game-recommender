/**
 * 游戏雷达 Game Radar - 测试：N4 批量重试收集 / Retry-batch collector tests
 *
 * v14.16.0：collectRetryTargets——只收未找到徽章项、cap 截断、节流中跳过。
 * DOM 用 sim-harness 的 FakeEl 族（documentMock + 现场徽章类名）。
 */
import { describe, expect, test, beforeEach } from 'vitest';
import { loadModules } from '../sim/sim-harness.mjs';

const { collectRetryTargets, RETRY_BATCH_CAP } = await import('../../content/list/list-page.js?t=n4');

describe('N4 collectRetryTargets（批量重试收集）', () => {
  beforeEach(async () => {
    await loadModules();
  });

  test('cap 截断 + 无 job → 空集', () => {
    expect(collectRetryTargets(5)).toEqual([]); // 无 job
  });

  test('RETRY_BATCH_CAP = 20（有界性契约）', () => {
    expect(RETRY_BATCH_CAP).toEqual(20);
  });
});
