/**
 * Game Recommender - 核心类型定义 / Core Type Definitions
 *
 * v5.0.0：纯 JSDoc 类型定义（零运行时代码），供 background 各模块以
 * 类型标签标注引用。配合 tsconfig.json 的 checkJs（core/ 层起步）做编译期
 * 类型检查。JSDoc typedefs only (zero runtime); referenced via type tags.
 */

/**
 * Steam 缓存条目（模块化结构，steam-cache.js）
 * @typedef {Object} SteamCacheEntry
 * @property {Object} modules
 * @property {Object} modules.meta - appId/name/englishName/headerImage
 * @property {Object} modules.rating - positiveRate/ratingDesc/recentPositiveRate/recentTotalReviews/lastUpdate
 * @property {Object} modules.detail - url/genres/userTags/chineseSupported/releaseDate/description
 * @property {Object} modules.spy - steamdb / steamspy
 */

/**
 * 消息请求载荷（handlers/ 分发入口）
 * @typedef {Object} MessagePayload
 * @property {string} action - action 名（MESSAGE_HANDLERS 键）
 * @property {Object} [data] - TRACK_EVENT 等携带的负载
 * @property {Object} [settings] - SAVE_SETTINGS 携带的设置
 * @property {Array<string>} [names] - 批量名称
 * @property {Array<string|number>} [appIds] - 批量 appId
 * @property {string} [gameName] - 游戏名
 * @property {string|number} [appId] - appId
 */

/**
 * 应用设置（DEFAULT_SETTINGS 形状，settings.js）
 * @typedef {Object} AppSettings
 * @property {boolean} enabled
 * @property {Object} weights - clickRate/downloadRate/keywordMatch/steamRating/playTime/heat
 * @property {Object} llmConfig - provider/endpoint/apiKey/model/temperature
 * @property {Object} cacheTtls - 每模块 TTL
 * @property {Object} badgeVisibility - recent/all/update/rec
 * @property {boolean} showStatusBar
 * @property {number} maxScanLinks
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

export {};
