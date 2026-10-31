/**
 * 游戏雷达 Game Radar - 设置页入口 / Options Entry
 *
 * 模块化架构（经典脚本顺序加载，经 window.__OPTS__ 共享状态）：
 *   shared/escape.js      全局转义工具
 *   panels/settings.js    设置渲染/站点管理/LLM 测试（v14 B2 并入主题/LLM/权重绑定）
 *   panels/cache.js       游戏缓存管理 + 缓存有效期输入绑定
 *   panels/data-manage.js 数据模块管理（备份/导入/导出）+ 数据管理按钮绑定
 *   panels/rules.js       规则管理
 *   panels/search.js      设置搜索/关键词过滤规则编辑器/运行日志查看（v14 B2）
 *   panels/favorites.js   ITAD 折扣配置/收藏折扣与周报保存映射（v14 B2）
 *   panels/sites.js       自定义站点管理/数据源开关/站点收集映射（v14 B2）
 *
 * 本文件负责：共享状态、初始化胶水、通用事件绑定与自动保存管线。
 * This entry wires shared state, init glue, generic bindings and auto-save.
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

  // v14.5.0 B8：DOM 读取微助手——此前 60+ 处 getElementById 全称重复；
  // 语义与直调完全一致（checked/value/parseInt），仅缩短保存映射与绑定表。
  // DOM read micro-helpers: identical semantics to the direct calls.
  /** @param {string} id */
  // v14.7 批次 13：存在性守卫——HTML 漏 id 时快速失败并点名（原实现
  // 中途抛 TypeError 使 autoSave 沦为未处理 rejection 且状态条停留"保存中"）
  const requireEl = (id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`options: 缺少元素 #${id}（HTML 与 settings 键不同步）`);
    return el;
  };
  /** @param {string} id */
  const val = (id) => requireEl(id).value;
  /** @param {string} id */
  const chk = (id) => requireEl(id).checked;
  /** @param {string} id */
  const intVal = (id) => parseInt(requireEl(id).value);

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
    try {
      const response = await window.__GR_MSG__.sendMessage({ action: 'GET_SETTINGS' });
      // 防御：后台未就绪时 response 可能为 undefined
      if (!response || !response.settings) {
        document.body.insertAdjacentHTML(
          'afterbegin',
          '<div style="padding:16px;margin:16px auto;max-width:760px;background:#3a1a1a;color:#ff8a7a;border:1px solid #d94126;border-radius:8px;">⚠️ 无法加载设置，请刷新页面或重新启用扩展。</div>'
        );
        return;
      }
      OPTS.currentSettings = response.settings;
      // v9.3.0：站点规则经后台获取（此前注入 8 个 adapters 脚本只为读全局常量）
      try {
        const rulesResp = await window.__GR_MSG__.sendMessage({ action: 'GET_ADAPTER_RULES' });
        OPTS.siteRules = (rulesResp && rulesResp.rules && rulesResp.rules.merged) || { sites: [] };
      } catch {
        OPTS.siteRules = { sites: [] };
      }
      // v6.4.19：应用皮肤主题（body data-theme）+ v7.0.5：自定义主题 CSS
      const sut = globalThis.__GR_SETTINGS_UTILS__;
      if (sut) {
        sut.applyTheme(OPTS.currentSettings.uiTheme);
        sut.applyCustomTheme(OPTS.currentSettings.customThemeCss);
      }
      OPTS.renderSettings(OPTS.currentSettings);
      bindEvents();
      bindTabEvents();
      OPTS.bindSettingsSearch(); // 设置搜索过滤
      OPTS.bindRangeNumberInputs(); // 滑块 + 手动输入双向绑定
      OPTS.bindCacheEvents(); // 游戏缓存管理
      OPTS.bindRulesEvents(); // 规则管理（v3.0.0）
      OPTS.populateCacheSiteFilter(); // 缓存页下载站筛选
      OPTS.bindItadProfiles(); // ITAD 多套配置（添加/切换/删除/测试/脱敏，v6.4.19）
      OPTS.bindFilterRules(); // 关键词过滤规则编辑器（v6.4.8）
      OPTS.bindLogViewer(); // 运行日志在线查看（级别筛选 + 关键词搜索）
      OPTS.bindDataSourceToggles(); // 数据源开关 + Steam 数据获取模块开关（v6.4.19）
      OPTS.bindSiteManagement(); // 自定义站点添加（v10.5.0 P0-C 严格校验）
      OPTS.bindThemeEvents(); // 皮肤/自定义 CSS 绑定
      OPTS.bindWeightEvents(); // 权重滑块绑定
      OPTS.bindLLMEvents(); // LLM 开关/提供商/测试绑定
      OPTS.bindFmOrderEvents(); // 浮窗模块顺序（v14.1.0）
      OPTS.bindResetDefaults(); // 设置页每项"恢复默认"微按钮（v14.1.0）
      OPTS.bindDataManageEvents(); // 数据导出/导入/清除/备份按钮
      OPTS.bindTtlEvents(); // 缓存有效期输入
      OPTS.bindLogConfigEvents(); // 日志配置输入
      OPTS.bindAutoBackupEvents(); // 自动备份配置（v6.4.11）
      OPTS.loadDataModules(); // 数据模块清单（勾选 UI）
      OPTS.loadBackupsSelect(); // 备份列表（恢复下拉）
    } catch (e) {
      console.error('【游戏雷达】 设置页加载失败:', e);
    }
  });

  // ============ 侧边栏分类切换 / Sidebar Category Switching ============
  // Chrome 设置页风格：左侧分类导航 + 右侧内容面板
  function bindTabEvents() {
    document.querySelectorAll('.gr-nav-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const panelId = btn.dataset.panel;
        document.querySelectorAll('.gr-nav-item').forEach((b) => b.classList.remove('active'));
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

  // ============ 通用设置事件绑定 / Generic Settings Bindings ============
  // 域内绑定已随实现迁往各 panels 模块（v14 B2）；此处仅通用开关与保存路径。
  // v14.5.0 B8：滑块回显与自动保存绑定微助手（原三份回显块 + 二十余处
  // 单行 scheduleAutoSave 绑定同构收敛）。
  function bindEvents() {
    OPTS.bindSettingsSearch(); // v11.0 B6

    // 滑块：input 回显 + 自动保存 / slider display + auto-save
    /** @param {string} id @param {string} valId */
    const bindSliderVal = (id, valId) => {
      document.getElementById(id).addEventListener('input', (e) => {
        document.getElementById(valId).textContent = `${e.target.value}%`;
        scheduleAutoSave();
      });
    };
    bindSliderVal('threshold', 'thresholdVal'); // 阈值滑块
    bindSliderVal('minRating', 'minRatingVal'); // 好评率过滤
    bindSliderVal('minRecentRating', 'minRecentRatingVal'); // v6.4.4：30 天好评过滤

    // 变更即自动保存（v6.4.4 关系模式/重排序；v6.4.19 关键词过滤；
    // v10.3.0 内容功能开关 + a-b 计算参数；v10.4.0 浮窗形态/红标题阈值）
    const autoSaveIds = [
      'ratingFilterEnabled',
      'recentFilterEnabled',
      'ratingFilterMode',
      'sortByRatingEnabled',
      'vmFilterEnabled',
      'enableRecommendations',
      'downloadTrackingEnabled',
      'appStatsEnabled',
      'qrUnlockEnabled',
      'xdgridEnabled',
      'notifyFreeGames',
      'freeGamesEnabled',
      'themeAutoSwitch',
      'uiThemeDay',
      'uiThemeNight',
      'badgeAppstat',
      'appStatDedupHours',
      'appStatDownloadCap',
      'appStatDetailViewCap',
      'detailFloatExpanded',
      'detailFloatSide',
      'redTitleRating',
      'enabled',
      'maxLog'
    ];
    autoSaveIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => scheduleAutoSave());
    });

    // 手动保存（立即保存）——v6.4.12：await 完成并反馈（此前 fire-and-forget，
    // 点击后立即关闭页面可能未送达）
    document.getElementById('saveBtn').addEventListener('click', async () => {
      if (OPTS.saveTimer) {
        clearTimeout(OPTS.saveTimer);
        OPTS.saveTimer = null;
      }
      await saveSettings();
    });

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
    // v14.5.0 B8：读取走 val/chk/intVal 微助手；徽章/权重/LLM 三个嵌套对象
    // 改微型表驱动（键名 = DEFAULT_SETTINGS 键名，逐项变换不变——铁律 11
    // 的逐键核对由此变成一行一键的表审阅）。
    OPTS.currentSettings.enabled = chk('enabled');
    OPTS.currentSettings.showStatusBar = chk('showStatusBar');
    OPTS.currentSettings.showDebugPanel = chk('showDebugPanel');
    OPTS.currentSettings.highlightThreshold = val('threshold') / 100;
    OPTS.currentSettings.maxBehaviorLog = intVal('maxLog');

    // 好评率过滤
    OPTS.currentSettings.enableRatingFilter = chk('ratingFilterEnabled');
    OPTS.currentSettings.minSteamRatingFilter = intVal('minRating');
    // v6.4.11：修复 30 天好评过滤/关系模式/重排序无法保存（此前仅在事件
    // 绑定中 scheduleAutoSave，收集阶段漏读这 4 个 DOM 字段，保存时被旧值覆盖）
    OPTS.currentSettings.enableRecentFilter = chk('recentFilterEnabled');
    OPTS.currentSettings.minRecentSteamRatingFilter = intVal('minRecentRating');
    OPTS.currentSettings.ratingFilterMode = val('ratingFilterMode');
    OPTS.currentSettings.enableSortByRating = chk('sortByRatingEnabled');

    // 徽章显示开关（v3.3.8；v10.5.3 新增 score 综合评分）
    /** @type {Object<string, string>} 设置键 → 控件 id（checked） */
    const badgeIds = {
      score: 'badgeScore', // v10.5.3
      recent: 'badgeRecent',
      all: 'badgeAll',
      update: 'badgeUpdate',
      rec: 'badgeRec',
      appstat: 'badgeAppstat' // v10.3.0
    };
    OPTS.currentSettings.badgeVisibility = Object.fromEntries(Object.entries(badgeIds).map(([k, id]) => [k, chk(id)]));

    // v10.3.0：内容功能独立开关（全量收集保存）
    OPTS.currentSettings.enableRecommendations = chk('enableRecommendations');
    OPTS.currentSettings.downloadTrackingEnabled = chk('downloadTrackingEnabled');
    OPTS.currentSettings.appStatsEnabled = chk('appStatsEnabled');
    OPTS.currentSettings.qrUnlockEnabled = chk('qrUnlockEnabled');
    OPTS.currentSettings.xdgridEnabled = chk('xdgridEnabled');
    OPTS.currentSettings.notifyFreeGames = chk('notifyFreeGames');
    // v11.0 B3 / v13 B9：收藏折扣监控 + 周报（v14 B2 收集迁至 panels/favorites.js）
    OPTS.collectFavoriteSettings();
    // v12 B4：浮窗模块显隐保存映射
    // v14.2.0：order 键入 DEFAULT_SETTINGS 后始终随映射保留（键序过滤走
    // shared/fm-keys.js 单源；fmOrderReset 删除后由此处不再写回 = 回默认序）
    /** @type {Object<string, string>} 显隐键 → 控件 id（checked） */
    const fmIds = {
      chips: 'fmChips',
      tags: 'fmTags',
      developers: 'fmDevelopers',
      description: 'fmDescription',
      spy: 'fmSpy'
    };
    OPTS.currentSettings.floatModules = {
      ...Object.fromEntries(Object.entries(fmIds).map(([k, id]) => [k, chk(id)])),
      ...(OPTS.currentSettings.floatModules && Array.isArray(OPTS.currentSettings.floatModules.order)
        ? {
            order: OPTS.currentSettings.floatModules.order.filter((k) => globalThis.__GR_FM_KEYS__.keys.includes(k))
          }
        : {})
    };
    OPTS.currentSettings.freeGamesEnabled = chk('freeGamesEnabled');
    OPTS.currentSettings.themeAutoSwitch = chk('themeAutoSwitch');
    OPTS.currentSettings.uiThemeDay = val('uiThemeDay').trim() || 'steam';
    OPTS.currentSettings.uiThemeNight = val('uiThemeNight').trim() || 'oled';
    // v10.7.0 批次5：夜间窗口（越界/空值回默认，防把窗口配成空集）
    const nightStart = intVal('uiThemeNightStart');
    const nightEnd = intVal('uiThemeNightEnd');
    OPTS.currentSettings.uiThemeNightStart =
      Number.isInteger(nightStart) && nightStart >= 0 && nightStart <= 23 ? nightStart : 19;
    OPTS.currentSettings.uiThemeNightEnd = Number.isInteger(nightEnd) && nightEnd >= 0 && nightEnd <= 23 ? nightEnd : 7;
    OPTS.currentSettings.appStatDedupHours = intVal('appStatDedupHours') || 0;
    OPTS.currentSettings.appStatDownloadCap = intVal('appStatDownloadCap') || 100;
    OPTS.currentSettings.appStatDetailViewCap = intVal('appStatDetailViewCap') || 100;
    // 列表页链接扫描上限（v3.3.9）
    OPTS.currentSettings.maxScanLinks = intVal('maxScanLinks') || 500;
    // v10.7.0 批次5：评分批次大小（10-200 越界回默认）/ 二维码图片上限 KB
    const batchRaw = intVal('ratingsBatchSize');
    OPTS.currentSettings.ratingsBatchSize =
      Number.isInteger(batchRaw) && batchRaw >= 10 && batchRaw <= 200 ? batchRaw : 60;
    const qrKbRaw = intVal('qrImageMaxKb');
    OPTS.currentSettings.qrImageMaxKb =
      Number.isInteger(qrKbRaw) && qrKbRaw >= 512 && qrKbRaw <= 30720 ? qrKbRaw : 3072;

    // v6.4.19：关键词过滤（纯规则列表——filterRules 由编辑器维护；
    // 兼容字段保留旧值不覆盖，避免清掉历史简单关键词配置）
    OPTS.currentSettings.enableVmFilter = chk('vmFilterEnabled');

    // 权重（v4.0.0：新增 playTime/heat——必须写入保存映射，否则用户保存时
    // 会抹掉新权重项的自定义值；v10.1.0：appStat 两项、v10.5.3：sales/
    // reviews 两项同理）——单一变换 value/100，表驱动一行一键
    /** @type {Object<string, string>} 权重键 → 控件 id（value/100） */
    const weightIds = {
      clickRate: 'weightClick',
      downloadRate: 'weightDownload',
      keywordMatch: 'weightKeyword',
      steamRating: 'weightSteam',
      playTime: 'weightPlayTime',
      heat: 'weightHeat',
      sales: 'weightSales',
      reviews: 'weightReviews',
      appStatDownload: 'weightAppStatDownload',
      appStatDetailView: 'weightAppStatDetailView'
    };
    OPTS.currentSettings.weights = Object.fromEntries(Object.entries(weightIds).map(([k, id]) => [k, val(id) / 100]));

    // LLM 配置
    OPTS.currentSettings.useLLM = chk('useLLM');
    OPTS.currentSettings.llmConfig = {
      provider: val('llmProvider'),
      endpoint: val('llmEndpoint').trim(),
      apiKey: val('llmApiKey').trim(),
      model: val('llmModel').trim(),
      temperature: val('llmTemp') / 100
    };
    // v6.4.19：界面皮肤
    OPTS.currentSettings.uiTheme = val('uiTheme');
    // v6.4.19：ITAD 多套配置（编辑器已维护 currentSettings.itadProfiles/
    // itadActiveProfileId——见 panels/favorites.js；旧 itadApiKey 字段保留兼容，
    // 后台读取时 profiles 优先）

    // 下载站与追踪管理（合并后的统一配置入口；v14 B2 收集迁至 panels/sites.js）
    OPTS.collectSitesSettings();

    // 缓存有效期（value + 单位，0 = 长期有效；v3.3.7 模块化：每模块独立 TTL）
    // Cache TTLs (value + unit; 0 = keep forever; per-module since v3.3.7)
    OPTS.currentSettings.cacheTtls = {};
    OPTS.TTL_FIELDS.forEach((f) => {
      OPTS.currentSettings.cacheTtls[f.key] = {
        value: intVal(f.id) || 0,
        unit: val(f.id + 'Unit')
      };
    });

    // 日志配置
    OPTS.currentSettings.enableLog = chk('logEnabled');
    OPTS.currentSettings.logLevel = val('logLevel');
    OPTS.currentSettings.logRetentionDays = intVal('logRetentionDays') || 0;
    OPTS.currentSettings.logStorage = val('logStorage');
    OPTS.currentSettings.maxRuntimeLog = intVal('maxRuntimeLog') || 300;

    // v6.4.11：自动备份配置（此前无 UI，仅 DEFAULT_SETTINGS 默认值生效）
    OPTS.currentSettings.autoBackup = document.getElementById('autoBackup').checked;
    OPTS.currentSettings.backupIntervalHours = parseInt(document.getElementById('backupIntervalHours').value) || 24;
    OPTS.currentSettings.maxBackups = parseInt(document.getElementById('maxBackups').value) || 7;

    // 串行发送（快照同一 currentSettings 引用，队列保证顺序写入）
    const snapshot = OPTS.currentSettings;
    saveQueue = saveQueue
      .then(async () => {
        await window.__GR_MSG__.sendMessage({ action: 'SAVE_SETTINGS', settings: snapshot });
        showSaveStatus('saved');
      })
      .catch((err) => {
        console.warn('【游戏雷达】 设置保存失败:', err);
        showSaveStatus('error');
      });
    return saveQueue;
  }

  // ============ Save Status Indicator / 保存状态指示器 ============
  // v14.6.2：状态文案清空延时具名单点（成功 2s / 失败 4s——失败留更久供阅读）
  const SAVE_OK_CLEAR_MS = 2000;
  const SAVE_ERR_CLEAR_MS = 4000;
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
      }, SAVE_OK_CLEAR_MS);
    } else if (state === 'error') {
      status.textContent = '❌ 保存失败（见控制台）';
      status.className = 'save-status error';
      setTimeout(() => {
        status.textContent = '';
        status.className = 'save-status';
      }, SAVE_ERR_CLEAR_MS);
    }
  }

  OPTS.scheduleAutoSave = scheduleAutoSave;
  OPTS.saveSettings = saveSettings;
  OPTS.showSaveStatus = showSaveStatus;
})(typeof globalThis !== 'undefined' ? globalThis : this);
