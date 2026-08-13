/**
 * 游戏雷达 Game Radar - 运行日志 / Runtime Logger
 *
 * 内存缓冲 + 防抖批量写入；支持级别过滤、保留天数清理、存储形式选择
 * （ND-JSON 文件 / storage.local），由设置控制。
 * In-memory buffered logger with debounced flush; level filter, retention
 * cleanup and storage-format selection are config-driven.
 */
import { dataStore } from '../../data/data-store.js';
import { createDebouncedStore } from './debounced-store.js';
import { DB_KEYS, LOG_LEVELS, LOG_FLUSH_DEBOUNCE } from '../core/constants.js';
import { getSettings } from '../core/settings.js';

let logBuffer = [];
/** @type {{enableLog: boolean, minLevel: number, logStorage: string, logRetentionDays: number, maxRuntimeLog: number}|null} */
let logConfig = null; // 日志配置缓存（v3.4.1：高频 writeLog 不再每次读设置）
let logConfigChecked = 0; // 上次刷新时间戳

// 日志配置（10 秒缓存；开关/级别调整最多延迟 10s 生效——flush 仍实时读设置兜底）
// Logging config with a 10s cache (flush still reads settings live as a fallback)
async function getLogConfig() {
  const now = Date.now();
  if (logConfig && now - logConfigChecked < 10000) return logConfig;
  const settings = await getSettings();
  logConfig = {
    enableLog: !!settings.enableLog,
    minLevel: LOG_LEVELS[settings.logLevel] !== undefined ? LOG_LEVELS[settings.logLevel] : LOG_LEVELS.info,
    logStorage: settings.logStorage,
    logRetentionDays: settings.logRetentionDays || 0,
    maxRuntimeLog: settings.maxRuntimeLog || 300
  };
  logConfigChecked = now;
  return logConfig;
}

// 立即将缓冲区合并写入存储 / Flush buffered logs into storage immediately
// v6.1.0：防抖调度收敛至工厂
const writer = createDebouncedStore({
  name: '日志',
  debounceMs: LOG_FLUSH_DEBOUNCE,
  save: flushLogBuffer
});

export async function flushLogBuffer() {
  if (logBuffer.length === 0) return;

  const pending = logBuffer;
  logBuffer = [];

  try {
    // flush 低频（防抖 2s），实时读设置兜底（开关关闭时立即丢弃缓冲）
    const settings = await getSettings();
    if (!settings.enableLog) return; // 日志开关已关闭，丢弃缓冲 / Logging disabled; drop buffer

    const stored = await dataStore.readModule(DB_KEYS.RUNTIME_LOG);
    let logs = stored || [];
    logs.push(...pending);

    // 按保留天数清理过期日志（0 = 不清理）/ Purge by retention days (0 = keep all)
    const retentionMs = (settings.logRetentionDays || 0) * 24 * 3600 * 1000;
    if (retentionMs > 0) {
      const cutoff = Date.now() - retentionMs;
      logs = logs.filter((l) => l && l.timestamp >= cutoff);
    }

    const max = settings.maxRuntimeLog || 300;
    while (logs.length > max) logs.shift();

    // 按设置的存储形式落盘 / Persist per the configured storage format
    if (settings.logStorage === 'local') {
      await chrome.storage.local.set({ [DB_KEYS.RUNTIME_LOG]: logs });
    } else {
      await dataStore.writeModule(DB_KEYS.RUNTIME_LOG, logs);
    }
  } catch {
    // 日志写入失败不应影响主流程 / Log write failures must not affect the main flow
    logBuffer = [...pending, ...logBuffer];
  }
}

// 记录日志（按配置级别过滤）/ Write a log entry (filtered by configured level)
async function writeLog(level, module, message, data) {
  try {
    const cfg = await getLogConfig();
    if (!cfg.enableLog) return;
    if (LOG_LEVELS[level] < cfg.minLevel) return;

    const entry = { timestamp: Date.now(), level, module, message };
    if (data !== undefined) {
      try {
        const s = typeof data === 'string' ? data : JSON.stringify(data);
        entry.data = s.length > 1000 ? s.substring(0, 1000) + '...' : s;
      } catch {
        entry.data = String(data);
      }
    }

    logBuffer.push(entry);
    writer.scheduleWrite();
  } catch {
    // 忽略日志记录异常 / Ignore logging exceptions
  }
}

// 日志对象（各模块统一使用）/ Logger facade
export const Logger = {
  debug: (module, msg, data) => writeLog('debug', module, msg, data),
  info: (module, msg, data) => writeLog('info', module, msg, data),
  warn: (module, msg, data) => writeLog('warn', module, msg, data),
  error: (module, msg, data) => writeLog('error', module, msg, data)
};

// 读取日志（按存储形式）/ Read logs (per storage format)
export async function getRuntimeLogs(limit) {
  await flushLogBuffer(); // 先落盘缓冲，保证返回完整数据 / Flush buffer first
  const settings = await getSettings();
  let stored;
  if (settings.logStorage === 'local') {
    const data = await chrome.storage.local.get(DB_KEYS.RUNTIME_LOG);
    stored = data[DB_KEYS.RUNTIME_LOG];
  } else {
    stored = await dataStore.readModule(DB_KEYS.RUNTIME_LOG);
  }
  const logs = stored || [];
  return limit ? logs.slice(-limit) : logs;
}

// 清空日志 / Clear runtime logs
export async function clearRuntimeLogs() {
  logBuffer = [];
  const settings = await getSettings();
  if (settings.logStorage === 'local') {
    await chrome.storage.local.set({ [DB_KEYS.RUNTIME_LOG]: [] });
  } else {
    await dataStore.writeModule(DB_KEYS.RUNTIME_LOG, []);
  }
}

// 重置缓冲（备份恢复/导入/清除后调用）/ Reset the buffer
export function resetLogBuffer() {
  logBuffer = [];
  logConfig = null;
  logConfigChecked = 0;
}
