/**
 * 游戏雷达 Game Radar - 设置页入口 / Options Entry
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
  // v5.0.0：TTL 字段单源（绑定/保存/渲染三处共用）
  OPTS.TTL_FIELDS = [
    { id: 'ttlSteamDynamic', key: 'steamDynamic', defaultUnit: 'hours' },
    { id: 'ttlDetailSteam', key: 'detailSteam', defaultUnit: 'hours' },
    { id: 'ttlSpySteam', key: 'spySteam', defaultUnit: 'days' },
    { id: 'ttlMetaSteam', key: 'metaSteam', defaultUnit: 'days' },
    { id: 'ttlRegistryConfirm', key: 'registryConfirm', defaultUnit: 'days' },
    { id: 'ttlDownloadUrls', key: 'downloadUrls', defaultUnit: 'days' },
    { id: 'ttlNegativeCache', key: 'negativeCache', defaultUnit: 'hours' }
  ];

  OPTS.currentSettings = null;
  OPTS.saveTimer = null; // 防抖定时器 / debounce timer
  OPTS.cacheCurrentPage = 1;
  OPTS.CACHE_PAGE_SIZE = 20;
  OPTS.cacheSearchTimer = null;

  // v6.4.6：切换到 Vista Aero 新菜单
  document.addEventListener('DOMContentLoaded', async () => {
    // v6.4.11：集中入口（hub）——内嵌时切换面板，独立打开时新开标签
    const hubBtn = document.getElementById('openHubBtn');
    if (hubBtn) {
      hubBtn.addEventListener('click', () => {
        const utils = globalThis.__GR_SETTINGS_UTILS__;
        if (utils && utils.goHub) utils.goHub('options');
      });
    }
    const vistaBtn = document.getElementById('openVistaMenu');
    if (vistaBtn) {
      vistaBtn.addEventListener('click', () => {
        const utils = globalThis.__GR_SETTINGS_UTILS__;
        if (utils && utils.goHub) utils.goHub('vista');
      });
    }
    try {
      const response = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
      // 防御：后台未就绪时 response 可能为 undefined
      if (!response || !response.settings) {
        document.body.insertAdjacentHTML(
          'afterbegin',
          '<div style="padding:16px;margin:16px auto;max-width:760px;background:#3a1a1a;color:#ff8a7a;border:1px solid #d94126;border-radius:8px;">⚠️ 无法加载设置，请刷新页面或重新启用扩展。</div>'
        );
        return;
      }
      OPTS.currentSettings = response.settings;
      OPTS.renderSettings(OPTS.currentSettings);
      bindEvents();
      bindTabEvents(); // 侧边栏分类切换
      OPTS.bindCacheEvents(); // 游戏缓存管理
      OPTS.bindRulesEvents(); // 规则管理（v3.0.0）
      OPTS.populateCacheSiteFilter(); // 缓存页下载站筛选
      // v6.4.7：ITAD Key 脱敏显示 + 测试按钮
    const itadInput = document.getElementById('itadApiKey');
    if (itadInput && OPTS.currentSettings.itadApiKey) {
      itadInput.value = '••••' + String(OPTS.currentSettings.itadApiKey).slice(-4);
      itadInput.dataset.masked = '1';
      itadInput.addEventListener('focus', () => {
        if (itadInput.dataset.masked === '1') { itadInput.value = ''; itadInput.dataset.masked = ''; }
      });
    }
    const itadTestBtn = document.getElementById('itadTestBtn');
    if (itadTestBtn) {
      itadTestBtn.addEventListener('click', async () => {
        let key = itadInput.value.trim();
        const result = document.getElementById('itadTestResult');
        if (itadInput.dataset.masked === '1') {
          const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
          key = (resp && resp.settings && resp.settings.itadApiKey) || '';
        }
        if (!key) { result.textContent = '⚠️ 请先输入/保存 ITAD Key'; return; }
        result.textContent = '测试中...';
        try {
          const r = await fetch('https://api.isthereanydeal.com/v02/game/prices/?key=' + encodeURIComponent(key) + '&appids=steam/730');
          result.textContent = r.status === 200 ? '✅ Key 有效' : r.status === 401 || r.status === 403 ? '❌ Key 无效' : '⚠️ 服务异常（' + r.status + '）';
        } catch {
          result.textContent = '❌ 网络错误';
        }
      });
    }
    // v6.4.8：关键词过滤规则编辑器（多条 + 排除误报词）
    function renderRules(rules) {
      const box = document.getElementById('ruleList');
      if (!box) return;
      box.innerHTML = '';
      (rules || []).forEach((rule, idx) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:6px;';
        row.innerHTML = `<input type="text" class="text-input" data-rk="${idx}" placeholder="关键词" value="${(rule.keyword || '').replace(/"/g, '&quot;')}" style="flex:1">
          <span style="font-size:11px;color:#8f98a0;">排除</span>
          <input type="text" class="text-input" data-rx="${idx}" placeholder="排除误报词（可空）" value="${(rule.exclude || '').replace(/"/g, '&quot;')}" style="flex:1">
          <button class="btn btn-danger" data-rdel="${idx}" style="padding:4px 10px;">✕</button>`;
        box.appendChild(row);
        row.querySelector('[data-rdel]').addEventListener('click', () => {
          const rules2 = (OPTS.currentSettings.filterRules || []).filter((_, i) => i !== idx);
          OPTS.currentSettings.filterRules = rules2;
          renderRules(rules2);
          scheduleAutoSave();
        });
      });
      if (!rules || rules.length === 0) {
        box.innerHTML = '<div style="font-size:12px;color:#8f98a0;">暂无规则——添加后生效（关键词命中且不命中排除词才过滤）</div>';
      }
    }
    document.getElementById('ruleAddBtn').addEventListener('click', () => {
      OPTS.currentSettings.filterRules = [...(OPTS.currentSettings.filterRules || []), { keyword: '', exclude: '' }];
      renderRules(OPTS.currentSettings.filterRules);
      scheduleAutoSave();
    });
    document.addEventListener('change', (e) => {
      const el = /** @type {HTMLInputElement} */ (e.target);
      const kIdx = el && el.dataset && el.dataset.rk;
      const xIdx = el && el.dataset && el.dataset.rx;
      if (kIdx === undefined && xIdx === undefined) return;
      const rules2 = (OPTS.currentSettings.filterRules || []).map((r, i) => {
        if (String(i) === kIdx) return { ...r, keyword: el.value };
        if (String(i) === xIdx) return { ...r, exclude: el.value };
        return r;
      });
      OPTS.currentSettings.filterRules = rules2;
      scheduleAutoSave();
    });
    window['__renderRules'] = renderRules;
    // v6.4.11：renderSettings 先于本定义执行，首次加载时规则列表缺失 → 补渲染
    if (OPTS.currentSettings) renderRules(OPTS.currentSettings.filterRules || []);
    // v6.4.8：日志在线查看
    async function loadLogViewer() {
      const resp = await chrome.runtime.sendMessage({ action: 'GET_RUNTIME_LOGS', limit: 200 });
      const logs = (resp && resp.logs) || [];
      document.getElementById('logCount').textContent = logs.length + ' 条';
      const box = document.getElementById('logViewer');
      box.innerHTML = logs.length === 0 ? '<div style="color:#8f98a0;">暂无日志</div>' : logs.slice(0, 200).map((l) => {
        const color = l.level === 'error' ? '#c75050' : l.level === 'warn' ? '#c78550' : l.level === 'debug' ? '#8f98a0' : '#66c0f4';
        return `<div style="padding:2px 4px;border-bottom:1px solid #2f4055;"><span style="color:#8f98a0;">${new Date(l.t).toLocaleTimeString('zh-CN')}</span> <span style="color:${color};font-weight:600;">[${escapeHtml(l.level || 'info')}]</span> ${escapeHtml(l.msg || '')}</div>`;
      }).join('');
    }
    document.getElementById('logRefreshBtn').addEventListener('click', loadLogViewer);
    document.getElementById('logClearBtn').addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ action: 'CLEAR_RUNTIME_LOGS' });
      loadLogViewer();
    });
    setTimeout(loadLogViewer, 300);
    OPTS.loadDataModules(); // 数据模块清单（勾选 UI）
      OPTS.loadBackupsSelect(); // 备份列表（恢复下拉）
    } catch (e) {
      console.error('【游戏雷达】 设置页加载失败:', e);
    }
  });

  // 工具 / utilities
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============ 侧边栏分类切换 / Sidebar Category Switching ============
  // Chrome 设置页风格：左侧分类导航 + 右侧内容面板
  function bindTabEvents() {
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const panelId = btn.dataset.panel;
        document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.settings-panel').forEach((p) => p.classList.remove('active'));
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
    // v6.4.4：30 天好评过滤 + 关系模式 + 重排序
    document.getElementById('recentFilterEnabled').addEventListener('change', () => scheduleAutoSave());
    document.getElementById('minRecentRating').addEventListener('input', (e) => {
      document.getElementById('minRecentRatingVal').textContent = `${e.target.value}%`;
      scheduleAutoSave();
    });
    document.getElementById('ratingFilterMode').addEventListener('change', () => scheduleAutoSave());
    document.getElementById('sortByRatingEnabled').addEventListener('change', () => scheduleAutoSave());
    document.getElementById('filterMatchMode').addEventListener('change', () => scheduleAutoSave());

    // 虚拟机过滤
    document.getElementById('vmFilterEnabled').addEventListener('change', () => scheduleAutoSave());
    document.getElementById('vmFilterKeywords').addEventListener('input', () => scheduleAutoSave());

    // 权重滑块（v4.0.0：新增 playTime/heat）
    const weightIds = ['weightClick', 'weightDownload', 'weightKeyword', 'weightSteam', 'weightPlayTime', 'weightHeat'];
    weightIds.forEach((id) => {
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
    ['llmEndpoint', 'llmApiKey', 'llmModel'].forEach((id) => {
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
        // v6.3.0：host_permissions 已收窄到内置域名，自定义站点经
        // optional_host_permissions 按需请求权限（用户手势内调用）
        if (chrome.permissions && chrome.permissions.request) {
          chrome.permissions
            .request({ origins: [`http://${site}/*`, `https://${site}/*`] })
            .catch(() => {});
        }
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

    // 手动保存（立即保存）——v6.4.12：await 完成并反馈（此前 fire-and-forget，
    // 点击后立即关闭页面可能未送达）
    document.getElementById('saveBtn').addEventListener('click', async () => {
      if (OPTS.saveTimer) {
        clearTimeout(OPTS.saveTimer);
        OPTS.saveTimer = null;
      }
      await saveSettings();
    });

    // 缓存有效期输入（变更即自动保存；v3.3.7 补全 ttlDetailSteam/ttlSpySteam/ttlMetaSteam）
    OPTS.TTL_FIELDS.forEach((f) => {
      const id = f.id;
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
    document.getElementById('maxRuntimeLog').addEventListener('change', () => scheduleAutoSave());

    // v6.4.11：自动备份配置（变更即自动保存）
    document.getElementById('autoBackup').addEventListener('change', () => scheduleAutoSave());
    document.getElementById('backupIntervalHours').addEventListener('change', () => scheduleAutoSave());
    document.getElementById('maxBackups').addEventListener('change', () => scheduleAutoSave());

    // v3.4.1：页面关闭兜底——防抖定时器未触发时立即保存，避免设置改动丢失
    //（尽力而为：pagehide 阶段 sendMessage 仍可能发出，总比丢弃强）
    // Flush a pending debounced save on page close (best-effort; the message
    // may still be delivered during pagehide)
    window.addEventListener('pagehide', () => {
      if (OPTS.saveTimer) {
        clearTimeout(OPTS.saveTimer);
        OPTS.saveTimer = null;
        void saveSettings();
      }
    });
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
  // v6.4.12：串行发送防竞态（并发 SAVE_SETTINGS 后发覆盖先发）；
  // 失败可见（此前保存异常静默丢失，用户误以为已保存）
  // Serial send queue; failures surface in the status bar.
  let saveQueue = Promise.resolve();
  async function saveSettings() {
    // 从 UI 收集所有值（同步，调用时 DOM 状态）
    OPTS.currentSettings.enabled = document.getElementById('enabled').checked;
    OPTS.currentSettings.showStatusBar = document.getElementById('showStatusBar').checked;
    OPTS.currentSettings.showDebugPanel = document.getElementById('showDebugPanel').checked;
    OPTS.currentSettings.highlightThreshold = document.getElementById('threshold').value / 100;
    OPTS.currentSettings.maxBehaviorLog = parseInt(document.getElementById('maxLog').value);

    // 好评率过滤
    OPTS.currentSettings.enableRatingFilter = document.getElementById('ratingFilterEnabled').checked;
    OPTS.currentSettings.minSteamRatingFilter = parseInt(document.getElementById('minRating').value);
    // v6.4.11：修复 30 天好评过滤/关系模式/重排序无法保存（此前仅在事件
    // 绑定中 scheduleAutoSave，收集阶段漏读这 4 个 DOM 字段，保存时被旧值覆盖）
    OPTS.currentSettings.enableRecentFilter = document.getElementById('recentFilterEnabled').checked;
    OPTS.currentSettings.minRecentSteamRatingFilter = parseInt(document.getElementById('minRecentRating').value);
    OPTS.currentSettings.ratingFilterMode = document.getElementById('ratingFilterMode').value;
    OPTS.currentSettings.enableSortByRating = document.getElementById('sortByRatingEnabled').checked;

    // 徽章显示开关（v3.3.8）
    OPTS.currentSettings.badgeVisibility = {
      recent: document.getElementById('badgeRecent').checked,
      all: document.getElementById('badgeAll').checked,
      update: document.getElementById('badgeUpdate').checked,
      rec: document.getElementById('badgeRec').checked
    };
    // 列表页链接扫描上限（v3.3.9）
    OPTS.currentSettings.maxScanLinks = parseInt(document.getElementById('maxScanLinks').value) || 500;

    // 虚拟机过滤
    OPTS.currentSettings.enableVmFilter = document.getElementById('vmFilterEnabled').checked;
    OPTS.currentSettings.filterKeywords = document.getElementById('vmFilterKeywords').value;
    OPTS.currentSettings.filterMatchMode = document.getElementById('filterMatchMode').value;
    // v6.4.8：规则列表（编辑器已维护 currentSettings.filterRules）
    const vmKeywordsRaw = document
      .getElementById('vmFilterKeywords')
      .value.split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    OPTS.currentSettings.vmFilterKeywords = vmKeywordsRaw.length > 0 ? vmKeywordsRaw : ['虚拟机板', '虚拟机'];

    // 权重（v4.0.0：新增 playTime/heat——必须写入保存映射，否则用户保存时
    // 会抹掉新权重项的自定义值）
    OPTS.currentSettings.weights = {
      clickRate: document.getElementById('weightClick').value / 100,
      downloadRate: document.getElementById('weightDownload').value / 100,
      keywordMatch: document.getElementById('weightKeyword').value / 100,
      steamRating: document.getElementById('weightSteam').value / 100,
      playTime: document.getElementById('weightPlayTime').value / 100,
      heat: document.getElementById('weightHeat').value / 100
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
    // v6.3.3：ITAD 二次校验 key（可选）
    OPTS.currentSettings.itadApiKey = document.getElementById('itadApiKey').value.trim();

    // 下载站与追踪管理（合并后的统一配置入口）
    const rules = (globalThis.__GAME_RECOMMENDER_SITES__ || {}).sites || [];
    const customSites = (OPTS.currentSettings.trackedSites || []).filter(
      (d) => !rules.some((s) => s.domains.some((x) => d === x || d.includes(x)))
    );
    const ruleTracked = [...document.querySelectorAll('.track-site-check:checked')].map((cb) => cb.dataset.domain);
    OPTS.currentSettings.trackedSites = [...new Set([...customSites, ...ruleTracked])];
    OPTS.currentSettings.steamSiteSearch = [...document.querySelectorAll('.steam-site-check:checked')].map(
      (cb) => cb.dataset.site
    );

    // 缓存有效期（value + 单位，0 = 长期有效；v3.3.7 模块化：每模块独立 TTL）
    // Cache TTLs (value + unit; 0 = keep forever; per-module since v3.3.7)
    OPTS.currentSettings.cacheTtls = {};
    OPTS.TTL_FIELDS.forEach((f) => {
      OPTS.currentSettings.cacheTtls[f.key] = {
        value: parseInt(document.getElementById(f.id).value) || 0,
        unit: document.getElementById(f.id + 'Unit').value
      };
    });

    // 日志配置
    OPTS.currentSettings.enableLog = document.getElementById('logEnabled').checked;
    OPTS.currentSettings.logLevel = document.getElementById('logLevel').value;
    OPTS.currentSettings.logRetentionDays = parseInt(document.getElementById('logRetentionDays').value) || 0;
    OPTS.currentSettings.logStorage = document.getElementById('logStorage').value;
    OPTS.currentSettings.maxRuntimeLog = parseInt(document.getElementById('maxRuntimeLog').value) || 300;

    // v6.4.11：自动备份配置（此前无 UI，仅 DEFAULT_SETTINGS 默认值生效）
    OPTS.currentSettings.autoBackup = document.getElementById('autoBackup').checked;
    OPTS.currentSettings.backupIntervalHours = parseInt(document.getElementById('backupIntervalHours').value) || 24;
    OPTS.currentSettings.maxBackups = parseInt(document.getElementById('maxBackups').value) || 7;

    // 串行发送（快照同一 currentSettings 引用，队列保证顺序写入）
    const snapshot = OPTS.currentSettings;
    saveQueue = saveQueue.then(async () => {
      await chrome.runtime.sendMessage({ action: 'SAVE_SETTINGS', settings: snapshot });
      showSaveStatus('saved');
    }).catch((err) => {
      console.warn('【游戏雷达】 设置保存失败:', err);
      showSaveStatus('error');
    });
    return saveQueue;
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
    } else if (state === 'error') {
      status.textContent = '❌ 保存失败（见控制台）';
      status.className = 'save-status error';
      setTimeout(() => {
        status.textContent = '';
        status.className = 'save-status';
      }, 4000);
    }
  }

  OPTS.scheduleAutoSave = scheduleAutoSave;
  OPTS.saveSettings = saveSettings;
  OPTS.showSaveStatus = showSaveStatus;
})(typeof globalThis !== 'undefined' ? globalThis : this);
