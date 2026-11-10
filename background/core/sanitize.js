/**
 * 游戏雷达 Game Radar - 设置密钥净化（v14.11 B3，报告 B/C P1-03）
 *
 * 导出/备份剔除 API 密钥的**单源**——此前 data-modules.js 与 backups.js 各写
 * 一份只剔 llmConfig.apiKey/steamApiKey 的副本，ITAD 密钥字段
 * （itadApiKey/itadProfiles[].key）从未被剔除，而设置页 UI 明文承诺
 * 「导出/备份/导入均会自动剔除」——虚假安全声明（v3.4.0 承诺对新字段失约）。
 * Strip secrets single source: both export and backup paths previously kept
 * ITAD credentials while the settings UI promised they were stripped.
 */

/**
 * 返回剔除密钥后的设置副本（不修改原对象）。保留 itadProfiles 的 name/id
 * 等非敏感字段，仅置空 key——用户导入后提示重输（与 llmConfig 同语义）。
 * @param {Object} settings - 原设置对象（原样返回当为空）
 * @returns {Object} 剔除密钥后的副本
 */
export function stripSecrets(settings) {
  const s = { ...(settings || {}) };
  if (s.llmConfig) s.llmConfig = { ...s.llmConfig, apiKey: '' };
  if (s.steamApiKey !== undefined) s.steamApiKey = '';
  // v14.11 B3：ITAD 密钥补剔（旧单键 + 多配置 profile 的 key；name/id 保留）
  if (s.itadApiKey !== undefined) s.itadApiKey = '';
  if (Array.isArray(s.itadProfiles)) {
    s.itadProfiles = s.itadProfiles.map((/** @type {Record<string, any>} */ p) =>
      p && typeof p === 'object' ? { ...p, key: '' } : p
    );
  }
  return s;
}

// ============ v14.26.0 P1-8：日志脱敏（URL 裁 query + 递归密钥剔除） ============
// 诊断包/运行日志曾把带密钥的 URL（如 ?key=xxx）原样落盘——导出即外带凭据。
// 规则（取舍 C-8）：URL 只保留 origin + pathname，query 仅保留 appid/id 白名单
//（保留排障定位所需），其余参数与 hash 丢弃；对象递归剔除密钥字段。
// Runtime logs previously persisted credential-bearing URLs verbatim. URLs keep
// origin + pathname only (plus appid/id whitelist); objects drop secret keys.
const KEEP_QUERY_KEYS = new Set(['appid', 'id']);
const SECRET_KEY_RE =
  /^(?:api_?key|apikey|key|token|access_?token|refresh_?token|secret|password|passwd|authorization|auth|cookie)$/i;
const URL_IN_TEXT_RE = /https?:\/\/[^\s"'<>()\\]+/g;
const MAX_DEPTH = 6;

/**
 * 把文本中的 URL 裁成 origin + pathname（保留 appid/id 查询参数）。
 * Trim every URL embedded in a string to origin + pathname (+ appid/id).
 * @param {string} text
 * @returns {string}
 */
export function sanitizeUrlText(text) {
  if (typeof text !== 'string' || text.indexOf('http') < 0) return text;
  return text.replace(URL_IN_TEXT_RE, (raw) => {
    try {
      const u = new URL(raw);
      let out = u.origin + u.pathname;
      /** @type {string[]} */
      const kept = [];
      u.searchParams.forEach((v, k) => {
        if (KEEP_QUERY_KEYS.has(k.toLowerCase())) kept.push(`${k}=${v}`);
      });
      if (kept.length > 0) out += '?' + kept.join('&');
      return out;
    } catch {
      return raw; // 畸形 URL 原样（无法判定，不冒险改写）
    }
  });
}

/**
 * 递归净化日志载荷：密钥字段置空 + 字符串中的 URL 裁 query。
 * Recursively sanitize a log payload: blank secret fields, trim URL queries.
 * @param {any} value
 * @param {number} [depth]
 * @returns {any}
 */
export function sanitizeLogData(value, depth = 0) {
  if (depth > MAX_DEPTH) return '…';
  if (typeof value === 'string') return sanitizeUrlText(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => sanitizeLogData(v, depth + 1));
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY_RE.test(k) ? '' : sanitizeLogData(v, depth + 1);
  }
  return out;
}
