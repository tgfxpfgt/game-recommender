/**
 * Game Recommender - 测试：出站审计与限速 / Outbound Audit & Rate Limit Tests
 *
 * v3.4.1：验证 outbound-audit 环形缓冲/统计/限速窗口，以及
 * fetchWithTimeout 的审计接入（成功/网络错误/被拦截/被限速四条路径）。
 * Verifies the audit ring buffer, stats, rate-limit window, and the four
 * fetchWithTimeout audit paths (ok / network error / blocked / rate-limited).
 */
'use strict';

import { fileURLToPath } from 'node:url';

// 注意：outbound-audit 必须不带查询参数导入——utils.js 内部以静态 import
// 引用它（无参数 URL），带 ?t= 会生成独立模块实例，审计状态互不可见。
// The audit module must be imported WITHOUT a cache-busting query — utils.js
// references it via a static (parameter-less) import; a ?t= URL would create a
// second module instance whose audit state the tests cannot see.
const mod = await import(new URL('../background/core/outbound-audit.js', import.meta.url).href);
const utils = await import(new URL('../background/core/utils.js', import.meta.url).href + '?t=' + Date.now());
const {
  AUDIT_MAX, RATE_WINDOW_MS, RATE_MAX,
  recordOutbound, getOutboundAudit, resetOutboundAudit, checkRateLimit
} = mod;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name, '→ 实际:', JSON.stringify(actual), '期望:', JSON.stringify(expected)); }
}

resetOutboundAudit();

console.log('1. 审计环形缓冲与统计');
recordOutbound('api.steampowered.com', true, 120, 200);
recordOutbound('store.steampowered.com', false, 0, 0);
recordOutbound('store.steampowered.com', true, 80, 200);
let r = getOutboundAudit();
check('entries 倒序（最新在前）', r.entries.map(e => e.host), ['store.steampowered.com', 'store.steampowered.com', 'api.steampowered.com']);
check('统计 total/failed', [r.stats.total, r.stats.failed], [3, 1]);
check('统计 failRate（33%）', r.stats.failRate, 33);
check('每主机聚合（按次数排序）', r.stats.hosts.map(h => h.host + ':' + h.count), ['store.steampowered.com:2', 'api.steampowered.com:1']);
check('主机失败计数', r.stats.hosts[0].failed, 1);
check('limit 截断（取最近 2 条）', getOutboundAudit(2).entries.length, 2);

console.log('2. 环形缓冲上限（超限裁剪最旧）');
resetOutboundAudit();
for (let i = 0; i < AUDIT_MAX + 20; i++) recordOutbound('host.example.com', true, 1, 200, 1000 + i);
check('缓冲不超上限', getOutboundAudit().stats.total, AUDIT_MAX);
const all = getOutboundAudit(AUDIT_MAX).entries; // 取全量（默认 limit=100）
check('最旧 20 条被裁剪（最早保留第 21 条 t=1020）', all[all.length - 1].t, 1020);
check('最新一条保留（t=1319）', all[0].t, 1319);

console.log('3. 每主机滑动窗口限速');
resetOutboundAudit();
const t0 = 1_000_000;
let allowed = 0;
for (let i = 0; i < RATE_MAX; i++) if (checkRateLimit('steam.example.com', t0 + i)) allowed++;
check('窗口内前 RATE_MAX 次放行', allowed, RATE_MAX);
check('第 RATE_MAX+1 次拒绝', checkRateLimit('steam.example.com', t0 + RATE_MAX), false);
check('窗口滑动后恢复（过期时间戳过滤）', checkRateLimit('steam.example.com', t0 + RATE_MAX + RATE_WINDOW_MS), true);
check('不同主机互不影响', checkRateLimit('other.example.com', t0), true);
check('reset 后限速计数清空', (resetOutboundAudit(), checkRateLimit('steam.example.com', t0)), true);
check('空 host 不限制', checkRateLimit('', t0), true);

console.log('4. fetchWithTimeout 审计接入（mock fetch）');
resetOutboundAudit();
const realFetch = globalThis.fetch;
const fakeResp = (status) => ({ status, headers: { has: () => false }, url: 'https://mock.example.com/x' });
globalThis.fetch = async () => fakeResp(200);
try {
  const resp = await utils.fetchWithTimeout('https://api.example.com/games', {}, 2000);
  check('成功请求返回 200', resp.status, 200);
  let a = getOutboundAudit().entries[0];
  check('成功路径审计（host/ok/status）', [a.host, a.ok, a.status], ['api.example.com', true, 200]);

  // 网络错误路径
  globalThis.fetch = async () => { throw new Error('network down'); };
  let threw = false;
  try { await utils.fetchWithTimeout('https://api.example.com/games', {}, 2000); } catch (e) { threw = /network down/.test(e.message); }
  check('网络错误上抛', threw, true);
  a = getOutboundAudit().entries[0];
  check('失败路径审计（ok=false）', [a.host, a.ok], ['api.example.com', false]);

  // 被拦截路径（SSRF 校验拒绝，无真实请求）
  threw = false;
  try { await utils.fetchWithTimeout('http://localhost:11434/api/generate', {}, 2000); } catch (e) { threw = /blocked-url/.test(e.message); }
  check('内网地址被拦截', threw, true);
  a = getOutboundAudit().entries[0];
  check('拦截路径审计（ok=false, host=localhost）', [a.host, a.ok], ['localhost', false]);

  // 限速路径（同一 host 连打 RATE_MAX 次后拒绝）
  resetOutboundAudit();
  globalThis.fetch = async () => fakeResp(200);
  for (let i = 0; i < RATE_MAX; i++) await utils.fetchWithTimeout('https://rate.example.com/games', {}, 2000);
  threw = false;
  try { await utils.fetchWithTimeout('https://rate.example.com/games', {}, 2000); } catch (e) { threw = /rate-limited/.test(e.message); }
  check('超限请求被拒绝', threw, true);
  a = getOutboundAudit().entries[0];
  check('限速路径审计（ok=false）', a.ok, false);
  // 其他主机不受限速影响
  const resp2 = await utils.fetchWithTimeout('https://other.example.com/games', {}, 2000);
  check('其他主机正常', resp2.status, 200);
} finally {
  globalThis.fetch = realFetch;
  resetOutboundAudit();
}

export const testResult = { pass, fail, ok: fail === 0 };
