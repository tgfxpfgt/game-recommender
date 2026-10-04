/* global cachedGameList renderGameTable */
/* eslint-disable no-unused-vars */
/**
 * 游戏雷达 Game Radar - Dashboard 洞察模块 / Dashboard Insights Module
 *
 * v14 B1：由 dashboard.js 拆分——标签偏好云、推荐反馈信号、收藏清单、
 * Steam 标签推荐、跨缓存游戏搜索。
 * Split from dashboard.js (B1): tag cloud, feedback signals, favorites,
 * Steam tag recommendations, cross-cache game search.
 *
 * 依赖：dash-stats.js 的 cachedGameList / renderGameTable（标签点击 → 过滤游戏表，
 * 经典脚本跨文件全局作用域，事件期调用——脚本全部加载后）。
 * 共享状态：activeTagFilter（本文件写，dash-stats.js renderGameTable 读）。
 * CSV/JSON 导出函数在 dash-export.js（本文件不含）。
 */

// 标签偏好云：按权重分级着色与字号 / Tag cloud: color/size graded by weight
let activeTagFilter = null; // v11.0 B7：tag 聚合过滤（点击标签云 → 过滤游戏表）

function renderTagCloud(keywords) {
  const container = document.getElementById('tagCloud');
  if (!keywords || keywords.length === 0) {
    container.innerHTML = '<span class="no-data">暂无数据，请先浏览游戏网站让插件学习您的偏好</span>';
    return;
  }

  container.innerHTML = keywords
    .map((kw) => {
      const weight = Number(kw.weight) || 0; // v10.9：异型权重防 NaN 字号
      const level = weight >= 0.6 ? 'high' : weight >= 0.3 ? 'medium' : 'low';
      const size = Math.max(12, Math.min(20, 12 + weight * 10));
      // v11.0 B7：标签可点击 → 聚合过滤游戏表（与游戏表标签闭环）
      return `<span class="tag-item ${level}" data-tag="${escapeHtml(kw.keyword)}" style="font-size:${size}px;cursor:pointer;${activeTagFilter === kw.keyword ? 'outline:2px solid #67c1f5;' : ''}" title="匹配度: ${Math.round(weight * 100)}% — 点击筛选该类游戏">
      ${escapeHtml(kw.keyword)} <small>${Math.round(weight * 100)}%</small>
    </span>`;
    })
    .join('');

  container.querySelectorAll('.tag-item').forEach((el) => {
    el.addEventListener('click', () => {
      const tag = el.dataset.tag;
      activeTagFilter = activeTagFilter === tag ? null : tag; // 再点取消
      renderGameTable(cachedGameList);
      renderTagCloud(keywords);
    });
  });
}

// v10.0.0：推荐反馈信号渲染（dislike 闭环 / top 下载）
function renderFeedback(feedback) {
  const summaryEl = document.getElementById('feedbackSummary');
  const listEl = document.getElementById('feedbackLists');
  if (!summaryEl || !listEl) return;
  const fb = feedback || {};
  const hasData = (fb.gameCount || 0) > 0 || (fb.dislikeTotal || 0) > 0;
  if (!hasData) {
    summaryEl.textContent = '暂无数据';
    listEl.innerHTML = '';
    return;
  }
  summaryEl.textContent = `负反馈（不感兴趣）${fb.dislikeTotal || 0} 次 · 覆盖 ${fb.gameCount || 0} 款游戏`;
  const esc = (t) => escapeHtml(String(t || ''));
  const renderList = (title, items, key) =>
    items && items.length > 0
      ? `<div style="margin-top:4px;"><b>${title}</b>${items
          .map((g) => `<span class="gr-pill" style="margin-left:6px;">${esc(g.name)} · ${g[key]}</span>`)
          .join('')}</div>`
      : '';
  listEl.innerHTML =
    renderList('👎 负反馈最多：', fb.topDisliked, 'dislikes') +
    renderList('⬇️ 下载最多：', fb.topDownloaded, 'downloads');
}

// v10.6.0 F2：收藏清单渲染（移除按钮 + Steam 外链）
async function loadFavorites() {
  const el = document.getElementById('favList');
  if (!el) return;
  try {
    const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_FAVORITES' });
    const favs = (resp && resp.favorites) || {};
    const entries = Object.entries(favs).sort(
      (a, b) => ((b[1] && b[1].addedAt) || 0) - ((a[1] && a[1].addedAt) || 0) // v10.9：null 值守卫
    );
    if (entries.length === 0) {
      el.textContent = '暂无收藏（在游戏详情浮窗点 ☆ 收藏）';
      return;
    }
    // v13 B5：发售状态三分组——排序按组优先级（即将发售 > 已公布 > 已发售 > 未公布），
    // 渲染时组切换处插组头
    const groupPrio = (info) => {
      const rd = Date.parse((info && info.releaseDate) || '');
      if (isNaN(rd)) return 3;
      if (rd <= Date.now()) return 2;
      return rd - Date.now() <= 30 * 86400000 ? 0 : 1;
    };
    const groupLabel = ['🚀 即将发售（30 天内）', '📅 已公布发售日', '✅ 已发售', '❓ 未公布/未识别'];
    entries.sort(
      (a, b) => groupPrio(a[1]) - groupPrio(b[1]) || ((b[1] && b[1].addedAt) || 0) - ((a[1] && a[1].addedAt) || 0)
    );
    let lastGroupPrio = -1;
    el.innerHTML = entries
      .map(([appId, f]) => {
        const esc2 = (t) => escapeHtml(String(t || ''));
        const prio = groupPrio(f);
        const groupHead =
          prio !== lastGroupPrio
            ? `<div style="font-size:11px;color:#8f98a0;margin-top:6px;">${groupLabel[prio]}</div>`
            : '';
        lastGroupPrio = prio;
        return (
          groupHead +
          `<div class="fav-row" data-appid="${escapeAttr(String(appId))}" style="display:flex;align-items:center;gap:8px;margin-top:3px;">
          <span style="flex:1;">⭐ ${esc2(f.name)} <small style="color:#8f98a0;">(${esc2(String(appId))})</small></span>
          <a href="https://store.steampowered.com/app/${escapeAttr(String(appId))}/" target="_blank" rel="noopener" style="color:#67c1f5;text-decoration:none;font-size:11px;">Steam ↗</a>
          <button class="gr-btn gr-btn-sm fav-remove" style="padding:1px 8px;">移除</button>
        </div>`
        );
      })
      .join('');
    el.querySelectorAll('.fav-remove').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const appId2 = btn.closest('.fav-row').dataset.appid;
        await window.__GR_MSG__.sendMessage({ action: 'TOGGLE_FAVORITE', appId: appId2, name: '' });
        loadFavorites().catch(() => {});
      });
    });
    // v14.1.0（第一轮 B3 补完）：收藏价格列——现价/历史最低/折扣率。
    // GET_FAVORITE_PRICES 复用 ITAD 两处 TTL 缓存（暖会话零请求）；未配置
    // ITAD Key 时显示引导文案（后台 configured:false，不发任何请求）。
    try {
      const pr = await window.__GR_MSG__.sendMessage({ action: 'GET_FAVORITE_PRICES' });
      if (!pr || pr.configured === false) {
        const note = document.createElement('div');
        note.style.cssText = 'font-size:11px;color:#8f98a0;margin-top:6px;';
        note.textContent = '💰 在设置中配置 ITAD API Key 后，此处显示现价/历史最低/折扣率';
        el.appendChild(note);
      } else {
        const prices = pr.prices || {};
        el.querySelectorAll('.fav-row').forEach((row) => {
          const p = prices[row.dataset.appid];
          if (!p) return;
          const span = document.createElement('span');
          span.style.cssText = 'font-size:11px;color:#8f98a0;white-space:nowrap;';
          if (p.current != null && p.lowest != null && p.lowest > 0) {
            const off = Math.round((1 - p.current / p.lowest) * 100);
            const offTxt = off >= 5 ? ` · <span style="color:#a3cf06;">-${off}%</span>` : '';
            span.innerHTML = `💰 ${Number(p.current).toFixed(2)}（最低 ${Number(p.lowest).toFixed(2)}${offTxt}）`;
            if (p.shop) span.title = `历史最低商店：${String(p.shop)}`;
          } else if (p.lowest != null) {
            span.textContent = `💰 历史最低 ${Number(p.lowest).toFixed(2)}`;
          } else {
            span.textContent = '💰 暂无价格数据';
          }
          row.insertBefore(span, row.querySelector('.fav-remove'));
        });
      }
    } catch {
      /* 价格获取失败静默——收藏列表本身不受影响 */
    }
  } catch {
    el.textContent = '加载失败';
  }
}

// 基于用户偏好标签向 Steam 搜索推荐游戏
// Recommend games on Steam based on the user's preferred tags
async function loadSteamRecommendations() {
  const section = document.getElementById('steamRecSection');
  const listEl = document.getElementById('steamRecList');
  const basedOnEl = document.getElementById('recBasedOn');

  section.style.display = 'block';
  listEl.innerHTML = '<span class="no-data">正在获取Steam推荐...</span>';
  basedOnEl.textContent = '';

  try {
    const response = await window.__GR_MSG__.sendMessage({ action: 'GET_STEAM_RECOMMENDATIONS' });

    if (response && response.error) {
      listEl.innerHTML = `<span class="no-data">${escapeHtml(response.error)}</span>`;
      return;
    }

    if (response.error) {
      listEl.innerHTML = `<span class="no-data">${escapeHtml(response.error)}</span>`;
      return;
    }

    if (response.basedOnTags) {
      basedOnEl.textContent = `基于您偏好的Steam标签: ${response.basedOnTags.join('、')}`;
    }

    if (!response.games || response.games.length === 0) {
      listEl.innerHTML = '<span class="no-data">未找到匹配的Steam游戏</span>';
      return;
    }

    listEl.innerHTML = response.games
      .map(
        (game) => `
      <div class="rec-card">
        ${game.image ? `<img class="rec-card-img" src="${escapeAttr(game.image)}" alt="${escapeHtml(game.name)}"/>` : ''}
        <div class="rec-card-body">
          <div class="rec-card-title">${escapeHtml(game.name)}</div>
          <div class="rec-card-meta">
            ${game.price ? `💰 ${escapeHtml(game.price)}` : ''}
            ${game.reviewSummary ? ` | ${escapeHtml(game.reviewSummary)}` : ''}
          </div>
          <div class="rec-card-tags">
            ${(game.matchTags || []).map((t) => `<span>${escapeHtml(t)}</span>`).join('')}
          </div>
          <a href="${escapeAttr(game.url)}" target="_blank">🔗 在Steam查看</a>
        </div>
      </div>
    `
      )
      .join('');

    // 图片加载失败时隐藏（addEventListener 替代内联 onerror，规避扩展页 CSP）
    // Hide images that fail to load (addEventListener instead of inline onerror for CSP)
    listEl.querySelectorAll('.rec-card-img').forEach((img) => {
      img.addEventListener('error', () => {
        img.style.display = 'none';
      });
    });

    // 滚动到推荐区域
    section.scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    listEl.innerHTML = `<span class="no-data">获取推荐失败: ${escapeHtml(window.__GR_MSG__.toUserMessage(e))}</span>`;
  }
}
// （escapeHtml/escapeAttr 由 shared/escape.js 提供全局实现）
// (escapeHtml/escapeAttr come from shared/escape.js)

// v10.6.0 F3：跨缓存游戏搜索
async function runGameSearch() {
  const input = document.getElementById('gameSearchInput');
  const out = document.getElementById('gameSearchResults');
  if (!input || !out) return;
  const q = input.value.trim().slice(0, 100); // v10.9：契约上限 100 字符（超长不再误导"无匹配"）
  if (q.length < 2) {
    out.textContent = '请输入至少 2 个字符';
    return;
  }
  out.textContent = '搜索中...';
  try {
    const resp = await window.__GR_MSG__.sendMessage({ action: 'SEARCH_CACHED_GAMES', query: q });
    const results = (resp && resp.results) || [];
    if (results.length === 0) {
      out.textContent = '无匹配游戏（仅搜索已缓存的游戏）';
      return;
    }
    const esc2 = (t) => escapeHtml(String(t || ''));
    out.innerHTML = results
      .map((g) => {
        const s250 = g.steam250 ? ` · Steam250 #${g.steam250.rank ?? '-'}（${g.steam250.score ?? '-'} 分）` : ''; // v10.9.1
        const rate = g.positiveRate != null ? ` · 好评率 ${g.positiveRate}%` : '';
        const fav = g.favorited ? ' ⭐' : '';
        return `<div style="margin-top:3px;"><a href="https://store.steampowered.com/app/${escapeAttr(String(g.appId))}/" target="_blank" rel="noopener" style="color:#67c1f5;text-decoration:none;">${esc2(g.name)}</a>${fav}${rate}${s250}</div>`;
      })
      .join('');
  } catch (e) {
    out.textContent = '搜索失败: ' + escapeHtml(window.__GR_MSG__.toUserMessage(e));
  }
}

// v10.6.0 F3：游戏搜索框绑定（幂等）
function bindGameSearch() {
  const btn = document.getElementById('gameSearchBtn');
  const input = document.getElementById('gameSearchInput');
  if (!btn || !input || btn.dataset.grBound) return;
  btn.dataset.grBound = '1';
  btn.addEventListener('click', runGameSearch);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runGameSearch();
  });
}
