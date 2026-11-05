/**
 * 游戏雷达 Game Radar - 测试：O6 错题库运行时锚点 / Runtime anchor replay tests
 *
 * v14.16.0：①内置词表下 5 锚点回放全过（基线）②漂移门禁：shared 锚点快照
 * 与 tests/fixtures/mismatch-samples.json 单源一致（id/expectedAppId/kind）③
 * 毒包演练：词表噪声词吞掉正主词 → replay 红（导入门的拒包依据）。
 * Baseline replay, fixture drift gate, and poison-vocab drill.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sb = { globalThis: {} };
vm.createContext(sb);
vm.runInContext(readFileSync(path.join(ROOT, 'shared/mismatch-anchors.js'), 'utf-8'), sb);
const anchorsMod = sb.globalThis.__GR_MISMATCH_ANCHORS__;
const { parseGameTitle } = await import('../../background/core/title-parser.js');
const api = await import('../../background/steam/api-search.js');

const fns = {
  parseGameTitle,
  nameMatchesSearch: api.nameMatchesSearch,
  matchCandidateScore: api.matchCandidateScore
};

describe('O6 错题库运行时锚点（导入回放门数据面）', () => {
  test('内置词表基线：5/5 锚点回放通过', () => {
    const r = anchorsMod.replay(fns);
    expect(r.failed).toEqual([]);
    expect(r.passed).toEqual(5);
  });

  test('漂移门禁：shared 锚点与 fixtures 单源一致（id/expectedAppId/kind）', () => {
    const fixtures = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/mismatch-samples.json'), 'utf-8'));
    const fx = fixtures.samples;
    expect(anchorsMod.anchors.length).toEqual(fx.length);
    for (let i = 0; i < fx.length; i++) {
      expect(anchorsMod.anchors[i].id).toEqual(fx[i].id);
      expect(String(anchorsMod.anchors[i].expectedAppId)).toEqual(String(fx[i].expectedAppId));
      expect(anchorsMod.anchors[i].kind).toEqual(fx[i].kind || 'miss');
    }
  });

  test('回放门判红能力：劣化的检索函数集 → replay 红（导入门拒包依据）', async () => {
    // 形态说明（实测两轮）：'新增噪声词'与'替换噪声序列'两类毒包已被
    // applyVocabOverride 的 PROTECTIVE_TITLES 双防线（新增噪声词命中锚点
    // 标题即拒 + junk diff 残留词判新增）拦截——运行时防线比 O6 设计时
    // 预期更强。本用例验证回放门自身对劣化形态的判红能力（handler 接线后
    // 任何让 replay 红的词表都会整包拒绝）。
    const poisonParse = (t) => (t.indexOf('寂静岭') >= 0 ? [] : ['垃圾词']); // hard-miss 锚点被毒化
    const r1 = anchorsMod.replay({ ...fns, parseGameTitle: poisonParse });
    expect(r1.failed.some((f) => f.id.indexOf('silenthill') >= 0)).toEqual(true);
    const r2 = anchorsMod.replay({ ...fns, matchCandidateScore: () => 0 }); // 评分归零形态
    expect(r2.failed.length).toEqual(4); // 4 个 miss 锚点全红（hard-miss 不依赖评分）
  });
});
