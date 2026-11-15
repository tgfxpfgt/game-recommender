/**
 * 游戏雷达 Game Radar - Popup 状态区渲染 / Popup Status Renderers
 *
 * v14.3.0（第五轮 B6）：由 popup.js 拆分——统计/Steam API 可达性/限免角标
 * 计数/LLM 状态四个只读状态块的加载与渲染（popup.html 按序加载，classic
 * 脚本函数提升为全局，popup.js 直接调用）。
 * Read-only status blocks split from popup.js (classic-script globals).
 */

// ============ Load Steam API Status / 加载 Steam API 状态 ============
/** @type {(resp: any, dotEl: HTMLElement, mountEl: HTMLElement) => void} */
let renderApiStatusPreact = null;
// v15 阶段 3：Preact 组件按需装载（dynamic import 页面上下文合法）——首次调用装载一次
async function ensurePreactRenderer() {
  if (renderApiStatusPreact) return renderApiStatusPreact;
  const m = await import(chrome.runtime.getURL('popup/popup-status.preact.mjs'));
  renderApiStatusPreact = m.renderApiStatus;
  return renderApiStatusPreact;
}

async function loadApiStatus() {
  const dot = document.getElementById('apiStatusDot');
  const info = document.getElementById('apiStatusInfo');
  try {
    const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_API_STATUS' });
    const renderApiStatus = await ensurePreactRenderer();
    renderApiStatus(resp, dot, info);
  } catch {
    dot.className = 'status-dot';
    info.innerHTML = '<span class="no-data">无法获取状态</span>';
  }
}
// ============ Load Free Games Count / 加载限免游戏数量 ============
async function loadFreeGamesCount() {
  try {
    const response = await window.__GR_MSG__.sendMessage({ action: 'GET_FREE_GAMES', force: false });
    if (response && response.data && Array.isArray(response.data.games)) {
      // v10.9：games 异型守卫
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayStartMs = todayStart.getTime();
      const newToday = response.data.games.filter(
        (/** @type {any} */ g) => g.firstSeen && g.firstSeen >= todayStartMs
      ).length;
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
    const response = await window.__GR_MSG__.sendMessage({ action: 'GET_STATS' });
    if (!response) return;
    const totalEvents = response.totalEvents || 0;
    const totalGames = response.totalGames || 0;
    const topKeywords = response.topKeywords || [];

    document.getElementById('statEvents').textContent = totalEvents;
    document.getElementById('statGames').textContent = totalGames;
    document.getElementById('statKeywords').textContent = topKeywords.length;

    const container = document.getElementById('topKeywords');
    if (Array.isArray(topKeywords) && topKeywords.length > 0) {
      // v10.9：异型守卫
      container.innerHTML = topKeywords
        .slice(0, 5)
        .map((kw) => `<span class="keyword-tag">${escapeHtml(kw.keyword)}</span>`)
        .join('');
    }
  } catch (e) {
    console.warn('加载统计失败:', e);
  }
}

// ============ Update LLM Status / 更新大模型状态 ============
// （escapeHtml 由 shared/escape.js 提供全局实现）
/** @param {Record<string, any>} settings */
function updateLLMStatus(settings) {
  const statusDiv = document.getElementById('ppLlmStatus');
  const statusText = document.getElementById('ppLlmStatusText');
  if (!statusDiv || !statusText) return;
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

// classic 脚本跨文件全局：挂 window 供 popup.js 调用（赋值亦满足 no-unused-vars）
Object.assign(window, { loadStats, loadApiStatus, loadFreeGamesCount, updateLLMStatus });
