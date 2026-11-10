/**
 * 游戏雷达 Game Radar - 设置面板渲染 DOM 单测 / Settings panel render test
 *
 * v14.27.0（P2-4）：Fake DOM 驱动 settings-render.js（回显 / 站点管理 /
 * 站点删除回收权限 / 权重总和），覆盖 options 层此前 0% 的渲染路径。
 * Exercises settings-render.js against a fake DOM: echo, site management,
 * permission revocation on removal, and weight-sum indicator.
 */
import { test, expect } from 'vitest';
import { installFakeDom, makeEl } from '../helpers/fake-dom.mjs';

const dom = installFakeDom();
globalThis.document = dom.document;
globalThis.window = globalThis;
// Fake 元素的 innerHTML 不参与 textContent 计算，shared/escape.js 的 div 实现
// 无法在此生效——按同一语义提供纯字符串实现 / String-only escape impls
globalThis.escapeHtml = (t) =>
  String(t ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
globalThis.escapeAttr = (t) =>
  String(t ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

await import('../../options/panels/settings-render.js');
const OPTS = globalThis.__OPTS__;

OPTS.TTL_FIELDS = [
  { id: 'ttlSteamDynamic', key: 'steamDynamic', defaultUnit: 'hours' },
  { id: 'ttlMetaSteam', key: 'metaSteam', defaultUnit: 'days' }
];

/** @type {any} */
let fmOrderSeen = null;
OPTS.renderFmOrder = (order) => {
  fmOrderSeen = order;
};
/** @type {any} */
let rulesSeen = null;
globalThis.__renderRules = (rules) => {
  rulesSeen = rules;
};

const settings = {
  enabled: true,
  showStatusBar: false,
  showDebugPanel: true,
  highlightThreshold: 0.83,
  maxBehaviorLog: 400,
  enableRatingFilter: true,
  minSteamRatingFilter: 65,
  enableRecentFilter: true,
  minRecentSteamRatingFilter: 55,
  ratingFilterMode: 'or',
  enableSortByRating: true,
  badgeVisibility: { score: false },
  maxScanLinks: 321,
  ratingsBatchSize: 75,
  qrImageMaxKb: 1024,
  enableVmFilter: true,
  uiTheme: 'oled',
  filterRules: [{ id: 'x' }],
  weights: {
    clickRate: 0.1,
    downloadRate: 0.15,
    keywordMatch: 0.05,
    steamRating: 0.2,
    playTime: 0.05,
    heat: 0.1,
    sales: 0.05,
    reviews: 0.05,
    appStatDownload: 0.1,
    appStatDetailView: 0.15
  },
  enableRecommendations: true,
  downloadTrackingEnabled: true,
  appStatsEnabled: true,
  qrUnlockEnabled: false,
  xdgridEnabled: true,
  notifyFreeGames: false,
  favoritePriceWatch: true,
  favoriteDiscountThreshold: 85,
  weeklyDigestEnabled: false,
  freeGamesEnabled: true,
  themeAutoSwitch: true,
  uiThemeDay: 'steam',
  uiThemeNight: 'oled',
  uiThemeNightStart: 21,
  uiThemeNightEnd: 8,
  appStatDedupHours: 48,
  appStatDownloadCap: 120,
  appStatDetailViewCap: 90,
  detailFloatExpanded: false,
  detailFloatSide: 'right',
  floatModules: { order: ['tags', 'spy'], chips: false },
  redTitleRating: 90,
  llmConfig: { provider: 'openai', endpoint: 'https://e.example', apiKey: 'k', model: 'm', temperature: 0.42 },
  useLLM: true,
  cacheTtls: { steamDynamic: { value: 6, unit: 'hours' }, metaSteam: 3 },
  enableLog: false,
  logLevel: 'error',
  logRetentionDays: 3,
  logStorage: 'memory',
  maxRuntimeLog: 100,
  autoBackup: false,
  backupIntervalHours: 6,
  maxBackups: 3,
  trackedSites: [],
  steamSiteSearch: []
};

test('renderSettings 回显：标量/滑块/权重/LLM/TTL/日志', () => {
  OPTS.renderSettings(settings);
  const el = (id) => dom.getElementById(id);

  expect(el('enabled').checked).toBe(true);
  expect(el('showStatusBar').checked).toBe(false);
  expect(el('showDebugPanel').checked).toBe(true);
  expect(el('threshold').value).toBe(83);
  expect(el('thresholdVal').textContent).toBe('83%');
  expect(el('minRatingVal').textContent).toBe('65%');
  expect(el('minRecentRatingVal').textContent).toBe('55%');
  expect(el('ratingFilterMode').value).toBe('or');
  // 显式 false 与缺省 true 两种分支
  expect(el('badgeScore').checked).toBe(false);
  expect(el('badgeRecent').checked).toBe(true);
  expect(el('weightClick').value).toBe('10.00');
  expect(el('weightSum').textContent).toBe('1.00');
  expect(fmOrderSeen).toEqual(['tags', 'spy']);
  expect(rulesSeen).toEqual([{ id: 'x' }]);
  expect(el('llmSettings').style.display).toBe('block');
  expect(el('apiKeyRow').style.display).toBe('flex');
  expect(el('llmTempVal').textContent).toBe('42.0');
  // TTL：对象形态取值 + 旧数字形态补默认单位
  expect(el('ttlSteamDynamic').value).toBe(6);
  expect(el('ttlSteamDynamicUnit').value).toBe('hours');
  expect(el('ttlMetaSteam').value).toBe(3);
  expect(el('ttlMetaSteamUnit').value).toBe('days');
  expect(el('logLevel').value).toBe('error');
  expect(el('maxBackups').value).toBe(3);
});

test('renderSiteManagement：规则行转义/追踪勾选/自定义站点过滤', () => {
  OPTS.siteRules = {
    sites: [
      { key: 'a', name: 'Site <A>', domains: ['a.com'], searchUrl: 'u' },
      { key: 'b', name: 'B', domains: ['b.com'] },
      { key: 'bad', name: 'Bad', domains: 'not-array' }
    ]
  };
  const s = { trackedSites: ['a.com', 'custom.com'], steamSiteSearch: ['a'] };
  OPTS.renderSiteManagement(s);

  const managed = dom.getElementById('siteManageList').innerHTML;
  expect(managed).toContain('Site &lt;A&gt;');
  expect(managed).toContain('data-domain="a.com" checked');
  expect(managed).toContain('data-site="a" checked');
  expect(managed).toContain('无站内搜索');
  expect(managed).toContain('data-domain="b.com" >'); // 未追踪

  const custom = dom.getElementById('siteList').innerHTML;
  expect(custom).toContain('custom.com');
  expect(custom).not.toContain('a.com');
});

test('删除自定义站点：收缩 trackedSites + 回收该域权限 + 触发自动保存', () => {
  /** @type {any} */
  let removed = null;
  globalThis.chrome = {
    permissions: {
      /** @param {any} p */
      remove: async (p) => {
        removed = p;
        return true;
      }
    }
  };
  const btn = makeEl('');
  btn.dataset.domain = 'custom.com';
  btn.classList.add('remove-site');
  const siteList = dom.getElementById('siteList');
  siteList.querySelectorAll = () => [btn];

  OPTS.siteRules = { sites: [{ key: 'a', name: 'A', domains: ['a.com'] }] };
  const s = { trackedSites: ['a.com', 'custom.com'], steamSiteSearch: [] };
  OPTS.currentSettings = s; // 真实页面中二者同一引用
  let autosaves = 0;
  OPTS.scheduleAutoSave = () => {
    autosaves++;
  };
  OPTS.renderSiteManagement(s); // 本次渲染把删除处理器绑到 btn

  btn.click();

  expect(s.trackedSites).toEqual(['a.com']);
  expect(removed).toEqual({ origins: ['http://custom.com/*', 'https://custom.com/*'] });
  expect(autosaves).toBe(1);
  expect(siteList.innerHTML).toBe('');
});

test('权重总和指示器：1.00 无标记 / 偏差 warn / 严重偏离 bad', () => {
  const ids = [
    'weightClick',
    'weightDownload',
    'weightKeyword',
    'weightSteam',
    'weightPlayTime',
    'weightHeat',
    'weightSales',
    'weightReviews',
    'weightAppStatDownload',
    'weightAppStatDetailView'
  ];
  ids.forEach((id) => (dom.getElementById(id).value = '10'));
  const sum = dom.getElementById('weightSum');
  OPTS.updateWeightSum();
  expect(sum.textContent).toBe('1.00');
  expect(sum.classList.contains('warn')).toBe(false);

  dom.getElementById('weightClick').value = '5'; // 0.95 → warn
  OPTS.updateWeightSum();
  expect(sum.classList.contains('warn')).toBe(true);
  expect(sum.classList.contains('bad')).toBe(false);

  ids.forEach((id) => (dom.getElementById(id).value = '0')); // 0.00 → bad
  OPTS.updateWeightSum();
  expect(sum.classList.contains('warn')).toBe(false);
  expect(sum.classList.contains('bad')).toBe(true);
});

test('toggleApiKeyRow：local 隐藏 API Key 行', () => {
  dom.getElementById('llmProvider').value = 'local';
  OPTS.toggleApiKeyRow();
  expect(dom.getElementById('apiKeyRow').style.display).toBe('none');
});
