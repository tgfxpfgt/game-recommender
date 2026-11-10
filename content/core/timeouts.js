/**
 * 游戏雷达 Game Radar - 内容侧消息超时常量（单源）/ Content-side message timeouts
 *
 * v14.26.0（优化方案 P1-6）：内容层不可 import background（分层铁律），故按
 * 铁律 13 在内容侧设单源常量文件，替代 19 处散落字面量。语义分档：
 *   短（本地/缓存型请求，后台立即返回）     3s
 *   常规（含一次本机网络/存储聚合）        10s
 *   长（出站网络：Steam 检索、ITAD、图片）  30s
 *   批量评分（后台整批拉取 + 推送，硬截止 300s）120s
 * 超时只影响"内容侧放弃等待"的时机，不改变后台实际工作——短档偏紧会把
 * 冷启动慢响应的请求判死，故原 2s/5s 统一抬到 3s/10s（宽松方向）。
 * Content scripts cannot import background modules, so these are declared here
 * as the single source (rule 13). Tiers: local/cache 3s, normal 10s, outbound
 * 30s, batch ratings 120s (background hard-stops at 300s).
 */

/** 短：本地/缓存型消息（GET_SETTINGS / GET_ADAPTER_RULES / 事件上报） */
export const MSG_TIMEOUT_SHORT_MS = 3000;

/** 常规：一次本机聚合（收藏、纠错上报等） */
export const MSG_TIMEOUT_NORMAL_MS = 10000;

/** 长：出站网络型（SEARCH_STEAM / GET_ITAD_LOWEST / GET_STEAM250_RANK / 图片） */
export const MSG_TIMEOUT_LONG_MS = 30000;

/**
 * 批量好评率：后台整批拉取受 300s 硬截止约束，内容侧不再 10s 判死
 * （P1-6 核心修复：原 10s 默认超时 → 弱网下列表页"假失败"）。
 */
export const RATINGS_TIMEOUT_MS = 120000;
