/**
 * game-radar v2 — 设计 token 单源
 * Design tokens: the ONLY place colors/spacing exist. #8f98a0 ×118 becomes
 * one definition; themes are token overrides (data, not CSS files).
 */

/** 基础色板（Steam 视觉语言 + 语义色） */
export const palette = {
  // Steam 品牌色（#67c1f5 与 #66c0f4 两种旧写法归一）
  steamBlue: '#67c1f5',
  steamBlueDim: 'rgba(103, 193, 245, 0.15)',
  steamGreen: '#a3cf06',
  textPrimary: '#c7d5e0',
  textMuted: '#8f98a0',
  panelBg: 'rgba(42, 71, 94, 0.5)',
  panelBorder: '#2a475e',
  darkBg: '#1b2838',
  // 语义色
  ok: '#66cc33',
  warn: '#ffcc33',
  danger: '#ff4444',
  neutral: '#8f98a0',
  suspect: '#ffcc33'
} as const;

/** MC（Metascore）分级色——与 Steam 好评率分级**有意不同**（分值语义异源） */
export function metascoreColor(score: number | null): string {
  if (score === null || Number.isNaN(score)) return '#555';
  return score >= 75 ? palette.ok : score >= 50 ? palette.warn : palette.danger;
}

/** 间距/字号 scale */
export const scale = {
  space1: '4px',
  space2: '8px',
  space3: '12px',
  fontSizeBadge: '10px',
  fontSizeChip: '12px'
} as const;

/** 主题 = token override 数据（新增主题 = 加一个对象，非新 CSS 文件） */
export interface ThemeOverride {
  id: string;
  label: string;
  vars: Partial<Record<keyof typeof palette, string>>;
}

/** 首批主题（对照期 3 个；其余 16 个在功能等价批次数据化） */
export const themes: ThemeOverride[] = [
  { id: 'steam-dark', label: 'Steam 深色', vars: {} },
  {
    id: 'ios17',
    label: 'iOS 17',
    vars: {
      panelBg: 'rgba(250, 250, 252, 0.92)',
      panelBorder: '#d8d8de',
      textPrimary: '#1c1c1e',
      textMuted: '#6e6e73',
      darkBg: '#f2f2f7'
    }
  },
  {
    id: 'nordic',
    label: 'Nordic',
    vars: {
      panelBg: 'rgba(46, 52, 64, 0.85)',
      panelBorder: '#4c566a',
      textPrimary: '#d8dee9',
      textMuted: '#8f9bab',
      steamBlue: '#88c0d0',
      darkBg: '#2e3440'
    }
  }
];

/** 生成主题 CSS（css custom properties，作用域 .gr2） */
export function themeCss(): string {
  const lines = [':root, .gr2 {'];
  for (const [k, v] of Object.entries(palette)) {
    lines.push(`  --gr-${kebab(k)}: ${v};`);
  }
  for (const [k, v] of Object.entries(scale)) {
    lines.push(`  --gr-${kebab(k)}: ${v};`);
  }
  lines.push('}');
  for (const theme of themes) {
    if (Object.keys(theme.vars).length === 0) continue;
    lines.push(`.gr2[data-theme='${theme.id}'] {`);
    for (const [k, v] of Object.entries(theme.vars)) {
      lines.push(`  --gr-${kebab(k)}: ${v};`);
    }
    lines.push('}');
  }
  return lines.join('\n');
}

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
