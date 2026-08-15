/**
 * 游戏雷达 Game Radar - Service Worker 入口 / Entry Point
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

// 下载站适配规则（default 基础 + sites 各站，副作用导入：
// 执行后规则可通过 globalThis.__GAME_RECOMMENDER_SITES__ 读取）
// Download-site adapter rules (side-effect imports expose the rules globally)
import '../adapters/default.js';
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
import { Logger } from './storage/logger.js';
import { handleMessage } from './handlers.js';
import { refreshFreeGames } from './freegames/manager.js';
import { createBackup } from './storage/backups.js';

// ============ 消息监听 / Message Listener ============
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => {
      console.error('消息处理错误:', err);
      sendResponse({ error: err.message });
    });
  return true; // 保持消息通道开放 / keep the message channel open
});

// ============ 初始化 / Initialization ============
initStorage().catch((e) => console.error('初始化失败:', e));

// v7.0.4：存储内存预热（内存换延迟）——SW 启动时并行加载全部本地存储到
// 内存，首个列表页/详情页查询零磁盘等待；失败不影响主流程（各模块惰性
// 加载兜底）。Memory warm-up: parallel preload of local stores so the first
// list/detail queries never wait on disk IO.
Promise.allSettled([
  import('./storage/steam-cache.js').then((m) => m.loadSteamCacheToMemory()),
  import('./storage/name-index.js').then((m) => m.warmupNameIndex()),
  import('./storage/registry.js').then((m) => m.warmupRegistry()),
  import('./storage/wrong-reports.js').then((m) => m.warmupWrongReports()),
  import('./storage/learned-noise.js').then((m) => m.warmupLearnedNoise()),
  import('./storage/url-index.js').then((m) => m.warmupUrlIndex()),
  import('./storage/behavior.js').then((m) => m.warmupBehavior()),
  import('./storage/download-urls.js').then((m) => m.warmupDownloadUrls())
]);

// 定时器幂等创建：MV3 SW 每次冷启动都会重跑顶层代码，`alarms.create`
// 对同名 alarm 是替换（重新起算周期）——重复创建会让 24h 任务永远不触发。
// 已存在则跳过（v3.4.1 修复）。
// Idempotent alarm creation: MV3 SW top-level re-runs on every cold start and
// `alarms.create` REPLACES an existing alarm (restarts its period), so naive
// re-creation meant the daily tasks never fired. Skip when already present.
async function ensureAlarm(name, periodInMinutes) {
  try {
    const existing = await chrome.alarms.get(name);
    if (existing && existing.periodInMinutes === periodInMinutes) return;
    chrome.alarms.create(name, { periodInMinutes });
  } catch (e) {
    console.error('alarm 创建失败:', name, String(e));
  }
}

// 每日刷新限免游戏 / Refresh free games daily
ensureAlarm('refreshFreeGames', 24 * 60);

// 自动备份定时器 / Auto-backup alarm setup
async function setupBackupAlarm() {
  const settings = await getSettings();
  const intervalMinutes = (settings.backupIntervalHours || 24) * 60;
  await ensureAlarm('autoBackup', intervalMinutes);
}
setupBackupAlarm().catch((e) => console.error('自动备份定时器初始化失败:', String(e)));

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refreshFreeGames') {
    refreshFreeGames(true).catch((e) => console.error('限免刷新失败:', String(e)));
  }
  if (alarm.name === 'autoBackup') {
    getSettings().then((settings) => {
      if (settings.autoBackup) createBackup(false).catch((e) => console.error('自动备份失败:', String(e)));
    });
  }
});

// 启动时刷新限免游戏并更新 badge / Refresh free games on startup
refreshFreeGames(false).catch((e) => console.error('启动限免刷新失败:', String(e)));

// 启动日志（含版本号，便于确认浏览器加载的是否为最新版本）
// Startup log with the version, to verify the browser loaded the latest build
const MANIFEST_VERSION = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || 'unknown';
Logger.info('System', `Service Worker 已启动 v${MANIFEST_VERSION}`);
console.log(`【游戏雷达】 Service Worker 已启动 v${MANIFEST_VERSION}`);
