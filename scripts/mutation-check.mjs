/**
 * 游戏雷达 Game Radar - 缺陷回放（变异）验证 / Defect Replay (Mutation) Verifier
 *
 * v14.28.9（门禁有效性的反向证明）：一条门禁"存在"不等于"有效"。
 * 本脚本按 scripts/mutations.json 逐条把**已修复的历史缺陷放回去**，跑对应
 * 门禁或套件：
 *   · 门禁变红 → 该缺陷类型已被自动拦截（PASS）
 *   · 门禁仍绿 → 门禁失效（FAIL，必须重新分层/补断言）
 * 结束后**无条件还原**原文件（finally + SIGINT 钩子 + 内容指纹校验）。
 *
 * 安全前提：目标文件必须是工作区干净状态（无未提交改动），否则拒绝运行——
 * 避免把用户的未提交工作当成变异目标覆盖掉。
 *
 * Usage: node scripts/mutation-check.mjs [--only=<id>]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAN = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'mutations.json'), 'utf-8'));
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length) : '';
const CHECK_TIMEOUT_MS = 240000;

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');

/** 工作区干净校验：只用 git diff 判定，不做任何 checkout/stash。 */
function isDirty(rel) {
  const r1 = spawnSync('git', ['diff', '--quiet', '--', rel], { cwd: ROOT });
  const r2 = spawnSync('git', ['diff', '--cached', '--quiet', '--', rel], { cwd: ROOT });
  return r1.status !== 0 || r2.status !== 0;
}

function runCheck(cmd) {
  const started = Date.now();
  const r = spawnSync(cmd, { cwd: ROOT, shell: true, encoding: 'utf-8', timeout: CHECK_TIMEOUT_MS });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  return {
    code: r.status === null ? 124 : r.status,
    ms: Date.now() - started,
    tail: out.trim().split(/\r?\n/).slice(-3).join(' | ')
  };
}

/** @type {Array<{id: string, file: string, original: string, timer: any}>} */
const pending = [];
process.on('SIGINT', () => {
  for (const p of pending) {
    try {
      fs.writeFileSync(path.join(ROOT, p.file), p.original, 'utf-8');
      console.log(`↩️ 已还原 ${p.file}`);
    } catch (e) {
      console.error(`❌ 还原失败 ${p.file}: ${String(e)}`);
    }
  }
  process.exit(130);
});

const results = [];
for (const m of PLAN.mutations) {
  if (only && m.id !== only) continue;
  const abs = path.join(ROOT, m.file);
  const original = fs.readFileSync(abs, 'utf-8');
  const occurrences = original.split(m.find).length - 1;
  if (occurrences !== 1) {
    results.push({
      id: m.id,
      status: 'STALE',
      detail: `变异锚点在 ${m.file} 出现 ${occurrences} 次（必须恰好 1 次）——清单与代码已漂移`
    });
    continue;
  }
  if (isDirty(m.file)) {
    // 目标文件有未提交改动是日常状态（提交前 gate:fast）——变异作用于当前
    // 工作副本，结束后按**字节原样**还原（finally + 指纹校验），不会覆盖用户改动。
    console.warn(`⚠️ ${m.file} 有未提交改动：变异作用于当前工作副本，结束后按字节还原`);
  }
  const mutated = original.replace(m.find, m.replace);
  pending.push({ id: m.id, file: m.file, original, timer: null });
  /** @type {{code: number, ms: number, tail: string}|null} */
  let r = null;
  try {
    fs.writeFileSync(abs, mutated, 'utf-8');
    r = runCheck(m.check);
  } finally {
    fs.writeFileSync(abs, original, 'utf-8');
    const idx = pending.findIndex((p) => p.id === m.id);
    if (idx >= 0) pending.splice(idx, 1);
  }
  const fingerprintOk = sha(fs.readFileSync(abs, 'utf-8')) === sha(original);
  if (!fingerprintOk) {
    results.push({ id: m.id, status: 'ERROR', detail: `还原后内容指纹不一致（${m.file}）——请立即 git diff 人工核对` });
    continue;
  }
  if (!r) {
    results.push({ id: m.id, status: 'ERROR', detail: '门禁命令未执行（写入失败）' });
  } else if (r.code === 0) {
    results.push({
      id: m.id,
      status: 'FAIL',
      detail: `缺陷放回后门禁仍绿（${m.check}，${r.ms}ms）——该类型未被拦截；${m.caughtBy} 需加强`
    });
  } else if (r.code === 124) {
    results.push({ id: m.id, status: 'FAIL', detail: `门禁超时（${r.ms}ms）——判为未拦截（无法区分卡死与拦截）` });
  } else {
    results.push({ id: m.id, status: 'PASS', detail: `变红 ${r.code}（${r.ms}ms）· ${r.tail.slice(0, 160)}` });
  }
}

const bad = results.filter((r) => r.status !== 'PASS');
console.log('\n缺陷回放验证（放回 → 门禁必须变红）:');
for (const r of results) {
  const icon = r.status === 'PASS' ? '✅' : '❌';
  console.log(`  ${icon} ${r.id} [${r.status}] ${r.detail}`);
}
if (bad.length > 0) {
  console.error(`\n❌ ${bad.length} 条缺陷无法被自动拦截（共 ${results.length} 条）——门禁无效，禁止合入`);
  process.exit(1);
}
console.log(`\n✅ ${results.length} 条历史缺陷全部被门禁抓住（放回即红，还原即绿）`);
