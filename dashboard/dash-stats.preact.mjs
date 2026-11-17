/**
 * 游戏雷达 Game Radar - Dashboard 状态区块 Preact 组件（阶段 3 切片 C 首件）
 *
 * dash-stats.js 的 four no-data/错误分支（趋势失败/暂无数据/下载方法空/
 * 站点 Top 空/表空）与**数据行渲染**先迁组件——SVG 图与 tbody 大表保留
 * 原实现（SVG diff 收益低），后续批次渐进。
 * Preact components for dashboard status blocks; SVG chart & big tables stay
 * as-is this slice (low diff benefit), migrate incrementally.
 */
import { h, render } from 'preact';

/** @param {{msg: string}} props */
export function NoData({ msg }) {
  return h('div', { class: 'no-data' }, msg);
}

/** @param {{msg: string}} props */
export function LoadError({ msg }) {
  return h('div', { class: 'no-data' }, msg);
}

/**
 * 下载方式分布行（renderDownloadMethods 的 Object.entries 渲染段）
 * @param {{methods: Array<[string, number]>, esc: (s: unknown) => string}} props
 */
export function DownloadMethods({ methods, esc }) {
  return h(
    'div',
    null,
    methods.map(([method, count]) =>
      h(
        'div',
        { class: 'method-row', key: method },
        h('div', { class: 'method-name' }, (method && String(method)) || 'unknown'),
        h('div', { class: 'method-count' }, String(count))
      )
    )
  );
}

/**
 * 结构化挂载辅助：render(vnode, mountEl) 位置参数版（classic 侧经 m.mountAt 调用）
 * @param {any} vnode @param {HTMLElement} mountEl
 */
export function mountAt(vnode, mountEl) {
  render(vnode, mountEl);
}

// v14.33.1：classic 侧（dash-stats.js ensurePreactMount）经 m.h 取 preact 的 h
// 构建 TableNoData 虚拟节点——本模块此前漏导出 h（v15 阶段 3 遗留：dashboard
// 空态场景 preactH is not a function，E2E dist 验收暴露）。re-export 修复。
export { h };
