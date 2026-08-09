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

// 游戏缓存管理状态 / Game cache management state
let cacheCurrentPage = 1;
const CACHE_PAGE_SIZE = 20;
let cacheSearchTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
    // 防御：后台未就绪时 response 可能为 undefined
    // Guard: response may be undefined if the service worker is not ready yet
    if (!response || !response.settings) {
      document.body.insertAdjacentHTML('afterbegin',
        '<div style="padding:16px;margin:16px auto;max-width:760px;background:#3a1a1a;color:#ff8a7a;border:1px solid #d94126;border-radius:8px;">⚠️ 无法加载设置，请刷新页面或重新启用扩展。</div>');
      return;
    }
    currentSettings = response.settings;
    renderSettings(currentSettings);
    bindEvents();
    bindTabEvents();   // 绑定标签页切换事件 / Bind tab switching events
    bindCacheEvents(); // 绑定游戏缓存管理事件 / Bind game cache management events
    populateCacheSiteFilter(); // 生成缓存页下载站筛选选项 / Build cache-page site filter options
    loadDataModules(); // 加载数据模块清单（勾选 UI）/ Load data-module list (checkbox UI)
    loadBackupsSelect(); // 加载备份列表（恢复下拉）/ Load backup list (restore dropdown)
  } catch (e) {
    console.error('[Game Recommender] 设置页加载失败:', e);
  }
});

// ============ 标签页切换 / Tab Switching ============
function bindTabEvents() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      // 切换按钮激活态 / Toggle button active state
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // 切换面板显示 / Toggle panel visibility
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      const panel = document.getElementById('tab-' + tabId);
      if (panel) panel.classList.add('active');
      // 切换到缓存标签时自动加载数据 / Auto-load data when switching to cache tab
      if (tabId === 'cache') {
        loadGameCache();
      }
    });
  });
}

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

  // 虚拟机标题过滤 / VM title filter
  document.getElementById('vmFilterEnabled').checked = settings.enableVmFilter || false;
  document.getElementById('vmFilterKeywords').value = (settings.vmFilterKeywords || ['虚拟机板', '虚拟机']).join(', ');

  // 权重设置 / Algorithm weights
  document.getElementById('weightClick').value = settings.weights.clickRate * 100;
  document.getElementById('weightClickVal').textContent = settings.weights.clickRate.toFixed(2);
  document.getElementById('weightDownload').value = settings.weights.downloadRate * 100;
  document.getElementById('weightDownloadVal').textContent = settings.weights.downloadRate.toFixed(2);
  document.getElementById('weightKeyword').value = settings.weights.keywordMatch * 100;
  document.getElementById('weightKeywordVal').textContent = settings.weights.keywordMatch.toFixed(2);
  document.getElementById('weightSteam').value = settings.weights.steamRating * 100;
  document.getElementById('weightSteamVal').textContent = settings.weights.steamRating.toFixed(2);
  updateWeightSum();

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
  // 下载站与追踪管理（合并展示：追踪行为 + Steam 检索范围）
  // Sites & tracking management (merged: track behavior + Steam-search scope)
  renderSiteManagement(settings);
}

// ============ 下载站与追踪管理渲染 / Sites & Tracking Management ============
// 规则站点行（追踪行为 / Steam 检索双开关）+ 自定义追踪站点标签列表。
// 追踪 = 行为学习；Steam 检索 = Steam 详情页与缓存更新的资源检索范围。
// Rule-site rows (track / Steam-search toggles) + custom tracked-site tags.
// Track = behavior learning; Steam search = the resource-search scope for
// Steam pages and cache refreshes.
function renderSiteManagement(settings) {
  const container = document.getElementById('siteManageList');
  if (!container) return;
  const rules = (globalThis.__GAME_RECOMMENDER_SITES__ || {}).sites || [];
  const tracked = settings.trackedSites || [];
  const steamSearch = settings.steamSiteSearch || [];

  container.innerHTML = rules.map(s => {
    const isTracked = s.domains.some(d => tracked.includes(d));
    const canSearch = !!s.searchUrl;
    return `
      <div class="site-manage-row">
        <span class="site-manage-name">${escapeHtml(s.name)} <small>${escapeHtml(s.domains[0])}</small></span>
        <label class="check-item" title="追踪该站点的浏览行为">
          <input type="checkbox" class="track-site-check" data-domain="${escapeAttr(s.domains[0])}" ${isTracked ? 'checked' : ''}>
          <span>追踪行为</span>
        </label>
        ${canSearch ? `
          <label class="check-item" title="在 Steam 详情页与缓存更新中检索该站点资源">
            <input type="checkbox" class="steam-site-check" data-site="${escapeAttr(s.key)}" ${steamSearch.includes(s.key) ? 'checked' : ''}>
            <span>Steam 检索</span>
          </label>
        ` : '<span class="no-search-hint">无站内搜索</span>'}
      </div>
    `;
  }).join('');

  // 自定义追踪站点（不在规则中的域名）/ Custom tracked sites (outside the rules)
  renderCustomSiteList(tracked, rules);
}

// 渲染自定义追踪站点标签（可删除）/ Render custom tracked-site tags (removable)
function renderCustomSiteList(tracked, rules) {
  const container = document.getElementById('siteList');
  if (!container) return;
  const isRuleDomain = (d) => rules.some(s => s.domains.some(x => d === x || d.includes(x)));
  const custom = tracked.filter(d => !isRuleDomain(d));
  container.innerHTML = custom.map(site => `
    <div class="site-item">
      <span>${escapeHtml(site)}</span>
      <button class="remove-site" data-domain="${escapeAttr(site)}">✕</button>
    </div>
  `).join('');

  // 绑定删除事件：按域名精确删除 / Bind removal by exact domain
  container.querySelectorAll('.remove-site').forEach(btn => {
    btn.addEventListener('click', () => {
      const domain = btn.dataset.domain;
      currentSettings.trackedSites = (currentSettings.trackedSites || []).filter(d => d !== domain);
      renderSiteManagement(currentSettings);
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

// ============ Weight Sum Indicator / 权重总和指示器 ============
// 实时计算四个权重之和并按接近 1.0 的程度切换颜色：绿（≈1.0）→ 橙（偏离 0.05+）→ 红（偏离 0.15+）。
// Computes the sum of the four weights live and switches color by closeness to 1.0.
function updateWeightSum() {
  const ids = ['weightClick', 'weightDownload', 'weightKeyword', 'weightSteam'];
  const sum = ids.reduce((acc, id) => acc + (parseInt(document.getElementById(id).value, 10) || 0), 0) / 100;
  const el = document.getElementById('weightSum');
  if (!el) return;
  el.textContent = sum.toFixed(2);
  const dev = Math.abs(sum - 1);
  el.classList.remove('warn', 'bad');
  if (dev >= 0.15) el.classList.add('bad');
  else if (dev >= 0.05) el.classList.add('warn');
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

  // 虚拟机过滤 / VM filter
  document.getElementById('vmFilterEnabled').addEventListener('change', () => scheduleAutoSave());
  document.getElementById('vmFilterKeywords').addEventListener('input', () => scheduleAutoSave());

  // 权重滑块 / Weight sliders
  const weightIds = ['weightClick', 'weightDownload', 'weightKeyword', 'weightSteam'];
  weightIds.forEach(id => {
    document.getElementById(id).addEventListener('input', (e) => {
      document.getElementById(`${id}Val`).textContent = (e.target.value / 100).toFixed(2);
      updateWeightSum();
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
      renderSiteManagement(currentSettings);
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
  document.getElementById('resetDefaults').addEventListener('click', resetDefaults);
  // 数据模块备份/恢复/全选 / Module backup/restore/select-all
  document.getElementById('createBackupBtn').addEventListener('click', createDataBackup);
  document.getElementById('restoreBackupBtn').addEventListener('click', restoreDataBackup);
  document.getElementById('moduleCheckAll').addEventListener('click', () => {
    selectedModules = new Set(dataModules.map(m => m.key));
    renderModuleChecks();
  });
  document.getElementById('moduleCheckNone').addEventListener('click', () => {
    selectedModules.clear();
    renderModuleChecks();
  });

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

  // 虚拟机过滤 / VM filter
  currentSettings.enableVmFilter = document.getElementById('vmFilterEnabled').checked;
  // 解析关键词输入：按逗号分隔，去空格和空项 / Parse keywords: split by comma, trim, drop empties
  const vmKeywordsRaw = document.getElementById('vmFilterKeywords').value
    .split(/[,，]/)
    .map(s => s.trim())
    .filter(Boolean);
  currentSettings.vmFilterKeywords = vmKeywordsRaw.length > 0 ? vmKeywordsRaw : ['虚拟机板', '虚拟机'];

  // Steam 详情页资源检索站点（勾选的下载站）/ Steam-page site search scope
  // 下载站与追踪管理：规则站点勾选的域名 + 保留的自定义域名 → trackedSites；
  // Steam 检索勾选 → steamSiteSearch（合并后的统一配置入口）
  const rules = (globalThis.__GAME_RECOMMENDER_SITES__ || {}).sites || [];
  const customSites = (currentSettings.trackedSites || []).filter(d =>
    !rules.some(s => s.domains.some(x => d === x || d.includes(x)))
  );
  const ruleTracked = [...document.querySelectorAll('.track-site-check:checked')]
    .map(cb => cb.dataset.domain);
  currentSettings.trackedSites = [...new Set([...customSites, ...ruleTracked])];
  currentSettings.steamSiteSearch = [...document.querySelectorAll('.steam-site-check:checked')]
    .map(cb => cb.dataset.site);

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

// ============ 数据模块管理 / Data Module Management ============
// 所有可备份/导入/导出的数据按模块组织（扩展配置/浏览记录/推荐模型/缓存/适配规则等），
// 支持自定义勾选参与备份、恢复、导入、导出。
// All backup/import/export-able data is organized into modules (settings/behavior/
// model/caches/adapter-rules…), with per-module selection for every operation.
let dataModules = [];
let selectedModules = new Set();

// 加载模块清单（含条目数）并渲染勾选 UI / Load the module list and render checkboxes
async function loadDataModules() {
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'GET_DATA_MODULES' });
    dataModules = (resp && resp.modules) || [];
    // 默认全选 / Default: select all
    selectedModules = new Set(dataModules.map(m => m.key));
    renderModuleChecks();
  } catch (e) {
    console.error('加载数据模块失败:', e);
  }
}

// 渲染模块勾选列表 / Render the module checkbox list
function renderModuleChecks() {
  const container = document.getElementById('moduleCheckList');
  if (!container) return;
  container.innerHTML = dataModules.map(m => `
    <label class="module-check-item">
      <input type="checkbox" class="module-check" data-module="${escapeAttr(m.key)}" ${selectedModules.has(m.key) ? 'checked' : ''}>
      <span class="module-check-name">${escapeHtml(m.name)}</span>
      <small class="module-check-desc">${escapeHtml(m.desc)}${m.count ? ` · ${m.count} 条` : ''}</small>
    </label>
  `).join('');
  container.querySelectorAll('.module-check').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedModules.add(cb.dataset.module);
      else selectedModules.delete(cb.dataset.module);
    });
  });
}

// 获取当前勾选的模块键 / Get the currently selected module keys
function getSelectedModuleKeys() {
  return [...selectedModules];
}

// 显示操作状态 / Show operation status
function showDataOpStatus(text, isError = false) {
  const el = document.getElementById('dataOpStatus');
  if (!el) return;
  el.textContent = text;
  el.className = 'data-op-status ' + (isError ? 'error' : 'ok');
  setTimeout(() => { el.textContent = ''; }, 4000);
}

// ============ Data Management / 数据管理 ============
async function exportData() {
  const keys = getSelectedModuleKeys();
  if (keys.length === 0) { alert('请先勾选要导出的数据类型'); return; }
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'EXPORT_DATA', moduleKeys: keys });
    if (!resp || !resp.success || !resp.data) { showDataOpStatus('导出失败', true); return; }
    const blob = new Blob([JSON.stringify(resp.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `game-recommender-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showDataOpStatus(`✅ 已导出 ${keys.length} 个模块`);
  } catch (e) {
    showDataOpStatus('导出失败: ' + e.message, true);
  }
}

async function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    // 校验导出文件格式 / Validate the export file format
    if (!payload || payload.format !== 'game-recommender-backup') {
      throw new Error('不是有效的 Game Recommender 导出文件');
    }
    const keys = getSelectedModuleKeys();
    const resp = await chrome.runtime.sendMessage({
      action: 'IMPORT_DATA',
      data: payload,
      moduleKeys: keys
    });
    if (resp && resp.success) {
      // 重新加载设置与模块数据 / Reload settings and module data
      const sr = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
      if (sr && sr.settings) {
        currentSettings = sr.settings;
        renderSettings(currentSettings);
      }
      loadDataModules();
      loadBackupsSelect();
      showDataOpStatus(`✅ 已导入 ${(resp.imported || []).length} 个模块，请重新加载相关页面生效`);
    } else {
      showDataOpStatus('导入失败: ' + (resp ? resp.error : '未知错误'), true);
    }
  } catch (err) {
    showDataOpStatus('导入失败: ' + err.message, true);
  }
  e.target.value = '';
}

// 创建备份（所选模块）/ Create a backup of the selected modules
async function createDataBackup() {
  const keys = getSelectedModuleKeys();
  if (keys.length === 0) { alert('请先勾选要备份的数据类型'); return; }
  const resp = await chrome.runtime.sendMessage({ action: 'CREATE_BACKUP', moduleKeys: keys });
  if (resp && resp.success) {
    showDataOpStatus('✅ 备份成功 (' + keys.length + ' 个模块)');
    loadBackupsSelect();
  } else {
    showDataOpStatus('备份失败', true);
  }
}

// 加载备份列表到恢复下拉框 / Load backups into the restore dropdown
async function loadBackupsSelect() {
  const select = document.getElementById('restoreBackupSelect');
  const btn = document.getElementById('restoreBackupBtn');
  if (!select) return;
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'GET_BACKUPS' });
    const backups = (resp && resp.backups) || [];
    select.innerHTML = '<option value="">选择备份...</option>' + backups.map(b => {
      const time = new Date(b.timestamp).toLocaleString('zh-CN');
      const modCount = b.modules ? b.modules.length : '全部';
      return `<option value="${escapeAttr(b.id)}">${b.manual ? '🔧' : '⏰'} ${time} (${modCount} 模块)</option>`;
    }).join('');
    btn.disabled = backups.length === 0;
  } catch (e) {
    select.innerHTML = '<option value="">备份加载失败</option>';
  }
}

// 恢复所选模块 / Restore the selected modules from a backup
async function restoreDataBackup() {
  const backupId = document.getElementById('restoreBackupSelect').value;
  if (!backupId) { alert('请先选择要恢复的备份'); return; }
  const keys = getSelectedModuleKeys();
  if (keys.length === 0) { alert('请先勾选要恢复的数据类型'); return; }
  if (!confirm('恢复将覆盖当前所选模块的数据（系统会先自动备份当前状态）。确定继续？')) return;
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'RESTORE_BACKUP', backupId, moduleKeys: keys });
    if (resp && resp.success) {
      const sr = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
      if (sr && sr.settings) {
        currentSettings = sr.settings;
        renderSettings(currentSettings);
      }
      loadDataModules();
      showDataOpStatus('✅ 恢复成功，请重新加载相关页面生效');
    } else {
      showDataOpStatus('恢复失败: ' + (resp ? resp.error : '未知错误'), true);
    }
  } catch (e) {
    showDataOpStatus('恢复失败: ' + e.message, true);
  }
}

async function clearData() {
  if (confirm('确定要清除所有学习数据吗？此操作不可恢复。')) {
    await chrome.runtime.sendMessage({ action: 'CLEAR_DATA' });
    alert('学习数据已清除');
  }
}

// ============ Reset to Defaults / 恢复默认设置 ============
// 仅重置设置项，不影响浏览历史/画像等运行时数据。
// Resets settings only; runtime data (history/profiles) is preserved.
async function resetDefaults() {
  if (!confirm('确定要将所有设置恢复为默认值吗？\n（浏览历史和游戏画像等数据不会被清除）')) return;
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'RESET_SETTINGS' });
    if (resp && resp.settings) {
      currentSettings = resp.settings;
      renderSettings(currentSettings);
      showSaveStatus('saved');
    } else {
      alert('恢复默认设置失败，请重试。');
    }
  } catch (e) {
    alert('恢复默认设置失败: ' + e.message);
  }
}

// ============ 游戏缓存管理 / Game Cache Management ============
// 查看、检索、删除已记录的游戏信息（以 Steam AppID 为唯一标识）。
// View, search, and delete recorded game info (keyed by Steam AppID).

// 绑定缓存管理事件 / Bind cache management events
function bindCacheEvents() {
  // 搜索按钮 / Search button
  document.getElementById('cacheSearchBtn').addEventListener('click', () => {
    cacheCurrentPage = 1;
    loadGameCache();
  });
  // 搜索框回车 / Enter key in search input
  document.getElementById('cacheSearchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      cacheCurrentPage = 1;
      loadGameCache();
    }
  });
  // 搜索框防抖（300ms）/ Debounced search (300ms)
  document.getElementById('cacheSearchInput').addEventListener('input', () => {
    if (cacheSearchTimer) clearTimeout(cacheSearchTimer);
    cacheSearchTimer = setTimeout(() => {
      cacheCurrentPage = 1;
      loadGameCache();
    }, 300);
  });
  // 好评率 / 标签 / 站点筛选：变更即搜索（防抖 300ms）
  // Rating / tag / site filters: search on change (debounced 300ms)
  ['cacheMinRating', 'cacheTagInput', 'cacheSiteFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      if (cacheSearchTimer) clearTimeout(cacheSearchTimer);
      cacheSearchTimer = setTimeout(() => {
        cacheCurrentPage = 1;
        loadGameCache();
      }, 300);
    });
    el.addEventListener('change', () => {
      if (cacheSearchTimer) clearTimeout(cacheSearchTimer);
      cacheCurrentPage = 1;
      loadGameCache();
    });
  });
  // 刷新按钮 / Refresh button
  document.getElementById('cacheRefreshBtn').addEventListener('click', () => loadGameCache());
  // 清空全部 / Clear all
  document.getElementById('cacheClearAllBtn').addEventListener('click', clearAllCache);
}

// 生成缓存页下载站筛选选项（来自规则文件）/ Build cache-page site filter options (from rules file)
function populateCacheSiteFilter() {
  const select = document.getElementById('cacheSiteFilter');
  if (!select) return;
  const rules = (globalThis.__GAME_RECOMMENDER_SITES__ || {}).sites || [];
  rules.filter(s => s.searchUrl).forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.key;
    opt.textContent = s.name;
    select.appendChild(opt);
  });
}

// 加载游戏缓存列表 / Load game cache list
async function loadGameCache() {
  const keyword = document.getElementById('cacheSearchInput').value.trim();
  const minRating = parseInt(document.getElementById('cacheMinRating').value) || 0;
  const tag = document.getElementById('cacheTagInput').value.trim();
  const siteKey = document.getElementById('cacheSiteFilter').value;
  const tbody = document.getElementById('cacheTableBody');
  const statsEl = document.getElementById('cacheStats');

  // 显示加载中 / Show loading state
  tbody.innerHTML = '<tr><td colspan="8" class="cache-empty">加载中...</td></tr>';
  statsEl.textContent = '';

  try {
    const resp = await chrome.runtime.sendMessage({
      action: 'GET_GAME_CACHE_LIST',
      keyword,
      minRating,
      tag,
      siteKey,
      page: cacheCurrentPage,
      pageSize: CACHE_PAGE_SIZE
    });

    if (!resp || !resp.games) {
      tbody.innerHTML = '<tr><td colspan="8" class="cache-empty">加载失败，请重试</td></tr>';
      return;
    }

    // 渲染统计信息 / Render stats
    statsEl.textContent = `共 ${resp.total} 条记录 · 第 ${resp.page}/${resp.totalPages} 页`;

    if (resp.games.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="cache-empty">暂无缓存数据</td></tr>';
      renderPagination(0, 1);
      return;
    }

    // 渲染表格行（封面缩略图 + 好评率徽章 + 可点击 appId + 手动更新按钮）
    // Render table rows (cover thumbnail + rating badge + clickable appId + refresh button)
    tbody.innerHTML = resp.games.map(g => `
      <tr>
        <td class="col-cover">
          ${g.coverImage
            ? `<img src="${escapeAttr(g.coverImage)}" class="cache-cover" loading="lazy" alt="" title="${escapeAttr(g.cnName || g.appId)}">`
            : '—'}
        </td>
        <td class="col-appid">
          ${formatRatingBadge(g.positiveRate)}
          <a href="https://store.steampowered.com/app/${escapeAttr(g.appId)}" target="_blank" rel="noopener" title="打开 Steam 详情页">${escapeHtml(g.appId)}</a>
          <button class="cache-refresh-btn" data-appid="${escapeAttr(g.appId)}" title="手动更新 Steam 信息与下载站地址">🔄</button>
        </td>
        <td class="col-name" title="${escapeAttr(g.cnName)}">${escapeHtml(g.cnName || '—')}</td>
        <td class="col-name" title="${escapeAttr(g.enName)}">${escapeHtml(g.enName || '—')}</td>
        <td class="col-time">${formatTime(g.lastConfirmed)}</td>
        <td class="col-url">${formatDownloadUrls(g.downloadUrls, g.primaryDownloadUrl)}</td>
        <td class="col-time">${formatTime(g.lastAccessed)}</td>
        <td><button class="cache-delete-btn" data-appid="${escapeAttr(g.appId)}">删除</button></td>
      </tr>
    `).join('');

    // 绑定删除按钮事件 / Bind delete button events
    tbody.querySelectorAll('.cache-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteCacheEntry(btn.dataset.appid));
    });

    // 绑定手动更新按钮事件 / Bind manual refresh button events
    tbody.querySelectorAll('.cache-refresh-btn').forEach(btn => {
      btn.addEventListener('click', () => refreshCacheEntry(btn.dataset.appid, btn));
    });

    // 渲染分页 / Render pagination
    renderPagination(resp.total, resp.totalPages);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" class="cache-empty">加载失败: ${escapeHtml(e.message)}</td></tr>`;
  }
}

// 好评率徽章（颜色分级；无数据显示灰色"暂无"）
// Rating badge (color-graded; grey "暂无" when no data)
function formatRatingBadge(rate) {
  if (rate === null || rate === undefined) {
    return `<span class="rating-badge" style="color:#8f98a0;background:rgba(143,152,160,0.12);border-color:#3a3a4a;">暂无</span>`;
  }
  const color = rate >= 80 ? '#66c0f4' : rate >= 60 ? '#a3cf06' : '#ff7b00';
  const bg = rate >= 80 ? 'rgba(102,192,244,0.15)' : rate >= 60 ? 'rgba(163,207,6,0.15)' : 'rgba(255,123,0,0.15)';
  return `<span class="rating-badge" style="color:${color};background:${bg};border-color:${color};">${rate}%</span>`;
}

// 手动更新单条缓存：重新获取 Steam 官方中英文名/标签，并按设置的
// 下载站范围更新下载站地址（检索范围与 Steam 详情页一致）
// Manually refresh one entry: re-fetch Steam official CN/EN names/tags and update
// download-site URLs within the same scope configured for Steam pages
async function refreshCacheEntry(appId, btn) {
  if (!btn) return;
  const originalText = btn.textContent;
  btn.textContent = '⏳';
  btn.disabled = true;
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'REFRESH_GAME_CACHE_ENTRY', appId });
    if (resp && resp.success) {
      btn.textContent = '✅';
      setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 1200);
      loadGameCache(); // 刷新列表 / Reload list
    } else {
      btn.textContent = '❌';
      setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 1500);
      alert('更新失败: ' + (resp ? resp.error : '未知错误'));
    }
  } catch (e) {
    btn.textContent = '❌';
    setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 1500);
    alert('更新失败: ' + e.message);
  }
}

// 渲染分页控件 / Render pagination controls
function renderPagination(total, totalPages) {
  const container = document.getElementById('cachePagination');
  if (total === 0 || totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '';
  // 上一页 / Previous page
  html += `<button ${cacheCurrentPage <= 1 ? 'disabled' : ''} data-page="${cacheCurrentPage - 1}">‹ 上一页</button>`;

  // 页码按钮（最多显示7个）/ Page number buttons (max 7)
  const maxButtons = 7;
  let start = Math.max(1, cacheCurrentPage - 3);
  let end = Math.min(totalPages, start + maxButtons - 1);
  start = Math.max(1, end - maxButtons + 1);

  if (start > 1) {
    html += `<button data-page="1">1</button>`;
    if (start > 2) html += `<span class="page-info">...</span>`;
  }
  for (let i = start; i <= end; i++) {
    html += `<button class="${i === cacheCurrentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
  }
  if (end < totalPages) {
    if (end < totalPages - 1) html += `<span class="page-info">...</span>`;
    html += `<button data-page="${totalPages}">${totalPages}</button>`;
  }

  // 下一页 / Next page
  html += `<button ${cacheCurrentPage >= totalPages ? 'disabled' : ''} data-page="${cacheCurrentPage + 1}">下一页 ›</button>`;
  html += `<span class="page-info">共 ${total} 条</span>`;

  container.innerHTML = html;

  // 绑定分页按钮事件 / Bind pagination button events
  container.querySelectorAll('button[data-page]').forEach(btn => {
    if (btn.disabled) return;
    btn.addEventListener('click', () => {
      cacheCurrentPage = parseInt(btn.dataset.page);
      loadGameCache();
    });
  });
}

// 删除单个游戏缓存 / Delete a single game's cache
async function deleteCacheEntry(appId) {
  if (!confirm(`确定要删除 AppID ${appId} 的缓存吗？`)) return;
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'DELETE_GAME_CACHE_ENTRY', appId });
    if (resp && resp.success) {
      loadGameCache(); // 刷新列表 / Refresh list
    } else {
      alert('删除失败: ' + (resp ? resp.error : '未知错误'));
    }
  } catch (e) {
    alert('删除失败: ' + e.message);
  }
}

// 清空全部游戏缓存 / Clear all game cache
async function clearAllCache() {
  if (!confirm('确定要清空全部游戏缓存吗？此操作不可恢复。\n\n将清除：\n· 游戏注册表（中英文名映射）\n· Steam 动态缓存（好评率/评论）\n· 下载站详情页网址缓存\n· 名称索引')) return;
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'CLEAR_GAME_CACHE' });
    if (resp && resp.success) {
      cacheCurrentPage = 1;
      loadGameCache();
    } else {
      alert('清空失败，请重试');
    }
  } catch (e) {
    alert('清空失败: ' + e.message);
  }
}

// ============ 缓存页面工具函数 / Cache Page Utility Functions ============

// HTML 转义 / HTML escape
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}
// 属性转义（用于 title 属性）/ Attribute escape (for title attribute)
function escapeAttr(text) {
  return (text || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 格式化时间戳为可读字符串 / Format timestamp to readable string
function formatTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  // 1小时内显示"xx分钟前" / Within 1h: "xx minutes ago"
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  // 24小时内显示"xx小时前" / Within 24h: "xx hours ago"
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  // 30天内显示"xx天前" / Within 30d: "xx days ago"
  if (diff < 2592000000) return `${Math.floor(diff / 86400000)}天前`;
  // 超过30天显示日期 / Over 30d: show date
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 格式化下载站网址（主网址 + 展开链接）/ Format download URLs (primary + expandable)
function formatDownloadUrls(downloadUrls, primaryUrl) {
  if (!downloadUrls || downloadUrls.length === 0) {
    return primaryUrl ? `<a href="${escapeAttr(primaryUrl)}" target="_blank" rel="noopener">${escapeHtml(truncateUrl(primaryUrl))}</a>` : '—';
  }
  // 显示所有站点的网址 / Show all site URLs
  return downloadUrls.map(u => `
    <div style="margin-bottom:2px;">
      <span style="color:#8f98a0;font-size:10px;">${escapeHtml(u.siteName)}:</span>
      <a href="${escapeAttr(u.url)}" target="_blank" rel="noopener">${escapeHtml(truncateUrl(u.url))}</a>
    </div>
  `).join('');
}

// 截断过长 URL / Truncate long URL
function truncateUrl(url, maxLen = 40) {
  if (!url) return '';
  if (url.length <= maxLen) return url;
  return url.substring(0, maxLen) + '...';
}
