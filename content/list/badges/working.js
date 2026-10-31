/**
 * 游戏雷达 Game Radar - 徽章：工作状态域 / Badge Family: Working Status
 *
 * v14 F1：入队占位/移除/检索异常徽章；v14.5.0 B6 由 badges.js 拆出独立域。
 * v14.3.2 修复史：removeWorkingBadge 搜索目标必须与 showWorkingBadge 插入
 * 目标对齐（titleEl || link）——此前只搜 link 后代，titleEl 是 <h3> 包裹 <a>
 * 时徽章在 h3 里永远删不掉（等待检索徽章残留事故）。
 * Working-status domain (B6): enqueue placeholder / removal / error badges.
 */

import { getBadgeRetryHandler } from './badge-base.js'; // v14.7 批次 3：点击重试

// 从 DOM 移除低好评率游戏项（含栅格容器，避免留空）
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
export function showWorkingBadge(item, text) {
  const link = item.link;
  if (!link || link.querySelector('.gr-working-badge')) return;
  const badge = document.createElement('span');
  badge.className = 'gr-working-badge';
  badge.textContent = text || '⏳ 等待检索';
  badge.style.cssText =
    'padding:2px 6px;font-size:10px;background:rgba(255,255,255,0.08);color:#8f98a0;border:1px dashed #444;border-radius:2px;display:inline-block;margin-right:4px;vertical-align:middle;';
  const retry = getBadgeRetryHandler();
  if (retry) {
    badge.style.cursor = 'pointer';
    badge.title = '点击立即重查（穿透负缓存）';
    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      retry(item);
    });
  }
  const target = item.titleEl || link;
  target.insertBefore(badge, target.firstChild);
}

// v14.3.2 修复：搜索目标与 showWorkingBadge 插入目标对齐（titleEl || link）——
// 原实现只搜 link 后代，titleEl 是 <h3> 包裹 <a> 时徽章在 h3 里永远删不掉
export function removeWorkingBadge(item) {
  const target = (item && (item.titleEl || item.link)) || null;
  if (!target) return;
  const badge = target.querySelector('.gr-working-badge');
  if (badge) badge.remove();
}

// v14.8.1（用户反馈：等待检测一直卡在等待检测）：页宽更新等待徽章可见文本——
// 显示当前队列信息（"⏳ 检索中 12/60 · 排队 1 · 限流降速"）。只更新等待占位
// 徽章，错误徽章（gr-error-badge 同类名）不覆盖。
// v14.8.1: update ALL waiting badges' visible text with live queue info;
// error badges share the class and must not be overwritten.
export function updateWorkingBadgesInfo(text) {
  const badges = document.querySelectorAll('.gr-working-badge:not(.gr-error-badge)');
  for (const b of badges) b.textContent = text;
}

// v14 F1：检索异常徽章——网络失败/超时时显示
export function showErrorBadge(item, text) {
  removeWorkingBadge(item);
  const link = item.link;
  if (!link || link.querySelector('.gr-rating-badge')) return;
  const badge = document.createElement('span');
  badge.className = 'gr-working-badge gr-error-badge';
  badge.textContent = text || '⚠️ 检索异常';
  badge.style.cssText =
    'padding:2px 6px;font-size:10px;background:rgba(231,76,60,0.1);color:#e74c3c;border:1px dashed #e74c3c;border-radius:2px;display:inline-block;margin-right:4px;vertical-align:middle;';
  const target = item.titleEl || link;
  target.insertBefore(badge, target.firstChild);
}

// 高亮条目（推荐值达标）/ Highlight an item (recommendation passed)
export function highlightItem(item) {
  const el = item.element;
  el.classList.add('gr-highlighted');
}
