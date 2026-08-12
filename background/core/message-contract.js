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
function appIdRule(v, label) {
  return APP_ID_RE.test(String(v == null ? '' : v)) ? { ok: true } : { error: `${label} 必须是 1-10 位数字` };
}
function nameRule(label) {
  return (m) => isName(m && m.gameName) ? { ok: true } : { error: `${label} 必填且不超过 200 字符` };
}
function idRule(label) {
  return (m) => isNonEmpty(m && m.backupId, 100) ? { ok: true } : { error: `${label} 必填且不超过 100 字符` };
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
  // 数据破坏性操作：backupId 必填
  RESTORE_BACKUP: idRule('RESTORE_BACKUP.backupId'),
  DELETE_BACKUP: idRule('DELETE_BACKUP.backupId'),
  // 设置透传：必须是纯对象（避免数组/null 入库）
  SAVE_SETTINGS: (m) => isPlainObj(m && m.settings)
    ? { ok: true } : { error: 'SAVE_SETTINGS.settings 必须是对象' }
};

// 统一校验入口：未契约化 action 放行 / unified entry; uncovered actions pass
export function validateMessage(action, msg) {
  const rule = RULES[action];
  if (!rule) return { ok: true };
  const r = rule(msg);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
