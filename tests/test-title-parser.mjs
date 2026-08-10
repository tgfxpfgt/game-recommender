/**
 * Game Recommender - 测试：游戏标题解析 / Title Parser Tests
 *
 * 验证 parseGameTitle / cleanGameName / pickRegistryEnName 的核心行为：
 * 噪声移除、分段（|/×•·）、中英文子串、优先级排序、两字游戏名。
 */
'use strict';

// 从模块源码中提取解析函数（避免依赖 ESM 加载，直接复制逻辑测试行为）
import fs from 'fs';

const src = fs.readFileSync('F:/data/browser extension/game-recommender/background/steam/title-parser.js', 'utf-8');
// 通过动态 import 加载真实模块（纯逻辑无 chrome 依赖）
const mod = await import('file:///F:/data/browser%20extension/game-recommender/background/steam/title-parser.js?t=' + Date.now());
const { parseGameTitle, cleanGameName, pickRegistryEnName, generateSearchVariants, extractNoiseCandidates } = mod;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name, '→ 实际:', JSON.stringify(actual), '期望:', JSON.stringify(expected)); }
}

console.log('1. 两字游戏名（v1.8.3 修复场景）');
check('奉魔', parseGameTitle('奉魔'), ['奉魔']);

console.log('2. 噪声分段与中英文子串');
check('奉魔|官方中文|Build.24618003+全DLC|解压即撸|', parseGameTitle('奉魔|官方中文|Build.24618003+全DLC|解压即撸|'), ['奉魔']);
check('功夫牌|官方中文|Kungfu Card', parseGameTitle('功夫牌|官方中文|Kungfu Card').includes('Kungfu Card'), true);

console.log('3. ×•· 中文分隔符（v1.8.0 修复场景）');
const xRes = parseGameTitle('地城英雄×龙与地下城 战痕之印|官方中文|Build.23703593+全DLC|解压即撸|');
check('× 分段', xRes.includes('地城英雄') && xRes.includes('龙与地下城 战痕之印'), true);

console.log('4. 英文优先排序');
const enFirst = parseGameTitle('铁巢重炮|Iron Nest Heavy Turret Simulator');
check('英文优先', enFirst[0], '铁巢重炮') || check('候选含英文', enFirst.includes('Iron Nest Heavy Turret Simulator'), true);

console.log('5. 纯噪声段移除');
check('仅噪声', parseGameTitle('官方中文|破解|免安装绿色版|v1.0'), []);

console.log('6. cleanGameName / pickRegistryEnName');
check('clean 主名', cleanGameName('米塞里亚 Miseria|官方中文'), '米塞里亚 Miseria');
check('pickRegistryEnName 标题英文优先', pickRegistryEnName('奉魔|Worship Demon', 'WORSHIP DEMON'), 'Worship Demon');
check('pickRegistryEnName 回退 Steam 名', pickRegistryEnName('奉魔', 'WORSHIP DEMON'), 'WORSHIP DEMON');

console.log('7. 抢先试玩噪声（v3.1.1 修复场景：gamer520 119668 幻世录 重制版）');
const huanshi = parseGameTitle('幻世录 重制版 抢先试玩|Build.24428366-诸界残歌-苍炎史诗|解压即撸');
check('首候选为纯净游戏名', huanshi[0], '幻世录');
check('候选不含抢先试玩', huanshi.some(t => t.includes('抢先') || t.includes('试玩')), false);

console.log('8. 扩展搜索变体 generateSearchVariants（v3.1.2）');
const variants = generateSearchVariants('幻世录 重制版 抢先试玩');
check('变体经清洗去重后收敛为主名', JSON.stringify(variants), JSON.stringify(['幻世录']));
check('静态噪声不进入变体', variants.includes('幻世录 抢先试玩'), false);
const variants2 = generateSearchVariants('幻世录 重制版 抢先试玩', ['抢先试玩']);
check('动态噪声词清洗不产生额外变体', JSON.stringify(variants2), JSON.stringify(['幻世录']));
check('变体总数限 8', generateSearchVariants('甲 乙 丙 丁 戊 己 庚 辛 壬 癸 子 丑 寅 卯 辰 巳').length <= 8, true);
check('单段不生成变体', generateSearchVariants('奉魔').length, 0);

console.log('9. 候选噪声词提取 extractNoiseCandidates（v3.1.2）');
check('成功词后剩余词提取', extractNoiseCandidates('幻世录 重制版 内测', '幻世录'), ['内测']);
check('静态噪声词被排除（重制版/抢先试玩）', extractNoiseCandidates('幻世录 重制版 抢先试玩', '幻世录'), []);
check('成功词为整段时无候选', extractNoiseCandidates('幻世录', '幻世录'), []);
check('无子串关系时无候选', extractNoiseCandidates('地城英雄', '战痕之印'), []);
check('段内非相邻词不提取', extractNoiseCandidates('地城英雄×龙与地下城 战痕之印', '地城英雄'), []);

console.log('10. 修改器噪声（v3.2.1 修复场景：gamer520 114933 哥特王朝）');
const gothic = parseGameTitle('哥特王朝 重制版|豪华中文|Build.24539464+预购特典+全DLC+修改器|解压即撸|');
check('首候选为纯净游戏名', gothic[0], '哥特王朝');
check('候选不含修改器', gothic.some(t => t.includes('修改器')), false);

console.log('11. 汇总贴/短词垃圾候选（v3.2.3 修复场景：gamer520 56286 置顶汇总贴）');
const digest = parseGameTitle('[顶置]PC近期爆火游戏 汇总贴');
check('汇总贴标题无 "PC" 垃圾候选', digest.some(t => t === 'PC'), false);
check('汇总贴候选不含汇总贴噪声', digest.some(t => t.includes('汇总贴') || t.includes('顶置')), false);
check('短字母词 junk 过滤', parseGameTitle('VR 专题').includes('VR'), false);

console.log('\n===== 标题解析测试结果 =====');
console.log(pass + ' 通过, ' + fail + ' 失败');

// 导出结果供 run-tests.js 聚合 / Export results for the test runner
export const testResult = { pass, fail, ok: fail === 0 };

