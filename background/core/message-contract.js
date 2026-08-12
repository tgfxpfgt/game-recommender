/**
 * Game Recommender - 消息契约校验 / Message Contract Validation
 *
 * v4.0.0：对高频/高风险 message action 的入参做必填字段与类型校验
 * （纯函数、零依赖，core 层可单测）。未契约化的 action 一律放行——
 * 契约化是渐进过程，首批覆盖 9 个高风险 action。
 * Validates required fields/types for high-risk message actions (pure, zero
 * dependency, core layer). Uncovered actions pass through — this is a gradual
 * rollout; the first batch covers 9 high-risk actions.
 */

const APP_ID_RE = /^\d{1,10}$/; // 1-10 位数字 appId
// 行为日志 type 白名单（与 content 侧发送方一致）
const TRACK_TYPES = new Set(['view_list', 'view_detail', 'click_detail', 'click_download', 'steam_tags_update']);
// 需要 gameName 的 type（view_list 仅计数，无需名称）
const NAME_REQUIRED_TYPES = new Set(['view_detail', 'click_detail', 'click_download', 'steam_tags_update']);

function isName(v) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= 200;
}
function isNonEmpty(v, max = 100) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max;
}
function isPlainObj(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
// 字符串数组（可空；元素 ≤maxLen）/ string array (may be empty; items ≤maxLen)
function isStrArray(v, maxLen = 200) {
  return Array.isArray(v) && v.every(x => typeof x === 'string' && x.length <= maxLen);
}
// 可选字符串（undefined/null 放行）/ optional string (undefined/null pass)
function optStr(v, maxLen) {
  return v === undefined || v === null || (typeof v === 'string' && v.length <= maxLen);
}
// 可选数字区间 / optional number in [min, max]
function optNumRange(v, min, max) {
  return v === undefined || v === null || (typeof v === 'number' && v >= min && v <= max);
}
function appIdRule(v, label) {
  return APP_ID_RE.test(String(v == null ? '' : v)) ? { ok: true } : { error: `${label} 必须是 1-10 位数字` };
}
function nameRule(label) {
  return (m) => isName(m && m.gameName) ? { ok: true } : { error: `${label} 必填且不超过 200 字符` };
}
function idRule(label) {
  return (m) => isNonEmpty(m && m.backupId, 100) ? { ok: true } : { error: `${label} 必填且不超过 100 字符` };
}
function limitRule(label, min, max) {
  return (m) => {
    const v = m && m.limit;
    if (v === undefined || v === null) return { ok: true };
    return (typeof v === 'number' && v >= min && v <= max)
      ? { ok: true } : { error: `${label} 必须是 ${min}-${max} 数字` };
  };
}
function moduleKeysRule(label) {
  return (m) => {
    const mk = m && m.moduleKeys;
    if (mk === undefined || mk === null) return { ok: true };
    return isStrArray(mk, 100) ? { ok: true } : { error: `${label}.moduleKeys 必须是字符串数组` };
  };
}
// 必填字符串数组（允许空）/ required string array (empty allowed)
function namesRule(label) {
  return (m) => isStrArray(m && m.names, 200)
    ? { ok: true } : { error: `${label}.names 必须是字符串数组（可空）` };
}

// action → 校验规则（返回 {ok:true} 或 {error}）/ rule table
const RULES = {
  // 最高频：内容脚本每页加载即发，此前零校验直接入库
  TRACK_EVENT: (m) => {
    const data = m && m.data;
    if (!isPlainObj(data)) return { error: 'TRACK_EVENT.data 必须是对象' };
    if (!TRACK_TYPES.has(data.type)) return { error: 'TRACK_EVENT.data.type 不在白名单' };
    if (NAME_REQUIRED_TYPES.has(data.type) && !isName(data.gameName)) {
      return { error: `TRACK_EVENT.data.gameName 必填（type=${data.type}）且不超过 200 字符` };
    }
    if (data.keywords !== undefined && !Array.isArray(data.keywords)) {
      return { error: 'TRACK_EVENT.data.keywords 必须是数组' };
    }
    return { ok: true };
  },
  SEARCH_STEAM: nameRule('SEARCH_STEAM.gameName'),
  REFRESH_STEAM_CACHE: nameRule('REFRESH_STEAM_CACHE.gameName'),
  GET_STEAM_BY_APPID: (m) => appIdRule(m && m.appId, 'GET_STEAM_BY_APPID.appId'),
  SAVE_MANUAL_MAPPING: (m) => {
    if (!isName(m && m.gameName)) return { error: 'SAVE_MANUAL_MAPPING.gameName 必填且不超过 200 字符' };
    return appIdRule(m && m.appId, 'SAVE_MANUAL_MAPPING.appId');
  },
  CLAIM_FREE_GAME: (m) => isNonEmpty(m && m.gameId, 100)
    ? { ok: true } : { error: 'CLAIM_FREE_GAME.gameId 必填且不超过 100 字符' },
  // 数据破坏性操作：backupId 必填（v4.1.0：moduleKeys 可选校验并入）
  RESTORE_BACKUP: (m) => {
    const id = idRule('RESTORE_BACKUP.backupId')(m); // 注意：idRule 返回规则函数，需立即调用
    if (!id.ok) return id;
    return moduleKeysRule('RESTORE_BACKUP')(m);
  },
  DELETE_BACKUP: idRule('DELETE_BACKUP.backupId'),
  // 设置透传：必须是纯对象（避免数组/null 入库）
  SAVE_SETTINGS: (m) => isPlainObj(m && m.settings)
    ? { ok: true } : { error: 'SAVE_SETTINGS.settings 必须是对象' },
  // ---- v4.1.0 第二批（读字段但此前零校验 + 有崩溃风险）----
  GET_RECOMMENDATIONS: (m) => {
    const games = m && m.games;
    if (!Array.isArray(games)) return { error: 'GET_RECOMMENDATIONS.games 必须是数组' };
    if (games.some(g => !g || typeof g.name !== 'string' || g.name.length < 1 || g.name.length > 200)) {
      return { error: 'GET_RECOMMENDATIONS.games[].name 必填字符串且不超过 200 字符' };
    }
    return { ok: true };
  },
  GET_STEAM_RATINGS: namesRule('GET_STEAM_RATINGS'),
  PREFETCH_STEAM_RATINGS: namesRule('PREFETCH_STEAM_RATINGS'),
  CLEAR_CACHE_FOR_PAGE: (m) => (Array.isArray(m && m.names) && Array.isArray(m && m.appIds))
    ? { ok: true } : { error: 'CLEAR_CACHE_FOR_PAGE.names/appIds 必须是数组（可空）' },
  GET_GAME_CACHE_LIST: (m) => (
    optStr(m && m.keyword, 100) && optStr(m && m.tag, 100) &&
    optStr(m && m.siteKey, 100) && optStr(m && m.typeFilter, 100) &&
    optNumRange(m && m.minRating, 0, 100)
  ) ? { ok: true } : { error: 'GET_GAME_CACHE_LIST 过滤字段类型不合法（keyword/tag/siteKey/typeFilter ≤100 字符串，minRating 0-100 数字）' },
  SEARCH_STEAM_CANDIDATES: nameRule('SEARCH_STEAM_CANDIDATES.gameName'),
  SEARCH_DOWNLOAD_SITES: nameRule('SEARCH_DOWNLOAD_SITES.gameName'),
  RECORD_DOWNLOAD_URLS_BATCH: (m) => {
    const data = m && m.data;
    if (!isPlainObj(data) || !Array.isArray(data.entries)) {
      return { error: 'RECORD_DOWNLOAD_URLS_BATCH.data.entries 必须是数组' };
    }
    if (data.entries.some(e => !e || !APP_ID_RE.test(String(e.appId == null ? '' : e.appId)) || typeof e.url !== 'string')) {
      return { error: 'RECORD_DOWNLOAD_URLS_BATCH.data.entries[].appId 数字且 url 必填' };
    }
    return { ok: true };
  },
  GET_DOWNLOAD_HISTORY: (m) => optStr(m && m.gameName, 200)
    ? { ok: true } : { error: 'GET_DOWNLOAD_HISTORY.gameName 可选字符串（≤200）' },
  GET_RUNTIME_LOGS: limitRule('GET_RUNTIME_LOGS.limit', 1, 500),
  GET_OUTBOUND_AUDIT: limitRule('GET_OUTBOUND_AUDIT.limit', 1, 500),
  HEAL_REGISTRY_NAMES: limitRule('HEAL_REGISTRY_NAMES.limit', 1, 50),
  GET_FREE_GAMES: (m) => {
    const f = m && m.force;
    return (f === undefined || typeof f === 'boolean') ? { ok: true } : { error: 'GET_FREE_GAMES.force 可选布尔' };
  },
  EXPORT_DATA: moduleKeysRule('EXPORT_DATA'),
  IMPORT_DATA: moduleKeysRule('IMPORT_DATA'),
  CREATE_BACKUP: moduleKeysRule('CREATE_BACKUP')
};

// 统一校验入口：未契约化 action 放行 / unified entry; uncovered actions pass
export function validateMessage(action, msg) {
  const rule = RULES[action];
  if (!rule) return { ok: true };
  const r = rule(msg);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
