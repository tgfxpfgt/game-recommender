/**
 * Game Recommender - 测试：依赖分层单向校验 / Layer Dependency Tests
 *
 * v3.4.1：静态扫描 background/ 全部 JS 的 import，断言单向分层约束
 * （core → storage → 业务层 → handlers → 入口），CI 中拦截分层回归。
 * 此前修复的真实违规：
 *   ① storage/name-index.js 曾依赖业务层 steam/title-parser.js（已下沉 core/）
 *   ② core/reset.js 曾依赖 6 个 storage 模块（已归位 storage/）
 * Statically scans every import under background/ and asserts the one-way
 * layering (core → storage → business → handlers → entry). Catches layer
 * regressions in CI. Two real violations were fixed by moving files.
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BG = path.join(ROOT, 'background');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name, '→ 实际:', JSON.stringify(actual), '期望:', JSON.stringify(expected)); }
}

// 目标模块 → 所属层 / target path (relative to background/) → layer
function layerOf(relPath) {
  const p = relPath.replace(/\\/g, '/');
  if (p.startsWith('../data/')) return 'data';
  if (p.startsWith('../lib/')) return 'lib';
  if (p.startsWith('../adapters/')) return 'adapters';
  if (p === 'service-worker.js') return 'entry';
  if (p === 'handlers.js') return 'handlers';
  const first = p.split('/')[0];
  if (first === 'core') return 'core';
  if (first === 'storage') return 'storage';
  if (first === 'steam' || first === 'recommend' || first === 'sites' || first === 'freegames') return 'biz';
  return 'other';
}

// 允许矩阵：源层 → 可依赖的目标层集合 / allowed targets per source layer
const ALLOWED = {
  core:      new Set(['core', 'data', 'lib']),
  storage:   new Set(['storage', 'core', 'data', 'lib']),
  biz:       new Set(['biz', 'storage', 'core', 'data', 'lib']),
  handlers:  new Set(['core', 'storage', 'biz', 'data', 'lib', 'adapters', 'handlers', 'entry']),
  entry:     new Set(['core', 'storage', 'biz', 'data', 'lib', 'adapters', 'handlers', 'entry']),
  // adapters 是内容脚本全局 IIFE，仅允许入口副作用导入（注册站点规则）
  adapters:  new Set(['entry'])
};

// 递归收集 background/ 下全部 .js / collect all background JS files
function collectJs(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) collectJs(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

console.log('1. 依赖分层单向校验（core→storage→业务→handlers→入口）');
const violations = [];
const importRe = /import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
for (const file of collectJs(BG, [])) {
  const rel = path.relative(BG, file);
  const src = fs.readFileSync(file, 'utf-8');
  const srcLayer = layerOf(rel);
  if (srcLayer === 'other') { violations.push(`${rel}: 未知层`); continue; }
  const allowed = ALLOWED[srcLayer];
  let m;
  while ((m = importRe.exec(src)) !== null) {
    const spec = m[1];
    if (!spec.startsWith('.') && !spec.startsWith('..')) continue; // 裸模块说明符跳过
    const target = path.normalize(path.join(path.dirname(rel), spec));
    const targetLayer = layerOf(target);
    if (!allowed.has(targetLayer)) {
      violations.push(`${rel} → ${target}（${targetLayer}，源层 ${srcLayer} 不允许）`);
    }
  }
}
for (const v of violations) console.log('  ⚠', v);
check('分层违规数（应为 0）', violations.length, 0);
// 关键层应存在（防目录改名导致扫描空转）
check('core/title-parser.js 存在（下沉后）', fs.existsSync(path.join(BG, 'core/title-parser.js')), true);
check('storage/reset.js 存在（归位后）', fs.existsSync(path.join(BG, 'storage/reset.js')), true);
check('旧 steam/title-parser.js 已移除', fs.existsSync(path.join(BG, 'steam/title-parser.js')), false);
check('旧 core/reset.js 已移除', fs.existsSync(path.join(BG, 'core/reset.js')), false);

export const testResult = { pass, fail, ok: fail === 0 };
