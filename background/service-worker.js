/**
 * Game Recommender - Service Worker 入口 / Entry Point
 *
 * 模块化架构（按功能分类拆分，便于维护升级）：
 *   core/      常量、工具、设置、适配规则、缓存重置
 *   storage/   各数据模块（Steam 缓存/注册表/名称索引/网址缓存/行为/日志/备份/历史）
 *   steam/     标题解析、Steam API、编排器
 *   recommend/ 推荐算法引擎
 *   sites/     下载站搜索
 *   freegames/ 限免管理
 *   handlers.js 消息处理与分发映射
 *
 * 本文件仅负责：适配规则副作用导入、消息监听、定时任务与初始化。
 * Modular architecture (split by feature for maintainability):
 *   core/ storage/ steam/ recommend/ sites/ freegames/ handlers.js
 * This entry only wires imports, the message listener, alarms and startup.
 */

// 下载站适配规则（default 基础 + platforms 平台 + sites 各站，副作用导入：
// 执行后规则可通过 globalThis.__GAME_RECOMMENDER_SITES__ / __PLATFORMS__ 读取）
// Download-site adapter rules (side-effect imports expose the rules globally)
import '../adapters/default.js';
import '../adapters/platforms/steam.js';
import '../adapters/platforms/epic.js';
import '../adapters/platforms/gog.js';
import '../adapters/sites/xdgame.js';
import '../adapters/sites/xianyudanji.js';
import '../adapters/sites/gamer520.js';
import '../adapters/sites/3dmgame.js';
import '../adapters/sites/ali213.js';
import '../adapters/sites/gamersky.js';
import '../adapters/index.js';

// 数据存储层：OPFS 分文件存储（突破 5MB 配额），不可用时降级 storage.local
// Data store layer (OPFS per-module files; falls back to storage.local)
import { initStorage, getSettings } from './core/settings.js';
import { Logger, flushLogBuffer } from './storage/logger.js';
import { handleMessage } from './handlers.js';
import { refreshFreeGames } from './freegames/manager.js';
import { createBackup } from './storage/backups.js';

// ============ 消息监听 / Message Listener ============
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    console.error('消息处理错误:', err);
    sendResponse({ error: err.message });
  });
  return true; // 保持消息通道开放 / keep the message channel open
});

// ============ 初始化 / Initialization ============
initStorage().catch(e => console.error('初始化失败:', e));

// 每日刷新限免游戏 / Refresh free games daily
chrome.alarms.create('refreshFreeGames', { periodInMinutes: 24 * 60 });

// 自动备份定时器 / Auto-backup alarm setup
async function setupBackupAlarm() {
  const settings = await getSettings();
  const intervalMinutes = (settings.backupIntervalHours || 24) * 60;
  chrome.alarms.create('autoBackup', { periodInMinutes: intervalMinutes });
}
setupBackupAlarm();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refreshFreeGames') {
    refreshFreeGames(true);
  }
  if (alarm.name === 'autoBackup') {
    getSettings().then(settings => {
      if (settings.autoBackup) createBackup(false);
    });
  }
});

// 启动时刷新限免游戏并更新 badge / Refresh free games on startup
refreshFreeGames(false);

// 启动日志（含版本号，便于确认浏览器加载的是否为最新版本）
// Startup log with the version, to verify the browser loaded the latest build
const MANIFEST_VERSION = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || 'unknown';
Logger.info('System', `Service Worker 已启动 v${MANIFEST_VERSION}`);
console.log(`[Game Recommender] Service Worker 已启动 v${MANIFEST_VERSION}`);
