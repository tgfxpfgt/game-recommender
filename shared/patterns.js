/**
 * Game Recommender - 共享模式/常量（经典脚本）/ Shared Patterns (classic script)
 *
 * v3.3.9：下载站标题"噪声词"正则的唯一权威源。内容脚本经
 * `globalThis.__GR_PATTERNS__.noisePatternSource` 构造 RegExp；
 * 后台 ES module（background/steam/title-parser.js）保留副本并以
 * 本文件为权威源维护（tests/test-security.mjs 有双源一致性断言防漂移）。
 *
 * Single source of truth for the download-site title noise-word pattern.
 * Content scripts build their RegExp from __GR_PATTERNS__.noisePatternSource;
 * the background module keeps a copy synced against this file (a consistency
 * assertion in tests/test-security.mjs guards against drift).
 */
(function (global) {
  'use strict';

  // 噪声词（中文/版本/资源/发布修饰词，段级丢弃与搜索清洗共用）。
  // 修改本表后需同步 background/steam/title-parser.js 的 noisePattern。
  global.__GR_PATTERNS__ = global.__GR_PATTERNS__ || {};
  global.__GR_PATTERNS__.noisePatternSource = '(中文|汉化|破解|免安装|绿色|学习|未加密|完整版|豪华版|豪华|终极|数字|典藏|年度|重制|复刻|增强|正式|官方|简繁|简体|繁体|中英|多语言|特别版|标准版|支持者版|解压即撸|预购特典|预购|特典|抢先试玩|抢先体验|抢先|试玩|体验版|修改器|加速器|作弊|全季票|季票|顶置|置顶|汇总贴|汇总|索引|爆火|热门|版|v[\\d.]+|V[\\d.]+|\\d+\\.\\d+[\\d.]*|Build[.\\s]*\\d+|update\\s*\\d+|DLC.*|全DLC|整合|硬盘|免DVD|CODEX|FLT|RELOADED|SKIDROW|EMPRESS|GOG|Razor1911|FitGirl|\\d+\\s*GB|百度网盘|网盘|下载|游戏下载|免费下载|迅雷|磁力|BT|种子|支持手柄|手柄|支持|新游发布|免安装绿色版|Switch520\\.com|Switch520|520\\.com|\\s+The\\s+Game\\s*)';

  // 好评率分级色（v3.4.0 单源化：列表页徽章/详情页评分区/缓存管理页共用）
  // Rating-graded colors (single source: list badges, detail scores, cache page)
  // ≥80 蓝 / ≥60 黄绿 / <60 橙；推荐值 ≥80 红 / ≥60 橙 / ≥40 黄绿 / 其余灰
  global.__GR_PATTERNS__.ratingColorFor = (rate) => {
    const r = Number(rate);
    if (isNaN(r)) return '#8f98a0';
    return r >= 80 ? '#66c0f4' : r >= 60 ? '#a3cf06' : '#ff7b00';
  };
  global.__GR_PATTERNS__.ratingBgFor = (rate) => {
    const r = Number(rate);
    if (isNaN(r)) return 'rgba(143,152,160,0.15)';
    return r >= 80 ? 'rgba(102,192,244,0.15)' : r >= 60 ? 'rgba(163,207,6,0.15)' : 'rgba(255,123,0,0.15)';
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
