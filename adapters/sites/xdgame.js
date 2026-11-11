/**
 * 游戏雷达 Game Radar - XDGame 下载站规则 / XDGame Site Rules
 *
 * 字段参考（其余站点文件沿用，不再重复展开）/ Field reference (shared):
 *   key/name/displayName/domains/base/searchUrl/detailUrlPatterns/imageAppId
 *   listPage.{urlPatterns,selectors,minDetailLinks}
 *   listItem.{containers,titleLink,titleEls,excludeClasses,minLen,maxLen,fallbackLinks}
 *   listPlatformHints[{urlPattern, hint}]  分类页平台提示 / category-page hints
 *   features.{gridLayoutDefault,detailMetaVersion}  站点开关
 */
(function (global) {
  'use strict';

  // 延迟装配：顶层只注册工厂，首次聚合时才实例化 / lazy: factory only
  global.__GAME_RECOMMENDER_SITE_XDGAME__ = () => ({
    key: 'xdgame',
    name: 'XDGame',
    displayName: 'XDGame',
    domains: ['xdgame.com'],
    // v10.4.4：链接统一 www——裸域会 301 到 www，浮窗跳转少一跳且避免相对
    // 资源跨域
    base: 'https://www.xdgame.com',
    searchUrl: 'https://www.xdgame.com/so/{q}.html',
    detailUrlPatterns: ['/game/\\d+\\.html?$', '/\\d+\\.html?$'],
    imageAppId: true,
    // v10.7.0 批次4：per-site feature 声明（此前以 host.includes/siteKey 硬编码
    // 散落在 xdgrid.js 与 sites/search.js 业务里——现收编进规则 schema）
    // Per-site feature flags (previously hardcoded host/key checks).
    features: {
      gridLayoutDefault: true, // 列表布局定制默认启用（原 xdgrid host 判断）
      detailMetaVersion: true // 详情页"版本介绍"段落解析（原 search.js siteKey 特判）
    },
    listPage: {
      urlPatterns: ['^/so/', '/page/\\d+', '/list/', '^(/|$)'],
      minDetailLinks: 5
    },
    listItem: {
      containers: ['.game-list li', '.list li', 'ul li'],
      titleLink: 'a.tit',
      titleEls: ['h2', 'h3', '.title', '.entry-title', '.name', '.game-name', '.game-title'],
      excludeClasses: ['grid-cover', 'link'],
      minLen: 2,
      maxLen: 200,
      fallbackLinks: true
    },
    // v14.18.0（两站真实页面实证）：分类页平台提示——/game/10/ = "模拟器整合"
    // 分类（页面标题"Switch游戏整合,Yuzu模拟器整合"，含 /game/10/index_*.html
    // 翻页），39 条的分类标签"模拟器整合"均在标题**外**，标题为中文名/别名/
    // 英文名（如"塞尔达传说：王国之泪/The Legend of Zelda..."），标题级识别
    // 必然落空被当 PC 检索。URL 命中即随批次注入提示词。
    // Category-page platform hints: /game/10/ is the emulator-bundle category
    // whose labels live outside the titles (cn/alias/en name only).
    listPlatformHints: [{ urlPattern: '/game/10/', hint: '模拟器整合' }]
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
