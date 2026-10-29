/**
 * 游戏雷达 Game Radar - 测试：L2 站特清洗覆盖（第八轮批次 4）
 *
 * applyTitleCleaningOverride 纯函数：stripPrefix 前缀段剥除（3DM"【汉化组】"
 * 型）/ noiseWordsExtra 站点词汇清洗 / 无覆盖零变化 / 正则元字符安全。
 * L2 title-cleaning override pure function tests.
 */
import { describe, test, expect } from 'vitest';
import { applyTitleCleaningOverride } from '../../content/core/common.js';

describe('L2 站特清洗覆盖（批次 4）', () => {
  test('stripPrefix：前缀段整段剥除（含连续重复）', () => {
    expect(applyTitleCleaningOverride('【汉化组】艾尔登法环', { stripPrefix: ['【汉化组】'] })).toEqual('艾尔登法环');
    expect(applyTitleCleaningOverride('【汉化组】【3DM】某游戏', { stripPrefix: ['【汉化组】', '【3DM】'] })).toEqual(
      '某游戏'
    );
    // 非前缀位置不剥（只在行首）
    expect(applyTitleCleaningOverride('某游戏【汉化组】版', { stripPrefix: ['【汉化组】'] })).toEqual(
      '某游戏【汉化组】版'
    );
  });

  test('noiseWordsExtra：站点词汇清洗（正则元字符安全）', () => {
    expect(applyTitleCleaningOverride('某游戏 激活码激活教程 免安装', { noiseWordsExtra: ['激活码激活教程'] })).toEqual(
      '某游戏 免安装'
    );
    // 元字符词不崩（escapeRe 防线）
    expect(applyTitleCleaningOverride('某游戏 C++++ 版', { noiseWordsExtra: ['C++++'] })).toEqual('某游戏 版');
  });

  test('无覆盖/空覆盖零变化', () => {
    expect(applyTitleCleaningOverride('某游戏', null)).toEqual('某游戏');
    expect(applyTitleCleaningOverride('某游戏', {})).toEqual('某游戏');
    expect(applyTitleCleaningOverride('', { stripPrefix: ['x'] })).toEqual('');
  });
});
