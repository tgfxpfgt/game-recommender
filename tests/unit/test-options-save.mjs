/**
 * 游戏雷达 Game Radar - options 保存映射 DOM 单测 / Options save-mapping DOM test
 *
 * v14.27.0（P2-4）：直接驱动 options.js 的 saveSettings（"改 → 存 → 读回"），
 * 以 DEFAULT_SETTINGS 键名为对照核对保存映射完整性——铁律 10/11 的历史事故
 *（新增键漏映射 → 全量保存抹掉用户自定义值）由此获得回归防线。
 * Drives the real saveSettings against a fake DOM and checks every
 * DEFAULT_SETTINGS key survives the round-trip.
 */
import { test, expect, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../background/core/constants.js';
import { installFakeDom } from '../helpers/fake-dom.mjs';

const dom = installFakeDom();
globalThis.document = dom.document;
globalThis.window = globalThis;
globalThis.__GR_FM_KEYS__ = { keys: ['chips', 'tags', 'developers', 'description', 'spy'] };

/** @type {any[]} */
const sent = [];
let failNext = false;
globalThis.window.__GR_MSG__ = {
  /** @param {any} msg */
  sendMessage: async (msg) => {
    sent.push(msg);
    if (failNext) throw new Error('mock-fail');
    return {};
  }
};

await import('../../options/options.js');
const OPTS = globalThis.__OPTS__;

/** @param {string} id @param {any} v */
const setVal = (id, v) => (dom.getElementById(id).value = String(v));
/** @param {string} id @param {boolean} v */
const setChk = (id, v) => (dom.getElementById(id).checked = v);

/** 面板模块的收集钩子（真实实现位于 panels/*，此处只写回所属键） */
function installPanelStubs() {
  OPTS.collectFavoriteSettings = () => {
    OPTS.currentSettings.weeklyDigestEnabled = true;
    OPTS.currentSettings.favoritePriceWatch = true;
    OPTS.currentSettings.favoriteDiscountThreshold = 80;
  };
  OPTS.collectSitesSettings = () => {
    OPTS.currentSettings.trackedSites = ['custom.example'];
    OPTS.currentSettings.dataSources = { steam: true };
    OPTS.currentSettings.steamSiteSearch = ['a'];
  };
}
installPanelStubs();

/** 铺满 saveSettings 读取的全部控件 / Fill every control saveSettings reads */
function fillFullUi() {
  setChk('enabled', true);
  setChk('showStatusBar', true);
  setChk('showDebugPanel', false);
  setVal('threshold', 83);
  setVal('maxLog', 500);

  setChk('ratingFilterEnabled', true);
  setVal('minRating', 70);
  setChk('recentFilterEnabled', true);
  setVal('minRecentRating', 60);
  setVal('ratingFilterMode', 'or');
  setChk('sortByRatingEnabled', true);

  setChk('detailFloatExpanded', true);
  setVal('detailFloatSide', 'right');
  setVal('redTitleRating', 96);

  setChk('badgeScore', false);
  setChk('badgeRecent', true);
  setChk('badgeAll', true);
  setChk('badgeUpdate', true);
  setChk('badgeRec', true);
  setChk('badgeAppstat', false);

  setChk('enableRecommendations', false);
  setChk('downloadTrackingEnabled', true);
  setChk('appStatsEnabled', false);
  setChk('qrUnlockEnabled', true);
  setChk('xdgridEnabled', false);
  setChk('notifyFreeGames', true);

  setChk('fmChips', false);
  setChk('fmTags', true);
  setChk('fmDevelopers', false);
  setChk('fmDescription', true);
  setChk('fmSpy', false);

  setChk('freeGamesEnabled', true);
  setChk('themeAutoSwitch', true);
  setVal('uiThemeDay', 'steam');
  setVal('uiThemeNight', '  '); // trim 后空 → 回默认 oled
  setVal('uiThemeNightStart', 22);
  setVal('uiThemeNightEnd', 6);
  setVal('appStatDedupHours', 12);
  setVal('appStatDownloadCap', 50);
  setVal('appStatDetailViewCap', 60);
  setVal('maxScanLinks', 300);
  setVal('ratingsBatchSize', 80);
  setVal('qrImageMaxKb', 2048);
  setChk('vmFilterEnabled', true);

  const weights = {
    weightClick: 10,
    weightDownload: 15,
    weightKeyword: 5,
    weightSteam: 20,
    weightPlayTime: 5,
    weightHeat: 10,
    weightSales: 5,
    weightReviews: 5,
    weightAppStatDownload: 10,
    weightAppStatDetailView: 15
  };
  Object.entries(weights).forEach(([id, v]) => setVal(id, v));

  setChk('useLLM', true);
  setVal('llmProvider', 'openai');
  setVal('llmEndpoint', ' https://api.example.com ');
  setVal('llmApiKey', ' sk-x ');
  setVal('llmModel', ' m1 ');
  setVal('llmTemp', 45);
  setVal('uiTheme', 'oled');

  OPTS.TTL_FIELDS.forEach((f) => {
    setVal(f.id, 12);
    setVal(f.id + 'Unit', 'days');
  });

  setChk('logEnabled', true);
  setVal('logLevel', 'warn');
  setVal('logRetentionDays', 14);
  setVal('logStorage', 'ndjson');
  setVal('maxRuntimeLog', 200);
  setChk('autoBackup', true);
  setVal('backupIntervalHours', 12);
  setVal('maxBackups', 5);
}

/** @returns {any} */
function saved() {
  return OPTS.currentSettings;
}

test('saveSettings 逐项回读：标量/嵌套组/TTL/日志/备份', async () => {
  fillFullUi();
  OPTS.currentSettings = { floatModules: { order: ['chips', 'bogus', 'tags'] } };
  await OPTS.saveSettings();
  const s = saved();

  expect(s.enabled).toBe(true);
  expect(s.highlightThreshold).toBeCloseTo(0.83);
  expect(s.maxBehaviorLog).toBe(500);
  expect(s.minSteamRatingFilter).toBe(70);
  expect(s.ratingFilterMode).toBe('or');
  expect(s.detailFloatSide).toBe('right');
  expect(s.redTitleRating).toBe(96);
  expect(s.badgeVisibility).toEqual({
    score: false,
    recent: true,
    all: true,
    update: true,
    rec: true,
    appstat: false
  });
  expect(s.enableRecommendations).toBe(false);
  expect(s.floatModules).toEqual({
    chips: false,
    tags: true,
    developers: false,
    description: true,
    spy: false,
    order: ['chips', 'tags'] // 非白名单键被过滤
  });
  expect(s.uiThemeNight).toBe('oled'); // trim 后空 → 默认
  expect(s.uiThemeNightStart).toBe(22);
  expect(s.uiThemeNightEnd).toBe(6);
  expect(s.ratingsBatchSize).toBe(80);
  expect(s.qrImageMaxKb).toBe(2048);
  expect(s.weights.clickRate).toBeCloseTo(0.1);
  expect(s.weights.appStatDetailView).toBeCloseTo(0.15);
  expect(s.llmConfig).toEqual({
    provider: 'openai',
    endpoint: 'https://api.example.com',
    apiKey: 'sk-x',
    model: 'm1',
    temperature: 0.45
  });
  expect(s.cacheTtls.steamDynamic).toEqual({ value: 12, unit: 'days' });
  expect(s.logLevel).toBe('warn');
  expect(s.maxRuntimeLog).toBe(200);
  expect(s.autoBackup).toBe(true);
  expect(s.backupIntervalHours).toBe(12);
  expect(s.maxBackups).toBe(5);
  // 面板模块收集钩子写入的键
  expect(s.trackedSites).toEqual(['custom.example']);
  expect(s.dataSources).toEqual({ steam: true });
  expect(s.steamSiteSearch).toEqual(['a']);
  // 串行发送 + 状态条
  expect(sent.at(-1).action).toBe('SAVE_SETTINGS');
  expect(sent.at(-1).settings).toBe(s);
  expect(dom.getElementById('saveStatus').textContent).toBe('✅ 已保存');
});

test('越界/空值回默认：夜间窗口、批次大小、二维码上限、扫描上限', async () => {
  OPTS.currentSettings = {};
  setVal('uiThemeNightStart', 99);
  setVal('uiThemeNightEnd', '');
  setVal('ratingsBatchSize', 9);
  setVal('qrImageMaxKb', 999999);
  setVal('appStatDownloadCap', '');
  setVal('uiThemeDay', '   ');
  setVal('uiThemeNight', ' x ');
  setVal('maxScanLinks', '');
  await OPTS.saveSettings();
  const s = saved();

  expect(s.uiThemeNightStart).toBe(19);
  expect(s.uiThemeNightEnd).toBe(7);
  expect(s.ratingsBatchSize).toBe(60);
  expect(s.qrImageMaxKb).toBe(3072);
  expect(s.appStatDownloadCap).toBe(100);
  expect(s.uiThemeDay).toBe('steam');
  expect(s.uiThemeNight).toBe('x');
  expect(s.maxScanLinks).toBe(500);
});

test('全量保存不抹掉面板/历史键（DEFAULT_SETTINGS 逐键存在且值不变）', async () => {
  const preserved = {
    steamApiKey: 'api-key',
    customThemeCss: '.x{color:red}',
    disabledSites: ['skip.example'],
    vmFilterKeywords: ['vm'],
    filterKeywords: ['kw'],
    filterMatchMode: 'or',
    filterRules: [{ id: 'r1' }],
    steamApiModules: { appdetails: true },
    trackedSites: ['old.example'],
    dataSources: { steam: false },
    steamSiteSearch: ['b'],
    itadProfiles: [{ id: 'p1' }],
    itadActiveProfileId: 'p1',
    itadApiKey: 'itad',
    favoritePriceWatch: false,
    favoriteDiscountThreshold: 70,
    weeklyDigestEnabled: true
  };
  OPTS.collectFavoriteSettings = () => {};
  OPTS.collectSitesSettings = () => {};
  OPTS.currentSettings = { ...preserved };
  await OPTS.saveSettings();
  const s = saved();

  Object.keys(DEFAULT_SETTINGS).forEach((key) => {
    expect(s, `DEFAULT_SETTINGS 键 ${key} 在保存后丢失`).toHaveProperty(key);
  });
  Object.entries(preserved).forEach(([key, value]) => {
    expect(s[key], `键 ${key} 被全量保存覆盖`).toEqual(value);
  });
});

test('保存失败可见：状态条提示错误且队列不中断', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  failNext = true;
  OPTS.currentSettings = {};
  await OPTS.saveSettings();
  expect(dom.getElementById('saveStatus').textContent).toBe('❌ 保存失败（见控制台）');
  expect(warn).toHaveBeenCalled();
  failNext = false;
  warn.mockRestore();
});

test('防抖自动保存：立即显示"保存中"并挂起定时器', () => {
  OPTS.currentSettings = {};
  OPTS.scheduleAutoSave();
  expect(dom.getElementById('saveStatus').textContent).toBe('⏳ 保存中...');
  expect(OPTS.saveTimer).toBeTruthy();
  clearTimeout(OPTS.saveTimer);
  OPTS.saveTimer = null;
});
