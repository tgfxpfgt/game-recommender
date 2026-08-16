/**
 * 游戏雷达 Game Radar - Popup Script
 * 弹窗逻辑 / Popup logic
 *
 * v6.4.11：全量快捷设置——覆盖设置页全部选项（同键同名），每次修改即保存；
 * 嵌套路径经 shared/settings-utils.js 的 applyPatch（deepSet）写入。
 * Full quick settings (same keys/labels as the settings page); every change
 * saves via dotted-path applyPatch.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // 显示扩展版本号（便于确认加载的是否为最新版本）
  const versionEl = document.getElementById('extVersion');
  if (versionEl && chrome.runtime && chrome.runtime.getManifest) {
    versionEl.textContent = 'v' + chrome.runtime.getManifest().version;
  }

  // Load settings / 加载设置（后台未就绪时给出降级处理）
  let settings;
  try {
    const response = await window.__GR_MSG__.sendMessage({ action: 'GET_SETTINGS' });
    settings = response?.settings;
  } catch (e) {
    console.warn('【游戏雷达】 加载设置失败:', e);
  }
  if (!settings) {
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<div style="padding:12px;margin:12px;background:#3a1a1a;color:#ff8a7a;border:1px solid #d94126;border-radius:8px;font-size:13px;">⚠️ 扩展后台未就绪，请稍后重试。</div>'
    );
    return;
  }

  const utils = globalThis.__GR_SETTINGS_UTILS__ || { applyPatch: (o, p) => Object.assign(o, p) };

  // v6.4.19：应用皮肤主题 + v7.0.5：自定义主题 CSS
  if (utils.applyTheme) utils.applyTheme(settings.uiTheme);
  if (utils.applyCustomTheme) utils.applyCustomTheme(settings.customThemeCss);

  // ============ 保存（保存前重读最新设置，防快照覆盖） ============
  // v6.4.12：串行队列防竞态——快速连续操作时并发 GET→SAVE 会基于旧快照
  // 覆盖前次修改（"保存了但部分丢失"）；失败可见（状态栏提示 + console）。
  // Serial save queue prevents concurrent GET→SAVE overwrites; failures visible.
  let saveQueue = Promise.resolve();
  function saveSettingsPatch(patch) {
    saveQueue = saveQueue
      .then(async () => {
        const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_SETTINGS' });
        const latest = resp && resp.settings ? resp.settings : settings;
        utils.applyPatch(latest, patch);
        settings = latest;
        await window.__GR_MSG__.sendMessage({ action: 'SAVE_SETTINGS', settings: latest });
      })
      .catch((err) => {
        console.warn('【游戏雷达】 设置保存失败:', err);
        const saveFail = document.getElementById('saveFailHint');
        if (saveFail) {
          saveFail.style.display = 'block';
          setTimeout(() => {
            saveFail.style.display = 'none';
          }, 3000);
        }
      });
    return saveQueue;
  }

  // ============ 渲染 / Render ============
  document.getElementById('enableToggle').checked = settings.enabled;
  document.getElementById('ppStatusBar').checked = settings.showStatusBar !== false;
  document.getElementById('ppDebug').checked = settings.showDebugPanel || false;
  const threshold = (settings.highlightThreshold ?? 0.6) * 100;
  document.getElementById('ppThreshold').value = threshold;
  document.getElementById('ppThresholdVal').textContent = `${threshold}%`;
  document.getElementById('ppMaxLog').value = settings.maxBehaviorLog || 500;

  // 好评率过滤
  document.getElementById('ppRatingFilter').checked = settings.enableRatingFilter || false;
  document.getElementById('ppMinRating').value = settings.minSteamRatingFilter || 0;
  document.getElementById('ppMinRatingVal').textContent = `${settings.minSteamRatingFilter || 0}%`;
  document.getElementById('ppRatingControl').style.display = settings.enableRatingFilter ? 'flex' : 'none';
  document.getElementById('ppRecentFilter').checked = settings.enableRecentFilter || false;
  document.getElementById('ppMinRecent').value = settings.minRecentSteamRatingFilter || 0;
  document.getElementById('ppMinRecentVal').textContent = `${settings.minRecentSteamRatingFilter || 0}%`;
  document.getElementById('ppRecentControl').style.display = settings.enableRecentFilter ? 'flex' : 'none';
  document.getElementById('ppFilterMode').value = settings.ratingFilterMode || 'and';
  document.getElementById('ppSortByRating').checked = settings.enableSortByRating || false;

  // 关键词过滤（v6.4.19：纯规则列表——规则在设置中心编辑）
  document.getElementById('ppVmFilter').checked = settings.enableVmFilter || false;

  // 权重（动态 6 项）
  renderWeights(settings.weights || {});

  // LLM
  document.getElementById('ppUseLLM').checked = settings.useLLM || false;
  updateLLMStatus(settings);

  // 徽章
  const bv = settings.badgeVisibility || {};
  document.getElementById('ppBadgeRecent').checked = bv.recent !== false;
  document.getElementById('ppBadgeAll').checked = bv.all !== false;
  document.getElementById('ppBadgeUpdate').checked = bv.update !== false;
  document.getElementById('ppBadgeRec').checked = bv.rec !== false;
  document.getElementById('ppMaxScan').value = settings.maxScanLinks || 500;

  // 数据与备份
  document.getElementById('ppAutoBackup').checked = settings.autoBackup !== false;
  document.getElementById('ppBackupInterval').value = settings.backupIntervalHours ?? 24;
  document.getElementById('ppMaxBackups').value = settings.maxBackups ?? 7;

  // 日志
  document.getElementById('ppLogEnabled').checked = settings.enableLog !== false;
  document.getElementById('ppLogLevel').value = settings.logLevel || 'info';
  document.getElementById('ppLogRetention').value = settings.logRetentionDays ?? 7;
  document.getElementById('ppLogStorage').value = settings.logStorage || 'ndjson';
  document.getElementById('ppMaxRuntimeLog').value = settings.maxRuntimeLog || 300;

  // ============ 事件绑定 / Events ============
  // 开关类（值随事件即时保存）
  const toggleMap = [
    ['enableToggle', 'enabled'],
    ['ppStatusBar', 'showStatusBar'],
    ['ppDebug', 'showDebugPanel'],
    ['ppRatingFilter', 'enableRatingFilter'],
    ['ppRecentFilter', 'enableRecentFilter'],
    ['ppSortByRating', 'enableSortByRating'],
    ['ppVmFilter', 'enableVmFilter'],
    ['ppUseLLM', 'useLLM'],
    ['ppBadgeRecent', 'badgeVisibility.recent'],
    ['ppBadgeAll', 'badgeVisibility.all'],
    ['ppBadgeUpdate', 'badgeVisibility.update'],
    ['ppBadgeRec', 'badgeVisibility.rec'],
    ['ppAutoBackup', 'autoBackup'],
    ['ppLogEnabled', 'enableLog']
  ];
  toggleMap.forEach(([id, key]) => {
    document.getElementById(id).addEventListener('change', async (e) => {
      await saveSettingsPatch({ [key]: e.target.checked });
      if (id === 'ppRatingFilter') {
        document.getElementById('ppRatingControl').style.display = e.target.checked ? 'flex' : 'none';
      }
      if (id === 'ppRecentFilter') {
        document.getElementById('ppRecentControl').style.display = e.target.checked ? 'flex' : 'none';
      }
      if (id === 'ppUseLLM') updateLLMStatus(settings);
    });
  });

  // 滑块（input 实时更新显示，change 保存）
  /** @type {Array<[string, string, (v: string) => unknown, string]>} */
  const sliderMap = [
    ['ppThreshold', 'highlightThreshold', (v) => Number(v) / 100, 'ppThresholdVal'],
    ['ppMinRating', 'minSteamRatingFilter', Number, 'ppMinRatingVal'],
    ['ppMinRecent', 'minRecentSteamRatingFilter', Number, 'ppMinRecentVal']
  ];
  sliderMap.forEach(([id, key, parse, valId]) => {
    const el = document.getElementById(id);
    el.addEventListener('input', (e) => {
      document.getElementById(valId).textContent = `${e.target.value}%`;
    });
    el.addEventListener('change', async (e) => {
      await saveSettingsPatch({ [key]: parse(e.target.value) });
    });
  });

  // 下拉 / 数字输入（change 保存）
  /** @type {Array<[string, string, (v: string) => unknown]>} */
  const inputMap = [
    ['ppMaxLog', 'maxBehaviorLog', Number],
    ['ppFilterMode', 'ratingFilterMode', String],
    ['ppMaxScan', 'maxScanLinks', Number],
    ['ppBackupInterval', 'backupIntervalHours', Number],
    ['ppMaxBackups', 'maxBackups', Number],
    ['ppLogLevel', 'logLevel', String],
    ['ppLogRetention', 'logRetentionDays', Number],
    ['ppLogStorage', 'logStorage', String],
    ['ppMaxRuntimeLog', 'maxRuntimeLog', Number]
  ];
  inputMap.forEach(([id, key, parse]) => {
    document.getElementById(id).addEventListener('change', async (e) => {
      await saveSettingsPatch({ [key]: parse(e.target.value) });
    });
  });

  // ============ 底部操作 / Footer actions ============
  // 刷新当前页推荐
  document.getElementById('refreshBtn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { action: 'REFRESH_RECOMMENDATIONS' }).catch(() => {});
    }
    const btn = document.getElementById('refreshBtn');
    btn.textContent = '✅ 已刷新';
    setTimeout(() => {
      btn.textContent = '🔄 刷新';
    }, 1500);
  });

  // 强制刷新当前页（清除当前页 Steam 缓存后重载）
  document.getElementById('forceRefreshBtn').addEventListener('click', async () => {
    const btn = document.getElementById('forceRefreshBtn');
    btn.disabled = true;
    btn.textContent = '⏳ 刷新中...';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        btn.textContent = '⚠️ 无活动页面';
      } else {
        await chrome.tabs.sendMessage(tab.id, { action: 'FORCE_REFRESH_PAGE' });
        btn.textContent = '✅ 已刷新';
      }
    } catch {
      btn.textContent = '⚠️ 页面不支持';
    }
    setTimeout(() => window.close(), 800);
  });

  // v6.4.11：集中入口——限免/设置中心均经 hub（hub 内可一键切换所有页面）
  document.getElementById('freeGamesBtn').addEventListener('click', () => {
    if (utils.goHub) utils.goHub('freegames');
    else chrome.tabs.create({ url: chrome.runtime.getURL('freegames/freegames.html') });
  });
  document.getElementById('hubBtn').addEventListener('click', () => {
    if (utils.goHub) utils.goHub('options');
    else chrome.runtime.openOptionsPage();
  });
  document.getElementById('ppOpenFilterRules').addEventListener('click', () => {
    if (utils.goHub) utils.goHub('options');
  });
  document.getElementById('ppOpenData').addEventListener('click', () => {
    if (utils.goHub) utils.goHub('options');
  });

  // ============ 状态加载 / Status loads ============
  loadStats();
  loadApiStatus();
  loadFreeGamesCount();
});

// ============ 权重渲染 / Weights ============
function renderWeights(weights) {
  const box = document.getElementById('ppWeights');
  if (!box) return;
  const WEIGHT_KEYS = [
    ['clickRate', '点击率'],
    ['downloadRate', '下载率'],
    ['keywordMatch', '关键词'],
    ['steamRating', 'Steam 好评'],
    ['playTime', '游玩时长'],
    ['heat', '热度']
  ];
  box.innerHTML = '';
  WEIGHT_KEYS.forEach(([key, label]) => {
    const row = document.createElement('div');
    row.className = 'ctrl-row';
    row.innerHTML = `<span class="ctrl-label">${label}</span>
      <div class="threshold-control">
        <input type="range" data-w="${key}" min="0" max="100" step="5">
        <span data-wv="${key}" class="threshold-value">0%</span>
      </div>`;
    box.appendChild(row);
    const slider = row.querySelector('[data-w]');
    slider.value = Math.round((weights[key] || 0) * 100);
    row.querySelector('[data-wv]').textContent = slider.value + '%';
    slider.addEventListener('input', (e) => {
      row.querySelector('[data-wv]').textContent = e.target.value + '%';
      updateWeightSum();
    });
    slider.addEventListener('change', async (e) => {
      const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_SETTINGS' });
      const latest = resp && resp.settings ? resp.settings : {};
      latest.weights = { ...(latest.weights || {}), [key]: Number(e.target.value) / 100 };
      const utils = globalThis.__GR_SETTINGS_UTILS__ || {};
      if (utils.applyPatch) utils.applyPatch(latest, { weights: latest.weights });
      await window.__GR_MSG__.sendMessage({ action: 'SAVE_SETTINGS', settings: latest });
      updateWeightSum();
    });
  });
  updateWeightSum();
}

function updateWeightSum() {
  const box = document.getElementById('ppWeights');
  const sumEl = document.getElementById('ppWeightSum');
  if (!box || !sumEl) return;
  let sum = 0;
  box.querySelectorAll('[data-w]').forEach((s) => {
    sum += Number(s.value) || 0;
  });
  sumEl.textContent = (sum / 100).toFixed(2);
}

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
    if (resp.anomaly) {
      dot.className = 'status-dot error';
      info.innerHTML = `<span style="color:#e74c3c;font-size:12px;">⚠️ Steam API 异常：近 ${resp.windowSec / 60} 分钟失败率 <b>${resp.failRate}%</b>（${resp.failed}/${resp.total} 次失败），疑似限流</span>
        <div style="font-size:11px;color:#8f98a0;margin-top:4px;">扩展已自动降低批量检索速度；建议稍后重试或减少连续刷新</div>`;
    } else if (resp.total < 8) {
      dot.className = 'status-dot';
      info.innerHTML = `<span style="font-size:12px;color:#8f98a0;">采样中：近 5 分钟 ${resp.total} 次调用（${resp.failed} 次失败）</span>`;
    } else {
      dot.className = 'status-dot ok';
      info.innerHTML = `<span style="font-size:12px;color:#a3cf06;">✅ Steam API 正常：近 ${resp.windowSec / 60} 分钟 ${resp.total} 次调用，失败 ${resp.failed} 次（${resp.failRate}%）${resp.limited > 0 ? `，限流 ${resp.limited} 次` : ''}</span>`;
    }
  } catch {
    info.innerHTML = '<span class="no-data">无法获取状态</span>';
  }
}

// ============ Load Free Games Count / 加载限免游戏数量 ============
async function loadFreeGamesCount() {
  try {
    const response = await window.__GR_MSG__.sendMessage({ action: 'GET_FREE_GAMES', force: false });
    if (response && response.data && response.data.games) {
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
    if (topKeywords.length > 0) {
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

// ============ 快速搜索（v7.4.0） ============
// Quick Steam search: candidates → click to open the store page
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const searchResults = document.getElementById('searchResults');

async function doSearch() {
  const name = (searchInput.value || '').trim();
  if (!name) return;
  searchResults.classList.remove('hidden');
  searchResults.textContent = '搜索中…';
  try {
    const resp = await window.__GR_MSG__.sendMessage({ action: 'SEARCH_STEAM_CANDIDATES', gameName: name });
    const cands = (resp && resp.candidates) || [];
    if (cands.length === 0) {
      searchResults.textContent = '未找到匹配的 Steam 游戏';
      return;
    }
    searchResults.innerHTML = '';
    cands.slice(0, 6).forEach((c) => {
      const row = document.createElement('div');
      row.className = 'search-result-row';
      row.textContent = c.name;
      row.title = '打开 Steam 商店页 (App ID ' + c.appId + ')';
      row.addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://store.steampowered.com/app/' + c.appId + '/' });
        window.close();
      });
      searchResults.appendChild(row);
    });
  } catch (e) {
    searchResults.textContent = '搜索失败：' + String(e);
  }
}
if (searchInput && searchBtn) {
  searchBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') doSearch();
  });
}
