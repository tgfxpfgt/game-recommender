/**
 * 游戏雷达 Game Radar - 欢迎页状态区块 Preact 组件（阶段 3 渐进迁移）
 *
 * ChangelogBox（更新说明渲染——<details> 原生交互无需绑定）/ SiteStatus
 * （站点启用状态三态）/ Dots（步骤圆点，随 step 重渲染）。
 * 主题选择按钮（guideState 状态交互）保留原实现，另批迁移。
 * Preact components for the welcome guide page status blocks.
 */
import { h, render } from 'preact';

/** @param {{msg: string}} props */
export function PlainMsg({ msg }) {
  return h('p', null, msg);
}

/**
 * 更新说明盒（esc 由调用方注入——沿用页面同款转义口径）
 * @param {{current: any, recents: any[], esc: (s: unknown) => string}} props
 */
export function ChangelogBox({ current, recents, esc }) {
  if (!current) return h('p', null, '本版更新说明见完整记录。');
  const list = (/** @type {any[]} */ items) =>
    h(
      'ul',
      { class: 'changelog' },
      items.map((it, i) => h('li', { key: String(i) }, it))
    );
  return h(
    'div',
    null,
    h(
      'div',
      { class: 'changelog-current' },
      h('h3', null, '✨ 本次更新 v' + esc(current.ver) + (current.date ? ' (' + esc(current.date) + ')' : '')),
      list(current.items || [])
    ),
    recents.length > 0
      ? h(
          'div',
          { class: 'changelog-recent' },
          h('h3', null, '近期版本'),
          recents.map((v, i) =>
            h(
              'details',
              { key: v.ver },
              h('summary', null, 'v' + esc(v.ver) + (v.date ? ' · ' + esc(v.date) : '')),
              list(v.items || [])
            )
          )
        )
      : null
  );
}

/**
 * 站点启用状态三态
 * @param {{mode: 'custom'|'none'|'builtin', count: number}} props
 */
export function SiteStatus({ mode, count }) {
  if (mode === 'custom') {
    return h('span', null, '✅ 已启用 ', h('b', null, String(count)), ' 个站点（含自定义）');
  }
  if (mode === 'builtin') {
    return h('span', null, '✅ 已启用 ', h('b', null, String(count)), ' 个内置站点');
  }
  return h('span', null, '⚠️ 尚未启用任何站点');
}

/** @param {{step: number, total: number}} props */
export function Dots({ step, total }) {
  return h(
    'span',
    null,
    Array.from({ length: total }, (_, i) => h('span', { class: 'dot' + (i === step ? ' on' : ''), key: String(i) }))
  );
}

/** @param {{vnode: any, mountEl: HTMLElement}} props */
export function mountAt(vnode, mountEl) {
  render(vnode, mountEl);
}
