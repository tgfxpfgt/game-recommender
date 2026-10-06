// @ts-strict
/**
 * 游戏雷达 Game Radar - 推荐信号纯函数 / Recommendation Signal Pure Functions
 *
 * v14.3.0（第五轮 B5）：由 engine.js 下沉——关键词评分/画像查找/SteamSpy 四信号/
 * AppID 行为统计信号/单游戏加权合成，全部为**零 IO 纯函数**（可独立单测）。
 * engine.js 保留数据编排（calculateRecommendation）与 LLM 链路并 re-export
 * 本模块（handlers/cache-manager 等消费方 import 路径不变）。
 * Zero-IO signal maths sunk from engine.js; engine.js re-exports for
 * consumer compatibility (handlers/cache-manager imports unchanged).
 */
import { SPY_SCALES } from '../core/constants.js'; // v10.7.0：信号刻度单源
import { cleanGameName } from '../core/title-parser.js';

// 关键词评分计算 / Keyword-score calculation
export function calculateKeywordScore(keywords, keywordWeights) {
  if (!keywords || keywords.length === 0) return null;
  let matchScore = 0;
  let matchCount = 0;
  keywords.forEach((kw) => {
    const w = keywordWeights[kw];
    // v10.5.0 P2-B：仅累加有限数值权重，防脏数据（字符串/NaN）污染均值
    // Only accumulate finite numeric weights (guard against corrupt disk data).
    if (typeof w === 'number' && Number.isFinite(w)) {
      matchScore += w;
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
// v10.5.3 任务3：拆分为四信号——playTime（平均游玩分钟 / 600，10 小时封顶）、
// heat（改为 CCU 当前在线对数 / 5，10 万封顶——原 owners 口径本质是销量，
// 移交 salesScore）、sales（owners 区间中点对数 / 7，千万封顶）、reviews
//（totalReviews 对数 / 5，10 万封顶）。缺数据 → 中性 0.3（对齐 keywordScore
// 无标签 0.3 的模式），保证有数据游戏的分数可靠超过缺省值。
// SteamSpy signal normalisation (pure), four signals since v10.5.3:
// playTime caps at 600min; heat is log10(ccu)/5 (CCU-based, now that owners
// moved to the sales signal); sales is log10(owners midpoint)/7; reviews is
// log10(totalReviews)/5. Missing data yields a neutral 0.3.
/**
 * SteamSpy 时长/热度/销量/评论数归一化信号（纯函数，可单测）
 * @param {Object|null|undefined} spy - SteamSpy 原始数据（averageForeverMin/ccu/ownersLow/ownersHigh/totalReviews）
 * @returns {{playTimeScore: number, heatScore: number, salesScore: number, reviewScore: number}}
 */
export function steamspyScores(spy) {
  if (!spy || typeof spy !== 'object') {
    const n = SPY_SCALES.neutral;
    return { playTimeScore: n, heatScore: n, salesScore: n, reviewScore: n };
  }
  let playTimeScore = SPY_SCALES.neutral;
  if (typeof spy.averageForeverMin === 'number' && spy.averageForeverMin > 0) {
    playTimeScore = Math.min(spy.averageForeverMin / SPY_SCALES.playTimeDivisor, 1);
  }
  // v10.5.3：热度改 CCU 口径（当前在线人数，对数 / 5）——原 owners 口径
  // 实为销量语义，由下方 salesScore 承接
  let heatScore = SPY_SCALES.neutral;
  if (typeof spy.ccu === 'number' && spy.ccu > 0) {
    heatScore = Math.min(Math.log10(spy.ccu) / SPY_SCALES.heatLogDivisor, 1);
  }
  // v10.5.3：销量 = owners 区间中点对数 / 7（千万封顶，分布极偏故用对数）
  let salesScore = SPY_SCALES.neutral;
  if (typeof spy.ownersLow === 'number' && typeof spy.ownersHigh === 'number' && spy.ownersHigh > 0) {
    const mid = (spy.ownersLow + spy.ownersHigh) / 2;
    if (mid > 0) salesScore = Math.min(Math.log10(mid) / SPY_SCALES.salesLogDivisor, 1);
  }
  // v10.5.3：评论数 = totalReviews 对数 / 5（10 万封顶，与热度同刻度）
  let reviewScore = SPY_SCALES.neutral;
  if (typeof spy.totalReviews === 'number' && spy.totalReviews > 0) {
    reviewScore = Math.min(Math.log10(spy.totalReviews) / SPY_SCALES.reviewLogDivisor, 1);
  }
  return { playTimeScore, heatScore, salesScore, reviewScore };
}

/**
 * v10.1.0：AppID 行为统计信号（纯函数，可单测）
 * a = 跨站点下载次数，b = 跨站点详情页打开次数（app-stats 模块，永不过期）。
 * 规则（用户需求）：a>0 → 正向信号（对数饱和），b 不参与；a=0 且 b>0 →
 * 负向信号（只看不下，b 越大越不推荐）；a=0 且 b=0 → 中性 0。
 * 对数刻度：a=10 → 0.5、a=100 → 1 封顶（b 同理），避免少数高频游戏垄断。
 * App-stat signal (pure): a>0 → positive log-saturated score, b ignored;
 * a=0 & b>0 → negative penalty growing with b; a=b=0 → neutral 0.
 * @param {number|null} a - 下载次数
 * @param {number|null} b - 详情页打开次数
 * @returns {{downloadStat: number, viewPenalty: number}}
 */
/**
 * ...
 * @param {{downloadCap?: number, viewCap?: number}|null} [caps] - 饱和封顶（可由设置覆盖）
 */
export function appStatScores(a, b, caps = null) {
  // v10.3.0：饱和封顶可调（appStatDownloadCap/appStatDetailViewCap，默认 100）——
  // 分母 = log10(cap+1)，a=cap 时信号恰好满分；封顶缩放保持单调
  const downloadCap = caps && typeof caps.downloadCap === 'number' && caps.downloadCap >= 1 ? caps.downloadCap : 100;
  const viewCap = caps && typeof caps.viewCap === 'number' && caps.viewCap >= 1 ? caps.viewCap : 100;
  const downloads = typeof a === 'number' && a > 0 ? a : 0;
  const detailViews = typeof b === 'number' && b > 0 ? b : 0;
  if (downloads > 0) {
    return { downloadStat: Math.min(Math.log10(downloads + 1) / Math.log10(downloadCap + 1), 1), viewPenalty: 0 };
  }
  if (detailViews > 0) {
    return { downloadStat: 0, viewPenalty: -Math.min(Math.log10(detailViews + 1) / Math.log10(viewCap + 1), 1) };
  }
  return { downloadStat: 0, viewPenalty: 0 };
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
 * @param {Object} params.weights - 各信号权重（clickRate/downloadRate/keywordMatch/steamRating/playTime/heat/sales/reviews）
 * @param {number|null} params.playTimeScore - SteamSpy 时长信号（0-1，null=缺省中性）
 * @param {number|null} params.heatScore - SteamSpy 热度信号（0-1，v10.5.3 起 CCU 口径，null=缺省中性）
 * @param {number|null} [params.salesScore] - SteamSpy 销量信号（0-1，owners 口径，null=缺省中性）
 * @param {number|null} [params.reviewScore] - SteamSpy 评论数信号（0-1，null=缺省中性）
 * @param {number|null} [params.appDownloads] - AppID 下载次数 a（null=无统计）
 * @param {number|null} [params.appDetailViews] - AppID 详情页打开次数 b（null=无统计）
 * @param {{downloadCap?: number, viewCap?: number}|null} [params.appStatCaps] - a/b 对数饱和封顶（设置可调）
 * @returns {{score: number, breakdown: {clickScore: number, downloadScore: number, keywordScore: number, steamScore: number, playTimeScore: number, heatScore: number, salesScore: number, reviewScore: number, appDownloadScore: number, appViewPenalty: number}, reason?: string, method: string}}
 */
// v4.0.0：computeGameScore 新增 playTimeScore/heatScore 分量（缺省中性 0.3）；
// v10.5.3 任务3：新增 salesScore/reviewScore 分量（同缺省中性 0.3），权重键
// sales/reviews——未配置新权重的旧调用方贡献恰为 0，行为不变
export function computeGameScore({
  profile = null,
  globalStats = {},
  tags = null,
  keywordWeights = {},
  positiveRate = null,
  chineseSupported = false,
  weights = {},
  playTimeScore = null,
  heatScore = null,
  salesScore = null,
  reviewScore = null,
  appDownloads = null,
  appDetailViews = null,
  appStatCaps = null
}) {
  // v6.3.2 C3：用户标记不感兴趣 → 推荐归零（负信号优先于一切正信号）
  if (profile && profile.disliked) {
    return {
      score: 0,
      breakdown: {
        clickScore: 0,
        downloadScore: 0,
        keywordScore: 0,
        steamScore: 0,
        playTimeScore: 0,
        heatScore: 0,
        salesScore: 0,
        reviewScore: 0,
        appDownloadScore: 0,
        appViewPenalty: 0
      },
      method: 'disliked'
    };
  }
  const views = profile ? profile.views || 0 : 0;
  const downloads = profile ? profile.downloads || 0 : 0;
  // v10.5.0 P2-B：权重取值一律过有限数值门（缺失/字符串/NaN → 0），防脏权重产 NaN 分
  // Every weight is coerced through a finite-number gate (missing/string/NaN → 0).
  const W = (key) => {
    const v = weights[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  };
  // 1. 行为信号：该游戏活跃度占全站最高活跃度的比例（饱和到 1）
  const clickScore = (globalStats.maxViews || 0) > 0 ? Math.min(views / (globalStats.maxViews || 1), 1) : 0;
  const downloadScore =
    (globalStats.maxDownloads || 0) > 0 ? Math.min(downloads / (globalStats.maxDownloads || 1), 1) : 0;
  // 2. 标签匹配：Steam 官方标签与用户偏好关键词的匹配度（无标签给中性值）
  const kw = calculateKeywordScore(tags || [], keywordWeights);
  const keywordScore = kw !== null ? kw : 0.3;
  // 3. Steam 信号：好评率 70% + 中文支持 30%
  let steamScore = SPY_SCALES.steamNeutral; // v10.7.0：刻度单源
  const pr = Number(positiveRate);
  if (positiveRate !== null && positiveRate !== undefined && Number.isFinite(pr)) {
    steamScore = Math.min((pr / 100) * 0.7 + (chineseSupported ? 0.3 : 0), 1);
  }
  // 4. SteamSpy 信号：时长/热度/销量/评论数（缺省中性 0.3；v10.5.3 拆分
  // 热度为 CCU 口径并新增销量/评论数信号）
  const pTime = playTimeScore !== null && playTimeScore !== undefined ? playTimeScore : 0.3;
  const heat = heatScore !== null && heatScore !== undefined ? heatScore : 0.3;
  const sales = salesScore !== null && salesScore !== undefined ? salesScore : 0.3;
  const review = reviewScore !== null && reviewScore !== undefined ? reviewScore : 0.3;
  // 5. AppID 行为统计信号（v10.1.0）：a>0 正向 / a=0 且 b>0 负向（b 越大越不推荐）
  const { downloadStat, viewPenalty } = appStatScores(appDownloads, appDetailViews, appStatCaps);
  const finalScore =
    clickScore * W('clickRate') +
    downloadScore * W('downloadRate') +
    keywordScore * W('keywordMatch') +
    steamScore * W('steamRating') +
    pTime * W('playTime') +
    heat * W('heat') +
    sales * W('sales') +
    review * W('reviews') +
    downloadStat * W('appStatDownload') +
    viewPenalty * W('appStatDetailView');
  // v6.4.10：权重和超 1 时归一化（用户可配置任意权重，保证评分不超 100%）
  // v10.1.0：负向 appStatDetailView 分量不参与"权重和"归一（它是惩罚项，
  // 若计入会把惩罚稀释掉）——仅累计正向权重
  const weightSum =
    W('clickRate') +
    W('downloadRate') +
    W('keywordMatch') +
    W('steamRating') +
    W('playTime') +
    W('heat') +
    W('sales') +
    W('reviews') +
    W('appStatDownload');
  // v10.3.0：clamp 到 [0,1]——未下载惩罚（负分量）可能把分数推为负数，
  // 负推荐值无意义（徽章显示异常），下限 0
  const normalized = weightSum > 1 ? finalScore / weightSum : finalScore;
  // v10.5.0 P2-B：非有限结果（理论上已被上游门挡住）兜底为 0，绝不产出 NaN 分
  const clamped = Number.isFinite(normalized) ? Math.min(1, Math.max(0, normalized)) : 0;
  return {
    score: Math.round(clamped * 100) / 100,
    breakdown: {
      clickScore: Math.round(clickScore * 100) / 100,
      downloadScore: Math.round(downloadScore * 100) / 100,
      keywordScore: Math.round(keywordScore * 100) / 100,
      steamScore: Math.round(steamScore * 100) / 100,
      playTimeScore: Math.round(pTime * 100) / 100,
      heatScore: Math.round(heat * 100) / 100,
      salesScore: Math.round(sales * 100) / 100,
      reviewScore: Math.round(review * 100) / 100,
      appDownloadScore: Math.round(downloadStat * 100) / 100,
      appViewPenalty: Math.round(viewPenalty * 100) / 100
    },
    method: 'builtin'
  };
}
