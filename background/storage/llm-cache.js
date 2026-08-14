/**
 * 游戏雷达 Game Radar - LLM 推荐评分缓存 / LLM Score Cache
 *
 * v6.4.3：LLM 推荐评分缓存（列表批量场景每游戏调用 LLM——慢且贵；
 * 评分变化慢，缓存 7 天）。内存 Map + 写穿持久化。
 * LLM recommendation score cache (7d TTL): batch list scans call the LLM per
 * game — slow and rate-limited; scores change slowly. In-memory + write-through.
 */
'use strict';

import { dataStore } from '../../data/data-store.js';
import { DB_KEYS } from '../core/constants.js';

const LLM_SCORE_TTL = 7 * 86400e3; // 7 天 / 7 days
const MAX_ENTRIES = 300;

/** @type {Map<string, {score: Object, ts: number}>} */
let llmCacheMemory = new Map();
let loaded = false;

async function load() {
  if (loaded) return;
  try {
    const stored = await dataStore.readModule(DB_KEYS.LLM_SCORE);
    if (stored && typeof stored === 'object') {
      llmCacheMemory = new Map(Object.entries(stored));
    }
  } catch {
    /* 损坏缓存忽略 */
  }
  loaded = true;
}

function keyOf(gameName) {
  return (gameName || '').toLowerCase().trim();
}

// 读取缓存（过期 → null + 惰性清理）/ Read cache (expired → null)
export async function getLlmScore(gameName) {
  await load();
  const key = keyOf(gameName);
  if (!key) return null;
  const entry = llmCacheMemory.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > LLM_SCORE_TTL) {
    llmCacheMemory.delete(key);
    return null;
  }
  return entry.score;
}

// 写入缓存 / Write cache
export async function setLlmScore(gameName, score) {
  await load();
  const key = keyOf(gameName);
  if (!key) return;
  llmCacheMemory.set(key, { score, ts: Date.now() });
  if (llmCacheMemory.size > MAX_ENTRIES) {
    const entries = [...llmCacheMemory.entries()].sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
    for (let i = 0; i < llmCacheMemory.size - MAX_ENTRIES; i++) {
      llmCacheMemory.delete(entries[i][0]);
    }
  }
  try {
    await dataStore.writeModule(DB_KEYS.LLM_SCORE, Object.fromEntries(llmCacheMemory));
  } catch {
    /* 写失败仅丢失缓存 */
  }
}

// 清空（导入/清除数据时调用）/ Clear (on import/data clear)
export function resetLlmCache() {
  llmCacheMemory = new Map();
  loaded = false;
}
