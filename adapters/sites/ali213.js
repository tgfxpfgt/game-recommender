/**
 * Game Recommender - 游侠网 下载站规则 / Ali213 Site Rules
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

  global.__GAME_RECOMMENDER_SITE_ALI213__ = {
    key: 'ali213',
    name: '游侠网',
    domains: ['ali213.net'],
    base: '',
    searchUrl: '',
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
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
