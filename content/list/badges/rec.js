/**
 * 游戏雷达 Game Radar - 徽章：推荐值域 / Badge Family: Recommendation
 *
 * 推荐值徽章：好评率徽章之后插入，显示推荐数值；悬停展示各分值组成；
 * 按推荐值分级着色（≥80% 红 / ≥60% 橙 / ≥40% 黄绿 / 其余灰）。
 * v3.3.8：插入到**最后一个**好评率/更新徽章之后（此前插到第一个 rating 徽章
 * 后，三段式下顺序错乱）；受 badgeVisibility.rec 开关控制（关闭同时停用高亮）。
 * v14.5.0 B6：由 badges.js 拆出独立域（createBadge 走 badge-base 单点）。
 * Recommendation badge domain (B6): score + breakdown tooltip + graded color,
 * inserted after the LAST rating badge.
 */
import { createBadge } from './badge-base.js';

export function prependRecBadge(item, recommendation, settings) {
  const link = item.link;
  if (!link || !recommendation) return;
  // v4.1.0：防重复（REFRESH 强制刷新/多批回填场景）
  if (link.querySelector('.gr-rec-badge')) return;
  const bv = (settings && settings.badgeVisibility) || {};
  if (bv.rec === false) return;
  const score = recommendation.score;
  if (score === null || score === undefined || isNaN(score)) return;

  const pct = Math.round(score * 100);
  const color = pct >= 80 ? '#e74c3c' : pct >= 60 ? '#ff7b00' : pct >= 40 ? '#a3cf06' : '#8f98a0';
  const bg =
    pct >= 80
      ? 'rgba(231,76,60,0.12)'
      : pct >= 60
        ? 'rgba(255,123,0,0.12)'
        : pct >= 40
          ? 'rgba(163,207,6,0.12)'
          : 'rgba(143,152,160,0.1)';

  const b = recommendation.breakdown || {};
  const fmt = (v) => Math.round((v || 0) * 100) + '%';
  // v11.0 B8：LLM 推荐理由上浮（method=llm 时 recommendation.reason 可用）
  const reasonLine = recommendation.method === 'llm' && recommendation.reason ? '\n🤖 ' + recommendation.reason : '';
  // v10.6.0 U1：走 createBadge 基类（.gr-badge 统一规格），样式差异收敛到 CSS；
  // base:'gr-badge'——推荐徽章在好评率组之外，不得带 gr-rating-badge 组标记
  //（否则先于评分渲染时污染防重复守卫/测试契约——铁律 12）
  const badge = createBadge(link, {
    text: `🎯 ${pct}%`,
    color,
    bg,
    cls: 'gr-rec-badge',
    base: 'gr-badge',
    title:
      `推荐度: ${pct}%` +
      `\n🖱 点击率: ${fmt(b.clickScore)} · ⬇ 下载率: ${fmt(b.downloadScore)}` +
      `\n🏷 关键词: ${fmt(b.keywordScore)} · ⭐ Steam: ${fmt(b.steamScore)}` +
      `\n⏱ 游玩时长: ${fmt(b.playTimeScore)} · 🔥 热度: ${fmt(b.heatScore)}` +
      `\n📊 销量: ${fmt(b.salesScore)} · 📝 评论数: ${fmt(b.reviewScore)}` +
      `\n各信号为 0-100% 加权贡献，权重总和 100%（超 1 自动归一）${reasonLine}`
  });
  badge.style.cursor = 'default';

  // v6.3.2 C3：不感兴趣按钮（推荐反馈循环）——点击标记负信号并淡化徽章
  const dislikeBtn = document.createElement('span');
  dislikeBtn.className = 'gr-dislike-btn';
  dislikeBtn.textContent = '✕';
  dislikeBtn.style.cssText = 'margin-left:4px;cursor:pointer;font-size:10px;opacity:0.6;';
  dislikeBtn.title = '不感兴趣';
  dislikeBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    badge.style.opacity = '0.3';
    badge.style.textDecoration = 'line-through';
    dislikeBtn.remove();
    try {
      window.__GR_MSG__.sendMessage({
        action: 'TRACK_EVENT',
        data: { type: 'dislike_game', gameName: item.name || '' }
      });
    } catch {
      /* 后台不可达时静默 */
    }
  });
  badge.appendChild(dislikeBtn);

  // 与 prependBadge 相同的定位逻辑；插到最后一个徽章之后
  let targetEl = item.titleEl || null;
  if (!targetEl && item.element) {
    targetEl = item.element.querySelector('h2, h3, h4, h5, .title, .entry-title, .name, .game-name, .game-title');
  }
  if (targetEl) {
    const lastBadge = [...targetEl.querySelectorAll('.gr-rating-badge, .gr-recent-badge, .gr-update-badge')].pop();
    if (lastBadge && lastBadge.nextSibling) {
      targetEl.insertBefore(badge, lastBadge.nextSibling);
    } else if (lastBadge) {
      targetEl.appendChild(badge);
    } else {
      targetEl.insertBefore(badge, targetEl.firstChild);
    }
  } else {
    link.insertBefore(badge, link.firstChild);
  }
}
