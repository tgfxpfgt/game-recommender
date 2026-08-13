/**
 * Game Recommender - 列表页徽章渲染 / List-Page Badges
 *
 * v5.0.0：由 list-page.js 拆分——徽章创建/插入/三段式渲染/推荐徽章/
 * 高亮/DOM 移除。纯 DOM 无调度状态（prependBadge 的 settings 参数化）。
 * Badge rendering split from list-page.js (v5.0.0); pure DOM, no scheduler
 * state (prependBadge takes settings as a parameter).
 */
// 从 DOM 移除低好评率游戏项（含栅格容器，避免留空）
export function removeItemFromDom(item) {
    if (!item.element || !item.element.parentNode) return;
    const colContainer = item.element.closest('[class*="col-"]') || item.element.closest('li, article, .item, .post');
    const toRemove = colContainer && colContainer !== item.element ? colContainer : item.element;
    if (toRemove.parentNode) toRemove.remove();
}

// 创建单个徽章 span（统一样式；clickable 时点击跳转 Steam 详情页）
// Create one badge span (shared styling; clickable badges open the store)
/**
 * 创建徽章元素
 * @param {any} link
 * @param {{text: string, color: string, bg: string, cls: string, title: string, clickable?: boolean, appId?: any, dashed?: boolean}} opts
 */
export function createBadge(link, { text, color, bg, cls, title, clickable, appId, dashed }) {
    const badge = document.createElement('span');
    badge.className = cls || 'gr-rating-badge';
    badge.textContent = text;
    badge.style.cssText = `display:inline-block;margin-right:6px;padding:1px 6px;font-size:11px;font-weight:bold;color:${color};background:${bg};border:1px ${dashed ? 'dashed' : 'solid'} ${color};border-radius:3px;vertical-align:middle;${clickable ? 'cursor:pointer;text-decoration:none;' : ''}`;
    badge.title = title || '';
    // span+click 避免嵌套链接 / span + click to avoid nested anchors
    if (clickable && appId) {
      badge.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(`https://store.steampowered.com/app/${appId}/`, '_blank', 'noopener');
      });
    }
    return badge;
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
      const ref = firstTextNode && firstTextNode.textContent.trim().length > 1 ? firstTextNode : link.firstChild;
      for (let i = badges.length - 1; i >= 0; i--) link.insertBefore(badges[i], ref);
    }
}

// 在游戏标题前插入徽章（v3.3.6 三段式：近30天好评率 → 全部好评率 → 最近更新；
// 悬停显示评论数/发行日期；未找到/合集type/无评测保持单徽章；全部徽章可点击跳转）
// v3.3.8：徽章显示开关（badgeVisibility）——关闭某徽章仅跳过渲染，
// 后台数据获取不受影响；关闭"全部好评率"同时停用好评率过滤。
// v5.0.0：settings 参数化（此前读 ratingsJob 闭包）
export function prependBadge(item, rating, settings) {
    const link = item.link;
    if (!link) return;
    if (link.querySelector('.gr-rating-badge')) return; // 防重复 / no duplicates
    const bv = (settings && settings.badgeVisibility) || {};
    const showRecent = bv.recent !== false;
    const showAll = bv.all !== false;
    const showUpdate = bv.update !== false;

    const isNotFound = !rating || !rating.appId;
    const isTypeBadge = !isNotFound && rating.type && rating.type !== 'game' && rating.type !== 'demo';
    const rate = rating ? rating.positiveRate : null;

    const badges = [];
    if (isNotFound) {
      badges.push(
        createBadge(link, {
          text: '未找到',
          color: '#666',
          bg: 'rgba(102,102,102,0.08)',
          cls: 'gr-rating-badge gr-not-found',
          title: '未在 Steam 找到该游戏（搜索无匹配结果或查询失败）',
          dashed: true
        })
      );
    } else if (isTypeBadge) {
      badges.push(
        createBadge(link, {
          text: rating.type,
          color: '#b48ce0',
          bg: 'rgba(180,140,224,0.12)',
          cls: 'gr-rating-badge gr-type-badge',
          title: `Steam 条目类型: ${rating.type}（合集/非单个游戏本体，无法获取本体 AppID）`
        })
      );
    } else if (rate === null || rate === undefined) {
      badges.push(
        createBadge(link, {
          text: rating.appId ? `#${rating.appId}` : '暂无',
          color: '#8f98a0',
          bg: 'rgba(143,152,160,0.15)',
          cls: 'gr-rating-badge',
          title: rating.failed
            ? `Steam 已匹配 (AppID ${rating.appId})，好评率获取失败（网络/限流），下次访问自动重试`
            : `Steam 已匹配 (AppID ${rating.appId})，暂无评测\n点击跳转 Steam 详情页`,
          clickable: true,
          appId: rating.appId
        })
      );
    } else {
      // 段1：近 30 天好评率（浅蓝固定色；无近期评测 → 灰 —）
      if (showRecent) {
        const recentRate = rating.recentPositiveRate;
        const recentTotal = rating.recentTotalReviews || 0;
        if (recentRate === null || recentRate === undefined) {
          badges.push(
            createBadge(link, {
              text: '—',
              color: '#8f98a0',
              bg: 'rgba(143,152,160,0.1)',
              cls: 'gr-rating-badge gr-recent-badge',
              title: '近30天暂无评测'
            })
          );
        } else {
          badges.push(
            createBadge(link, {
              text: `${recentRate}%`,
              color: '#66c0f4',
              bg: 'rgba(102,192,244,0.12)',
              cls: 'gr-rating-badge gr-recent-badge',
              title: `最近30天好评率: ${recentRate}% · ${recentTotal.toLocaleString()} 条评测`
            })
          );
        }
      }
      // 段2：全部好评率（分级色，可点击跳转；v3.4.0 颜色单源 shared/patterns.js）
      if (showAll) {
        const P = globalThis.__GR_PATTERNS__ || {};
        const color = P.ratingColorFor
          ? P.ratingColorFor(rate)
          : rate >= 80
            ? '#66c0f4'
            : rate >= 60
              ? '#a3cf06'
              : '#ff7b00';
        const bg = P.ratingBgFor
          ? P.ratingBgFor(rate)
          : rate >= 80
            ? 'rgba(102,192,244,0.15)'
            : rate >= 60
              ? 'rgba(163,207,6,0.15)'
              : 'rgba(255,123,0,0.15)';
        badges.push(
          createBadge(link, {
            text: `${rate}%`,
            color,
            bg,
            cls: 'gr-rating-badge',
            title: `全部好评率: ${rate}%${rating.ratingDesc ? ' (' + rating.ratingDesc + ')' : ''} · ${(rating.totalReviews || 0).toLocaleString()} 条评测\n点击跳转 Steam 详情页`,
            clickable: true,
            appId: rating.appId
          })
        );
      }
      // 段3：最近更新日期（悬停显示发行日期；无数据 → 灰 —，列表页独立获取）
      if (showUpdate) {
        const update = rating.lastUpdate || '';
        if (update) {
          badges.push(
            createBadge(link, {
              text: `🛠 ${update.length >= 10 ? update.slice(5) : update}`,
              color: '#8f98a0',
              bg: 'rgba(143,152,160,0.1)',
              cls: 'gr-rating-badge gr-update-badge',
              title: `最近更新: ${update}${rating.releaseDate ? ' · 发行: ' + rating.releaseDate : ''}`
            })
          );
        } else {
          badges.push(
            createBadge(link, {
              text: '—',
              color: '#8f98a0',
              bg: 'rgba(143,152,160,0.1)',
              cls: 'gr-rating-badge gr-update-badge',
              title: '最近更新获取中...'
            })
          );
        }
      }
    }
    if (badges.length > 0) insertBadges(item, link, badges);
}

// 推荐值徽章：好评率徽章之后插入，显示推荐数值；悬停展示各分值组成；
// 按推荐值分级着色（≥80% 红 / ≥60% 橙 / ≥40% 黄绿 / 其余灰）。
// v3.3.8：插入到**最后一个**好评率/更新徽章之后（此前插到第一个 rating 徽章
// 后，三段式下顺序错乱）；受 badgeVisibility.rec 开关控制（关闭同时停用高亮）。
// Recommendation badge (after the rating badges): shows the score, tooltip with
// the breakdown, and a score-graded color. Inserted after the LAST rating badge
// (the old nextSibling logic broke ordering with three badges).
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
    const badge = document.createElement('span');
    badge.className = 'gr-rec-badge';
    badge.textContent = `🎯 ${pct}%`;
    badge.style.cssText = `display:inline-block;margin-right:6px;padding:1px 6px;font-size:11px;font-weight:bold;color:${color};background:${bg};border:1px solid ${color};border-radius:3px;vertical-align:middle;cursor:default;`;
    badge.title = `推荐度: ${pct}%\n点击率: ${fmt(b.clickScore)} · 下载率: ${fmt(b.downloadScore)}\n关键词: ${fmt(b.keywordMatch)} · Steam: ${fmt(b.steamRating)}`;

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
        chrome.runtime.sendMessage({
          action: 'TRACK_EVENT',
          data: { type: 'dislike_game', gameName: item.name || '' }
        });
      } catch (e) {
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
    } else if (!link.querySelector('.gr-rec-badge')) {
      link.insertBefore(badge, link.firstChild);
    }
}

export function highlightItem(item) {
    const el = item.element;
    el.classList.add('gr-highlighted');
}

