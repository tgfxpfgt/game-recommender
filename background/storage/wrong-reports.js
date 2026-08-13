/**
 * Game Recommender - 报错纠正记录 / Wrong-Report Corrections
 *
 * v3.3.13：详情页检索错误时用户点"报错"/手动选择确认正确 appid 的**长期记录**
 * （独立数据模块，不随缓存清理删除）。检索时人工纠正知识库优先，并排除曾
 * 报错的错误 appid——长期积累自动改善匹配规则。
 *
 * Long-term record of user-reported wrong appIds and their manually confirmed
 * corrections (separate module, never purged with the caches). The search
 * prefers confirmed corrections and excludes reported-wrong appIds, so the
 * matching rules improve automatically over time.
 */
import { dataStore } from '../../data/data-store.js';
import { DB_KEYS, NAME_INDEX_WRITE_DEBOUNCE } from '../core/constants.js';
import { createDebouncedStore } from './debounced-store.js';

/** @type {Map<string, {wrongAppId: string|null, correctAppId: string|null, count: number, reportedAt: number, correctedAt: number|null}>} */
let wrongReportsMemory = new Map(); // Map: gameName(原文) → { wrongAppId, correctAppId, count, reportedAt, correctedAt }
let wrongReportsLoaded = false;

// 加载记录到内存（首次从存储读取）/ Load into memory (once)
async function loadWrongReports() {
  if (wrongReportsLoaded) return;
  const stored = await dataStore.readModule(DB_KEYS.WRONG_REPORTS);
  wrongReportsMemory = new Map(Object.entries(stored || {}));
  wrongReportsLoaded = true;
}

/**
 * 记录一次报错/纠正样本。已存在的同名记录：count+1、字段合并更新。
 * source='report' 记录错误 appid；source='manual' 记录用户确认的正确 appid。
 * Record a report/correction sample; existing entries get count+1 and merged.
 * @param {string} gameName - 下载站页面标题（记录键）
 * @param {{wrongAppId?: string|number, correctAppId?: string|number, source?: string}} info
 */
export async function recordWrongReport(gameName, info = {}) {
  const name = (gameName || '').trim();
  if (!name) return;
  await loadWrongReports();
  const now = Date.now();
  /** @type {{wrongAppId: string|null, correctAppId: string|null, count: number, reportedAt: number, correctedAt: number|null}} */
  const existing = wrongReportsMemory.get(name) || { wrongAppId: null, correctAppId: null, count: 0, reportedAt: 0, correctedAt: null };
  const entry = {
    wrongAppId: info.wrongAppId !== undefined ? String(info.wrongAppId) : existing.wrongAppId || null,
    correctAppId: info.correctAppId !== undefined ? String(info.correctAppId) : existing.correctAppId || null,
    count: (existing.count || 0) + 1,
    reportedAt: existing.reportedAt || now,
    correctedAt: info.correctAppId !== undefined ? now : existing.correctedAt || null
  };
  wrongReportsMemory.set(name, entry);
  scheduleWrite();
  return entry;
}

/**
 * 查询某标题的人工纠正知识（有 correctAppId 才返回——用户手动确认过的正确本体）。
 * Look up the confirmed correction for a title (only when a correctAppId exists).
 * @param {string} gameName - 下载站页面标题
 * @returns {Promise<{correctAppId: string, wrongAppId: string|null}|null>}
 */
export async function lookupWrongReportCorrection(gameName) {
  const name = (gameName || '').trim();
  if (!name) return null;
  await loadWrongReports();
  const entry = wrongReportsMemory.get(name);
  if (!entry || !entry.correctAppId) return null;
  return { correctAppId: String(entry.correctAppId), wrongAppId: entry.wrongAppId ? String(entry.wrongAppId) : null };
}

// v5.1.0：防抖写入收敛至 debounced-store 工厂
const writer = createDebouncedStore({
  name: '报错记录',
  debounceMs: NAME_INDEX_WRITE_DEBOUNCE,
  save: async () => {
    if (!wrongReportsMemory) return;
    await dataStore.writeModule(DB_KEYS.WRONG_REPORTS, Object.fromEntries(wrongReportsMemory));
  }
});
const scheduleWrite = writer.scheduleWrite;

// 强制立即写入 / Force flush
export const flushWrongReports = writer.flush;

// 重置（备份恢复/导入/清除后调用）/ Reset
export function resetWrongReports() {
  wrongReportsMemory = new Map();
  wrongReportsLoaded = false;
  writer.reset();
}

// 供测试/管理页读取的内存引用 / In-memory reference (tests/management)
export function getWrongReportsMemory() {
  return wrongReportsMemory;
}
