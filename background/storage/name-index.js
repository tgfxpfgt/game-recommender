/**
 * Game Recommender - 名称索引 / Name Index
 *
 * 游戏名（小写）→ appId 反查索引（O(1)），带清理名键（跨站变体命中）、
 * 24h 级负缓存（appId=null，含过期清理）。内存 Map + 防抖批量写入。
 * Name → appId reverse index with canonical-name keys (cross-site variants),
 * negative cache (appId=null) with expiry cleanup.
 */
import { dataStore } from '../../data/data-store.js';
import { DB_KEYS, NAME_INDEX_WRITE_DEBOUNCE, nameNegativeCacheTtlMs } from '../core/constants.js';
import { cleanGameName } from '../steam/title-parser.js';

let nameIndexMemory = null;
let nameIndexMemoryLoaded = false;
let nameIndexWriteTimer = null;

// 加载名称索引到内存（顺手清理过期负缓存）
// Load the name index into memory (also purges expired negative entries)
async function loadNameIndexToMemory() {
  if (nameIndexMemoryLoaded) return;
  const stored = await dataStore.readModule(DB_KEYS.NAME_INDEX);
  nameIndexMemory = new Map(Object.entries(stored || {}));
  nameIndexMemoryLoaded = true;
  cleanupExpiredNegativeEntries();
}

// 查询游戏名对应的 appId（精确名 → 清理名回退，兼容跨站变体）
// Lookup appId by name (exact, then cleaned canonical-name fallback)
export async function lookupAppIdByName(gameName) {
  const name = (gameName || '').toLowerCase().trim();
  if (!name) return null;
  await loadNameIndexToMemory();
  let entry = nameIndexMemory.get(name);
  if (!entry) {
    const cleaned = cleanGameName(gameName).toLowerCase().trim();
    if (cleaned && cleaned !== name) {
      entry = nameIndexMemory.get(cleaned);
    }
  }
  if (!entry) return null;
  return entry.appId || null;
}

// 检查某游戏名是否在负缓存期内 / Is a name within the negative-cache window?
export async function isRecentlySearchedNotFound(gameName) {
  const name = (gameName || '').toLowerCase().trim();
  if (!name) return false;
  await loadNameIndexToMemory();
  const entry = nameIndexMemory.get(name);
  return !!entry &&
    (entry.appId === null || entry.appId === undefined) &&
    entry.lastSearched &&
    (Date.now() - entry.lastSearched < nameNegativeCacheTtlMs());
}

// 正缓存条目上限（v3.4.0：防无界增长——仅负缓存曾有清理，正缓存
// 名称→appId 映射永不删除会随浏览无限膨胀；超出后按 lastSearched LRU 裁剪）
// Positive-entry cap (v3.4.0: only negative entries were purged before; the
// unbounded positive map now gets LRU-trimmed by lastSearched when over the cap)
const NAME_INDEX_MAX_ENTRIES = 5000;

// 记录"游戏名→appId"映射（appId=null 表示"搜索过但未找到"）
// 正向映射同时记录清理名；负缓存不共享清理名（避免误伤其他站变体）。
// Record a name→appId mapping (appId=null = searched-not-found). Positive
// mappings also index the cleaned canonical name; negative ones don't share it.
export async function recordNameIndex(gameName, appId) {
  const name = (gameName || '').toLowerCase().trim();
  if (!name) return;
  await loadNameIndexToMemory();
  const timestamp = Date.now();
  nameIndexMemory.set(name, { appId: appId || null, lastSearched: timestamp });
  if (appId) {
    const cleaned = cleanGameName(gameName).toLowerCase().trim();
    if (cleaned && cleaned !== name) {
      nameIndexMemory.set(cleaned, { appId, lastSearched: timestamp });
    }
  }
  // v3.4.0：正缓存超限按 lastSearched LRU 裁剪（保留最近使用的条目）
  if (nameIndexMemory.size > NAME_INDEX_MAX_ENTRIES) {
    const entries = [...nameIndexMemory.entries()].sort((a, b) => (a[1].lastSearched || 0) - (b[1].lastSearched || 0));
    const toRemove = nameIndexMemory.size - NAME_INDEX_MAX_ENTRIES;
    for (let i = 0; i < toRemove; i++) nameIndexMemory.delete(entries[i][0]);
  }
  // 防抖写入 / Debounced write
  if (nameIndexWriteTimer) clearTimeout(nameIndexWriteTimer);
  nameIndexWriteTimer = setTimeout(async () => {
    nameIndexWriteTimer = null;
    try {
      await dataStore.writeModule(DB_KEYS.NAME_INDEX, Object.fromEntries(nameIndexMemory));
    } catch (e) {
      console.error('名称索引防抖写入失败:', e.message);
    }
  }, NAME_INDEX_WRITE_DEBOUNCE);
}

// 强制立即写入 / Force flush
export async function flushNameIndex() {
  if (nameIndexWriteTimer) { clearTimeout(nameIndexWriteTimer); nameIndexWriteTimer = null; }
  if (!nameIndexMemory) return;
  try {
    await dataStore.writeModule(DB_KEYS.NAME_INDEX, Object.fromEntries(nameIndexMemory));
  } catch (e) {
    console.error('名称索引写入失败:', e.message);
  }
}

// 清理过期的负缓存条目（内存中删除并防抖写回）
// Purge expired negative-cache entries from memory (debounced write-back)
function cleanupExpiredNegativeEntries() {
  if (!nameIndexMemory) return;
  const now = Date.now();
  let removed = 0;
  for (const [key, entry] of nameIndexMemory) {
    if ((entry.appId === null || entry.appId === undefined) &&
        entry.lastSearched && (now - entry.lastSearched >= nameNegativeCacheTtlMs())) {
      nameIndexMemory.delete(key);
      removed++;
    }
  }
  if (removed > 0) {
    if (nameIndexWriteTimer) clearTimeout(nameIndexWriteTimer);
    nameIndexWriteTimer = setTimeout(async () => {
      nameIndexWriteTimer = null;
      try {
        await dataStore.writeModule(DB_KEYS.NAME_INDEX, Object.fromEntries(nameIndexMemory));
      } catch (e) {
        console.error('名称索引清理写入失败:', e.message);
      }
    }, NAME_INDEX_WRITE_DEBOUNCE);
  }
}

// 按 appId 清理名称索引条目（缓存管理页删除用）/ Delete entries pointing to an appId
export async function deleteNameIndexEntries(appId, names) {
  if (!appId) return;
  await loadNameIndexToMemory();
  const key = String(appId);
  for (const name of (names || [])) {
    const entry = nameIndexMemory.get(name);
    if (entry && String(entry.appId) === key) {
      nameIndexMemory.delete(name);
    }
  }
}

// 删除指定名字的索引条目（强制刷新页用：正/负缓存条目都删——负缓存
// appId=null 无法用 deleteNameIndexEntries 匹配，而残留负缓存会拦截重取）。
// Delete one name's index entry (force-refresh: removes both positive and
// negative entries — the latter carry appId=null and can't be matched by
// deleteNameIndexEntries, yet would block re-fetching if left behind).
export async function deleteNameIndexEntry(name) {
  const key = (name || '').toLowerCase().trim();
  if (!key) return;
  await loadNameIndexToMemory();
  if (!nameIndexMemory.has(key)) return;
  nameIndexMemory.delete(key);
  if (nameIndexWriteTimer) clearTimeout(nameIndexWriteTimer);
  nameIndexWriteTimer = setTimeout(async () => {
    nameIndexWriteTimer = null;
    try {
      await dataStore.writeModule(DB_KEYS.NAME_INDEX, Object.fromEntries(nameIndexMemory));
    } catch (e) {
      console.error('名称索引删除写入失败:', e.message);
    }
  }, NAME_INDEX_WRITE_DEBOUNCE);
}

// 重置（备份恢复/导入/清除后调用）/ Reset
export function resetNameIndex() {
  nameIndexMemory = null;
  nameIndexMemoryLoaded = false;
  if (nameIndexWriteTimer) { clearTimeout(nameIndexWriteTimer); nameIndexWriteTimer = null; }
}
