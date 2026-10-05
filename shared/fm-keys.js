// @ts-strict
/**
 * 游戏雷达 Game Radar - 浮窗模块键单源 / Float-Module Keys Single Source
 *
 * v14.2.0（复审轮 P1-2）：浮窗五模块键此前散落 5 份副本（DEFAULT_SETTINGS /
 * types JSDoc / detail-templates DEFAULT_ORDER / settings FM_MODULES /
 * options 保存映射 filter）。本文件为唯一真源——ESM 具名导出（content/
 * background 直接 import）+ globalThis 挂载（options.html 以 module script
 * 加载，classic 面板脚本经全局读取——module 先于 DOMContentLoaded 执行）。
 * Single source for the five float-module keys: ESM named exports plus a
 * globalThis mirror for classic option-panel scripts.
 */

export const FM_KEYS = ['chips', 'tags', 'developers', 'description', 'spy'];
export const FM_LABELS = {
  chips: '中文支持',
  tags: '用户标签',
  developers: '开发商',
  description: '简介',
  spy: 'SteamSpy'
};
export const FM_DEFAULT_ORDER = FM_KEYS.slice();

// classic 消费通道（options.html 以 <script type="module"> 加载本文件后，
// panels/settings.js 等经典脚本在运行期读此全局——模块先于 DCL 执行）
if (typeof globalThis !== 'undefined') {
  globalThis.__GR_FM_KEYS__ = { keys: FM_KEYS, labels: FM_LABELS, defaultOrder: FM_DEFAULT_ORDER };
}
