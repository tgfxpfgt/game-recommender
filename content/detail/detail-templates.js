/**
 * 游戏雷达 Game Radar - 详情页浮窗模板入口 / Detail-Page Float Template Entry
 *
 * v5.1.0：由 detail-page.js 拆分——纯 HTML 模板函数（无 DOM 绑定）。
 * v14.5.0 B6：模板实现拆至 render/ 目录（sidebar-html/inline-html/rating-rows），
 * 本文件收敛为模板入口——manifest 的 detailTemplates 装载路径与消费方
 *（sidebar.js / inline-card.js / test-ui-pure / sim）import 路径全部不变；
 * 评分口径纯函数 re-export 同样保持（v10.7.0 批次1 的兼容约定）。
 * Template entry (B6): implementations live in render/; the manifest load
 * path and all consumer import paths stay unchanged, including the v10.7.0
 * rating-logic re-exports.
 */
export { steamSidebar } from './render/sidebar-html.js';
export { steamInlineSection } from './render/inline-html.js';
// v10.7.0 批次1：评分口径纯函数下沉 content/core/steam-rating-logic.js；此处
// re-export 保持既有 import 路径兼容（detail-page.js 命名空间用法）
import { heatLabelFor, ratingTextInfo, adjustedReputation, verdictFor } from '../core/steam-rating-logic.js';
export { heatLabelFor, ratingTextInfo, adjustedReputation, verdictFor };
