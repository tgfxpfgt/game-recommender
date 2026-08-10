/**
 * Game Recommender - 测试：推荐算法 / Recommendation Engine Tests
 *
 * v3.2.8：验证 appId 维度个性化评分——不同游戏的推荐值不同，
 * 行为信号/标签匹配/好评率/中文支持各分量正确，画像查找兼容名称变体。
 */
'use strict';

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name, '→ 实际:', JSON.stringify(actual), '期望:', JSON.stringify(expected)); }
}

const mod = await import('file:///F:/data/browser%20extension/game-recommender/background/recommend/engine.js?t=' + Date.now());
const { computeGameScore, findProfile, calculateKeywordScore } = mod;

const W = { clickRate: 0.2, downloadRate: 0.35, keywordMatch: 0.25, steamRating: 0.2 };
const base = { globalStats: { maxViews: 10, maxDownloads: 5 }, keywordWeights: {}, weights: W };

console.log('1. 个性化差异：不同游戏推荐值不同');
// 高活跃：看过 8 次、下载 4 次、好评率 90%、有中文
const hot = computeGameScore({ ...base, profile: { views: 8, downloads: 4 }, positiveRate: 90, chineseSupported: true });
// 冷门：无行为、无好评率、无中文
const cold = computeGameScore({ ...base, profile: null, positiveRate: null, chineseSupported: false });
check('高活跃游戏分数高于冷门游戏', hot.score > cold.score, true);
check('高活跃 breakdown 行为分量非零', hot.breakdown.clickScore > 0 && hot.breakdown.downloadScore > 0, true);
check('冷门游戏行为分量为零', cold.breakdown.clickScore === 0 && cold.breakdown.downloadScore === 0, true);

console.log('2. 信号分量');
const tags = computeGameScore({ ...base, profile: { views: 5, downloads: 2 }, tags: ['动作', '角色扮演'], keywordWeights: { 动作: 0.9, 角色扮演: 0.5 }, positiveRate: 80, chineseSupported: true });
check('标签匹配得分 > 无标签中性值(0.3)', tags.breakdown.keywordScore > 0.3, true);
const noTags = computeGameScore({ ...base, profile: { views: 5, downloads: 2 }, tags: null, positiveRate: 80, chineseSupported: true });
check('无标签中性 0.3', noTags.breakdown.keywordScore, 0.3);
const cnGame = computeGameScore({ ...base, profile: null, positiveRate: 100, chineseSupported: true });
const enGame = computeGameScore({ ...base, profile: null, positiveRate: 100, chineseSupported: false });
check('好评率满分+中文 = 1.0', cnGame.breakdown.steamScore, 1);
check('好评率满分无中文 = 0.7', enGame.breakdown.steamScore, 0.7);
check('无好评率中性 0.4', computeGameScore({ ...base, profile: null, positiveRate: null }).breakdown.steamScore, 0.4);
check('评分在 0-1 区间', hot.score >= 0 && hot.score <= 1, true);

console.log('3. 画像查找 findProfile（名称变体兼容）');
const profiles = {
  '生化女神 : 末日开端/bio goddess : doomsday begins': { views: 6, downloads: 3 },
  '奉魔': { views: 2, downloads: 1 },
  '角斗士公会经理/gladiator guild manager': { views: 4, downloads: 2 }
};
check('精确名匹配', findProfile(profiles, '奉魔', null) === profiles['奉魔'], true);
check('清洗名匹配（列表完整标题 → 画像记录名）', findProfile(profiles, '角斗士公会经理/Gladiator Guild Manager', null) === profiles['角斗士公会经理/gladiator guild manager'], true);
check('注册表变体匹配', findProfile(profiles, '角斗士公会经理', { names: ['角斗士公会经理/gladiator guild manager'] }) === profiles['角斗士公会经理/gladiator guild manager'], true);
check('模糊包含匹配', findProfile(profiles, '生化女神 末日开端|完整版', null) === profiles['生化女神 : 末日开端/bio goddess : doomsday begins'], true);
check('无匹配返回 null', findProfile(profiles, '不存在的游戏', null), null);

console.log('\n===== 推荐算法测试结果 =====');
console.log(pass + ' 通过, ' + fail + ' 失败');

export const testResult = { pass, fail, ok: fail === 0 };
