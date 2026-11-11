/**
 * 游戏雷达 Game Radar - Gamer520 下载站规则 / Gamer520 Site Rules
 *
 * WordPress 主题，封面图引用 Steam CDN（queniuqe），列表页可 appId 直取。
 * 字段见 xdgame.js 对照表。
 * WordPress theme; covers reference the Steam CDN (queniuqe), so list pages
 * can resolve appIds directly from images.
 */
(function (global) {
  'use strict';

  // 延迟装配：顶层只注册工厂，首次聚合时才实例化 / lazy: factory only
  global.__GAME_RECOMMENDER_SITE_GAMER520__ = () => ({
    // v10.7.0 批次4：内嵌 Steam 评价卡（原 detail-page INLINE_SECTION_SITES 硬编码）
    features: { inlineSteamCard: true },
    key: 'gamer520',
    name: 'Gamer520',
    displayName: 'Gamer520',
    domains: ['gamer520.com', 'gamers520.com'], // v10.4.4：新旧双域名
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
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
