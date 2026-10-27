/**
 * 游戏雷达 Game Radar - 测试：检索词表（golden 等价 + 校验 + 行为抽查）
 *
 * v14.6.3 R1：shared/retrieval-vocab.js 是检索规则词表单源——本套件三重门禁：
 * 1. golden 等价：编译正则源与 R1 前的代码字面量**逐字节一致**（防迁移失真，
 *    含保序语义——重叠词 Switch520.com/Switch520 的删除范围依赖顺序）；
 * 2. 校验：validateRetrievalVocab 对当前词表返回空错误数组；
 * 3. 行为抽查：噪声清洗/附属识别/尾段剥离语义不变（错题库回放另见
 *    test-mismatch-samples.mjs）。
 * Golden equivalence (compiled sources byte-identical to pre-R1 literals),
 * vocab validation, and behavior spot checks for the retrieval vocab.
 */
import { describe, test, expect } from 'vitest';
import { RETRIEVAL_VOCAB, validateRetrievalVocab, getCompiledRetrievalRules } from '../../shared/retrieval-vocab.js';

// ============ golden：R1 前的字面量（迁移基准，勿修改） ============
// Legacy literals (the migration baseline; do not edit these strings).

// @ts-nocheck - golden 基准串含正则片段，String.raw 原样保留反斜杠
const GOLDEN_NOISE_SOURCE = String.raw`中文|汉化|破解|免安装|绿色|学习|未加密|完整版|豪华版|豪华|终极|数字|典藏|年度|重制|复刻|增强|正式|官方|简繁|简体|繁体|中英|多语言|特别版|标准版|支持者版|解压即撸|预购特典|预购|特典|抢先试玩|抢先体验|抢先|试玩|体验版|修改器|加速器|作弊|全季票|季票|顶置|置顶|汇总贴|汇总|索引|爆火|热门|版|v[\d.]+|V[\d.]+|\d+\.\d+[\d.]*|Build[.\s]*\d+|update\s*\d+|DLC.*|全DLC|整合|硬盘|免DVD|CODEX|FLT|RELOADED|SKIDROW|EMPRESS|GOG|Razor1911|FitGirl|\d+\s*GB|百度网盘|网盘|下载|游戏下载|免费下载|迅雷|磁力|BT|种子|支持手柄|手柄|支持|新游发布|免安装绿色版|Switch520\.com|Switch520|520\.com|\s+The\s+Game\s*`;

const GOLDEN_ADDON_SOURCE = String.raw`\bdemo\b|试玩|\btrial\b|prologue|序章|序幕|\bsoundtrack\b|\bost\b|\bartbook\b|\bdlc\b|supporter pack|支持者包|fan pack|wallpaper|screenshot|原声带|美术集|设定集|艺术集|画集|壁纸|原画集|收藏版|内容包|扩展包|追加内容|组合包`;

const GOLDEN_DEMO_SOURCE = String.raw`\bdemo\b|试玩|\btrial\b`;

const GOLDEN_JUNK_SOURCE = String.raw`豪华|解压即撸|预购特典|预购|特典|中文|汉化|破解|免安装|绿色|完整版|豪华版|终极|修改器|加速器|作弊|全季票|季票|pc|vr|3d|hd|build[.\s]*\d+|\d+[\d.]*|v[\d.]+`;

const GOLDEN_TAIL_WORDS = '下载|游戏下载|免费下载|破解版|汉化版|中文版|绿色版|免安装';

describe('检索词表 golden 等价', () => {
  const rules = getCompiledRetrievalRules();

  test('中文标题噪声序列与旧字面量逐字节一致（保序）', () => {
    expect(rules.noisePattern.source).toEqual(GOLDEN_NOISE_SOURCE);
    expect(rules.noisePattern.flags).toEqual('i');
    expect(rules.noisePatternAll.source).toEqual(GOLDEN_NOISE_SOURCE);
    expect(rules.noisePatternAll.flags).toEqual('gi');
  });

  test('附属内容关键词与旧字面量逐字节一致（\\b 形态保真）', () => {
    expect(rules.addonNamePattern.source).toEqual(GOLDEN_ADDON_SOURCE);
    expect(rules.addonNamePattern.flags).toEqual('i');
  });

  test('Demo 标识与旧字面量逐字节一致', () => {
    expect(rules.demoNamePattern.source).toEqual(GOLDEN_DEMO_SOURCE);
    expect(rules.demoNamePattern.flags).toEqual('i');
  });

  test('候选垃圾词与旧字面量逐字节一致（^$ 锚定）', () => {
    expect(rules.junkCandidatePattern.source).toEqual(`^(?:${GOLDEN_JUNK_SOURCE})$`);
    expect(rules.junkCandidatePattern.flags).toEqual('i');
  });

  test('尾段剥离词与旧字面量一致', () => {
    expect(rules.titleTailStripPattern.source).toEqual(`(?:${GOLDEN_TAIL_WORDS}).*$`);
    expect(rules.titleTailStripPattern.flags).toEqual('i');
  });

  test('EN 噪声词/版本词/版本后缀对照与旧集合一致', () => {
    expect([...rules.noiseEnWords].sort()).toEqual(['build', 'crack', 'full', 'plus', 'repack', 'update']);
    expect([...rules.editionWords].sort()).toEqual(
      [
        'edition',
        'enhanced',
        'deluxe',
        'upgrade',
        'remastered',
        'remaster',
        'definitive',
        'complete',
        'goty',
        'bundle',
        'collection',
        'demo',
        'trial'
      ].sort()
    );
    expect(rules.versionSuffixes).toEqual([
      ['增强版', 'Enhanced'],
      ['重制版', 'Remastered'],
      ['复刻版', 'Remake'],
      ['豪华版', 'Deluxe'],
      ['终极版', 'Ultimate'],
      ['年度版', 'Game of the Year'],
      ['典藏版', 'Collector'],
      ['黄金版', 'Gold']
    ]);
  });
});

describe('检索词表校验', () => {
  test('当前词表合法（validateRetrievalVocab 返回空）', () => {
    expect(validateRetrievalVocab()).toEqual([]);
  });

  test('词表结构与键完备', () => {
    expect(RETRIEVAL_VOCAB.version).toEqual(1);
    for (const key of [
      'noiseTitle',
      'noiseEnWords',
      'junkCandidateWords',
      'titleTailStripWords',
      'versionSuffixes',
      'addonKeywords',
      'demoKeywords',
      'editionWords'
    ]) {
      expect(Array.isArray(RETRIEVAL_VOCAB[key]) && RETRIEVAL_VOCAB[key].length > 0, `${key} 非空`).toBe(true);
    }
  });
});

describe('检索词表行为抽查', () => {
  const rules = getCompiledRetrievalRules();

  test('噪声正则：命中修饰词，放过正常游戏名', () => {
    expect(rules.noisePattern.test('官方中文')).toBe(true);
    expect(rules.noisePattern.test('FitGirl Repack')).toBe(true);
    expect(rules.noisePattern.test('Build.22898177')).toBe(true);
    expect(rules.noisePattern.test('Elden Ring')).toBe(false);
    expect(rules.noisePattern.test('Ghost of Tsushima')).toBe(false);
  });

  test('附属/Demo 正则：\\b 边界防误伤（ghost/demons 非附属）', () => {
    expect(rules.addonNamePattern.test('Hollow Knight: DLC 包')).toBe(true);
    expect(rules.addonNamePattern.test('Silksong Original Soundtrack')).toBe(true);
    expect(rules.addonNamePattern.test('Ghost of Tsushima')).toBe(false);
    expect(rules.addonNamePattern.test('Postman Pat')).toBe(false); // post 不因 dlc/prologue 误伤
    expect(rules.demoNamePattern.test('试玩版')).toBe(true);
    expect(rules.demoNamePattern.test('Demon Souls')).toBe(false); // \bdemo\b 不咬 Demons
  });

  test('尾段剥离：剥 "|中文版|免安装" 类尾段（与旧版同形）', () => {
    expect('生化危机4|中文版'.replace(rules.titleTailStripPattern, '').trim()).toEqual('生化危机4|');
    expect('模拟人生4|免安装'.replace(rules.titleTailStripPattern, '').trim()).toEqual('模拟人生4|');
    expect('Elden Ring'.replace(rules.titleTailStripPattern, '').trim()).toEqual('Elden Ring');
  });

  test('junk 过滤：单 token 垃圾候选被 ^$ 锚定命中', () => {
    expect(rules.junkCandidatePattern.test('豪华')).toBe(true);
    expect(rules.junkCandidatePattern.test('Build.22898177')).toBe(true);
    expect(rules.junkCandidatePattern.test('3d')).toBe(true);
    expect(rules.junkCandidatePattern.test('艾尔登法环')).toBe(false);
    expect(rules.junkCandidatePattern.test('Elden Ring')).toBe(false);
  });
});
