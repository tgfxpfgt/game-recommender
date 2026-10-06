/**
 * 游戏雷达 Game Radar - Popup Script（装配壳）/ Popup (shell)
 * 弹窗逻辑 / Popup logic
 *
 * @description 跨文件全局声明（classic 脚本分域，见 popup-status/weights/search.js）
 */
/* global renderWeights, updateLLMStatus, loadStats, loadApiStatus, loadFreeGamesCount */
/*
 * v6.4.11：全量快捷设置——覆盖设置页全部选项（同键同名），每次修改即保存；
 * 嵌套路径经 shared/settings-utils.js 的 applyPatch（deepSet）写入。
 * v14.3.0（第五轮 B6）：491 行按域拆分——状态区渲染 popup-status.js、
 * 权重滑块 popup-weights.js、快速搜索 popup-search.js（classic 脚本全局，
 * popup.html 按序加载）；本文件保留设置装载/渲染/绑定/底部操作编排。
 * Shell after the B6 split: settings load/render/bindings/footer; status,
 * weights and search live in their own classic-script modules.
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
  // v10.7.0 批次5：统一入口（皮肤定时解析 + 自定义 CSS 一次完成）
  if (utils.applyPageTheme) utils.applyPageTheme(settings);
  else {
    if (utils.applyThemeAuto) utils.applyThemeAuto(settings);
    else if (utils.applyTheme) utils.applyTheme(settings.uiTheme);
    if (utils.applyCustomTheme) utils.applyCustomTheme(settings.customThemeCss);
  }

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
  document.getElementById('ppBadgeScore').checked = bv.score !== false; // v10.5.3
  document.getElementById('ppBadgeRecent').checked = bv.recent !== false;
  document.getElementById('ppBadgeAll').checked = bv.all !== false;
  document.getElementById('ppBadgeUpdate').checked = bv.update !== false;
  document.getElementById('ppBadgeRec').checked = bv.rec !== false;
  document.getElementById('ppBadgeAppstat').checked = bv.appstat !== false;

  // v10.3.0：内容功能开关回显（缺 key 经 deepMerge 补默认，均默认开）
  document.getElementById('ppRecommendations').checked = settings.enableRecommendations !== false;
  document.getElementById('ppDownloadTracking').checked = settings.downloadTrackingEnabled !== false;
  document.getElementById('ppAppStats').checked = settings.appStatsEnabled !== false;
  document.getElementById('ppQrUnlock').checked = settings.qrUnlockEnabled !== false;
  document.getElementById('ppXdgrid').checked = settings.xdgridEnabled !== false;
  document.getElementById('ppNotifyFreeGames').checked = settings.notifyFreeGames !== false;
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
    ['ppBadgeScore', 'badgeVisibility.score'], // v10.5.3：综合评分徽章
    ['ppBadgeRecent', 'badgeVisibility.recent'],
    ['ppBadgeAll', 'badgeVisibility.all'],
    ['ppBadgeUpdate', 'badgeVisibility.update'],
    ['ppBadgeRec', 'badgeVisibility.rec'],
    ['ppBadgeAppstat', 'badgeVisibility.appstat'],
    ['ppRecommendations', 'enableRecommendations'],
    ['ppDownloadTracking', 'downloadTrackingEnabled'],
    ['ppAppStats', 'appStatsEnabled'],
    ['ppQrUnlock', 'qrUnlockEnabled'],
    ['ppXdgrid', 'xdgridEnabled'],
    ['ppNotifyFreeGames', 'notifyFreeGames'],
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

  // v14.1.0：SidePanel 入口（Chrome 116+ 有 open() API；旧版隐藏按钮 = 无感降级）
  // SidePanel entry: hidden on browsers without chrome.sidePanel.open().
  const spBtn = document.getElementById('sidePanelBtn');
  if (spBtn) {
    const sidePanelApi = chrome.sidePanel;
    if (sidePanelApi && typeof sidePanelApi.open === 'function') {
      spBtn.style.display = '';
      spBtn.addEventListener('click', async () => {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          await sidePanelApi.open({ tabId: tab && tab.id });
          window.close();
        } catch {
          /* 打开失败（如 chrome:// 页）静默 */
        }
      });
    }
  }

  // ============ 状态加载 / Status loads ============
  loadStats();
  loadApiStatus();
  loadFreeGamesCount();
});
