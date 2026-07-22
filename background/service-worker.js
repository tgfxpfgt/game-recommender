/**
 * Game Recommender - Background Service Worker
 * 负责数据管理、Steam API调用、推荐计算协调
 */

// ============ 数据存储管理 ============

const DB_KEYS = {
  BEHAVIOR_LOG: 'behaviorLog',       // 用户行为日志
  GAME_PROFILES: 'gameProfiles',     // 游戏画像
  USER_PREFERENCES: 'userPrefs',     // 用户偏好模型
  SETTINGS: 'settings',             // 插件设置
  STEAM_CACHE: 'steamCache',        // Steam数据缓存
  KEYWORD_WEIGHTS: 'keywordWeights', // 关键词权重
  FREE_GAMES: 'freeGames',          // 限免游戏
  RUNTIME_LOG: 'runtimeLog',        // 运行日志
  BACKUPS: 'backups'                // 自动备份
};

// 默认设置
const DEFAULT_SETTINGS = {
  enabled: true,
  showDebugPanel: false,          // 调试窗口默认关闭
  highlightThreshold: 0.6,        // 高亮阈值
  maxBehaviorLog: 500,            // 最大行为记录数
  steamApiKey: '',                // Steam API Key（可选）
  useLLM: false,                  // 是否使用LLM
  llmConfig: {
    provider: 'local',            // local | openai | custom
    endpoint: 'http://localhost:11434/api/generate', // Ollama默认
    apiKey: '',
    model: 'qwen2.5:7b',
    temperature: 0.3
  },
  weights: {                      // 推荐算法权重
    clickRate: 0.2,               // 点击率权重
    downloadRate: 0.35,           // 下载率权重
    keywordMatch: 0.25,           // 关键词匹配权重
    steamRating: 0.2             // Steam评分权重
  },
  trackedSites: [                 // 追踪的网站
    '3dmgame.com',
    'ali213.net',
    'gamersky.com',
    'yystv.cn',
    'fitgirl-repacks.site',
    'rutracker.org',
    'gamer520.com',
    'xianyudanji.gg',
    'xdgame.com'
  ],
  // 日志设置
  enableLog: true,                  // 是否记录运行日志
  maxRuntimeLog: 300,               // 最大运行日志条数
  // 自动备份设置
  autoBackup: true,                 // 是否自动备份
  backupIntervalHours: 24,          // 备份间隔（小时）
  maxBackups: 7                     // 保留的备份数量
};

// 初始化存储
async function initStorage() {
  const data = await chrome.storage.local.get(DB_KEYS.SETTINGS);
  if (!data[DB_KEYS.SETTINGS]) {
    await chrome.storage.local.set({ [DB_KEYS.SETTINGS]: DEFAULT_SETTINGS });
  }
}

// 设置内存缓存（减少频繁的存储读取，提升性能）
let settingsCache = null;
let settingsCacheTime = 0;
const SETTINGS_CACHE_TTL = 5000; // 5秒缓存

// 获取设置
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

// 保存设置
async function saveSettings(settings) {
  await chrome.storage.local.set({ [DB_KEYS.SETTINGS]: settings });
  // 更新缓存
  settingsCache = { ...DEFAULT_SETTINGS, ...settings };
  settingsCacheTime = Date.now();
}

// ============ 运行日志系统 ============

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

// 写入运行日志（异步，不阻塞主流程）
async function writeLog(level, module, message, data) {
  try {
    const settings = await getSettings();
    if (!settings.enableLog) return;
    
    const entry = {
      timestamp: Date.now(),
      level: level,
      module: module,
      message: message
    };
    if (data !== undefined) {
      // 限制data大小，避免存储过大
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

// 日志快捷方法
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

// ============ 自动备份系统 ============

// 需要备份的数据键
const BACKUP_DATA_KEYS = [
  DB_KEYS.BEHAVIOR_LOG,
  DB_KEYS.GAME_PROFILES,
  DB_KEYS.USER_PREFERENCES,
  DB_KEYS.SETTINGS,
  DB_KEYS.KEYWORD_WEIGHTS,
  DB_KEYS.FREE_GAMES
];

// 创建备份快照
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
      manual: manual,
      size: JSON.stringify(snapshot).length,
      data: snapshot
    };
    
    const stored = await chrome.storage.local.get(DB_KEYS.BACKUPS);
    const backups = stored[DB_KEYS.BACKUPS] || [];
    backups.push(backup);
    
    // 轮换：保留最近N个
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

// 获取备份列表（不含data主体，减少传输）
async function getBackupList() {
  const stored = await chrome.storage.local.get(DB_KEYS.BACKUPS);
  const backups = stored[DB_KEYS.BACKUPS] || [];
  return backups.map(b => ({
    id: b.id,
    timestamp: b.timestamp,
    manual: b.manual,
    size: b.size
  })).reverse();
}

// 恢复备份
async function restoreBackup(backupId) {
  try {
    const stored = await chrome.storage.local.get(DB_KEYS.BACKUPS);
    const backups = stored[DB_KEYS.BACKUPS] || [];
    const backup = backups.find(b => b.id === backupId);
    if (!backup || !backup.data) {
      Logger.warn('Backup', `备份不存在: ${backupId}`);
      return { success: false, error: '备份不存在' };
    }
    
    // 恢复前先创建一个当前状态的备份（安全网）
    await createBackup(true);
    
    // 恢复数据
    await chrome.storage.local.set(backup.data);
    Logger.info('Backup', `已恢复备份 ${backupId}`);
    return { success: true };
  } catch (e) {
    Logger.error('Backup', '恢复备份失败', e.message);
    return { success: false, error: e.message };
  }
}

// 删除备份
async function deleteBackup(backupId) {
  const stored = await chrome.storage.local.get(DB_KEYS.BACKUPS);
  let backups = stored[DB_KEYS.BACKUPS] || [];
  backups = backups.filter(b => b.id !== backupId);
  await chrome.storage.local.set({ [DB_KEYS.BACKUPS]: backups });
  return { success: true };
}

// ============ 行为日志管理 ============

async function addBehaviorLog(entry) {
  const data = await chrome.storage.local.get(DB_KEYS.BEHAVIOR_LOG);
  const log = data[DB_KEYS.BEHAVIOR_LOG] || [];
  
  entry.timestamp = Date.now();
  log.push(entry);
  
  // 限制日志大小
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

// ============ 游戏画像管理 ============

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

// ============ 用户偏好模型 ============

async function updateUserPreferences() {
  const log = await getBehaviorLog();
  const data = await chrome.storage.local.get(DB_KEYS.KEYWORD_WEIGHTS);
  const keywordWeights = data[DB_KEYS.KEYWORD_WEIGHTS] || {};
  
  // 统计关键词偏好
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
  
  // 计算最终权重
  Object.keys(positiveKeywords).forEach(kw => {
    const pos = positiveKeywords[kw] || 0;
    const neg = negativeKeywords[kw] || 0;
    keywordWeights[kw] = pos / (pos + neg + 1);
  });
  
  await chrome.storage.local.set({ [DB_KEYS.KEYWORD_WEIGHTS]: keywordWeights });
  return keywordWeights;
}

// ============ Steam API 集成 ============

// 从游戏详情页标题中提取多个搜索候选词
// 典型标题格式："艾尔登法环 Elden Ring v1.12.0 中文版" 或 "赛博朋克2077/Cyberpunk 2077 全DLC"
function parseGameTitle(rawName) {
  if (!rawName) return [];
  
  let name = rawName.trim();
  
  // 去除括号内容
  name = name.replace(/[\(（\[【].*?[\)）\]】]/g, '');
  
  // 去除《》书名号但保留内容
  name = name.replace(/[《》]/g, '');
  
  // 去除常见后缀/噪音词
  const noisePattern = /(中文|汉化|破解|免安装|绿色|学习|未加密|完整版|豪华版|终极|数字|典藏|年度|重制|复刻|增强|正式|官方|简繁|简体|繁体|中英|多语言|特别版|标准版|版|v[\d.]+|V[\d.]+|\d+\.\d+[\d.]*|Build\s*\d+|update\s*\d+|DLC.*|全DLC|整合|硬盘|免DVD|CODEX|FLT|RELOADED|SKIDROW|EMPRESS|GOG|Razor1911|FitGirl|\d+\s*GB|百度网盘|网盘|下载|迅雷|磁力|BT|种子|免安装绿色版|\s+The\s+Game\s*)/gi;
  name = name.replace(noisePattern, ' ');
  
  // 用分隔符拆分（/、|、:、：、 、 - 等，但保留单词内连字符如 Middle-earth）
  const parts = name.split(/[/|:：、]+|\s+\-\s+/).map(s => s.trim()).filter(s => s.length > 1);
  
  const candidates = [];
  const seen = new Set();
  
  function addCandidate(text) {
    const t = text.trim().replace(/\s+/g, ' ');
    if (t.length >= 2 && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      candidates.push(t);
    }
  }
  
  for (const part of parts) {
    // 提取纯英文名（Latin字符+数字+常见符号）
    const englishMatch = part.match(/[A-Za-z][A-Za-z0-9\s':&.!\-]+[A-Za-z0-9'.!]?/g);
    if (englishMatch) {
      englishMatch.forEach(m => addCandidate(m.trim()));
    }
    
    // 提取纯中文名（中文字符+数字）
    const chineseMatch = part.match(/[\u4e00-\u9fff\u3400-\u4dbf][\u4e00-\u9fff\u3400-\u4dbf0-9\s:：!！]+/g);
    if (chineseMatch) {
      chineseMatch.forEach(m => addCandidate(m.trim()));
    }
    
    // 如果part本身就是一个合理的名字（不含太多噪音）
    if (part.length >= 2 && part.length <= 60) {
      addCandidate(part);
    }
  }
  
  // 如果拆分后没有结果，用整体清理后的名字
  if (candidates.length === 0) {
    addCandidate(name.replace(/\s+/g, ' ').trim());
  }
  
  // 排序：英文名优先（Steam搜索英文名命中率更高），短名优先
  candidates.sort((a, b) => {
    const aIsEnglish = /^[A-Za-z]/.test(a);
    const bIsEnglish = /^[A-Za-z]/.test(b);
    if (aIsEnglish && !bIsEnglish) return -1;
    if (!aIsEnglish && bIsEnglish) return 1;
    return a.length - b.length; // 短名优先（更精确）
  });
  
  return candidates.slice(0, 5); // 最多5个候选
}

// 兼容旧调用
function cleanGameName(name) {
  const candidates = parseGameTitle(name);
  return candidates[0] || name || '';
}

async function searchSteamGame(gameName) {
  const settings = await getSettings();
  const searchTerms = parseGameTitle(gameName);
  
  // 先检查缓存
  const cacheData = await chrome.storage.local.get(DB_KEYS.STEAM_CACHE);
  const cache = cacheData[DB_KEYS.STEAM_CACHE] || {};
  const cacheKey = gameName.toLowerCase().trim();
  
  if (cache[cacheKey] && (Date.now() - cache[cacheKey].timestamp < 7 * 24 * 3600 * 1000)) {
    return cache[cacheKey].data;
  }
  
  try {
    let searchData = null;
    // 按优先级尝试多个搜索词（英文名优先）
    for (const term of searchTerms) {
      const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=schinese&cc=cn`;
      const response = await fetch(searchUrl);
      const data = await response.json();
      if (data.total > 0) {
        searchData = data;
        break;
      }
    }
    
    if (!searchData || searchData.total === 0) {
      return null;
    }
    
    const appId = searchData.items[0].id;
    
    // 获取游戏详情
    const detailUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=schinese`;
    const detailResponse = await fetch(detailUrl);
    const detailData = await detailResponse.json();
    
    if (!detailData[appId] || !detailData[appId].success) {
      return null;
    }
    
    const gameData = detailData[appId].data;
    
    // 获取商店页面HTML（用于解析用户标签+语言支持表）
    let storeHtml = '';
    try {
      const storePageUrl = `https://store.steampowered.com/app/${appId}/?cc=cn&l=schinese`;
      const storeResp = await fetch(storePageUrl, { headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' } });
      storeHtml = await storeResp.text();
    } catch (e) {
      console.log('获取商店页面失败:', e);
    }
    
    // 检测中文支持 - 优先从商店页语言表解析（更准确）
    let chineseSupported = false;
    let simplifiedChinese = false;
    let chineseHasAudio = false;
    let chineseHasSubtitles = false;
    
    // 方法1：解析商店页语言支持表 (game_language_options)
    if (storeHtml) {
      // 查找包含“简体中文”或“Chinese (Simplified)”的行
      const langTableMatch = storeHtml.match(/<table[^>]*class="[^"]*game_language_options[^"]*"[\s\S]*?<\/table>/i);
      if (langTableMatch) {
        const langTable = langTableMatch[0];
        // 按行分割，查找中文行
        const rows = langTable.match(/<tr[\s\S]*?<\/tr>/gi) || [];
        for (const row of rows) {
          // 检查该行是否包含简体中文
          const isSimplifiedRow = /简体中文|Chinese\s*\(Simplified\)/i.test(row);
          const isChineseRow = /中文|Chinese/i.test(row) && !/繁体|Traditional/i.test(row);
          if (isSimplifiedRow || isChineseRow) {
            // 检查是否有勾选标记（✓ 或 class="check"）
            const hasCheck = /✓|&#10003;|class="[^"]*check/i.test(row);
            const cells = row.match(/<td[\s\S]*?<\/td>/gi) || [];
            // 如果有勾选或任何单元格有标记，认为支持
            if (hasCheck || cells.some(c => /✓|&#10003;|check/i.test(c))) {
              chineseSupported = true;
              if (isSimplifiedRow) simplifiedChinese = true;
              // 检查音频和字幕列
              if (cells.length >= 3) {
                chineseHasAudio = /✓|&#10003;|check/i.test(cells[2] || '');
                chineseHasSubtitles = /✓|&#10003;|check/i.test(cells[3] || '');
              }
            }
          }
        }
      }
    }
    
    // 方法2：如果页面解析失败，回退到 supported_languages 字段
    if (!chineseSupported) {
      const supportedLangs = gameData.supported_languages || '';
      // 去除HTML标签后检查
      const cleanLangs = supportedLangs.replace(/<[^>]+>/g, ' ');
      chineseSupported = /简体中文|繁体中文|Chinese|中文/i.test(cleanLangs);
      simplifiedChinese = /简体中文|Simplified\s*Chinese/i.test(cleanLangs);
    }
    
    // 获取热门用户自定义标签（从商店页面HTML解析，增强鲁棒性）
    let userTags = [];
    if (storeHtml) {
      // 匹配 app_tag 链接（class可能是"app_tag"或包含其他类）
      const tagMatches = storeHtml.match(/<a[^>]*class="[^"]*app_tag[^"]*"[^>]*>[\s\S]*?<\/a>/gi);
      if (tagMatches) {
        const seenTags = new Set();
        userTags = tagMatches
          .map(m => m
            .replace(/<[^>]+>/g, '')        // 去除HTML标签
            .replace(/&[a-z]+;/gi, ' ')     // 解码HTML实体
            .replace(/\s+/g, ' ')           // 压缩空白
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
    }
    
    // 获取评价（总体 + 简体中文统计）
    let reviewSummary = null;
    let cnReviewSummary = null;
    let chineseReviews = [];
    try {
      // 获取中文评价 + 中文统计
      const cnReviewUrl = `https://store.steampowered.com/appreviews/${appId}?json=1&language=schinese&num_per_page=10&filter=all`;
      const cnResp = await fetch(cnReviewUrl);
      const cnData = await cnResp.json();
      if (cnData.success === 1) {
        if (cnData.reviews && cnData.reviews.length > 0) {
          chineseReviews = cnData.reviews.slice(0, 5).map(r => ({
            recommended: r.voted_up === true,
            text: r.review.substring(0, 200),
            author: r.author?.steamid || '匿名',
            language: 'schinese'
          }));
        }
        // 中文评价统计
        if (cnData.query_summary) {
          cnReviewSummary = {
            total: cnData.query_summary.total_reviews,
            positive: cnData.query_summary.total_positive,
            negative: cnData.query_summary.total_negative,
            score: cnData.query_summary.review_score,
            desc: cnData.query_summary.review_score_desc,
            positiveRate: cnData.query_summary.total_reviews > 0
              ? Math.round(cnData.query_summary.total_positive / cnData.query_summary.total_reviews * 100)
              : null
          };
        }
      }
      
      // 获取总体评价统计
      const reviewUrl = `https://store.steampowered.com/appreviews/${appId}?json=1&language=all&num_per_page=0`;
      const reviewResponse = await fetch(reviewUrl);
      const reviewData = await reviewResponse.json();
      
      if (reviewData.success === 1) {
        reviewSummary = {
          total: reviewData.query_summary.total_reviews,
          positive: reviewData.query_summary.total_positive,
          negative: reviewData.query_summary.total_negative,
          score: reviewData.query_summary.review_score,
          desc: reviewData.query_summary.review_score_desc
        };
      }
    } catch (e) {
      console.log('获取评价失败:', e);
    }
    
    // 尝试获取SteamDB信息（可能被Cloudflare拦截）
    let steamdbInfo = null;
    const steamdbUrl = `https://steamdb.info/app/${appId}/`;
    try {
      const sdbResp = await fetch(steamdbUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        }
      });
      const sdbHtml = await sdbResp.text();
      // 检测Cloudflare拦截页
      const isCloudflareBlock = !sdbResp.ok ||
        /Just a moment|cf-browser-verification|challenge-platform|Checking your browser|Attention Required/i.test(sdbHtml);
      
      if (!isCloudflareBlock) {
        const ratingMatch = sdbHtml.match(/<div[^>]*class="[^"]*header-rating[^"]*"[^>]*>\s*<span[^>]*>([\d.]+)%?<\/span>/i) ||
                              sdbHtml.match(/([\d.]+)%\s*(?:positive|好评)/i);
        const playersMatch = sdbHtml.match(/([\d,]+)\s*(?:players|人在玩)/i);
        const priceMatch = sdbHtml.match(/Lowest Price[\s\S]*?([\d.,]+\s*(?:¥|\$|USD|CNY))/i);
        const reviewCountMatch = sdbHtml.match(/([\d,]+)\s*(?:reviews|评测|评价)/i);
        
        steamdbInfo = {
          url: steamdbUrl,
          rating: ratingMatch ? ratingMatch[1] : null,
          reviewCount: reviewCountMatch ? reviewCountMatch[1] : null,
          currentPlayers: playersMatch ? playersMatch[1] : null,
          lowestPrice: priceMatch ? priceMatch[1] : null,
          available: true,
          blocked: false
        };
      } else {
        steamdbInfo = { url: steamdbUrl, available: false, blocked: true };
      }
    } catch (e) {
      console.log('SteamDB获取失败:', e.message);
      steamdbInfo = { url: steamdbUrl, available: false, blocked: true };
    }
    
    // SteamDB被拦截时，使用SteamSpy作为第三方数据补充
    let steamspyInfo = null;
    if (!steamdbInfo || !steamdbInfo.available) {
      try {
        const spyResp = await fetch(`https://steamspy.com/api.php?request=appdetails&appid=${appId}`);
        if (spyResp.ok) {
          const spyData = await spyResp.json();
          if (spyData && spyData.appid) {
            const total = (spyData.positive || 0) + (spyData.negative || 0);
            steamspyInfo = {
              positiveRate: total > 0 ? Math.round(spyData.positive / total * 100) : null,
              reviewCount: total > 0 ? total.toLocaleString() : null,
              players2weeks: spyData.players_2weeks ? spyData.players_2weeks.toLocaleString() : null,
              playersForever: spyData.players_forever ? spyData.players_forever.toLocaleString() : null,
              averagePlaytime: spyData.average_forever ? Math.round(spyData.average_forever / 60) + '小时' : null
            };
          }
        }
      } catch (e) {
        console.log('SteamSpy获取失败:', e.message);
      }
    }
    
    const result = {
      appId,
      name: gameData.name,
      url: `https://store.steampowered.com/app/${appId}/`,
      steamdbUrl: steamdbUrl,
      rating: reviewSummary ? reviewSummary.score : null,
      ratingDesc: reviewSummary ? reviewSummary.desc : null,
      totalReviews: reviewSummary ? reviewSummary.total : 0,
      positiveRate: reviewSummary && reviewSummary.total > 0 
        ? Math.round(reviewSummary.positive / reviewSummary.total * 100) 
        : null,
      // 简体中文评价统计
      cnRatingDesc: cnReviewSummary ? cnReviewSummary.desc : null,
      cnPositiveRate: cnReviewSummary ? cnReviewSummary.positiveRate : null,
      cnTotalReviews: cnReviewSummary ? cnReviewSummary.total : 0,
      reviews: chineseReviews,
      genres: (gameData.genres || []).map(g => g.description),
      userTags: userTags,
      chineseSupported: chineseSupported,
      simplifiedChinese: simplifiedChinese,
      chineseHasAudio: chineseHasAudio,
      chineseHasSubtitles: chineseHasSubtitles,
      releaseDate: gameData.release_date?.date || '',
      developers: gameData.developers || [],
      description: gameData.short_description || '',
      headerImage: gameData.header_image || '',
      steamdb: steamdbInfo,
      steamspy: steamspyInfo
    };
    
    // 缓存结果
    cache[cacheKey] = { data: result, timestamp: Date.now() };
    await chrome.storage.local.set({ [DB_KEYS.STEAM_CACHE]: cache });
    
    return result;
  } catch (error) {
    console.error('Steam API 调用失败:', error);
    return null;
  }
}

// ============ 推荐算法引擎 ============

async function calculateRecommendation(gameInfo, forceBuiltin = false) {
  const settings = await getSettings();
  const weights = settings.weights;
  
  // 如果启用LLM且非强制内置，使用LLM计算
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
  
  // 1. 点击率得分 - 基于同类游戏的历史点击率
  let clickScore = 0.5; // 默认中等
  const totalViews = behaviorLog.filter(e => e.type === 'view_list').length;
  const totalClicks = behaviorLog.filter(e => e.type === 'view_detail').length;
  if (totalViews > 0) {
    clickScore = Math.min(totalClicks / totalViews, 1);
  }
  
  // 2. 下载率得分 - 基于关键词匹配的历史下载率
  let downloadScore = 0.3;
  const gameKeywords = gameInfo.keywords || [];
  if (gameKeywords.length > 0) {
    let matchScore = 0;
    let matchCount = 0;
    gameKeywords.forEach(kw => {
      if (keywordWeights[kw] !== undefined) {
        matchScore += keywordWeights[kw];
        matchCount++;
      }
    });
    if (matchCount > 0) {
      downloadScore = matchScore / matchCount;
    }
  }
  
  // 3. 关键词匹配得分
  let keywordScore = 0.4;
  if (gameKeywords.length > 0) {
    let totalWeight = 0;
    let matchedWeight = 0;
    gameKeywords.forEach(kw => {
      const w = keywordWeights[kw];
      if (w !== undefined) {
        matchedWeight += w;
        totalWeight += 1;
      }
    });
    if (totalWeight > 0) {
      keywordScore = matchedWeight / totalWeight;
    }
  }
  
  // 4. Steam评分得分
  let steamScore = 0.5;
  if (gameInfo.steamRating !== null && gameInfo.steamRating !== undefined) {
    steamScore = gameInfo.steamRating / 10; // Steam评分0-10
  } else if (gameInfo.positiveRate !== null && gameInfo.positiveRate !== undefined) {
    steamScore = gameInfo.positiveRate / 100;
  }
  
  // 5. 历史画像加成（支持模糊匹配）
  const profileKey = (gameInfo.name || '').toLowerCase().trim();
  const cleanedKey = cleanGameName(gameInfo.name || '').toLowerCase().trim();
  let profileMatch = profiles[profileKey] || profiles[cleanedKey];
  
  // 如果精确匹配失败，尝试模糊匹配
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
    // 如果画像有关键词且当前游戏没有，使用画像关键词补充计算
    if (gameKeywords.length === 0 && profileMatch.keywords && profileMatch.keywords.length > 0) {
      let matchScore = 0;
      let matchCount = 0;
      profileMatch.keywords.forEach(kw => {
        if (keywordWeights[kw] !== undefined) {
          matchScore += keywordWeights[kw];
          matchCount++;
        }
      });
      if (matchCount > 0) {
        keywordScore = matchScore / matchCount;
        downloadScore = Math.max(downloadScore, matchScore / matchCount);
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
  
  // 获取用户偏好关键词
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
        prompt: prompt,
        stream: false,
        options: { temperature: llmConfig.temperature }
      })
    });
    const data = await response.json();
    return parseLLMResponse(data.response);
  } else {
    // OpenAI兼容接口（支持各种云端API）
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
    // 尝试提取JSON
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

// ============ 功能3：下载站搜索 ============

// 下载站配置：搜索URL模板 + 详情页URL特征
const DOWNLOAD_SITES = [
  { key: 'xdgame',      name: 'XDGame',   searchUrl: q => `https://xdgame.com/so/${encodeURIComponent(q)}.html`,     base: 'https://xdgame.com' },
  { key: 'xianyudanji', name: '咸鱼单机', searchUrl: q => `https://www.xianyudanji.gg/?s=${encodeURIComponent(q)}`,   base: 'https://www.xianyudanji.gg' },
  { key: 'gamer520',    name: 'Gamer520', searchUrl: q => `https://www.gamer520.com/?s=${encodeURIComponent(q)}`,     base: 'https://www.gamer520.com' }
];

// 计算链接文本与游戏名的匹配度（0-100）
function calcLinkMatchScore(linkText, searchName) {
  const norm = s => (s || '').toLowerCase().replace(/[\s\-_:：|\/\.'’!！?？\[\]()（）]/g, '');
  const nt = norm(linkText);
  const ns = norm(searchName);
  if (!nt || !ns || nt.length < 2 || ns.length < 2) return 0;
  if (nt === ns) return 100;
  if (nt.includes(ns)) return 85;
  if (ns.includes(nt) && nt.length >= 4) return 70;
  // 按分隔符拆分链接文本（如 "王之凝视|v1.3.2|官方中文|The King is Watching"）
  const segments = linkText.split(/[|\/]/).map(s => norm(s)).filter(s => s.length >= 2);
  for (const seg of segments) {
    if (seg === ns) return 95;
    if (seg.includes(ns)) return 80;
    if (ns.includes(seg) && seg.length >= 4) return 65;
  }
  return 0;
}

// 从详情页HTML提取元数据（更新日期/版本/大小）
// 原则：仅在有明确标签时提取，获取不到正确信息则留空（跳过）
function extractDetailMeta(html, siteKey) {
  const meta = { updateDate: '', version: '', size: '' };
  if (!html) return meta;
  
  // 提取h1标题文本（用于从标题提取版本）
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1Text = h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : '';
  
  // === 更新日期：仅匹配明确的“更新时间/最近更新/发布日期”标签 ===
  const dateLabelMatch = html.match(/(?:更新时间|最近更新|发布日期)[^0-9]{0,15}([0-9]{4}[-\/年][0-9]{1,2}[-\/月][0-9]{1,2})/);
  if (dateLabelMatch) {
    meta.updateDate = dateLabelMatch[1].replace(/[年月]/g, '-').replace(/日$/, '');
  }
  
  // === 版本 + 大小：按站点适配 ===
  if (siteKey === 'xdgame') {
    // xdgame: <h4>版本介绍</h4><p>v1.3.2|容量565MB|官方简体中文|...</p>
    const verIntroMatch = html.match(/版本介绍<\/h[0-9]>\s*<p>([\s\S]*?)<\/p>/i);
    if (verIntroMatch) {
      const verLine = verIntroMatch[1].replace(/<[^>]+>/g, '');
      const vMatch = verLine.match(/\b([Vv]?\d+(?:\.\d+)+)\b/) || verLine.match(/(Build\.?\d+)/i);
      if (vMatch) meta.version = vMatch[1];
      const sizeMatch = verLine.match(/容量\s*([0-9.]+\s*(?:GB|MB|TB|G\b|M\b))/i);
      if (sizeMatch) meta.size = sizeMatch[1].trim();
    }
  }
  
  // 从标题提取版本（xianyudanji/gamer520 标题含版本号，如 v1.3.2 或 Build.24147194）
  if (!meta.version && h1Text) {
    const h1Ver = h1Text.match(/\b([Vv]\d+(?:\.\d+)+)\b/) || h1Text.match(/(Build\.?\d+)/i);
    if (h1Ver) meta.version = h1Ver[1];
  }
  
  // === 大小：仅匹配明确的“容量/游戏大小/文件大小”标签（避免误取系统需求的内存/存储空间） ===
  if (!meta.size) {
    const sizeLabelMatch = html.match(/(?:容量|游戏大小|文件大小|资源大小)[^0-9]{0,10}([0-9.]+\s*(?:GB|MB|TB))/i);
    if (sizeLabelMatch) meta.size = sizeLabelMatch[1].trim();
  }
  
  return meta;
}

async function searchDownloadSites(gameName, appId) {
  const results = [];
  // 使用清理后的名称搜索
  const searchName = cleanGameName(gameName) || gameName;
  
  for (const site of DOWNLOAD_SITES) {
    const result = { key: site.key, name: site.name, found: false, detailUrl: '', searchUrl: site.searchUrl(searchName), updateDate: '', version: '', size: '' };
    try {
      const resp = await fetch(site.searchUrl(searchName), {
        headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' }
      });
      if (!resp.ok) { results.push(result); continue; }
      const html = await resp.text();
      
      // 提取所有候选详情链接及其文本（数字.html 或 /game/数字）
      const candidates = [];
      const linkRe = /<a[^>]*href="([^"]*(?:\/\d+\.html?|\/game\/\d+[^"]*))"[^>]*>([\s\S]*?)<\/a>/gi;
      let lm;
      while ((lm = linkRe.exec(html)) !== null) {
        const href = lm[1];
        const text = lm[2].replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
        // 跳过导航/分页类链接（文本过短且不含中文/游戏名）
        candidates.push({ href, text });
      }
      
      // 按文本匹配度排序，选出最符合游戏名的链接
      let bestUrl = '';
      let bestScore = 0;
      for (const c of candidates) {
        const score = Math.max(calcLinkMatchScore(c.text, searchName), calcLinkMatchScore(c.text, gameName));
        if (score > bestScore) {
          bestScore = score;
          bestUrl = c.href;
        }
      }
      
      // 只有文本匹配度足够高才认为找到（避免链接到无关页面）
      if (bestUrl && bestScore >= 60) {
        const detailUrl = bestUrl.startsWith('http') ? bestUrl : site.base + (bestUrl.startsWith('/') ? '' : '/') + bestUrl;
        result.found = true;
        result.detailUrl = detailUrl;
        // 抓取详情页提取元数据
        try {
          const dResp = await fetch(detailUrl, { headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' } });
          if (dResp.ok) {
            const dHtml = await dResp.text();
            const meta = extractDetailMeta(dHtml, site.key);
            result.updateDate = meta.updateDate;
            result.version = meta.version;
            result.size = meta.size;
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

// ============ 功能2：限免游戏 ============

// 从 Epic 获取限免游戏
async function fetchEpicFreeGames() {
  const games = [];
  try {
    const url = 'https://store-site-backend-official.ak.epicgames.com/freeGamesPromotions?locale=zh-CN&country=CN&allowCountries=CN';
    const resp = await fetch(url);
    const data = await resp.json();
    const elements = data?.data?.Catalog?.searchStore?.elements || [];
    for (const el of elements) {
      // 只取当前正在限免的
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

// 从 GOG 获取限免游戏
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
      // GOG的免费游戏（可能是永久免费或限免）
      games.push({
        id: 'gog-' + p.id,
        platform: 'gog',
        platformName: 'GOG',
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

// 从 Steam 获取限免/免费领取游戏
async function fetchSteamFreeGames() {
  const games = [];
  try {
    // 搜索当前免费的游戏
    const resp = await fetch('https://store.steampowered.com/api/featuredcategories/?l=schinese&cc=cn');
    if (!resp.ok) return games;
    const data = await resp.json();
    // 从特别优惠中寻找免费游戏
    const specials = data?.specials?.items || [];
    for (const item of specials) {
      if (item.final_price === 0 || item.discount_percent === 100) {
        games.push({
          id: 'steam-' + item.id,
          platform: 'steam',
          platformName: 'Steam',
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

// 从 GamerPower（第三方聚合渠道）获取限免游戏
// 该平台聚合了 Epic/Steam/GOG/Itch.io 等多平台的限免信息，可靠性高
async function fetchGamerPowerFreeGames() {
  const games = [];
  try {
    const resp = await fetch('https://www.gamerpower.com/api/giveaways');
    if (!resp.ok) return games;
    const data = await resp.json();
    if (!Array.isArray(data)) return games;
    
    for (const item of data) {
      // platforms 是逗号分隔字符串，如 "PC, Epic Games Store"
      const platforms = (item.platforms || '').toLowerCase();
      // 判断所属平台
      let platform = 'other';
      let platformName = '其他';
      if (platforms.includes('epic')) { platform = 'epic'; platformName = 'Epic Games'; }
      else if (platforms.includes('steam')) { platform = 'steam'; platformName = 'Steam'; }
      else if (platforms.includes('gog')) { platform = 'gog'; platformName = 'GOG'; }
      else if (platforms.includes('itch')) { platform = 'itch'; platformName = 'Itch.io'; }
      else if (platforms.includes('drm-free') || platforms.includes('pc')) { platform = 'pc'; platformName = 'PC'; }
      
      // 只保留PC相关平台的限免
      if (platform === 'other') continue;
      
      games.push({
        id: 'gp-' + item.id,
        platform: platform,
        platformName: platformName,
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

// 汇总抓取所有限免游戏（官方渠道 + 第三方聚合渠道，去重）
async function fetchAllFreeGames() {
  const [epic, gog, steam, gamerpower] = await Promise.all([
    fetchEpicFreeGames(),
    fetchGogFreeGames(),
    fetchSteamFreeGames(),
    fetchGamerPowerFreeGames()
  ]);
  
  // 官方渠道优先，第三方渠道补充
  const merged = [...epic, ...gog, ...steam];
  const seenNames = new Set(merged.map(g => normalizeGameName(g.name)));
  
  for (const gp of gamerpower) {
    const norm = normalizeGameName(gp.name);
    // 如果官方渠道已有同名游戏则跳过
    if (!seenNames.has(norm)) {
      seenNames.add(norm);
      merged.push(gp);
    }
  }
  
  return merged;
}

// 游戏名标准化（用于去重）
function normalizeGameName(name) {
  return (name || '').toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')       // 去除括号内容（如 (Steam)）
    .replace(/giveaway|free|限免|领取/gi, '') // 去除限免相关词
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, '')  // 只保留字母数字中文
    .trim();
}

// 刷新限免游戏（保留已领取状态）
async function refreshFreeGames(force = false) {
  const data = await chrome.storage.local.get(DB_KEYS.FREE_GAMES);
  const existing = data[DB_KEYS.FREE_GAMES] || { lastUpdate: 0, games: [] };
  
  // 每天刷新一次（除非强制）
  const ONE_DAY = 24 * 3600 * 1000;
  if (!force && existing.lastUpdate && (Date.now() - existing.lastUpdate < ONE_DAY)) {
    return existing;
  }
  
  const newGames = await fetchAllFreeGames();
  // 保留已领取标记
  const claimedIds = new Set(existing.games.filter(g => g.claimed).map(g => g.id));
  newGames.forEach(g => { if (claimedIds.has(g.id)) g.claimed = true; });
  
  const result = { lastUpdate: Date.now(), games: newGames };
  await chrome.storage.local.set({ [DB_KEYS.FREE_GAMES]: result });
  await updateFreeGamesBadge();
  return result;
}

// 更新扩展图标角标（待领取数量）
async function updateFreeGamesBadge() {
  try {
    const data = await chrome.storage.local.get(DB_KEYS.FREE_GAMES);
    const games = data[DB_KEYS.FREE_GAMES]?.games || [];
    const unclaimed = games.filter(g => !g.claimed).length;
    chrome.action.setBadgeText({ text: unclaimed > 0 ? String(unclaimed) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
  } catch (e) {
    console.log('更新badge失败:', e.message);
  }
}

// ============ 消息处理 ============

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    console.error('消息处理错误:', err);
    sendResponse({ error: err.message });
  });
  return true; // 保持消息通道开放
});

async function handleMessage(message, sender) {
  switch (message.action) {
    case 'TRACK_EVENT':
      // 记录用户行为
      await addBehaviorLog(message.data);
      if (message.data.type === 'click_download') {
        await updateGameProfile({
          name: message.data.gameName,
          event: 'download',
          keywords: message.data.keywords
        });
        Logger.info('Download', `下载"${message.data.gameName}"`, { method: message.data.method, domain: message.data.domain });
      }
      if (message.data.type === 'view_detail') {
        await updateGameProfile({
          name: message.data.gameName,
          event: 'view',
          keywords: message.data.keywords
        });
      }
      // Steam标签回写 - 用Steam标签替代页面关键词
      if (message.data.type === 'steam_tags_update') {
        await updateGameProfile({
          name: message.data.gameName,
          event: 'view',
          keywords: message.data.keywords,  // Steam genres/tags
          steamAppId: message.data.steamAppId,
          steamRating: message.data.steamRating
        });
        // 更新关键词权重（使用Steam标签）
        await updateUserPreferences();
      }
      // 定期更新偏好模型
      if (message.data.type !== 'steam_tags_update') {
        await updateUserPreferences();
      }
      return { success: true };
      
    case 'GET_RECOMMENDATIONS':
      // 批量计算推荐分数
      // 列表页批量请求始终使用内置算法（避免LLM批量调用过慢）
      const games = message.games || [];
      const useBuiltinOnly = games.length > 1; // 批量时强制内置算法
      const results = [];
      for (const game of games) {
        const score = await calculateRecommendation(game, useBuiltinOnly);
        results.push({ ...game, recommendation: score });
      }
      return { results };
      
    case 'SEARCH_STEAM':
      // 搜索Steam游戏
      const steamResult = await searchSteamGame(message.gameName);
      if (steamResult) {
        Logger.info('Steam', `匹配"${message.gameName}" → ${steamResult.name}`, { appId: steamResult.appId, rating: steamResult.ratingDesc });
      } else {
        Logger.warn('Steam', `未找到"${message.gameName}"`);
      }
      return { data: steamResult };
      
    case 'GET_SETTINGS':
      return { settings: await getSettings() };
      
    case 'SAVE_SETTINGS':
      await saveSettings(message.settings);
      return { success: true };
      
    case 'GET_STATS':
      // 获取统计信息
      const log = await getBehaviorLog();
      const profilesData = await chrome.storage.local.get(DB_KEYS.GAME_PROFILES);
      const kwData = await chrome.storage.local.get(DB_KEYS.KEYWORD_WEIGHTS);
      const profiles = profilesData[DB_KEYS.GAME_PROFILES] || {};
      const keywordWeights = kwData[DB_KEYS.KEYWORD_WEIGHTS] || {};
      
      // 详细统计
      const viewDetailCount = log.filter(e => e.type === 'view_detail').length;
      const downloadCount = log.filter(e => e.type === 'click_download').length;
      const listViewCount = log.filter(e => e.type === 'view_list').length;
      
      // 游戏列表（按下载数排序）
      const gameList = Object.values(profiles)
        .sort((a, b) => b.downloads - a.downloads || b.views - a.views)
        .slice(0, 50);
      
      // 下载方式统计
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
      
    case 'GET_STEAM_RECOMMENDATIONS':
      // 基于用户偏好推荐Steam游戏
      const kwDataForRec = await chrome.storage.local.get(DB_KEYS.KEYWORD_WEIGHTS);
      const weightsForRec = kwDataForRec[DB_KEYS.KEYWORD_WEIGHTS] || {};
      const topTags = Object.entries(weightsForRec)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([kw]) => kw);
      
      if (topTags.length === 0) {
        return { games: [], message: '还没有足够的学习数据，请先浏览一些游戏网站' };
      }
      
      // 使用Steam搜索API根据标签推荐
      try {
        const recGames = [];
        // 用每个顶级标签搜索Steam
        for (const tag of topTags.slice(0, 3)) {
          const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(tag)}&l=schinese&cc=cn`;
          const resp = await fetch(searchUrl);
          const data = await resp.json();
          
          if (data.total > 0 && data.items) {
            for (const item of data.items.slice(0, 4)) {
              // 避免重复
              if (recGames.some(g => g.appId === item.id)) continue;
              
              // 获取简要信息
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
      
    case 'CLEAR_DATA':
      await chrome.storage.local.remove([
        DB_KEYS.BEHAVIOR_LOG,
        DB_KEYS.GAME_PROFILES,
        DB_KEYS.KEYWORD_WEIGHTS,
        DB_KEYS.STEAM_CACHE
      ]);
      return { success: true };
      
    case 'SEARCH_DOWNLOAD_SITES':
      // 功能3：搜索下载站资源
      const sites = await searchDownloadSites(message.gameName, message.appId);
      Logger.info('DownloadSites', `搜索"${message.gameName}"`, { found: sites.filter(s => s.found).map(s => s.key) });
      return { sites };
      
    case 'GET_FREE_GAMES':
      // 功能2：获取限免游戏
      const freeData = await refreshFreeGames(message.force === true);
      Logger.info('FreeGames', `获取限免游戏`, { count: freeData.games ? freeData.games.length : 0 });
      return { data: freeData };
      
    case 'CLAIM_FREE_GAME':
      // 功能2：标记游戏已领取
      const fgData = await chrome.storage.local.get(DB_KEYS.FREE_GAMES);
      const fg = fgData[DB_KEYS.FREE_GAMES] || { games: [] };
      const game = fg.games.find(g => g.id === message.gameId);
      if (game) {
        game.claimed = true;
        await chrome.storage.local.set({ [DB_KEYS.FREE_GAMES]: fg });
        await updateFreeGamesBadge();
      }
      return { success: true };
      
    // ============ 运行日志消息 ============
    case 'GET_RUNTIME_LOGS':
      return { logs: await getRuntimeLogs(message.limit) };
      
    case 'CLEAR_RUNTIME_LOGS':
      await clearRuntimeLogs();
      return { success: true };
      
    case 'EXPORT_LOGS':
      return { logs: await getRuntimeLogs() };
      
    // ============ 备份消息 ============
    case 'CREATE_BACKUP':
      const newBackup = await createBackup(true);
      return { success: !!newBackup, backup: newBackup ? { id: newBackup.id, timestamp: newBackup.timestamp } : null };
      
    case 'GET_BACKUPS':
      return { backups: await getBackupList() };
      
    case 'RESTORE_BACKUP':
      return await restoreBackup(message.backupId);
      
    case 'DELETE_BACKUP':
      return await deleteBackup(message.backupId);
      
    default:
      return { error: 'Unknown action: ' + message.action };
  }
}

// 初始化
initStorage();

// 功能2：设置每日刷新限免游戏的定时器
chrome.alarms.create('refreshFreeGames', { periodInMinutes: 24 * 60 });

// 自动备份定时器（根据设置间隔）
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
