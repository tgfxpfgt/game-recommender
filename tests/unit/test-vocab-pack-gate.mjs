/**
 * 游戏雷达 Game Radar - 测试：R2 回放门（第八轮批次 2）
 *
 * 覆盖：①回放运行器在**内置词表**下全绿（运行器自身的健康自检）；②防护
 * 标题护栏——新增噪声词命中防护标题（错题库 rawTitle/官方名）时导入侧即
 * 拒绝（SW 内确定性防线）；③防护放行但会破坏回放的词——由 CI 侧回放运行
 * 器捕获（演示运行器的判别力）。
 * Replay-gate tests: runner healthy on built-in vocab, protective-title
 * rejection at import, and the CI runner's discriminative power.
 */
import { describe, test, expect } from 'vitest';
import { runMismatchReplay } from '../helpers/mismatch-replay.mjs';
import { applyVocabOverride, PROTECTIVE_TITLES, resetVocabOverride } from '../../shared/retrieval-vocab.js';
import * as apiSearch from '../../background/steam/api-search.js'; // api-search 无 default 导出——命名空间导入

describe('R2 回放门（批次 2）', () => {
  test('内置词表下错题库全绿（运行器自检）', async () => {
    const r = await runMismatchReplay();
    expect(r.allOk).toEqual(true);
    expect(r.results.length).toBeGreaterThanOrEqual(4);
  });

  test('防护标题护栏：新增噪声词命中防护标题 → 导入侧拒绝', () => {
    const errors = applyVocabOverride({
      version: 1,
      noiseTitle: [['w', '黑色行动']]
    });
    expect(errors.length).toEqual(1);
    expect(errors[0]).toContain('命中防护标题');
    expect(apiSearch.ADDON_NAME_PATTERN.source).not.toContain('黑色行动'); // 未生效
    resetVocabOverride();
  });

  test('防护放行的词进入后回放仍绿（护栏不误伤正常扩充）', async () => {
    const override = { version: 1, noiseTitle: [['w', '激活码激活教程']] }; // 不命中防护标题
    const errors = applyVocabOverride(override);
    expect(errors).toEqual([]);
    const r = await runMismatchReplay({ vocabOverride: override }); // runner 内应用+重置
    expect(r.allOk).toEqual(true);
  });

  test('防护标题表非空且含错题库现场（护栏盲区防线）', () => {
    expect(PROTECTIVE_TITLES.length).toBeGreaterThanOrEqual(6);
    expect(PROTECTIVE_TITLES.some((t) => t.includes('黑色行动'))).toEqual(true);
  });
});
