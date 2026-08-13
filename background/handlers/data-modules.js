import { dataStore } from '../../data/data-store.js';
import { DB_KEYS, DATA_MODULES, EXPORT_FORMAT, EXPORT_VERSION } from '../core/constants.js';
import { sanitizeImportedModule, IMPORT_MODULE_BYTES_LIMIT, IMPORT_TOTAL_BYTES_LIMIT } from '../core/rules.js';
import { createBackup, getBackupList, restoreBackup, deleteBackup } from '../storage/backups.js';
import { Logger } from '../storage/logger.js';
import { resetInMemoryCaches } from '../storage/reset.js';

/**
 * 游戏雷达 Game Radar - 消息处理：数据模块与备份 / Data-Module Handlers
 *
 * v5.0.0：由 handlers.js 拆分——导出/导入/模块清单/清数据。备份与日志导出由
 * handlers.js 注册表内联改为本模块具名函数。
 */

// --- 数据清除 / Data clearing ---
// v3.4.0：语义统一——"清除学习数据"同时删除 learnedNoise 存储（此前仅清
// 内存、存储保留导致下次加载恢复）；wrongReports（人工纠正知识库）为有意
// 保留的长期数据，不随本操作删除。
export async function handleClearData() {
  await Promise.all([
    dataStore.removeModule(DB_KEYS.BEHAVIOR_LOG),
    dataStore.removeModule(DB_KEYS.GAME_PROFILES),
    dataStore.removeModule(DB_KEYS.KEYWORD_WEIGHTS),
    dataStore.removeModule(DB_KEYS.STEAM_CACHE),
    dataStore.removeModule(DB_KEYS.GAME_REGISTRY),
    dataStore.removeModule(DB_KEYS.NAME_INDEX),
    dataStore.removeModule(DB_KEYS.DOWNLOAD_URLS),
    dataStore.removeModule(DB_KEYS.LEARNED_NOISE)
  ]);
  await chrome.storage.local.remove(DB_KEYS.MANUAL_MAPPINGS);
  resetInMemoryCaches();
  return { success: true };
}

// --- 适配规则管理（v3.0.0 规则编辑器支撑）---

// --- 数据模块：清单/导出/导入 ---
export function countModuleItems(value) {
  if (value === undefined || value === null) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'object') return Object.keys(value).length;
  return 1;
}

export async function handleGetDataModules() {
  const modules = [];
  for (const m of DATA_MODULES) {
    const value = await dataStore.readModule(m.storageKey);
    modules.push({ key: m.key, name: m.name, desc: m.desc, count: countModuleItems(value) });
  }
  return { modules };
}

export async function handleExportData(message) {
  const moduleKeys =
    message.moduleKeys && message.moduleKeys.length > 0 ? message.moduleKeys : DATA_MODULES.map((m) => m.key);
  const modules = {};
  for (const mod of DATA_MODULES) {
    if (!moduleKeys.includes(mod.key)) continue;
    const value = await dataStore.readModule(mod.storageKey);
    if (value !== undefined) modules[mod.key] = value;
  }
  // v3.4.0：密钥安全——导出/备份默认剔除 API 密钥（备份文件流转不再泄露
  // 凭据；导入/恢复后原密钥保留、提示重输）
  if (modules.settings) {
    const s = { ...modules.settings };
    if (s.llmConfig) s.llmConfig = { ...s.llmConfig, apiKey: '' };
    if (s.steamApiKey) s.steamApiKey = '';
    modules.settings = s;
  }
  // 适配规则无用户导入时导出内置规则
  if (moduleKeys.includes('adapterRules') && modules.adapterRules === undefined) {
    modules.adapterRules = globalThis.__GAME_RECOMMENDER_SITES__ || { version: 1, sites: [] };
  }
  Logger.info('Export', `导出数据模块: ${moduleKeys.join(', ')}（API 密钥已剔除）`);
  return {
    success: true,
    data: { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: Date.now(), modules }
  };
}

export async function handleImportData(message) {
  const payload = message.data;
  if (!payload || typeof payload !== 'object') return { success: false, error: '数据格式不正确' };
  if (payload.format !== EXPORT_FORMAT) return { success: false, error: '不是有效的 游戏雷达 Game Radar 导出文件' };
  if (payload.version !== EXPORT_VERSION) return { success: false, error: '导出文件版本不兼容: ' + payload.version };
  if (!payload.modules || typeof payload.modules !== 'object') return { success: false, error: '导出文件缺少模块数据' };

  const moduleKeys =
    message.moduleKeys && message.moduleKeys.length > 0 ? message.moduleKeys : Object.keys(payload.modules);
  try {
    const imported = [];
    let totalBytes = 0;
    for (const key of moduleKeys) {
      const mod = DATA_MODULES.find((m) => m.key === key);
      if (!mod) continue;
      const raw = payload.modules[key];
      if (raw === undefined) continue;
      // v3.4.1：白名单 + 类型 + 规模校验后再写入（拒绝恶意/畸形数据）
      const value = sanitizeImportedModule(mod.key, raw);
      if (value === null || value === undefined) {
        Logger.warn('Import', `模块 ${key} 校验失败，已跳过`);
        continue;
      }
      const size = JSON.stringify(value).length;
      totalBytes += size;
      if (size > IMPORT_MODULE_BYTES_LIMIT || totalBytes > IMPORT_TOTAL_BYTES_LIMIT) {
        Logger.warn('Import', `模块 ${key} 超出导入规模上限，已跳过`);
        continue;
      }
      await dataStore.writeModule(mod.storageKey, value);
      imported.push(key);
    }
    resetInMemoryCaches();
    Logger.info('Import', `导入数据模块: ${imported.join(', ')}`);
    return { success: true, imported };
  } catch (e) {
    Logger.error('Import', '导入失败', String(e));
    return { success: false, error: String(e) };
  }
}

// --- 备份（v5.0.0：由 handlers.js 注册表内联箭头提升为具名函数）---
export async function handleCreateBackup(msg) {
  const b = await createBackup(true, msg && msg.moduleKeys);
  return { success: !!b, backup: b ? { id: b.id, timestamp: b.timestamp, modules: b.modules } : null };
}

export async function handleGetBackups() {
  return { backups: await getBackupList() };
}

export async function handleRestoreBackup(msg) {
  return restoreBackup(msg.backupId, msg.moduleKeys);
}

export async function handleDeleteBackup(msg) {
  return deleteBackup(msg.backupId);
}
