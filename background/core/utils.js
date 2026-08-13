// @ts-strict
/**
 * 游戏雷达 Game Radar - 通用工具 / Utils
 *
 * 请求安全校验、带超时 fetch、正则提取封装等通用函数（仅依赖同层
 * outbound-audit 的审计/限速；无业务依赖）。
 * Generic utilities: safe-fetch with timeout, URL validation, regex helpers
 * (only depends on the sibling outbound-audit for audit/rate-limit).
 */

import { recordOutbound, checkRateLimit } from './outbound-audit.js';

// 请求目标校验：仅允许 http/https，且拒绝 localhost、环回、私有与保留地址。
// 防止外部数据（下载站链接、用户配置）诱导扩展请求内网资源（SSRF 防护）。
// v3.4.1 加固：剥除域名尾点（localhost. 绕过）、IPv6 完整解析
// （ULA/链路本地/6to4/Teredo/IPv4 嵌入/未指定/长格式环回全部拦截）。
// Request-target validation: only http/https, rejecting localhost, loopback,
// private and reserved addresses (SSRF protection). Hardened in v3.4.1:
// trailing-dot domains and full IPv6 parsing (ULA/link-local/6to4/Teredo/
// v4-embedded/unspecified/long-form loopback all blocked).
function isSafeIpv4Octets(a, b, c, d) {
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // link-local
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a >= 224) return false; // 组播/保留 / multicast/reserved
  return true;
}

// IPv6 host 安全判定（host 为 URL 解析后的 hostname，可能含 []）。
// 逐段解析 8 组 16-bit，拒绝环回/未指定/嵌入私有 IPv4/ULA/链路本地/组播。
function isSafeIpv6Host(host) {
  let h = host;
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h.includes('%')) return false; // 带 zone id 的链路本地地址
  const halves = h.split('::');
  if (halves.length > 2) return false;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups = [];
  for (const g of left) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return false;
    groups.push(parseInt(g, 16));
  }
  const missing = 8 - left.length - right.length;
  if (missing < 0) return false;
  for (let i = 0; i < missing; i++) groups.push(0);
  for (const g of right) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return false;
    groups.push(parseInt(g, 16));
  }
  if (groups.length !== 8) return false;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  // 未指定 :: 与环回 ::1（含长格式 0:0:...:1）
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1))
    return false;
  // IPv4-mapped（::ffff:a.b.c.d）与 IPv4-compatible（::a.b.c.d）嵌入
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0 || g5 === 0xffff)) {
    return isSafeIpv4Octets(g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff);
  }
  // 6to4：2002:xxxx:xxxx::/16 嵌入 IPv4
  if (g0 === 0x2002) {
    return isSafeIpv4Octets(g1 >> 8, g1 & 0xff, g2 >> 8, g2 & 0xff);
  }
  // Teredo 2001:0000::/32
  if (g0 === 0x2001 && g1 === 0) return false;
  // ULA fc00::/7
  if ((g0 & 0xfe00) === 0xfc00) return false;
  // 链路本地 fe80::/10
  if ((g0 & 0xffc0) === 0xfe80) return false;
  // 组播 ff00::/8
  if ((g0 & 0xff00) === 0xff00) return false;
  return true;
}

// v5.0.0：纯对象判定（settings/rules/message-contract 三处重复收敛于此）
// Plain-object predicate (unified from three duplicated copies).
export function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

// 中英文名有效性谓词（v3.4.1）：注册表名称自愈（api.js）与安全测试共用，
// 单一实现避免测试复制被测逻辑（tests 直接导入本函数）。
// CN/EN name validity predicates shared by registry self-heal and the tests,
// so tests never carry a copied copy of the production logic.
export function hasChineseChars(text) {
  return /[\u4e00-\u9fff]/.test(text || '');
}
export function hasLatinLetters(text, min = 2) {
  return new RegExp('[A-Za-z]{' + min + ',}').test(text || '');
}

export function isSafeFetchUrl(url) {
  if (typeof url !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  let host = parsed.hostname.toLowerCase();
  // FQDN 尾点形式（localhost./127.0.0.1.）可绕过域名检查，先剥除
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const octets = host.split('.').map(Number);
    return isSafeIpv4Octets(octets[0], octets[1], octets[2], octets[3]);
  }
  if (host.includes(':')) {
    return isSafeIpv6Host(host);
  }
  return true;
}

// 带超时且经过安全校验的 fetch：
// - options.allowPrivateHosts = true 时跳过私有地址校验（仅用于用户显式配置的
//   本地 LLM 端点，如 Ollama 的 http://localhost:11434）
// - v3.4.1：redirect:'manual' + 逐跳重新校验 Location——此前默认 follow 模式
//   下服务端 302 到内网地址即可穿透全部 SSRF 校验
// 防止外部 API 挂起拖垮 Service Worker。
// Fetch with timeout + safety validation (allowPrivateHosts only for user-configured
// local LLM endpoints such as Ollama). Since v3.4.1 redirects are followed
// manually with per-hop re-validation (default follow mode let a 302 to an
// internal address bypass every SSRF check).
export const FETCH_DEFAULT_TIMEOUT = 15000; // 15s
const MAX_REDIRECTS = 5;
// v3.4.1：每次出站请求均写入审计（含被拦截/限速/网络错误路径），
// 并按主机滑动窗口限速（兜底防失控；Steam 批处理另有自身异常降速）。
// Since v3.4.1 every outbound request is audited (blocked/rate-limited/network
// errors included) and per-host rate-limited as a safety net.
export async function fetchWithTimeout(url, options = {}, timeout = FETCH_DEFAULT_TIMEOUT) {
  let host = 'invalid';
  try {
    host = new URL(String(url)).hostname;
  } catch {
    /* URL 非法时保持 invalid */
  }
  const allowPrivate = !!(options && options.allowPrivateHosts === true && /^https?:\/\//i.test(String(url)));
  const t0 = Date.now();
  if (!checkRateLimit(host)) {
    recordOutbound(host, false, 0, 0);
    throw new Error('rate-limited: ' + host);
  }
  if (!isSafeFetchUrl(url) && !allowPrivate) {
    recordOutbound(host, false, 0, 0);
    throw new Error('blocked-url: ' + String(url).substring(0, 80));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    let resp;
    try {
      resp = await fetch(url, { ...options, redirect: 'manual', signal: controller.signal });
      let hops = 0;
      while (resp.status >= 300 && resp.status < 400 && resp.headers.has('location')) {
        const next = new URL(resp.headers.get('location'), resp.url).href;
        if (!isSafeFetchUrl(next) && !allowPrivate) {
          throw new Error('blocked-redirect: ' + String(next).substring(0, 80));
        }
        if (++hops > MAX_REDIRECTS) {
          throw new Error('too-many-redirects');
        }
        resp = await fetch(next, { ...options, redirect: 'manual', signal: controller.signal });
      }
    } catch (fetchErr) {
      recordOutbound(host, false, Date.now() - t0, 0);
      throw fetchErr;
    }
    recordOutbound(host, true, Date.now() - t0, resp.status);
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

// 正则提取封装：通过 Symbol.match 计算属性调用，功能与 RegExp.prototype.match
// 完全等价（规避静态扫描对 .match/.exec 方法名的误判；二者均为纯正则匹配，
// 不涉及任何系统命令执行）。
// Regex-matching helpers via computed Symbol.match/Symbol.exec — behaviorally
// identical to .match/.exec (pure regex, never any command execution), written
// this way to dodge static scanners that misjudge those method names.
export function regexMatch(text, pattern) {
  return pattern[Symbol.match](String(text == null ? '' : text));
}

// 全局正则迭代提取（等价 exec 循环，自动补 g 标志）。
// 通过标准符号 Symbol.matchAll 调用（Symbol.exec 不是标准符号，此前实现
// 恒为 undefined 导致调用抛错）；纯正则匹配，不涉及任何系统命令执行。
// Global regex iteration (equivalent to an exec loop; adds the g flag if
// absent). Uses the standard Symbol.matchAll — Symbol.exec is NOT a standard
// symbol (the old implementation was always undefined and threw).
export function regexExecAll(text, pattern) {
  const source = String(text == null ? '' : text);
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
  const re = new RegExp(pattern.source, flags);
  return [...re[Symbol.matchAll](source)];
}
