// @ts-strict
import { isPlainObject } from './utils.js';
/**
 * 游戏雷达 Game Radar - 消息契约校验 / Message Contract Validation
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
const TRACK_TYPES = new Set([
  'view_list',
  'view_detail',
  'click_detail',
  'click_download',
  'steam_tags_update',
  'dislike_game'
]);
// 需要 gameName 的 type（view_list 仅计数，无需名称）
const NAME_REQUIRED_TYPES = new Set([
  'view_detail',
  'click_detail',
  'click_download',
  'steam_tags_update',
  'dislike_game'
]);

function isName(v) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= 200;
}
function isNonEmpty(v, max = 100) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max;
}
// 字符串数组（可空；元素 ≤maxLen）/ string array (may be empty; items ≤maxLen)
function isStrArray(v, maxLen = 200) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length <= maxLen);
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
  return (m) => (isName(m && m.gameName) ? { ok: true } : { error: `${label} 必填且不超过 200 字符` });
}
function idRule(label) {
  return (m) => (isNonEmpty(m && m.backupId, 100) ? { ok: true } : { error: `${label} 必填且不超过 100 字符` });
}
function limitRule(label, min, max) {
  return (m) => {
    const v = m && m.limit;
    if (v === undefined || v === null) return { ok: true };
    return typeof v === 'number' && v >= min && v <= max
      ? { ok: true }
      : { error: `${label} 必须是 ${min}-${max} 数字` };
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
  return (m) => (isStrArray(m && m.names, 200) ? { ok: true } : { error: `${label}.names 必须是字符串数组（可空）` });
}

// action → 校验规则（返回 {ok:true} 或 {error}）/ rule table
const RULES = {
  // 最高频：内容脚本每页加载即发，此前零校验直接入库
  TRACK_EVENT: (m) => {
    const data = m && m.data;
    if (!isPlainObject(data)) return { error: 'TRACK_EVENT.data 必须是对象' };
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
  CLAIM_FREE_GAME: (m) =>
    isNonEmpty(m && m.gameId, 100) ? { ok: true } : { error: 'CLAIM_FREE_GAME.gameId 必填且不超过 100 字符' },
  // 数据破坏性操作：backupId 必填（v4.1.0：moduleKeys 可选校验并入）
  RESTORE_BACKUP: (m) => {
    const id = idRule('RESTORE_BACKUP.backupId')(m); // 注意：idRule 返回规则函数，需立即调用
    if (!id.ok) return id;
    return moduleKeysRule('RESTORE_BACKUP')(m);
  },
  DELETE_BACKUP: idRule('DELETE_BACKUP.backupId'),
  // 设置透传：必须是纯对象（避免数组/null 入库）
  SAVE_SETTINGS: (m) => {
    const s = m && m.settings;
    if (!isPlainObject(s)) return { error: 'SAVE_SETTINGS.settings 必须是对象' };
    // v10.5.0 P2-B：weights 组每个值必须是有限数值（防字符串/NaN 权重产 NaN 分）
    // Every weights value must be a finite number (guards against NaN scores).
    if (s.weights !== undefined && s.weights !== null) {
      if (!isPlainObject(s.weights)) return { error: 'SAVE_SETTINGS.settings.weights 必须是对象' };
      for (const [k, v] of Object.entries(s.weights)) {
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          return { error: `SAVE_SETTINGS.settings.weights.${k} 必须是有限数值` };
        }
      }
    }
    return { ok: true };
  },
  // ---- v4.1.0 第二批（读字段但此前零校验 + 有崩溃风险）----
  GET_RECOMMENDATIONS: (m) => {
    const games = m && m.games;
    if (!Array.isArray(games)) return { error: 'GET_RECOMMENDATIONS.games 必须是数组' };
    if (games.some((g) => !g || typeof g.name !== 'string' || g.name.length < 1 || g.name.length > 200)) {
      return { error: 'GET_RECOMMENDATIONS.games[].name 必填字符串且不超过 200 字符' };
    }
    return { ok: true };
  },
  GET_STEAM_RATINGS: namesRule('GET_STEAM_RATINGS'),
  PREFETCH_STEAM_RATINGS: namesRule('PREFETCH_STEAM_RATINGS'),
  CLEAR_CACHE_FOR_PAGE: (m) =>
    Array.isArray(m && m.names) && Array.isArray(m && m.appIds)
      ? { ok: true }
      : { error: 'CLEAR_CACHE_FOR_PAGE.names/appIds 必须是数组（可空）' },
  GET_GAME_CACHE_LIST: (m) =>
    optStr(m && m.keyword, 100) &&
    optStr(m && m.tag, 100) &&
    optStr(m && m.siteKey, 100) &&
    optStr(m && m.typeFilter, 100) &&
    optNumRange(m && m.minRating, 0, 100)
      ? { ok: true }
      : {
          error:
            'GET_GAME_CACHE_LIST 过滤字段类型不合法（keyword/tag/siteKey/typeFilter ≤100 字符串，minRating 0-100 数字）'
        },
  SEARCH_STEAM_CANDIDATES: nameRule('SEARCH_STEAM_CANDIDATES.gameName'),
  SEARCH_DOWNLOAD_SITES: nameRule('SEARCH_DOWNLOAD_SITES.gameName'),
  RECORD_DOWNLOAD_URLS_BATCH: (m) => {
    const data = m && m.data;
    if (!isPlainObject(data) || !Array.isArray(data.entries)) {
      return { error: 'RECORD_DOWNLOAD_URLS_BATCH.data.entries 必须是数组' };
    }
    if (
      data.entries.some(
        (e) => !e || !APP_ID_RE.test(String(e.appId == null ? '' : e.appId)) || typeof e.url !== 'string'
      )
    ) {
      return { error: 'RECORD_DOWNLOAD_URLS_BATCH.data.entries[].appId 数字且 url 必填' };
    }
    return { ok: true };
  },
  GET_DOWNLOAD_HISTORY: (m) =>
    optStr(m && m.gameName, 200) ? { ok: true } : { error: 'GET_DOWNLOAD_HISTORY.gameName 可选字符串（≤200）' },
  GET_RUNTIME_LOGS: limitRule('GET_RUNTIME_LOGS.limit', 1, 500),
  GET_OUTBOUND_AUDIT: limitRule('GET_OUTBOUND_AUDIT.limit', 1, 500),
  HEAL_REGISTRY_NAMES: limitRule('HEAL_REGISTRY_NAMES.limit', 1, 50),
  GET_FREE_GAMES: (m) => {
    const f = m && m.force;
    return f === undefined || typeof f === 'boolean' ? { ok: true } : { error: 'GET_FREE_GAMES.force 可选布尔' };
  },
  EXPORT_DATA: moduleKeysRule('EXPORT_DATA'),
  IMPORT_DATA: moduleKeysRule('IMPORT_DATA'),
  CREATE_BACKUP: moduleKeysRule('CREATE_BACKUP'),
  // ---- v6.2.0 第三批：写/破坏性 action 全量入参校验 ----
  // 无参清理类：显式声明已契约（校验恒过，防止未来误判为未覆盖）
  RESET_SETTINGS: () => ({ ok: true }),
  CLEAR_DATA: () => ({ ok: true }),
  CLEAR_RUNTIME_LOGS: () => ({ ok: true }),
  CLEAR_OUTBOUND_AUDIT: () => ({ ok: true }),
  CLEAR_GAME_CACHE: () => ({ ok: true }),
  DELETE_ADAPTER_RULES: () => ({ ok: true }),
  CLEAN_EXPIRED_CACHE: () => ({ ok: true }),
  // v10.0.0：健康读类（无参）
  GET_SITE_HEALTH: () => ({ ok: true }),
  GET_STORAGE_HEALTH: () => ({ ok: true }),
  // 缓存条目级操作：appId 必填
  DELETE_GAME_CACHE_ENTRY: (m) => appIdRule(m && m.appId, 'DELETE_GAME_CACHE_ENTRY.appId'),
  REFRESH_GAME_CACHE_ENTRY: (m) => appIdRule(m && m.appId, 'REFRESH_GAME_CACHE_ENTRY.appId'),
  CACHE_STEAM_PAGE: (m) => {
    const a = appIdRule(m && m.appId, 'CACHE_STEAM_PAGE.appId');
    if (!a.ok) return a;
    return optStr(m && m.gameName, 200) ? { ok: true } : { error: 'CACHE_STEAM_PAGE.gameName 可选字符串（≤200）' };
  },
  TRACK_DOWNLOAD_SITE_VISIT: (m) => {
    const data = m && m.data;
    if (
      !isPlainObject(data) ||
      !APP_ID_RE.test(String(data.appId == null ? '' : data.appId)) ||
      typeof data.url !== 'string' ||
      !data.url
    ) {
      return { error: 'TRACK_DOWNLOAD_SITE_VISIT.data.appId 数字且 url 必填' };
    }
    return optStr(data.domain, 100)
      ? { ok: true }
      : { error: 'TRACK_DOWNLOAD_SITE_VISIT.data.domain 可选字符串（≤100）' };
  },
  SAVE_ADAPTER_RULES: (m) =>
    isPlainObject(m && m.rules) ? { ok: true } : { error: 'SAVE_ADAPTER_RULES.rules 必须是对象' },
  REPORT_WRONG_APPID: (m) => {
    const appIdOk = m.appId === undefined || m.appId === null || APP_ID_RE.test(String(m.appId));
    if (!appIdOk) return { error: 'REPORT_WRONG_APPID.appId 可选 1-10 位数字' };
    if (!optStr(m && m.gameName, 200)) return { error: 'REPORT_WRONG_APPID.gameName 可选字符串（≤200）' };
    if (m.appId == null && !m.gameName) return { error: 'REPORT_WRONG_APPID 至少提供 appId 或 gameName 之一' };
    return { ok: true };
  },
  // ---- v6.3.0 第四批：读类 action 全量收尾（契约化 100%）----
  // 无参读类：显式声明已契约
  GET_SETTINGS: () => ({ ok: true }),
  GET_STATS: () => ({ ok: true }),
  GET_STEAM_RECOMMENDATIONS: () => ({ ok: true }),
  GET_DATA_MODULES: () => ({ ok: true }),
  GET_BACKUPS: () => ({ ok: true }),
  GET_ADAPTER_RULES: () => ({ ok: true }),
  GET_API_STATUS: () => ({ ok: true }),
  EXPORT_LOGS: () => ({ ok: true }),
  // 趋势聚合：granularity 可选 day|week
  GET_TRENDS: (m) =>
    m.granularity === undefined || m.granularity === 'day' || m.granularity === 'week'
      ? { ok: true }
      : { error: 'GET_TRENDS.granularity 可选 day|week' },
  // v9.3.0：站点规则失效告警（限频在 handler 侧）
  SITE_ADAPTER_ALERT: (m) => {
    if (typeof m.siteKey !== 'string' || m.siteKey.length > 64) return { error: 'SITE_ADAPTER_ALERT.siteKey 非法' };
    if (typeof m.host !== 'string' || m.host.length > 255) return { error: 'SITE_ADAPTER_ALERT.host 非法' };
    return { ok: true };
  },
  // v10.5.0 P2-D：补齐两处遗漏，使默认拒绝安全
  LOG_PERF: (m) => {
    if (!optStr(m && m.source, 64)) return { error: 'LOG_PERF.source 可选字符串（≤64）' };
    if (!optStr(m && m.metric, 64)) return { error: 'LOG_PERF.metric 可选字符串（≤64）' };
    const d = m && m.durationMs;
    if (d !== undefined && d !== null && (typeof d !== 'number' || !Number.isFinite(d) || d < 0)) {
      return { error: 'LOG_PERF.durationMs 可选非负数值' };
    }
    return { ok: true };
  },
  OPEN_HUB: () => ({ ok: true })
};

// 统一校验入口：未契约化 action **默认拒绝**（v10.5.0 P2-D 收紧——此前未覆盖
// 一律放行是隐患面；新增 action 必须在 RULES 补规则，对齐 AGENTS.md 铁律 #7）
// Unified entry: uncontracted actions are now DENIED (fail-closed).
export function validateMessage(action, msg) {
  const rule = RULES[action];
  if (!rule) return { ok: false, error: `未契约化的 action（需在 message-contract.js RULES 登记）: ${action}` };
  const r = rule(msg);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/**
 * v10.5.0 P0-A：内容脚本可发 action 白名单 / content-script action allowlist.
 *
 * 非扩展页来源（内容脚本 http 源）仅允许发起以下读/埋点 action；其余特权
 * action（SAVE_SETTINGS / RESET_SETTINGS / CLEAR_DATA / IMPORT_DATA /
 * SAVE_ADAPTER_RULES / CREATE_BACKUP / RESTORE_BACKUP / OPEN_HUB …）必须来自
 * 扩展页或内部调用。与 content/ 侧 window.__GR_MSG__.sendMessage 的字面 action
 * 集保持一致——新增内容侧 action 时须同步加入本集合（否则该内容 action 被拒）。
 * Web-origin (content-script) senders may only invoke the read/telemetry actions
 * below; privileged actions require an extension-page or internal sender.
 */
export const CONTENT_ALLOWED_ACTIONS = new Set([
  'CACHE_STEAM_PAGE',
  'CLEAR_CACHE_FOR_PAGE',
  'GET_ADAPTER_RULES',
  'GET_DOWNLOAD_HISTORY',
  'GET_RECOMMENDATIONS',
  'GET_SETTINGS',
  'GET_STEAM_BY_APPID',
  'GET_STEAM_RATINGS',
  'LOG_PERF',
  'PREFETCH_STEAM_RATINGS',
  'RECORD_DOWNLOAD_URLS_BATCH',
  'REFRESH_STEAM_CACHE',
  'REPORT_WRONG_APPID',
  'SAVE_MANUAL_MAPPING',
  'SEARCH_DOWNLOAD_SITES',
  'SEARCH_STEAM',
  'SEARCH_STEAM_CANDIDATES',
  'SITE_ADAPTER_ALERT',
  'TRACK_DOWNLOAD_SITE_VISIT',
  'TRACK_EVENT'
]);

/**
 * sender 是否可信（扩展页 / 内部调用）/ whether the sender is trusted.
 * 纯函数，extOrigin 由调用方（handlers）注入，便于单测。规则：
 *  - 无 sender 或无 url：视为内部/CLI/测试直调 → 可信（内容脚本一定有 http url）；
 *  - url 以扩展自身 origin（chrome-extension://<id>/）开头 → 扩展页，可信；
 *  - 其余（如内容脚本注入页的 http(s) url）→ 不可信，仅可发白名单 action。
 * No url is treated as an internal/test caller; extension-origin urls are
 * trusted; any other origin (a content script's host page) is untrusted.
 */
export function isTrustedSender(sender, extOrigin) {
  const url = sender && sender.url;
  if (!url) return true;
  return typeof extOrigin === 'string' && extOrigin.length > 0 && url.startsWith(extOrigin);
}
