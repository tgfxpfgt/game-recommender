/**
 * 游戏雷达 Game Radar - 3DM 下载站规则 / 3DM Site Rules
 *
 * 选择器式列表页（无 URL 特征），无站内搜索（仅行为追踪）。字段见 xdgame.js。
 * Selector-based list pages (no URL pattern); no in-site search (tracking only).
 */
(function (global) {
  'use strict';

  // 延迟装配：顶层只注册工厂，首次聚合时才实例化 / lazy: factory only
  global.__GAME_RECOMMENDER_SITE_3DMGAME__ = () => ({
    key: '3dmgame',
    name: '3DM',
    domains: ['3dmgame.com'],
    base: '',
    searchUrl: '',
    /** @type {string[]} */
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
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
