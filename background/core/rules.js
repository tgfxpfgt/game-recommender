// @ts-strict
/**
 * 游戏雷达 Game Radar - 适配规则读取 / Adapter Rules
 *
 * 下载站适配规则与平台规则：用户导入的 storage.adapterRules 优先，
 * 否则使用内置 adapters/ 目录文件（通过副作用 import 挂到 globalThis）。
 * Download-site adapter rules: user-imported storage.adapterRules wins,
 * otherwise the built-in adapters/ files (side-effect imported globals).
 */
import { dataStore } from '../../data/data-store.js';
import { isPlainObject } from './utils.js';
import { DB_KEYS, DEFAULT_SETTINGS } from './constants.js';

/** @type {{version: number, sites: Array<any>}|null} */
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
  displayName: 'string', // v9.3.0：站点显示名（详情页下载资源面板等）
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

// v10.5.0 P0-C：合法裸主机名——导入/自定义站点规则的 domains 会被拼进
// chrome.scripting 的 `*://<d>/*` 匹配模式，若允许 "*" 或含协议/路径的值即
// 等价全站注入，必须限定为裸主机名标签（允许 localhost 单标签，也允许
// example.com 多标签；标签仅小写字母/数字/连字符、首尾非连字符、≤63 字符；
// 拒绝通配符/协议/路径/端口/空）。
// Bare-hostname validator: imported domains become chrome.scripting match
// patterns, so wildcards / scheme / path must be rejected (fleet-level guard).
export const SITE_DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
export function isValidSiteDomain(d) {
  return typeof d === 'string' && d.length > 0 && d.length <= RULE_LIMITS.maxFieldLen && SITE_DOMAIN_RE.test(d);
}

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
// v7.0.5：轻量 ReDoS 风险启发式——嵌套量词（(a+)+ 类灾难性回溯）与超长正则
// 拒绝；正常站点正则（/\/\d+\.html$/ 等）不受影响。纯函数，可单测。
// Lightweight ReDoS heuristic: nested quantifiers ((a+)+) and over-long regexes.
export function hasReDoSRisk(pattern) {
  const src = String(pattern || '');
  if (src.length > 200) return true;
  // 转义序列归一为占位符：\( \) \d 等不参与分组/量词判定（避免误报
  // \(a+\)+ 这类"字面括号+量词"为嵌套量词）
  // Escaped sequences normalized to placeholders: \( \) \d etc. must not
  // count as group delimiters/quantifiers in the heuristic below.
  const normalized = src.replace(/\\./g, '..');
  // 分组内含量词且分组后带量词：(a+)+ / (a*){2,} / ([0-9]+)* 等灾难性回溯
  if (/\([^()]*[*+][^()]*\)\s*[*+{]/.test(normalized)) return true;
  // 交替分组带量词：(a|b)+ / (x|y)*（引擎需枚举所有分支组合）
  if (/\([^()]*\|[^()]*\)\s*[*+]/.test(normalized)) return true;
  return false;
}

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
    if (!isValidSiteDomain(d)) {
      return `站点 "${site.key}" domains 含非法主机名（需为形如 example.com 的裸域名，禁止通配符/协议/路径/端口）`;
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
    // v7.0.5：ReDoS 风险正则拒绝（嵌套量词/超长——导入规则可被注入）
    if (hasReDoSRisk(p)) {
      return `站点 "${site.key}" 正则存在灾难性回溯风险（ReDoS）: ${String(p).substring(0, 60)}`;
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
// v10.0.0：导入前做格式化升级（normalizeImportedRules）+ 返回逐站诊断
export async function saveAdapterRules(rules) {
  const result = validateAdapterRules(rules);
  if (!result.ok) return result;
  const normalized = normalizeImportedRules(result.rules);
  await dataStore.writeModule(DB_KEYS.ADAPTER_RULES, normalized);
  resetRulesCache();
  return { ok: true, rules: normalized, diagnostics: diagnoseAdapterRules(normalized) };
}

// ============ 规则包生态 / Rule-Pack Ecosystem (v10.0.0) ============

// 规则格式版本（结构升级时递增；导入侧 normalizeImportedRules 自动升级）
// Rule format version (bump on structural changes; imports auto-upgrade)
export const RULES_FORMAT_VERSION = 2;

// 导入侧格式化升级（纯函数，可单测）：旧版规则包缺 v9.3.0 引入的
// displayName 字段时以 name 回填，并把 version 升到当前格式版本——
// 消除"规则包随版本演进必须手工改字段"的迁移负担
// Import-side format upgrade (pure): backfill displayName from name for
// pre-v9.3.0 packs and stamp the current format version.
export function normalizeImportedRules(rules) {
  if (!isPlainObject(rules) || !Array.isArray(rules.sites)) return rules;
  const sites = rules.sites.map((s) => {
    if (!isPlainObject(s)) return s;
    const out = { ...s };
    if (!out.displayName && out.name) out.displayName = out.name;
    return out;
  });
  return { ...rules, sites, version: RULES_FORMAT_VERSION };
}

// 逐站诊断（纯函数，可单测）：结构性合法但可能影响功能的配置问题，
// 供保存后提示与规则面板自检展示（level: warn/info）
// Per-site diagnostics (pure): structurally valid but function-affecting
// config issues, surfaced after save and in the rules panel self-check.
export function diagnoseAdapterRules(rules) {
  const diagnostics = [];
  const sites = rules && Array.isArray(rules.sites) ? rules.sites : [];
  for (const s of sites) {
    if (!isPlainObject(s) || !s.key) continue;
    if (!s.displayName) {
      diagnostics.push({ site: s.key, level: 'warn', message: '缺少 displayName，站点显示名将退化为 key' });
    }
    if (!s.searchUrl) {
      diagnostics.push({ site: s.key, level: 'info', message: '未配置 searchUrl，站内搜索与兜底重试不可用' });
    }
    if (!Array.isArray(s.detailUrlPatterns) || s.detailUrlPatterns.length === 0) {
      diagnostics.push({
        site: s.key,
        level: 'info',
        message: '未配置 detailUrlPatterns，回退通用路径特征（/game/ /down/ /soft/）'
      });
    }
    // 过宽正则 + 整页兜底组合：导航/分类链接会被误判为游戏详情页
    // (v10.0.0 内置站已收窄为"含数字"路径——旧规则包仍可能带此组合)
    if (
      s.listItem &&
      s.listItem.fallbackLinks === true &&
      Array.isArray(s.detailUrlPatterns) &&
      s.detailUrlPatterns.some((p) => p === '/[^/]+/?$')
    ) {
      diagnostics.push({
        site: s.key,
        level: 'warn',
        message: 'fallbackLinks 与过宽详情正则（任意一级路径）组合，导航/分类链接会被误判为详情页'
      });
    }
  }
  return diagnostics;
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
    // v6.4.19：ITAD 密钥配置不导入（多套配置含密钥）
    if (key === 'itadProfiles') {
      out[key] = [];
      continue;
    }
    if (key === 'llmConfig') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const llm = {};
      const defEntries = Object.entries(/** @type {Record<string, unknown>} */ (def));
      for (const [lk, ld] of defEntries) {
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
    // v10.0.0：备份/导入同样走格式化升级（displayName 回填 + version 戳记）
    return result.ok ? normalizeImportedRules(result.rules) : null;
  }
  if (!isPureJsonSafe(value)) return null;
  return value;
}
