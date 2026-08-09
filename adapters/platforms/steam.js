/**
 * Game Recommender - Steam 平台规则 / Steam Platform Rules
 *
 * Steam 信息检索的全部外部接口与参数。修改 API 端点、缓存有效期等
 * 只需编辑本文件（Service Worker 加载后生效）。
 *
 * All external Steam endpoints and parameters used for game-info retrieval.
 * Edit this file to change API endpoints, cache TTLs, etc. (takes effect on
 * the next Service Worker start).
 *
 * 字段说明 / Field reference:
 *   platform        平台标识 / platform key
 *   name            平台显示名 / display name
 *   searchApi       商店搜索 API。{q}=搜索词，{lang}=语言（schinese/english 并行
 *                   获取中英文官方名）/
 *                   store search API; {q}=query, {lang}=locale (schinese+english
 *                   run in parallel for official CN/EN names)
 *   detailsApi      应用详情 API。{appid}=AppID，{lang}=语言 /
 *                   app-details API; {appid}, {lang}
 *   reviewsApi      评测汇总 API（好评率来源）。{appid} /
 *                   review-summary API (positive-rate source); {appid}
 *   storeUrl        商店详情页 URL（浮窗跳转/徽章跳转）。{appid} /
 *                   store page URL (panel/badge jumps); {appid}
 *   cacheTtl        动态信息缓存有效期（好评率/评论等，毫秒）/
 *                   dynamic-info cache TTL (ratings/reviews, ms)
 *   negativeCacheTtl 名称搜索失败负缓存有效期（毫秒）/
 *                   name-search negative-cache TTL (ms)
 *   steamdbUrl      SteamDB 补充数据页（评分/在线人数/史低）。{appid} /
 *                   SteamDB supplement page; {appid}
 *   steamspyApi     SteamSpy 补充 API（SteamDB 被拦截时）。{appid} /
 *                   SteamSpy fallback API (when SteamDB is blocked); {appid}
 *   freeGamesApi    平台限免/特惠 API /
 *                   platform free-game / specials API
 */
(function (global) {
  'use strict';

  const STEAM_PLATFORM_RULES = {
    platform: 'steam',
    name: 'Steam',
    searchApi: 'https://store.steampowered.com/api/storesearch/?term={q}&l={lang}&cc=cn',
    detailsApi: 'https://store.steampowered.com/api/appdetails?appids={appid}&l={lang}',
    reviewsApi: 'https://store.steampowered.com/appreviews/{appid}?json=1&language=all&num_per_page=0',
    storeUrl: 'https://store.steampowered.com/app/{appid}/',
    cacheTtl: 24 * 3600 * 1000,
    negativeCacheTtl: 2 * 3600 * 1000,
    steamdbUrl: 'https://steamdb.info/app/{appid}/',
    steamspyApi: 'https://steamspy.com/api.php?request=appdetails&appid={appid}',
    freeGamesApi: 'https://store.steampowered.com/api/featuredcategories/?l=schinese&cc=cn'
  };

  global.__GAME_RECOMMENDER_PLATFORM_STEAM__ = STEAM_PLATFORM_RULES;
})(typeof globalThis !== 'undefined' ? globalThis : this);
