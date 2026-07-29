/**
 * Game Recommender - Options Script
 * 设置页面逻辑 / Options page logic
 *
 * Features:
 * - Auto-save with debounce (no manual save needed)
 * - Real-time setting synchronization with background
 * - Bilingual comments for maintainability
 *
 * 功能：
 * - 防抖自动保存（无需手动保存）
 * - 实时同步设置到后台
 * - 中英双语注释
 */

let currentSettings = null;
let saveTimer = null; // Auto-save debounce timer / 防抖定时器

document.addEventListener('DOMContentLoaded', async () => {
  const response = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
  currentSettings = response.settings;
  renderSettings(currentSettings);
  bindEvents();
});

// ============ Render Settings / 渲染设置 ============
function renderSettings(settings) {
  // 基本设置 / Basic settings
  document.getElementById('enabled').checked = settings.enabled;
  document.getElementById('threshold').value = settings.highlightThreshold * 100;
  document.getElementById('thresholdVal').textContent = `${settings.highlightThreshold * 100}%`;
  document.getElementById('maxLog').value = settings.maxBehaviorLog;

  // Steam 好评率过滤 / Steam rating filter
  document.getElementById('ratingFilterEnabled').checked = settings.enableRatingFilter || false;
  document.getElementById('minRating').value = settings.minSteamRatingFilter || 0;
  document.getElementById('minRatingVal').textContent = `${settings.minSteamRatingFilter || 0}%`;

  // 权重设置 / Algorithm weights
  document.getElementById('weightClick').value = settings.weights.clickRate * 100;
  document.getElementById('weightClickVal').textContent = settings.weights.clickRate.toFixed(2);
  document.getElementById('weightDownload').value = settings.weights.downloadRate * 100;
  document.getElementById('weightDownloadVal').textContent = settings.weights.downloadRate.toFixed(2);
  document.getElementById('weightKeyword').value = settings.weights.keywordMatch * 100;
  document.getElementById('weightKeywordVal').textContent = settings.weights.keywordMatch.toFixed(2);
  document.getElementById('weightSteam').value = settings.weights.steamRating * 100;
  document.getElementById('weightSteamVal').textContent = settings.weights.steamRating.toFixed(2);

  // LLM 设置 / LLM settings
  document.getElementById('useLLM').checked = settings.useLLM;
  document.getElementById('llmProvider').value = settings.llmConfig.provider;
  document.getElementById('llmEndpoint').value = settings.llmConfig.endpoint;
  document.getElementById('llmApiKey').value = settings.llmConfig.apiKey;
  document.getElementById('llmModel').value = settings.llmConfig.model;
  document.getElementById('llmTemp').value = settings.llmConfig.temperature * 100;
  document.getElementById('llmTempVal').textContent = settings.llmConfig.temperature.toFixed(1);

  toggleLLMSettings();
  toggleApiKeyRow();

  // 网站列表 / Tracked sites
  renderSiteList(settings.trackedSites);
}

// ============ Site List Rendering / 网站列表渲染 ============
function renderSiteList(sites) {
  const container = document.getElementById('siteList');
  container.innerHTML = sites.map((site, i) => `
    <div class="site-item">
      <span>${site}</span>
      <button class="remove-site" data-index="${i}">✕</button>
    </div>
  `).join('');

  container.querySelectorAll('.remove-site').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index);
      currentSettings.trackedSites.splice(index, 1);
      renderSiteList(currentSettings.trackedSites);
      scheduleAutoSave(); // Auto-save after removal / 删除后自动保存
    });
  });
}

// ============ UI Toggles / UI 切换 ============
function toggleLLMSettings() {
  const useLLM = document.getElementById('useLLM').checked;
  document.getElementById('llmSettings').style.display = useLLM ? 'block' : 'none';
}

function toggleApiKeyRow() {
  const provider = document.getElementById('llmProvider').value;
  document.getElementById('apiKeyRow').style.display = provider === 'local' ? 'none' : 'flex';
}

// ============ Event Binding / 事件绑定 ============
function bindEvents() {
  // 阈值滑块 / Threshold slider
  document.getElementById('threshold').addEventListener('input', (e) => {
    document.getElementById('thresholdVal').textContent = `${e.target.value}%`;
    scheduleAutoSave();
  });

  // 好评率过滤 / Rating filter
  document.getElementById('ratingFilterEnabled').addEventListener('change', () => {
    scheduleAutoSave();
  });
  document.getElementById('minRating').addEventListener('input', (e) => {
    document.getElementById('minRatingVal').textContent = `${e.target.value}%`;
    scheduleAutoSave();
  });

  // 权重滑块 / Weight sliders
  const weightIds = ['weightClick', 'weightDownload', 'weightKeyword', 'weightSteam'];
  weightIds.forEach(id => {
    document.getElementById(id).addEventListener('input', (e) => {
      document.getElementById(`${id}Val`).textContent = (e.target.value / 100).toFixed(2);
      scheduleAutoSave();
    });
  });

  // 基本设置 / Basic settings
  document.getElementById('enabled').addEventListener('change', () => scheduleAutoSave());
  document.getElementById('maxLog').addEventListener('change', () => scheduleAutoSave());

  // LLM 开关 / LLM toggle
  document.getElementById('useLLM').addEventListener('change', () => {
    toggleLLMSettings();
    scheduleAutoSave();
  });

  // LLM 提供商切换 / LLM provider switch
  document.getElementById('llmProvider').addEventListener('change', (e) => {
    toggleApiKeyRow();
    // 预设端点 / Preset endpoints
    const presets = {
      local: 'http://localhost:11434/api/generate',
      openai: 'https://api.openai.com/v1/chat/completions',
      custom: ''
    };
    if (presets[e.target.value]) {
      document.getElementById('llmEndpoint').value = presets[e.target.value];
    }
    scheduleAutoSave();
  });

  // LLM 文本输入 / LLM text inputs (debounced)
  ['llmEndpoint', 'llmApiKey', 'llmModel'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => scheduleAutoSave());
  });

  // Temperature
  document.getElementById('llmTemp').addEventListener('input', (e) => {
    document.getElementById('llmTempVal').textContent = (e.target.value / 100).toFixed(1);
    scheduleAutoSave();
  });

  // 测试 LLM 连接 / Test LLM connection
  document.getElementById('testLLM').addEventListener('click', testLLMConnection);

  // 添加网站 / Add site
  document.getElementById('addSite').addEventListener('click', () => {
    const input = document.getElementById('newSite');
    const site = input.value.trim().toLowerCase();
    if (site && !currentSettings.trackedSites.includes(site)) {
      currentSettings.trackedSites.push(site);
      renderSiteList(currentSettings.trackedSites);
      input.value = '';
      scheduleAutoSave();
    }
  });

  document.getElementById('newSite').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('addSite').click();
  });

  // 数据管理 / Data management
  document.getElementById('exportData').addEventListener('click', exportData);
  document.getElementById('importData').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', importData);
  document.getElementById('clearData').addEventListener('click', clearData);

  // 手动保存（立即保存）/ Manual save (immediate)
  document.getElementById('saveBtn').addEventListener('click', () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    saveSettings();
  });
}

// ============ Auto-Save with Debounce / 防抖自动保存 ============
// Collects current UI values into currentSettings and saves after 800ms of inactivity.
// 收集当前 UI 值到 currentSettings，在 800ms 无操作后保存。
function scheduleAutoSave() {
  showSaveStatus('saving');
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    await saveSettings();
  }, 800);
}

// ============ Collect & Save Settings / 收集并保存设置 ============
async function saveSettings() {
  // Collect all values from UI / 从 UI 收集所有值
  currentSettings.enabled = document.getElementById('enabled').checked;
  currentSettings.highlightThreshold = document.getElementById('threshold').value / 100;
  currentSettings.maxBehaviorLog = parseInt(document.getElementById('maxLog').value);

  // 好评率过滤 / Rating filter
  currentSettings.enableRatingFilter = document.getElementById('ratingFilterEnabled').checked;
  currentSettings.minSteamRatingFilter = parseInt(document.getElementById('minRating').value);

  // 权重 / Weights
  currentSettings.weights = {
    clickRate: document.getElementById('weightClick').value / 100,
    downloadRate: document.getElementById('weightDownload').value / 100,
    keywordMatch: document.getElementById('weightKeyword').value / 100,
    steamRating: document.getElementById('weightSteam').value / 100
  };

  // LLM 配置 / LLM config
  currentSettings.useLLM = document.getElementById('useLLM').checked;
  currentSettings.llmConfig = {
    provider: document.getElementById('llmProvider').value,
    endpoint: document.getElementById('llmEndpoint').value.trim(),
    apiKey: document.getElementById('llmApiKey').value.trim(),
    model: document.getElementById('llmModel').value.trim(),
    temperature: document.getElementById('llmTemp').value / 100
  };

  await chrome.runtime.sendMessage({ action: 'SAVE_SETTINGS', settings: currentSettings });
  showSaveStatus('saved');
}

// ============ Save Status Indicator / 保存状态指示器 ============
function showSaveStatus(state) {
  const status = document.getElementById('saveStatus');
  if (state === 'saving') {
    status.textContent = '⏳ 保存中...';
    status.className = 'save-status saving';
  } else if (state === 'saved') {
    status.textContent = '✅ 已保存';
    status.className = 'save-status saved';
    setTimeout(() => {
      status.textContent = '';
      status.className = 'save-status';
    }, 2000);
  }
}

// ============ Test LLM Connection / 测试 LLM 连接 ============
async function testLLMConnection() {
  const resultEl = document.getElementById('llmTestResult');
  resultEl.textContent = '测试中...';
  resultEl.className = 'test-result';

  const provider = document.getElementById('llmProvider').value;
  const endpoint = document.getElementById('llmEndpoint').value;
  const apiKey = document.getElementById('llmApiKey').value;
  const model = document.getElementById('llmModel').value;

  try {
    let response;
    if (provider === 'local') {
      // Ollama - 测试模型列表 / Test model list
      const testUrl = endpoint.replace('/api/generate', '/api/tags');
      response = await fetch(testUrl, { method: 'GET' });
      if (response.ok) {
        const data = await response.json();
        const models = data.models || [];
        const hasModel = models.some(m => m.name.includes(model));
        if (hasModel) {
          resultEl.textContent = `✅ 连接成功，模型 ${model} 可用`;
        } else {
          resultEl.textContent = `⚠️ 连接成功，但未找到模型 ${model}。可用: ${models.map(m => m.name).join(', ')}`;
        }
        resultEl.className = 'test-result success';
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } else {
      // OpenAI 兼容接口 / OpenAI-compatible API
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 5
        })
      });
      if (response.ok) {
        resultEl.textContent = '✅ 连接成功';
        resultEl.className = 'test-result success';
      } else {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${response.status}`);
      }
    }
  } catch (e) {
    resultEl.textContent = `❌ 连接失败: ${e.message}`;
    resultEl.className = 'test-result error';
  }
}

// ============ Data Management / 数据管理 ============
async function exportData() {
  const data = await chrome.storage.local.get(null);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `game-recommender-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importData(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await chrome.storage.local.set(data);
    // 重新加载设置 / Reload settings
    const response = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
    currentSettings = response.settings;
    renderSettings(currentSettings);
    alert('数据导入成功！');
  } catch (err) {
    alert('导入失败: ' + err.message);
  }
  e.target.value = '';
}

async function clearData() {
  if (confirm('确定要清除所有学习数据吗？此操作不可恢复。')) {
    await chrome.runtime.sendMessage({ action: 'CLEAR_DATA' });
    alert('学习数据已清除');
  }
}
