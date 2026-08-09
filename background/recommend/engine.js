/**
 * Game Recommender - 推荐算法引擎 / Recommendation Engine
 *
 * 内置加权算法（点击率/下载率/关键词匹配/Steam 评分 + 历史画像加成）
 * 与 LLM 推荐（Ollama 本地 / OpenAI 兼容，失败回退内置）。
 * Built-in weighted algorithm plus LLM recommendations (fallback on failure).
 */
import { dataStore } from '../../data/data-store.js';
import { DB_KEYS } from '../core/constants.js';
import { getSettings } from '../core/settings.js';
import { getBehaviorLog } from '../storage/behavior.js';
import { fetchWithTimeout } from '../core/utils.js';
import { cleanGameName } from '../steam/title-parser.js';

// 关键词评分计算 / Keyword-score calculation
export function calculateKeywordScore(keywords, keywordWeights) {
  if (!keywords || keywords.length === 0) return null;
  let matchScore = 0;
  let matchCount = 0;
  keywords.forEach(kw => {
    if (keywordWeights[kw] !== undefined) {
      matchScore += keywordWeights[kw];
      matchCount++;
    }
  });
  return matchCount > 0 ? matchScore / matchCount : null;
}

// 计算推荐评分（forceBuiltin 批量时强制内置算法）/ Compute a recommendation score
export async function calculateRecommendation(gameInfo, forceBuiltin = false) {
  const settings = await getSettings();
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

  // 内置算法
  const [behaviorLog, keywordWeights, profiles] = await Promise.all([
    getBehaviorLog(),
    dataStore.readModule(DB_KEYS.KEYWORD_WEIGHTS).then(v => v || {}),
    dataStore.readModule(DB_KEYS.GAME_PROFILES).then(v => v || {})
  ]);

  // 1. 点击率得分
  let clickScore = 0.5;
  const totalViews = behaviorLog.filter(e => e.type === 'view_list').length;
  const totalClicks = behaviorLog.filter(e => e.type === 'view_detail').length;
  if (totalViews > 0) {
    clickScore = Math.min(totalClicks / totalViews, 1);
  }

  // 2. 下载率得分：关键词信号（与第 3 步相同的匹配度）+ 历史下载占比信号
  //    修复：此前与"关键词匹配得分"调用同一函数导致两个权重加权同一值
  //    Download-rate score: keyword signal + the game's share of download events
  let downloadScore = 0.3;
  const gameKeywords = gameInfo.keywords || [];
  const kwDownloadScore = calculateKeywordScore(gameKeywords, keywordWeights);
  if (kwDownloadScore !== null) downloadScore = kwDownloadScore;

  // 3. 关键词匹配得分
  let keywordScore = 0.4;
  const kwMatchScore = calculateKeywordScore(gameKeywords, keywordWeights);
  if (kwMatchScore !== null) keywordScore = kwMatchScore;

  // 4. Steam评分得分
  let steamScore = 0.5;
  if (gameInfo.steamRating !== null && gameInfo.steamRating !== undefined) {
    steamScore = gameInfo.steamRating / 10;
  } else if (gameInfo.positiveRate !== null && gameInfo.positiveRate !== undefined) {
    steamScore = gameInfo.positiveRate / 100;
  }

  // 5. 历史画像加成（支持模糊匹配）
  const profileKey = (gameInfo.name || '').toLowerCase().trim();
  const cleanedKey = cleanGameName(gameInfo.name || '').toLowerCase().trim();
  let profileMatch = profiles[profileKey] || profiles[cleanedKey];

  if (!profileMatch && cleanedKey.length > 3) {
    for (const [key, profile] of Object.entries(profiles)) {
      if (key.includes(cleanedKey) || cleanedKey.includes(key) ||
          (key.length > 4 && cleanedKey.length > 4 &&
           (key.substring(0, 4) === cleanedKey.substring(0, 4)))) {
        profileMatch = profile;
        break;
      }
    }
  }

  if (profileMatch) {
    // 历史下载占比信号：该游戏下载次数占全部下载的比例（真实下载率信号，
    // 与关键词得分解耦，避免权重 double-count）
    if (profileMatch.downloads > 0) {
      const totalDownloads = behaviorLog.filter(e => e.type === 'click_download').length;
      if (totalDownloads > 0) {
        downloadScore = Math.max(downloadScore, Math.min(profileMatch.downloads / totalDownloads, 1));
      } else {
        downloadScore = Math.min(downloadScore + 0.3, 1);
      }
    }
    if (gameKeywords.length === 0 && profileMatch.keywords && profileMatch.keywords.length > 0) {
      const profileKwScore = calculateKeywordScore(profileMatch.keywords, keywordWeights);
      if (profileKwScore !== null) {
        keywordScore = profileKwScore;
        downloadScore = Math.max(downloadScore, profileKwScore);
      }
    }
  }

  // 加权计算最终得分
  const finalScore =
    clickScore * weights.clickRate +
    downloadScore * weights.downloadRate +
    keywordScore * weights.keywordMatch +
    steamScore * weights.steamRating;

  return {
    score: Math.round(finalScore * 100) / 100,
    breakdown: {
      clickScore: Math.round(clickScore * 100) / 100,
      downloadScore: Math.round(downloadScore * 100) / 100,
      keywordScore: Math.round(keywordScore * 100) / 100,
      steamScore: Math.round(steamScore * 100) / 100
    },
    method: 'builtin'
  };
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
    response = await fetchWithTimeout(llmConfig.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      allowPrivateHosts: true,
      body: JSON.stringify({
        model: llmConfig.model,
        prompt,
        stream: false,
        options: { temperature: llmConfig.temperature }
      })
    }, LLM_FETCH_TIMEOUT);
    const data = await response.json();
    return parseLLMResponse(data.response);
  } else {
    // OpenAI兼容接口
    response = await fetchWithTimeout(llmConfig.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${llmConfig.apiKey}`
      },
      allowPrivateHosts: true,
      body: JSON.stringify({
        model: llmConfig.model,
        messages: [
          { role: 'system', content: '你是一个游戏推荐评分系统。根据用户的游戏偏好和游戏信息，给出0-1之间的下载概率评分。只返回JSON格式：{"score": 0.85, "reason": "简短理由"}' },
          { role: 'user', content: prompt }
        ],
        temperature: llmConfig.temperature
      })
    }, LLM_FETCH_TIMEOUT);
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
