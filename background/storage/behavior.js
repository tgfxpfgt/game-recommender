/**
 * 游戏雷达 Game Radar - 行为日志 / 游戏画像 / 偏好模型
 * Behavior Log, Game Profiles & User Preference Model
 *
 * 浏览行为（ND-JSON 追加写入）、游戏画像（views/downloads/keywords）、
 * 关键词权重偏好模型（60s 节流更新）。
 */
import { dataStore } from '../../data/data-store.js';
import { DB_KEYS, PREF_UPDATE_INTERVAL } from '../core/constants.js';
import { getSettings } from '../core/settings.js';

// --- 行为日志 / Behavior Log ---
// v7.0.4：内存缓存（内存换延迟）——行为日志/画像/关键词权重常被读取（推荐
// 计算、统计、缓存列表），此前每次 readModule 读盘；写操作更新内存缓存为写回
// 对象，读写一致；dataVersion 供统计聚合缓存按版本失效。
/** @type {{log: Array<Object>|null, profiles: Object|null, keywordWeights: Object|null}} */
let behaviorCache = { log: null, profiles: null, keywordWeights: null };
let dataVersion = 0;
export function getDataVersion() {
  return dataVersion;
}
function bumpVersion() {
  dataVersion++;
}

// 追加一条行为记录（ND-JSON 追加写入，仅超限时裁剪重写）
// Append a behavior entry (ND-JSON append; trim only when over the limit)
export async function addBehaviorLog(entry) {
  entry.timestamp = Date.now();
  await dataStore.appendModule(DB_KEYS.BEHAVIOR_LOG, entry);
  // v7.0.4：追加是磁盘写入——内存缓存需重新读盘同步（缓存引用是旧数组，
  // 直接 push 会漏掉 appendModule 的序列化结果）
  const stored = await dataStore.readModule(DB_KEYS.BEHAVIOR_LOG);
  behaviorCache.log = Array.isArray(stored) ? stored : [];

  const settings = await getSettings();
  const log = behaviorCache.log;
  const maxLog = settings.maxBehaviorLog || 500;
  if (log.length > maxLog) {
    const trimmed = log.slice(-maxLog);
    await dataStore.writeModule(DB_KEYS.BEHAVIOR_LOG, trimmed);
    behaviorCache.log = trimmed;
  }
  bumpVersion();
  return log;
}

// 读取行为日志 / Read the behavior log
/** @returns {Promise<Array<Object>>} */
export async function getBehaviorLog() {
  if (behaviorCache.log) return behaviorCache.log;
  const stored = await dataStore.readModule(DB_KEYS.BEHAVIOR_LOG);
  behaviorCache.log = Array.isArray(stored) ? stored : [];
  return behaviorCache.log;
}

// v5.0.0：画像/关键词权重读取辅助（此前 handlers/engine 4 处手写并行读取）
// Profile / keyword-weight read helpers (was hand-written in 4 call sites)
/** @returns {Promise<Object>} */
export async function readProfiles() {
  if (behaviorCache.profiles) return behaviorCache.profiles;
  const v = (await dataStore.readModule(DB_KEYS.GAME_PROFILES)) || {};
  behaviorCache.profiles = v;
  return v;
}
/** @returns {Promise<Object>} */
export async function readKeywordWeights() {
  if (behaviorCache.keywordWeights) return behaviorCache.keywordWeights;
  const v = (await dataStore.readModule(DB_KEYS.KEYWORD_WEIGHTS)) || {};
  behaviorCache.keywordWeights = v;
  return v;
}

// 预热内存缓存（SW 启动时调用）/ warm the in-memory caches
export async function warmupBehavior() {
  await Promise.all([getBehaviorLog(), readProfiles(), readKeywordWeights()]);
}

// 清空内存缓存（导入/清除数据后调用）
export function resetBehaviorMemory() {
  behaviorCache = { log: null, profiles: null, keywordWeights: null };
  dataVersion++;
}

// --- 游戏画像 / Game Profiles ---
// 更新游戏画像（view/download 事件） / Update a game profile
export async function updateGameProfile(gameInfo) {
  const stored = await dataStore.readModule(DB_KEYS.GAME_PROFILES);
  const profiles = stored || {};

  const key = gameInfo.name.toLowerCase().trim();
  if (!profiles[key]) {
    profiles[key] = {
      name: gameInfo.name,
      views: 0,
      downloads: 0,
      keywords: [],
      steamAppId: null,
      steamRating: null,
      lastSeen: Date.now()
    };
  }

  const profile = profiles[key];
  if (gameInfo.event === 'view') profile.views++;
  if (gameInfo.event === 'download') profile.downloads++;
  // v6.3.2 C3：不感兴趣负信号（推荐反馈循环）
  if (gameInfo.event === 'dislike') profile.disliked = true;
  if (gameInfo.keywords) {
    profile.keywords = [...new Set([...profile.keywords, ...gameInfo.keywords])];
  }
  if (gameInfo.steamAppId) profile.steamAppId = gameInfo.steamAppId;
  if (gameInfo.steamRating) profile.steamRating = gameInfo.steamRating;
  profile.lastSeen = Date.now();

  await dataStore.writeModule(DB_KEYS.GAME_PROFILES, profiles);
  behaviorCache.profiles = profiles; // v7.0.4：写回内存缓存（读写一致）
  bumpVersion();
  return profiles;
}

// --- 偏好模型 / User Preference Model ---
// 偏好模型更新节流：高频事件（view_list）限制为每 60s 最多一次
// Preference-model throttle: at most once per 60s
let lastPrefUpdate = 0;

// v5.0.0：重置偏好节流状态（导入/恢复备份后调用——此前不在重置清单内，
// 恢复后 60s 内偏好模型可能残留旧节流不更新）
export function resetBehaviorState() {
  lastPrefUpdate = 0;
}

export async function maybeUpdatePreferences(force = false) {
  const now = Date.now();
  if (!force && now - lastPrefUpdate < PREF_UPDATE_INTERVAL) return;
  lastPrefUpdate = now;
  await updateUserPreferences();
}

// 更新关键词权重模型（下载 +2、只看未下载 +1，pos/(pos+neg+1) 归一）
// Update keyword weights (downloads +2, views-only +1; pos/(pos+neg+1))
async function updateUserPreferences() {
  const log = await getBehaviorLog();
  const stored = await dataStore.readModule(DB_KEYS.KEYWORD_WEIGHTS);
  const keywordWeights = stored || {};

  const positiveKeywords = {};
  const negativeKeywords = {};

  // 关键词用 Set 去重，避免重复查看放大信号
  const gameEvents = {};
  log.forEach((entry) => {
    if (!gameEvents[entry.gameName]) {
      gameEvents[entry.gameName] = { viewed: false, downloaded: false, keywords: new Set() };
    }
    if (entry.type === 'view_detail') {
      gameEvents[entry.gameName].viewed = true;
      if (entry.keywords) {
        entry.keywords.forEach((kw) => gameEvents[entry.gameName].keywords.add(kw));
      }
    }
    if (entry.type === 'click_download') {
      gameEvents[entry.gameName].downloaded = true;
    }
  });

  Object.values(gameEvents).forEach((game) => {
    game.keywords.forEach((kw) => {
      if (game.downloaded) {
        positiveKeywords[kw] = (positiveKeywords[kw] || 0) + 2;
      } else if (game.viewed) {
        negativeKeywords[kw] = (negativeKeywords[kw] || 0) + 1;
      }
    });
  });

  Object.keys(positiveKeywords).forEach((kw) => {
    const pos = positiveKeywords[kw] || 0;
    const neg = negativeKeywords[kw] || 0;
    keywordWeights[kw] = pos / (pos + neg + 1);
  });

  await dataStore.writeModule(DB_KEYS.KEYWORD_WEIGHTS, keywordWeights);
  behaviorCache.keywordWeights = keywordWeights; // v7.0.4：写回内存缓存
  bumpVersion();
  return keywordWeights;
}
