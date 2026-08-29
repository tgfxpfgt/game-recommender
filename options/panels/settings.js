/**
 * 游戏雷达 Game Radar - 设置面板模块 / Settings Panel
 *
 * 设置渲染、下载站与追踪管理、UI 切换、权重指示、LLM 测试。
 * 共享状态与保存方法经 window.__OPTS__ 访问（普通页面脚本顺序加载）。
 * Settings rendering, site/tracking management, UI toggles, weight indicator
 * and LLM testing. Shared state/save go through window.__OPTS__.
 */
(function (global) {
  'use strict';

  const OPTS = (global.__OPTS__ = global.__OPTS__ || {});

  // ============ Render Settings / 渲染设置 ============
  function renderSettings(settings) {
    // 基本设置 / Basic settings
    document.getElementById('enabled').checked = settings.enabled;
    document.getElementById('showStatusBar').checked = settings.showStatusBar !== false;
    document.getElementById('showDebugPanel').checked = settings.showDebugPanel === true;
    document.getElementById('threshold').value = settings.highlightThreshold * 100;
    document.getElementById('thresholdVal').textContent = `${settings.highlightThreshold * 100}%`;
    document.getElementById('maxLog').value = settings.maxBehaviorLog;

    // Steam 好评率过滤 / Steam rating filter
    document.getElementById('ratingFilterEnabled').checked = settings.enableRatingFilter || false;
    document.getElementById('minRating').value = settings.minSteamRatingFilter || 0;
    document.getElementById('minRatingVal').textContent = `${settings.minSteamRatingFilter || 0}%`;
    // v6.4.4：30 天好评过滤 + 与/或/非 + 重排序
    document.getElementById('recentFilterEnabled').checked = settings.enableRecentFilter || false;
    document.getElementById('minRecentRating').value = settings.minRecentSteamRatingFilter || 0;
    document.getElementById('minRecentRatingVal').textContent = `${settings.minRecentSteamRatingFilter || 0}%`;
    document.getElementById('ratingFilterMode').value = settings.ratingFilterMode || 'and';
    document.getElementById('sortByRatingEnabled').checked = settings.enableSortByRating || false;

    // 徽章显示开关（v3.3.8，默认全开）
    const bv = settings.badgeVisibility || {};
    document.getElementById('badgeRecent').checked = bv.recent !== false;
    document.getElementById('badgeAll').checked = bv.all !== false;
    document.getElementById('badgeUpdate').checked = bv.update !== false;
    document.getElementById('badgeRec').checked = bv.rec !== false;
    // 列表页链接扫描上限（v3.3.9）
    document.getElementById('maxScanLinks').value = settings.maxScanLinks || 500;

    // v6.4.19：关键词过滤（纯规则列表；旧简单关键词输入已移除——规则由
    // 编辑器维护；uiTheme 皮肤回显）
    document.getElementById('vmFilterEnabled').checked = settings.enableVmFilter || false;
    document.getElementById('uiTheme').value = settings.uiTheme || 'steam';
    if (typeof window['__renderRules'] === 'function') window['__renderRules'](settings.filterRules || []);

    // 权重设置 / Algorithm weights
    // v3.4.1：畸形/缺失权重不再崩溃（toFixed 前兜底为 0）
    const w = settings.weights || {};
    const pct2 = (n) => (Number.isFinite(n) ? n * 100 : 0).toFixed(2);
    document.getElementById('weightClick').value = pct2(w.clickRate);
    document.getElementById('weightClickVal').textContent = pct2(w.clickRate);
    document.getElementById('weightDownload').value = pct2(w.downloadRate);
    document.getElementById('weightDownloadVal').textContent = pct2(w.downloadRate);
    document.getElementById('weightKeyword').value = pct2(w.keywordMatch);
    document.getElementById('weightKeywordVal').textContent = pct2(w.keywordMatch);
    document.getElementById('weightSteam').value = pct2(w.steamRating);
    document.getElementById('weightSteamVal').textContent = pct2(w.steamRating);
    // v4.0.0：SteamSpy 时长/热度权重（旧设置缺 key 时经 deepMerge 补默认值）
    document.getElementById('weightPlayTime').value = pct2(w.playTime);
    document.getElementById('weightPlayTimeVal').textContent = pct2(w.playTime);
    document.getElementById('weightHeat').value = pct2(w.heat);
    document.getElementById('weightHeatVal').textContent = pct2(w.heat);
    // v10.1.0：AppID 行为统计权重（a 下载正向 / b 未下载惩罚）
    document.getElementById('weightAppStatDownload').value = pct2(w.appStatDownload);
    document.getElementById('weightAppStatDownloadVal').textContent = pct2(w.appStatDownload);
    document.getElementById('weightAppStatDetailView').value = pct2(w.appStatDetailView);
    document.getElementById('weightAppStatDetailViewVal').textContent = pct2(w.appStatDetailView);
    updateWeightSum();

    // v10.3.0：内容功能开关 + a-b 计算参数回显（缺 key 经 deepMerge 补默认）
    document.getElementById('enableRecommendations').checked = settings.enableRecommendations !== false;
    document.getElementById('downloadTrackingEnabled').checked = settings.downloadTrackingEnabled !== false;
    document.getElementById('appStatsEnabled').checked = settings.appStatsEnabled !== false;
    document.getElementById('qrUnlockEnabled').checked = settings.qrUnlockEnabled !== false;
    document.getElementById('xdgridEnabled').checked = settings.xdgridEnabled !== false;
    document.getElementById('notifyFreeGames').checked = settings.notifyFreeGames !== false;
    document.getElementById('badgeAppstat').checked = (settings.badgeVisibility || {}).appstat !== false;
    document.getElementById('appStatDedupHours').value = settings.appStatDedupHours ?? 24;
    document.getElementById('appStatDownloadCap').value = settings.appStatDownloadCap ?? 100;
    document.getElementById('appStatDetailViewCap').value = settings.appStatDetailViewCap ?? 100;

    // LLM 设置 / LLM settings
    const llm = settings.llmConfig || {};
    document.getElementById('useLLM').checked = settings.useLLM;
    document.getElementById('llmProvider').value = llm.provider || 'local';
    document.getElementById('llmEndpoint').value = llm.endpoint || '';
    document.getElementById('llmApiKey').value = llm.apiKey || '';
    document.getElementById('llmModel').value = llm.model || '';
    const tempPct = Number.isFinite(llm.temperature) ? llm.temperature * 100 : 30;
    document.getElementById('llmTemp').value = tempPct;
    document.getElementById('llmTempVal').textContent = tempPct.toFixed(1);
    // v6.4.19：ITAD 多套配置由 options.js renderItadProfiles 渲染（旧单输入已移除）
    toggleLLMSettings();
    toggleApiKeyRow();

    // 下载站与追踪管理（合并展示）
    renderSiteManagement(settings);

    // 缓存有效期（value + 单位，兼容旧数字格式；0 = 长期有效；v3.3.7 每模块独立）
    // Cache TTLs (value + unit; legacy numbers supported; 0 = forever; per-module)
    const ttls = settings.cacheTtls || {};
    OPTS.TTL_FIELDS.forEach((f) => setTtlControl(f.id, ttls[f.key], f.defaultUnit));

    // 日志配置 / Logging config
    document.getElementById('logEnabled').checked = settings.enableLog !== false;
    document.getElementById('logLevel').value = settings.logLevel || 'info';
    document.getElementById('logRetentionDays').value = settings.logRetentionDays ?? 7;
    document.getElementById('logStorage').value = settings.logStorage || 'ndjson';
    document.getElementById('maxRuntimeLog').value = settings.maxRuntimeLog || 300;
    // v6.4.11：自动备份配置回显
    document.getElementById('autoBackup').checked = settings.autoBackup !== false;
    document.getElementById('backupIntervalHours').value = settings.backupIntervalHours ?? 24;
    document.getElementById('maxBackups').value = settings.maxBackups ?? 7;
  }

  // 设置单个 TTL 控件（value + 单位）/ Set a TTL control (value + unit)
  function setTtlControl(inputId, val, defaultUnit) {
    const v =
      typeof val === 'object' && val !== null
        ? val
        : { value: val === null || val === undefined ? 0 : val, unit: defaultUnit };
    const input = document.getElementById(inputId);
    const unitSel = document.getElementById(inputId + 'Unit');
    if (input) input.value = v.value ?? 0;
    if (unitSel) unitSel.value = v.unit || defaultUnit;
  }

  // ============ 下载站与追踪管理渲染 / Sites & Tracking Management ============
  function renderSiteManagement(settings) {
    const container = document.getElementById('siteManageList');
    if (!container) return;
    const rules = (OPTS.siteRules || {}).sites || [];
    const tracked = settings.trackedSites || [];
    const steamSearch = settings.steamSiteSearch || [];

    container.innerHTML = rules
      .map((s) => {
        const isTracked = s.domains.some((d) => tracked.includes(d));
        const canSearch = !!s.searchUrl;
        return `
        <div class="site-manage-row">
          <span class="site-manage-name">${escapeHtml(s.name)} <small>${escapeHtml(s.domains[0])}</small></span>
          <label class="gr-check" title="追踪该站点的浏览行为">
            <input type="checkbox" class="track-site-check" data-domain="${escapeAttr(s.domains[0])}" ${isTracked ? 'checked' : ''}>
            <span>追踪行为</span>
          </label>
          ${
            canSearch
              ? `
            <label class="gr-check" title="在 Steam 详情页与缓存更新中检索该站点资源">
              <input type="checkbox" class="steam-site-check" data-site="${escapeAttr(s.key)}" ${steamSearch.includes(s.key) ? 'checked' : ''}>
              <span>Steam 检索</span>
            </label>
          `
              : '<span class="no-search-hint">无站内搜索</span>'
          }
        </div>
      `;
      })
      .join('');

    renderCustomSiteList(tracked, rules);
  }

  // 自定义追踪站点标签（可删除）/ Custom tracked-site tags (removable)
  function renderCustomSiteList(tracked, rules) {
    const container = document.getElementById('siteList');
    if (!container) return;
    const isRuleDomain = (d) => rules.some((s) => s.domains.some((x) => d === x || d.includes(x)));
    const custom = tracked.filter((d) => !isRuleDomain(d));
    container.innerHTML = custom
      .map(
        (site) => `
      <div class="site-item">
        <span>${escapeHtml(site)}</span>
        <button class="remove-site" data-domain="${escapeAttr(site)}">✕</button>
      </div>
    `
      )
      .join('');

    container.querySelectorAll('.remove-site').forEach((btn) => {
      btn.addEventListener('click', () => {
        const domain = btn.dataset.domain;
        OPTS.currentSettings.trackedSites = (OPTS.currentSettings.trackedSites || []).filter((d) => d !== domain);
        renderSiteManagement(OPTS.currentSettings);
        OPTS.scheduleAutoSave();
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
  function updateWeightSum() {
    // v4.0.0：新增 playTime/heat 滑块
    const ids = ['weightClick', 'weightDownload', 'weightKeyword', 'weightSteam', 'weightPlayTime', 'weightHeat'];
    const sum = ids.reduce((acc, id) => acc + (parseInt(document.getElementById(id).value, 10) || 0), 0) / 100;
    const el = document.getElementById('weightSum');
    if (!el) return;
    el.textContent = sum.toFixed(2);
    const dev = Math.abs(sum - 1);
    el.classList.remove('warn', 'bad');
    if (dev >= 0.15) el.classList.add('bad');
    else if (dev >= 0.05) el.classList.add('warn');
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
        // Ollama - 测试模型列表
        const testUrl = endpoint.replace('/api/generate', '/api/tags');
        response = await fetch(testUrl, { method: 'GET' });
        if (response.ok) {
          const data = await response.json();
          const models = data.models || [];
          const hasModel = models.some((m) => m.name.includes(model));
          if (hasModel) {
            resultEl.textContent = `✅ 连接成功，模型 ${model} 可用`;
          } else {
            resultEl.textContent = `⚠️ 连接成功，但未找到模型 ${model}。可用: ${models.map((m) => m.name).join(', ')}`;
          }
          resultEl.className = 'test-result success';
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } else {
        // OpenAI 兼容接口
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
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
      resultEl.textContent = `❌ 连接失败: ${String(e)}`;
      resultEl.className = 'test-result error';
    }
  }

  OPTS.renderSettings = renderSettings;
  OPTS.renderSiteManagement = renderSiteManagement;
  OPTS.toggleLLMSettings = toggleLLMSettings;
  OPTS.toggleApiKeyRow = toggleApiKeyRow;
  OPTS.updateWeightSum = updateWeightSum;
  OPTS.testLLMConnection = testLLMConnection;
})(typeof globalThis !== 'undefined' ? globalThis : this);
