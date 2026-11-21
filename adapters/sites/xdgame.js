/**
 * 游戏雷达 Game Radar - XDGame 下载站规则 / XDGame Site Rules
 *
 * 字段参考（其余站点文件沿用，不再重复展开）/ Field reference (shared):
 *   key/name/displayName/domains/base/searchUrl/detailUrlPatterns/imageAppId
 *   listPage.{urlPatterns,selectors,minDetailLinks}
 *   listItem.{containers,titleLink,titleEls,excludeClasses,minLen,maxLen,fallbackLinks}
 *   listPlatformHints[{urlPattern, hint}]  分类页平台提示 / category-page hints
 *   detailPlatformSelectors[]  详情页平台标注选择器 / detail-page annotation selectors
 *   features.{gridLayoutDefault,detailMetaVersion}  站点开关
 */
(function (global) {
  'use strict';

  // 延迟装配：顶层只注册工厂，首次聚合时才实例化 / lazy: factory only
  /** @type {any} */ (global).__GAME_RECOMMENDER_SITE_XDGAME__ = () => ({
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
      // v14.42.0（现网取证）：新版列表 ul.pl-grid > li.pl-card，标题 a.pl-title
      //（a.tit 仅首页"最新发布"栏仍在用）——pl-card 首链接 a.pl-cover 的
      // textContent 是平台标签（"Xbox移植"），titleLink 命中 a.pl-title 后
      // 不走策略2，名称不被平台标签污染。新旧结构共存不互斥。
      // v14.42.0: new pl-card list structure; both selectors coexist.
      containers: ['.game-list li', '.pl-grid li', '.list li', 'ul li'],
      titleLink: 'a.tit, a.pl-title',
      titleEls: ['h2', 'h3', '.title', '.entry-title', '.name', '.game-name', '.game-title', '.pl-title'],
      excludeClasses: ['grid-cover', 'link'],
      minLen: 2,
      maxLen: 200,
      fallbackLinks: true
    },
    // v14.18.0/v14.42.0（现网取证）：分类页/详情页平台提示——平台标注均在
    // 标题外（页面 <title>、pl-type 徽章、详情 .tit-badge 徽章与分类面包屑），
    // 标题级识别必落空。URL 命中即随批次注入提示词；详情标注经 detectPlatform
    // 逐段校验去噪（candidates.getDetailPlatformHint）。
    // Platform labels live OUTSIDE the titles → per-URL hints + detail
    // annotation selectors are required.
    // **/game/117/（Windows移植）刻意不注入**——实抓条目为 Win9x PC 复刻
    // （魔兽争霸2/过山车大亨2，Steam 有数据），走 PC 管线是正确语义。
    // NOTE: /game/117/ is vintage-PC remasters — deliberately NOT hinted.
    detailPlatformSelectors: ['.title-badges .tit-badge', '.article-crumbs a[href*="/game/"]'],
    listPlatformHints: [
      { urlPattern: '/game/10/', hint: '模拟器整合' },
      { urlPattern: '/game/121/', hint: '模拟器整合' }, // Switch模拟器
      { urlPattern: '/game/122/', hint: '主机游戏' }, // 任天堂经典
      { urlPattern: '/game/118/', hint: 'Switch移植' },
      { urlPattern: '/game/119/', hint: '移植' }, // 索尼移植
      { urlPattern: '/game/120/', hint: 'Xbox移植' },
      { urlPattern: '/list/2/', hint: '移植' } // 移植游戏整合聚合专列
    ]
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
