import { test, expect, describe } from 'vitest';
/**
 * 游戏雷达 Game Radar - 测试：占位/契约缺口门禁（v14.30.0 R4-D）
 *
 * 覆盖：占位标记识别（TODO/FIXME、显式"未实现"抛错）、正文里的"未实现"不算、
 * 豁免必须带原因文本、契约 action 提取与 handler 缺口判定。
 * Covers placeholder detection, reasonful exemptions, contract→handler gaps.
 */
import { findPlaceholders, stubReason, contractActions, missingHandlers } from '../../scripts/check-stubs.mjs';

describe('占位实现识别 / placeholder detection', () => {
  test('TODO / FIXME 单行注释命中', () => {
    const src = ['const a = 1;', '// TODO: 接入限流', '/* FIXME 待重构 */', 'const b = 2;'].join('\n');
    const hits = findPlaceholders(src);
    expect(hits.map((h) => h.line)).toEqual([2, 3]);
  });

  test('显式"未实现"抛错命中，正文叙述不命中', () => {
    const src = [
      '// 该工具文件从未实现（调用方守卫兜底）——历史说明，不是占位',
      "export function applyPageTheme() { throw new Error('applyPageTheme 未实现'); }"
    ].join('\n');
    const hits = findPlaceholders(src);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(2);
  });

  test('正常代码零命中', () => {
    expect(findPlaceholders('export const x = 1;\nfunction f() {\n  return x;\n}')).toEqual([]);
  });
});

describe('豁免标记 / exemption marker', () => {
  test('带原因文本才算豁免', () => {
    expect(stubReason('/** @stub-ok: 第三方接口下个版本接入 */')).toBe('第三方接口下个版本接入');
  });

  test('无原因文本 / 缺冒号 / 无标记都不算豁免', () => {
    expect(stubReason('/** @stub-ok: */')).toBe('');
    expect(stubReason('// @stub-ok 后续补')).toBe('');
    expect(stubReason('const a = 1;')).toBe('');
  });
});

describe('契约→handler 缺口 / contract gaps', () => {
  const contract = [
    'const buildRules = () => ({',
    '  TRACK_EVENT: trackEventRule,',
    '  SAVE_SETTINGS: (m) => ({ ok: true }),',
    '  NOT_IMPLEMENTED_ACTION: (m) => ({ ok: true })',
    '});'
  ].join('\n');

  test('提取两空格缩进的大写 action 键', () => {
    expect(contractActions(contract)).toEqual(['TRACK_EVENT', 'SAVE_SETTINGS', 'NOT_IMPLEMENTED_ACTION']);
  });

  test('有实现的不算缺口，无实现的才报', () => {
    const sources = [
      { file: 'background/handlers/x.js', text: 'export const h = { TRACK_EVENT: fn, SAVE_SETTINGS: fn };' }
    ];
    expect(missingHandlers(contractActions(contract), sources)).toEqual(['NOT_IMPLEMENTED_ACTION']);
  });

  test('无 buildRules 时返回空（不误报）', () => {
    expect(contractActions('export const x = 1;')).toEqual([]);
  });
});
