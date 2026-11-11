/**
 * 游戏雷达 Game Radar - 游民星空 下载站规则 / Gamersky Site Rules
 *
 * 选择器式列表页（无 URL 特征），无站内搜索（仅行为追踪）。字段见 xdgame.js。
 * Selector-based list pages (no URL pattern); no in-site search (tracking only).
 */
(function (global) {
  'use strict';

  // 延迟装配：顶层只注册工厂，首次聚合时才实例化 / lazy: factory only
  global.__GAME_RECOMMENDER_SITE_GAMERSKY__ = () => ({
    key: 'gamersky',
    name: '游民星空',
    domains: ['gamersky.com'],
    base: '',
    searchUrl: '',
    /** @type {string[]} */
    detailUrlPatterns: [],
    listPage: {
      selectors: ['.game-list', '.Mid2L_con', '.pictxt']
    },
    listItem: {
      containers: ['.game-list li', '.Mid2L_con li', '.pictxt li'],
      titleEls: ['.name', 'h3', '.tit', 'a'],
      minLen: 2,
      maxLen: 200
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
