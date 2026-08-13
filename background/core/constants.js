// @ts-strict
/**
 * 游戏雷达 Game Radar - 常量与配置 / Constants & Config
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
  SETTINGS: 'settings',
  STEAM_CACHE: 'steamCache',
  KEYWORD_WEIGHTS: 'keywordWeights',
  FREE_GAMES: 'freeGames',
  RUNTIME_LOG: 'runtimeLog',
  BACKUPS: 'backups',
  DOWNLOAD_HISTORY: 'downloadHistory',
  MANUAL_MAPPINGS: 'manualMappings', // 旧版手动映射（兼容保留，新逻辑改用 NAME_INDEX）
  GAME_REGISTRY: 'gameRegistry', // appId → {cnName, enName, names[], firstSeen, lastConfirmed} 永久，30天重确认
  NAME_INDEX: 'nameIndex', // name_lower → {appId, lastSearched} 名称反查 appId 的索引
  DOWNLOAD_URLS: 'downloadUrls', // 下载站网址缓存（按站点分桶 v2）
  ADAPTER_RULES: 'adapterRules', // 用户导入的下载站适配规则（覆盖内置 sites.js，可导出迁移）
  LEARNED_NOISE: 'learnedNoise', // 动态学习的标题噪声词（自适应检索，v3.1.2）
  WRONG_REPORTS: 'wrongReports', // 详情页报错重检索记录（v3.3.13，长期有效，含人工纠正知识库）
  SEARCH_CACHE: 'searchCache', // 下载站搜索结果缓存（v6.4.3，24h TTL）
  LLM_SCORE: 'llmScore' // LLM 推荐评分缓存（v6.4.3，7d TTL）
};

// 默认设置 / Default settings
export const DEFAULT_SETTINGS = {
  enabled: true,
  showDebugPanel: false,
  showStatusBar: false, // 工作状态/诊断浮窗总开关（v3.3.15 默认禁用，设置页/popup 可开）
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
  // v6.3.3：ITAD 二次校验 key（可选——限免通知候选的免费状态确认）
  itadApiKey: '',
  weights: {
    // v4.0.0：新增 SteamSpy 时长/热度信号（playTime/heat），四项原有权重
    // 同步下调，六项和保持 1.0（徽章百分比不超 100%）
    clickRate: 0.15,
    downloadRate: 0.3,
    keywordMatch: 0.2,
    steamRating: 0.15,
    playTime: 0.1,
    heat: 0.1
  },
  trackedSites: [
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
  enableLog: true,
  maxRuntimeLog: 300,
  autoBackup: true,
  backupIntervalHours: 24,
  maxBackups: 7,
  minSteamRatingFilter: 0, // 列表页最低Steam好评率过滤（0-100，0表示不过滤）
  enableRatingFilter: false, // 是否启用好评率过滤
  enableVmFilter: false, // 是否启用虚拟机标题过滤
  vmFilterKeywords: ['虚拟机板', '虚拟机'], // 虚拟机过滤关键词列表
  // 列表页徽章显示开关（v3.3.8，默认全开）。关闭不影响后台数据获取；
  // 关闭"全部好评率"→ 好评率过滤停用；关闭"推荐值"→ 推荐高亮停用
  // List-page badge toggles (all on by default). Data fetching keeps running;
  // turning off "all" also disables the rating filter, "rec" the highlighting.
  badgeVisibility: { recent: true, all: true, update: true, rec: true },
  maxScanLinks: 500, // 列表页链接扫描上限（大列表页性能保护，v3.3.9 可配置）
  steamSiteSearch: ['xdgame', 'xianyudanji', 'gamer520'], // Steam详情页检索的下载站
  // 各类缓存有效期（可在设置页自定义；value 0 = 长期有效）
  // Cache TTLs (customizable in settings; value 0 = keep forever)
  cacheTtls: {
    steamDynamic: { value: 7, unit: 'days' }, // 好评率缓存（rating 模块）——周级稳定数据，24h→7d 减少重复请求（v6.2.1）/ days
    detailSteam: { value: 72, unit: 'hours' }, // 详情页完整缓存（detail 模块）/ hours
    spySteam: { value: 7, unit: 'days' }, // SteamSpy/SteamDB 补充数据（spy 模块）/ days
    metaSteam: { value: 30, unit: 'days' }, // Steam 基础信息（meta 模块）/ days
    registryConfirm: { value: 30, unit: 'days' }, // 游戏注册表重确认 / days
    downloadUrls: { value: 30, unit: 'days' }, // 下载站网址缓存 / days
    negativeCache: { value: 2, unit: 'hours' } // 名称搜索负缓存 / hours
  },
  // 日志配置 / Logging configuration
  logLevel: 'info', // 记录级别：debug|info|warn|error
  logRetentionDays: 7, // 日志保留天数（0 = 不清理）
  logStorage: 'ndjson' // 存储形式：ndjson(OPFS 文件) | local(storage.local)
};

// 日志级别 / Log levels
export const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

// 缓存 TTL 配置（随设置动态更新，可在设置页自定义各类缓存有效期）
// Cache TTL config, updated dynamically from settings
let TTL_CONFIG = {
  steamDynamic: { value: 7, unit: 'days' },
  detailSteam: { value: 72, unit: 'hours' },
  spySteam: { value: 7, unit: 'days' },
  metaSteam: { value: 30, unit: 'days' },
  registryConfirm: { value: 30, unit: 'days' },
  downloadUrls: { value: 30, unit: 'days' },
  negativeCache: { value: 2, unit: 'hours' }
};

// 更新 TTL 配置（由 settings 模块调用）/ Update TTL config (called by settings)
export function setTtlConfig(ttls) {
  TTL_CONFIG = { ...TTL_CONFIG, ...(ttls || {}) };
}

// TTL 单位换算（小时/天/月/年）/ Unit-to-ms conversion
const UNIT_MS = { hours: 3600e3, days: 86400e3, months: 30 * 86400e3, years: 365 * 86400e3 };
// 默认值与默认单位（旧格式数字兼容）/ Defaults and default units (legacy-number compatible)
const TTL_DEFAULTS = {
  steamDynamic: 24,
  detailSteam: 72,
  spySteam: 7,
  metaSteam: 30,
  registryConfirm: 30,
  downloadUrls: 30,
  negativeCache: 2
};
const TTL_UNITS = {
  steamDynamic: 'hours',
  detailSteam: 'hours',
  spySteam: 'days',
  metaSteam: 'days',
  registryConfirm: 'days',
  downloadUrls: 'days',
  negativeCache: 'hours'
};

function toMs(value, unit) {
  if (value === 0) return Infinity; // 0 = 长期有效 / 0 = keep forever
  return value * (UNIT_MS[unit] || UNIT_MS.hours);
}

// 解析某缓存类型的 TTL 为毫秒（支持 {value, unit} 与旧数字格式；0 = 长期）
// Resolve a cache type's TTL to ms ({value,unit} or legacy number; 0 = forever)
export function resolveTtlMs(key, value) {
  const raw = value === null || value === undefined ? TTL_DEFAULTS[key] : value;
  const num = typeof raw === 'object' ? raw.value : raw;
  const unit = typeof raw === 'object' ? raw.unit || TTL_UNITS[key] : TTL_UNITS[key];
  if (num === undefined || num === null) return toMs(TTL_DEFAULTS[key], TTL_UNITS[key]);
  return toMs(num, unit);
}

// 各缓存类型的有效期（毫秒；0 配置 = Infinity 长期有效）
export const steamCacheTtlMs = () => resolveTtlMs('steamDynamic', TTL_CONFIG.steamDynamic);
// 详情页完整缓存有效期（v3.3.3 独立设置：详情信息变化慢，TTL 可比列表页长；
// 列表页好评率缓存保持 steamDynamic 的新鲜度）
export const detailSteamCacheTtlMs = () => resolveTtlMs('detailSteam', TTL_CONFIG.detailSteam);
// SteamSpy/SteamDB 补充数据有效期（v3.3.7：spy 模块独立刷新）
export const spySteamCacheTtlMs = () => resolveTtlMs('spySteam', TTL_CONFIG.spySteam);
// Steam 基础信息有效期（v3.3.7：meta 模块，名称/类型/封面几乎不变）
export const metaSteamCacheTtlMs = () => resolveTtlMs('metaSteam', TTL_CONFIG.metaSteam);
export const registryConfirmTtlMs = () => resolveTtlMs('registryConfirm', TTL_CONFIG.registryConfirm);
export const nameNegativeCacheTtlMs = () => resolveTtlMs('negativeCache', TTL_CONFIG.negativeCache);

// 缓存模块 → TTL 配置 key 映射（v3.3.7 模块化缓存）
// Module → TTL-config-key mapping (modular cache since v3.3.7)
export const MODULE_TTL_KEYS = {
  meta: 'metaSteam',
  rating: 'steamDynamic',
  detail: 'detailSteam',
  spy: 'spySteam'
};

// 某缓存模块的有效期（毫秒）/ TTL of one cache module (ms)
export function moduleTtlMs(moduleKey) {
  const key = MODULE_TTL_KEYS[moduleKey];
  if (!key) return steamCacheTtlMs();
  return resolveTtlMs(key, TTL_CONFIG[key]);
}

// Steam 缓存写参数 / Steam cache write parameters
export const STEAM_CACHE_WRITE_DEBOUNCE = 2000; // 2秒防抖写入 / 2s debounced write
// 最大条目数（控制配额占用）
export const STEAM_CACHE_MAX_ENTRIES = 1200;

// Steam 缓存结构版本（匹配逻辑变更时递增，使旧缓存自动失效）
// v3.3.6：新增 recentPositiveRate/recentTotalReviews/lastUpdate 字段
export const STEAM_CACHE_VERSION = 6;

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
  { key: 'settings', name: '扩展配置', desc: 'Settings', storageKey: 'settings' },
  { key: 'behaviorLog', name: '浏览记录', desc: 'Behavior Log', storageKey: 'behaviorLog' },
  { key: 'gameProfiles', name: '游戏画像', desc: 'Game Profiles', storageKey: 'gameProfiles' },
  { key: 'keywordWeights', name: '推荐模型', desc: 'Keyword Weights', storageKey: 'keywordWeights' },
  { key: 'steamCache', name: 'Steam 缓存', desc: 'Steam Cache', storageKey: 'steamCache' },
  { key: 'gameRegistry', name: '游戏注册表', desc: 'Game Registry', storageKey: 'gameRegistry' },
  { key: 'nameIndex', name: '名称索引', desc: 'Name Index', storageKey: 'nameIndex' },
  { key: 'downloadUrls', name: '下载站网址缓存', desc: 'Download URLs', storageKey: 'downloadUrls' },
  { key: 'freeGames', name: '限免游戏', desc: 'Free Games', storageKey: 'freeGames' },
  { key: 'runtimeLog', name: '运行日志', desc: 'Runtime Logs', storageKey: 'runtimeLog' },
  { key: 'downloadHistory', name: '下载历史', desc: 'Download History', storageKey: 'downloadHistory' },
  { key: 'adapterRules', name: '适配规则', desc: 'Adapter Rules', storageKey: 'adapterRules' },
  { key: 'searchCache', name: '下载站搜索缓存', desc: 'Search Cache', storageKey: 'searchCache' },
  { key: 'llmScore', name: 'LLM 评分缓存', desc: 'LLM Score Cache', storageKey: 'llmScore' },
  { key: 'learnedNoise', name: '标题噪声词', desc: 'Learned Noise', storageKey: 'learnedNoise' },
  { key: 'wrongReports', name: '报错纠正记录', desc: 'Wrong Reports', storageKey: 'wrongReports' }
];

// 导出文件格式标识与版本 / Export file format id and version
export const EXPORT_FORMAT = 'game-recommender-backup';
export const EXPORT_VERSION = 1;
