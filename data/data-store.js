/**
 * Game Recommender - 数据存储层 / Data Store Layer
 *
 * 基于 OPFS（Origin Private File System）的分文件存储，突破
 * chrome.storage.local 5MB 配额限制。每个数据模块一个文件，文件格式按
 * 数据类型选择：
 *   - 日志类（浏览记录/运行日志）→ ND-JSON（追加写入高效）
 *   - 其余（配置/对象/缓存）→ JSON
 * OPFS 不可用（隐私模式/权限受限）时自动降级到 chrome.storage.local；
 * 首次启动若 OPFS 为空且有 storage.local 旧数据则自动迁移。
 *
 * Based on OPFS (Origin Private File System) with per-module files, breaking
 * the 5MB chrome.storage.local quota. Format is chosen per data type:
 *   - log-like (behaviorLog/runtimeLog) → ND-JSON (efficient appends)
 *   - everything else (config/objects/caches) → JSON
 * Falls back to chrome.storage.local when OPFS is unavailable; legacy
 * storage.local data is auto-migrated on first run.
 */
import { NDJSON } from '../lib/ndjson.js';

// 模块 → 文件与格式映射（模块键与 storage.local 键一致，便于降级与迁移）
// Module → file/format mapping (module keys equal the storage.local keys)
const MODULE_FILES = {
  settings:        { file: 'settings.json',         format: 'json' },
  behaviorLog:     { file: 'behavior-log.ndjson',   format: 'ndjson' },
  gameProfiles:    { file: 'game-profiles.json',    format: 'json' },
  keywordWeights:  { file: 'keyword-weights.json',  format: 'json' },
  steamCache:      { file: 'steam-cache.json',      format: 'json' },
  gameRegistry:    { file: 'game-registry.json',    format: 'json' },
  nameIndex:       { file: 'name-index.json',       format: 'json' },
  downloadUrls:    { file: 'download-urls.json',    format: 'json' },
  freeGames:       { file: 'free-games.json',       format: 'json' },
  runtimeLog:      { file: 'runtime-log.ndjson',    format: 'ndjson' },
  downloadHistory: { file: 'download-history.json', format: 'json' },
  adapterRules:    { file: 'adapter-rules.json',    format: 'json' },
  backups:         { file: 'backups.json',          format: 'json' }
};

class DataStore {
  constructor() {
    this.opfsAvailable = false;
    this.dir = null;
    this._initPromise = null;
  }

  // 初始化（幂等）：探测 OPFS 并迁移旧数据 / Init (idempotent): probe OPFS + migrate
  init() {
    if (!this._initPromise) {
      this._initPromise = this._doInit();
    }
    return this._initPromise;
  }

  async _doInit() {
    try {
      if (navigator.storage && navigator.storage.getDirectory) {
        this.dir = await navigator.storage.getDirectory();
        this.opfsAvailable = true;
      }
    } catch (e) {
      this.opfsAvailable = false;
      console.warn('[DataStore] OPFS 不可用，降级到 chrome.storage.local:', e.message);
    }
    if (this.opfsAvailable) {
      await this._migrateFromStorage();
    }
  }

  // 首次启动：把 storage.local 旧数据迁移到 OPFS（文件已存在则跳过）
  // First run: migrate legacy storage.local data into OPFS (skip existing files)
  async _migrateFromStorage() {
    try {
      const moduleKeys = Object.keys(MODULE_FILES);
      const stored = await chrome.storage.local.get(moduleKeys);
      let migrated = 0;
      for (const key of moduleKeys) {
        if (stored[key] === undefined) continue;
        const cfg = MODULE_FILES[key];
        const handle = await this.dir.getFileHandle(cfg.file, { create: true });
        const existing = await handle.getFile();
        if (existing.size > 0) continue; // 已迁移过 / already migrated
        await this._writeHandle(handle, stored[key], cfg.format);
        migrated++;
      }
      if (migrated > 0) {
        console.log(`[DataStore] 已迁移 ${migrated} 个模块到 OPFS`);
      }
    } catch (e) {
      console.warn('[DataStore] 迁移失败:', e.message);
    }
  }

  async _writeHandle(fileHandle, value, format) {
    const text = format === 'ndjson' ? NDJSON.encode(value) : JSON.stringify(value);
    const writable = await fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
  }

  async _readHandle(fileHandle, format) {
    const file = await fileHandle.getFile();
    if (file.size === 0) return format === 'ndjson' ? [] : null;
    const text = await file.text();
    return format === 'ndjson' ? NDJSON.decode(text) : JSON.parse(text);
  }

  // 读取模块：OPFS 优先，文件不存在时回退 storage.local（旧数据）
  // Read a module: OPFS first; falls back to storage.local when the file is absent
  async readModule(moduleKey) {
    await this.init();
    const cfg = MODULE_FILES[moduleKey];
    if (!cfg) return undefined;
    if (this.opfsAvailable) {
      try {
        const handle = await this.dir.getFileHandle(cfg.file, { create: false });
        return await this._readHandle(handle, cfg.format);
      } catch (e) {
        if (e && e.name === 'NotFoundError') {
          const stored = await chrome.storage.local.get(moduleKey);
          return stored[moduleKey];
        }
        console.warn(`[DataStore] 读取 ${moduleKey} 失败:`, e.message);
      }
    }
    const stored = await chrome.storage.local.get(moduleKey);
    return stored[moduleKey];
  }

  // 写入模块：OPFS 优先，失败降级 storage.local
  // Write a module: OPFS first, falls back to storage.local on failure
  async writeModule(moduleKey, value) {
    await this.init();
    const cfg = MODULE_FILES[moduleKey];
    if (!cfg) return;
    if (this.opfsAvailable) {
      try {
        const handle = await this.dir.getFileHandle(cfg.file, { create: true });
        await this._writeHandle(handle, value, cfg.format);
        return;
      } catch (e) {
        console.warn(`[DataStore] 写入 ${moduleKey} 到 OPFS 失败:`, e.message);
      }
    }
    await chrome.storage.local.set({ [moduleKey]: value });
  }

  // 追加单条（仅 ND-JSON 模块）：文件尾部追加一行，无需重写整个文件
  // Append one entry (ND-JSON modules only): appends a line without rewriting
  async appendModule(moduleKey, entry) {
    await this.init();
    const cfg = MODULE_FILES[moduleKey];
    if (!cfg || cfg.format !== 'ndjson') return;
    if (this.opfsAvailable) {
      try {
        const handle = await this.dir.getFileHandle(cfg.file, { create: true });
        const file = await handle.getFile();
        const prefix = file.size > 0 ? '\n' : '';
        const writable = await handle.createWritable({ keepExistingData: true });
        await writable.write({ type: 'write', position: file.size, data: prefix + JSON.stringify(entry) });
        await writable.close();
        return;
      } catch (e) {
        console.warn(`[DataStore] 追加 ${moduleKey} 失败:`, e.message);
      }
    }
    // 降级：读-改-写 / fallback: read-modify-write
    const stored = await chrome.storage.local.get(moduleKey);
    const list = stored[moduleKey] || [];
    list.push(entry);
    await chrome.storage.local.set({ [moduleKey]: list });
  }

  // 删除模块（OPFS 文件 + storage.local 键）
  // Remove a module (OPFS file + storage.local key)
  async removeModule(moduleKey) {
    const cfg = MODULE_FILES[moduleKey];
    if (this.opfsAvailable && cfg) {
      try { await this.dir.removeEntry(cfg.file); } catch (e) { /* 文件不存在忽略 */ }
    }
    await chrome.storage.local.remove(moduleKey);
  }
}

export const dataStore = new DataStore();
