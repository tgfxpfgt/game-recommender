/**
 * 游戏雷达 Game Radar - 徽章：工作状态域 / Badge Family: Working Status
 *
 * v14 F1：入队占位/移除/检索异常徽章；v14.5.0 B6 由 badges.js 拆出独立域。
 * v14.3.2 修复史：removeWorkingBadge 搜索目标必须与 showWorkingBadge 插入
 * 目标对齐（titleEl || link）——此前只搜 link 后代，titleEl 是 <h3> 包裹 <a>
 * 时徽章在 h3 里永远删不掉（等待检索徽章残留事故）。
 * Working-status domain (B6): enqueue placeholder / removal / error badges.
 */

import { getBadgeRetryHandler, ensureBadgeRow, itemQuerySelector } from './badge-base.js'; // v14.7 批次 3：点击重试；v14.43.0：徽章行单源
import { t } from '../../../shared/ui-text.js'; // v14.39.0：用户可见文案单源

// 从 DOM 移除低好评率游戏项（含栅格容器，避免留空）
/** @param {any} item */
export function removeItemFromDom(item) {
  if (!item.element || !item.element.parentNode) return;
  const colContainer = item.element.closest('[class*="col-"]') || item.element.closest('li, article, .item, .post');
  const toRemove = colContainer && colContainer !== item.element ? colContainer : item.element;
  if (toRemove.parentNode) toRemove.remove();
}

// v14 F1：工作状态徽章——入队时显示"⏳ 等待检索"，数据到达后替换为真实徽章
// Working status badge: shown at enqueue time, replaced by real badges on data.
// v14.7 批次 3：点击 = 就地重试（经 badge-base 注入的处理器；任务进行中由
// 处理器自行忽略，收尾残留项点击重查）。
/** @param {any} item @param {string} text */
export function showWorkingBadge(item, text) {
  const link = item.link;
  if (!link || itemQuerySelector(item, '.gr-working-badge')) return; // v14.43.0：守卫单源
  const badge = document.createElement('span');
  badge.className = 'gr-working-badge';
  badge.textContent = text || t('badge.workingWait');
  badge.style.cssText =
    'padding:2px 6px;font-size:10px;background:rgba(255,255,255,0.08);color:#8f98a0;border:1px dashed #444;border-radius:2px;display:inline-block;margin-right:4px;vertical-align:middle;';
  const retry = getBadgeRetryHandler();
  if (retry) {
    badge.style.cursor = 'pointer';
    badge.title = t('badge.workingRetryTitle');
    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      retry(item);
    });
  }
  // v14.43.0：插入徽章行（标题上方独立一行）/ insert into the badge row
  const row = ensureBadgeRow(item);
  if (row) row.insertBefore(badge, row.firstChild);
}

// v14.3.2 修复：搜索目标与 showWorkingBadge 插入目标对齐（titleEl || link）——
// 原实现只搜 link 后代，titleEl 是 <h3> 包裹 <a> 时徽章在 h3 里永远删不掉
// v14.43.0：徽章迁入徽章行——搜索范围 = link / 徽章行 / 标题元素（itemQuerySelector 单源）
/** @param {any} item */
export function removeWorkingBadge(item) {
  const badge = itemQuerySelector(item, '.gr-working-badge');
  if (badge) badge.remove();
}

// v14.8.1（用户反馈：等待检测一直卡在等待检测）：页宽更新等待徽章可见文本——
// 显示当前队列信息（"⏳ 检索中 12/60 · 排队 1 · 限流降速"）。只更新等待占位
// 徽章，错误徽章（gr-error-badge 同类名）不覆盖。
// v14.8.1: update ALL waiting badges' visible text with live queue info;
// error badges share the class and must not be overwritten.
/** @param {string} text */
export function updateWorkingBadgesInfo(text) {
  const badges = document.querySelectorAll('.gr-working-badge:not(.gr-error-badge)');
  for (const b of badges) b.textContent = text;
}

// v14 F1：检索异常徽章——网络失败/超时时显示
/** @param {any} item @param {string} text */
export function showErrorBadge(item, text) {
  removeWorkingBadge(item);
  const link = item.link;
  if (!link || itemQuerySelector(item, '.gr-rating-badge')) return; // v14.43.0：守卫单源
  const badge = document.createElement('span');
  badge.className = 'gr-working-badge gr-error-badge';
  badge.textContent = text || t('badge.errorDefault');
  badge.style.cssText =
    'padding:2px 6px;font-size:10px;background:rgba(231,76,60,0.1);color:#e74c3c;border:1px dashed #e74c3c;border-radius:2px;display:inline-block;margin-right:4px;vertical-align:middle;';
  // v14.43.0：插入徽章行 / insert into the badge row
  const row = ensureBadgeRow(item);
  if (row) row.insertBefore(badge, row.firstChild);
}

// 高亮条目（推荐值达标）/ Highlight an item (recommendation passed)
/** @param {any} item */
export function highlightItem(item) {
  const el = item.element;
  el.classList.add('gr-highlighted');
}

// v14.10.0：非 PC 平台徽章——主机/模拟器标签（虚线灰）与 Metacritic 分
//（色带同 MC 惯例：≥75 绿 / 50-74 黄 / <50 红）。组标记 gr-rating-badge
//（防重复守卫/测试选择器三重身份——经 createBadge 传入）。
// v14.43.0（用户指令 2026-11-24）：MC 徽章组统一 4 块——具体平台（如 NS2，
// 管线装配，标题标记 → MC 平台列表兜底）→ MC 媒体分 → MC 用户分 → 发售日期，
// 缺值显示「—」占位（故障三态：占位 ≠ 有值）；badgeVisibility.mc* 四键独立
// 开关（默认全开）。非 MC 收录条目如实显示占位，不虚挂数据。
// Non-PC platform badge group (v14.43.0): specific platform tag → MC media →
// MC user score → release date, "—" placeholders when missing, four toggles.
/** @param {any} item @param {any} rating @param {Record<string, any>} [settings] */
export function prependPlatformBadge(item, rating, settings) {
  const link = item.link;
  if (!link || itemQuerySelector(item, '.gr-rating-badge')) return; // v14.43.0：守卫单源
  const row = ensureBadgeRow(item);
  if (!row) return;
  const bv = (settings && settings.badgeVisibility) || {};
  const mcColor = typeof rating.mcScore === 'number' ? globalThis.__GR_PATTERNS__.mcColorFor(rating.mcScore) : null;
  const userColor = globalThis.__GR_TOKENS__ ? globalThis.__GR_TOKENS__.PALETTE.mcUserBadge : '#5a7bb8';
  /** @param {string} cls @param {string} text @param {string} style @param {string} title */
  const addBadge = (cls, text, style, title) => {
    const badge = document.createElement('span');
    badge.className = 'gr-rating-badge ' + cls;
    badge.textContent = text;
    badge.style.cssText =
      'padding:2px 6px;font-size:10px;' +
      style +
      'border-radius:2px;display:inline-block;margin-right:4px;vertical-align:middle;cursor:default;';
    badge.title = title || '';
    row.appendChild(badge);
  };

  // ① 具体平台（NS2/PS5/模拟器/Steam 未发售——管线 platformTag 单源装配）
  if (bv.mcPlatform !== false) {
    addBadge(
      'gr-platform-badge',
      rating.platformTag || '主机',
      'background:rgba(143,152,160,0.12);color:#8f98a0;border:1px dashed #555;',
      rating.platformTag === '模拟器' ? t('badge.platformEmulatorTitle') : t('badge.platformConsoleTitle')
    );
  }
  // ② MC 媒体分（有分 = 分级色；无分 = 灰占位——不与「未找到」混同）
  if (bv.mcMedia !== false) {
    addBadge(
      'gr-mc-badge',
      typeof rating.mcScore === 'number' ? `MC ${rating.mcScore}` : 'MC —',
      typeof rating.mcScore === 'number'
        ? `color:#fff;background:${mcColor};`
        : 'background:rgba(143,152,160,0.1);color:#8f98a0;',
      typeof rating.mcScore === 'number'
        ? t('badge.mcTitlePrefix', { score: rating.mcScore }) +
            (rating.mcName ? t('badge.mcNameSuffix', { name: rating.mcName }) : '') +
            (rating.platformTag ? t('badge.mcTagSuffix', { tag: rating.platformTag }) : '')
        : t('badge.mcNoScoreTitle')
    );
  }
  // ③ MC 用户分（0-10 制一位小数，蓝紫底与媒体分区分）
  if (bv.mcUser !== false) {
    addBadge(
      'gr-mc-user-badge',
      typeof rating.mcUserScore === 'number' ? `用户 ${rating.mcUserScore}` : '用户 —',
      typeof rating.mcUserScore === 'number'
        ? `color:#fff;background:${userColor};`
        : 'background:rgba(143,152,160,0.1);color:#8f98a0;',
      typeof rating.mcUserScore === 'number'
        ? t('badge.mcUserTitle', { score: rating.mcUserScore })
        : t('badge.mcNoUserTitle')
    );
  }
  // ④ 发售日期（列表 4 徽章组新增；与 Steam 段3「—」占位同语义）
  if (bv.mcRelease !== false) {
    const rel = typeof rating.mcReleaseDate === 'string' ? rating.mcReleaseDate : '';
    addBadge(
      'gr-mc-release-badge',
      rel ? `📅 ${rel.length >= 10 ? rel.slice(5, 10) : rel}` : '—',
      'background:rgba(143,152,160,0.1);color:#8f98a0;',
      rel ? t('badge.mcReleaseTitle', { date: rel }) : t('badge.mcNoReleaseTitle')
    );
  }
}
