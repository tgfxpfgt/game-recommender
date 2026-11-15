/**
 * 游戏雷达 Game Radar - 规则面板状态区块 Preact 组件（阶段 3 切片 D）
 *
 * rules.js 的"无规则"空态 + 规则自检头部行 → 声明式组件；规则列表大 HTML
 * （sites.map 拼接，含 data-* 事件委托）本批保留原实现。
 * Preact components for rules panel empty state & health header.
 */
import { h, render } from 'preact';

/** @param {{mountEl: HTMLElement}} props */
export function NoRules({ mountEl }) {
  return h('div', { class: 'no-data' }, '无规则');
}

/**
 * 自检头部（🩺 标题行）
 * @param {{lines: string[]}} props
 */
export function HealthHeader({ lines }) {
  return h('div', null, h('div', { style: 'font-weight:bold;' }, '🩺 规则健康自检：'), h('div', null, lines.join('')));
}

/** @param {{vnode: any, mountEl: HTMLElement}} props */
export function mountAt(vnode, mountEl) {
  render(vnode, mountEl);
}
