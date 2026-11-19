/**
 * 游戏雷达 Game Radar - 限免页状态区块 Preact 组件（阶段 3 渐进迁移）
 *
 * loadFreeGames/renderGames 的加载中/加载失败/空态 → 声明式组件。
 * 游戏卡片大行（renderGameCard + 领取按钮事件委托）与月历保留原实现——
 * 交互面迁移另行批次。Preact components for the freegames status block;
 * interactive card rows & calendar stay as-is this slice.
 */
import { h, render } from 'preact';

/** @param {{msg: string, cls?: string}} props 空态/加载态（cls 契约保留） */
export function StatusLine({ msg, cls = 'empty' }) {
  return h('div', { class: cls }, msg);
}

/** @param {{vnode: any, mountEl: HTMLElement}} props */
export function mountAt(vnode, mountEl) {
  render(vnode, mountEl);
}
