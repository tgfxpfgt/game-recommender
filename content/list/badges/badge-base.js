/**
 * 游戏雷达 Game Radar - 徽章 DOM 基元 / Badge DOM Primitives
 *
 * v14.5.0 B6：由 badges.js 拆出——createBadge/insertBadges 是徽章家族的
 * 共享 DOM 基元（working/core/rec 三域共用），独立成模块避免 core↔rec
 * 循环 import。
 * Shared DOM primitives for the badge family (B6): a standalone module keeps
 * the core↔rec split cycle-free.
 *
 * @invariant createBadge 默认 base 含 gr-rating-badge；组外徽章（推荐值等）必须显式传 base:'gr-badge'（铁律 12，v10.6.0 事故）
 * @invariant 徽章文本由调用方拼好传入（本模块不做转义）——动态内容在调用方经 escapeHtml/escapeAttr 处理
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
/** @param {() => void} fn */
export function setBadgeRetryHandler(fn) {
  badgeRetryHandler = typeof fn === 'function' ? fn : null;
}
export function getBadgeRetryHandler() {
  return badgeRetryHandler;
}

// v14.43.0（用户指令 2026-11-23）：徽章行容器单源——徽章不再混入标题行，
// 改为标题上方独立一行（div.gr-badge-row），标题行 DOM 保持原版。
// 布局两档：①titleEl 独立于 link（含 titleEl===link 之外的常见 h2>a 布局）
// → 行插在 titleEl 之前作兄弟节点；②titleEl 即 link（或无 titleEl）→ 行插在
// link 内部、首个非图片内容子元素之前（徽章贴近标题文本、不压住封面图）。
// Badge row container single source (v14.43.0): badges render on their own
// line above the title; the title line DOM stays untouched.
const TITLE_FALLBACK_SELECTOR = 'h2, h3, h4, h5, .title, .entry-title, .name, .game-name, .game-title';

/** @param {any} item @returns {any} 标题元素（titleEl 优先，回退站内选择器） */
export function resolveTitleEl(item) {
  let t = (item && item.titleEl) || null;
  if (!t && item && item.element && item.element.querySelector) {
    t = item.element.querySelector(TITLE_FALLBACK_SELECTOR);
  }
  return t || null;
}

// 查找条目已存在的徽章行（两档位置都查）/ Find the item's existing badge row
/** @param {any} item @returns {any} */
export function findBadgeRow(item) {
  const link = item && item.link;
  // 档②：行在 link 内部 / row inside the link
  if (link && link.querySelector) {
    const r = link.querySelector('.gr-badge-row');
    if (r) return r;
  }
  // 档①：行是 titleEl 的前一兄弟 / row is the title element's previous sibling
  const t = resolveTitleEl(item);
  if (t && t.previousElementSibling && t.previousElementSibling.classList) {
    if (t.previousElementSibling.classList.contains('gr-badge-row')) return t.previousElementSibling;
  }
  return null;
}

// 组标记可见性单源（守卫统一入口）——徽章可能在 link 外（档①行是标题兄弟），
// 守卫只查 link 会漏判导致重复渲染。防重复守卫/测试统一走本函数。
// Single source for group-marker visibility: badges may live outside the
// link (row beside the title), so link-only queries under-count and re-render.
/** @param {any} item @param {string} selector */
export function itemQuerySelector(item, selector) {
  const link = item && item.link;
  if (link && link.querySelector && link.querySelector(selector)) return link.querySelector(selector);
  const row = findBadgeRow(item);
  if (row && row.querySelector && row.querySelector(selector)) return row.querySelector(selector);
  const t = resolveTitleEl(item);
  if (t && t.querySelector && t.querySelector(selector)) return t.querySelector(selector);
  return null;
}

// 确保徽章行存在（不存在则创建并按两档布局插入）/ Ensure the badge row exists
/** @param {any} item @returns {any} 徽章行元素（无法定位插入点时返回 null） */
export function ensureBadgeRow(item) {
  const existing = findBadgeRow(item);
  if (existing) return existing;
  const link = item && item.link;
  if (!link || !link.insertBefore) return null;
  const row = document.createElement('div');
  row.className = 'gr-badge-row';
  row.setAttribute('data-gr-self', '1'); // 列表观察器跳过扩展自注入节点
  const t = resolveTitleEl(item);
  if (t && t !== link && t.parentNode && t.parentNode.insertBefore) {
    t.parentNode.insertBefore(row, t); // 档①：标题前一兄弟 / beside the title
  } else {
    // 档②：link 内首个非图片内容子元素之前（贴近标题文本，不遮封面）
    let ref = link.firstChild;
    while (ref) {
      const isImg = ref.nodeType === 1 && /^(img|svg|picture)$/i.test(/** @type {any} */ (ref).tagName || '');
      const hasText = (ref.textContent || '').trim().length > 0;
      if (!isImg && (ref.nodeType !== 1 || hasText)) break;
      ref = ref.nextSibling;
    }
    link.insertBefore(row, ref);
  }
  // v14.43.0 格子缩放联动：行不在被补偿的文字块内时，行自带文字补偿 zoom
  //（applyCellScale 把系数缓存在 item._grScale；行创建晚于缩放应用，此处补挂）
  const sc = item && item._grScale;
  const tb = sc && sc.textBlock;
  if (sc && sc.comp !== undefined && !(tb && tb.contains && tb.contains(row)) && row.style) {
    if (sc.comp !== 1) row.style.zoom = String(sc.comp);
  }
  return row;
}

// v14.7 批次 3：移除组标记徽章（未找到/类型/评分同享 gr-rating-badge 组标记）——
// 点击重试成功后、重渲染前调用（prependBadge 的防重复守卫依赖组标记不存在）。
// 用 querySelector 循环而非 querySelectorAll——sim FakeEl 的后者仅支持 img。
// Remove group-marked badges before re-rendering (querySelector loop: the sim
// FakeEl only implements querySelectorAll for img).
/** @param {any} item */
export function removeRatingBadges(item) {
  // v14.43.0：徽章已迁出标题行——搜索范围 = link / 徽章行 / 标题元素全覆盖
  //（档①布局下行在 titleEl 外，仅查 titleEl 会漏删 → 防重复守卫误拦截）
  const scopes = [item && item.link, findBadgeRow(item), resolveTitleEl(item)];
  for (const target of scopes) {
    if (!target || !target.querySelector) continue;
    let badge = target.querySelector('.gr-rating-badge');
    while (badge) {
      badge.remove();
      badge = target.querySelector('.gr-rating-badge');
    }
  }
}

// 批量插入徽章组（按传入顺序从左到右插进徽章行；行由 ensureBadgeRow 单源创建）
// v14.43.0：评分族徽章恒在推荐徽章左侧——推荐徽章可能因批次竞态先到（旧实现
// 靠"prepend 到标题 firstChild"语义恰好保证该序，迁行后需显式锚定：行内已有
// rec 徽章则整组插其前，否则行尾追加）
// Insert a badge group in order; rating-family badges always stay left of any
// rec badge (rec can arrive first under batch racing — the old prepend-into-
// title semantics guaranteed this by accident, now it's explicit).
/** @param {any} item @param {any} link @param {any[]} badges */
export function insertBadges(item, link, badges) {
  const row = ensureBadgeRow(item);
  if (!row) return;
  const recBadge = row.querySelector('.gr-rec-badge');
  for (let i = 0; i < badges.length; i++) row.insertBefore(badges[i], recBadge);
}
