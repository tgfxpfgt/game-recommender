/**
 * Game Recommender - Popup Script
 * 弹窗逻辑 / Popup logic
 *
 * Features:
 * - Real-time setting synchronization (saves on every change)
 * - Statistics display (events, games, keywords)
 * - Quick access to dashboard, free games, and options
 *
 * 功能：
 * - 实时同步设置（每次修改即保存）
 * - 统计数据展示（行为记录、游戏数、关键词数）
 * - 快速访问仪表盘、限免游戏和设置页
 */

document.addEventListener('DOMContentLoaded', async () => {
  // 显示扩展版本号（便于确认加载的是否为最新版本）
  // Show the extension version (helps confirm the loaded version)
  const versionEl = document.getElementById('extVersion');
  if (versionEl && chrome.runtime && chrome.runtime.getManifest) {
    versionEl.textContent = 'v' + chrome.runtime.getManifest().version;
  }

  // Load settings / 加载设置（后台未就绪时给出降级处理）
  let settings;
  try {
    const response = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
    settings = response?.settings;
  } catch (e) {
    console.warn('[Game Recommender] 加载设置失败:', e);
  }
  if (!settings) {
    document.body.insertAdjacentHTML('afterbegin',
      '<div style="padding:12px;margin:12px;background:#3a1a1a;color:#ff8a7a;border:1px solid #d94126;border-radius:8px;font-size:13px;">⚠️ 扩展后台未就绪，请稍后重试。</div>');
    return;
  }

  // Initialize UI state / 初始化 UI 状态
  document.getElementById('enableToggle').checked = settings.enabled;
  document.getElementById('thresholdSlider').value = settings.highlightThreshold * 100;
  document.getElementById('thresholdValue').textContent = `${settings.highlightThreshold * 100}%`;
  document.getElementById('debugToggle').checked = settings.showDebugPanel || false;

  // Steam rating filter / 好评率过滤
  document.getElementById('ratingFilterToggle').checked = settings.enableRatingFilter || false;
  document.getElementById('ratingFilterSlider').value = settings.minSteamRatingFilter || 0;
  document.getElementById('ratingFilterValue').textContent = `${settings.minSteamRatingFilter || 0}%`;
  document.getElementById('ratingFilterControl').style.display = settings.enableRatingFilter ? 'flex' : 'none';

  // VM edition filter / 虚拟机版过滤
  document.getElementById('vmFilterToggle').checked = settings.enableVmFilter || false;

  // Algorithm mode / 算法模式
  const algoMode = settings.useLLM ? 'llm' : 'builtin';
  const algoRadio = document.querySelector(`input[name="algoMode"][value="${algoMode}"]`);
  if (algoRadio) algoRadio.checked = true;
  updateLLMStatus(settings);

  // Load statistics / 加载统计数据
  loadStats();

  // Load free games count / 加载限免游戏数量
  loadFreeGamesCount();

  // ============ Event Binding / 事件绑定 ============

  // Enable/Disable toggle / 启用/禁用开关
  document.getElementById('enableToggle').addEventListener('change', async (e) => {
    settings.enabled = e.target.checked;
    await chrome.runtime.sendMessage({ action: 'SAVE_SETTINGS', settings });
  });

  // Threshold slider / 阈值滑块
  document.getElementById('thresholdSlider').addEventListener('input', (e) => {
    const value = e.target.value;
    document.getElementById('thresholdValue').textContent = `${value}%`;
  });

  document.getElementById('thresholdSlider').addEventListener('change', async (e) => {
    settings.highlightThreshold = e.target.value / 100;
    await chrome.runtime.sendMessage({ action: 'SAVE_SETTINGS', settings });
  });

  // Algorithm mode switch / 算法模式切换
  document.querySelectorAll('input[name="algoMode"]').forEach(radio => {
    radio.addEventListener('change', async (e) => {
      settings.useLLM = e.target.value === 'llm';
      await chrome.runtime.sendMessage({ action: 'SAVE_SETTINGS', settings });
      updateLLMStatus(settings);
    });
  });

  // Refresh recommendations / 刷新推荐
  document.getElementById('refreshBtn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { action: 'REFRESH_RECOMMENDATIONS' });
    }
    // Button feedback / 按钮反馈
    const btn = document.getElementById('refreshBtn');
    btn.textContent = '✅ 已刷新';
    setTimeout(() => { btn.textContent = '🔄 刷新'; }, 1500);
  });

  // Open options page / 打开设置页
  document.getElementById('optionsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Open dashboard / 打开数据分析页
  document.getElementById('dashboardBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  });

  // Debug panel toggle / 调试窗口开关
  document.getElementById('debugToggle').addEventListener('change', async (e) => {
    settings.showDebugPanel = e.target.checked;
    await chrome.runtime.sendMessage({ action: 'SAVE_SETTINGS', settings });
  });

  // Rating filter toggle / 好评率过滤开关
  document.getElementById('ratingFilterToggle').addEventListener('change', async (e) => {
    settings.enableRatingFilter = e.target.checked;
    document.getElementById('ratingFilterControl').style.display = e.target.checked ? 'flex' : 'none';
    await chrome.runtime.sendMessage({ action: 'SAVE_SETTINGS', settings });
  });

  // Rating filter threshold / 好评率过滤阈值
  document.getElementById('ratingFilterSlider').addEventListener('input', (e) => {
    document.getElementById('ratingFilterValue').textContent = `${e.target.value}%`;
  });

  document.getElementById('ratingFilterSlider').addEventListener('change', async (e) => {
    settings.minSteamRatingFilter = parseInt(e.target.value);
    await chrome.runtime.sendMessage({ action: 'SAVE_SETTINGS', settings });
  });

  // VM filter toggle / 虚拟机过滤开关
  document.getElementById('vmFilterToggle').addEventListener('change', async (e) => {
    settings.enableVmFilter = e.target.checked;
    await chrome.runtime.sendMessage({ action: 'SAVE_SETTINGS', settings });
  });

  // Open free games page / 打开限免提醒页
  document.getElementById('freeGamesBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('freegames/freegames.html') });
  });
});

// ============ Load Free Games Count / 加载限免游戏数量 ============
async function loadFreeGamesCount() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'GET_FREE_GAMES', force: false });
    if (response && response.data && response.data.games) {
      // Count new free games added today / 统计当天新增的限免游戏
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayStartMs = todayStart.getTime();
      const newToday = response.data.games.filter(g => g.firstSeen && g.firstSeen >= todayStartMs).length;
      const countEl = document.getElementById('freeCount');
      if (newToday > 0) {
        countEl.textContent = newToday;
        countEl.style.display = 'inline-block';
      }
    }
  } catch (e) {
    console.warn('加载限免数量失败:', e);
  }
}

// ============ Load Statistics / 加载统计数据 ============
async function loadStats() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'GET_STATS' });
    // 防御：后台未就绪或返回异常时跳过渲染 / Guard: skip if SW not ready or malformed response
    if (!response) return;
    const totalEvents = response.totalEvents || 0;
    const totalGames = response.totalGames || 0;
    const topKeywords = response.topKeywords || [];

    document.getElementById('statEvents').textContent = totalEvents;
    document.getElementById('statGames').textContent = totalGames;
    document.getElementById('statKeywords').textContent = topKeywords.length;

    // Display top 5 keywords / 显示 TOP5 关键词
    const container = document.getElementById('topKeywords');
    if (topKeywords.length > 0) {
      // 关键词来自用户浏览记录，需转义防 XSS / Keywords come from browsing data; escape to prevent XSS
      container.innerHTML = topKeywords
        .slice(0, 5)
        .map(kw => `<span class="keyword-tag">${escapeHtml(kw.keyword)}</span>`)
        .join('');
    }
  } catch (e) {
    console.warn('加载统计失败:', e);
  }
}

// ============ Update LLM Status / 更新大模型状态 ============
// （escapeHtml 由 shared/escape.js 提供全局实现）
// (escapeHtml comes from shared/escape.js)

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
