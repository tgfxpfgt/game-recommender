/**
 * 游戏雷达 Game Radar - 适配规则聚合入口 / Adapter Rules Aggregation Entry
 *
 * 合并基础共用规则（default.js）与各下载站规则（sites/*.js）为统一的
 * __GAME_RECOMMENDER_SITES__，供内容脚本与 Service Worker 使用。
 * v14.29.0（P1-2）：延迟装配——顶层只注册懒 getter，首次读取才构建注册表
 * （默认规则展开 + 6 站点合并）并缓存；直接赋值仍经 setter 覆盖（严格模式下
 * 无 setter 会抛 TypeError）。
 *
 * Aggregates default/per-site rules into __GAME_RECOMMENDER_SITES__.
 * v14.29.0: lazy assembly — the registry is built on first read and cached;
 * the setter keeps direct-assignment compatibility.
 *
 * 加载顺序（manifest content_scripts / SW import 均需按此顺序）：
 * Load order (both manifest content_scripts and SW imports):
 *   default.js → sites/*.js → index.js
 */
(function (global) {
  'use strict';

  const siteKeys = ['XDGAME', 'XIANYUDANJI', 'GAMER520', '3DMGAME', 'ALI213', 'GAMERSKY'];
  /** @type {Record<string, *>} */
  const g = /** @type {Record<string, *>} */ (global);
  // 工厂或已装配对象均按值取用（兼容旧版直接赋值）
  // Accept both factories and plain objects (legacy direct assignment)
  /** @param {*} value @returns {*} */
  const materialize = (value) => (typeof value === 'function' ? value() : value);

  // 注册表按需构建：默认规则展开 + 站点合并在此发生
  // Registry built on demand: defaults expansion + per-site merge happen here
  /** @returns {{version: number, sites: any[]}} */
  function build() {
    const defaults = materialize(g.__GAME_RECOMMENDER_DEFAULT_RULES__) || {};
    return {
      version: 1,
      sites: siteKeys
        .map((k) => materialize(g['__GAME_RECOMMENDER_SITE_' + k + '__']))
        .filter(Boolean)
        .map((rule) => ({ ...defaults, ...rule }))
    };
  }

  /** @type {{version: number, sites: any[]}|null} */
  let cached = null;
  Object.defineProperty(global, '__GAME_RECOMMENDER_SITES__', {
    configurable: true,
    enumerable: true,
    get() {
      return cached || (cached = build());
    },
    set(value) {
      cached = value;
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
