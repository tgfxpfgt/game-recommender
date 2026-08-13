// @ts-strict
/**
 * Game Recommender - 适配规则读取 / Adapter Rules
 *
 * 下载站适配规则与平台规则：用户导入的 storage.adapterRules 优先，
 * 否则使用内置 adapters/ 目录文件（通过副作用 import 挂到 globalThis）。
 * Download-site adapter rules: user-imported storage.adapterRules wins,
 * otherwise the built-in adapters/ files (side-effect imported globals).
 */
import { dataStore } from '../../data/data-store.js';
import { isPlainObject } from './utils.js';
import { DB_KEYS, DEFAULT_SETTINGS } from './constants.js';

let siteRulesCache = null;
/** @type {Array<{key: string, name: string, searchUrl: Function, base: string}>|null} */
let downloadSitesCache = null;

// 读取下载站适配规则 / Read download-site adapter rules
export async function getSiteRules() {
  if (siteRulesCache) return siteRulesCache;
  try {
    const imported = await dataStore.readModule(DB_KEYS.ADAPTER_RULES);
    siteRulesCache =
      imported && imported.version && Array.isArray(imported.sites) && imported.sites.length > 0
        ? imported
        : globalThis.__GAME_RECOMMENDER_SITES__ || { version: 1, sites: [] };
  } catch {
    siteRulesCache = globalThis.__GAME_RECOMMENDER_SITES__ || { version: 1, sites: [] };
  }
  return siteRulesCache;
}

// 下载站配置（含站内搜索的站点，从规则构建）/ Download-site config (searchable sites)
export async function getDownloadSites() {
  if (downloadSitesCache) return downloadSitesCache;
  /** @type {{sites: Array<{key: string, name: string, searchUrl: string, base: string}>}} */
  const rules = (await getSiteRules()) || { sites: [] };
  downloadSitesCache = (rules.sites || [])
    .filter((s) => s.searchUrl)
    .map((s) => ({
      key: s.key,
      name: s.name,
      searchUrl: (q) => s.searchUrl.replace('{q}', encodeURIComponent(q)),
      base: s.base
    }));
  return downloadSitesCache;
}

// 重置规则缓存（导入适配规则后调用）/ Reset rule caches (after importing rules)
export function resetRulesCache() {
  siteRulesCache = null;
  downloadSitesCache = null;
}

// ============ 规则编辑器支撑 / Rule Editor Support (v3.0.0) ============

// 站点规则允许的字段与类型白名单（纯数据，拒绝函数/未知类型，防注入）
// Allowed rule fields with type whitelist (pure data; functions rejected)
const SITE_FIELD_TYPES = {
  key: 'string',
  name: 'string',
  domains: 'array',
  base: 'string',
  searchUrl: 'string',
  detailUrlPatterns: 'array',
  imageAppId: 'boolean',
  listPage: 'object',
  listItem: 'object'
};

// 规则规模上限（防止异常输入导致内容脚本/后台资源滥用）
// Size limits to prevent abusive rule payloads
const RULE_LIMITS = {
  maxSites: 50, // 站点数上限 / max sites
  maxDomains: 10, // 每站域名上限 / max domains per site
  maxPatterns: 20, // 每站 URL 正则上限 / max regex patterns per site
  maxSelectors: 20, // 每站选择器上限 / max selectors per site
  maxFieldLen: 500, // 单个字符串字段长度上限 / max string-field length
  maxDepth: 6 // 嵌套深度上限 / max nesting depth
};

// 校验嵌套对象（listPage/listItem 等）：类型白名单 + 深度限制 + 数组条目检查
// Validate nested objects: type whitelist + depth limit + array-item checks
function validateNestedObject(siteKey, field, obj, depth) {
  if (depth > RULE_LIMITS.maxDepth) return `站点 "${siteKey}" 嵌套过深`;
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      if (v.length > RULE_LIMITS.maxPatterns) {
        return `站点 "${siteKey}" 字段 ${field}.${k} 条目超限`;
      }
      for (const item of v) {
        if (typeof item !== 'string' || item.length > RULE_LIMITS.maxFieldLen) {
          return `站点 "${siteKey}" 字段 ${field}.${k} 含非法条目`;
        }
      }
    } else if (isPlainObject(v)) {
      const err = validateNestedObject(siteKey, field, v, depth + 1);
      if (err) return err;
    } else if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
      return `站点 "${siteKey}" 字段 ${field}.${k} 类型错误`;
    }
  }
  return null;
}

// 校验一个站点的字段（必填项 + 类型白名单 + 嵌套递归 + 正则试编译）
// Validate a site's fields (required fields + type whitelist + nested
// recursion + regex compile check)
function validateSiteRule(site, depth) {
  if (!isPlainObject(site)) return '站点规则必须是对象 (site rule must be an object)';
  if (depth > RULE_LIMITS.maxDepth) return '规则嵌套过深 (nesting too deep)';
  if (!site.key || typeof site.key !== 'string' || !/^[a-z0-9_-]{1,32}$/i.test(site.key)) {
    return '站点缺少合法 key（小写字母/数字/-/_，≤32 字符）';
  }
  if (!site.name || typeof site.name !== 'string') return `站点 "${site.key}" 缺少 name`;
  if (!Array.isArray(site.domains) || site.domains.length === 0) {
    return `站点 "${site.key}" 缺少 domains 数组`;
  }
  if (site.domains.length > RULE_LIMITS.maxDomains)
    return `站点 "${site.key}" domains 超过 ${RULE_LIMITS.maxDomains} 个`;
  for (const d of site.domains) {
    if (typeof d !== 'string' || !d || d.length > RULE_LIMITS.maxFieldLen) {
      return `站点 "${site.key}" domains 含非法项`;
    }
  }
  // v3.4.1：正则字段试编译——非法正则会在内容脚本 new RegExp 时抛错
  // 拖垮整页适配器，导入前必须拦截
  // Regex fields are compile-checked so a bad pattern cannot throw in the
  // content script's new RegExp() and take down the whole page adapter
  const regexFields = [
    ...(Array.isArray(site.detailUrlPatterns) ? site.detailUrlPatterns : []),
    ...(isPlainObject(site.listPage) && Array.isArray(site.listPage.urlPatterns) ? site.listPage.urlPatterns : [])
  ];
  for (const p of regexFields) {
    if (typeof p !== 'string') return `站点 "${site.key}" 正则字段含非字符串项`;
    try {
      new RegExp(p, 'i');
    } catch {
      return `站点 "${site.key}" 含非法正则: ${String(p).substring(0, 60)}`;
    }
  }
  for (const [field, value] of Object.entries(site)) {
    const allowed = SITE_FIELD_TYPES[field];
    if (!allowed) continue; // 未知字段忽略（前向兼容）/ unknown fields ignored
    if (allowed === 'object') {
      if (!isPlainObject(value)) return `站点 "${site.key}" 字段 ${field} 类型错误（应为对象）`;
      const err = validateNestedObject(site.key, field, value, depth + 1);
      if (err) return err;
      continue;
    }
    const typeOk = allowed === 'array' ? Array.isArray(value) : typeof value === allowed;
    if (!typeOk) return `站点 "${site.key}" 字段 ${field} 类型错误（应为 ${allowed}）`;
    if (allowed === 'string' && String(value).length > RULE_LIMITS.maxFieldLen) {
      return `站点 "${site.key}" 字段 ${field} 超长`;
    }
    if (allowed === 'array') {
      if (value.length > RULE_LIMITS.maxPatterns) {
        return `站点 "${site.key}" 字段 ${field} 条目超限`;
      }
      for (const v of value) {
        if (typeof v !== 'string' || v.length > RULE_LIMITS.maxFieldLen) {
          return `站点 "${site.key}" 字段 ${field} 含非法条目`;
        }
      }
    }
  }
  return null;
}

// 校验适配规则整体结构（可单测纯函数）
// Validate the whole adapter-rules payload (pure, unit-testable)
export function validateAdapterRules(rules) {
  if (!isPlainObject(rules)) return { ok: false, error: '规则必须是 JSON 对象 (rules must be a JSON object)' };
  if (typeof rules.version !== 'number') return { ok: false, error: '缺少 version 字段（数字）' };
  if (!Array.isArray(rules.sites)) return { ok: false, error: '缺少 sites 数组' };
  if (rules.sites.length === 0) return { ok: false, error: 'sites 不能为空（至少保留一个站点规则）' };
  if (rules.sites.length > RULE_LIMITS.maxSites)
    return { ok: false, error: `sites 超过 ${RULE_LIMITS.maxSites} 个上限` };
  const seen = new Set();
  for (const site of rules.sites) {
    const err = validateSiteRule(site, 0);
    if (err) return { ok: false, error: err };
    if (seen.has(site.key)) return { ok: false, error: `站点 key 重复: ${site.key}` };
    seen.add(site.key);
  }
  return { ok: true, rules };
}

// 保存用户导入的适配规则（校验通过后写入 storage，覆盖内置规则）
// Save user-imported adapter rules (validated; overrides built-in rules)
export async function saveAdapterRules(rules) {
  const result = validateAdapterRules(rules);
  if (!result.ok) return result;
  await dataStore.writeModule(DB_KEYS.ADAPTER_RULES, result.rules);
  resetRulesCache();
  return { ok: true };
}

// 删除用户导入的规则，恢复使用内置规则
// Remove user-imported rules; fall back to the built-in rules
export async function deleteAdapterRules() {
  await dataStore.removeModule(DB_KEYS.ADAPTER_RULES);
  resetRulesCache();
  return { ok: true };
}

// 读取全部规则（编辑器渲染用）：内置 / 已导入 / 生效合并
// Read all rules for the editor: built-in / imported / effective merged
export async function getAllRules() {
  const builtin = globalThis.__GAME_RECOMMENDER_SITES__ || { version: 1, sites: [] };
  let imported = null;
  try {
    const stored = await dataStore.readModule(DB_KEYS.ADAPTER_RULES);
    if (stored && stored.version && Array.isArray(stored.sites)) imported = stored;
  } catch {
    /* 读取失败按无导入处理 */
  }
  const merged = imported || builtin;
  return { builtin, imported, merged };
}

// ============ 导入数据清洗 / Imported-Module Sanitization (v3.4.1) ============
// 导入（IMPORT_DATA）与备份恢复（restoreBackup）共用的模块级白名单校验：
// - settings：仅保留 DEFAULT_SETTINGS 已知字段，API 密钥一律清空，
//   llmConfig.endpoint 仅接受 http(s)（防 javascript: 等注入）
// - adapterRules：复用 validateAdapterRules 结构校验
// - 其余模块：强制 JSON 可序列化纯数据（剥离函数/循环引用）+ 规模上限
// 防止恶意/损坏文件写入畸形数据（超大数组拖垮存储、注入任意 settings 字段）。
// Shared validation for IMPORT_DATA and restoreBackup: whitelist + type + size
// limits (settings keys whitelisted, API keys blanked, endpoint http(s) only;
// adapterRules via validateAdapterRules; others must be pure JSON within caps).
export const IMPORT_MODULE_BYTES_LIMIT = 16 * 1024 * 1024; // 单模块 16MB
export const IMPORT_TOTAL_BYTES_LIMIT = 64 * 1024 * 1024; // 总量 64MB

function isPureJsonSafe(value) {
  if (value === null || value === undefined) return false;
  if (typeof value !== 'object') {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
  }
  try {
    const json = JSON.stringify(value);
    if (json === undefined || json.length > IMPORT_MODULE_BYTES_LIMIT) return false;
    JSON.parse(json);
    return true;
  } catch {
    return false;
  }
}

// settings 模块清洗：已知字段白名单 + 密钥清空 + endpoint 协议校验
// Settings sanitization: known-key whitelist, blanked secrets, http(s) endpoint
function sanitizeImportedSettings(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const [key, def] of Object.entries(DEFAULT_SETTINGS)) {
    const v = raw[key];
    if (v === undefined) continue;
    if (key === 'steamApiKey') {
      out[key] = '';
      continue;
    } // 密钥永不导入 / never import secrets
    if (key === 'llmConfig') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const llm = {};
      for (const [lk, ld] of Object.entries(def)) {
        const lv = v[lk];
        if (lv === undefined) continue;
        if (lk === 'apiKey') {
          llm.apiKey = '';
          continue;
        }
        if (lk === 'endpoint') {
          if (typeof lv === 'string' && /^https?:\/\//i.test(lv)) llm.endpoint = lv;
          continue;
        }
        if (typeof lv === typeof ld) llm[lk] = lv;
      }
      out[key] = llm;
      continue;
    }
    if (typeof v === typeof def) out[key] = v;
  }
  return out;
}

// 按模块 key 校验并清洗导入值；非法输入返回 null（调用方跳过该模块）
// Validate & sanitize one module's imported value; null = reject this module
export function sanitizeImportedModule(key, value) {
  if (key === 'settings') return sanitizeImportedSettings(value);
  if (key === 'adapterRules') {
    const result = validateAdapterRules(value);
    return result.ok ? result.rules : null;
  }
  if (!isPureJsonSafe(value)) return null;
  return value;
}
