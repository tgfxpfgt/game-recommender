/**
 * Game Recommender - 游民星空 下载站规则 / Gamersky Site Rules
 *
 * 选择器式列表页（无 URL 特征），无站内搜索（仅行为追踪）。
 * Selector-based list pages (no URL pattern); no in-site search (tracking only).
 *
 * 字段说明 / Field reference:
 *   key/name/domains 见 xdgame.js 说明 / see xdgame.js field reference
 *   searchUrl       空 = 无站内搜索 / empty = no in-site search
 *   listPage.selectors  任一选择器存在即列表页 / any selector hit → list page
 *   listItem.containers 列表容器 / list containers
 *   listItem.titleEls   标题元素选择器 / title-element selectors
 */
(function (global) {
  'use strict';

  global.__GAME_RECOMMENDER_SITE_GAMERSKY__ = {
    key: 'gamersky',
    name: '游民星空',
    domains: ['gamersky.com'],
    base: '',
    searchUrl: '',
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
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
