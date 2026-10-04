/**
 * 游戏雷达 Game Radar - 设置页每项"恢复默认"微按钮 / Per-Setting Reset Buttons
 *
 * v14.1.0（第一轮 B6 补完）：长尾设置不再需要记住默认值——每个设置行 hover
 * 显现 ↺ 按钮，单击将该行对应的设置键恢复为 DEFAULT_SETTINGS 值。
 * 实现：复用 renderSettings 作为"设置对象 → 控件"的**单源应用器**——把当前
 * 设置的该键替换为默认值后整面板重渲染，再走常规防抖保存（避免为 ~60 个
 * 控件各写一份取值/赋值逻辑造成双源漂移）。
 * Per-setting reset: a hover ↺ button per row restores that key from
 * DEFAULT_SETTINGS by reusing renderSettings as the single applier.
 */
(function (global) {
  'use strict';

  const OPTS = (global.__OPTS__ = global.__OPTS__ || {});

  // 设置键路径 → 行内锚点控件 id（按钮追加到其 .setting-row；同一行多个键
  // 会各得一个按钮）。列表/动态型设置（规则编辑器/ITAD profiles/站点管理）
  // 有专属 UI，不在本机制内。
  // settings key path → anchor control id in the same row.
  const RESET_TARGETS = [
    // 基本 / basic
    ['enabled', 'enabled'],
    ['showStatusBar', 'showStatusBar'],
    ['showDebugPanel', 'showDebugPanel'],
    ['highlightThreshold', 'threshold'],
    ['maxBehaviorLog', 'maxLog'],
    // 好评率过滤 / rating filter
    ['enableRatingFilter', 'ratingFilterEnabled'],
    ['minSteamRatingFilter', 'minRating'],
    ['enableRecentFilter', 'recentFilterEnabled'],
    ['minRecentSteamRatingFilter', 'minRecentRating'],
    ['ratingFilterMode', 'ratingFilterMode'],
    ['enableSortByRating', 'sortByRatingEnabled'],
    // 徽章显示 / badge visibility
    ['badgeVisibility.score', 'badgeScore'],
    ['badgeVisibility.recent', 'badgeRecent'],
    ['badgeVisibility.all', 'badgeAll'],
    ['badgeVisibility.update', 'badgeUpdate'],
    ['badgeVisibility.rec', 'badgeRec'],
    ['badgeVisibility.appstat', 'badgeAppstat'],
    // 批处理与上限 / limits
    ['maxScanLinks', 'maxScanLinks'],
    ['ratingsBatchSize', 'ratingsBatchSize'],
    ['qrImageMaxKb', 'qrImageMaxKb'],
    // 外观 / appearance
    ['enableVmFilter', 'vmFilterEnabled'],
    ['uiTheme', 'uiTheme'],
    ['themeAutoSwitch', 'themeAutoSwitch'],
    ['uiThemeDay', 'uiThemeDay'],
    ['uiThemeNight', 'uiThemeNight'],
    ['uiThemeNightStart', 'uiThemeNightStart'],
    ['uiThemeNightEnd', 'uiThemeNightEnd'],
    ['redTitleRating', 'redTitleRating'],
    ['detailFloatExpanded', 'detailFloatExpanded'],
    ['detailFloatSide', 'detailFloatSide'],
    ['floatModules.chips', 'fmChips'],
    ['floatModules.tags', 'fmTags'],
    ['floatModules.developers', 'fmDevelopers'],
    ['floatModules.description', 'fmDescription'],
    ['floatModules.spy', 'fmSpy'],
    // 权重 / weights（10 项）
    ['weights.clickRate', 'weightClick'],
    ['weights.downloadRate', 'weightDownload'],
    ['weights.keywordMatch', 'weightKeyword'],
    ['weights.steamRating', 'weightSteam'],
    ['weights.playTime', 'weightPlayTime'],
    ['weights.heat', 'weightHeat'],
    ['weights.sales', 'weightSales'],
    ['weights.reviews', 'weightReviews'],
    ['weights.appStatDownload', 'weightAppStatDownload'],
    ['weights.appStatDetailView', 'weightAppStatDetailView'],
    // 内容功能开关 / content toggles
    ['enableRecommendations', 'enableRecommendations'],
    ['downloadTrackingEnabled', 'downloadTrackingEnabled'],
    ['appStatsEnabled', 'appStatsEnabled'],
    ['qrUnlockEnabled', 'qrUnlockEnabled'],
    ['xdgridEnabled', 'xdgridEnabled'],
    ['notifyFreeGames', 'notifyFreeGames'],
    ['freeGamesEnabled', 'freeGamesEnabled'],
    // 收藏折扣/周报 / favorites & digest
    ['favoritePriceWatch', 'favoritePriceWatch'],
    ['favoriteDiscountThreshold', 'favoriteDiscountThreshold'],
    ['weeklyDigestEnabled', 'weeklyDigestEnabled'],
    // LLM
    ['useLLM', 'useLLM'],
    ['llmConfig.provider', 'llmProvider'],
    ['llmConfig.endpoint', 'llmEndpoint'],
    ['llmConfig.apiKey', 'llmApiKey'],
    ['llmConfig.model', 'llmModel'],
    ['llmConfig.temperature', 'llmTemp'],
    // 日志 / logging
    ['enableLog', 'logEnabled'],
    ['logLevel', 'logLevel'],
    ['logRetentionDays', 'logRetentionDays'],
    ['logStorage', 'logStorage'],
    ['maxRuntimeLog', 'maxRuntimeLog'],
    // 备份 / backup
    ['autoBackup', 'autoBackup'],
    ['backupIntervalHours', 'backupIntervalHours'],
    ['maxBackups', 'maxBackups']
  ];

  let defaultsCache = null;

  async function ensureDefaults() {
    if (defaultsCache) return defaultsCache;
    try {
      const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_DEFAULT_SETTINGS' });
      defaultsCache = (resp && resp.defaults) || {};
    } catch {
      defaultsCache = {};
    }
    return defaultsCache;
  }

  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  // 重置单键：默认值写入当前设置副本 → renderSettings 整面板重渲染（单源）→
  // 常规防抖保存。缺默认值（未知键）时不动。
  async function resetOne(path) {
    const defaults = await ensureDefaults();
    const def = getPath(defaults, path);
    if (def === undefined) return;
    const merged = JSON.parse(JSON.stringify(OPTS.currentSettings || {}));
    const segs = path.split('.');
    let node = merged;
    for (let i = 0; i < segs.length - 1; i++) {
      if (!node[segs[i]] || typeof node[segs[i]] !== 'object') node[segs[i]] = {};
      node = node[segs[i]];
    }
    node[segs[segs.length - 1]] = JSON.parse(JSON.stringify(def));
    OPTS.currentSettings = merged;
    OPTS.renderSettings(merged);
    OPTS.scheduleAutoSave();
  }

  function makeButton(path, slot) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gr-reset-one';
    btn.dataset.path = path;
    btn.title = '恢复此设置为默认值';
    btn.textContent = '↺';
    // 同行多键时横向错开（label-text 预留 24px/钮）
    btn.style.right = slot * 26 + 'px';
    return btn;
  }

  // 绑定：按钮挂到行标题（.label-text）内绝对定位——**不占布局空间**，
  // 行高保持与注入前一致（in-flow 方案曾使每行 +2~4px、整页基线漂移）。
  function bindResetDefaults() {
    for (const [path, anchorId] of RESET_TARGETS) {
      const anchor = document.getElementById(anchorId);
      if (!anchor) continue;
      const row = anchor.closest('.setting-row') || anchor.parentElement;
      if (!row) continue;
      const label = row.querySelector('.label-text');
      if (!label) continue; // 无标准行头（异常结构）不注入
      if (!row.__grResetPaths) row.__grResetPaths = new Set();
      if (row.__grResetPaths.has(path)) continue;
      const slot = row.__grResetPaths.size;
      row.__grResetPaths.add(path);
      label.appendChild(makeButton(path, slot));
    }
    // 缓存 TTL 行（value + unit 双控件，fields 运行时定义）
    const ttlFields = OPTS.TTL_FIELDS || [];
    for (const f of ttlFields) {
      const anchor = document.getElementById(f.id);
      if (!anchor) continue;
      const row = anchor.closest('.setting-row') || anchor.parentElement;
      if (!row) continue;
      const label = row.querySelector('.label-text');
      if (!label) continue;
      const path = 'cacheTtls.' + f.key;
      if (!row.__grResetPaths) row.__grResetPaths = new Set();
      if (row.__grResetPaths.has(path)) continue;
      const slot = row.__grResetPaths.size;
      row.__grResetPaths.add(path);
      label.appendChild(makeButton(path, slot));
    }
    if (!document.body.dataset.grResetBound) {
      document.body.dataset.grResetBound = '1';
      document.addEventListener('click', (e) => {
        const target = e.target;
        const btn = target instanceof Element ? target.closest('.gr-reset-one') : null;
        const path = btn ? btn.getAttribute('data-path') : null;
        if (path) resetOne(path).catch(() => {});
      });
    }
  }

  OPTS.bindResetDefaults = bindResetDefaults;
})(typeof globalThis !== 'undefined' ? globalThis : this);
