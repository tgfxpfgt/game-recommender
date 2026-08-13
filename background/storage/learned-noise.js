/**
 * Game Recommender - 动态噪声词学习 / Learned Noise Words
 *
 * v3.1.2：自适应检索的自动学习存储。每次"扩展组合搜索成功且跳过了某词"时
 * 为该词计数；同一词被足够多次（阈值 3）不同标题确认后成为"生效噪声词"，
 * 用于后续检索的变体清洗（防止把游戏副标题误学为噪声）。
 * Storage for adaptive-search learning: words skipped by a successful extended
 * search are counted; only words confirmed by enough distinct titles (≥3) turn
 * active and help clean future search variants (never mislearn subtitles).
 */
import { dataStore } from '../../data/data-store.js';
import { createDebouncedStore } from './debounced-store.js';
import { DB_KEYS } from '../core/constants.js';

// 同一词被确认多少次后生效 / times a word must be confirmed to become active
export const LEARN_THRESHOLD = 3;
// 词表上限（超出删除计数最低的词）/ max entries (lowest-count words evicted)
const MAX_WORDS = 200;
// 防抖写入 / debounced write
const WRITE_DEBOUNCE = 2000;

/** @type {Object<string, number>} */
let noiseMemory = {};
let loaded = false;

async function load() {
  if (loaded) return;
  try {
    const stored = await dataStore.readModule(DB_KEYS.LEARNED_NOISE);
    noiseMemory = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  } catch {
    noiseMemory = {};
  }
  loaded = true;
}

// v5.1.0：防抖写入收敛至 debounced-store 工厂
const writer = createDebouncedStore({
  name: '噪声词表',
  debounceMs: WRITE_DEBOUNCE,
  save: async () => {
    await dataStore.writeModule(DB_KEYS.LEARNED_NOISE, noiseMemory);
  }
});
const scheduleWrite = writer.scheduleWrite;
export const flushLearnedNoise = writer.flush;

// 当前生效的动态噪声词（计数达到阈值）/ active learned noise words
export async function getActiveNoiseWords() {
  await load();
  return Object.entries(noiseMemory)
    .filter(([, count]) => count >= LEARN_THRESHOLD)
    .map(([word]) => word);
}

// 记录候选噪声词（每次"成功删除"计数 +1）
// Record noise candidates (each confirmed skip increments the counter)
export async function recordNoiseCandidates(words) {
  await load();
  let changed = false;
  for (const w of words || []) {
    const key = String(w).toLowerCase().trim();
    if (!key || key.length < 2 || key.length > 12) continue;
    noiseMemory[key] = (noiseMemory[key] || 0) + 1;
    changed = true;
  }
  // 表上限：超出时移除计数最低的词 / evict the lowest-count words
  const entries = Object.entries(noiseMemory);
  if (entries.length > MAX_WORDS) {
    entries.sort((a, b) => a[1] - b[1]);
    for (const [word] of entries.slice(0, entries.length - MAX_WORDS)) {
      delete noiseMemory[word];
    }
  }
  if (changed) scheduleWrite();
}

// 重置（备份恢复/导入/清除后调用）/ Reset（v5.1.0：writer.reset 收敛）
export function resetLearnedNoise() {
  noiseMemory = {};
  loaded = false;
  writer.reset();
}
