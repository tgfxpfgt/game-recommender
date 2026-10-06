/**
 * 游戏雷达 Game Radar - Popup 状态区渲染 / Popup Status Renderers
 *
 * v14.3.0（第五轮 B6）：由 popup.js 拆分——统计/Steam API 可达性/限免角标
 * 计数/LLM 状态四个只读状态块的加载与渲染（popup.html 按序加载，classic
 * 脚本函数提升为全局，popup.js 直接调用）。
 * Read-only status blocks split from popup.js (classic-script globals).
 */

// ============ Load Steam API Status / 加载 Steam API 状态 ============
async function loadApiStatus() {
  const dot = document.getElementById('apiStatusDot');
  const info = document.getElementById('apiStatusInfo');
  try {
    const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_API_STATUS' });
    if (!resp) {
      info.innerHTML = '<span class="no-data">无法获取状态</span>';
      return;
    }
    const num = (v) => Number(v) || 0; // v10.9：异型响应防 NaN 文案
    // v11.0 B2：分域名可达性点灯（store/api/circuit）
    const dm = resp.domains || {};
    const lamp = (v) => (v === 'ok' ? '🟢' : v === 'down' ? '🔴' : '⚪');
    // v13 B1：per-domain 熔断态细节（storeCircuit/apiCircuit：open/half-open/closed）
    const circuitHint = (d) =>
      dm[d + 'Circuit'] === 'open' ? ' ⚡熔断中' : dm[d + 'Circuit'] === 'half-open' ? ' ⚡半开探测' : '';
    const domainLine =
      dm.store || dm.api
        ? `<div style="font-size:11px;color:#8f98a0;margin-top:4px;">可达性：商店 ${lamp(dm.store)}${circuitHint('store')} / API ${lamp(dm.api)}${circuitHint('api')}</div>`
        : '';
    if (resp.anomaly) {
      dot.className = 'status-dot error';
      info.innerHTML = `<span style="color:#e74c3c;font-size:12px;">⚠️ Steam API 异常：近 ${num(resp.windowSec) / 60} 分钟失败率 <b>${num(resp.failRate)}%</b>（${num(resp.failed)}/${num(resp.total)} 次失败），疑似限流</span>
        ${domainLine}
        <div style="font-size:11px;color:#8f98a0;margin-top:4px;">扩展已自动降低批量检索速度；建议稍后重试或减少连续刷新</div>`;
    } else if (num(resp.total) < 8) {
      dot.className = 'status-dot';
      info.innerHTML = `<span style="font-size:12px;color:#8f98a0;">采样中：近 5 分钟 ${num(resp.total)} 次调用（${num(resp.failed)} 次失败）</span>`;
    } else {
      dot.className = 'status-dot ok';
      info.innerHTML =
        `<span style="font-size:12px;color:#a3cf06;">✅ Steam API 正常：近 ${num(resp.windowSec) / 60} 分钟 ${num(resp.total)} 次调用，失败 ${num(resp.failed)} 次（${num(resp.failRate)}%）${num(resp.limited) > 0 ? `，限流 ${num(resp.limited)} 次` : ''}</span>` +
        domainLine +
        // v10.6.0 N1：会话累计出网请求量（缓存命中越多，该值越低）
        (resp.sessionTotal > 0
          ? `<div style="font-size:11px;color:#8f98a0;margin-top:4px;">本次浏览器会话已出网 ${resp.sessionTotal} 次 Steam 请求${resp.sessionFailed > 0 ? `（失败 ${resp.sessionFailed}）` : ''}</div>`
          : '');
    }
  } catch {
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
      const newToday = response.data.games.filter((g) => g.firstSeen && g.firstSeen >= todayStartMs).length;
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
