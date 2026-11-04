/**
 * 游戏雷达 Game Radar - 报错纠正记录 / Wrong-Report Corrections
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
  const existing = wrongReportsMemory.get(name) || {
    wrongAppId: null,
    correctAppId: null,
    count: 0,
    reportedAt: 0,
    correctedAt: null
  };
  const entry = {
    wrongAppId: info.wrongAppId !== undefined ? String(info.wrongAppId) : existing.wrongAppId || null,
    correctAppId: info.correctAppId !== undefined ? String(info.correctAppId) : existing.correctAppId || null,
    count: (existing.count || 0) + 1,
    reportedAt: existing.reportedAt || now,
    correctedAt: info.correctAppId !== undefined ? now : existing.correctedAt || null
  };
  wrongReportsMemory.set(name, entry);
  wrongReportsDirty = true;
  scheduleWrite();
  return entry;
}

// v7.0.4：预热内存缓存（SW 启动时调用）
export async function warmupWrongReports() {
  await loadWrongReports();
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
// v10.7.0 批次2：dirty 标记——聚合 flush 此前无条件全量重写本文件
let wrongReportsDirty = false;
const writer = createDebouncedStore({
  name: '报错记录',
  debounceMs: NAME_INDEX_WRITE_DEBOUNCE,
  save: async () => {
    if (!wrongReportsMemory || !wrongReportsDirty) return;
    await dataStore.writeModule(DB_KEYS.WRONG_REPORTS, Object.fromEntries(wrongReportsMemory));
    wrongReportsDirty = false; // 仅成功后清除（失败保留待重试）
  }
});
const scheduleWrite = writer.scheduleWrite;

// 强制立即写入 / Force flush
export const flushWrongReports = writer.flush;

// 重置（备份恢复/导入/清除后调用）/ Reset
export function resetWrongReports() {
  wrongReportsMemory = new Map();
  wrongReportsDirty = false;
  wrongReportsLoaded = false;
  writer.reset();
}

// 供测试/管理页读取的内存引用 / In-memory reference (tests/management)
export function getWrongReportsMemory() {
  return wrongReportsMemory;
}

// ============ v14.15.0 N5：纠正映射独立导出/导入 ============

/**
 * 导出全部纠正映射（含 report-only 条目——wrongAppId 黑名单同样是用户劳动
 * 成果）。返回 {gameName: entry} 纯对象（JSON 信封友好）。
 * Export all corrections incl. report-only entries (the wrongAppId blacklist
 * is user work too); plain-object form for a JSON envelope.
 */
export function exportAllCorrections() {
  return Object.fromEntries(wrongReportsMemory);
}

/**
 * 导入纠正映射（逐条校验 + 合并 upsert：已存在的条目按字段合并——导入值
 * 优先、保留本地 reportedAt 更早者；count 取大者）。
 * Import with per-entry validation + merge-upsert.
 * @param {Record<string, {wrongAppId?: string|null, correctAppId?: string|null, count?: number, reportedAt?: number, correctedAt?: number|null}>} entries
 * @returns {{imported: number, rejected: number}}
 */
export function importCorrections(entries) {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    return { imported: 0, rejected: 0 };
  }
  const appIdRe = /^\d{1,10}$/;
  let imported = 0;
  let rejected = 0;
  const now = Date.now();
  for (const [rawName, raw] of Object.entries(entries)) {
    const name = String(rawName || '').trim();
    if (!name || name.length > 200 || !raw || typeof raw !== 'object') {
      rejected += 1;
      continue;
    }
    const correct = raw.correctAppId == null ? null : String(raw.correctAppId);
    const wrong = raw.wrongAppId == null ? null : String(raw.wrongAppId);
    if (correct !== null && !appIdRe.test(correct)) {
      rejected += 1;
      continue;
    }
    if (wrong !== null && !appIdRe.test(wrong)) {
      rejected += 1;
      continue;
    }
    if (correct === null && wrong === null) {
      rejected += 1; // 双空条目无语义
      continue;
    }
    const existing = wrongReportsMemory.get(name);
    const merged = {
      wrongAppId: wrong !== null ? wrong : existing ? existing.wrongAppId : null,
      correctAppId: correct !== null ? correct : existing ? existing.correctAppId : null,
      count: Math.max(Number(raw.count) || 0, existing ? existing.count || 0 : 0),
      reportedAt: existing && existing.reportedAt ? existing.reportedAt : Number(raw.reportedAt) || now,
      correctedAt: correct !== null ? now : existing ? existing.correctedAt : null
    };
    wrongReportsMemory.set(name, merged);
    wrongReportsDirty = true;
    imported += 1;
  }
  if (imported > 0) scheduleWrite();
  return { imported, rejected };
}
