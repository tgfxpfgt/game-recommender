import { describe, expect, it } from 'vitest';
import { normalizeTitleKey, parseTitleCandidates, titleSimilarity } from './titles.js';

describe('parseTitleCandidates', () => {
  it('书名号保留内容，括号注记剔除，英文名优先', () => {
    const cands = parseTitleCandidates('《艾尔登法环》|Elden Ring|v1.10|官方中文');
    expect(cands[0]).toMatch(/Elden Ring/i);
    expect(cands).toContain('艾尔登法环');
  });
  it('噪声段剔除（下载站惯用词）', () => {
    const cands = parseTitleCandidates('巫师3|免安装|绿色版|中文');
    expect(cands.join('|')).not.toMatch(/免安装|绿色版/);
    expect(cands).toContain('巫师3');
  });
});

describe('normalizeTitleKey', () => {
  it('全角转半角 + 小写 + 空白归一', () => {
    expect(normalizeTitleKey('ＡＢＣ　DEF')).toEqual('abc def');
  });
});

describe('titleSimilarity', () => {
  it('全词命中 = 1；零命中 = 0', () => {
    expect(titleSimilarity('Elden Ring', '艾尔登法环|Elden Ring|官方中文')).toEqual(1);
    expect(titleSimilarity('Elden Ring', '完全无关的名字')).toEqual(0);
  });
});
