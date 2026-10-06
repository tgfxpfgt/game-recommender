/**
 * 游戏雷达 Game Radar - 推荐算法引擎（编排壳）/ Recommendation Engine (shell)
 *
 * v3.2.8 重构：内置算法改为 **appId 维度的个性化概率预测**。LLM 推荐
 * （Ollama / OpenAI）保留。
 * v14.3.0（第五轮 B5）：493 行按域拆分——**信号纯函数**（calculateKeywordScore/
 * findProfile/steamspyScores/appStatScores/computeGameScore）下沉
 * engine-signals.js（零 IO 可单测）；本文件保留数据编排
 * （calculateRecommendation 聚合画像/偏好/注册表/Steam 缓存）与 LLM 链路，
 * 并 re-export 信号函数——handlers/cache-manager 等消费方 import 路径不变。
 * Shell after the B5 split: data orchestration + LLM chain here; the zero-IO
 * signal maths lives in engine-signals.js (re-exported for compatibility).
 */
import { readProfiles, readKeywordWeights } from '../storage/behavior.js';
import { getAppStats } from '../storage/app-stats.js'; // v10.1.0：AppID 行为统计信号
import { getSettings } from '../core/settings.js';
import { lookupAppIdByName } from '../storage/name-index.js';
import { getGameRegistryEntry } from '../storage/registry.js';
import { getSteamCacheEntry, getMergedData } from '../storage/steam-cache.js';
import { fetchWithTimeout } from '../core/utils.js';
import { getLlmScore, setLlmScore } from '../storage/llm-cache.js';
import {
  calculateKeywordScore,
  findProfile,
  steamspyScores,
  appStatScores,
  computeGameScore
} from './engine-signals.js';

// re-export（消费面兼容——handlers/cache-manager 等经 engine.js 引用信号函数）
export { calculateKeywordScore, findProfile, steamspyScores, appStatScores, computeGameScore };

/**
 * 计算推荐评分（strict 类型化，v6.3.1）
 * @param {Object} gameInfo - 游戏信息（name/appId/tags/...）
 * @param {boolean} [forceBuiltin] - 强制内置算法（跳过 LLM）
 * @param {{settings: import('../core/types.js').AppSettings, profiles: Object, keywordWeights: Object, appStats?: Object}|null} [shared] - 批量共享只读数据
 * @returns {Promise<import('../core/types.js').RecommendResult|{score: number}|null>}
 */
export async function calculateRecommendation(gameInfo, forceBuiltin = false, shared = null) {
  const settings = shared && shared.settings ? shared.settings : await getSettings();
  const weights = settings.weights;

  // LLM 模式（非强制内置时）——v6.4.3：评分缓存（7d，LLM 慢且贵）
  if (settings.useLLM && !forceBuiltin) {
    try {
      const cachedScore = await getLlmScore(gameInfo.name);
      if (cachedScore !== null) return cachedScore;
      const llmScore = await calculateWithLLM(gameInfo, settings);
      if (llmScore !== null) {
        await setLlmScore(gameInfo.name, llmScore);
        return llmScore;
      }
    } catch (e) {
      console.warn('LLM计算失败，回退到内置算法:', e);
    }
  }

  // 内置算法：聚合该游戏所需数据（行为画像/偏好/注册表/Steam 缓存）
  // v10.1.0：AppID 行为统计批量共享读（shared.appStats 由调用方加载一次）
  const [profiles, keywordWeights, appStatsMap] =
    shared && shared.profiles
      ? [shared.profiles, shared.keywordWeights || {}, shared.appStats || null]
      : await Promise.all([readProfiles(), readKeywordWeights(), getAppStats()]);

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
  // v10.1.0：AppID 行为统计（a 下载 / b 详情页打开——推荐信号）
  const appStat = appId && appStatsMap ? appStatsMap[String(appId)] : null;
  // v3.3.7：缓存为模块结构，用合并视图读字段
  const steamData = steamEntry ? getMergedData(steamEntry) : null;
  // v4.0.0：SteamSpy 时长/热度信号（spy 模块可能为 null，steamspyScores 兜底）
  // v10.5.3 任务3：拆分出销量/评论数信号（owners/totalReviews 随 spy 缓存）
  const { playTimeScore, heatScore, salesScore, reviewScore } = steamspyScores(
    steamData && steamData.steamspy ? steamData.steamspy : null
  );

  return computeGameScore({
    profile,
    globalStats,
    tags: registryEntry ? registryEntry.tags : null,
    keywordWeights,
    positiveRate: steamData ? steamData.positiveRate : null,
    chineseSupported: steamData ? !!steamData.chineseSupported : false,
    playTimeScore,
    heatScore,
    salesScore,
    reviewScore,
    appDownloads: appStat ? appStat.downloads : null,
    appDetailViews: appStat ? appStat.detailViews : null,
    appStatCaps: {
      downloadCap: settings.appStatDownloadCap,
      viewCap: settings.appStatDetailViewCap
    },
    weights
  });
}

// --- LLM 计算 / LLM scoring ---

async function calculateWithLLM(gameInfo, settings) {
  const { llmConfig } = settings;

  // v10.5.2：改用 behavior.js 内存缓存读（此前直读 dataStore 绕过缓存层，
  // 破坏分层约定且每次 LLM 调用多一次磁盘 IO）
  // Read via the behavior.js memory cache instead of hitting dataStore directly.
  const keywordWeights = (await readKeywordWeights()) || {};
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
          // v11.0 B8：Ollama 结构化输出——JSON 模式约束输出为合法 JSON，
          // parseLLMResponse 的正则抽取从"尽力"变"可靠"
          format: 'json',
          // v10.5.2：num_predict 上限——评分输出只是一小段 JSON，无上限时模型
          // 可能长篇发挥，白白消耗 token/时间
          // Cap generated tokens: the score is a tiny JSON blob.
          options: { temperature: llmConfig.temperature, num_predict: 100 }
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
          temperature: llmConfig.temperature,
          // v10.5.2：max_tokens 上限（同 num_predict——限制输出长度降 token 消耗）
          max_tokens: 100
        })
      },
      LLM_FETCH_TIMEOUT
    );
    const data = await response.json();
    return parseLLMResponse(data.choices[0].message.content);
  }
}

function buildLLMPrompt(gameInfo, userKeywords) {
  // v10.5.2：描述截断至 100 字——输入 token 随描述线性增长，评分只需类型/氛围
  // 提示，长描述对分数几乎无贡献
  // Truncate the description: prompt tokens grow linearly with it while the
  // score barely benefits beyond the first sentence.
  const desc = String(gameInfo.description || '').slice(0, 100);
  return `请根据以下信息评估用户下载该游戏的概率（0-1）：

游戏名称：${gameInfo.name}
游戏类型：${(gameInfo.keywords || []).join('、') || '未知'}
游戏描述：${desc || '无'}
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
      // v10.5.0 P2-B：score 必须是有限数值，否则视为解析失败（NaN 会被缓存 7 天）
      // A non-finite score must not be cached — treat as parse failure.
      if (typeof parsed.score !== 'number' || !Number.isFinite(parsed.score)) return null;
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
