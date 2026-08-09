/**
 * Game Recommender - 常量与配置 / Constants & Config
 *
 * 全局常量集中定义（无依赖模块）。所有模块从这里 import 常量，
 * 保证顶层初始化顺序安全（TDZ 免疫）。
 * Central constants (dependency-free). All modules import from here, keeping
 * top-level initialization order-safe (TDZ-proof).
 */

// 存储键定义 / Storage keys
export const DB_KEYS = {
  BEHAVIOR_LOG: 'behaviorLog',
  GAME_PROFILES: 'gameProfiles',
  USER_PREFERENCES: 'userPrefs',
  SETTINGS: 'settings',
  STEAM_CACHE: 'steamCache',
  KEYWORD_WEIGHTS: 'keywordWeights',
  FREE_GAMES: 'freeGames',
  RUNTIME_LOG: 'runtimeLog',
  BACKUPS: 'backups',
  DOWNLOAD_HISTORY: 'downloadHistory',
  MANUAL_MAPPINGS: 'manualMappings', // 旧版手动映射（兼容保留，新逻辑改用 NAME_INDEX）
  GAME_REGISTRY: 'gameRegistry', // appId → {cnName, enName, names[], firstSeen, lastConfirmed} 永久，30天重确认
  NAME_INDEX: 'nameIndex',       // name_lower → {appId, lastSearched} 名称反查 appId 的索引
  DOWNLOAD_URLS: 'downloadUrls', // 下载站网址缓存（按站点分桶 v2）
  ADAPTER_RULES: 'adapterRules'  // 用户导入的下载站适配规则（覆盖内置 sites.js，可导出迁移）
};

// 默认设置 / Default settings
export const DEFAULT_SETTINGS = {
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
  enableRatingFilter: false, // 是否启用好评率过滤
  enableVmFilter: false, // 是否启用虚拟机标题过滤
  vmFilterKeywords: ['虚拟机板', '虚拟机'], // 虚拟机过滤关键词列表
  steamSiteSearch: ['xdgame', 'xianyudanji', 'gamer520'], // Steam详情页检索的下载站
  // 各类缓存有效期（可在设置页自定义）/ Cache TTLs (customizable in settings)
  cacheTtls: {
    steamDynamic: 24,    // Steam 动态缓存（小时）/ hours
    registryConfirm: 30, // 游戏注册表重确认（天）/ days
    downloadUrls: 30,    // 下载站网址缓存（天）/ days
    negativeCache: 2     // 名称搜索负缓存（小时）/ hours
  },
  // 日志配置 / Logging configuration
  logLevel: 'info',       // 记录级别：debug|info|warn|error
  logRetentionDays: 7,    // 日志保留天数（0 = 不清理）
  logStorage: 'ndjson'    // 存储形式：ndjson(OPFS 文件) | local(storage.local)
};

// 日志级别 / Log levels
export const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

// 缓存 TTL 配置（随设置动态更新，可在设置页自定义各类缓存有效期）
// Cache TTL config, updated dynamically from settings
let TTL_CONFIG = { steamDynamic: 24, registryConfirm: 30, downloadUrls: 30, negativeCache: 2 };

// 更新 TTL 配置（由 settings 模块调用）/ Update TTL config (called by settings)
export function setTtlConfig(ttls) {
  TTL_CONFIG = { ...TTL_CONFIG, ...(ttls || {}) };
}

// 各缓存类型的有效期（毫秒）/ Per-cache-type TTLs (ms)
export const steamCacheTtlMs = () => (TTL_CONFIG.steamDynamic || 24) * 3600 * 1000;
export const registryConfirmTtlMs = () => (TTL_CONFIG.registryConfirm || 30) * 24 * 3600 * 1000;
export const nameNegativeCacheTtlMs = () => (TTL_CONFIG.negativeCache || 2) * 3600 * 1000;

// Steam 缓存写参数 / Steam cache write parameters
export const STEAM_CACHE_WRITE_DEBOUNCE = 2000; // 2秒防抖写入 / 2s debounced write
// 最大条目数（控制配额占用；激进清理用于配额超限后）
export const STEAM_CACHE_MAX_ENTRIES = 1200;
export const STEAM_CACHE_MAX_ENTRIES_AGGRESSIVE = 600;

// Steam 缓存结构版本（匹配逻辑变更时递增，使旧缓存自动失效）
export const STEAM_CACHE_VERSION = 5;

// 名称索引/注册表写参数 / Name-index & registry write params
export const NAME_INDEX_WRITE_DEBOUNCE = 2000;
export const REGISTRY_WRITE_DEBOUNCE = 2000;

// 下载站网址缓存结构版本 / Download-URL store version
export const DOWNLOAD_URLS_VERSION = 2;

// 日志缓冲写参数 / Log buffer write params
export const LOG_FLUSH_DEBOUNCE = 2000;

// 偏好模型更新节流 / Preference-model update throttle
export const PREF_UPDATE_INTERVAL = 60000;

// 数据模块注册表：所有可备份/导入/导出的数据按模块组织，支持自定义勾选。
// storageKey 使用字符串字面量，彻底免疫顶层初始化顺序依赖（TDZ 防御）。
// Data-module registry (string-literal keys; TDZ-proof).
export const DATA_MODULES = [
  { key: 'settings',        name: '扩展配置',      desc: 'Settings',        storageKey: 'settings' },
  { key: 'behaviorLog',     name: '浏览记录',      desc: 'Behavior Log',    storageKey: 'behaviorLog' },
  { key: 'gameProfiles',    name: '游戏画像',      desc: 'Game Profiles',   storageKey: 'gameProfiles' },
  { key: 'keywordWeights',  name: '推荐模型',      desc: 'Keyword Weights', storageKey: 'keywordWeights' },
  { key: 'steamCache',      name: 'Steam 缓存',    desc: 'Steam Cache',     storageKey: 'steamCache' },
  { key: 'gameRegistry',    name: '游戏注册表',    desc: 'Game Registry',   storageKey: 'gameRegistry' },
  { key: 'nameIndex',       name: '名称索引',      desc: 'Name Index',      storageKey: 'nameIndex' },
  { key: 'downloadUrls',    name: '下载站网址缓存', desc: 'Download URLs',  storageKey: 'downloadUrls' },
  { key: 'freeGames',       name: '限免游戏',      desc: 'Free Games',      storageKey: 'freeGames' },
  { key: 'runtimeLog',      name: '运行日志',      desc: 'Runtime Logs',    storageKey: 'runtimeLog' },
  { key: 'downloadHistory', name: '下载历史',      desc: 'Download History', storageKey: 'downloadHistory' },
  { key: 'adapterRules',    name: '适配规则',      desc: 'Adapter Rules',   storageKey: 'adapterRules' }
];

// 导出文件格式标识与版本 / Export file format id and version
export const EXPORT_FORMAT = 'game-recommender-backup';
export const EXPORT_VERSION = 1;
