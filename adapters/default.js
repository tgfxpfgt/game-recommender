/**
 * 游戏雷达 Game Radar - 基础共用适配规则 / Default Shared Adapter Rules
 *
 * 所有下载站/平台规则都会合并本文件的基础配置（站点规则中未显式定义的
 * 字段使用这里的默认值）。修改通用行为（如默认标题长度、通用详情页 URL
 * 特征）只需改本文件。
 *
 * Base rules merged into every site/platform config: fields not explicitly
 * defined in a site rule fall back to these defaults. Tweak shared behavior
 * (default title lengths, generic detail-page URL patterns) here.
 *
 * 字段说明 / Field reference:
 *   detailUrlPatterns  通用详情页 URL 特征（pathname 正则数组，i 标志）；
 *                      站点未配置时生效 / generic detail-page URL patterns
 *                      (pathname regex array, i flag); used when a site has none
 *   listPage           通用列表页识别 / generic list-page detection:
 *     urlPatterns      pathname 正则数组，任一命中即列表页 /
 *                      pathname regex array; any match → list page
 *     minDetailLinks   页面详情链接数达到该值视为列表页（0 = 不启用）/
 *                      treat as list page when detail links ≥ N (0 = disabled)
 *   listItem           通用列表项提取 / generic list-item extraction:
 *     containers       容器选择器（按优先级）/ container selectors (priority order)
 *     titleEls         标题元素选择器 / title-element selectors
 *     minLen/maxLen    标题长度范围（minLen=2 支持两字游戏名，如"奉魔"）/
 *                      title length range (2 supports 2-char names like "奉魔")
 *     fallbackLinks    容器策略无结果时回退全页面链接提取 /
 *                      fall back to whole-page link extraction when containers fail
 *   imageAppId         是否从封面图提取 Steam appId（列表页 appId 直取）/
 *                      extract Steam appIds from cover images (appId-first lookup)
 */
(function (global) {
  'use strict';

  const DEFAULT_RULES = {
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
  };

  // 暴露给聚合入口（index.js）与 Service Worker
  // Exposed to the aggregation entry (index.js) and the Service Worker
  global.__GAME_RECOMMENDER_DEFAULT_RULES__ = DEFAULT_RULES;
})(typeof globalThis !== 'undefined' ? globalThis : this);
