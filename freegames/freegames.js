/**
 * Game Recommender - Free Games Script
 */

let allGames = [];
let currentFilter = 'all';
let currentClaimFilter = 'all';

document.addEventListener('DOMContentLoaded', () => {
  loadFreeGames();

  document.getElementById('refreshBtn').addEventListener('click', () => {
    loadFreeGames(true);
  });

  // 平台筛选
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.platform;
      renderGames();
    });
  });

  // 领取方式筛选
  document.querySelectorAll('.claim-btn-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.claim-btn-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentClaimFilter = btn.dataset.claim;
      renderGames();
    });
  });
});

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
    listEl.innerHTML = `<div class="empty">加载失败: ${e.message}</div>`;
  }
}

function renderGames() {
  const listEl = document.getElementById('gameList');

  const mainPlatforms = ['epic', 'steam', 'gog'];
  let filtered;
  if (currentFilter === 'all') {
    filtered = allGames;
  } else if (currentFilter === 'other') {
    filtered = allGames.filter(g => !mainPlatforms.includes(g.platform));
  } else {
    filtered = allGames.filter(g => g.platform === currentFilter);
  }

  // 领取方式筛选（官方直领 vs 第三方）
  if (currentClaimFilter !== 'all') {
    filtered = filtered.filter(g => (g.claimType || 'direct') === currentClaimFilter);
  }

  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="empty">当前没有符合条件的限免游戏</div>';
    return;
  }

  // 未领取的排在前面
  const sorted = [...filtered].sort((a, b) => (a.claimed ? 1 : 0) - (b.claimed ? 1 : 0));

  listEl.innerHTML = sorted.map(game => renderGameCard(game)).join('');

  // 绑定领取按钮（所有按钮均可重复点击）
  listEl.querySelectorAll('.claim-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const gameId = btn.dataset.id;
      const game = allGames.find(g => g.id === gameId);
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

function renderGameCard(game) {
  const platformClass = game.platform;
  const endTimeHtml = game.endTime
    ? `<span class="game-endtime">截止: ${formatDate(game.endTime)}</span>`
    : '';

  const priceHtml = game.originalPrice && game.originalPrice !== '免费'
    ? `<span class="game-price"><span class="original">${escapeHtml(game.originalPrice)}</span>免费</span>`
    : `<span class="game-price">免费</span>`;

  // 今日新增标识
  const newTodayHtml = isToday(game.firstSeen)
    ? `<span class="new-today">🆕 今日新增</span>`
    : '';

  // 领取方式标识：官方直领（无门槛） vs 第三方领取（需条件）
  const isThirdParty = game.claimType === 'thirdparty';
  const claimTypeHtml = isThirdParty
    ? `<span class="claim-type thirdparty" title="需到第三方平台（${escapeHtml(game.source || '第三方')}）领取，可能有额外条件">🟡 第三方·${escapeHtml(game.source || '需条件')}</span>`
    : `<span class="claim-type direct" title="可直接在 ${escapeHtml(game.platformName)} 平台领取，无门槛">🟢 官方直领</span>`;

  // 领取按钮：始终为可点击链接（可重复点击），已领取仅改变样式/文案
  const claimBtn = game.claimed
    ? `<a href="${game.url}" target="_blank" class="claim-btn claimed" data-id="${game.id}">✓ 已领取 · 再次打开</a>`
    : `<a href="${game.url}" target="_blank" class="claim-btn" data-id="${game.id}">🎁 去领取</a>`;

  return `
    <div class="game-card ${game.claimed ? 'claimed' : ''}">
      ${game.image ? `<img src="${game.image}" alt="${escapeHtml(game.name)}" onerror="this.style.display='none'"/>` : ''}
      <div class="game-card-body">
        <div class="game-tags-row">
          <span class="game-platform ${platformClass}">${escapeHtml(game.platformName)}</span>
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

// 判断时间戳是否为当天
function isToday(timestamp) {
  if (!timestamp) return false;
  const d = new Date(timestamp);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
         d.getMonth() === now.getMonth() &&
         d.getDate() === now.getDate();
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  } catch (e) {
    return dateStr;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}
