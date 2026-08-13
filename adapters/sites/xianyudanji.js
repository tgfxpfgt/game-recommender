/**
 * 游戏雷达 Game Radar - 咸鱼单机 下载站规则 / Xianyudanji Site Rules
 *
 * WordPress 主题，文章卡片 class="post post-grid"，标题在 h2.entry-title。
 * 详情页 URL：/数字.html 或 /xxx/ 一级路径。
 * WordPress theme; article cards use .post, titles live in h2.entry-title.
 * Detail pages: /{digits}.html or one-level /xxx/ paths.
 *
 * 字段说明 / Field reference:
 *   key/name/domains/base/searchUrl  见 xdgame.js 说明 /
 *                                   see xdgame.js field reference
 *   detailUrlPatterns  详情页 URL 特征（数字.html 或任意一级路径）/
 *                      detail patterns (digits.html or any one-level path)
 *   imageAppId         封面 appId 直取开关（本地图，无 appId 时标题搜索兜底）/
 *                      cover-appId lookup (local covers → title search fallback)
 *   listPage.urlPatterns  列表页识别：首页/分页/分类/标签/搜索 /
 *                      list detection: home/pagination/category/tag/search
 *   listItem.containers   文章卡片容器 / article-card containers
 *   listItem.titleEls     标题元素选择器 / title-element selectors
 *   listItem.fallbackLinks 容器无结果时回退全页面链接 /
 *                      whole-page fallback when containers fail
 */
(function (global) {
  'use strict';

  global.__GAME_RECOMMENDER_SITE_XIANYUDANJI__ = {
    key: 'xianyudanji',
    name: '咸鱼单机',
    domains: ['xianyudanji.gg'],
    base: 'https://www.xianyudanji.gg',
    searchUrl: 'https://www.xianyudanji.gg/?s={q}',
    detailUrlPatterns: ['/\\d+\\.html?$', '/[^/]+/?$'],
    imageAppId: true,
    listPage: {
      urlPatterns: ['^(/|$)', '/page/\\d+', '/category/', '/tag/', '\\bs=']
    },
    listItem: {
      containers: ['.post', '.article', '.entry', '.item', 'article'],
      titleEls: ['h2', 'h3', '.title', '.entry-title'],
      minLen: 2,
      maxLen: 100,
      fallbackLinks: true
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
