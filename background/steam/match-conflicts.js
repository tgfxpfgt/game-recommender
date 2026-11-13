/**
 * 游戏雷达 Game Radar - 匹配冲突防线 / Match Conflict Guards (v14.29.0)
 *
 * 逻辑不变式：**同站点两个不同页面在逻辑上至多一侧指向同一款游戏**——
 * 两页标题检索命中同一 appId 时至少一侧错配（用户实证：咸鱼单机
 * /107968.html 与 /107966.html 是两篇不同游戏帖，却被匹配到同一 appId）。
 * 两层检测：
 *   1. 持久层：URL 索引里同 host 另一页已绑定同一 appId（跨会话）
 *   2. 会话层：本 SW 生命周期内近期匹配已声明同一 (host, appId)（同一批
 *      列表页内/跨 tab 数分钟内——此时双方 URL 绑定尚未落盘，持久层看不见）
 * 命中冲突返回证据供调用方降级「推测」并拒写名称索引；同标题哈希豁免
 * （同站同标题两页 = 同一游戏的重发转载，命中同一 appId 是正确行为）。
 * Logical invariant: two different pages of one site cannot both point to the
 * same game — a shared appId means at least one side is mismatched. Two layers:
 * the persistent URL index (cross-session) and a session-scoped claim map
 * (same batch / nearby tabs, before either URL binding is persisted).
 */
import { findHostUrlConflict, hostOfUrl, normalizeUrl } from '../storage/url-index.js';
import { gameKeyOf } from '../storage/diag-trace.js';

// 会话声明窗口与容量（有界：Map 只在 SW 生命周期内存活，TTL 兜底清理）
const CLAIM_TTL_MS = 10 * 60 * 1000;
const CLAIM_MAX = 200;

/** @type {Map<string, {name: string, url: string, hash: string, at: number}>} host|appId → claim */
const claims = new Map();

/**
 * 声明一次匹配（并检测冲突）。pageUrl/appId 缺失或 host 不可解析 → 不参与
 * （返回 null，无冲突也不留声明）。
 * Record a match claim and detect conflicts; returns evidence when a conflict
 * is found, null otherwise (claims are recorded only when detectable).
 * @param {string} gameName 页面标题（哈希后参与同标题豁免判定）
 * @param {string} pageUrl 站点详情页 URL（列表项/详情页）
 * @param {string|number|null} appId 本次匹配到的 appId
 * @returns {Promise<{source: 'url-index'|'session', existingUrl: string}|null>}
 */
export async function claimOrDetectMatch(gameName, pageUrl, appId) {
  if (!pageUrl || appId === null || appId === undefined) return null;
  const key = normalizeUrl(pageUrl);
  const host = hostOfUrl(key);
  if (!key || !host) return null;
  const hash = gameKeyOf(gameName);
  const now = Date.now();
  // 1) 持久层：URL 索引同 host 另一页已绑定同一 appId
  const persisted = await findHostUrlConflict(key, appId, hash);
  if (persisted) return { source: 'url-index', existingUrl: persisted.url };
  // 2) 会话层：近期声明中同一 (host, appId) 被不同页、不同标题占用
  for (const [k, c] of claims) {
    if (now - c.at > CLAIM_TTL_MS) claims.delete(k);
  }
  for (const [k, c] of claims) {
    const sep = k.indexOf('|');
    const ch = k.slice(0, sep);
    const ca = k.slice(sep + 1);
    if (ch === host && ca === String(appId) && c.url !== key && c.hash !== hash) {
      return { source: 'session', existingUrl: c.url };
    }
  }
  // 3) 无冲突 → 记录声明（供同批后续页面检测；超容量淘汰最旧——插入序）
  claims.set(`${host}|${String(appId)}`, { name: String(gameName || ''), url: key, hash, at: now });
  if (claims.size > CLAIM_MAX) {
    const oldest = claims.keys().next().value;
    if (oldest !== undefined) claims.delete(oldest);
  }
  return null;
}

// 测试复位（模块级声明表）/ test reset for the module-level claim map
export function resetMatchConflictsForTest() {
  claims.clear();
}
