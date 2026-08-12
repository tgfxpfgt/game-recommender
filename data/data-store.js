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
  settings: { file: 'settings.json', format: 'json' },
  behaviorLog: { file: 'behavior-log.ndjson', format: 'ndjson' },
  gameProfiles: { file: 'game-profiles.json', format: 'json' },
  keywordWeights: { file: 'keyword-weights.json', format: 'json' },
  steamCache: { file: 'steam-cache.json', format: 'json' },
  gameRegistry: { file: 'game-registry.json', format: 'json' },
  nameIndex: { file: 'name-index.json', format: 'json' },
  downloadUrls: { file: 'download-urls.json', format: 'json' },
  freeGames: { file: 'free-games.json', format: 'json' },
  runtimeLog: { file: 'runtime-log.ndjson', format: 'ndjson' },
  downloadHistory: { file: 'download-history.json', format: 'json' },
  adapterRules: { file: 'adapter-rules.json', format: 'json' },
  backups: { file: 'backups.json', format: 'json' },
  learnedNoise: { file: 'learned-noise.json', format: 'json' },
  wrongReports: { file: 'wrong-reports.json', format: 'json' }
};

class DataStore {
  constructor() {
    this.opfsAvailable = false;
    this.dir = null;
    this._initPromise = null;
    // v3.4.1：模块级写串行队列（并发追加/写入同一文件时不互相覆盖）
    this._writeQueues = {};
  }

  // v3.4.1：按模块串行化写入任务（后一个等待前一个完成，防 read-size+write 竞态）
  // Serialize writes per module (later tasks wait for earlier ones; kills the
  // read-size-then-write race between concurrent appends)
  _serialize(moduleKey, task) {
    const prev = this._writeQueues[moduleKey] || Promise.resolve();
    const run = prev.then(() => task());
    this._writeQueues[moduleKey] = run.then(
      () => undefined,
      () => undefined
    );
    return run;
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

  // v3.4.1 原子写：先写临时文件再移动/重命名到目标，进程中途崩溃不会留下
  // 半截损坏文件；旧版 Chrome（<112，无 move()）回退为直接写目标。
  // Atomic write since v3.4.1: write to a temp file, then move() over the target
  // so a crash mid-write cannot leave a truncated file; older Chrome falls back.
  async _writeHandle(fileHandle, value, format) {
    const text = format === 'ndjson' ? NDJSON.encode(value) : JSON.stringify(value);
    const tmpHandle = await this.dir.getFileHandle(fileHandle.name + '.tmp', { create: true });
    const tmpWritable = await tmpHandle.createWritable();
    await tmpWritable.write(text);
    await tmpWritable.close();
    if (typeof fileHandle.move === 'function') {
      // move() 目标已存在时直接替换（文件语义）/ move() replaces an existing target file
      await fileHandle.move(tmpHandle);
    } else {
      // 旧版 Chrome：直接覆盖目标（createWritable 默认截断，无法原子替换）
      const writable = await fileHandle.createWritable();
      await writable.write(text);
      await writable.close();
    }
  }

  // v3.4.1：读取损坏时把原文件备份为 <name>.corrupt-<ts> 并重置为空
  //（防止每次读取都崩溃/静默丢数据；备份供人工/工具恢复）
  // Corrupt file recovery: back the raw bytes up as <name>.corrupt-<ts>, reset
  // the module to its empty default (avoids crash-looping on every read)
  async _backupCorruptFile(fileHandle, file) {
    try {
      const backupName = fileHandle.name + '.corrupt-' + Date.now();
      const backupHandle = await this.dir.getFileHandle(backupName, { create: true });
      const writable = await backupHandle.createWritable();
      await writable.write(await file.text());
      await writable.close();
    } catch (e) {
      console.warn('[DataStore] 损坏文件备份失败:', e.message);
    }
  }

  async _resetFile(fileHandle) {
    const writable = await fileHandle.createWritable();
    await writable.write('');
    await writable.close();
  }

  async _readHandle(fileHandle, format) {
    const file = await fileHandle.getFile();
    if (file.size === 0) return format === 'ndjson' ? [] : null;
    const text = await file.text();
    try {
      return format === 'ndjson' ? NDJSON.decode(text) : JSON.parse(text);
    } catch (e) {
      // v3.4.1：损坏数据备份后重置为默认值（JSON 解析失败才走恢复路径；
      // NDJSON 内部已跳过损坏行）
      console.warn(`[DataStore] ${fileHandle.name} 数据损坏，备份后重置:`, e.message);
      await this._backupCorruptFile(fileHandle, file);
      try {
        await this._resetFile(fileHandle);
      } catch {
        /* 重置失败下次再试 */
      }
      return format === 'ndjson' ? [] : null;
    }
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
    // v3.4.1：同模块写入串行化（防并发覆盖）
    return this._serialize(moduleKey, async () => {
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
    });
  }

  // 追加单条（仅 ND-JSON 模块）：文件尾部追加一行，无需重写整个文件
  // Append one entry (ND-JSON modules only): appends a line without rewriting
  async appendModule(moduleKey, entry) {
    await this.init();
    const cfg = MODULE_FILES[moduleKey];
    if (!cfg || cfg.format !== 'ndjson') return;
    // v3.4.1：同模块写入串行化（修复并发追加时 read-size + write 竞态导致
    // 互相覆盖/错位的问题）
    return this._serialize(moduleKey, async () => {
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
    });
  }

  // 删除模块（OPFS 文件 + storage.local 键）
  // Remove a module (OPFS file + storage.local key)
  async removeModule(moduleKey) {
    const cfg = MODULE_FILES[moduleKey];
    if (this.opfsAvailable && cfg) {
      try {
        await this.dir.removeEntry(cfg.file);
      } catch {
        /* 文件不存在忽略 */
      }
    }
    await chrome.storage.local.remove(moduleKey);
  }
}

export const dataStore = new DataStore();
