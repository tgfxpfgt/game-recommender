/**
 * 游戏雷达 Game Radar - 手动平台映射 / Manual Platform Mapping
 *
 * v14.19.0（用户需求：详情页匹配错误时手动选择主机机型）：用户在候选浮窗
 * 声明"这是主机/模拟器游戏"并选择机型后的**长期映射**（独立数据模块，不随
 * 缓存清理删除，随备份导出）。检索/评分管线**优先于一切索引**消费：
 * - 列表页第一波/第二波：映射条目直接返回 MC/平台终态（错误 Steam 徽章
 *   不再出现——URL 索引/名称索引钉死的错 appId 被映射短路）
 * - 详情页 SEARCH_STEAM：映射条目返回 MC 形态数据（浮窗 MC 视图）
 * - Metacritic 分数在声明时已抓取并固化（主机条目评分源，语义 = 用户确认
 *   的终态，不做 TTL 重查——分数缺失时后续管线可按主机条目走 phasePlatform
 *   常规预算补查）
 * Long-term mapping of "this title is a console/emulator game" declared by
 * the user via the manual-select float. Consulted before every index by both
 * pipelines; the Metacritic score captured at declaration time is persisted.
 */
import { dataStore } from '../../data/data-store.js';
import { DB_KEYS, NAME_INDEX_WRITE_DEBOUNCE, STORAGE_CAPS } from '../core/constants.js';
import { createDebouncedStore } from './debounced-store.js';
import { Logger } from './logger.js';

/**
 * @typedef {Object} ManualPlatformEntry
 * @property {'console'|'emulator'} kind - 平台类别（console = 主机，emulator = 模拟器 ROM）
 * @property {string} tag - 徽章文案（机型名）
 * @property {number|null} mcScore - Metacritic 媒体评分（声明时抓取；null = 无分/无 EN 段）
 * @property {string|null} mcName - 抓分所用英文名（slug 推导依据，悬停展示）
 * @property {number} at - 声明时间戳
 */

/** @type {Map<string, ManualPlatformEntry>} */
let manualPlatformsMemory = new Map(); // Map: gameName(原文) → entry
let manualPlatformsLoaded = false;
let manualPlatformsDirty = false;

async function loadManualPlatforms() {
  if (manualPlatformsLoaded) return;
  const stored = await dataStore.readModule(DB_KEYS.MANUAL_PLATFORMS);
  manualPlatformsMemory = new Map(Object.entries(stored || {}));
  manualPlatformsLoaded = true;
}

// v14.15.0 N5 同款防抖写入 + dirty 标记（写失败保留待重试；聚合 flush 纳管）
const writer = createDebouncedStore({
  name: '手动平台映射',
  debounceMs: NAME_INDEX_WRITE_DEBOUNCE,
  save: async () => {
    if (!manualPlatformsMemory || !manualPlatformsDirty) return;
    await dataStore.writeModule(DB_KEYS.MANUAL_PLATFORMS, Object.fromEntries(manualPlatformsMemory));
    manualPlatformsDirty = false; // 仅成功后清除（失败保留待重试）
  }
});
const scheduleWrite = writer.scheduleWrite;

/** 强制立即写入 / Force flush */
export const flushManualPlatforms = writer.flush;

/** 重置（备份恢复/导入/清除后调用）/ Reset */
export function resetManualPlatforms() {
  manualPlatformsMemory = new Map();
  manualPlatformsDirty = false;
  manualPlatformsLoaded = false;
  writer.reset();
}

// SW 启动预热（service-worker 分层预热接入）
export async function warmupManualPlatforms() {
  await loadManualPlatforms();
}

/**
 * 查询标题的手动平台映射（映射存在即返回——用户声明的终态）。
 * @param {string} gameName - 下载站页面标题（记录键）
 * @returns {Promise<ManualPlatformEntry|null>}
 */
export async function getManualPlatform(gameName) {
  const name = (gameName || '').trim();
  if (!name) return null;
  await loadManualPlatforms();
  return manualPlatformsMemory.get(name) || null;
}

/**
 * 保存手动平台映射（覆盖式 upsert；容量帽 LRU 淘汰最旧）。
 * @param {string} gameName
 * @param {{kind: 'console'|'emulator', tag: string, mcScore: number|null, mcName: string|null}} info
 * @returns {Promise<ManualPlatformEntry>}
 */
export async function setManualPlatform(gameName, info) {
  const name = (gameName || '').trim();
  if (!name) throw new Error('手动平台映射：gameName 必填');
  await loadManualPlatforms();
  // 容量帽：超出时淘汰最早声明的条目（手动声明低频，简单按 at 排序即可）
  if (manualPlatformsMemory.size >= STORAGE_CAPS.manualPlatforms && !manualPlatformsMemory.has(name)) {
    /** @type {string|null} */
    let oldestKey = null;
    let oldestAt = Infinity;
    for (const [k, v] of manualPlatformsMemory) {
      if (((v && v.at) || 0) < oldestAt) {
        oldestAt = (v && v.at) || 0;
        oldestKey = k;
      }
    }
    if (oldestKey) manualPlatformsMemory.delete(oldestKey);
  }
  /** @type {ManualPlatformEntry} */
  const entry = {
    kind: info.kind === 'emulator' ? 'emulator' : 'console',
    tag: String(info.tag || ''),
    mcScore: typeof info.mcScore === 'number' ? Math.max(0, Math.min(100, Math.round(info.mcScore))) : null,
    mcName: info.mcName ? String(info.mcName).slice(0, 200) : null,
    at: Date.now()
  };
  manualPlatformsMemory.set(name, entry);
  manualPlatformsDirty = true;
  scheduleWrite();
  Logger.info('Steam', `手动平台映射: "${name}" → ${entry.kind}/${entry.tag} (MC ${entry.mcScore ?? '—'})`);
  return entry;
}

// 供测试/管理页读取的内存引用 / In-memory reference (tests/management)
export function getManualPlatformsMemory() {
  return manualPlatformsMemory;
}
