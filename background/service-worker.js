/**
 * Game Recommender - Background Service Worker
 * 负责数据管理、Steam API调用、推荐计算协调
 *
 * 代码结构：
 *   1. 常量与配置
 *   2. 存储管理
 *   3. Steam 缓存工具
 *   4. 运行日志
 *   5. 自动备份
 *   6. 行为日志与游戏画像
 *   7. 用户偏好模型
 *   8. 游戏标题解析
 *   9. Steam API 子模块（搜索/详情/HTML解析/评测/SteamDB/SteamSpy）
 *  10. Steam API 编排器（searchSteamGame / getSteamPositiveRate）
 *  11. 推荐算法引擎
 *  12. 下载站搜索
 *  13. 限免游戏
 *  14. 消息处理（handler map）
 *  15. 初始化
 */

// ============ 1. 常量与配置 ============

const DB_KEYS = {
  BEHAVIOR_LOG: 'behaviorLog',
  GAME_PROFILES: 'gameProfiles',
  USER_PREFERENCES: 'userPrefs',
  SETTINGS: 'settings',
  STEAM_CACHE: 'steamCache',
  KEYWORD_WEIGHTS: 'keywordWeights',
  FREE_GAMES: 'freeGames',
  RUNTIME_LOG: 'runtimeLog',
  BACKUPS: 'backups',
  DOWNLOAD_HISTORY: 'downloadHistory'
};

const DEFAULT_SETTINGS = {
  enabled: true,
  showDebugPanel: false,
  highlightThreshold: 0.6,
  maxBehaviorLog: 500,
  steamApiKey: '',
  useLLM: false,
  llmConfig: {
    provider: 'local',
    endpoint: 'http://localhost:11434/api/generate',
    apiKey: '',
    model: 'qwen2.5:7b',
    temperature: 0.3
  },
  weights: {
    clickRate: 0.2,
    downloadRate: 0.35,
    keywordMatch: 0.25,
    steamRating: 0.2
  },
  trackedSites: [
    '3dmgame.com', 'ali213.net', 'gamersky.com', 'yystv.cn',
    'fitgirl-repacks.site', 'rutracker.org',
    'gamer520.com', 'xianyudanji.gg', 'xdgame.com'
  ],
  enableLog: true,
  maxRuntimeLog: 300,
  autoBackup: true,
  backupIntervalHours: 24,
  maxBackups: 7,
  minSteamRatingFilter: 0, // 列表页最低Steam好评率过滤（0-100，0表示不过滤）
  enableRatingFilter: false // 是否启用好评率过滤
};

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const BACKUP_DATA_KEYS = [
  DB_KEYS.BEHAVIOR_LOG,
  DB_KEYS.GAME_PROFILES,
  DB_KEYS.USER_PREFERENCES,
  DB_KEYS.SETTINGS,
  DB_KEYS.KEYWORD_WEIGHTS,
  DB_KEYS.FREE_GAMES
];

// Steam缓存版本号（匹配逻辑变更时递增，使旧缓存自动失效）
// v3: 修复 parseGameTitle 拆分逻辑导致的误匹配（如 "王国历史：三国志" 被误识别为 "全面战争：三国"）
const STEAM_CACHE_VERSION = 3;
const STEAM_CACHE_TTL = 7 * 24 * 3600 * 1000; // 7天

// 下载站配置
const DOWNLOAD_SITES = [
  { key: 'xdgame',      name: 'XDGame',   searchUrl: q => `https://xdgame.com/so/${encodeURIComponent(q)}.html`,     base: 'https://xdgame.com' },
  { key: 'xianyudanji', name: '咸鱼单机', searchUrl: q => `https://www.xianyudanji.gg/?s=${encodeURIComponent(q)}`,   base: 'https://www.xianyudanji.gg' },
  { key: 'gamer520',    name: 'Gamer520', searchUrl: q => `https://www.gamer520.com/?s=${encodeURIComponent(q)}`,     base: 'https://www.gamer520.com' }
];

// ============ 2. 存储管理 ============

let settingsCache = null;
let settingsCacheTime = 0;
const SETTINGS_CACHE_TTL = 5000; // 5秒缓存

async function initStorage() {
  const data = await chrome.storage.local.get(DB_KEYS.SETTINGS);
  if (!data[DB_KEYS.SETTINGS]) {
    await chrome.storage.local.set({ [DB_KEYS.SETTINGS]: DEFAULT_SETTINGS });
  }
}

async function getSettings() {
  const now = Date.now();
  if (settingsCache && (now - settingsCacheTime < SETTINGS_CACHE_TTL)) {
    return settingsCache;
  }
  const data = await chrome.storage.local.get(DB_KEYS.SETTINGS);
  settingsCache = { ...DEFAULT_SETTINGS, ...(data[DB_KEYS.SETTINGS] || {}) };
  settingsCacheTime = now;
  return settingsCache;
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ [DB_KEYS.SETTINGS]: settings });
  settingsCache = { ...DEFAULT_SETTINGS, ...settings };
  settingsCacheTime = Date.now();
}

// ============ 3. Steam 缓存工具 ============

function isSteamCacheValid(entry) {
  return entry &&
    entry.version === STEAM_CACHE_VERSION &&
    (Date.now() - entry.timestamp < STEAM_CACHE_TTL);
}

async function getSteamCacheEntry(cacheKey) {
  const cacheData = await chrome.storage.local.get(DB_KEYS.STEAM_CACHE);
  const cache = cacheData[DB_KEYS.STEAM_CACHE] || {};
  return cache[cacheKey] || null;
}

async function setSteamCacheEntry(cacheKey, data) {
  const cacheData = await chrome.storage.local.get(DB_KEYS.STEAM_CACHE);
  const cache = cacheData[DB_KEYS.STEAM_CACHE] || {};
  cache[cacheKey] = { data, timestamp: Date.now(), version: STEAM_CACHE_VERSION };
  await chrome.storage.local.set({ [DB_KEYS.STEAM_CACHE]: cache });
}

// ============ 4. 运行日志 ============

async function writeLog(level, module, message, data) {
  try {
    const settings = await getSettings();
    if (!settings.enableLog) return;

    const entry = { timestamp: Date.now(), level, module, message };
    if (data !== undefined) {
      try {
        const s = typeof data === 'string' ? data : JSON.stringify(data);
        entry.data = s.length > 500 ? s.substring(0, 500) + '...' : s;
      } catch (e) { entry.data = String(data); }
    }

    const stored = await chrome.storage.local.get(DB_KEYS.RUNTIME_LOG);
    const logs = stored[DB_KEYS.RUNTIME_LOG] || [];
    logs.push(entry);

    const max = settings.maxRuntimeLog || 300;
    while (logs.length > max) logs.shift();

    await chrome.storage.local.set({ [DB_KEYS.RUNTIME_LOG]: logs });
  } catch (e) {
    // 日志写入失败不应影响主流程
  }
}

const Logger = {
  debug: (module, msg, data) => writeLog('debug', module, msg, data),
  info:  (module, msg, data) => writeLog('info', module, msg, data),
  warn:  (module, msg, data) => writeLog('warn', module, msg, data),
  error: (module, msg, data) => writeLog('error', module, msg, data)
};

async function getRuntimeLogs(limit) {
  const stored = await chrome.storage.local.get(DB_KEYS.RUNTIME_LOG);
  const logs = stored[DB_KEYS.RUNTIME_LOG] || [];
  return limit ? logs.slice(-limit) : logs;
}

async function clearRuntimeLogs() {
  await chrome.storage.local.set({ [DB_KEYS.RUNTIME_LOG]: [] });
}

// ============ 5. 自动备份 ============

async function createBackup(manual = false) {
  try {
    const data = await chrome.storage.local.get(BACKUP_DATA_KEYS);
    const snapshot = {};
    for (const key of BACKUP_DATA_KEYS) {
      if (data[key] !== undefined) snapshot[key] = data[key];
    }

    const backup = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      timestamp: Date.now(),
      manual,
      size: JSON.stringify(snapshot).length,
      data: snapshot
    };

    const stored = await chrome.storage.local.get(DB_KEYS.BACKUPS);
    const backups = stored[DB_KEYS.BACKUPS] || [];
    backups.push(backup);

    const settings = await getSettings();
    const max = settings.maxBackups || 7;
    while (backups.length > max) backups.shift();

    await chrome.storage.local.set({ [DB_KEYS.BACKUPS]: backups });
    Logger.info('Backup', `创建${manual ? '手动' : '自动'}备份 ${backup.id}`, { size: backup.size, count: backups.length });
    return backup;
  } catch (e) {
    Logger.error('Backup', '创建备份失败', e.message);
    return null;
  }
}

async function getBackupList() {
  const stored = await chrome.storage.local.get(DB_KEYS.BACKUPS);
  const backups = stored[DB_KEYS.BACKUPS] || [];
  return backups.map(b => ({
    id: b.id, timestamp: b.timestamp, manual: b.manual, size: b.size
  })).reverse();
}

async function restoreBackup(backupId) {
  try {
    const stored = await chrome.storage.local.get(DB_KEYS.BACKUPS);
    const backups = stored[DB_KEYS.BACKUPS] || [];
    const backup = backups.find(b => b.id === backupId);
    if (!backup || !backup.data) {
      Logger.warn('Backup', `备份不存在: ${backupId}`);
      return { success: false, error: '备份不存在' };
    }

    // 恢复前先创建当前状态的备份（安全网）
    await createBackup(true);

    await chrome.storage.local.set(backup.data);
    Logger.info('Backup', `已恢复备份 ${backupId}`);
    return { success: true };
  } catch (e) {
    Logger.error('Backup', '恢复备份失败', e.message);
    return { success: false, error: e.message };
  }
}

async function deleteBackup(backupId) {
  const stored = await chrome.storage.local.get(DB_KEYS.BACKUPS);
  let backups = stored[DB_KEYS.BACKUPS] || [];
  backups = backups.filter(b => b.id !== backupId);
  await chrome.storage.local.set({ [DB_KEYS.BACKUPS]: backups });
  return { success: true };
}

// ============ 6. 行为日志与游戏画像 ============

async function addBehaviorLog(entry) {
  const data = await chrome.storage.local.get(DB_KEYS.BEHAVIOR_LOG);
  const log = data[DB_KEYS.BEHAVIOR_LOG] || [];

  entry.timestamp = Date.now();
  log.push(entry);

  const settings = await getSettings();
  while (log.length > settings.maxBehaviorLog) {
    log.shift();
  }

  await chrome.storage.local.set({ [DB_KEYS.BEHAVIOR_LOG]: log });
  return log;
}

async function getBehaviorLog() {
  const data = await chrome.storage.local.get(DB_KEYS.BEHAVIOR_LOG);
  return data[DB_KEYS.BEHAVIOR_LOG] || [];
}

async function updateGameProfile(gameInfo) {
  const data = await chrome.storage.local.get(DB_KEYS.GAME_PROFILES);
  const profiles = data[DB_KEYS.GAME_PROFILES] || {};

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
  if (gameInfo.keywords) {
    profile.keywords = [...new Set([...profile.keywords, ...gameInfo.keywords])];
  }
  if (gameInfo.steamAppId) profile.steamAppId = gameInfo.steamAppId;
  if (gameInfo.steamRating) profile.steamRating = gameInfo.steamRating;
  profile.lastSeen = Date.now();

  await chrome.storage.local.set({ [DB_KEYS.GAME_PROFILES]: profiles });
  return profiles;
}

// ============ 7. 用户偏好模型 ============

async function updateUserPreferences() {
  const log = await getBehaviorLog();
  const data = await chrome.storage.local.get(DB_KEYS.KEYWORD_WEIGHTS);
  const keywordWeights = data[DB_KEYS.KEYWORD_WEIGHTS] || {};

  const positiveKeywords = {};  // 下载过的游戏的关键词
  const negativeKeywords = {};  // 看过但没下载的关键词

  const gameEvents = {};
  log.forEach(entry => {
    if (!gameEvents[entry.gameName]) {
      gameEvents[entry.gameName] = { viewed: false, downloaded: false, keywords: [] };
    }
    if (entry.type === 'view_detail') {
      gameEvents[entry.gameName].viewed = true;
      if (entry.keywords) gameEvents[entry.gameName].keywords.push(...entry.keywords);
    }
    if (entry.type === 'click_download') {
      gameEvents[entry.gameName].downloaded = true;
    }
  });

  Object.values(gameEvents).forEach(game => {
    game.keywords.forEach(kw => {
      if (game.downloaded) {
        positiveKeywords[kw] = (positiveKeywords[kw] || 0) + 2;
      } else if (game.viewed) {
        negativeKeywords[kw] = (negativeKeywords[kw] || 0) + 1;
      }
    });
  });

  Object.keys(positiveKeywords).forEach(kw => {
    const pos = positiveKeywords[kw] || 0;
    const neg = negativeKeywords[kw] || 0;
    keywordWeights[kw] = pos / (pos + neg + 1);
  });

  await chrome.storage.local.set({ [DB_KEYS.KEYWORD_WEIGHTS]: keywordWeights });
  return keywordWeights;
}

// ============ 8. 游戏标题解析 ============

function parseGameTitle(rawName) {
  if (!rawName) return [];

  let name = rawName.trim();

  name = name.replace(/[\(\(\[\【].*?[\)\)\]\】]/g, '');
  name = name.replace(/[《》]/g, '');

  // 只按 | 和 " - "/" – "/" — " 分段，不再按 : ： / 、 拆分
  // 避免 "王国历史：三国志"、"History of Kingdoms: Three Kingdoms" 等含冒号的完整名字被误拆
  const rawParts = name.split(/[|]+|\s+[-–—]\s+/).map(s => s.trim()).filter(s => s.length > 1);

  const noisePattern = /(中文|汉化|破解|免安装|绿色|学习|未加密|完整版|豪华版|豪华|终极|数字|典藏|年度|重制|复刻|增强|正式|官方|简繁|简体|繁体|中英|多语言|特别版|标准版|解压即撸|预购特典|预购|特典|版|v[\d.]+|V[\d.]+|\d+\.\d+[\d.]*|Build[.\s]*\d+|update\s*\d+|DLC.*|全DLC|整合|硬盘|免DVD|CODEX|FLT|RELOADED|SKIDROW|EMPRESS|GOG|Razor1911|FitGirl|\d+\s*GB|百度网盘|网盘|下载|迅雷|磁力|BT|种子|免安装绿色版|\s+The\s+Game\s*)/gi;

  // 判断整段是否仅由噪声词组成（如 "官方中文"、"中文版"、"v1.0"）
  function isPureNoise(text) {
    const stripped = text.replace(noisePattern, '').replace(/[\s\|\-:：、]+/g, '');
    return stripped.length === 0;
  }

  const candidates = [];
  const seen = new Set();
  function addCandidate(text) {
    const t = text.trim().replace(/\s+/g, ' ');
    if (t.length >= 2 && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      candidates.push(t);
    }
  }

  // 遍历每一段：跳过纯噪声段，对有效段同时保留整段清洗后的主名 + 中英子串作为候选
  for (const part of rawParts) {
    if (isPureNoise(part)) continue;

    // 1) 整段清洗后作为候选（保留主名，去掉噪声词）
    const cleaned = part.replace(noisePattern, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned.length >= 2) addCandidate(cleaned);

    // 2) 提取英文子串作为补充候选
    const en = part.match(/[A-Za-z][A-Za-z0-9\s':&.!\-]+[A-Za-z0-9'.!]?/g);
    if (en) en.forEach(m => {
      const cleanedEn = m.replace(noisePattern, ' ').replace(/\s+/g, ' ').trim();
      if (cleanedEn.length >= 2) addCandidate(cleanedEn);
    });

    // 3) 提取中文子串作为补充候选
    const cn = part.match(/[\u4e00-\u9fff\u3400-\u4dbf][\u4e00-\u9fff\u3400-\u4dbf0-9\s:：!！]+/g);
    if (cn) cn.forEach(m => addCandidate(m.trim()));
  }

  if (candidates.length === 0) {
    addCandidate(name.replace(noisePattern, ' ').replace(/\s+/g, ' ').trim());
  }

  const junkPattern = /^(豪华|解压即撸|预购特典|预购|特典|中文|汉化|破解|免安装|绿色|完整版|豪华版|终极|build[.\s]*\d+|\d+[\d.]*|v[\d.]+)$/i;
  const filtered = candidates.filter(c => !junkPattern.test(c.trim()));
  const finalCandidates = filtered.length > 0 ? filtered : candidates;

  const first = finalCandidates[0];
  const rest = finalCandidates.slice(1);
  // 优先英文（更易在Steam搜到），同语言时按长度降序（更具体的名字优先）
  rest.sort((a, b) => {
    const aIsEnglish = /^[A-Za-z]/.test(a);
    const bIsEnglish = /^[A-Za-z]/.test(b);
    if (aIsEnglish && !bIsEnglish) return -1;
    if (!aIsEnglish && bIsEnglish) return 1;
    return b.length - a.length;
  });

  return [first, ...rest].slice(0, 5);
}

function cleanGameName(name) {
  const candidates = parseGameTitle(name);
  return candidates[0] || name || '';
}

// ============ 9. Steam API 子模块 ============

// --- 搜索 ---

async function searchSteamAppId(searchTerms) {
  for (const term of searchTerms) {
    const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=schinese&cc=cn`;
    const response = await fetch(searchUrl);
    const data = await response.json();
    if (data.total > 0 && data.items && data.items[0]) {
      return { appId: data.items[0].id, name: data.items[0].name };
    }
  }
  return null;
}

// --- 应用详情 ---

async function fetchSteamAppDetails(appId) {
  const detailUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=schinese`;
  const response = await fetch(detailUrl);
  const detailData = await response.json();
  if (!detailData[appId] || !detailData[appId].success) return null;
  return detailData[appId].data;
}

// --- 商店页面 HTML ---

async function fetchStorePageHtml(appId) {
  try {
    const storePageUrl = `https://store.steampowered.com/app/${appId}/?cc=cn&l=schinese`;
    const resp = await fetch(storePageUrl, { headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' } });
    return await resp.text();
  } catch (e) {
    console.log('获取商店页面失败:', e);
    return '';
  }
}

// --- 中文语言支持解析 ---

function parseChineseLanguageSupport(storeHtml, gameData) {
  let chineseSupported = false;
  let simplifiedChinese = false;
  let chineseHasAudio = false;
  let chineseHasSubtitles = false;

  // 方法1：解析商店页语言支持表 (game_language_options)
  if (storeHtml) {
    const langTableMatch = storeHtml.match(/<table[^>]*class="[^"]*game_language_options[^"]*"[\s\S]*?<\/table>/i);
    if (langTableMatch) {
      const langTable = langTableMatch[0];
      const rows = langTable.match(/<tr[\s\S]*?<\/tr>/gi) || [];
      for (const row of rows) {
        const isSimplifiedRow = /简体中文|Chinese\s*\(Simplified\)/i.test(row);
        const isChineseRow = /中文|Chinese/i.test(row) && !/繁体|Traditional/i.test(row);
        if (isSimplifiedRow || isChineseRow) {
          const hasCheck = /✓|&#10003;|class="[^"]*check/i.test(row);
          const cells = row.match(/<td[\s\S]*?<\/td>/gi) || [];
          if (hasCheck || cells.some(c => /✓|&#10003;|check/i.test(c))) {
            chineseSupported = true;
            if (isSimplifiedRow) simplifiedChinese = true;
            if (cells.length >= 3) {
              chineseHasAudio = /✓|&#10003;|check/i.test(cells[2] || '');
              chineseHasSubtitles = /✓|&#10003;|check/i.test(cells[3] || '');
            }
          }
        }
      }
    }
  }

  // 方法2：回退到 supported_languages 字段
  if (!chineseSupported) {
    const supportedLangs = gameData.supported_languages || '';
    const cleanLangs = supportedLangs.replace(/<[^>]+>/g, ' ');
    chineseSupported = /简体中文|繁体中文|Chinese|中文/i.test(cleanLangs);
    simplifiedChinese = /简体中文|Simplified\s*Chinese/i.test(cleanLangs);
  }

  return { chineseSupported, simplifiedChinese, chineseHasAudio, chineseHasSubtitles };
}

// --- 用户标签解析 ---

function parseUserTags(storeHtml) {
  if (!storeHtml) return [];
  const tagMatches = storeHtml.match(/<a[^>]*class="[^"]*app_tag[^"]*"[^>]*>[\s\S]*?<\/a>/gi);
  if (!tagMatches) return [];

  const seenTags = new Set();
  return tagMatches
    .map(m => m
      .replace(/<[^>]+>/g, '')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(t => {
      if (t.length < 1 || t.length > 30) return false;
      const lower = t.toLowerCase();
      if (seenTags.has(lower)) return false;
      seenTags.add(lower);
      return true;
    })
    .slice(0, 10);
}

// --- 评测获取 ---

async function fetchReviewSummary(appId) {
  try {
    const reviewUrl = `https://store.steampowered.com/appreviews/${appId}?json=1&language=all&num_per_page=0`;
    const response = await fetch(reviewUrl);
    const data = await response.json();
    if (data.success === 1 && data.query_summary) {
      const qs = data.query_summary;
      return {
        total: qs.total_reviews,
        positive: qs.total_positive,
        negative: qs.total_negative,
        score: qs.review_score,
        desc: qs.review_score_desc
      };
    }
  } catch (e) {
    console.log('获取总体评价失败:', e);
  }
  return null;
}

async function fetchChineseReviews(appId) {
  let cnReviewSummary = null;
  let chineseReviews = [];
  try {
    const cnReviewUrl = `https://store.steampowered.com/appreviews/${appId}?json=1&language=schinese&num_per_page=10&filter=all`;
    const resp = await fetch(cnReviewUrl);
    const data = await resp.json();
    if (data.success === 1) {
      if (data.reviews && data.reviews.length > 0) {
        chineseReviews = data.reviews.slice(0, 5).map(r => ({
          recommended: r.voted_up === true,
          text: r.review.substring(0, 200),
          author: r.author?.steamid || '匿名',
          language: 'schinese'
        }));
      }
      if (data.query_summary) {
        const qs = data.query_summary;
        cnReviewSummary = {
          total: qs.total_reviews,
          positive: qs.total_positive,
          negative: qs.total_negative,
          score: qs.review_score,
          desc: qs.review_score_desc,
          positiveRate: qs.total_reviews > 0
            ? Math.round(qs.total_positive / qs.total_reviews * 100)
            : null
        };
      }
    }
  } catch (e) {
    console.log('获取中文评价失败:', e);
  }
  return { cnReviewSummary, chineseReviews };
}

async function fetchSteamReviews(appId) {
  const [reviewSummary, cnData] = await Promise.all([
    fetchReviewSummary(appId),
    fetchChineseReviews(appId)
  ]);
  return {
    reviewSummary,
    cnReviewSummary: cnData.cnReviewSummary,
    chineseReviews: cnData.chineseReviews
  };
}

// --- SteamDB 信息 ---

async function fetchSteamDbInfo(appId) {
  const steamdbUrl = `https://steamdb.info/app/${appId}/`;
  try {
    const resp = await fetch(steamdbUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    });
    const html = await resp.text();
    const isBlocked = !resp.ok ||
      /Just a moment|cf-browser-verification|challenge-platform|Checking your browser|Attention Required/i.test(html);

    if (isBlocked) {
      return { url: steamdbUrl, available: false, blocked: true };
    }

    const ratingMatch = html.match(/<div[^>]*class="[^"]*header-rating[^"]*"[^>]*>\s*<span[^>]*>([\d.]+)%?<\/span>/i) ||
                        html.match(/([\d.]+)%\s*(?:positive|好评)/i);
    const playersMatch = html.match(/([\d,]+)\s*(?:players|人在玩)/i);
    const priceMatch = html.match(/Lowest Price[\s\S]*?([\d.,]+\s*(?:¥|\$|USD|CNY))/i);
    const reviewCountMatch = html.match(/([\d,]+)\s*(?:reviews|评测|评价)/i);

    return {
      url: steamdbUrl,
      rating: ratingMatch ? ratingMatch[1] : null,
      reviewCount: reviewCountMatch ? reviewCountMatch[1] : null,
      currentPlayers: playersMatch ? playersMatch[1] : null,
      lowestPrice: priceMatch ? priceMatch[1] : null,
      available: true,
      blocked: false
    };
  } catch (e) {
    console.log('SteamDB获取失败:', e.message);
    return { url: steamdbUrl, available: false, blocked: true };
  }
}

// --- SteamSpy 信息（SteamDB 被拦截时的补充数据） ---

async function fetchSteamSpyInfo(appId) {
  try {
    const resp = await fetch(`https://steamspy.com/api.php?request=appdetails&appid=${appId}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data || !data.appid) return null;

    const total = (data.positive || 0) + (data.negative || 0);
    return {
      positiveRate: total > 0 ? Math.round(data.positive / total * 100) : null,
      reviewCount: total > 0 ? total.toLocaleString() : null,
      players2weeks: data.players_2weeks ? data.players_2weeks.toLocaleString() : null,
      playersForever: data.players_forever ? data.players_forever.toLocaleString() : null,
      averagePlaytime: data.average_forever ? Math.round(data.average_forever / 60) + '小时' : null
    };
  } catch (e) {
    console.log('SteamSpy获取失败:', e.message);
    return null;
  }
}

// --- 组装最终结果对象 ---

function buildSteamResult(appId, gameData, langInfo, userTags, reviews, steamdbInfo, steamspyInfo) {
  const { reviewSummary, cnReviewSummary, chineseReviews } = reviews;
  const { chineseSupported, simplifiedChinese, chineseHasAudio, chineseHasSubtitles } = langInfo;

  return {
    appId,
    name: gameData.name,
    url: `https://store.steampowered.com/app/${appId}/`,
    steamdbUrl: steamdbInfo?.url || `https://steamdb.info/app/${appId}/`,
    rating: reviewSummary ? reviewSummary.score : null,
    ratingDesc: reviewSummary ? reviewSummary.desc : null,
    totalReviews: reviewSummary ? reviewSummary.total : 0,
    positiveRate: reviewSummary && reviewSummary.total > 0
      ? Math.round(reviewSummary.positive / reviewSummary.total * 100)
      : null,
    cnRatingDesc: cnReviewSummary ? cnReviewSummary.desc : null,
    cnPositiveRate: cnReviewSummary ? cnReviewSummary.positiveRate : null,
    cnTotalReviews: cnReviewSummary ? cnReviewSummary.total : 0,
    reviews: chineseReviews,
    genres: (gameData.genres || []).map(g => g.description),
    userTags,
    chineseSupported,
    simplifiedChinese,
    chineseHasAudio,
    chineseHasSubtitles,
    releaseDate: gameData.release_date?.date || '',
    developers: gameData.developers || [],
    description: gameData.short_description || '',
    headerImage: gameData.header_image || '',
    steamdb: steamdbInfo,
    steamspy: steamspyInfo
  };
}

// ============ 10. Steam API 编排器 ============

async function searchSteamGame(gameName) {
  const cacheKey = gameName.toLowerCase().trim();

  // 1. 检查缓存（仅使用完整数据：必须包含url和appId）
  const cached = await getSteamCacheEntry(cacheKey);
  if (isSteamCacheValid(cached) && cached.data && cached.data.url && cached.data.appId) {
    return cached.data;
  }

  try {
    // 2. 搜索 appId
    const searchTerms = parseGameTitle(gameName);
    const searchResult = await searchSteamAppId(searchTerms);
    if (!searchResult) return null;
    const { appId } = searchResult;

    // 3. 获取应用详情
    const gameData = await fetchSteamAppDetails(appId);
    if (!gameData) return null;

    // 4. 获取商店页 HTML（用于解析语言支持 + 用户标签）
    const storeHtml = await fetchStorePageHtml(appId);

    // 5. 并行获取：语言支持、用户标签、评测
    const [langInfo, userTags, reviews] = await Promise.all([
      Promise.resolve(parseChineseLanguageSupport(storeHtml, gameData)),
      Promise.resolve(parseUserTags(storeHtml)),
      fetchSteamReviews(appId)
    ]);

    // 6. 获取 SteamDB 信息
    const steamdbInfo = await fetchSteamDbInfo(appId);

    // 7. SteamDB 被拦截时，使用 SteamSpy 补充
    const steamspyInfo = (!steamdbInfo || !steamdbInfo.available)
      ? await fetchSteamSpyInfo(appId)
      : null;

    // 8. 组装结果
    const result = buildSteamResult(appId, gameData, langInfo, userTags, reviews, steamdbInfo, steamspyInfo);

    // 9. 缓存结果
    await setSteamCacheEntry(cacheKey, result);

    return result;
  } catch (error) {
    console.error('Steam API 调用失败:', error);
    return null;
  }
}

// 轻量级Steam好评率查询（列表页用，复用缓存，仅获取好评率不做完整详情抓取）
async function getSteamPositiveRate(gameName) {
  if (!gameName) return null;
  const cacheKey = gameName.toLowerCase().trim();

  // 检查缓存（复用 searchSteamGame 的缓存）
  const cached = await getSteamCacheEntry(cacheKey);
  if (isSteamCacheValid(cached) && cached.data && cached.data.positiveRate !== undefined) {
    return {
      positiveRate: cached.data.positiveRate,
      ratingDesc: cached.data.ratingDesc || null,
      appId: cached.data.appId || null,
      name: cached.data.name || gameName
    };
  }

  try {
    // 搜索 appId
    const searchResult = await searchSteamAppId(parseGameTitle(gameName));
    if (!searchResult) {
      // 缓存"未找到"避免重复搜索
      await setSteamCacheEntry(cacheKey, { positiveRate: null, name: gameName });
      return null;
    }
    const { appId, name: foundName } = searchResult;

    // 获取评价统计（好评率）
    const reviewSummary = await fetchReviewSummary(appId);
    let positiveRate = null;
    let ratingDesc = null;
    if (reviewSummary) {
      ratingDesc = reviewSummary.desc || null;
      if (reviewSummary.total > 0) {
        positiveRate = Math.round(reviewSummary.positive / reviewSummary.total * 100);
      }
    }

    // 合并缓存（保留可能已有的完整数据）
    const existingData = (cached && cached.data) ? cached.data : {};
    await setSteamCacheEntry(cacheKey, {
      ...existingData, appId, name: foundName, positiveRate, ratingDesc
    });

    return { positiveRate, ratingDesc, appId, name: foundName };
  } catch (e) {
    console.log('获取Steam好评率失败:', e.message);
    return null;
  }
}

// ============ 11. 推荐算法引擎 ============

// 关键词评分计算（提取为公共方法，消除重复逻辑）
function calculateKeywordScore(keywords, keywordWeights) {
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

async function calculateRecommendation(gameInfo, forceBuiltin = false) {
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
  const data = await chrome.storage.local.get([
    DB_KEYS.BEHAVIOR_LOG,
    DB_KEYS.KEYWORD_WEIGHTS,
    DB_KEYS.GAME_PROFILES
  ]);

  const behaviorLog = data[DB_KEYS.BEHAVIOR_LOG] || [];
  const keywordWeights = data[DB_KEYS.KEYWORD_WEIGHTS] || {};
  const profiles = data[DB_KEYS.GAME_PROFILES] || {};

  // 1. 点击率得分
  let clickScore = 0.5;
  const totalViews = behaviorLog.filter(e => e.type === 'view_list').length;
  const totalClicks = behaviorLog.filter(e => e.type === 'view_detail').length;
  if (totalViews > 0) {
    clickScore = Math.min(totalClicks / totalViews, 1);
  }

  // 2. 下载率得分
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
    if (profileMatch.downloads > 0) {
      downloadScore = Math.min(downloadScore + 0.3, 1);
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

// ============ LLM 计算 ============

async function calculateWithLLM(gameInfo, settings) {
  const { llmConfig } = settings;

  const kwData = await chrome.storage.local.get(DB_KEYS.KEYWORD_WEIGHTS);
  const keywordWeights = kwData[DB_KEYS.KEYWORD_WEIGHTS] || {};
  const topKeywords = Object.entries(keywordWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([kw, w]) => `${kw}(${Math.round(w * 100)}%)`)
    .join('、');

  const prompt = buildLLMPrompt(gameInfo, topKeywords);

  let response;
  if (llmConfig.provider === 'local') {
    // Ollama 本地模型
    response = await fetch(llmConfig.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: llmConfig.model,
        prompt,
        stream: false,
        options: { temperature: llmConfig.temperature }
      })
    });
    const data = await response.json();
    return parseLLMResponse(data.response);
  } else {
    // OpenAI兼容接口
    response = await fetch(llmConfig.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${llmConfig.apiKey}`
      },
      body: JSON.stringify({
        model: llmConfig.model,
        messages: [
          { role: 'system', content: '你是一个游戏推荐评分系统。根据用户的游戏偏好和游戏信息，给出0-1之间的下载概率评分。只返回JSON格式：{"score": 0.85, "reason": "简短理由"}' },
          { role: 'user', content: prompt }
        ],
        temperature: llmConfig.temperature
      })
    });
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

// ============ 12. 下载站搜索 ============

function calcLinkMatchScore(linkText, searchName) {
  const norm = s => (s || '').toLowerCase().replace(/[\s\-_:：|\/\.''!！?？\[\]()（）]/g, '');
  const nt = norm(linkText);
  const ns = norm(searchName);
  if (!nt || !ns || nt.length < 2 || ns.length < 2) return 0;
  if (nt === ns) return 100;
  if (nt.includes(ns)) return 85;
  if (ns.includes(nt) && nt.length >= 4) return 70;

  // 分段比较（按 | 和 / 拆分的每一段）
  const segments = linkText.split(/[|\/]/).map(s => norm(s)).filter(s => s.length >= 2);
  for (const seg of segments) {
    if (seg === ns) return 95;
    if (seg.includes(ns)) return 80;
    if (ns.includes(seg) && seg.length >= 4) return 65;
  }

  // 跨语言匹配：分别提取中英文，独立比较
  // 用于处理 "History of Kingdoms: 三国志"(搜索名) vs "王国历史：三国志|...|History of Kingdoms: Three Kingdoms"(链接名)
  // 这种字符顺序不同但内容对应的情况
  function splitLang(s) {
    const en = (s.match(/[a-z][a-z0-9\s']+/gi) || []).map(m => norm(m)).filter(m => m.length >= 2);
    const cn = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf]+/g) || []).map(m => m).filter(m => m.length >= 2);
    return { en, cn };
  }

  const linkLang = splitLang(linkText);
  const searchLang = splitLang(searchName);

  let enScore = 0;
  let cnScore = 0;

  if (searchLang.en.length > 0 && linkLang.en.length > 0) {
    let bestEn = 0;
    for (const se of searchLang.en) {
      for (const le of linkLang.en) {
        if (le === se) { bestEn = Math.max(bestEn, 100); }
        else if (le.includes(se) && se.length >= 4) { bestEn = Math.max(bestEn, 85); }
        else if (se.includes(le) && le.length >= 4) { bestEn = Math.max(bestEn, 75); }
      }
    }
    enScore = bestEn;
  }

  if (searchLang.cn.length > 0 && linkLang.cn.length > 0) {
    let bestCn = 0;
    for (const sc of searchLang.cn) {
      for (const lc of linkLang.cn) {
        if (lc === sc) { bestCn = Math.max(bestCn, 100); }
        else if (lc.includes(sc) && sc.length >= 2) { bestCn = Math.max(bestCn, 85); }
        else if (sc.includes(lc) && lc.length >= 2) { bestCn = Math.max(bestCn, 75); }
      }
    }
    cnScore = bestCn;
  }

  if (enScore > 0 && cnScore > 0) {
    return Math.round((enScore + cnScore) / 2);
  }
  return Math.max(enScore, cnScore);
}

function extractDetailMeta(html, siteKey) {
  const meta = { updateDate: '', version: '', size: '', panUrl: '', panCode: '' };
  if (!html) return meta;

  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1Text = h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : '';

  // 更新日期
  const dateLabelMatch = html.match(/(?:更新时间|最近更新|发布日期)[^0-9]{0,15}([0-9]{4}[-\/年][0-9]{1,2}[-\/月][0-9]{1,2})/);
  if (dateLabelMatch) {
    meta.updateDate = dateLabelMatch[1].replace(/[年月]/g, '-').replace(/日$/, '');
  }

  // 版本 + 大小（按站点适配）
  if (siteKey === 'xdgame') {
    const verIntroMatch = html.match(/版本介绍<\/h[0-9]>\s*<p>([\s\S]*?)<\/p>/i);
    if (verIntroMatch) {
      const verLine = verIntroMatch[1].replace(/<[^>]+>/g, '');
      const vMatch = verLine.match(/\b([Vv]?\d+(?:\.\d+)+)\b/) || verLine.match(/(Build\.?\d+)/i);
      if (vMatch) meta.version = vMatch[1];
      const sizeMatch = verLine.match(/容量\s*([0-9.]+\s*(?:GB|MB|TB|G\b|M\b))/i);
      if (sizeMatch) meta.size = sizeMatch[1].trim();
    }
  }

  if (!meta.version && h1Text) {
    const h1Ver = h1Text.match(/\b([Vv]\d+(?:\.\d+)+)\b/) || h1Text.match(/(Build\.?\d+)/i);
    if (h1Ver) meta.version = h1Ver[1];
  }

  if (!meta.size) {
    const sizeLabelMatch = html.match(/(?:容量|游戏大小|文件大小|资源大小)[^0-9]{0,10}([0-9.]+\s*(?:GB|MB|TB))/i);
    if (sizeLabelMatch) meta.size = sizeLabelMatch[1].trim();
  }

  // 提取网盘链接（百度/阿里/115/夸克/微云）
  // 支持 <a href="..."> 和纯文本两种形式
  const panUrlPattern = /https?:\/\/(?:pan\.baidu\.com\/(?:s\/[\w-]+|share\/init\?surl=[\w-]+)|aliyundrive\.com\/s\/[\w]+|alipan\.com\/s\/[\w]+|115\.com\/s\/[\w-]+|quark\.cn\/s\/[\w]+|weiyun\.com\/[\w]+)/i;
  const panUrlMatch = html.match(panUrlPattern);
  if (panUrlMatch) {
    meta.panUrl = panUrlMatch[0].replace(/&amp;/g, '&');

    // 在网盘链接附近查找提取码（前后各扩大一段范围）
    const idx = html.indexOf(panUrlMatch[0]);
    const nearby = html.substring(Math.max(0, idx - 300), idx + panUrlMatch[0].length + 500);
    const codeMatch = nearby.match(/(?:提取码|密码|访问码|pwd|access\s*code)[：:\s]*([a-zA-Z0-9]{4,6})/i);
    if (codeMatch) meta.panCode = codeMatch[1];
  }

  return meta;
}

async function searchDownloadSites(gameName, appId) {
  const results = [];
  // 生成多个搜索词，按优先级排序，依次尝试
  // 1. 清洗后的主名  2. parseGameTitle 的所有候选  3. 原始名
  const searchTerms = [];
  const seenTerms = new Set();
  function addTerm(t) {
    const key = t.toLowerCase().trim();
    if (key.length >= 2 && !seenTerms.has(key)) {
      seenTerms.add(key);
      searchTerms.push(t);
    }
  }
  addTerm(cleanGameName(gameName) || gameName);
  parseGameTitle(gameName).forEach(t => addTerm(t));
  addTerm(gameName);

  for (const site of DOWNLOAD_SITES) {
    const primaryTerm = searchTerms[0];
    const result = {
      key: site.key, name: site.name, found: false,
      detailUrl: '', searchUrl: site.searchUrl(primaryTerm),
      updateDate: '', version: '', size: '', panUrl: '', panCode: ''
    };
    try {
      // 依次尝试每个搜索词，找到匹配就停止
      let bestUrl = '';
      let bestScore = 0;
      let usedTerm = primaryTerm;

      for (let termIdx = 0; termIdx < searchTerms.length; termIdx++) {
        const term = searchTerms[termIdx];
        const resp = await fetch(site.searchUrl(term), {
          headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' }
        });
        if (!resp.ok) continue;
        const html = await resp.text();

        // 提取候选详情链接
        const candidates = [];
        const linkRe = /<a[^>]*href="([^"]*(?:\/\d+\.html?|\/game\/\d+[^"]*))"[^>]*>([\s\S]*?)<\/a>/gi;
        let lm;
        while ((lm = linkRe.exec(html)) !== null) {
          const href = lm[1];
          const text = lm[2].replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
          candidates.push({ href, text });
        }

        // 按文本匹配度选出最符合游戏名的链接
        for (const c of candidates) {
          // 用所有搜索词+原始名计算最高分
          let maxScore = 0;
          for (const t of searchTerms) {
            maxScore = Math.max(maxScore, calcLinkMatchScore(c.text, t));
          }
          maxScore = Math.max(maxScore, calcLinkMatchScore(c.text, gameName));
          if (maxScore > bestScore) {
            bestScore = maxScore;
            bestUrl = c.href;
            usedTerm = term;
          }
        }

        // 已经找到高分匹配，不再尝试更多搜索词
        if (bestScore >= 80) break;
      }

      // 更新搜索URL为实际使用的那个
      result.searchUrl = site.searchUrl(usedTerm);

      if (bestUrl && bestScore >= 60) {
        const detailUrl = bestUrl.startsWith('http') ? bestUrl : site.base + (bestUrl.startsWith('/') ? '' : '/') + bestUrl;
        result.found = true;
        result.detailUrl = detailUrl;
        try {
          const dResp = await fetch(detailUrl, { headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' } });
          if (dResp.ok) {
            const dHtml = await dResp.text();
            const meta = extractDetailMeta(dHtml, site.key);
            result.updateDate = meta.updateDate;
            result.version = meta.version;
            result.size = meta.size;
            result.panUrl = meta.panUrl;
            result.panCode = meta.panCode;
            // 百度网盘自动拼接提取码
            if (result.panUrl && result.panCode && /pan\.baidu\.com/i.test(result.panUrl)) {
              result.panUrl = buildBaiduPanUrlWithPwd(result.panUrl, result.panCode);
            }
          }
        } catch (e) {}
      }
    } catch (e) {
      console.log(`搜索${site.name}失败:`, e.message);
    }
    results.push(result);
  }
  return results;
}

// ============ 12.5 网盘链接深度提取（后台标签页方式） ============
//
// 由于下载站普遍需要登录、JS 动态加载、多步跳转，
// 简单 fetch 无法获取真实网盘链接，因此使用 chrome.tabs + chrome.scripting
// 在后台打开详情页、等待 JS 渲染、提取网盘链接后关闭标签。
//
// 每个站点的提取逻辑不同，按站点分别实现。

// 百度网盘链接拼接提取码，支持自动填充
function buildBaiduPanUrlWithPwd(url, pwd) {
  if (!url || !pwd) return url;
  try {
    const u = new URL(url);
    // 安全检查：只允许百度网盘域名
    if (!/pan\.baidu\.com$/i.test(u.hostname)) {
      console.warn('buildBaiduPanUrlWithPwd: 非百度网盘链接被拒绝:', url);
      return url;
    }
    // 已经有pwd参数则不重复添加
    if (u.searchParams.has('pwd')) return url;
    u.searchParams.set('pwd', pwd);
    return u.toString();
  } catch (e) {
    // URL解析失败，简单拼接
    if (url.includes('?')) {
      return url + '&pwd=' + encodeURIComponent(pwd);
    } else {
      return url + '?pwd=' + encodeURIComponent(pwd);
    }
  }
}

// 验证下载站URL的安全性
function validateDownloadSiteUrl(url, siteKey) {
  const allowedDomains = {
    xianyudanji: ['xianyudanji.gg'],
    xdgame: ['xdgame.com'],
    gamer520: ['gamer520.com', 'gamers520.com']
  };
  
  if (!allowedDomains[siteKey]) {
    console.warn('validateDownloadSiteUrl: 不支持的站点:', siteKey);
    return false;
  }
  
  try {
    const u = new URL(url);
    const domain = u.hostname.toLowerCase();
    return allowedDomains[siteKey].some(d => domain === d || domain.endsWith('.' + d));
  } catch (e) {
    console.warn('validateDownloadSiteUrl: URL解析失败:', url);
    return false;
  }
}

// 验证网盘链接的安全性
function validatePanUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    const allowedHosts = [
      'pan.baidu.com',
      'aliyundrive.com',
      'alipan.com',
      '115.com',
      'quark.cn'
    ];
    return allowedHosts.includes(u.hostname.toLowerCase());
  } catch (e) {
    return false;
  }
}

// 后台标签页提取网盘链接的主入口
async function extractPanLinkDeep(siteKey, detailUrl) {
  // 安全验证：验证站点key和URL
  if (!validateDownloadSiteUrl(detailUrl, siteKey)) {
    console.warn(`extractPanLinkDeep: 非法URL或站点 - ${siteKey}: ${detailUrl}`);
    return null;
  }

  const cacheKey = `pan_deep_${siteKey}_${detailUrl.toLowerCase()}`;
  const cached = await getSteamCacheEntry(cacheKey);
  if (cached && cached.data && cached.data.panUrl) {
    return cached.data;
  }

  let tabId = null;
  try {
    // 在后台静默打开标签页：不激活、静音、放到最后
    const tab = await chrome.tabs.create({
      url: detailUrl,
      active: false,
      pinned: false,
      muted: true,
      index: 9999 // 放到标签栏最后
    });
    tabId = tab.id;

    let result = null;
    // 设置整体超时，防止无限等待
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('提取超时')), 45000)
    );

    const extractPromise = (async () => {
      switch (siteKey) {
        case 'xianyudanji':
          return await extractXianyuDanji(tabId);
        case 'xdgame':
          return await extractXdgame(tabId);
        case 'gamer520':
          return await extractGamer520(tabId);
        default:
          return await extractGenericPan(tabId);
      }
    })();

    result = await Promise.race([extractPromise, timeoutPromise]);

    if (result && result.panUrl) {
      // 安全验证：只返回合法的网盘链接
      if (!validatePanUrl(result.panUrl)) {
        console.warn(`extractPanLinkDeep: 非法网盘链接被过滤: ${result.panUrl}`);
        result.panUrl = '';
      } else {
        // 百度网盘自动拼接提取码
        if (result.panCode && /pan\.baidu\.com/i.test(result.panUrl)) {
          result.panUrl = buildBaiduPanUrlWithPwd(result.panUrl, result.panCode);
        }
        await setSteamCacheEntry(cacheKey, result);
      }
    }

    return result;
  } catch (e) {
    console.log(`深度提取${siteKey}网盘链接失败:`, e.message);
    return null;
  } finally {
    if (tabId !== null) {
      try { await chrome.tabs.remove(tabId); } catch (e) {}
    }
  }
}

// 等待页面加载完成的通用函数
async function waitForTabLoad(tabId, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error('页面加载超时'));
    }, timeout);

    function onUpdated(updatedTabId, changeInfo, tab) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve(tab);
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated);

    // 检查是否已经加载完成（带错误处理）
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        reject(new Error('获取标签页失败: ' + chrome.runtime.lastError.message));
        return;
      }
      if (tab && tab.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve(tab);
      }
    });
  });
}

// 在指定标签页执行脚本
async function execScript(tabId, func, ...args) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args
  });
  return results && results[0] ? results[0].result : null;
}

// 睡眠辅助
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ========== 咸鱼单机关联提取 ==========
// 下载按钮是静态链接 /goto?down=xxx，访问后自动跳转到百度网盘
async function extractXianyuDanji(tabId) {
  try {
    await waitForTabLoad(tabId);
    await sleep(1500);

    // 在页面中查找跳转链接
    const gotoLinks = await execScript(tabId, () => {
      const results = [];
      const selectors = [
        'a[href*="/goto?down="]',
        'a[href*="pan.baidu.com"]',
        'a[href*="aliyundrive.com"]',
        'a[href*="alipan.com"]',
        '.download-btn a',
        '.down-btn a',
        '[class*="download"] a',
        '[class*="down"] a[href]'
      ];
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach(a => {
          results.push({ href: a.href, text: a.textContent.trim().substring(0, 100) });
        });
      }
      // 去重
      const seen = new Set();
      return results.filter(r => {
        if (seen.has(r.href)) return false;
        seen.add(r.href);
        return true;
      });
    });

    if (!gotoLinks || gotoLinks.length === 0) {
      return null;
    }

    // 优先找 goto?down= 链接
    const gotoLink = gotoLinks.find(l => l.href.includes('/goto?down='));
    let panUrl = '';
    let panCode = '';

    if (gotoLink) {
      // 用 fetch 跟随跳转获取真实网盘地址
      try {
        const resp = await fetch(gotoLink.href, {
          credentials: 'include',
          redirect: 'follow'
        });
        if (resp.url && (resp.url.includes('pan.baidu.com') || resp.url.includes('aliyundrive.com') || resp.url.includes('alipan.com'))) {
          panUrl = resp.url;
        }
      } catch (e) {
        // fetch 可能因跨域/CORS 失败，回退到在标签页中跳转
        if (!panUrl) {
          try {
            await chrome.tabs.update(tabId, { url: gotoLink.href });
            await waitForTabLoad(tabId);
            await sleep(1500);

            const finalUrl = await execScript(tabId, () => window.location.href);
            if (finalUrl && (finalUrl.includes('pan.baidu.com') || finalUrl.includes('aliyundrive.com') || finalUrl.includes('alipan.com'))) {
              panUrl = finalUrl;
            }

            // 从页面中查找提取码
            const codeFromPage = await execScript(tabId, () => {
              // 常见的提取码显示位置
              const patterns = [
                /提取码[：:]\s*([a-zA-Z0-9]{4})/i,
                /密码[：:]\s*([a-zA-Z0-9]{4})/i,
                /pwd[=:：]\s*([a-zA-Z0-9]{4})/i
              ];
              const text = document.body.textContent;
              for (const p of patterns) {
                const m = text.match(p);
                if (m) return m[1];
              }
              return '';
            });
            if (codeFromPage) panCode = codeFromPage;
          } catch (e2) {
            console.log('咸鱼单机跳转提取失败:', e2.message);
          }
        }
      }

      // 从 goto 链接附近的文本提取提取码
      if (!panCode && gotoLink.text) {
        const codeMatch = gotoLink.text.match(/(?:提取码|密码|访问码)[：:\s]*([a-zA-Z0-9]{4})/i);
        if (codeMatch) panCode = codeMatch[1];
      }
    }

    // 如果没找到 goto 链接，试试直接找百度网盘链接
    if (!panUrl) {
      const baiduLink = gotoLinks.find(l => l.href.includes('pan.baidu.com'));
      if (baiduLink) {
        panUrl = baiduLink.href;
        const codeMatch = baiduLink.text.match(/(?:提取码|密码|访问码)[：:\s]*([a-zA-Z0-9]{4})/i);
        if (codeMatch) panCode = codeMatch[1];
      }
    }

    if (panUrl) {
      return { panUrl, panCode, source: 'xianyudanji' };
    }
    return null;
  } catch (e) {
    console.log('咸鱼单机提取失败:', e.message);
    return null;
  }
}

// ========== XDGame 提取 ==========
// JS 动态加载下载链接，需要等 JS 执行
async function extractXdgame(tabId) {
  try {
    await waitForTabLoad(tabId);
    // 等待 JS 渲染下载区域
    await sleep(3000);

    // 尝试在页面中查找网盘链接
    const panInfo = await execScript(tabId, () => {
      const result = { panUrl: '', panCode: '' };

      // 所有可能的网盘链接选择器
      const linkSelectors = [
        'a[href*="pan.baidu.com"]',
        'a[href*="aliyundrive.com"]',
        'a[href*="alipan.com"]',
        'a[href*="115.com"]',
        'a[href*="quark.cn"]',
        '[onclick*="pan.baidu"]',
        '[onclick*="baidupan"]',
        '[onclick*="baidu"]',
        '.download-list a',
        '.down-list a',
        '.res-down a',
        '[class*="download"] a[href]',
        '[class*="down"] a[href]'
      ];

      for (const sel of linkSelectors) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          let url = '';
          if (el.href) {
            url = el.href;
          } else if (el.onclick) {
            const oc = el.getAttribute('onclick') || '';
            const m = oc.match(/https?:\/\/[^\s'")]+/);
            if (m) url = m[0];
          }
          if (url && !result.panUrl &&
              (url.includes('pan.baidu.com') || url.includes('aliyundrive.com') ||
               url.includes('alipan.com') || url.includes('115.com') || url.includes('quark.cn'))) {
            result.panUrl = url;
            // 从附近文本找提取码
            const parent = el.closest('li, div, p') || el.parentElement;
            if (parent) {
              const txt = parent.textContent;
              const cm = txt.match(/(?:提取码|密码|访问码|pwd)[：:=\s]*([a-zA-Z0-9]{4})/i);
              if (cm) result.panCode = cm[1];
            }
            break;
          }
        }
        if (result.panUrl) break;
      }

      // 如果在属性中没找到，从整个页面文本中搜索
      if (!result.panUrl) {
        const html = document.body.innerHTML;
        const urlMatch = html.match(/https?:\/\/pan\.baidu\.com\/s\/[\w-]+/i);
        if (urlMatch) {
          result.panUrl = urlMatch[0];
          const codeArea = html.substring(urlMatch.index, urlMatch.index + 300);
          const cm = codeArea.match(/(?:提取码|密码|访问码|pwd)[：:=\s]*([a-zA-Z0-9]{4})/i);
          if (cm) result.panCode = cm[1];
        }
      }

      return result;
    });

    if (panInfo && panInfo.panUrl) {
      return { panUrl: panInfo.panUrl, panCode: panInfo.panCode || '', source: 'xdgame' };
    }
    return null;
  } catch (e) {
    console.log('XDGame提取失败:', e.message);
    return null;
  }
}

// ========== Gamer520 提取 ==========
// 多步：详情页 → 点击获取资源 → 弹窗点击立即下载 → 新页面二维码
// 先尝试从页面中直接找网盘链接，失败再走二维码路径
async function extractGamer520(tabId) {
  try {
    await waitForTabLoad(tabId);
    await sleep(2000);

    // 第一步：尝试从详情页直接找网盘链接（可能有缓存或直接显示的情况）
    const directInfo = await execScript(tabId, () => {
      const result = { panUrl: '', panCode: '' };

      // 搜索页面上所有的网盘链接
      const html = document.body.innerHTML;
      const patterns = [
        /https?:\/\/pan\.baidu\.com\/s\/[\w-]+/i,
        /https?:\/\/aliyundrive\.com\/s\/[\w]+/i,
        /https?:\/\/alipan\.com\/s\/[\w]+/i,
        /https?:\/\/\d+\.115\.com\/[^"'\s]+/i
      ];
      for (const p of patterns) {
        const m = html.match(p);
        if (m) {
          result.panUrl = m[0];
          const area = html.substring(m.index, m.index + 400);
          const cm = area.match(/(?:提取码|密码|访问码|pwd)[：:=\s]*([a-zA-Z0-9]{4})/i);
          if (cm) result.panCode = cm[1];
          break;
        }
      }

      return result;
    });

    if (directInfo && directInfo.panUrl) {
      return { panUrl: directInfo.panUrl, panCode: directInfo.panCode || '', source: 'gamer520' };
    }

    // 第二步：查找"获取资源"按钮并点击
    const hasGetResourceBtn = await execScript(tabId, () => {
      const btns = [...document.querySelectorAll('button, a, div[onclick], [class*="get"], [class*="resource"]')];
      for (const btn of btns) {
        const text = (btn.textContent || '').trim();
        if (/获取资源|立即下载|下载资源|点我下载/.test(text)) {
          btn.click();
          return true;
        }
      }
      return false;
    });

    if (hasGetResourceBtn) {
      await sleep(2000);

      // 第三步：在弹窗中找"立即下载"链接
      const downloadLink = await execScript(tabId, () => {
        // 查找弹窗中的下载链接
        const candidates = [];
        document.querySelectorAll('a[href]').forEach(a => {
          const txt = a.textContent.trim();
          if (/立即下载|百度网盘|阿里云盘|下载地址/.test(txt) ||
              a.href.includes('/down/') || a.href.includes('/download/') ||
              a.href.includes('gamer520.com') || a.href.includes('gamers520.com')) {
            candidates.push({ href: a.href, text: txt });
          }
        });
        // 优先选择非当前页面的链接
        const current = window.location.href;
        return candidates.find(c => c.href !== current && c.href.includes('.html')) || candidates[0] || null;
      });

      if (downloadLink && downloadLink.href) {
        // 导航到下载页面
        await chrome.tabs.update(tabId, { url: downloadLink.href });
        await waitForTabLoad(tabId);
        await sleep(2000);

        // 第四步：在下载页面找网盘链接或二维码
        const finalInfo = await execScript(tabId, () => {
          const result = { panUrl: '', panCode: '', qrImage: '' };

          // 直接找网盘链接
          const html = document.body.innerHTML;
          const patterns = [
            /https?:\/\/pan\.baidu\.com\/s\/[\w-]+/i,
            /https?:\/\/aliyundrive\.com\/s\/[\w]+/i,
            /https?:\/\/alipan\.com\/s\/[\w]+/i
          ];
          for (const p of patterns) {
            const m = html.match(p);
            if (m) {
              result.panUrl = m[0];
              const area = html.substring(m.index, m.index + 400);
              const cm = area.match(/(?:提取码|密码|访问码|pwd)[：:=\s]*([a-zA-Z0-9]{4})/i);
              if (cm) result.panCode = cm[1];
              break;
            }
          }

          // 如果没找到直接链接，找二维码图片
          if (!result.panUrl) {
            const imgSelectors = [
              'img[src*="qr"]',
              'img[src*="qrcode"]',
              'img[alt*="扫码"]',
              'img[alt*="二维码"]',
              '[class*="qr"] img',
              '[class*="qrcode"] img'
            ];
            for (const sel of imgSelectors) {
              const img = document.querySelector(sel);
              if (img && img.src) {
                result.qrImage = img.src;
                break;
              }
            }
            // 如果没找到特殊类名的二维码，找页面上所有图片里最像二维码的
            if (!result.qrImage) {
              const imgs = document.querySelectorAll('img');
              for (const img of imgs) {
                if (img.width >= 100 && img.width <= 300 &&
                    img.height >= 100 && img.height <= 300 &&
                    (img.src.includes('qr') || img.src.includes('code') || img.alt?.includes('码'))) {
                  result.qrImage = img.src;
                  break;
                }
              }
            }
          }

          return result;
        });

        if (finalInfo && finalInfo.panUrl) {
          return { panUrl: finalInfo.panUrl, panCode: finalInfo.panCode || '', source: 'gamer520' };
        }

        if (finalInfo && finalInfo.qrImage) {
          return {
            panUrl: '',
            panCode: '',
            qrImage: finalInfo.qrImage,
            downloadPageUrl: downloadLink.href,
            source: 'gamer520',
            note: '二维码需要扫码'
          };
        }
      }
    }

    return null;
  } catch (e) {
    console.log('Gamer520提取失败:', e.message);
    return null;
  }
}

// 通用网盘链接提取（兜底）
async function extractGenericPan(tabId) {
  try {
    await waitForTabLoad(tabId);
    await sleep(2000);

    const info = await execScript(tabId, () => {
      const result = { panUrl: '', panCode: '' };
      const html = document.body.innerHTML;
      const m = html.match(/https?:\/\/(?:pan\.baidu\.com\/s\/[\w-]+|aliyundrive\.com\/s\/[\w]+|alipan\.com\/s\/[\w]+)/i);
      if (m) {
        result.panUrl = m[0];
        const area = html.substring(m.index, m.index + 400);
        const cm = area.match(/(?:提取码|密码|访问码|pwd)[：:=\s]*([a-zA-Z0-9]{4})/i);
        if (cm) result.panCode = cm[1];
      }
      return result;
    });

    if (info && info.panUrl) return info;
    return null;
  } catch (e) {
    return null;
  }
}

// ============ 13. 限免游戏 ============

async function fetchEpicFreeGames() {
  const games = [];
  try {
    const url = 'https://store-site-backend-official.ak.epicgames.com/freeGamesPromotions?locale=zh-CN&country=CN&allowCountries=CN';
    const resp = await fetch(url);
    const data = await resp.json();
    const elements = data?.data?.Catalog?.searchStore?.elements || [];
    for (const el of elements) {
      const promo = el.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0];
      if (!promo) continue;
      const now = Date.now();
      const start = new Date(promo.startDate).getTime();
      const end = new Date(promo.endDate).getTime();
      if (now < start || now > end) continue;

      const img = el.keyImages?.find(i => i.type === 'OfferImageWide')?.url ||
                  el.keyImages?.[0]?.url || '';
      games.push({
        id: 'epic-' + el.id,
        platform: 'epic',
        platformName: 'Epic Games',
        claimType: 'direct',
        source: 'Epic Games Store',
        name: el.title,
        description: el.description || '',
        image: img,
        url: `https://store.epicgames.com/zh-CN/p/${el.productSlug || el.urlSlug}`,
        originalPrice: el.price?.totalPrice?.fmtPrice?.originalPrice || '',
        endTime: promo.endDate,
        claimed: false
      });
    }
  } catch (e) {
    console.log('Epic限免获取失败:', e.message);
  }
  return games;
}

async function fetchGogFreeGames() {
  const games = [];
  try {
    const resp = await fetch('https://www.gog.com/games/ajax/filtered?mediaType=game&price=free&limit=25', {
      headers: { 'Accept': 'application/json' }
    });
    if (!resp.ok) return games;
    const data = await resp.json();
    const products = data?.products || [];
    for (const p of products.slice(0, 10)) {
      games.push({
        id: 'gog-' + p.id,
        platform: 'gog',
        platformName: 'GOG',
        claimType: 'direct',
        source: 'GOG',
        name: p.title,
        description: '',
        image: p.image ? `https:${p.image}.jpg` : '',
        url: `https://www.gog.com${p.url}`,
        originalPrice: p.price?.finalPrice ? `¥${p.price.finalPrice}` : '免费',
        endTime: '',
        claimed: false
      });
    }
  } catch (e) {
    console.log('GOG限免获取失败:', e.message);
  }
  return games;
}

async function fetchSteamFreeGames() {
  const games = [];
  try {
    const resp = await fetch('https://store.steampowered.com/api/featuredcategories/?l=schinese&cc=cn');
    if (!resp.ok) return games;
    const data = await resp.json();
    const specials = data?.specials?.items || [];
    for (const item of specials) {
      if (item.final_price === 0 || item.discount_percent === 100) {
        games.push({
          id: 'steam-' + item.id,
          platform: 'steam',
          platformName: 'Steam',
          claimType: 'direct',
          source: 'Steam',
          name: item.name,
          description: '',
          image: item.large_capsule_image || item.small_capsule_image || '',
          url: `https://store.steampowered.com/app/${item.id}/`,
          originalPrice: item.final_price === 0 ? '免费' : '',
          endTime: '',
          claimed: false
        });
      }
    }
  } catch (e) {
    console.log('Steam限免获取失败:', e.message);
  }
  return games;
}

function classifyGamerPowerGiveaway(item) {
  const title = (item.title || '').toLowerCase();
  const instructions = (item.instructions || '').toLowerCase();

  const hasKeyInTitle = /\bkey\b/.test(title);
  const thirdPartySignals = [
    'alienware', 'unlock your key', 'get your key', 'redeem the key',
    'redeem your key', 'indiegala', 'humble bundle', 'fanatical',
    'grabfree', 'key giveaway', 'claim your key', 'your free key'
  ];
  const hasThirdPartyInstruction = thirdPartySignals.some(kw => instructions.includes(kw));

  if (hasKeyInTitle || hasThirdPartyInstruction) return 'thirdparty';
  return 'direct';
}

function extractThirdPartySource(item) {
  const instructions = (item.instructions || '').toLowerCase();
  if (instructions.includes('alienware')) return 'Alienware Arena';
  if (instructions.includes('indiegala')) return 'IndieGala';
  if (instructions.includes('humble')) return 'Humble Bundle';
  if (instructions.includes('fanatical')) return 'Fanatical';
  return '第三方平台';
}

async function fetchGamerPowerFreeGames() {
  const games = [];
  try {
    const resp = await fetch('https://www.gamerpower.com/api/giveaways');
    if (!resp.ok) return games;
    const data = await resp.json();
    if (!Array.isArray(data)) return games;

    for (const item of data) {
      const platforms = (item.platforms || '').toLowerCase();
      let platform = 'other';
      let platformName = '其他';
      if (platforms.includes('epic')) { platform = 'epic'; platformName = 'Epic Games'; }
      else if (platforms.includes('steam')) { platform = 'steam'; platformName = 'Steam'; }
      else if (platforms.includes('gog')) { platform = 'gog'; platformName = 'GOG'; }
      else if (platforms.includes('itch')) { platform = 'itch'; platformName = 'Itch.io'; }
      else if (platforms.includes('drm-free') || platforms.includes('pc')) { platform = 'pc'; platformName = 'PC'; }

      if (platform === 'other') continue;

      const claimType = classifyGamerPowerGiveaway(item);
      const source = claimType === 'thirdparty' ? extractThirdPartySource(item) : platformName;

      games.push({
        id: 'gp-' + item.id,
        platform,
        platformName,
        claimType,
        source,
        name: item.title || '',
        description: item.description || '',
        image: item.image || '',
        url: item.open_giveaway_url || item.giveaway_url || '',
        originalPrice: item.worth || '',
        endTime: (item.end_date && item.end_date !== 'N/A') ? item.end_date : '',
        claimed: false
      });
    }
  } catch (e) {
    console.log('GamerPower限免获取失败:', e.message);
  }
  return games;
}

async function fetchAllFreeGames() {
  const [epic, gog, steam, gamerpower] = await Promise.all([
    fetchEpicFreeGames(),
    fetchGogFreeGames(),
    fetchSteamFreeGames(),
    fetchGamerPowerFreeGames()
  ]);

  const merged = [...epic, ...gog, ...steam];
  const seenNames = new Set(merged.map(g => normalizeGameName(g.name)));

  for (const gp of gamerpower) {
    const norm = normalizeGameName(gp.name);
    if (!seenNames.has(norm)) {
      seenNames.add(norm);
      merged.push(gp);
    }
  }

  return merged;
}

function normalizeGameName(name) {
  return (name || '').toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/giveaway|free|限免|领取/gi, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
    .trim();
}

async function refreshFreeGames(force = false) {
  const data = await chrome.storage.local.get(DB_KEYS.FREE_GAMES);
  const existing = data[DB_KEYS.FREE_GAMES] || { lastUpdate: 0, games: [] };

  const ONE_DAY = 24 * 3600 * 1000;
  if (!force && existing.lastUpdate && (Date.now() - existing.lastUpdate < ONE_DAY)) {
    await updateFreeGamesBadge();
    return existing;
  }

  const newGames = await fetchAllFreeGames();
  const existingMap = new Map(existing.games.map(g => [g.id, g]));
  const now = Date.now();
  newGames.forEach(g => {
    const old = existingMap.get(g.id);
    if (old) {
      g.claimed = old.claimed || false;
      g.firstSeen = old.firstSeen || now;
    } else {
      g.firstSeen = now;
    }
  });

  const result = { lastUpdate: now, games: newGames };
  await chrome.storage.local.set({ [DB_KEYS.FREE_GAMES]: result });
  await updateFreeGamesBadge();
  return result;
}

async function updateFreeGamesBadge() {
  try {
    const data = await chrome.storage.local.get(DB_KEYS.FREE_GAMES);
    const games = data[DB_KEYS.FREE_GAMES]?.games || [];
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();
    const newToday = games.filter(g => g.firstSeen && g.firstSeen >= todayStartMs).length;
    chrome.action.setBadgeText({ text: newToday > 0 ? String(newToday) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
  } catch (e) {
    console.log('更新badge失败:', e.message);
  }
}

// ============ 14. 消息处理 ============

// --- 下载历史管理 ---
async function getDownloadHistory() {
  const data = await chrome.storage.local.get(DB_KEYS.DOWNLOAD_HISTORY);
  return data[DB_KEYS.DOWNLOAD_HISTORY] || {};
}

async function saveDownloadHistory(history) {
  await chrome.storage.local.set({ [DB_KEYS.DOWNLOAD_HISTORY]: history });
}

// 从domain推断站点key和名称
function inferSiteFromDomain(domain) {
  if (!domain) return { key: 'unknown', name: '未知站点' };
  if (domain.includes('xdgame')) return { key: 'xdgame', name: 'XDGame' };
  if (domain.includes('xianyudanji')) return { key: 'xianyudanji', name: '咸鱼单机' };
  if (domain.includes('gamer520') || domain.includes('gamers520')) return { key: 'gamer520', name: 'Gamer520' };
  return { key: 'unknown', name: domain };
}

async function recordDownloadHistory(data) {
  if (!data.gameName) return;
  const gameName = data.gameName.trim();
  if (gameName.length < 2) return;

  const history = await getDownloadHistory();
  const existing = history[gameName] || { totalDownloads: 0 };
  const siteInfo = inferSiteFromDomain(data.domain);

  history[gameName] = {
    ...existing,
    lastDownloadTime: Date.now(),
    lastDownloadSite: data.siteKey || siteInfo.key,
    lastDownloadSiteName: data.siteName || siteInfo.name,
    lastDownloadUrl: data.detailUrl || data.url || '',
    lastPanUrl: data.downloadUrl || '',
    totalDownloads: (existing.totalDownloads || 0) + 1
  };

  // 限制历史记录数量（最多保留200条）
  const keys = Object.keys(history);
  if (keys.length > 200) {
    const sorted = keys.sort((a, b) =>
      (history[b].lastDownloadTime || 0) - (history[a].lastDownloadTime || 0)
    );
    for (let i = 200; i < sorted.length; i++) {
      delete history[sorted[i]];
    }
  }

  await saveDownloadHistory(history);
}

async function handleGetDownloadHistory(message) {
  const history = await getDownloadHistory();
  if (message.gameName) {
    return { record: history[message.gameName] || null };
  }
  return { history };
}

// --- 各消息类型的独立 handler ---

async function handleTrackEvent(message) {
  await addBehaviorLog(message.data);

  if (message.data.type === 'click_download') {
    await updateGameProfile({
      name: message.data.gameName,
      event: 'download',
      keywords: message.data.keywords
    });
    // 记录下载历史
    await recordDownloadHistory(message.data);
    Logger.info('Download', `下载"${message.data.gameName}"`, { method: message.data.method, domain: message.data.domain });
  }
  if (message.data.type === 'view_detail') {
    await updateGameProfile({
      name: message.data.gameName,
      event: 'view',
      keywords: message.data.keywords
    });
  }
  // Steam标签回写
  if (message.data.type === 'steam_tags_update') {
    await updateGameProfile({
      name: message.data.gameName,
      event: 'view',
      keywords: message.data.keywords,
      steamAppId: message.data.steamAppId,
      steamRating: message.data.steamRating
    });
    await updateUserPreferences();
  }
  // 定期更新偏好模型
  if (message.data.type !== 'steam_tags_update') {
    await updateUserPreferences();
  }
  return { success: true };
}

async function handleGetRecommendations(message) {
  const games = message.games || [];
  const useBuiltinOnly = games.length > 1; // 批量时强制内置算法
  const results = [];
  for (const game of games) {
    const score = await calculateRecommendation(game, useBuiltinOnly);
    results.push({ ...game, recommendation: score });
  }
  return { results };
}

async function handleSearchSteam(message) {
  const steamResult = await searchSteamGame(message.gameName);
  if (steamResult) {
    Logger.info('Steam', `匹配"${message.gameName}" → ${steamResult.name}`, { appId: steamResult.appId, rating: steamResult.ratingDesc });
  } else {
    Logger.warn('Steam', `未找到"${message.gameName}"`);
  }
  return { data: steamResult };
}

async function handleGetSteamRatings(message) {
  const ratingNames = message.names || [];
  const ratings = {};
  const batchSize = 5;
  for (let i = 0; i < ratingNames.length; i += batchSize) {
    const batch = ratingNames.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(async (name) => {
      try {
        const r = await getSteamPositiveRate(name);
        return [name, r];
      } catch (e) {
        return [name, null];
      }
    }));
    batchResults.forEach(([name, r]) => { ratings[name] = r; });
  }
  return { ratings };
}

async function handleGetSettings() {
  return { settings: await getSettings() };
}

async function handleSaveSettings(message) {
  await saveSettings(message.settings);
  return { success: true };
}

async function handleGetStats() {
  const log = await getBehaviorLog();
  const profilesData = await chrome.storage.local.get(DB_KEYS.GAME_PROFILES);
  const kwData = await chrome.storage.local.get(DB_KEYS.KEYWORD_WEIGHTS);
  const profiles = profilesData[DB_KEYS.GAME_PROFILES] || {};
  const keywordWeights = kwData[DB_KEYS.KEYWORD_WEIGHTS] || {};

  const viewDetailCount = log.filter(e => e.type === 'view_detail').length;
  const downloadCount = log.filter(e => e.type === 'click_download').length;
  const listViewCount = log.filter(e => e.type === 'view_list').length;

  const gameList = Object.values(profiles)
    .sort((a, b) => b.downloads - a.downloads || b.views - a.views)
    .slice(0, 50);

  const downloadMethods = {};
  log.filter(e => e.type === 'click_download').forEach(e => {
    const method = e.method || 'unknown';
    downloadMethods[method] = (downloadMethods[method] || 0) + 1;
  });

  return {
    totalEvents: log.length,
    totalGames: Object.keys(profiles).length,
    viewDetailCount,
    downloadCount,
    listViewCount,
    downloadRate: viewDetailCount > 0 ? Math.round(downloadCount / viewDetailCount * 100) : 0,
    topKeywords: Object.entries(keywordWeights)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([kw, weight]) => ({ keyword: kw, weight })),
    gameList,
    downloadMethods,
    recentLog: log.slice(-30).reverse()
  };
}

async function handleGetSteamRecommendations() {
  const kwData = await chrome.storage.local.get(DB_KEYS.KEYWORD_WEIGHTS);
  const weights = kwData[DB_KEYS.KEYWORD_WEIGHTS] || {};
  const topTags = Object.entries(weights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([kw]) => kw);

  if (topTags.length === 0) {
    return { games: [], message: '还没有足够的学习数据，请先浏览一些游戏网站' };
  }

  try {
    const recGames = [];
    for (const tag of topTags.slice(0, 3)) {
      const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(tag)}&l=schinese&cc=cn`;
      const resp = await fetch(searchUrl);
      const data = await resp.json();

      if (data.total > 0 && data.items) {
        for (const item of data.items.slice(0, 4)) {
          if (recGames.some(g => g.appId === item.id)) continue;

          let detail = null;
          try {
            const detUrl = `https://store.steampowered.com/api/appdetails?appids=${item.id}&l=schinese&filters=basic,price_overview`;
            const detResp = await fetch(detUrl);
            const detData = await detResp.json();
            if (detData[item.id]?.success) {
              detail = detData[item.id].data;
            }
          } catch (e) {}

          recGames.push({
            appId: item.id,
            name: detail?.name || item.name,
            image: detail?.header_image || `https://cdn.akamai.steamstatic.com/steam/apps/${item.id}/header.jpg`,
            price: detail?.price_overview ? detail.price_overview.final_formatted : '免费',
            reviewSummary: '',
            url: `https://store.steampowered.com/app/${item.id}/`,
            matchTags: [tag]
          });
        }
      }
      if (recGames.length >= 9) break;
    }

    return { games: recGames.slice(0, 9), basedOnTags: topTags };
  } catch (e) {
    console.error('Steam推荐失败:', e);
    return { games: [], error: '获取Steam推荐失败: ' + e.message };
  }
}

async function handleClearData() {
  await chrome.storage.local.remove([
    DB_KEYS.BEHAVIOR_LOG,
    DB_KEYS.GAME_PROFILES,
    DB_KEYS.KEYWORD_WEIGHTS,
    DB_KEYS.STEAM_CACHE
  ]);
  return { success: true };
}

async function handleSearchDownloadSites(message, sender) {
  const sites = await searchDownloadSites(message.gameName, message.appId);
  Logger.info('DownloadSites', `搜索"${message.gameName}"`, { found: sites.filter(s => s.found).map(s => s.key) });

  return { sites };
}

// 异步触发深度提取，完成后通过消息通知content script更新
async function triggerDeepExtraction(sites, tabId, gameName) {
  for (const site of sites) {
    if (!site.found || !site.detailUrl) continue;
    if (site.panUrl && site.panUrl.length > 10) continue; // 已有网盘链接则跳过

    try {
      const deepResult = await extractPanLinkDeep(site.key, site.detailUrl);
      if (deepResult && deepResult.panUrl) {
        site.panUrl = deepResult.panUrl;
        site.panCode = deepResult.panCode || '';
        site.panSource = deepResult.source;
        // 通知 content script 更新
        try {
          await chrome.tabs.sendMessage(tabId, {
            action: 'DOWNLOAD_SITE_UPDATE',
            siteKey: site.key,
            panUrl: deepResult.panUrl,
            panCode: deepResult.panCode || '',
            gameName
          });
        } catch (e) {
          // 标签页可能已关闭，忽略
        }
      } else if (deepResult && deepResult.qrImage) {
        // 二维码的情况
        site.qrImage = deepResult.qrImage;
        site.downloadPageUrl = deepResult.downloadPageUrl;
        site.panNote = deepResult.note || '';
        try {
          await chrome.tabs.sendMessage(tabId, {
            action: 'DOWNLOAD_SITE_UPDATE',
            siteKey: site.key,
            qrImage: deepResult.qrImage,
            downloadPageUrl: deepResult.downloadPageUrl,
            panNote: deepResult.note || '',
            gameName
          });
        } catch (e) {}
      }
    } catch (e) {
      console.log(`深度提取${site.name}失败:`, e.message);
    }
  }
}

// 直接调用深度提取的消息处理器
async function handleExtractPanDeep(message, sender) {
  const result = await extractPanLinkDeep(message.siteKey, message.detailUrl);
  // 如果有提取码且是百度网盘，自动拼接到URL中
  if (result && result.panUrl && result.panCode && /pan\.baidu\.com/i.test(result.panUrl)) {
    result.panUrl = buildBaiduPanUrlWithPwd(result.panUrl, result.panCode);
  }

  // 自动打开提取到的网盘链接（通过后台打开，避免前端弹窗拦截）
  if (result && result.panUrl && message.autoOpen) {
    try {
      await chrome.tabs.create({ url: result.panUrl, active: true });
      result.opened = true;
      // 记录下载历史
      if (message.gameName) {
        const siteNames = { xdgame: 'XDGame', xianyudanji: '咸鱼单机', gamer520: 'Gamer520' };
        await recordDownloadHistory({
          gameName: message.gameName,
          siteKey: message.siteKey,
          siteName: siteNames[message.siteKey] || message.siteKey,
          domain: message.siteKey,
          detailUrl: message.detailUrl,
          downloadUrl: result.panUrl
        });
      }
    } catch (e) {
      console.warn('自动打开网盘链接失败:', e.message);
    }
  }
  // 二维码情况也自动打开扫码页
  if (result && result.qrImage && result.downloadPageUrl && message.autoOpen) {
    try {
      await chrome.tabs.create({ url: result.downloadPageUrl, active: true });
      result.opened = true;
      // 记录下载历史
      if (message.gameName) {
        const siteNames = { xdgame: 'XDGame', xianyudanji: '咸鱼单机', gamer520: 'Gamer520' };
        await recordDownloadHistory({
          gameName: message.gameName,
          siteKey: message.siteKey,
          siteName: siteNames[message.siteKey] || message.siteKey,
          domain: message.siteKey,
          detailUrl: message.detailUrl,
          downloadUrl: result.downloadPageUrl
        });
      }
    } catch (e) {
      console.warn('自动打开扫码页失败:', e.message);
    }
  }

  // 如果有tabId，也通知content script更新（用于单站点手动提取）
  const tabId = sender && sender.tab ? sender.tab.id : message.tabId;
  if (tabId && result && (result.panUrl || result.qrImage)) {
    try {
      await chrome.tabs.sendMessage(tabId, {
        action: 'DOWNLOAD_SITE_UPDATE',
        siteKey: message.siteKey,
        panUrl: result.panUrl || '',
        panCode: result.panCode || '',
        qrImage: result.qrImage || '',
        downloadPageUrl: result.downloadPageUrl || '',
        panNote: result.note || '',
        gameName: message.gameName || ''
      });
    } catch (e) {}
  }
  return { result };
}

async function handleGetFreeGames(message) {
  const freeData = await refreshFreeGames(message.force === true);
  Logger.info('FreeGames', `获取限免游戏`, { count: freeData.games ? freeData.games.length : 0 });
  return { data: freeData };
}

async function handleClaimFreeGame(message) {
  const fgData = await chrome.storage.local.get(DB_KEYS.FREE_GAMES);
  const fg = fgData[DB_KEYS.FREE_GAMES] || { games: [] };
  const game = fg.games.find(g => g.id === message.gameId);
  if (game) {
    game.claimed = true;
    await chrome.storage.local.set({ [DB_KEYS.FREE_GAMES]: fg });
    await updateFreeGamesBadge();
  }
  return { success: true };
}

// --- 消息分发映射表 ---

const MESSAGE_HANDLERS = {
  TRACK_EVENT:            handleTrackEvent,
  GET_RECOMMENDATIONS:    handleGetRecommendations,
  SEARCH_STEAM:           handleSearchSteam,
  GET_STEAM_RATINGS:      handleGetSteamRatings,
  GET_SETTINGS:           handleGetSettings,
  SAVE_SETTINGS:          handleSaveSettings,
  GET_STATS:              handleGetStats,
  GET_STEAM_RECOMMENDATIONS: handleGetSteamRecommendations,
  CLEAR_DATA:             handleClearData,
  SEARCH_DOWNLOAD_SITES:  handleSearchDownloadSites,
  EXTRACT_PAN_DEEP:       handleExtractPanDeep,
  GET_FREE_GAMES:         handleGetFreeGames,
  CLAIM_FREE_GAME:        handleClaimFreeGame,
  GET_DOWNLOAD_HISTORY:   handleGetDownloadHistory,
  GET_RUNTIME_LOGS:       async (msg) => ({ logs: await getRuntimeLogs(msg.limit) }),
  CLEAR_RUNTIME_LOGS:     async () => { await clearRuntimeLogs(); return { success: true }; },
  EXPORT_LOGS:            async () => ({ logs: await getRuntimeLogs() }),
  CREATE_BACKUP:          async () => {
    const b = await createBackup(true);
    return { success: !!b, backup: b ? { id: b.id, timestamp: b.timestamp } : null };
  },
  GET_BACKUPS:            async () => ({ backups: await getBackupList() }),
  RESTORE_BACKUP:         async (msg) => restoreBackup(msg.backupId),
  DELETE_BACKUP:          async (msg) => deleteBackup(msg.backupId),
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    console.error('消息处理错误:', err);
    sendResponse({ error: err.message });
  });
  return true; // 保持消息通道开放
});

async function handleMessage(message, sender) {
  const handler = MESSAGE_HANDLERS[message.action];
  if (handler) return await handler(message, sender);
  return { error: 'Unknown action: ' + message.action };
}

// ============ 15. 初始化 ============

initStorage();

// 每日刷新限免游戏
chrome.alarms.create('refreshFreeGames', { periodInMinutes: 24 * 60 });

// 自动备份定时器
async function setupBackupAlarm() {
  const settings = await getSettings();
  const intervalMinutes = (settings.backupIntervalHours || 24) * 60;
  chrome.alarms.create('autoBackup', { periodInMinutes: intervalMinutes });
}
setupBackupAlarm();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refreshFreeGames') {
    refreshFreeGames(true);
  }
  if (alarm.name === 'autoBackup') {
    getSettings().then(settings => {
      if (settings.autoBackup) createBackup(false);
    });
  }
});

// 启动时刷新限免游戏并更新badge
refreshFreeGames(false);

Logger.info('System', 'Service Worker 已启动');
console.log('[Game Recommender] Service Worker 已启动');
