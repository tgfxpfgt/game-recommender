/**
 * 游戏雷达 Game Radar - 测试：api-search 纯函数字符化快照 / Frozen pure-function snapshot
 *
 * v14.27.0（优化方案 P2-10）：拆分 api-search.js 前先锁定纯函数输出（相关性/
 * 评分/跨界/共识输入），拆分后重跑本套件必须逐值一致；导出面（Object.keys）
 * 一并锁定——api-search.js 只做编排与 re-export，对外 import 路径不变。
 * Frozen snapshot taken BEFORE the P2-10 file split; re-running after the split
 * must produce identical values (byte-identical output requirement).
 */

import { test, expect } from 'vitest';

const api = await import('../../background/steam/api-search.js');

// [resultName, term, rawName, related, digit, match, variant, score, dice, crossover, seq, tokens]
const CASES = [
  // prettier-ignore
  ['Resident Evil 4', '生化危机4', '生化危机4 重制版', true, true, true, true, 2, -1, false, ['4'], ['resident', 'evil']],
  [
    'Resident Evil Requiem',
    '生化危机9',
    '生化危机9 安魂曲',
    true,
    true,
    true,
    true,
    1,
    -1,
    false,
    [],
    ['resident', 'evil', 'requiem']
  ],
  [
    'Cyberpunk 2077',
    '赛博朋克2077',
    '赛博朋克2077 豪华版',
    true,
    true,
    true,
    true,
    2,
    -1,
    false,
    ['2077'],
    ['cyberpunk']
  ],
  [
    'PC Building Simulator',
    'PC Building Simulator 2',
    'PC Building Simulator 2',
    true,
    true,
    false,
    false,
    6,
    -1,
    false,
    [],
    ['building', 'simulator']
  ],
  [
    'Dead Space 2',
    '死亡空间：重制版',
    '死亡空间：重制版 PC中文版',
    true,
    true,
    false,
    false,
    0,
    -1,
    false,
    ['2'],
    ['dead', 'space']
  ],
  [
    '黎明杀机-寂静岭',
    '寂静岭',
    '寂静岭：陨落小镇 豪华版',
    true,
    true,
    true,
    false,
    6,
    0.26666666666666666,
    true,
    [],
    ['黎明杀机', '寂静岭']
  ],
  [
    'Jrago III 夜之安魂曲',
    '安魂曲',
    '生化危机9 安魂曲',
    false,
    true,
    true,
    false,
    4,
    -1,
    true,
    [],
    ['夜之安魂曲', 'jrago']
  ],
  [
    'Grand Theft Auto V Enhanced',
    '侠盗猎车手V 增强版',
    '侠盗猎车手V 增强版',
    true,
    true,
    false,
    false,
    0,
    -1,
    false,
    [],
    ['grand', 'theft', 'auto', 'enhanced']
  ],
  ['Gunner, HEAT, PC!', 'PC', 'PC Building Simulator', false, true, false, false, 1, -1, false, [], ['gunner', 'heat']],
  ['F1 2024', '英雄连2 2024版', '英雄连2 2024版', true, true, false, false, 0, -1, false, ['1'], []],
  [
    'The Witcher 3: Wild Hunt',
    '巫师3',
    '巫师3：狂猎 年度版',
    true,
    true,
    true,
    true,
    2,
    -1,
    false,
    ['3'],
    ['witcher', 'wild', 'hunt']
  ],
  ['Elden Ring', '艾尔登法环', '艾尔登法环 中文版', true, true, false, false, 0, -1, false, [], ['elden', 'ring']]
];

test('P2-10：纯函数输出与拆分前快照逐值一致', () => {
  for (const [resultName, term, rawName, related, digit, match, variant, score, dice, cross, seq, tokens] of CASES) {
    const label = `${resultName} / ${term} / ${rawName}`;
    expect({ label, v: api.namesRelated(rawName, resultName) }).toEqual({ label, v: related });
    expect({ label, v: api.digitSetsOverlap(rawName, resultName) }).toEqual({ label, v: digit });
    expect({ label, v: api.nameMatchesSearch(resultName, term, rawName) }).toEqual({ label, v: match });
    expect({ label, v: api.nameMatchesSearchVariant(resultName, term, rawName) }).toEqual({ label, v: variant });
    expect({ label, v: api.matchCandidateScore(resultName, term, rawName) }).toEqual({ label, v: score });
    expect({ label, v: api.cjkBigramDice(rawName, resultName) }).toEqual({ label, v: dice });
    expect({ label, v: api.isCrossoverEntry(resultName, term, rawName) }).toEqual({ label, v: cross });
    expect({ label, v: api.seqNumsOf(resultName) }).toEqual({ label, v: seq });
    expect({ label, v: api.coreTokensOf(resultName) }).toEqual({ label, v: tokens });
  }
});

test('P2-10：候选类型排序输出稳定', () => {
  const ranked = api.rankCandidatesByType([
    { id: 1, name: 'A', type: 'dlc' },
    { id: 2, name: 'B', type: 'game' },
    { id: 3, name: 'C', type: 'music' },
    { id: 4, name: 'D', type: 'software' }
  ]);
  expect(ranked).toEqual([
    { id: 2, name: 'B', type: 'game' },
    { id: 4, name: 'D', type: 'software' }
  ]);
});

test('P2-10：对外导出面不变（拆分只移动实现，re-export 保持路径兼容）', () => {
  expect(Object.keys(api).sort()).toEqual([
    'ADDON_NAME_PATTERN',
    'DEMO_NAME_PATTERN',
    'cjkBigramDice',
    'coreTokensOf',
    'digitSetsOverlap',
    'fetchSteamTagRecommendations',
    'findVersionVariant',
    'isCrossoverEntry',
    'matchCandidateScore',
    'nameMatchesSearch',
    'nameMatchesSearchVariant',
    'namesRelated',
    'rankCandidatesByType',
    'reloadRetrievalRules',
    'searchCommunityApps',
    'searchSteamAppId',
    'seqNumsOf'
  ]);
});
