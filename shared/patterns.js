/**
 * 游戏雷达 Game Radar - 共享模式/常量（经典脚本）/ Shared Patterns (classic script)
 *
 * v14.6.3 R1：噪声词正则的旧经典脚本副本已退役——词表单源 =
 * shared/retrieval-vocab.js（ESM，内容侧模块直接 import 编译产物；
 * 经典脚本链无法 import，故不再承载）。本文件保留评级分级色
 * （列表徽章/详情页评分区/缓存管理页共用）。
 *
 * Since R1 the noise vocab lives in shared/retrieval-vocab.js (ESM); this
 * classic script keeps only the rating-graded colors shared by badges,
 * detail rows and the cache manager page.
 */
(function (global) {
  'use strict';

  // 好评率分级色（v3.4.0 单源化：列表页徽章/详情页评分区/缓存管理页共用）
  // Rating-graded colors (single source: list badges, detail scores, cache page)
  // ≥80 蓝 / ≥60 黄绿 / <60 橙；推荐值 ≥80 红 / ≥60 橙 / ≥40 黄绿 / 其余灰
  global.__GR_PATTERNS__ = global.__GR_PATTERNS__ || {};
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

  // MC（Metacritic Metascore）分级色（v14.31.0 单源化：列表 gr-mc-badge 与
  // 详情浮窗 MC 视图此前各持一份字面量（≥75 绿 / 50-74 黄 / <50 红）——
  // 阈值调整需两处同步 = 脱节温床。色带同 MC 惯例，与 Steam 好评率分级
  //（ratingColorFor）**有意不同**（分值语义不同源，勿合并为一把尺）。
  // MC graded colors, single source for the list gr-mc-badge and the detail
  // float's MC view (intentionally NOT merged with the Steam rating scale).
  global.__GR_PATTERNS__.mcColorFor = (score) => {
    const s = Number(score);
    if (isNaN(s)) return '#555';
    return s >= 75 ? '#66cc33' : s >= 50 ? '#ffcc33' : '#ff4444';
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
