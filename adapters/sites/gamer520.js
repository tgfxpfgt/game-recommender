/**
 * 游戏雷达 Game Radar - Gamer520 下载站规则 / Gamer520 Site Rules
 *
 * WordPress 主题，封面图引用 Steam CDN（queniuqe），列表页可 appId 直取。
 * WordPress theme; covers reference the Steam CDN (queniuqe), so list pages
 * can resolve appIds directly from images.
 *
 * 字段说明 / Field reference:
 *   key/name/domains/base/searchUrl  见 xdgame.js 说明 /
 *                                   see xdgame.js field reference
 *   detailUrlPatterns  详情页 URL 特征（数字.html 或含数字的一级路径）/
 *                      detail patterns (digits.html or digit-bearing 1-level path)
 *   imageAppId         封面 appId 直取开关：封面引用 Steam CDN，优先直取 /
 *                      cover-appId lookup: covers reference the Steam CDN
 *   listPage.urlPatterns  列表页识别：首页/分页/分类/搜索 /
 *                      list detection: home/pagination/category/search
 *   listItem.containers   游戏卡片容器 / game-card containers
 *   listItem.titleEls     标题元素选择器 / title-element selectors
 */
(function (global) {
  'use strict';

  global.__GAME_RECOMMENDER_SITE_GAMER520__ = {
    key: 'gamer520',
    name: 'Gamer520',
    displayName: 'Gamer520',
    domains: ['gamer520.com'],
    base: 'https://www.gamer520.com',
    searchUrl: 'https://www.gamer520.com/?s={q}',
    // v9.7.0：单段路径收窄为"含数字"——原 /[^/]+/?$ 匹配所有一级路径，
    // /about、/login、导航/分类链接全被当详情页（错误徽章/错误过滤）。
    // 游戏资源站文章 slug 几乎必带数字，功能页几乎不含
    detailUrlPatterns: ['/\\d+\\.html?$', '/[^/]*\\d[^/]*/?$'],
    imageAppId: true,
    listPage: {
      urlPatterns: ['^(/|$)', '/page/\\d+', '/category/', '\\bs=']
    },
    listItem: {
      containers: ['.post-item', '.article-item', '.game-item', '.item', 'article'],
      titleEls: ['h2', 'h3', '.title'],
      minLen: 2,
      maxLen: 100
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
