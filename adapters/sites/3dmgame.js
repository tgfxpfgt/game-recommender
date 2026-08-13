/**
 * 游戏雷达 Game Radar - 3DM 下载站规则 / 3DM Site Rules
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

  global.__GAME_RECOMMENDER_SITE_3DMGAME__ = {
    key: '3dmgame',
    name: '3DM',
    domains: ['3dmgame.com'],
    base: '',
    searchUrl: '',
    detailUrlPatterns: [],
    listPage: {
      selectors: ['.lis', '.game-list', '.content li a[href*="/game/"]', '.Mid2L_con li']
    },
    listItem: {
      containers: ['.lis li', '.game-list li', '.content li', '.Mid2L_con li'],
      titleEls: ['h3', '.name', '.title', 'a'],
      minLen: 2,
      maxLen: 200
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
