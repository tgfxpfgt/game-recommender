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

let allGames = [];
let currentFilter = 'all';
let currentClaimFilter = 'all';

document.addEventListener('DOMContentLoaded', () => {
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

  // 平台筛选 / Platform filter
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.platform;
      renderGames();
    });
  });

  // 领取方式筛选 / Claim-type filter
  document.querySelectorAll('.claim-btn-filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.claim-btn-filter').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentClaimFilter = btn.dataset.claim;
      renderGames();
    });
  });
});

// 加载限免游戏（force=true 强制刷新数据源）/ Load free games (force=true re-fetches sources)
async function loadFreeGames(force = false) {
  const listEl = document.getElementById('gameList');
  listEl.innerHTML = '<div class="loading">正在加载限免游戏...</div>';

  try {
    const response = await chrome.runtime.sendMessage({ action: 'GET_FREE_GAMES', force });
    if (response && response.data) {
      allGames = response.data.games || [];
      // 显示最后更新时间
      if (response.data.lastUpdate) {
        document.getElementById('lastUpdate').textContent =
          '最后更新: ' + new Date(response.data.lastUpdate).toLocaleString('zh-CN');
      }
      renderGames();
    } else {
      listEl.innerHTML = '<div class="empty">加载失败，请重试</div>';
    }
  } catch (e) {
    listEl.innerHTML = `<div class="empty">加载失败: ${escapeHtml(String(e))}</div>`;
  }
}

// 渲染游戏列表（应用平台/领取方式筛选，未领取的排前）
// Render the game list (apply platform/claim filters; unclaimed first)
function renderGames() {
  const listEl = document.getElementById('gameList');

  // v4.1.0：微软商店独立筛选（manager.js 平台门已映射 microsoft）
  const mainPlatforms = ['epic', 'steam', 'gog', 'microsoft'];
  let filtered;
  if (currentFilter === 'all') {
    filtered = allGames;
  } else if (currentFilter === 'other') {
    filtered = allGames.filter((g) => !mainPlatforms.includes(g.platform));
  } else {
    filtered = allGames.filter((g) => g.platform === currentFilter);
  }

  // 领取方式筛选（官方直领 vs 第三方）
  if (currentClaimFilter !== 'all') {
    filtered = filtered.filter((g) => (g.claimType || 'direct') === currentClaimFilter);
  }

  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="empty">当前没有符合条件的限免游戏</div>';
    return;
  }

  // 未领取的排在前面
  const sorted = [...filtered].sort((a, b) => (a.claimed ? 1 : 0) - (b.claimed ? 1 : 0));

  listEl.innerHTML = sorted.map((game) => renderGameCard(game)).join('');

  // 图片加载失败时隐藏（addEventListener 替代内联 onerror，规避扩展页 CSP）
  // Hide failed images (addEventListener instead of inline onerror for extension-page CSP)
  listEl.querySelectorAll('.game-card-img').forEach((img) => {
    img.addEventListener('error', () => {
      img.style.display = 'none';
    });
  });

  // 绑定领取按钮（所有按钮均可重复点击）
  listEl.querySelectorAll('.claim-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const gameId = btn.dataset.id;
      const game = allGames.find((g) => g.id === gameId);
      // 链接始终会在新标签打开（<a target=_blank> 默认行为）
      // 若尚未领取，标记已领取并更新角标
      if (game && !game.claimed) {
        await chrome.runtime.sendMessage({ action: 'CLAIM_FREE_GAME', gameId });
        game.claimed = true;
        // 就地更新按钮外观（保持链接可点击，不整体重渲染以免中断跳转）
        btn.classList.add('claimed');
        btn.innerHTML = '✓ 已领取 · 再次打开';
        const card = btn.closest('.game-card');
        if (card) card.classList.add('claimed');
      }
    });
  });
}

// 渲染单个游戏卡片 / Render a single game card
function renderGameCard(game) {
  const platformClass = game.platform;
  const endTimeHtml = game.endTime ? `<span class="game-endtime">截止: ${formatDate(game.endTime)}</span>` : '';

  const priceHtml =
    game.originalPrice && game.originalPrice !== '免费'
      ? `<span class="game-price"><span class="original">${escapeHtml(game.originalPrice)}</span>免费</span>`
      : `<span class="game-price">免费</span>`;

  // 今日新增标识
  const newTodayHtml = isToday(game.firstSeen) ? `<span class="new-today">🆕 今日新增</span>` : '';

  // 领取方式标识：官方直领（无门槛） vs 第三方领取（需条件）
  // v6.3.3：限免类型标记（✅ 限时领取 / ⚠️ 免费周末 / ❌ 永久免费）
  const freeTypeTag =
    game.freeType === 'weekend'
      ? '<span style="color:#ff7b00;font-size:11px;">⚠️ 免费周末</span>'
      : game.freeType === 'f2p'
        ? '<span style="color:#8f98a0;font-size:11px;">❌ 永久免费</span>'
        : '<span style="color:#a3cf06;font-size:11px;">✅ 限时领取</span>';
  const isThirdParty = game.claimType === 'thirdparty';
  const claimTypeHtml = isThirdParty
    ? `<span class="claim-type thirdparty" title="需到第三方平台（${escapeHtml(game.source || '第三方')}）领取，可能有额外条件">🟡 第三方·${escapeHtml(game.source || '需条件')}</span>`
    : `<span class="claim-type direct" title="可直接在 ${escapeHtml(game.platformName)} 平台领取，无门槛">🟢 官方直领</span>`;

  // 领取按钮：始终为可点击链接（可重复点击），已领取仅改变样式/文案。
  // v3.4.1：仅渲染合法 http(s) 链接，否则降级为无跳转按钮（防 javascript: 伪协议）
  const safeUrl = /^https?:\/\//i.test(game.url || '') ? game.url : '';
  const claimBtn = game.claimed
    ? safeUrl
      ? `<a href="${escapeAttr(safeUrl)}" target="_blank" class="claim-btn claimed" data-id="${escapeAttr(game.id)}">✓ 已领取 · 再次打开</a>`
      : `<span class="claim-btn claimed" data-id="${escapeAttr(game.id)}">✓ 已领取 · 无外链</span>`
    : safeUrl
      ? `<a href="${escapeAttr(safeUrl)}" target="_blank" class="claim-btn" data-id="${escapeAttr(game.id)}">🎁 去领取</a>`
      : `<span class="claim-btn" data-id="${escapeAttr(game.id)}">🎁 去领取</span>`;

  return `
    <div class="game-card ${game.claimed ? 'claimed' : ''}">
      ${game.image ? `<img class="game-card-img" src="${escapeAttr(game.image)}" alt="${escapeHtml(game.name)}"/>` : ''}
      <div class="game-card-body">
        <div class="game-tags-row">
          <span class="game-platform ${platformClass}">${escapeHtml(game.platformName)}</span>
          ${freeTypeTag}
          ${claimTypeHtml}
          ${newTodayHtml}
        </div>
        <div class="game-title">${escapeHtml(game.name)}</div>
        <div class="game-desc">${escapeHtml(game.description || '暂无简介')}</div>
        <div class="game-meta">
          ${priceHtml}
          ${endTimeHtml}
        </div>
        <div class="game-actions">
          ${claimBtn}
        </div>
      </div>
    </div>
  `;
}

// 判断时间戳是否为当天（用于"今日新增"标识）
// Check whether a timestamp is today (for the "new today" badge)
function isToday(timestamp) {
  if (!timestamp) return false;
  const d = new Date(timestamp);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

// 格式化截止日期（如 "8月15日"）；非法日期回退原文 / Format end date; invalid dates fall back
function formatDate(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr; // new Date 对非法串不抛错，返回 Invalid Date
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
// （escapeHtml/escapeAttr 由 shared/escape.js 提供全局实现）
// (escapeHtml/escapeAttr come from shared/escape.js)
