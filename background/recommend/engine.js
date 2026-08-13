/**
 * 游戏雷达 Game Radar - 推荐算法引擎 / Recommendation Engine
 *
 * v3.2.8 重构：内置算法改为 **appId 维度的个性化概率预测**——每个游戏的
 * 推荐值 = 该游戏的浏览/下载行为信号 + Steam 官方标签与用户偏好匹配 +
 * 好评率 + 中文支持 的综合加权，不同游戏得到不同分值（此前全站统计与
 * 空关键词导致所有游戏分数相同）。LLM 推荐（Ollama / OpenAI）保留。
 * Built-in algorithm rebuilt as an appId-level personalised probability: a
 * game's score combines its own view/download signals, tag-preference match,
 * positive rate and Chinese support — distinct per game. LLM stays.
 */
import { dataStore } from '../../data/data-store.js';
import { readProfiles, readKeywordWeights } from '../storage/behavior.js';
import { DB_KEYS } from '../core/constants.js';
import { getSettings } from '../core/settings.js';
import { lookupAppIdByName } from '../storage/name-index.js';
import { getGameRegistryEntry } from '../storage/registry.js';
import { getSteamCacheEntry, getMergedData } from '../storage/steam-cache.js';
import { fetchWithTimeout } from '../core/utils.js';
import { cleanGameName } from '../core/title-parser.js';

// 关键词评分计算 / Keyword-score calculation
export function calculateKeywordScore(keywords, keywordWeights) {
  if (!keywords || keywords.length === 0) return null;
  let matchScore = 0;
  let matchCount = 0;
  keywords.forEach((kw) => {
    if (keywordWeights[kw] !== undefined) {
      matchScore += keywordWeights[kw];
      matchCount++;
    }
  });
  return matchCount > 0 ? matchScore / matchCount : null;
}

// 查找游戏画像：精确名 → 清洗名 → 注册表名称变体 → 模糊包含（取行为量最高）
// Find the game profile by exact name, cleaned name, registry variants or a
// fuzzy containment match (picking the most active one).
export function findProfile(profiles, name, registryEntry) {
  if (!profiles || !name) return null;
  const key = name.toLowerCase().trim();
  if (profiles[key]) return profiles[key];
  const cleaned = cleanGameName(name).toLowerCase().trim();
  if (cleaned && cleaned !== key && profiles[cleaned]) return profiles[cleaned];
  if (registryEntry && registryEntry.names) {
    for (const n of registryEntry.names) {
      if (profiles[n]) return profiles[n];
    }
  }
  if (cleaned && cleaned.length >= 2) {
    // 模糊匹配前规范化（去标点/空格/斜杠），兼容记录名与列表标题的格式差异
    const normKey = (s) => s.toLowerCase().replace(/[\s\-_:：|.'!！?？\[\]()（）\/]/g, '');
    const normCleaned = normKey(cleaned);
    /** @type {Object|null} */
    let best = null;
    for (const [k, p] of Object.entries(profiles)) {
      const nk = normKey(k);
      if (nk.includes(normCleaned) || normCleaned.includes(nk)) {
        if (!best || p.views + p.downloads > best.views + best.downloads) best = p;
      }
    }
    if (best) return best;
  }
  return null;
}

// v4.0.0：SteamSpy 时长/热度信号归一化（纯函数，可单测）。
// playTime：平均游玩分钟 / 600（10 小时封顶）；heat：owners 区间中点对数 / 7
//（千万封顶，热度分布极偏故用对数）。缺数据 → 中性 0.3（对齐 keywordScore
// 无标签 0.3 的模式），保证有数据游戏的分数可靠超过缺省值。
// SteamSpy playtime/heat signal normalisation (pure). playTime caps at 600min;
// heat is log10(owners midpoint)/7 (log scale for skewed distribution). Missing
// data yields a neutral 0.3, matching the no-tags keywordScore convention.
/**
 * SteamSpy 时长/热度归一化信号（纯函数，可单测）
 * @param {Object|null|undefined} spy - SteamSpy 原始数据（averageForeverMin/ownersLow/ownersHigh）
 * @returns {{playTimeScore: number, heatScore: number}}
 */
export function steamspyScores(spy) {
  if (!spy || typeof spy !== 'object') return { playTimeScore: 0.3, heatScore: 0.3 };
  let playTimeScore = 0.3;
  if (typeof spy.averageForeverMin === 'number' && spy.averageForeverMin > 0) {
    playTimeScore = Math.min(spy.averageForeverMin / 600, 1);
  }
  let heatScore = 0.3;
  if (typeof spy.ownersLow === 'number' && typeof spy.ownersHigh === 'number' && spy.ownersHigh > 0) {
    const mid = (spy.ownersLow + spy.ownersHigh) / 2;
    if (mid > 0) heatScore = Math.min(Math.log10(mid) / 7, 1);
  }
  return { playTimeScore, heatScore };
}

/**
 * 单游戏推荐评分（纯计算，输入为聚合数据，可单测）
 * 信号：行为（详情打开/下载占比，归一化）、标签匹配（Steam 官方标签 vs 用户偏好）、
 * 好评率 + 中文支持。综合加权后返回 score 与 breakdown（徽章悬停展示用）。
 * Pure per-game score computation. Signals: behaviour (normalised view/download
 * shares), tag-preference match, positive rate + Chinese support.
 * @param {Object} params - 聚合输入 / aggregated inputs
 * @param {Object|null} params.profile - 游戏画像（views/downloads/keywords）/ game profile
 * @param {{maxViews?: number, maxDownloads?: number}} params.globalStats - 全站归一化基准
 * @param {string[]|null} params.tags - Steam 官方标签
 * @param {Object} params.keywordWeights - 用户偏好关键词权重表
 * @param {number|null} params.positiveRate - 好评率（0-100，null=未知）
 * @param {boolean} params.chineseSupported - 是否支持中文
 * @param {Object} params.weights - 各信号权重（clickRate/downloadRate/keywordMatch/steamRating/playTime/heat）
 * @param {number|null} params.playTimeScore - SteamSpy 时长信号（0-1，null=缺省中性）
 * @param {number|null} params.heatScore - SteamSpy 热度信号（0-1，null=缺省中性）
 * @returns {{score: number, breakdown: {clickScore: number, downloadScore: number, keywordScore: number, steamScore: number, playTimeScore: number, heatScore: number}, method: string}}
 */
// v4.0.0：computeGameScore 新增 playTimeScore/heatScore 分量（缺省中性 0.3）；
// 权重六项（clickRate/downloadRate/keywordMatch/steamRating/playTime/heat）
export function computeGameScore({
  profile = null,
  globalStats = {},
  tags = null,
  keywordWeights = {},
  positiveRate = null,
  chineseSupported = false,
  weights = {},
  playTimeScore = null,
  heatScore = null
}) {
  // v6.3.2 C3：用户标记不感兴趣 → 推荐归零（负信号优先于一切正信号）
  if (profile && profile.disliked) {
    return { score: 0, breakdown: { clickScore: 0, downloadScore: 0, keywordScore: 0, steamScore: 0, playTimeScore: 0, heatScore: 0 }, method: 'disliked' };
  }
  const views = profile ? profile.views || 0 : 0;
  const downloads = profile ? profile.downloads || 0 : 0;
  // 1. 行为信号：该游戏活跃度占全站最高活跃度的比例（饱和到 1）
  const clickScore = (globalStats.maxViews || 0) > 0 ? Math.min(views / (globalStats.maxViews || 1), 1) : 0;
  const downloadScore = (globalStats.maxDownloads || 0) > 0 ? Math.min(downloads / (globalStats.maxDownloads || 1), 1) : 0;
  // 2. 标签匹配：Steam 官方标签与用户偏好关键词的匹配度（无标签给中性值）
  const kw = calculateKeywordScore(tags || [], keywordWeights);
  const keywordScore = kw !== null ? kw : 0.3;
  // 3. Steam 信号：好评率 70% + 中文支持 30%
  let steamScore = 0.4;
  if (positiveRate !== null && positiveRate !== undefined) {
    steamScore = Math.min((positiveRate / 100) * 0.7 + (chineseSupported ? 0.3 : 0), 1);
  }
  // 4. SteamSpy 信号：时长/热度（缺省中性 0.3）
  const pTime = playTimeScore !== null && playTimeScore !== undefined ? playTimeScore : 0.3;
  const heat = heatScore !== null && heatScore !== undefined ? heatScore : 0.3;
  const finalScore =
    clickScore * (weights.clickRate || 0) +
    downloadScore * (weights.downloadRate || 0) +
    keywordScore * (weights.keywordMatch || 0) +
    steamScore * (weights.steamRating || 0) +
    pTime * (weights.playTime || 0) +
    heat * (weights.heat || 0);
  return {
    score: Math.round(finalScore * 100) / 100,
    breakdown: {
      clickScore: Math.round(clickScore * 100) / 100,
      downloadScore: Math.round(downloadScore * 100) / 100,
      keywordScore: Math.round(keywordScore * 100) / 100,
      steamScore: Math.round(steamScore * 100) / 100,
      playTimeScore: Math.round(pTime * 100) / 100,
      heatScore: Math.round(heat * 100) / 100
    },
    method: 'builtin'
  };
}

// 计算推荐评分（forceBuiltin 批量时强制内置算法；shared 为批量场景共享的
// 只读数据 {settings, profiles, keywordWeights}，由调用方加载一次）
// Compute a recommendation score (forceBuiltin for batch mode; `shared` carries
// read-once data {settings, profiles, keywordWeights} loaded by the caller)
/**
 * 计算推荐评分（strict 类型化，v6.3.1）
 * @param {Object} gameInfo - 游戏信息（name/appId/tags/...）
 * @param {boolean} [forceBuiltin] - 强制内置算法（跳过 LLM）
 * @param {{settings: import('../core/types.js').AppSettings, profiles: Object, keywordWeights: Object}|null} [shared] - 批量共享只读数据
 * @returns {Promise<import('../core/types.js').RecommendResult|{score: number}|null>}
 */
export async function calculateRecommendation(gameInfo, forceBuiltin = false, shared = null) {
  const settings = shared && shared.settings ? shared.settings : await getSettings();
  const weights = settings.weights;

  // LLM 模式（非强制内置时）
  if (settings.useLLM && !forceBuiltin) {
    try {
      const llmScore = await calculateWithLLM(gameInfo, settings);
      if (llmScore !== null) return llmScore;
    } catch (e) {
      console.warn('LLM计算失败，回退到内置算法:', e);
    }
  }

  // 内置算法：聚合该游戏所需数据（行为画像/偏好/注册表/Steam 缓存）
  const [profiles, keywordWeights] =
    shared && shared.profiles
      ? [shared.profiles, shared.keywordWeights || {}]
      : await Promise.all([readProfiles(), readKeywordWeights()]);

  // 解析 appId：列表页封面直取优先，否则名称索引
  let appId = gameInfo.appId || null;
  if (!appId) {
    appId = await lookupAppIdByName(gameInfo.name || '');
  }
  const [registryEntry, steamEntry] = appId
    ? await Promise.all([getGameRegistryEntry(appId), getSteamCacheEntry(appId)])
    : [null, null];

  const profile = findProfile(profiles, gameInfo.name, registryEntry);
  const allProfiles = Object.values(profiles);
  const globalStats = {
    maxViews: Math.max(1, ...allProfiles.map((p) => p.views || 0)),
    maxDownloads: Math.max(1, ...allProfiles.map((p) => p.downloads || 0))
  };
  // v3.3.7：缓存为模块结构，用合并视图读字段
  const steamData = steamEntry ? getMergedData(steamEntry) : null;
  // v4.0.0：SteamSpy 时长/热度信号（spy 模块可能为 null，steamspyScores 兜底）
  const { playTimeScore, heatScore } = steamspyScores(steamData && steamData.steamspy ? steamData.steamspy : null);

  return computeGameScore({
    profile,
    globalStats,
    tags: registryEntry ? registryEntry.tags : null,
    keywordWeights,
    positiveRate: steamData ? steamData.positiveRate : null,
    chineseSupported: steamData ? !!steamData.chineseSupported : false,
    playTimeScore,
    heatScore,
    weights
  });
}

// --- LLM 计算 / LLM scoring ---

async function calculateWithLLM(gameInfo, settings) {
  const { llmConfig } = settings;

  const kwData = await dataStore.readModule(DB_KEYS.KEYWORD_WEIGHTS);
  const keywordWeights = kwData || {};
  const topKeywords = Object.entries(keywordWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([kw, w]) => `${kw}(${Math.round(w * 100)}%)`)
    .join('、');

  const prompt = buildLLMPrompt(gameInfo, topKeywords);

  let response;
  // LLM 生成较慢，使用更长的超时时间（30s）；端点为用户显式配置（可能本地 Ollama），允许私有地址
  const LLM_FETCH_TIMEOUT = 30000;
  if (llmConfig.provider === 'local') {
    // Ollama 本地模型
    response = await fetchWithTimeout(
      llmConfig.endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        allowPrivateHosts: true,
        body: JSON.stringify({
          model: llmConfig.model,
          prompt,
          stream: false,
          options: { temperature: llmConfig.temperature }
        })
      },
      LLM_FETCH_TIMEOUT
    );
    const data = await response.json();
    return parseLLMResponse(data.response);
  } else {
    // OpenAI兼容接口
    response = await fetchWithTimeout(
      llmConfig.endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${llmConfig.apiKey}`
        },
        allowPrivateHosts: true,
        body: JSON.stringify({
          model: llmConfig.model,
          messages: [
            {
              role: 'system',
              content:
                '你是一个游戏推荐评分系统。根据用户的游戏偏好和游戏信息，给出0-1之间的下载概率评分。只返回JSON格式：{"score": 0.85, "reason": "简短理由"}'
            },
            { role: 'user', content: prompt }
          ],
          temperature: llmConfig.temperature
        })
      },
      LLM_FETCH_TIMEOUT
    );
    const data = await response.json();
    return parseLLMResponse(data.choices[0].message.content);
  }
}

function buildLLMPrompt(gameInfo, userKeywords) {
  return `请根据以下信息评估用户下载该游戏的概率（0-1）：

游戏名称：${gameInfo.name}
游戏类型：${(gameInfo.keywords || []).join('、') || '未知'}
游戏描述：${gameInfo.description || '无'}
Steam评分：${gameInfo.steamRating || '未知'}/10
Steam好评率：${gameInfo.positiveRate || '未知'}%

用户历史偏好关键词（括号内为匹配度）：${userKeywords || '学习中'}

请返回JSON格式：{"score": 数值, "reason": "理由"}`;
}

function parseLLMResponse(text) {
  try {
    const jsonMatch = text.match(/\{[\s\S]*?"score"[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        score: Math.max(0, Math.min(1, parsed.score)),
        reason: parsed.reason || '',
        method: 'llm'
      };
    }
  } catch (e) {
    console.warn('LLM响应解析失败:', e);
  }
  return null;
}
