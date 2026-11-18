/**
 * 游戏雷达 Game Radar - UI 设计 token 单源 / UI design token single source
 *
 * v15 阶段 3（绿地重构）：页面/内容样式里的高频色值字面量收敛为此处命名常量
 * （#8f98a0 ×105 / #67c1f5+#66c0f4 同义 Steam 蓝 ×64 / #2a475e ×26 等）。
 * 内容侧与页面侧均为 classic/ESM 共用形态：数据 + 编译函数双导出，页面经
 * bundle 内联、内容侧经 classic 注入（window.__GR_TOKENS__）。
 * Stage-3 greenfield: high-frequency hex literals across page/content styles
 * converge to named constants here (single maintenance point).
 */
(function (global) {
  'use strict';

  /** 基础色板 / Base palette（命名 = 语义） */
  const PALETTE = {
    // Steam 官方语义色
    steamTextDim: '#8f98a0', // 次要文本（高频 #8f98a0）
    steamBlue: '#66c0f4', // Steam 品牌蓝（#67c1f5 视为同义词，收敛到此）
    steamBlueAlt: '#67c1f5', // 兼容别名（渐进替换）
    steamPanelDeep: '#2a475e', // 深面板
    steamDark: '#1b2838', // 深底
    steamText: '#c7d5e0', // 主文本
    // 语义色
    danger: '#e74c3c',
    okGreen: '#a3cf06',
    warnOrange: '#ff7b00',
    // 中性灰阶
    grayPanel: '#3d4450',
    grayLink: '#1f6feb',
    grayText: '#57606f',
    blueSoft: '#d2e4fc',
    grayBorder: '#acb2b8',
    bluePale: '#eaf3ff',
    blueDeep: '#2d6cb5'
  };

  /** 主题清单单源（与 settings-utils VALID_THEMES 同步的展示名） */
  const THEME_LABELS = {
    steam: 'Steam 深蓝',
    vista: 'Vista 玻璃',
    ios6: 'iOS 拟物',
    ios17: 'iOS 17',
    winxp: 'XP 蓝天',
    win11: 'Win11',
    cyberpunk: '赛博朋克',
    aqua: 'Aqua 果冻',
    neumorph: '新拟态',
    netscape: 'Netscape',
    material: 'Material',
    gtk2: 'GTK2',
    vaporwave: '蒸汽波',
    oled: 'OLED 纯黑',
    wabi: '侘寂',
    crt: 'CRT 复古',
    win8: 'Win8 平面',
    morandi: '莫兰迪',
    gothic: '哥特',
    nordic: '北欧'
  };

  global.__GR_TOKENS__ = { PALETTE, THEME_LABELS };
})(/** @type {typeof globalThis} */ (typeof globalThis !== 'undefined' ? globalThis : this));

// ESM 形态（页面 bundle import 用；classic eval 时 export 被打包器消化）
export const PALETTE =
  typeof globalThis !== 'undefined' && globalThis.__GR_TOKENS__ ? globalThis.__GR_TOKENS__.PALETTE : {};
export const THEME_LABELS =
  typeof globalThis !== 'undefined' && globalThis.__GR_TOKENS__ ? globalThis.__GR_TOKENS__.THEME_LABELS : {};
