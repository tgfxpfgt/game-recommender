/**
 * 游戏雷达 Game Radar - 游侠网 下载站规则 / Ali213 Site Rules
 *
 * 选择器式列表页（无 URL 特征），无站内搜索（仅行为追踪）。字段见 xdgame.js。
 * Selector-based list pages (no URL pattern); no in-site search (tracking only).
 */
(function (global) {
  'use strict';

  // 延迟装配：顶层只注册工厂，首次聚合时才实例化 / lazy: factory only
  global.__GAME_RECOMMENDER_SITE_ALI213__ = () => ({
    key: 'ali213',
    name: '游侠网',
    domains: ['ali213.net'],
    base: '',
    searchUrl: '',
    /** @type {string[]} */
    detailUrlPatterns: [],
    listPage: {
      selectors: ['.n_lone', '.game_list', '.downlist']
    },
    listItem: {
      containers: ['.n_lone li', '.game_list li', '.downlist li'],
      titleEls: ['.name', 'h3', 'a'],
      minLen: 2,
      maxLen: 200
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
