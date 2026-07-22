/**
 * Game Recommender - Free Games Script
 */

let allGames = [];
let currentFilter = 'all';

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

  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="empty">当前没有符合条件的限免游戏</div>';
    return;
  }

  // 未领取的排在前面
  const sorted = [...filtered].sort((a, b) => (a.claimed ? 1 : 0) - (b.claimed ? 1 : 0));

  listEl.innerHTML = sorted.map(game => renderGameCard(game)).join('');

  // 绑定领取按钮
  listEl.querySelectorAll('.claim-btn:not(.claimed)').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const gameId = btn.dataset.id;
      // 标记已领取并更新badge
      await chrome.runtime.sendMessage({ action: 'CLAIM_FREE_GAME', gameId });
      // 更新本地状态
      const game = allGames.find(g => g.id === gameId);
      if (game) game.claimed = true;
      renderGames();
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

  const claimBtn = game.claimed
    ? `<span class="claim-btn claimed">✓ 已领取</span>`
    : `<a href="${game.url}" target="_blank" class="claim-btn" data-id="${game.id}">🎁 去领取</a>`;

  return `
    <div class="game-card ${game.claimed ? 'claimed' : ''}">
      ${game.image ? `<img src="${game.image}" alt="${escapeHtml(game.name)}" onerror="this.style.display='none'"/>` : ''}
      <div class="game-card-body">
        <span class="game-platform ${platformClass}">${escapeHtml(game.platformName)}</span>
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
