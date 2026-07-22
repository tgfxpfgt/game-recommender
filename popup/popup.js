/**
 * Game Recommender - Popup Script
 */

document.addEventListener('DOMContentLoaded', async () => {
  // 加载设置
  const response = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
  const settings = response.settings;

  // 初始化UI状态
  document.getElementById('enableToggle').checked = settings.enabled;
  document.getElementById('thresholdSlider').value = settings.highlightThreshold * 100;
  document.getElementById('thresholdValue').textContent = `${settings.highlightThreshold * 100}%`;
  document.getElementById('debugToggle').checked = settings.showDebugPanel || false;
  
  // 算法模式
  const algoMode = settings.useLLM ? 'llm' : 'builtin';
  document.querySelector(`input[name="algoMode"][value="${algoMode}"]`).checked = true;
  updateLLMStatus(settings);

  // 加载统计数据
  loadStats();

  // 加载限免游戏数量
  loadFreeGamesCount();

  // ============ 事件绑定 ============

  // 启用/禁用
  document.getElementById('enableToggle').addEventListener('change', async (e) => {
    settings.enabled = e.target.checked;
    await chrome.runtime.sendMessage({ action: 'SAVE_SETTINGS', settings });
  });

  // 阈值调整
  document.getElementById('thresholdSlider').addEventListener('input', (e) => {
    const value = e.target.value;
    document.getElementById('thresholdValue').textContent = `${value}%`;
  });

  document.getElementById('thresholdSlider').addEventListener('change', async (e) => {
    settings.highlightThreshold = e.target.value / 100;
    await chrome.runtime.sendMessage({ action: 'SAVE_SETTINGS', settings });
  });

  // 算法模式切换
  document.querySelectorAll('input[name="algoMode"]').forEach(radio => {
    radio.addEventListener('change', async (e) => {
      settings.useLLM = e.target.value === 'llm';
      await chrome.runtime.sendMessage({ action: 'SAVE_SETTINGS', settings });
      updateLLMStatus(settings);
    });
  });

  // 刷新推荐
  document.getElementById('refreshBtn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { action: 'REFRESH_RECOMMENDATIONS' });
    }
    // 按钮反馈
    const btn = document.getElementById('refreshBtn');
    btn.textContent = '✅ 已刷新';
    setTimeout(() => { btn.textContent = '🔄 刷新推荐'; }, 1500);
  });

  // 打开设置页
  document.getElementById('optionsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 打开数据分析页
  document.getElementById('dashboardBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  });

  // 调试窗口开关
  document.getElementById('debugToggle').addEventListener('change', async (e) => {
    settings.showDebugPanel = e.target.checked;
    await chrome.runtime.sendMessage({ action: 'SAVE_SETTINGS', settings });
  });

  // 打开限免提醒页
  document.getElementById('freeGamesBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('freegames/freegames.html') });
  });
});

async function loadFreeGamesCount() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'GET_FREE_GAMES', force: false });
    if (response && response.data && response.data.games) {
      const unclaimed = response.data.games.filter(g => !g.claimed).length;
      const countEl = document.getElementById('freeCount');
      if (unclaimed > 0) {
        countEl.textContent = unclaimed;
        countEl.style.display = 'inline-block';
      }
    }
  } catch (e) {
    console.warn('加载限免数量失败:', e);
  }
}

async function loadStats() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'GET_STATS' });
    
    document.getElementById('statEvents').textContent = response.totalEvents;
    document.getElementById('statGames').textContent = response.totalGames;
    document.getElementById('statKeywords').textContent = response.topKeywords.length;

    // 显示TOP关键词
    const container = document.getElementById('topKeywords');
    if (response.topKeywords.length > 0) {
      container.innerHTML = response.topKeywords
        .slice(0, 5)
        .map(kw => `<span class="keyword-tag">${kw.keyword}</span>`)
        .join('');
    }
  } catch (e) {
    console.warn('加载统计失败:', e);
  }
}

function updateLLMStatus(settings) {
  const statusDiv = document.getElementById('llmStatus');
  const statusText = document.getElementById('llmStatusText');
  const statusDot = statusDiv.querySelector('.status-dot');

  if (settings.useLLM) {
    statusDiv.style.display = 'flex';
    if (settings.llmConfig && settings.llmConfig.endpoint) {
      statusText.textContent = `${settings.llmConfig.provider === 'local' ? '本地' : '云端'}: ${settings.llmConfig.model}`;
      statusDot.classList.add('connected');
    } else {
      statusText.textContent = '未配置 - 请在设置中配置';
      statusDot.classList.remove('connected');
    }
  } else {
    statusDiv.style.display = 'none';
  }
}
