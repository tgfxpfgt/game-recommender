/**
 * 游戏雷达 Game Radar - 核心类型定义 / Core Type Definitions
 *
 * v5.0.0：纯 JSDoc 类型定义（零运行时代码），供 background 各模块以
 * 类型标签标注引用。配合 tsconfig.json 的 checkJs（core/ 层起步）做编译期
 * 类型检查。JSDoc typedefs only (zero runtime); referenced via type tags.
 * v6.3.1：typedef 补全（MessagePayload 全字段 / AppSettings 精确化 /
 * 新增 GameResult 与 RecommendResult——strict 渐进的前置）。
 */

/**
 * Steam 缓存条目（模块化结构，steam-cache.js）
 * @typedef {Object} SteamCacheEntry
 * @property {Object} modules
 * @property {Object} [modules.meta] - appId/name/englishName/headerImage
 * @property {Object} [modules.rating] - positiveRate/ratingDesc/recentPositiveRate/recentTotalReviews/lastUpdate
 * @property {Object} [modules.detail] - url/genres/userTags/chineseSupported/releaseDate/description
 * @property {Object} [modules.spy] - steamdb / steamspy
 */

/**
 * 消息请求载荷（handlers/ 分发入口）
 * @typedef {Object} MessagePayload
 * @property {string} action - action 名（MESSAGE_HANDLERS 键）
 * @property {Object} [data] - TRACK_EVENT / RECORD_DOWNLOAD_URLS_BATCH / TRACK_DOWNLOAD_SITE_VISIT 负载
 * @property {Object} [settings] - SAVE_SETTINGS 携带的设置
 * @property {Array<string>} [names] - 批量名称（GET_STEAM_RATINGS 等）
 * @property {Object} [appIds] - 批量 appId（名称 → appId，列表页封面直取）
 * @property {Object} [imageData] - 批量封面（名称 → {appId, cover}）
 * @property {string} [gameName] - 游戏名
 * @property {string|number} [appId] - appId（SAVE_MANUAL_MAPPING / CACHE_STEAM_PAGE 等）
 * @property {string} [backupId] - 备份 ID（RESTORE_BACKUP / DELETE_BACKUP）
 * @property {Array<string>} [moduleKeys] - 备份/导出勾选模块
 * @property {string} [gameId] - 限免游戏 ID（CLAIM_FREE_GAME）
 * @property {number} [limit] - 日志/审计条数上限
 * @property {boolean} [force] - GET_FREE_GAMES 强制刷新
 * @property {string} [keyword] - GET_GAME_CACHE_LIST 过滤词
 * @property {string} [tag] - GET_GAME_CACHE_LIST 标签过滤
 * @property {string} [siteKey] - GET_GAME_CACHE_LIST 站点过滤
 * @property {string} [typeFilter] - GET_GAME_CACHE_LIST 类型过滤
 * @property {number} [minRating] - GET_GAME_CACHE_LIST 最低好评率
 * @property {string} [granularity] - GET_TRENDS 聚合粒度 day|week
 * @property {Object} [rules] - SAVE_ADAPTER_RULES 适配规则
 * @property {Array<Object>} [games] - GET_RECOMMENDATIONS 游戏候选（含 name）
 * @property {Array<Object>} [ratings] - STEAM_RATINGS_UPDATE 增量好评率
 * @property {Object} [data2] - 备用负载（预留）
 */

/**
 * 应用设置（DEFAULT_SETTINGS 形状，settings.js）
 * @typedef {Object} AppSettings
 * @property {boolean} enabled
 * @property {Object} weights - clickRate/downloadRate/keywordMatch/steamRating/playTime/heat（六项和 1.0）
 * @property {number} weights.clickRate
 * @property {number} weights.downloadRate
 * @property {number} weights.keywordMatch
 * @property {number} weights.steamRating
 * @property {number} weights.playTime
 * @property {number} weights.heat
 * @property {Object} llmConfig - provider/endpoint/apiKey/model/temperature
 * @property {string} llmConfig.provider
 * @property {string} llmConfig.endpoint
 * @property {string} llmConfig.apiKey
 * @property {string} llmConfig.model
 * @property {number} llmConfig.temperature
 * @property {Object} cacheTtls - 每模块 TTL（steamDynamic/detailSteam/spySteam/metaSteam/registryConfirm/downloadUrls/negativeCache）
 * @property {Object} badgeVisibility - recent/all/update/rec
 * @property {boolean} badgeVisibility.recent
 * @property {boolean} badgeVisibility.all
 * @property {boolean} badgeVisibility.update
 * @property {boolean} badgeVisibility.rec
 * @property {boolean} showStatusBar
 * @property {number} maxScanLinks
 * @property {Array<string>} trackedSites - 追踪下载站域名
 * @property {Array<string>} steamSiteSearch - Steam 详情页检索的下载站
 * @property {boolean} [useLLM] - 是否启用 LLM 评分
 * @property {boolean} [enableRecentFilter] - 30 天好评率过滤（v6.4.4）
 * @property {number} [minRecentSteamRatingFilter] - 30 天好评率阈值
 * @property {string} [ratingFilterMode] - and|or|not（总/30天组合关系）
 * @property {string} [itadApiKey] - ITAD 二次校验 key（限免通知候选确认，v6.3.3）
 * @property {number} [maxBehaviorLog] - 行为日志上限
 * @property {boolean} enableLog
 * @property {number} maxRuntimeLog
 * @property {boolean} autoBackup
 * @property {number} backupIntervalHours
 * @property {number} maxBackups
 * @property {string} logLevel - debug|info|warn|error
 * @property {number} logRetentionDays
 * @property {string} logStorage - ndjson|local
 */

/**
 * 行为趋势桶（trends.js）
 * @typedef {Object} TrendBucket
 * @property {string} date - YYYY-MM-DD（周聚合为周一日期）
 * @property {number} views
 * @property {number} downloads
 * @property {number} rate - 0-100
 */

/**
 * 出站审计条目（outbound-audit.js）
 * @typedef {Object} AuditEntry
 * @property {number} t - 时间戳
 * @property {string} host
 * @property {boolean} ok
 * @property {number} ms - 耗时
 * @property {number} status - HTTP 状态码（0=网络异常）
 */

/**
 * Steam 搜索结果（searchSteamAppId 返回，api-search.js）
 * @typedef {Object} SteamSearchResult
 * @property {string|number} appId
 * @property {string} name
 * @property {string} englishName
 */

/**
 * 完整 Steam 详情结果（fetchSteamFullDetailsByAppId / buildSteamResult 返回）
 * @typedef {Object} GameResult
 * @property {string|number} appId
 * @property {string} type - game/dlc/demo/bundle
 * @property {string} name
 * @property {string} englishName
 * @property {boolean} isDemo
 * @property {string} url
 * @property {string} steamdbUrl
 * @property {number|null} rating - 评分（review_score）
 * @property {string|null} ratingDesc
 * @property {number} totalReviews
 * @property {number|null} positiveRate - 0-100
 * @property {number|null} recentPositiveRate - 近 30 天好评率
 * @property {number} recentTotalReviews
 * @property {number|null} lastUpdate - 最近公告日期时间戳
 * @property {Array<string>} genres
 * @property {Array<string>} userTags
 * @property {boolean} chineseSupported
 * @property {boolean} simplifiedChinese
 * @property {boolean} chineseHasAudio
 * @property {boolean} chineseHasSubtitles
 * @property {string} releaseDate
 * @property {Array<string>} developers
 * @property {string} description
 * @property {string} headerImage
 * @property {Object|null} steamspy - SteamSpy 补充数据
 */

/**
 * 推荐评分结果（engine.js computeGameScore 返回）
 * @typedef {Object} RecommendResult
 * @property {number} score - 0-100
 * @property {Object} breakdown
 * @property {number} breakdown.clickScore
 * @property {number} breakdown.downloadScore
 * @property {number} breakdown.keywordScore
 * @property {number} breakdown.steamScore
 * @property {number} breakdown.playTimeScore
 * @property {number} breakdown.heatScore
 * @property {string} method
 */

export {};
