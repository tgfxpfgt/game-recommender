/**
 * Game Recommender - 备份管理 / Backups
 *
 * 模块化备份（可勾选数据模块），自动/手动创建、恢复（安全网备份）、
 * 列表与删除。备份记录含模块清单，旧备份兼容视为全量。
 * Modular backups (selectable data modules), auto/manual create, restore with
 * safety-net backup, list & delete. Legacy backups are treated as full.
 */
import { dataStore } from '../../data/data-store.js';
import { DB_KEYS, DATA_MODULES } from '../core/constants.js';
import { getSettings } from '../core/settings.js';
import { resetInMemoryCaches } from '../core/reset.js';
import { Logger } from './logger.js';

// 创建备份（moduleKeys 可选：勾选要备份的模块，默认全部）
// Create a backup (moduleKeys optional; defaults to all modules)
export async function createBackup(manual = false, moduleKeys = null) {
  try {
    const modules = moduleKeys
      ? DATA_MODULES.filter(m => moduleKeys.includes(m.key))
      : DATA_MODULES;
    const storageKeys = modules.map(m => m.storageKey);
    const snapshot = {};
    for (const key of storageKeys) {
      const value = await dataStore.readModule(key);
      if (value !== undefined) snapshot[key] = value;
    }

    const backup = {
      id: (crypto.randomUUID ? crypto.randomUUID().substring(0, 8) : Date.now().toString(36)) + Date.now().toString(36),
      timestamp: Date.now(),
      manual,
      modules: modules.map(m => m.key), // 记录本次备份包含的模块 / modules included
      size: JSON.stringify(snapshot).length,
      data: snapshot
    };

    const stored = await dataStore.readModule(DB_KEYS.BACKUPS);
    const backups = stored || [];
    backups.push(backup);

    const settings = await getSettings();
    const max = settings.maxBackups || 7;
    while (backups.length > max) backups.shift();

    await dataStore.writeModule(DB_KEYS.BACKUPS, backups);
    Logger.info('Backup', `创建${manual ? '手动' : '自动'}备份 ${backup.id}`, { size: backup.size, modules: backup.modules.length, count: backups.length });
    return backup;
  } catch (e) {
    Logger.error('Backup', '创建备份失败', e.message);
    return null;
  }
}

// 备份列表（含模块清单）/ Backup list (with module lists)
export async function getBackupList() {
  const stored = await dataStore.readModule(DB_KEYS.BACKUPS);
  const backups = stored || [];
  return backups.map(b => ({
    id: b.id, timestamp: b.timestamp, manual: b.manual, size: b.size,
    modules: b.modules || null // 旧备份无 modules 字段视为全量 / legacy = all modules
  })).reverse();
}

// 恢复备份（moduleKeys 可选：勾选要恢复的模块，默认全部）
// Restore a backup (moduleKeys optional; defaults to all modules)
export async function restoreBackup(backupId, moduleKeys = null) {
  try {
    const stored = await dataStore.readModule(DB_KEYS.BACKUPS);
    const backups = stored || [];
    const backup = backups.find(b => b.id === backupId);
    if (!backup || !backup.data) {
      Logger.warn('Backup', `备份不存在: ${backupId}`);
      return { success: false, error: '备份不存在' };
    }

    // 恢复前先创建当前状态的备份（安全网）/ Safety-net backup first
    await createBackup(true);

    const modules = moduleKeys
      ? DATA_MODULES.filter(m => moduleKeys.includes(m.key))
      : DATA_MODULES;
    const snapshot = {};
    for (const mod of modules) {
      const key = mod.storageKey;
      if (backup.data[key] !== undefined) snapshot[key] = backup.data[key];
    }
    for (const [key, value] of Object.entries(snapshot)) {
      await dataStore.writeModule(key, value);
    }
    // 备份数据可能包含旧的 settings 及各层缓存，必须使所有内存缓存失效
    resetInMemoryCaches();
    Logger.info('Backup', `已恢复备份 ${backupId}`, { modules: modules.map(m => m.key).length });
    return { success: true };
  } catch (e) {
    Logger.error('Backup', '恢复备份失败', e.message);
    return { success: false, error: e.message };
  }
}

// 删除备份 / Delete a backup
export async function deleteBackup(backupId) {
  const stored = await dataStore.readModule(DB_KEYS.BACKUPS);
  let backups = stored || [];
  backups = backups.filter(b => b.id !== backupId);
  await dataStore.writeModule(DB_KEYS.BACKUPS, backups);
  return { success: true };
}
