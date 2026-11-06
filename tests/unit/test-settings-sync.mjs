import { test, expect } from 'vitest';
/**
 * 游戏雷达 Game Radar - 测试：设置页同步完整性 / Settings-Sync Integrity
 *
 * v10.3.1（用户规则）：**功能新增、调整、删除时必须自动同步设置页**——
 * 本测试静态扫描 DEFAULT_SETTINGS 的全部键，强制其在设置层（options.js +
 * panels/*.js + options.html）与 popup 快捷层有引用，否则 `npm run check`
 * 失败。新增设置键时的四处同步（DEFAULT_SETTINGS / options 保存映射 /
 * settings 渲染 / popup）由此测试强制执行，不再依赖人工记忆。
 * Static scan enforcing that every settings key is referenced by the
 * settings UI layer; adding a key without UI sync fails the check.
 */
('use strict');

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS } from '../../background/core/constants.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');

// 设置层 = options.js 单体 + panels 拆分件 + HTML（控件 id 不含键名时以
// HTML 引用兜底）；popup 快捷层单独定义必需集
const optionsLayer = [
  'options/options.js',
  'options/panels/settings.js',
  'options/panels/settings-bind.js', // v14.11 B2：主题面板收集器（customThemeCss 直写）
  'options/panels/cache.js',
  'options/panels/data-manage.js',
  'options/panels/rules.js',
  // v14 B2：options.js 拆分新增面板（dataSources/steamApiModules/收藏折扣等迁入）
  'options/panels/search.js',
  'options/panels/favorites.js',
  'options/panels/sites.js',
  'options/panels/reset-defaults.js', // v14.2.0：每项恢复默认（69 锚点对 DEFAULT_SETTINGS 的引用入扫描）
  'options/options.html'
]
  .map(read)
  .join('\n');
const popupLayer = ['popup/popup.js', 'popup/popup-weights.js', 'popup/popup.html'].map(read).join('\n'); // v14.3.0：B6 拆分后权重滑块在 popup-weights.js

const hasWord = (src, k) => new RegExp('(?:^|[^\\w$])' + k + '(?:[^\\w$]|$)').test(src);

// 历史遗留键：无设置页 UI 且**有意不补**（兼容保留/已无消费方）——
// 新增豁免必须写明理由，防止豁免清单沦为绕过工具
const OPTIONS_ALLOWLIST = {
  steamApiKey:
    '无 UI：v14.6 起供 IStoreService/GetAppList 全量目录备源消费（app-list-index.js，用户经 Steamworks 获取 key 后写入 storage；保留数据兼容）',
  vmFilterKeywords: '旧兼容字段：v6.4.19 起 filterRules 取代，UI 已移除',
  filterKeywords: '旧兼容字段：v6.4.8 起 filterRules 取代，UI 已移除',
  filterMatchMode: '旧兼容字段：filterRules 语义内建排除词，UI 已移除',
  itadApiKey: '旧兼容字段：v6.4.19 起 itadProfiles 多配置取代'
};

test('DEFAULT_SETTINGS 顶层键全部同步设置层（options 层引用）', () => {
  const missing = Object.keys(DEFAULT_SETTINGS).filter((k) => !hasWord(optionsLayer, k) && !OPTIONS_ALLOWLIST[k]);
  expect(
    missing,
    '以下设置键未同步设置页（保存映射/渲染/HTML 任一即可），或应加入 OPTIONS_ALLOWLIST 并写明理由:\n  ' +
      missing.join('\n  ')
  ).toEqual([]);
});

// v14.11 B2（报告 D P0-1 根治）：写路径断言——每个 DEFAULT_SETTINGS 顶层键
// 必须出现在 saveSettings 的**收集段**（写路径）。报告 D 的 P0-1（三键 24 天
// 静默丢弃）正是"渲染/重置锚点齐全、唯保存断链"——读路径断言无法识别。
// 实现方式：无构建体系下从 options.js 源码提取 saveSettings 函数体做静态
// 包含检查（等价于人工逐键核对，机器化）。
test('DEFAULT_SETTINGS 顶层键全部进入 saveSettings 写路径（防保存断链复发）', () => {
  const optionsSrc = read('options/options.js');
  const start = optionsSrc.indexOf('async function saveSettings()');
  expect(start, 'options.js 应包含 saveSettings 函数').toBeGreaterThan(-1);
  // 从函数起点向后找匹配的函数体边界（brace 计数，容忍字符串内的花括号——
  // 该函数体无跨行模板串对象字面量误判风险时可简化，此处做保守计数）
  let depth = 0;
  let end = -1;
  for (let i = optionsSrc.indexOf('{', start); i < optionsSrc.length; i++) {
    const ch = optionsSrc[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  expect(end, 'saveSettings 函数体应可定位').toBeGreaterThan(start);
  const body = optionsSrc.slice(start, end);
  // 嵌套组键由表驱动收集（badgeIds/weightRows 等）——键名以字符串出现即可
  // 面板直写豁免：面板收集器直接改 OPTS.currentSettings 再由 saveSettings
  // 统一持久化（合法双段模式）——豁免须注明收集器位置，防沦为绕过工具
  const WRITE_PATH_ALLOWLIST = {
    customThemeCss: '面板直写：panels/settings-bind.js:98（主题面板）',
    trackedSites: '面板直写：panels/sites.js:155（站点面板收集器）',
    steamSiteSearch: '面板直写：panels/sites.js:156',
    favoritePriceWatch: '面板直写：panels/favorites.js:121',
    favoriteDiscountThreshold: '面板直写：panels/favorites.js:123',
    weeklyDigestEnabled: '面板直写：panels/favorites.js:125',
    dataSources: '面板直写：panels/sites.js:90',
    steamApiModules: '面板直写：panels/sites.js:133',
    disabledSites: '面板直写：panels/sites.js（N9 内置站开关 change 直写 currentSettings）'
  };
  const missing = Object.keys(DEFAULT_SETTINGS).filter(
    (k) => !hasWord(body, k) && !OPTIONS_ALLOWLIST[k] && !WRITE_PATH_ALLOWLIST[k]
  );
  expect(
    missing,
    '以下设置键未进入 saveSettings 收集段（且不在面板直写豁免清单）——用户修改将被旧值静默覆盖（v6.4.11/D-P0-1 同型事故）:\n  ' +
      missing.join('\n  ')
  ).toEqual([]);
  // 豁免防 stale：豁免键的收集器必须真实存在（含收集器位置注释复核）
  for (const k of Object.keys(WRITE_PATH_ALLOWLIST)) {
    expect(
      new RegExp('currentSettings\\.' + k + '\\s*=').test(optionsLayer),
      `WRITE_PATH_ALLOWLIST.${k} 的面板直写已不存在（currentSettings.${k} = 无命中），请清理豁免`
    ).toBe(true);
  }
});

test('豁免清单的键必须真实存在于 DEFAULT_SETTINGS（防 stale 豁免）', () => {
  const keys = new Set(Object.keys(DEFAULT_SETTINGS));
  const stale = Object.keys(OPTIONS_ALLOWLIST).filter((k) => !keys.has(k));
  expect(stale, '豁免清单包含已不存在的键，请清理:\n  ' + stale.join('\n  ')).toEqual([]);
});

// popup 快捷层必需集（popup 定位为高频设置的快捷入口——不要求全量）
const POPUP_REQUIRED = [
  'enabled',
  'showStatusBar',
  'showDebugPanel',
  'highlightThreshold',
  'maxBehaviorLog',
  'minSteamRatingFilter',
  'enableRatingFilter',
  'enableRecentFilter',
  'minRecentSteamRatingFilter',
  'ratingFilterMode',
  'enableSortByRating',
  'enableVmFilter',
  'useLLM',
  'autoBackup',
  'backupIntervalHours',
  'maxBackups',
  'enableLog',
  'logLevel',
  'logRetentionDays',
  'logStorage',
  'maxRuntimeLog',
  'maxScanLinks',
  'enableRecommendations',
  'downloadTrackingEnabled',
  'appStatsEnabled',
  'qrUnlockEnabled',
  'xdgridEnabled',
  'notifyFreeGames'
];

test('popup 快捷层必需集全部同步', () => {
  const missing = POPUP_REQUIRED.filter((k) => !hasWord(popupLayer, k));
  expect(
    missing,
    '以下 popup 必需键未同步（popup.js toggleMap/renderSettings 或 popup.html 控件）:\n  ' + missing.join('\n  ')
  ).toEqual([]);
});

// 嵌套组：badgeVisibility / weights 的子键逐一同步（新增信号/徽章时漏同步的高发区）
test('badgeVisibility 子键全部同步（options 层 + popup）', () => {
  const subs = Object.keys(DEFAULT_SETTINGS.badgeVisibility);
  const missingOptions = subs.filter((k) => !hasWord(optionsLayer, k));
  // popup 以控件 id / patch 键引用（badgeAppstat / badgeVisibility.appstat）
  const missingPopup = subs.filter((k) => !hasWord(popupLayer, k) && !popupLayer.includes('badgeVisibility.' + k));
  expect(missingOptions, 'badgeVisibility 子键未同步 options 层: ' + missingOptions.join(',')).toEqual([]);
  expect(missingPopup, 'badgeVisibility 子键未同步 popup: ' + missingPopup.join(',')).toEqual([]);
});

test('weights 子键全部同步（options 层 + popup 权重滑块）', () => {
  const subs = Object.keys(DEFAULT_SETTINGS.weights);
  const missingOptions = subs.filter((k) => !hasWord(optionsLayer, k));
  const missingPopup = subs.filter((k) => !hasWord(popupLayer, k));
  expect(missingOptions, 'weights 子键未同步 options 层: ' + missingOptions.join(',')).toEqual([]);
  expect(missingPopup, 'weights 子键未同步 popup 权重滑块: ' + missingPopup.join(',')).toEqual([]);
});

test('cacheTtls / dataSources / steamApiModules 子键全部同步 options 层', () => {
  const groups = ['cacheTtls', 'dataSources', 'steamApiModules'];
  const missing = [];
  for (const g of groups) {
    for (const k of Object.keys(DEFAULT_SETTINGS[g] || {})) {
      if (!hasWord(optionsLayer, k)) missing.push(g + '.' + k);
    }
  }
  expect(missing, '嵌套组子键未同步 options 层:\n  ' + missing.join('\n  ')).toEqual([]);
});
