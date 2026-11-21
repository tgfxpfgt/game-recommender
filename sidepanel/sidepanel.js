/**
 * 游戏雷达 Game Radar - SidePanel 侧栏页 / Side Panel Page
 *
 * v14.1.0（第二轮 B9 补完）：chrome.sidePanel（Chrome 114+）承载 dashboard
 * 精简版——当前页游戏（随 tab 联动，数据源 background/core/tab-game.js 快照）
 * + 收藏清单 + 限免速览。经典脚本（无构建体系），消息统一走 __GR_MSG__。
 * Compact side-panel dashboard: current-tab game (mirrored from the per-tab
 * snapshot), favorites and free-game digest. Classic script, no bundler.
 * v15 阶段 3 全量迁移：渲染面 Preact h()（innerHTML 6 处退役——文本插值
 * 天然转义；收藏移除/收藏切换 onClick prop 直连）。
 */
'use strict';

(function () {
  /** @param {any} msg */
  const send = (msg) => /** @type {any} */ (window).__GR_MSG__.sendMessage(msg);

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

  // v14.3.2：设置变更实时跟随（后台 saveSettings 广播 GR_SETTINGS_CHANGED）——
  // 用户在设置中心切主题，已打开的侧栏即时变色，无需重开。
  // Live-follow settings changes (background broadcast on save): an open panel
  // re-applies the theme without being reopened.
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.type !== 'GR_SETTINGS_CHANGED') return;
      send({ action: 'GET_SETTINGS' })
        .then((/** @type {any} */ r) => {
          const s = r && r.settings;
          if (s && globalThis.__GR_SETTINGS_UTILS__) globalThis.__GR_SETTINGS_UTILS__.applyPageTheme(s);
        })
        .catch(() => {});
    });
  } catch {
    /* 无 onMessage 环境时静默 */
  }

  // v15 阶段 3：Preact 垫片惰性访问器（本脚本加载序在 preact-globals 之后——
  // 直取即可；保留访问器形态便于测试环境缺垫片时提前失败）
  /** @returns {{h: Function, render: Function, Fragment: any}} */
  const P = () => /** @type {any} */ (globalThis).__GR_PREACT__;

  // ============ 当前页游戏（随 tab 联动） ============
  async function refreshCurrentGame() {
    const body = document.getElementById('spGameBody');
    if (!body) return;
    const PP = P();
    let tabId = null;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab && tab.id;
    } catch {
      /* tabs 权限异常时静默 */
    }
    if (tabId == null) {
      PP.render(PP.h('div', { class: 'empty' }, '无法获取当前标签页'), body);
      return;
    }
    try {
      const resp = await send({ action: 'GET_TAB_GAME', tabId });
      const g = resp && resp.game;
      if (!g || !g.appId) {
        PP.render(PP.h('div', { class: 'empty' }, '在下载站或 Steam 页面打开游戏详情后自动显示'), body);
        return;
      }
      const fav = await send({ action: 'GET_FAVORITES' }).catch(() => /** @type {null} */ (null));
      const favs = (fav && fav.favorites) || {};
      const isFav = !!favs[String(g.appId)];
      const rate = g.positiveRate != null ? ` · 好评率 ${g.positiveRate}%` : '';
      PP.render(
        PP.h(
          PP.Fragment,
          null,
          PP.h(
            'div',
            { class: 'sp-game' },
            g.headerImage ? PP.h('img', { src: String(g.headerImage), alt: '' }) : null,
            PP.h(
              'div',
              { style: 'min-width:0;' },
              PP.h('div', { class: 'g-name' }, String(g.name)),
              PP.h('div', { class: 'g-meta' }, `AppID ${g.appId}${rate}`)
            )
          ),
          PP.h(
            'div',
            { class: 'sp-row' },
            PP.h(
              'a',
              {
                href: 'https://store.steampowered.com/app/' + String(g.appId) + '/',
                target: '_blank',
                rel: 'noopener'
              },
              'Steam 商店 ↗'
            ),
            PP.h('span', { style: 'flex:1;' })
          ),
          PP.h(
            'button',
            {
              id: 'spFavToggle',
              class: 'sp-btn' + (isFav ? ' is-fav' : ''),
              onClick: async () => {
                try {
                  await send({ action: 'TOGGLE_FAVORITE', appId: String(g.appId), name: g.name || '' });
                  refreshCurrentGame().catch(() => {});
                  refreshFavorites().catch(() => {});
                } catch {
                  /* 静默 */
                }
              }
            },
            isFav ? '⭐ 已收藏（点击取消）' : '☆ 收藏此游戏'
          )
        ),
        body
      );
      const settingsBtn = document.getElementById('spOpenSettings');
      if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
          // v14.8 批次 13（第九轮 B8）：设置中心入口（settings-utils goHub 单点）
          const utils = globalThis.__GR_SETTINGS_UTILS__;
          if (utils && utils.goHub) utils.goHub('options');
        });
      }
    } catch (e) {
      console.warn('[SidePanel] 当前页游戏渲染失败:', e);
      PP.render(PP.h('div', { class: 'empty' }, '加载失败'), body);
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
    const PP = P();
    try {
      const resp = await send({ action: 'GET_FAVORITES' });
      const favs = (resp && resp.favorites) || {};
      const entries = Object.entries(favs).sort(
        (/** @type {any} */ a, /** @type {any} */ b) => ((b[1] && b[1].addedAt) || 0) - ((a[1] && a[1].addedAt) || 0)
      );
      if (entries.length === 0) {
        el.textContent = '暂无收藏（详情浮窗点 ☆ 收藏）';
        return;
      }
      PP.render(
        PP.h(
          PP.Fragment,
          null,
          entries.slice(0, 20).map(([appId, f]) =>
            PP.h(
              'div',
              { class: 'sp-row', 'data-appid': String(appId), key: String(appId) },
              PP.h('span', { class: 'n' }, '⭐ ' + ((f && f.name) || appId)),
              PP.h(
                'a',
                {
                  href: 'https://store.steampowered.com/app/' + String(appId) + '/',
                  target: '_blank',
                  rel: 'noopener'
                },
                '↗'
              ),
              PP.h(
                'button',
                {
                  class: 'rm',
                  title: '移除收藏',
                  onClick: async () => {
                    try {
                      await send({ action: 'TOGGLE_FAVORITE', appId: String(appId), name: '' });
                      refreshFavorites().catch(() => {});
                      refreshCurrentGame().catch(() => {});
                    } catch {
                      /* 静默 */
                    }
                  }
                },
                '✕'
              )
            )
          )
        ),
        el
      );
    } catch (e) {
      console.warn('[SidePanel] 收藏渲染失败:', e);
      el.textContent = '加载失败';
    }
  }

  // ============ 限免速览 ============
  async function refreshFreeGames() {
    const el = document.getElementById('spFreeBody');
    if (!el) return;
    const PP = P();
    try {
      const resp = await send({ action: 'GET_FREE_GAMES' });
      const freeData = (resp && resp.data) || {};
      const games = Array.isArray(freeData.games) ? freeData.games : []; // v10.9 同款异型守卫
      const active = games.slice(0, 5);
      if (active.length === 0) {
        el.textContent = '当前没有限免信息';
        return;
      }
      PP.render(
        PP.h(
          PP.Fragment,
          null,
          active.map((/** @type {any} */ g, /** @type {number} */ i) => {
            const store = String(g.platformName || g.platform || '').slice(0, 12);
            return PP.h(
              'div',
              { class: 'sp-free', key: String(g.url || i) },
              PP.h('span', { class: 'tag' }, '[' + store + ']'),
              PP.h('b', null, String(g.title)),
              g.url ? PP.h('a', { href: String(g.url), target: '_blank', rel: 'noopener' }, '领取 ↗') : null
            );
          })
        ),
        el
      );
    } catch (e) {
      console.warn('[SidePanel] 限免渲染失败:', e);
      el.textContent = '加载失败';
    }
  }

  refreshCurrentGame().catch(() => {});
  refreshFavorites().catch(() => {});
  refreshFreeGames().catch(() => {});
})();
