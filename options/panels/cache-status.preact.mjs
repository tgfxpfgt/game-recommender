/**
 * 游戏雷达 Game Radar - 缓存面板状态区块 Preact 组件（阶段 3 切片 D）
 *
 * cache.js 的加载中/失败/空态 tr 行 + 自愈/清理结果统计文案 → 声明式组件。
 * 大数据行（games.map 拼接 HTML）本批保留原实现（含内联事件委托改造，后续批次）。
 * Preact components for cache panel status rows; big data rows stay as-is.
 */
import { h, render } from 'preact';

/** @param {{msg: string, colspan?: number}} props 空态行（cache-empty 类契约保留） */
export function CacheEmptyRow({ msg, colspan = 11 }) {
  return h('tr', null, h('td', { colSpan: String(colspan), class: 'cache-empty' }, msg));
}

/**
 * 自愈/清理结果统计行（<b> 数字高亮语义保留）
 * @param {{parts: Array<{label: string, value: string|number, tail?: string}>}} props
 */
export function HealStats({ parts }) {
  return h(
    'span',
    null,
    parts.map((p, i) => {
      const node = h('span', { key: String(i) }, p.label, h('b', null, String(p.value)), p.tail || '');
      return node;
    })
  );
}

/** @param {{vnode: any, mountEl: HTMLElement}} props */
export function mountAt(vnode, mountEl) {
  render(vnode, mountEl);
}

export { h };
