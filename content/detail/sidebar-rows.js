/**
 * 游戏雷达 Game Radar - 浮窗数据行填充 / Sidebar Row Fills
 *
 * v14.3.0（第五轮 B1）：由 sidebar.js 拆分——浮窗内异步数据行的填充逻辑：
 * ITAD 历史最低价行 + 收藏按钮（F1/F2，v12 B6 发售追踪）、Steam250 排名行
 * （浮窗 + 内嵌卡双挂点）。行锚点 id 由 detail-templates.steamSidebar 模板
 * 输出（gr-itad-row / gr-steam250-row / gr-steam250-inline）。
 * Async row fills inside the Steam float: ITAD lowest + favorite button,
 * Steam250 rank (float + inline-card mounts). Anchor ids come from the
 * steamSidebar template.
 */

/** @param {unknown} text */
/** @param {string} text */
const esc = (text) => (typeof globalThis.escapeHtml === 'function' ? globalThis.escapeHtml(text) : String(text ?? ''));

// v10.6.0：ITAD 最低价行 + 收藏按钮（F1/F2）
// ITAD：Key 未配置或查询失败 → 行隐藏；收藏：按钮切换 + 状态持久化
/**
 * @param {string} appId
 * @param {string} name
 * @param {string} releaseDate
 */
export async function fillItadAndFavorites(appId, name, releaseDate) {
  // v12 B6
  const itadEl = document.getElementById('gr-itad-row');
  // —— 收藏按钮（状态经 GET_FAVORITES 查询；点击 TOGGLE_FAVORITE）——
  // v12 B6：releaseDate 由调用方（renderAndShow → fillItadAndFavorites）传入
  if (itadEl) {
    const favRow = document.createElement('div');
    favRow.id = 'gr-fav-row-inner';
    favRow.style.marginTop = '4px';
    itadEl.parentNode.insertBefore(favRow, itadEl);
    const renderFav = (favorited) => {
      favRow.innerHTML = '';
      const btn = document.createElement('button');
      btn.textContent = favorited ? '★ 已收藏' : '☆ 收藏';
      btn.style.cssText = `padding:2px 10px;font-size:11px;cursor:pointer;border-radius:3px;border:1px solid ${favorited ? '#f1c40f' : '#666'};background:transparent;color:${favorited ? '#f1c40f' : '#aaa'}`;
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        try {
          const resp = await window.__GR_MSG__.sendMessage(
            {
              action: 'TOGGLE_FAVORITE',
              appId,
              name: name || '',
              releaseDate: releaseDate || '' // v12 B6：发售追踪
            },
            null,
            { timeout: 5000 }
          );
          if (resp && resp.favorited !== undefined) renderFav(resp.favorited);
        } catch {
          /* 后台不可达静默 */
        }
      });
      favRow.appendChild(btn);
    };
    try {
      const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_FAVORITES' }, null, { timeout: 5000 });
      const favs = (resp && resp.favorites) || {};
      renderFav(!!favs[appId]);
    } catch {
      favRow.style.display = 'none';
    }
  }
  // —— ITAD 最低价行（Key 未配置时后台返回 null → 行隐藏）——
  if (!itadEl) return;
  try {
    const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_ITAD_LOWEST', appId }, null, { timeout: 20000 });
    const info = resp && resp.info;
    if (!info || info.price === undefined || info.price === null) {
      itadEl.style.display = 'none';
      return;
    }
    const shop = info.shop ? ` @ ${esc(info.shop)}` : ''; // v10.9.1：shop 一并转义
    const price = Number(info.price); // v10.9.1：异型防 "NaN"
    if (!isFinite(price)) throw new Error('bad-price');
    itadEl.innerHTML = `💰 ITAD 历史最低: <b style="color:#67c1f5;">${price.toFixed(2)}</b>${shop} <a href="https://isthereanydeal.com" target="_blank" rel="noopener" style="color:#67c1f5;text-decoration:none;">ITAD ↗</a>`;
    itadEl.style.display = '';
  } catch {
    itadEl.style.display = 'none';
  }
}

// v10.4.4：Steam250 排名行填充（查询后台快照；游戏不在前 250 时隐藏）
/** @param {string} appId */
export async function fillSteam250Info(appId) {
  if (!appId) return;
  try {
    const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_STEAM250_RANK', appId }, null, { timeout: 25000 });
    const info = resp && resp.info;
    const html = info
      ? `🏆 Steam250 排名 <b style="color:#67c1f5;">#${info.rank ?? '-'}</b> · ${info.score ?? '-'} 分 · ${Number(info.votes || 0).toLocaleString()} 条评价 ` + // v10.9.1
        `<a href="https://steam250.com/top250" target="_blank" rel="noopener" style="color:#67c1f5;text-decoration:none;">Steam250 ↗</a>`
      : '';
    for (const id of ['gr-steam250-row', 'gr-steam250-inline']) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (html) {
        el.innerHTML = html;
        el.style.display = '';
      } else {
        el.style.display = 'none';
      }
    }
  } catch {
    /* 查询失败静默（行保持隐藏） */
  }
}
