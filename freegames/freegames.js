/**
 * 游戏雷达 Game Radar - Free Games Script
 * 限免游戏页面逻辑 / Free-games page logic
 *
 * Features:
 * - Load free games from background (Epic/Steam/GOG/GamerPower)
 * - Platform filter (all / epic / steam / gog / other)
 * - Claim-type filter (official direct vs third-party)
 * - Claim buttons stay clickable after claiming (re-open allowed)
 *
 * 功能：
 * - 从后台加载限免游戏（Epic/Steam/GOG/GamerPower）
 * - 平台筛选（全部 / Epic / Steam / GOG / 其他）
 * - 领取方式筛选（官方直领 vs 第三方）
 * - 领取后按钮仍可点击（支持再次打开）
 */

/** @type {any[]} */
let allGames = [];
let currentFilter = 'all';
let currentClaimFilter = 'all';

document.addEventListener('DOMContentLoaded', () => {
  // v6.4.19：应用皮肤主题
  (async () => {
    try {
      // v10.7.0 批次5：消息封装统一走 shared/msg.js（__GR_MSG__，自带超时）
      const r = await window.__GR_MSG__.sendMessage({ action: 'GET_SETTINGS' });
      const s = r && r.settings;
      if (s && globalThis.__GR_SETTINGS_UTILS__) {
        const u = globalThis.__GR_SETTINGS_UTILS__;
        if (u.applyPageTheme) u.applyPageTheme(s);
        else if (u.applyThemeAuto) u.applyThemeAuto(s); // 旧入口兜底
      }
    } catch {}
  })();
  loadFreeGames();

  // v6.4.11：返回设置中心（hub 内切面板 / 独立打开新标签）
  const hubBtn = document.getElementById('hubBtn');
  if (hubBtn) {
    hubBtn.addEventListener('click', () => {
      const utils = globalThis.__GR_SETTINGS_UTILS__;
      if (utils && utils.goHub) utils.goHub('freegames');
    });
  }

  document.getElementById('refreshBtn').addEventListener('click', () => {
    loadFreeGames(true);
  });

  // v14.16.0 N7：导出 .ics 日历——进行中的限免生成 VEVENT（截止前 24h 提醒窗），
  // 系统日历订阅后到期自动提醒；零网络（数据来自已加载的限免缓存）。
  // Export .ics: in-progress giveaways become VEVENTs with a 24h reminder window.
  document.getElementById('icalBtn').addEventListener('click', () => {
    const ical = /** @type {any} */ (globalThis).__GR_ICAL__;
    if (!ical || !Array.isArray(allGames) || allGames.length === 0) {
      alert('暂无限免数据可导出');
      return;
    }
    const text = ical.buildIcal(allGames, new Date());
    const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `game-radar-freegames-${new Date().toISOString().slice(0, 10)}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // 平台筛选 / Platform filter
  document.querySelectorAll('.filter-btn').forEach((/** @type {any} */ btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach((/** @type {any} */ b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.platform;
      renderGames();
    });
  });

  // 领取方式筛选 / Claim-type filter
  document.querySelectorAll('.claim-btn-filter').forEach((/** @type {any} */ btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.claim-btn-filter').forEach((/** @type {any} */ b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentClaimFilter = btn.dataset.claim;
      renderGames();
    });
  });
});

// v14.8 批次 7（第九轮 B2）：当月限免月历——起点日（首次监控到）/截止日
// （领取截止）标记，hover 显示游戏名。纯前端从已存 games 推导，零新请求。
// Current-month calendar: first-seen and deadline day markers.
/** @param {any[]} games */
function renderFreeGamesCalendar(games) {
  const host = document.getElementById('freegamesCalendar');
  if (!host) return;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  /** @type {Record<number, string[]>} */
  const marks = {};
  /** @param {number} ts @param {string} label */
  const mark = (ts, label) => {
    const d = new Date(ts);
    if (d.getFullYear() !== year || d.getMonth() !== month) return;
    (marks[d.getDate()] = marks[d.getDate()] || []).push(label);
  };
  for (const g of games) {
    if (g.firstSeen) mark(g.firstSeen, '🆕 ' + g.name);
    const end = Date.parse(g.endTime || '');
    if (Number.isFinite(end)) mark(end, '⏰ 截止 ' + g.name);
  }
  const today = now.getDate();
  // v14.39.0：h() 树直渲染（trusted 串注入退役——日格/标记全为受控数据，
  // title 文本子节点天然安全，无需再剥引号）
  const PP = /** @type {any} */ (globalThis).__GR_PREACT__;
  const cells = [
    ...['日', '一', '二', '三', '四', '五', '六'].map((d, i) => PP.h('div', { class: 'cal-dow', key: 'dow' + i }, d)),
    ...Array.from({ length: firstDow }, (_, i) => PP.h('div', { class: 'cal-cell cal-empty', key: 'e' + i })),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const d = i + 1;
      const labels = marks[d];
      const cls = 'cal-cell' + (d === today ? ' cal-today' : '') + (labels ? ' cal-marked' : '');
      return PP.h(
        'div',
        { class: cls, title: labels ? labels.join('\n') : undefined, key: 'd' + d },
        String(d),
        labels ? PP.h('div', { class: 'cal-dot' }) : null
      );
    })
  ];
  PP.render(PP.h('div', { class: 'cal-grid' }, cells), host);
}

// v15 阶段 3：限免页状态区块 Preact 组件（按需装载一次）
/** @type {{mountAt: (v: any, el: HTMLElement) => void, StatusLine: any}|null} */
let fgStatusPreact = null;
async function ensureFgStatusPreact() {
  if (fgStatusPreact) return fgStatusPreact;
  fgStatusPreact = await import(chrome.runtime.getURL('freegames/freegames-status.preact.mjs'));
  return fgStatusPreact;
}
/** @param {HTMLElement} listEl @param {string} msg @param {string} [cls] */
async function mountFgStatus(listEl, msg, cls) {
  const P = await ensureFgStatusPreact();
  if (P) P.mountAt(P.StatusLine({ msg, cls: cls || 'empty' }), listEl);
}
// 加载限免游戏（force=true 强制刷新数据源）/ Load free games (force=true re-fetches sources)
async function loadFreeGames(force = false) {
  const listEl = document.getElementById('gameList');
  await mountFgStatus(listEl, '正在加载限免游戏...', 'loading');

  try {
    const response = await window.__GR_MSG__.sendMessage({ action: 'GET_FREE_GAMES', force });
    if (response && response.data) {
      allGames = Array.isArray(response.data.games) ? response.data.games : []; // v10.9：异型守卫
      // v14.28.12（B-2 审计 B2-F2）：全源失败保护提示——后台保留旧数据并带
      // fetchErrorAt，页面不再把"源拉取失败显示上次数据"误渲染成"当前无限免"。
      // All-source failure guard: show last-known-data notice instead of
      // silently conflating with "no giveaways right now".
      const warnEl = document.getElementById('fetchWarn');
      if (warnEl) {
        if (response.data.fetchErrorAt) {
          const at = new Date(response.data.fetchErrorAt).toLocaleString('zh-CN');
          warnEl.textContent = `⚠️ 限免源拉取失败（${at}），以下为上次成功数据`;
          warnEl.style.display = '';
        } else {
          warnEl.style.display = 'none';
        }
      }
      // 显示最后更新时间
      if (response.data.lastUpdate) {
        document.getElementById('lastUpdate').textContent =
          '最后更新: ' + new Date(response.data.lastUpdate).toLocaleString('zh-CN');
      }
      renderGames();
      renderFreeGamesCalendar(allGames); // v14.8 批次 7：当月月历
    } else {
      await mountFgStatus(listEl, '加载失败，请重试');
    }
  } catch (e) {
    // v14.39.0：去 escapeHtml（StatusLine 为 Preact 文本插值自动转义——调用点
    // 预转义是双重转义，含 < 的错误串会显示 &lt; 字面量）
    await mountFgStatus(listEl, '加载失败: ' + String(e));
  }
}

// 渲染游戏列表（应用平台/领取方式筛选，未领取的排前）
// Render the game list (apply platform/claim filters; unclaimed first)
function renderGames() {
  const listEl = document.getElementById('gameList');

  // v9.3.0：过滤逻辑抽取为纯函数（shared/freegames-filter.js——可单测）
  const { filterFreeGames } = /** @type {any} */ (globalThis).__GR_FG_FILTER__ || {};
  const base = Array.isArray(allGames) ? allGames : []; // v10.9：异型守卫
  const filtered = filterFreeGames ? filterFreeGames(base, currentFilter, currentClaimFilter) : base;

  if (filtered.length === 0) {
    void mountFgStatus(listEl, '当前没有符合条件的限免游戏');
    return;
  }

  // 未领取的排在前面
  const sorted = [...filtered].sort((a, b) => (a.claimed ? 1 : 0) - (b.claimed ? 1 : 0));

  // v14.39.0：h() 树直渲染（trusted 串注入退役——外部 API 字段全部走文本
  // 子节点/href prop，天然转义；img onError prop 直连——上批的双保险接线
  // 块随之退役；领取按钮 onClick prop 直连，就地更新语义不变）
  const PP = /** @type {any} */ (globalThis).__GR_PREACT__;
  PP.render(
    PP.h(
      PP.Fragment,
      null,
      sorted.map((/** @type {any} */ game) => renderGameCard(game))
    ),
    listEl
  );
}

// 领取点击（卡片 h() 化后由 claim 元素 onClick prop 直连）：
// 链接始终会在新标签打开（<a target=_blank> 默认行为）；若尚未领取，标记
// 已领取并就地更新按钮外观（不整体重渲染以免中断跳转）
/** @param {any} ev @param {any} game */
async function onClaimClick(ev, game) {
  if (!game || game.claimed) return;
  const btn = ev.currentTarget;
  await window.__GR_MSG__.sendMessage({ action: 'CLAIM_FREE_GAME', gameId: game.id });
  game.claimed = true;
  btn.classList.add('claimed');
  btn.textContent = '✓ 已领取 · 再次打开';
  const card = btn.closest('.game-card');
  if (card) card.classList.add('claimed');
}

// 渲染单个游戏卡片（Preact 组件）/ Render a single game card
/** @param {Record<string, any>} game */
function renderGameCard(game) {
  const PP = /** @type {any} */ (globalThis).__GR_PREACT__;
  // v6.3.3：限免类型标记（✅ 限时领取 / ⚠️ 免费周末 / ❌ 永久免费）
  const freeTypeTag =
    game.freeType === 'weekend'
      ? PP.h('span', { style: 'color:#ff7b00;font-size:11px;' }, '⚠️ 免费周末')
      : game.freeType === 'f2p'
        ? PP.h('span', { style: 'color:#8f98a0;font-size:11px;' }, '❌ 永久免费')
        : PP.h('span', { style: 'color:#a3cf06;font-size:11px;' }, '✅ 限时领取');
  // 领取方式标识：官方直领（无门槛） vs 第三方领取（需条件）
  const isThirdParty = game.claimType === 'thirdparty';
  const claimTypeTag = isThirdParty
    ? PP.h(
        'span',
        {
          class: 'claim-type thirdparty',
          title: `需到第三方平台（${game.source || '第三方'}）领取，可能有额外条件`
        },
        '🟡 第三方·' + (game.source || '需条件')
      )
    : PP.h(
        'span',
        { class: 'claim-type direct', title: `可直接在 ${game.platformName} 平台领取，无门槛` },
        '🟢 官方直领'
      );
  // 领取按钮：始终为可点击链接（可重复点击），已领取仅改变样式/文案。
  // v3.4.1：仅渲染合法 http(s) 链接，否则降级为无跳转按钮（防 javascript: 伪协议）
  const safeUrl = /^https?:\/\//i.test(game.url || '') ? game.url : '';
  /** @type {any} */
  const claimProps = {
    class: 'claim-btn' + (game.claimed ? ' claimed' : ''),
    'data-id': String(game.id),
    onClick: (/** @type {any} */ ev) => onClaimClick(ev, game)
  };
  const claimText = game.claimed ? '✓ 已领取 · 再次打开' : '🎁 去领取';
  const claimBtn = safeUrl
    ? PP.h('a', { ...claimProps, href: String(safeUrl), target: '_blank' }, claimText)
    : PP.h('span', claimProps, game.claimed ? '✓ 已领取 · 无外链' : '🎁 去领取');

  return PP.h(
    'div',
    { class: 'game-card' + (game.claimed ? ' claimed' : ''), key: String(game.id) },
    game.image
      ? PP.h('img', {
          class: 'game-card-img',
          src: String(game.image),
          alt: String(game.name),
          onError: (/** @type {any} */ ev) => {
            ev.currentTarget.style.display = 'none';
          }
        })
      : null,
    PP.h(
      'div',
      { class: 'game-card-body' },
      PP.h(
        'div',
        { class: 'game-tags-row' },
        PP.h('span', { class: 'game-platform ' + (game.platform || '') }, String(game.platformName)),
        freeTypeTag,
        claimTypeTag,
        isToday(game.firstSeen) ? PP.h('span', { class: 'new-today' }, '🆕 今日新增') : null
      ),
      PP.h('div', { class: 'game-title' }, String(game.name)),
      PP.h('div', { class: 'game-desc' }, String(game.description || '暂无简介')),
      PP.h(
        'div',
        { class: 'game-meta' },
        game.originalPrice && game.originalPrice !== '免费'
          ? PP.h(
              'span',
              { class: 'game-price' },
              PP.h('span', { class: 'original' }, String(game.originalPrice)),
              '免费'
            )
          : PP.h('span', { class: 'game-price' }, '免费'),
        game.endTime ? PP.h('span', { class: 'game-endtime' }, '截止: ' + formatDate(game.endTime)) : null
      ),
      PP.h('div', { class: 'game-actions' }, claimBtn)
    )
  );
}

// 判断时间戳是否为当天（用于"今日新增"标识）
// Check whether a timestamp is today (for the "new today" badge)
/** @param {number} timestamp */
function isToday(timestamp) {
  if (!timestamp) return false;
  const d = new Date(timestamp);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

// 格式化截止日期（如 "8月15日"）；非法日期回退原文 / Format end date; invalid dates fall back
/** @param {string} dateStr */
function formatDate(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr; // new Date 对非法串不抛错，返回 Invalid Date
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
// （escapeHtml/escapeAttr 由 shared/escape.js 提供全局实现）
// (escapeHtml/escapeAttr come from shared/escape.js)
