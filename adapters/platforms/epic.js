/**
 * Game Recommender - Epic Games 平台规则 / Epic Games Platform Rules
 *
 * Epic 限免游戏接口配置。修改 API 端点只需编辑本文件。
 * Epic free-games API configuration; edit this file to change endpoints.
 *
 * 字段说明 / Field reference:
 *   platform      平台标识 / platform key
 *   name          平台显示名 / display name
 *   freeGamesApi  限免促销 API（返回含 promotions 的游戏列表）/
 *                 free-promotions API (games with promotionalOffers)
 *   storeUrl      商店页 URL 模板。{slug}=产品 slug /
 *                 store page URL template; {slug}=product slug
 *   locale        API 语言参数 / API locale
 *   country       国家参数 / country parameter
 */
(function (global) {
  'use strict';

  const EPIC_PLATFORM_RULES = {
    platform: 'epic',
    name: 'Epic Games',
    freeGamesApi: 'https://store-site-backend-official.ak.epicgames.com/freeGamesPromotions?locale=zh-CN&country=CN&allowCountries=CN',
    storeUrl: 'https://store.epicgames.com/zh-CN/p/{slug}',
    locale: 'zh-CN',
    country: 'CN'
  };

  global.__GAME_RECOMMENDER_PLATFORM_EPIC__ = EPIC_PLATFORM_RULES;
})(typeof globalThis !== 'undefined' ? globalThis : this);
