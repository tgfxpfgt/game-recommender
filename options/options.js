/**
 * Game Recommender - 设置页入口 / Options Entry
 *
 * 模块化架构（经典脚本顺序加载，经 window.__OPTS__ 共享状态）：
 *   shared/escape.js      全局转义工具
 *   panels/settings.js    设置渲染/站点管理/LLM 测试
 *   panels/cache.js       游戏缓存管理
 *   panels/data-manage.js 数据模块管理（备份/导入/导出）
 *
 * 本文件负责：共享状态、初始化、事件绑定与自动保存。
 * This entry wires shared state, initialization, event binding and auto-save.
 */
(function (global) {
  'use strict';

  // ============ 共享状态 / Shared State ============
  const OPTS = (global.__OPTS__ = global.__OPTS__ || {});
  OPTS.currentSettings = null;
  OPTS.saveTimer = null; // 防抖定时器 / debounce timer
  OPTS.cacheCurrentPage = 1;
  OPTS.CACHE_PAGE_SIZE = 20;
  OPTS.cacheSearchTimer = null;

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
      // 防御：后台未就绪时 response 可能为 undefined
      if (!response || !response.settings) {
        document.body.insertAdjacentHTML('afterbegin',
          '<div style="padding:16px;margin:16px auto;max-width:760px;background:#3a1a1a;color:#ff8a7a;border:1px solid #d94126;border-radius:8px;">⚠️ 无法加载设置，请刷新页面或重新启用扩展。</div>');
        return;
      }
      OPTS.currentSettings = response.settings;
      OPTS.renderSettings(OPTS.currentSettings);
      bindEvents();
      bindTabEvents();   // 侧边栏分类切换
      OPTS.bindCacheEvents(); // 游戏缓存管理
      OPTS.bindRulesEvents(); // 规则管理（v3.0.0）
      OPTS.populateCacheSiteFilter(); // 缓存页下载站筛选
      OPTS.loadDataModules(); // 数据模块清单（勾选 UI）
      OPTS.loadBackupsSelect(); // 备份列表（恢复下拉）
    } catch (e) {
      console.error('[Game Recommender] 设置页加载失败:', e);
    }
  });

  // ============ 侧边栏分类切换 / Sidebar Category Switching ============
  // Chrome 设置页风格：左侧分类导航 + 右侧内容面板
  function bindTabEvents() {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const panelId = btn.dataset.panel;
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
        const panel = document.getElementById('panel-' + panelId);
        if (panel) panel.classList.add('active');
        // 切换到缓存面板时自动加载数据
        if (panelId === 'cache') {
          OPTS.loadGameCache();
        }
        // 切换到规则面板时加载规则
        if (panelId === 'rules') {
          OPTS.loadRules();
        }
      });
    });
  }

  // ============ Event Binding / 事件绑定 ============
  function bindEvents() {
    // 阈值滑块
    document.getElementById('threshold').addEventListener('input', (e) => {
      document.getElementById('thresholdVal').textContent = `${e.target.value}%`;
      scheduleAutoSave();
    });

    // 好评率过滤
    document.getElementById('ratingFilterEnabled').addEventListener('change', () => {
      scheduleAutoSave();
    });
    document.getElementById('minRating').addEventListener('input', (e) => {
      document.getElementById('minRatingVal').textContent = `${e.target.value}%`;
      scheduleAutoSave();
    });

    // 虚拟机过滤
    document.getElementById('vmFilterEnabled').addEventListener('change', () => scheduleAutoSave());
    document.getElementById('vmFilterKeywords').addEventListener('input', () => scheduleAutoSave());

    // 权重滑块
    const weightIds = ['weightClick', 'weightDownload', 'weightKeyword', 'weightSteam'];
    weightIds.forEach(id => {
      document.getElementById(id).addEventListener('input', (e) => {
        document.getElementById(`${id}Val`).textContent = (e.target.value / 100).toFixed(2);
        OPTS.updateWeightSum();
        scheduleAutoSave();
      });
    });

    // 基本设置
    document.getElementById('enabled').addEventListener('change', () => scheduleAutoSave());
    document.getElementById('maxLog').addEventListener('change', () => scheduleAutoSave());

    // LLM 开关
    document.getElementById('useLLM').addEventListener('change', () => {
      OPTS.toggleLLMSettings();
      scheduleAutoSave();
    });

    // LLM 提供商切换
    document.getElementById('llmProvider').addEventListener('change', (e) => {
      OPTS.toggleApiKeyRow();
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

    // LLM 文本输入（防抖自动保存）
    ['llmEndpoint', 'llmApiKey', 'llmModel'].forEach(id => {
      document.getElementById(id).addEventListener('input', () => scheduleAutoSave());
    });

    // Temperature
    document.getElementById('llmTemp').addEventListener('input', (e) => {
      document.getElementById('llmTempVal').textContent = (e.target.value / 100).toFixed(1);
      scheduleAutoSave();
    });

    // 测试 LLM 连接
    document.getElementById('testLLM').addEventListener('click', OPTS.testLLMConnection);

    // 添加网站
    document.getElementById('addSite').addEventListener('click', () => {
      const input = document.getElementById('newSite');
      const site = input.value.trim().toLowerCase();
      if (site && !OPTS.currentSettings.trackedSites.includes(site)) {
        OPTS.currentSettings.trackedSites.push(site);
        OPTS.renderSiteManagement(OPTS.currentSettings);
        input.value = '';
        scheduleAutoSave();
      }
    });

    document.getElementById('newSite').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') document.getElementById('addSite').click();
    });

    // 数据管理
    document.getElementById('exportData').addEventListener('click', OPTS.exportData);
    document.getElementById('importData').addEventListener('click', () => {
      document.getElementById('importFile').click();
    });
    document.getElementById('importFile').addEventListener('change', OPTS.importData);
    document.getElementById('clearData').addEventListener('click', OPTS.clearData);
    document.getElementById('resetDefaults').addEventListener('click', OPTS.resetDefaults);
    // 数据模块备份/恢复/全选
    document.getElementById('createBackupBtn').addEventListener('click', OPTS.createDataBackup);
    document.getElementById('restoreBackupBtn').addEventListener('click', OPTS.restoreDataBackup);
    document.getElementById('moduleCheckAll').addEventListener('click', OPTS.moduleCheckAll);
    document.getElementById('moduleCheckNone').addEventListener('click', OPTS.moduleCheckNone);

    // 手动保存（立即保存）
    document.getElementById('saveBtn').addEventListener('click', () => {
      if (OPTS.saveTimer) { clearTimeout(OPTS.saveTimer); OPTS.saveTimer = null; }
      saveSettings();
    });

    // 缓存有效期输入（变更即自动保存；v3.3.7 补全 ttlDetailSteam/ttlSpySteam/ttlMetaSteam）
    ['ttlSteamDynamic', 'ttlDetailSteam', 'ttlSpySteam', 'ttlMetaSteam', 'ttlRegistryConfirm', 'ttlDownloadUrls', 'ttlNegativeCache'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', () => scheduleAutoSave());
      el.addEventListener('input', () => scheduleAutoSave());
    });

    // 日志配置（变更即自动保存）
    document.getElementById('logEnabled').addEventListener('change', () => scheduleAutoSave());
    document.getElementById('logLevel').addEventListener('change', () => scheduleAutoSave());
    document.getElementById('logRetentionDays').addEventListener('change', () => scheduleAutoSave());
    document.getElementById('logStorage').addEventListener('change', () => scheduleAutoSave());
  }

  // ============ Auto-Save with Debounce / 防抖自动保存 ============
  function scheduleAutoSave() {
    showSaveStatus('saving');
    if (OPTS.saveTimer) clearTimeout(OPTS.saveTimer);
    OPTS.saveTimer = setTimeout(async () => {
      OPTS.saveTimer = null;
      await saveSettings();
    }, 800);
  }

  // ============ Collect & Save Settings / 收集并保存设置 ============
  async function saveSettings() {
    // 从 UI 收集所有值
    OPTS.currentSettings.enabled = document.getElementById('enabled').checked;
    OPTS.currentSettings.showStatusBar = document.getElementById('showStatusBar').checked;
    OPTS.currentSettings.showDebugPanel = document.getElementById('showDebugPanel').checked;
    OPTS.currentSettings.highlightThreshold = document.getElementById('threshold').value / 100;
    OPTS.currentSettings.maxBehaviorLog = parseInt(document.getElementById('maxLog').value);

    // 好评率过滤
    OPTS.currentSettings.enableRatingFilter = document.getElementById('ratingFilterEnabled').checked;
    OPTS.currentSettings.minSteamRatingFilter = parseInt(document.getElementById('minRating').value);

    // 虚拟机过滤
    OPTS.currentSettings.enableVmFilter = document.getElementById('vmFilterEnabled').checked;
    const vmKeywordsRaw = document.getElementById('vmFilterKeywords').value
      .split(/[,，]/)
      .map(s => s.trim())
      .filter(Boolean);
    OPTS.currentSettings.vmFilterKeywords = vmKeywordsRaw.length > 0 ? vmKeywordsRaw : ['虚拟机板', '虚拟机'];

    // 权重
    OPTS.currentSettings.weights = {
      clickRate: document.getElementById('weightClick').value / 100,
      downloadRate: document.getElementById('weightDownload').value / 100,
      keywordMatch: document.getElementById('weightKeyword').value / 100,
      steamRating: document.getElementById('weightSteam').value / 100
    };

    // LLM 配置
    OPTS.currentSettings.useLLM = document.getElementById('useLLM').checked;
    OPTS.currentSettings.llmConfig = {
      provider: document.getElementById('llmProvider').value,
      endpoint: document.getElementById('llmEndpoint').value.trim(),
      apiKey: document.getElementById('llmApiKey').value.trim(),
      model: document.getElementById('llmModel').value.trim(),
      temperature: document.getElementById('llmTemp').value / 100
    };

    // 下载站与追踪管理（合并后的统一配置入口）
    const rules = (globalThis.__GAME_RECOMMENDER_SITES__ || {}).sites || [];
    const customSites = (OPTS.currentSettings.trackedSites || []).filter(d =>
      !rules.some(s => s.domains.some(x => d === x || d.includes(x)))
    );
    const ruleTracked = [...document.querySelectorAll('.track-site-check:checked')]
      .map(cb => cb.dataset.domain);
    OPTS.currentSettings.trackedSites = [...new Set([...customSites, ...ruleTracked])];
    OPTS.currentSettings.steamSiteSearch = [...document.querySelectorAll('.steam-site-check:checked')]
      .map(cb => cb.dataset.site);

    // 缓存有效期（value + 单位，0 = 长期有效；v3.3.7 模块化：每模块独立 TTL）
    // Cache TTLs (value + unit; 0 = keep forever; per-module since v3.3.7)
    OPTS.currentSettings.cacheTtls = {
      steamDynamic: { value: parseInt(document.getElementById('ttlSteamDynamic').value) || 0, unit: document.getElementById('ttlSteamDynamicUnit').value },
      detailSteam: { value: parseInt(document.getElementById('ttlDetailSteam').value) || 0, unit: document.getElementById('ttlDetailSteamUnit').value },
      spySteam: { value: parseInt(document.getElementById('ttlSpySteam').value) || 0, unit: document.getElementById('ttlSpySteamUnit').value },
      metaSteam: { value: parseInt(document.getElementById('ttlMetaSteam').value) || 0, unit: document.getElementById('ttlMetaSteamUnit').value },
      registryConfirm: { value: parseInt(document.getElementById('ttlRegistryConfirm').value) || 0, unit: document.getElementById('ttlRegistryConfirmUnit').value },
      downloadUrls: { value: parseInt(document.getElementById('ttlDownloadUrls').value) || 0, unit: document.getElementById('ttlDownloadUrlsUnit').value },
      negativeCache: { value: parseInt(document.getElementById('ttlNegativeCache').value) || 0, unit: document.getElementById('ttlNegativeCacheUnit').value }
    };

    // 日志配置
    OPTS.currentSettings.enableLog = document.getElementById('logEnabled').checked;
    OPTS.currentSettings.logLevel = document.getElementById('logLevel').value;
    OPTS.currentSettings.logRetentionDays = parseInt(document.getElementById('logRetentionDays').value) || 0;
    OPTS.currentSettings.logStorage = document.getElementById('logStorage').value;

    await chrome.runtime.sendMessage({ action: 'SAVE_SETTINGS', settings: OPTS.currentSettings });
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

  OPTS.scheduleAutoSave = scheduleAutoSave;
  OPTS.saveSettings = saveSettings;
  OPTS.showSaveStatus = showSaveStatus;
})(typeof globalThis !== 'undefined' ? globalThis : this);
