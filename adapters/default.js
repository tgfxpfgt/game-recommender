/**
 * 游戏雷达 Game Radar - 基础共用适配规则 / Default Shared Adapter Rules
 *
 * 所有站点规则先合并本文件，站点未显式定义的字段回退到这里。
 * Base rules merged into every site config; missing site fields fall back here.
 *
 * 字段说明 / Field reference:
 *   detailUrlPatterns  通用详情页 pathname 正则（站点未配置时生效）
 *   listPage.urlPatterns  列表页 pathname 正则；minDetailLinks 详情链接阈值（0=不启用）
 *   listItem.containers/titleEls/minLen/maxLen/fallbackLinks  列表项提取
 *   imageAppId         从封面图提取 Steam appId（列表页直取）
 */
(function (global) {
  'use strict';

  // 延迟装配：顶层只注册工厂，首次聚合时才实例化 / lazy: factory only
  global.__GAME_RECOMMENDER_DEFAULT_RULES__ = () => ({
    detailUrlPatterns: ['/\\d+\\.html?$', '/game/\\d+\\.html?$'],
    listPage: {
      urlPatterns: ['^(/|$)', '/page/\\d+', '/category/', '/tag/'],
      minDetailLinks: 0
    },
    listItem: {
      containers: ['article', '.post', '.item', '.entry'],
      titleEls: ['h2', 'h3', '.title', '.entry-title', '.name'],
      minLen: 2,
      maxLen: 200,
      fallbackLinks: false
    },
    imageAppId: true
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
