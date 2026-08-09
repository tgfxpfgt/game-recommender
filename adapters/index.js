/**
 * Game Recommender - 适配规则聚合入口 / Adapter Rules Aggregation Entry
 *
 * 合并基础共用规则（default.js）与各下载站规则（sites/*.js）为统一的
 * __GAME_RECOMMENDER_SITES__，供内容脚本与 Service Worker 使用。
 *
 * Aggregates the default shared rules (default.js) and per-site rules
 * (sites/*.js) into __GAME_RECOMMENDER_SITES__, consumed by both the content
 * script and the Service Worker.
 *
 * 加载顺序（manifest content_scripts / SW import 均需按此顺序）：
 * Load order (both manifest content_scripts and SW imports):
 *   default.js → sites/*.js → index.js
 */
(function (global) {
  'use strict';

  // 基础共用规则（每个站点未显式配置的字段回退到这里）
  // Shared defaults (fields not explicitly set by a site fall back here)
  const defaults = global.__GAME_RECOMMENDER_DEFAULT_RULES__ || {};

  // 站点规则列表：合并基础规则，站点配置覆盖默认值
  // Site rules: merged over the defaults, site values win
  const siteKeys = [
    'XDGAME', 'XIANYUDANJI', 'GAMER520', '3DMGAME', 'ALI213', 'GAMERSKY'
  ];
  const sites = siteKeys
    .map(k => global['__GAME_RECOMMENDER_SITE_' + k + '__'])
    .filter(Boolean)
    .map(rule => ({ ...defaults, ...rule }));

  // 站点规则聚合结果（兼容原 sites.js 的全局结构）
  // Aggregated site rules (compatible with the legacy sites.js global)
  global.__GAME_RECOMMENDER_SITES__ = {
    version: 1,
    sites
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
