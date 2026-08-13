import { test, expect } from 'vitest';
/**
 * 游戏雷达 Game Radar - 测试：推荐算法 / Recommendation Engine Tests
 *
 * v3.2.8：验证 appId 维度个性化评分——不同游戏的推荐值不同，
 * 行为信号/标签匹配/好评率/中文支持各分量正确，画像查找兼容名称变体。
 * v4.0.0：新增 SteamSpy 时长/热度分量（playTimeScore/heatScore）与六项权重。
 */
'use strict';


const mod = await import(new URL('../../background/recommend/engine.js', import.meta.url).href + '?t=' + Date.now());
const { computeGameScore, findProfile, calculateKeywordScore, steamspyScores } = mod;

// v4.0.0：六项权重（与 DEFAULT_SETTINGS 默认一致，和 1.0）
const W = { clickRate: 0.15, downloadRate: 0.3, keywordMatch: 0.2, steamRating: 0.15, playTime: 0.1, heat: 0.1 };
const base = { globalStats: { maxViews: 10, maxDownloads: 5 }, keywordWeights: {}, weights: W };

console.log('1. 个性化差异：不同游戏推荐值不同');
// 高活跃：看过 8 次、下载 4 次、好评率 90%、有中文
const hot = computeGameScore({
  ...base,
  profile: { views: 8, downloads: 4 },
  positiveRate: 90,
  chineseSupported: true
});
// 冷门：无行为、无好评率、无中文
const cold = computeGameScore({ ...base, profile: null, positiveRate: null, chineseSupported: false });
test('高活跃游戏分数高于冷门游戏', () => { expect(hot.score > cold.score).toEqual(true); });
test('高活跃 breakdown 行为分量非零', () => { expect(hot.breakdown.clickScore > 0 && hot.breakdown.downloadScore > 0).toEqual(true); });
test('冷门游戏行为分量为零', () => { expect(cold.breakdown.clickScore === 0 && cold.breakdown.downloadScore === 0).toEqual(true); });

console.log('2. 信号分量');
const tags = computeGameScore({
  ...base,
  profile: { views: 5, downloads: 2 },
  tags: ['动作', '角色扮演'],
  keywordWeights: { 动作: 0.9, 角色扮演: 0.5 },
  positiveRate: 80,
  chineseSupported: true
});
test('标签匹配得分 > 无标签中性值(0.3)', () => { expect(tags.breakdown.keywordScore > 0.3).toEqual(true); });
const noTags = computeGameScore({
  ...base,
  profile: { views: 5, downloads: 2 },
  tags: null,
  positiveRate: 80,
  chineseSupported: true
});
test('无标签中性 0.3', () => { expect(noTags.breakdown.keywordScore).toEqual(0.3); });
const cnGame = computeGameScore({ ...base, profile: null, positiveRate: 100, chineseSupported: true });
const enGame = computeGameScore({ ...base, profile: null, positiveRate: 100, chineseSupported: false });
test('好评率满分+中文 = 1.0', () => { expect(cnGame.breakdown.steamScore).toEqual(1); });
test('好评率满分无中文 = 0.7', () => { expect(enGame.breakdown.steamScore).toEqual(0.7); });
test('无好评率中性 0.4', () => { expect(computeGameScore({ ...base, profile: null, positiveRate: null }).breakdown.steamScore).toEqual(0.4); });
test('评分在 0-1 区间（六项权重和 1.0）', () => { expect(hot.score >= 0 && hot.score <= 1).toEqual(true); });

console.log('2b. SteamSpy 时长/热度信号（v4.0.0）');
test('无 spy 数据 → 双中性 0.3', () => { expect(steamspyScores(null)).toEqual({ playTimeScore: 0.3, heatScore: 0.3 }); });
test('空对象 → 双中性 0.3', () => { expect(steamspyScores({})).toEqual({ playTimeScore: 0.3, heatScore: 0.3 }); });
test('时长 600 分钟封顶 1.0', () => { expect(steamspyScores({ averageForeverMin: 600, ownersLow: 1, ownersHigh: 2 }).playTimeScore).toEqual(1); });
test('时长 300 分钟 = 0.5', () => { expect(steamspyScores({ averageForeverMin: 300 }).playTimeScore).toEqual(0.5); });
test('热度千万封顶 1.0', () => { expect(steamspyScores({ ownersLow: 10000000, ownersHigh: 10000000 }).heatScore).toEqual(1); });
test('热度 10 万 ≈ 0.714', () => { expect(Math.round(steamspyScores({ ownersLow: 100000, ownersHigh: 100000 }).heatScore * 1000) / 1000).toEqual(0.714); });
test('非法数值忽略（回中性）', () => { expect(steamspyScores({ averageForeverMin: 'x', ownersLow: 'y' })).toEqual({
  playTimeScore: 0.3,
  heatScore: 0.3
}); });
const spyGame = computeGameScore({
  ...base,
  profile: null,
  positiveRate: null,
  playTimeScore: 1,
  heatScore: 1
});
const noSpyGame = computeGameScore({ ...base, profile: null, positiveRate: null });
test('有时长/热度数据的游戏分数高于缺数据游戏', () => { expect(spyGame.score > noSpyGame.score).toEqual(true); });
test('满分时长/热度分量进入 breakdown', () => { expect(spyGame.breakdown.playTimeScore).toEqual(1); });
test('缺数据 breakdown 中性 0.3', () => { expect(noSpyGame.breakdown.heatScore).toEqual(0.3); });

console.log('3. 画像查找 findProfile（名称变体兼容）');
const profiles = {
  '生化女神 : 末日开端/bio goddess : doomsday begins': { views: 6, downloads: 3 },
  奉魔: { views: 2, downloads: 1 },
  '角斗士公会经理/gladiator guild manager': { views: 4, downloads: 2 }
};
test('精确名匹配', () => { expect(findProfile(profiles, '奉魔', null) === profiles['奉魔']).toEqual(true); });
test('清洗名匹配（列表完整标题 → 画像记录名）', () => { expect(findProfile(profiles, '角斗士公会经理/Gladiator Guild Manager', null) ===
    profiles['角斗士公会经理/gladiator guild manager']).toEqual(true); });
test('注册表变体匹配', () => { expect(findProfile(profiles, '角斗士公会经理', { names: ['角斗士公会经理/gladiator guild manager'] }) ===
    profiles['角斗士公会经理/gladiator guild manager']).toEqual(true); });
test('模糊包含匹配', () => { expect(findProfile(profiles, '生化女神 末日开端|完整版', null) ===
    profiles['生化女神 : 末日开端/bio goddess : doomsday begins']).toEqual(true); });
test('无匹配返回 null', () => { expect(findProfile(profiles, '不存在的游戏', null)).toEqual(null); });



// ============ 6. 不感兴趣负信号（v6.3.2 C3） ============
console.log('6. 不感兴趣负信号（disliked 归零）');
test('disliked 画像 → 推荐归零', () => {
  const r = mod.computeGameScore({
    profile: { views: 100, downloads: 50, disliked: true },
    globalStats: { maxViews: 200, maxDownloads: 100 },
    tags: ['RPG'],
    keywordWeights: { RPG: 1 },
    positiveRate: 95,
    chineseSupported: true,
    weights: { clickRate: 0.15, downloadRate: 0.3, keywordMatch: 0.2, steamRating: 0.15, playTime: 0.1, heat: 0.1 },
    playTimeScore: 0.9,
    heatScore: 0.8
  });
  expect(r.score).toEqual(0);
  expect(r.method).toEqual('disliked');
});
test('未标记 disliked → 正常评分不受影响', () => {
  const r = mod.computeGameScore({
    profile: { views: 100, downloads: 50 },
    globalStats: { maxViews: 200, maxDownloads: 100 },
    tags: ['RPG'],
    keywordWeights: { RPG: 1 },
    positiveRate: 95,
    chineseSupported: true,
    weights: { clickRate: 0.15, downloadRate: 0.3, keywordMatch: 0.2, steamRating: 0.15, playTime: 0.1, heat: 0.1 },
    playTimeScore: 0.9,
    heatScore: 0.8
  });
  expect(r.score).toBeGreaterThan(0);
});

// ============ 7. LLM 评分缓存（v6.4.3） ============
console.log('7. LLM 评分缓存（7d TTL）');
import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';

const llmStorage = createStorageMock({ settings: { enabled: true, useLLM: true } });
installChromeStorageMock(llmStorage);

test('LLM 评分缓存命中（二次调用不再请求 LLM）', async () => {
  llmStorage._reset({ settings: { enabled: true, useLLM: true, llmConfig: { provider: 'local', endpoint: 'http://localhost:11434/api/generate', model: 'm', temperature: 0.3 } } });
  const lcMod = await import(new URL('../../background/storage/llm-cache.js', import.meta.url).href);
  lcMod.resetLlmCache();
  let llmCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    llmCalls++;
    return { ok: true, status: 200, json: async () => ({ response: '{"score": 0.8, "reason": "好评如潮"}' }), text: async () => '' };
  };
  try {
    const r1 = await mod.calculateRecommendation({ name: '缓存游戏' }, false, null);
    const r2 = await mod.calculateRecommendation({ name: '缓存游戏' }, false, null);
    expect(llmCalls).toEqual(1); // 第二次命中缓存
    expect(r1 && r1.score).toEqual(0.8);
    expect(r2 && r2.score).toEqual(0.8);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ============ 8. 权重归一化（v6.4.10：权重和超 1 正常运行） ============
console.log('8. 权重归一化（权重和 > 1 → 按比例缩放）');
test('权重和 1.0 → 评分不变（默认语义）', () => {
  const r = mod.computeGameScore({
    profile: { views: 100, downloads: 50 },
    globalStats: { maxViews: 200, maxDownloads: 100 },
    tags: ['RPG'],
    keywordWeights: { RPG: 1 },
    positiveRate: 95,
    chineseSupported: true,
    weights: { clickRate: 0.15, downloadRate: 0.3, keywordMatch: 0.2, steamRating: 0.15, playTime: 0.1, heat: 0.1 },
    playTimeScore: 1,
    heatScore: 1
  });
  expect(r.score).toBeLessThanOrEqual(1);
});
test('权重和 2.0 → 归一化（评分不超 100%）', () => {
  const r = mod.computeGameScore({
    profile: { views: 100, downloads: 50 },
    globalStats: { maxViews: 200, maxDownloads: 100 },
    tags: ['RPG'],
    keywordWeights: { RPG: 1 },
    positiveRate: 95,
    chineseSupported: true,
    weights: { clickRate: 0.4, downloadRate: 0.4, keywordMatch: 0.4, steamRating: 0.4, playTime: 0.2, heat: 0.2 }, // 和 2.0
    playTimeScore: 1,
    heatScore: 1
  });
  expect(r.score).toBeLessThanOrEqual(1); // 归一后不超 1
  expect(r.score).toBeGreaterThan(0);
});
