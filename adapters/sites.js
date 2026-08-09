/**
 * Game Recommender - Download Site Adapter Rules
 * 下载站适配规则文件 / Download-site adapter rules
 *
 * 各下载站的适配规则集中于此文件，便于分享与移植：
 * - 添加新站点：在 sites 数组中增加一项即可（复制现有项修改）
 * - 修改站点规则：无需改动业务代码
 * - 该文件同时被后台（Service Worker）与内容脚本（tracker.js）使用
 *
 * All download-site adapter rules live in this single file for easy sharing
 * and porting:
 * - Adding a site: append one entry to the `sites` array (copy an existing one)
 * - Tweaking rules: no business-code changes needed
 * - Consumed by both the Service Worker and the content script (tracker.js)
 *
 * 规则字段说明 / Field reference:
 *   key                站点标识（唯一）/ unique site key
 *   name               站点显示名 / display name
 *   domains            域名匹配（content script 按域名选适配器）/ domain matcher
 *   base               站点根地址 / site root URL
 *   searchUrl          站内搜索 URL 模板，{q} 会被编码后的搜索词替换
 *                      (empty = 该站无站内搜索) / search URL template; {q} is
 *                      replaced with the encoded query (empty = no search)
 *   detailUrlPatterns  详情页 URL 特征（pathname 正则数组，i 标志）/
 *                      detail-page URL patterns (pathname regex array, i flag);
 *                      empty = 不做 URL 过滤 / no URL filtering
 *   listPage           列表页识别规则 / list-page detection:
 *     urlPatterns      pathname 正则数组，任一命中即列表页 /
 *                      pathname regex array; any match → list page
 *     selectors        DOM 选择器，任一存在即列表页 / DOM selectors; any hit → list page
 *     minDetailLinks   页面上详情链接达到该数量即视为列表页（XDGame 通用判断）/
 *                      list page if detail links ≥ N (XDGame generic check)
 *   listItem           列表项提取规则 / list-item extraction:
 *     containers       列表容器选择器（按优先级尝试）/
 *                      list container selectors (tried in order)
 *     titleLink        标题链接选择器（如 a.tit，优先使用）/
 *                      title-link selector (e.g. a.tit, preferred)
 *     titleEls         标题元素选择器（策略 2 回退）/
 *                      title-element selectors (fallback in strategy 2)
 *     excludeClasses   需要跳过的链接类（如纯图片链接）/
 *                      link classes to skip (e.g. pure image links)
 *     minLen/maxLen    标题长度范围 / title length range
 *     fallbackLinks    容器策略失败后是否回退到全页面链接提取 /
 *                      fall back to extracting all detail links when container
 *                      strategies find nothing
 */
(function (global) {
  'use strict';

  const SITE_RULES = {
    version: 1,
    sites: [
      {
        key: 'xdgame',
        name: 'XDGame',
        domains: ['xdgame.com'],
        base: 'https://xdgame.com',
        searchUrl: 'https://xdgame.com/so/{q}.html',
        detailUrlPatterns: ['/game/\\d+\\.html?$', '/\\d+\\.html?$'],
        listPage: {
          urlPatterns: ['^/so/', '/page/\\d+', '/list/', '^(/|$)'],
          minDetailLinks: 5
        },
        listItem: {
          containers: ['.game-list li', '.list li', 'ul li'],
          titleLink: 'a.tit',
          titleEls: ['h2', 'h3', '.title', '.entry-title', '.name', '.game-name', '.game-title'],
          excludeClasses: ['grid-cover', 'link'],
          minLen: 3,
          maxLen: 200,
          fallbackLinks: true
        }
      },
      {
        key: 'xianyudanji',
        name: '咸鱼单机',
        domains: ['xianyudanji.gg'],
        base: 'https://www.xianyudanji.gg',
        searchUrl: 'https://www.xianyudanji.gg/?s={q}',
        detailUrlPatterns: ['/\\d+\\.html?$', '/[^/]+/?$'],
        listPage: {
          urlPatterns: ['^(/|$)', '/page/\\d+', '/category/', '/tag/', '\\bs=']
        },
        listItem: {
          containers: ['.post', '.article', '.entry', '.item', 'article'],
          titleEls: ['h2', 'h3', '.title', '.entry-title'],
          minLen: 3,
          maxLen: 100,
          fallbackLinks: true
        }
      },
      {
        key: 'gamer520',
        name: 'Gamer520',
        domains: ['gamer520.com'],
        base: 'https://www.gamer520.com',
        searchUrl: 'https://www.gamer520.com/?s={q}',
        detailUrlPatterns: ['/\\d+\\.html?$', '/[^/]+/?$'],
        listPage: {
          urlPatterns: ['^(/|$)', '/page/\\d+', '/category/', '\\bs=']
        },
        listItem: {
          containers: ['.post-item', '.article-item', '.game-item', '.item', 'article'],
          titleEls: ['h2', 'h3', '.title'],
          minLen: 3,
          maxLen: 100
        }
      },
      {
        key: '3dmgame',
        name: '3DM',
        domains: ['3dmgame.com'],
        base: '',
        searchUrl: '',
        detailUrlPatterns: [],
        listPage: {
          selectors: ['.lis', '.game-list', '.content li a[href*="/game/"]', '.Mid2L_con li']
        },
        listItem: {
          containers: ['.lis li', '.game-list li', '.content li', '.Mid2L_con li'],
          titleEls: ['h3', '.name', '.title', 'a'],
          minLen: 3,
          maxLen: 200
        }
      },
      {
        key: 'ali213',
        name: '游侠网',
        domains: ['ali213.net'],
        base: '',
        searchUrl: '',
        detailUrlPatterns: [],
        listPage: {
          selectors: ['.n_lone', '.game_list', '.downlist']
        },
        listItem: {
          containers: ['.n_lone li', '.game_list li', '.downlist li'],
          titleEls: ['.name', 'h3', 'a'],
          minLen: 3,
          maxLen: 200
        }
      },
      {
        key: 'gamersky',
        name: '游民星空',
        domains: ['gamersky.com'],
        base: '',
        searchUrl: '',
        detailUrlPatterns: [],
        listPage: {
          selectors: ['.game-list', '.Mid2L_con', '.pictxt']
        },
        listItem: {
          containers: ['.game-list li', '.Mid2L_con li', '.pictxt li'],
          titleEls: ['.name', 'h3', '.tit', 'a'],
          minLen: 3,
          maxLen: 200
        }
      }
    ]
  };

  // 暴露给内容脚本（isolated world 共享 globalThis）与 Service Worker
  // Exposed to the content script (shared isolated-world globalThis) and the SW
  global.__GAME_RECOMMENDER_SITES__ = SITE_RULES;
})(typeof globalThis !== 'undefined' ? globalThis : this);
