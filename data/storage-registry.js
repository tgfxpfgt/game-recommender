// @ts-strict
/**
 * 游戏雷达 Game Radar - 存储模块注册表（单源）/ Storage Module Registry
 *
 * v10.7.0 批次2：此前同一事实散落三张表（constants.js DB_KEYS/DATA_MODULES、
 * data-store.js MODULE_FILES、backups.js BACKUP_CORE_KEYS）已漂移
 * （26/24/25 条互不一致）。本注册表是唯一事实源：
 *   - data-store.js 的 file/format 映射由此派生
 *   - DATA_MODULES（导出/导入/清理 UI 清单）由此派生（name 非空且非 legacy）
 *   - BACKUP_CORE_KEYS（默认备份子集）由 backup 标记派生
 *   - handleClearData 的清除范围由 clearOnDataReset 标记派生
 * 新增存储模块 = 本表一行 + 业务文件（原 6 文件接线）。
 * data 层模块不得 import background/*（分层矩阵），故本表放 data/ 底座。
 *
 * Single source of truth for storage modules; MODULE_FILES / DATA_MODULES /
 * BACKUP_CORE_KEYS / clear-scope are all derived. Adding a module = one row
 * here + its business file. Lives in data/ (bottom layer, no bg imports).
 */

/** @type {Object<string, {file: string, format: 'json'|'ndjson'|'ndjson-map', name?: string, desc?: string, backup?: boolean, clearOnDataReset?: boolean, legacy?: boolean}>} */
export const STORAGE_MODULES = {
  settings: { file: 'settings.json', format: 'json', name: '扩展配置', desc: 'Settings', backup: true },
  behaviorLog: {
    file: 'behavior-log.ndjson',
    format: 'ndjson',
    name: '浏览记录',
    desc: 'Behavior Log',
    clearOnDataReset: true
  },
  gameProfiles: {
    file: 'game-profiles.json',
    format: 'json',
    name: '游戏画像',
    desc: 'Game Profiles',
    backup: true,
    clearOnDataReset: true
  },
  keywordWeights: {
    file: 'keyword-weights.json',
    format: 'json',
    name: '推荐模型',
    desc: 'Keyword Weights',
    backup: true,
    clearOnDataReset: true
  },
  steamCache: { file: 'steam-cache.json', format: 'json', legacy: true, clearOnDataReset: true }, // 旧版单文件（v10.6.0 起仅迁移期读取）
  steamCacheMeta: {
    file: 'steam-cache-meta.json',
    format: 'json',
    name: 'Steam 基础缓存',
    desc: 'Steam Meta Cache',
    clearOnDataReset: true
  }, // v10.6.0 C1 分模块
  steamCacheRating: {
    file: 'steam-cache-rating.json',
    // v14 B7：追加式行格式（每行 {key, value}，读端逐行合并 = 最新胜出）——
    // flush 只追加脏条目行，行数超 2×活跃条目数时 compaction 全量重写；
    // 旧 JSON 全量对象首读自动迁移（文件名不变，内容原位转换）
    format: 'ndjson-map',
    name: 'Steam 好评率缓存',
    desc: 'Steam Rating Cache',
    clearOnDataReset: true
  },
  steamCacheDetail: {
    file: 'steam-cache-detail.json',
    format: 'json',
    name: 'Steam 详情缓存',
    desc: 'Steam Detail Cache',
    clearOnDataReset: true
  },
  steamCacheSpy: {
    file: 'steam-cache-spy.json',
    format: 'json',
    name: 'Steam 热度缓存',
    desc: 'Steam Spy Cache',
    clearOnDataReset: true
  },
  gameRegistry: {
    file: 'game-registry.json',
    format: 'json',
    name: '游戏注册表',
    desc: 'Game Registry',
    backup: true,
    clearOnDataReset: true
  },
  nameIndex: {
    file: 'name-index.json',
    format: 'json',
    name: '名称索引',
    desc: 'Name Index',
    backup: true,
    clearOnDataReset: true
  },
  downloadUrls: {
    file: 'download-urls.json',
    format: 'json',
    name: '下载站网址缓存',
    desc: 'Download URLs',
    clearOnDataReset: true
  },
  freeGames: { file: 'free-games.json', format: 'json', name: '限免游戏', desc: 'Free Games' },
  runtimeLog: { file: 'runtime-log.ndjson', format: 'ndjson', name: '运行日志', desc: 'Runtime Logs' },
  downloadHistory: {
    file: 'download-history.json',
    format: 'json',
    name: '下载历史',
    desc: 'Download History',
    backup: true
  },
  adapterRules: { file: 'adapter-rules.json', format: 'json', name: '适配规则', desc: 'Adapter Rules', backup: true },
  backups: { file: 'backups.json', format: 'json' }, // 备份容器自身（不进导出 UI/默认备份）
  learnedNoise: {
    file: 'learned-noise.json',
    format: 'json',
    name: '标题噪声词',
    desc: 'Learned Noise',
    backup: true,
    clearOnDataReset: true
  },
  wrongReports: {
    file: 'wrong-reports.json',
    format: 'json',
    name: '报错纠正记录',
    desc: 'Wrong Reports',
    backup: true
  }, // 人工纠正知识库：有意保留的长期数据
  searchCache: { file: 'search-cache.json', format: 'json', name: '下载站搜索缓存', desc: 'Search Cache' }, // v6.4.3
  llmScore: { file: 'llm-score.json', format: 'json', name: 'LLM 评分缓存', desc: 'LLM Score Cache' }, // v6.4.3
  urlAppIdIndex: { file: 'url-appid-index.json', format: 'json', name: '详情页网址索引', desc: 'Detail URL Index' }, // v7.0.2
  siteHealth: { file: 'site-health.json', format: 'json', name: '站点健康', desc: 'Site Health' }, // v10.0.0
  appStats: {
    file: 'app-stats.json',
    format: 'json',
    name: 'AppID 行为统计',
    desc: 'App Stats',
    backup: true,
    clearOnDataReset: true
  }, // v10.1.0（a/b 计数，不可重建）
  steam250Rank: { file: 'steam250-rank.json', format: 'json', name: 'Steam250 榜单', desc: 'Steam250 Rank' }, // v10.4.4
  favorites: { file: 'favorites.json', format: 'json', name: '收藏清单', desc: 'Favorites', backup: true } // v10.6.0（用户精选，高价值不可重建→纳入默认备份）
};

// 导出/导入与"清除学习数据"涉及的是 storageKey 语义（与模块键同值）
// v9.3.0 语义保留：默认备份 = backup:true 子集 + 遗留 storage.local 独占键
/** @type {string[]} */
export const LEGACY_BACKUP_KEYS = ['manualMappings']; // 无 OPFS 文件的旧版模块（仅 storage.local）
