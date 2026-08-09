/**
 * Game Recommender - GOG 平台规则 / GOG Platform Rules
 *
 * GOG 限免游戏接口配置。修改 API 端点只需编辑本文件。
 * GOG free-games API configuration; edit this file to change endpoints.
 *
 * 字段说明 / Field reference:
 *   platform      平台标识 / platform key
 *   name          平台显示名 / display name
 *   freeGamesApi  免费游戏列表 API（JSON 商品列表）/
 *                 free-games listing API (JSON product list)
 *   limit         每页拉取数量上限 / per-request item limit
 */
(function (global) {
  'use strict';

  const GOG_PLATFORM_RULES = {
    platform: 'gog',
    name: 'GOG',
    freeGamesApi: 'https://www.gog.com/games/ajax/filtered?mediaType=game&price=free&limit=25',
    limit: 25
  };

  global.__GAME_RECOMMENDER_PLATFORM_GOG__ = GOG_PLATFORM_RULES;
})(typeof globalThis !== 'undefined' ? globalThis : this);
