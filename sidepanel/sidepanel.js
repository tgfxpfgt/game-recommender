/**
 * 游戏雷达 Game Radar - SidePanel 侧栏页 / Side Panel Page
 *
 * v14.1.0（第二轮 B9 补完）：chrome.sidePanel（Chrome 114+）承载 dashboard
 * 精简版——当前页游戏（随 tab 联动，数据源 background/core/tab-game.js 快照）
 * + 收藏清单 + 限免速览。经典脚本（无构建体系），消息统一走 __GR_MSG__。
 * Compact side-panel dashboard: current-tab game (mirrored from the per-tab
 * snapshot), favorites and free-game digest. Classic script, no bundler.
 */
'use strict';

(function () {
  const send = (msg) => window.__GR_MSG__.sendMessage(msg);

  // ============ 主题 ============
  (async () => {
    try {
      const r = await send({ action: 'GET_SETTINGS' });
      const s = r && r.settings;
      if (s && globalThis.__GR_SETTINGS_UTILS__ && globalThis.__GR_SETTINGS_UTILS__.applyPageTheme) {
        globalThis.__GR_SETTINGS_UTILS__.applyPageTheme(s);
      }
    } catch {
      /* 主题失败不影响功能 */
    }
  })();

  const esc = (t) =>
    typeof globalThis.escapeHtml === 'function' ? globalThis.escapeHtml(String(t ?? '')) : String(t ?? '');
  const escA = (t) =>
    typeof globalThis.escapeAttr === 'function' ? globalThis.escapeAttr(String(t ?? '')) : String(t ?? '');

  // ============ 当前页游戏（随 tab 联动） ============
  async function refreshCurrentGame() {
    const body = document.getElementById('spGameBody');
    if (!body) return;
    let tabId = null;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab && tab.id;
    } catch {
      /* tabs 权限异常时静默 */
    }
    if (tabId == null) {
      body.innerHTML = '<div class="empty">无法获取当前标签页</div>';
      return;
    }
    try {
      const resp = await send({ action: 'GET_TAB_GAME', tabId });
      const g = resp && resp.game;
      if (!g || !g.appId) {
        body.innerHTML = '<div class="empty">在下载站或 Steam 页面打开游戏详情后自动显示</div>';
        return;
      }
      const fav = await send({ action: 'GET_FAVORITES' }).catch(() => null);
      const favs = (fav && fav.favorites) || {};
      const isFav = !!favs[String(g.appId)];
      const rate = g.positiveRate != null ? ` · 好评率 ${g.positiveRate}%` : '';
      body.innerHTML = `
        <div class="sp-game">
          ${g.headerImage ? `<img src="${escA(g.headerImage)}" alt=""/>` : ''}
          <div style="min-width:0;">
            <div class="g-name">${esc(g.name)}</div>
            <div class="g-meta">AppID ${esc(g.appId)}${rate}</div>
          </div>
        </div>
        <div class="sp-row">
          <a href="https://store.steampowered.com/app/${escA(g.appId)}/" target="_blank" rel="noopener">Steam 商店 ↗</a>
          <span style="flex:1;"></span>
        </div>
        <button id="spFavToggle" class="sp-btn${isFav ? ' is-fav' : ''}">${isFav ? '⭐ 已收藏（点击取消）' : '☆ 收藏此游戏'}</button>
      `;
      document.getElementById('spFavToggle').addEventListener('click', async () => {
        try {
          await send({ action: 'TOGGLE_FAVORITE', appId: String(g.appId), name: g.name || '' });
          refreshCurrentGame().catch(() => {});
          refreshFavorites().catch(() => {});
        } catch {
          /* 静默 */
        }
      });
    } catch (e) {
      console.warn('[SidePanel] 当前页游戏渲染失败:', e);
      body.innerHTML = '<div class="empty">加载失败</div>';
    }
  }

  // tab 切换/导航联动（验收：侧边栏随当前 tab 联动显示对应游戏信息）
  try {
    chrome.tabs.onActivated.addListener(() => refreshCurrentGame().catch(() => {}));
    chrome.tabs.onUpdated.addListener((tabId, info) => {
      if (info.status === 'complete' || info.url) refreshCurrentGame().catch(() => {});
    });
  } catch {
    /* 旧 Chrome 无 tabs 事件时降级为仅初始读取 */
  }

  // ============ 收藏 ============
  async function refreshFavorites() {
    const el = document.getElementById('spFavBody');
    if (!el) return;
    try {
      const resp = await send({ action: 'GET_FAVORITES' });
      const favs = (resp && resp.favorites) || {};
      const entries = Object.entries(favs).sort(
        (a, b) => ((b[1] && b[1].addedAt) || 0) - ((a[1] && a[1].addedAt) || 0)
      );
      if (entries.length === 0) {
        el.textContent = '暂无收藏（详情浮窗点 ☆ 收藏）';
        return;
      }
      el.innerHTML = entries
        .slice(0, 20)
        .map(
          ([appId, f]) => `
        <div class="sp-row" data-appid="${escA(appId)}">
          <span class="n">⭐ ${esc((f && f.name) || appId)}</span>
          <a href="https://store.steampowered.com/app/${escA(appId)}/" target="_blank" rel="noopener">↗</a>
          <button class="rm" title="移除收藏">✕</button>
        </div>`
        )
        .join('');
      el.querySelectorAll('.rm').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const row = btn.closest('.sp-row');
          try {
            await send({ action: 'TOGGLE_FAVORITE', appId: String(row.dataset.appid), name: '' });
            refreshFavorites().catch(() => {});
            refreshCurrentGame().catch(() => {});
          } catch {
            /* 静默 */
          }
        });
      });
    } catch (e) {
      console.warn('[SidePanel] 收藏渲染失败:', e);
      el.textContent = '加载失败';
    }
  }

  // ============ 限免速览 ============
  async function refreshFreeGames() {
    const el = document.getElementById('spFreeBody');
    if (!el) return;
    try {
      const resp = await send({ action: 'GET_FREE_GAMES' });
      const freeData = (resp && resp.data) || {};
      const games = Array.isArray(freeData.games) ? freeData.games : []; // v10.9 同款异型守卫
      const active = games.slice(0, 5);
      if (active.length === 0) {
        el.textContent = '当前没有限免信息';
        return;
      }
      el.innerHTML = active
        .map((g) => {
          const store = String(g.platformName || g.platform || '').slice(0, 12);
          return `<div class="sp-free"><span class="tag">[${esc(store)}]</span><b>${esc(g.title)}</b>${
            g.url ? `<a href="${escA(g.url)}" target="_blank" rel="noopener">领取 ↗</a>` : ''
          }</div>`;
        })
        .join('');
    } catch (e) {
      console.warn('[SidePanel] 限免渲染失败:', e);
      el.textContent = '加载失败';
    }
  }

  refreshCurrentGame().catch(() => {});
  refreshFavorites().catch(() => {});
  refreshFreeGames().catch(() => {});
})();
