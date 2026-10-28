/**
 * 游戏雷达 Game Radar - 徽章 DOM 基元 / Badge DOM Primitives
 *
 * v14.5.0 B6：由 badges.js 拆出——createBadge/insertBadges 是徽章家族的
 * 共享 DOM 基元（working/core/rec 三域共用），独立成模块避免 core↔rec
 * 循环 import。
 * Shared DOM primitives for the badge family (B6): a standalone module keeps
 * the core↔rec split cycle-free.
 */

// 创建单个徽章 span（统一样式；clickable 时点击跳转 Steam 详情页）
// Create one badge span (shared styling; clickable badges open the store)
/**
 * 创建徽章元素。base 默认含 gr-rating-badge（好评率徽章组标记——prependBadge
 * 防重复守卫、推荐徽章插入锚点与测试契约都依赖它）；组外徽章（推荐值）必须
 * 传 base:'gr-badge'，否则推荐徽章先渲染时会污染守卫导致好评率徽章永久缺失。
 * （v10.6.0 事故约定，铁律 12——本函数是该契约的单点实现）
 * v14.7 批次 3：onClick 选项——点击执行自定义动作（与 clickable 的跳 Steam
 * 语义互斥；未找到/等待徽章的重试经它接线，实现由 list-page 注入）。
 * @param {any} link
 * @param {{text: string, color: string, bg: string, cls: string, title: string, clickable?: boolean, appId?: any, dashed?: boolean, base?: string, onClick?: Function}} opts
 */
export function createBadge(link, { text, color, bg, cls, title, clickable, appId, dashed, base, onClick }) {
  // v8.1.0：公共样式走 .gr-badge 基类（content.css）；动态颜色与变体类仍由调用方提供
  const badge = document.createElement('span');
  badge.className = (base || 'gr-badge gr-rating-badge') + ' ' + (cls || '');
  badge.textContent = text;
  badge.style.cssText = `color:${color};background:${bg};border-color:${color};${clickable || onClick ? 'cursor:pointer;text-decoration:none;' : ''}`;
  if (dashed) badge.classList.add('gr-badge-dashed');
  if (clickable) badge.classList.add('gr-badge-clickable');
  badge.title = title || '';
  // span+click 避免嵌套链接 / span + click to avoid nested anchors
  if (clickable && appId) {
    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(`https://store.steampowered.com/app/${appId}/`, '_blank', 'noopener');
    });
  }
  if (typeof onClick === 'function') {
    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick(e);
    });
  }
  return badge;
}

// v14.7 批次 3：徽章重试处理器单点注入——click 语义的实现（节流/消息/重渲染）
// 依赖 list-state（_state.job.settings），放在 list-page；badges 域经此钩子
// 反向调用，避免 badges↔list-state 循环 import。
// Retry-handler injection point: list-page registers the implementation, the
// badge family calls back through it (keeps the import graph one-way).
/** @type {((item: any) => void)|null} */
let badgeRetryHandler = null;
export function setBadgeRetryHandler(fn) {
  badgeRetryHandler = typeof fn === 'function' ? fn : null;
}
export function getBadgeRetryHandler() {
  return badgeRetryHandler;
}

// v14.7 批次 3：移除组标记徽章（未找到/类型/评分同享 gr-rating-badge 组标记）——
// 点击重试成功后、重渲染前调用（prependBadge 的防重复守卫依赖组标记不存在）。
// 用 querySelector 循环而非 querySelectorAll——sim FakeEl 的后者仅支持 img。
// Remove group-marked badges before re-rendering (querySelector loop: the sim
// FakeEl only implements querySelectorAll for img).
export function removeRatingBadges(item) {
  const target = (item && (item.titleEl || item.link)) || null;
  if (!target) return;
  let badge = target.querySelector('.gr-rating-badge');
  while (badge) {
    badge.remove();
    badge = target.querySelector('.gr-rating-badge');
  }
}

// 批量插入徽章组（从后往前插保证从左到右顺序；标题元素优先，回退链接文本节点）
// Insert a badge group (reverse-order insert keeps left-to-right order)
export function insertBadges(item, link, badges) {
  let targetEl = item.titleEl || null;
  if (!targetEl && item.element) {
    targetEl = item.element.querySelector('h2, h3, h4, h5, .title, .entry-title, .name, .game-name, .game-title');
  }
  if (targetEl) {
    for (let i = badges.length - 1; i >= 0; i--) targetEl.insertBefore(badges[i], targetEl.firstChild);
  } else {
    const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT, null);
    const firstTextNode = walker.nextNode();
    const ref = firstTextNode && (firstTextNode.textContent || '').trim().length > 1 ? firstTextNode : link.firstChild;
    for (let i = badges.length - 1; i >= 0; i--) link.insertBefore(badges[i], ref);
  }
}
