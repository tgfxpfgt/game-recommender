/**
 * 游戏雷达 Game Radar - 限免列表过滤纯函数 / Free-Games Filter
 *
 * v9.3.0：从 freegames.js 的 renderGames 抽取——平台 + 领取方式双层过滤，
 * 可独立单测（此前内联在页面渲染函数中）。
 */
(function (global) {
  'use strict';

  const MAIN_PLATFORMS = ['epic', 'steam', 'gog', 'microsoft'];

  /**
   * 过滤限免游戏列表（平台 + 领取方式）
   * @param {Array<any>} allGames
   * @param {string} platform  all | epic | steam | gog | microsoft | other
   * @param {string} claimType all | direct | thirdparty
   * @returns {Array<any>}
   */
  function filterFreeGames(allGames, platform, claimType) {
    const games = allGames || [];
    let filtered;
    if (platform === 'all') {
      filtered = games;
    } else if (platform === 'other') {
      filtered = games.filter((g) => !MAIN_PLATFORMS.includes(g.platform));
    } else {
      filtered = games.filter((g) => g.platform === platform);
    }
    if (claimType && claimType !== 'all') {
      filtered = filtered.filter((g) => (g.claimType || 'direct') === claimType);
    }
    return filtered;
  }

  global.__GR_FG_FILTER__ = { filterFreeGames };
})(typeof globalThis !== 'undefined' ? globalThis : this);
