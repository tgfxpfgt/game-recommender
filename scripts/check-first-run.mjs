#!/usr/bin/env node
/**
 * 游戏雷达 Game Radar - 首次运行证据门禁 / First-Run Evidence Gate（G 类）
 *
 * v14.28.9（L4）：外部资源型功能"上线"不等于"跑通过"——历史上 appList dump
 * 写死错误分支导致 404 五个月零运行（check:ext-refs 已锁 URL，但没有验证
 * "真的下载成功过一次"）。本门禁要求登记项必须有一次真实成功调用记录
 * （bytes/entries/evidence），并与 external-refs.json 的 requiresFirstRun
 * 交叉校验：声明需要首次运行证据的引用必须在 first-run.json 出现。
 *
 * 数据来源：scripts/first-run.json（真实运行登记，不手写估算）。
 * 用法 / Usage: node scripts/check-first-run.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIRST_RUN = path.join(ROOT, 'scripts', 'first-run.json');
const EXT_REFS = path.join(ROOT, 'scripts', 'external-refs.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** @type {string[]} */
const errors = [];
let registry;
let extRefs;
try {
  registry = readJson(FIRST_RUN);
} catch (e) {
  console.error(`❌ 无法读取 scripts/first-run.json: ${e.message}`);
  process.exit(1);
}
try {
  extRefs = readJson(EXT_REFS);
} catch (e) {
  console.error(`❌ 无法读取 scripts/external-refs.json: ${e.message}`);
  process.exit(1);
}

const features = Array.isArray(registry.features) ? registry.features : [];
const byId = new Map();
for (const f of features) {
  if (!f || typeof f.id !== 'string' || !f.id.trim()) {
    errors.push('first-run.json 存在缺 id 的登记项');
    continue;
  }
  if (byId.has(f.id)) errors.push(`first-run.json id 重复: ${f.id}`);
  byId.set(f.id, f);
}

for (const f of features) {
  if (!f || f.required !== true) continue;
  const fr = f.firstRun;
  if (!fr || typeof fr !== 'object') {
    errors.push(`[${f.id}] required:true 但缺 firstRun（必须有真实成功调用记录）`);
    continue;
  }
  if (!(Number(fr.bytes) > 0)) errors.push(`[${f.id}] firstRun.bytes 必须 > 0（当前 ${fr.bytes}）`);
  if (!(Number(fr.entries) > 0)) errors.push(`[${f.id}] firstRun.entries 必须 > 0（当前 ${fr.entries}）`);
  if (!fr.at || !String(fr.at).trim()) errors.push(`[${f.id}] firstRun.at 为空`);
  if (!fr.evidence || !String(fr.evidence).trim()) {
    errors.push(`[${f.id}] firstRun.evidence 为空（必须写明真实调用证据）`);
  }
}

const refs = Array.isArray(extRefs.refs) ? extRefs.refs : [];
for (const ref of refs) {
  if (ref && ref.requiresFirstRun === true && !byId.has(ref.id)) {
    errors.push(`external-refs [${ref.id}] requiresFirstRun:true，但 first-run.json 未登记同名 id`);
  }
}

// 打印登记表（全绿时人眼复核） / Print the registry table
const rows = features.map((f) => ({
  id: f.id || '(缺 id)',
  feature: f.feature || '-',
  required: f.required === true ? 'yes' : 'no',
  at: (f.firstRun && f.firstRun.at) || '-',
  bytes: f.firstRun && f.firstRun.bytes !== undefined ? f.firstRun.bytes : '-',
  entries: f.firstRun && f.firstRun.entries !== undefined ? f.firstRun.entries : '-',
  evidence: (f.firstRun && f.firstRun.evidence) || '-'
}));
console.log('首次运行证据登记 / first-run evidence:');
const headers = ['id', 'feature', 'required', 'at', 'bytes', 'entries', 'evidence'];
const widths = headers.map((h) => Math.max(h.length, ...rows.map((r) => String(r[h]).length)));
const line = (vals) => vals.map((v, i) => String(v).padEnd(widths[i])).join('  ');
console.log(line(headers));
console.log(line(widths.map((w) => '-'.repeat(w))));
for (const r of rows) console.log(line(headers.map((h) => r[h])));

if (errors.length > 0) {
  console.error(`\n❌ check:first-run 失败（${errors.length} 项）：`);
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`\n✅ check:first-run 通过（${features.length} 条登记，required:true 均有真实首次运行证据）`);
