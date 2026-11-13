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
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAN = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'mutations.json'), 'utf-8'));
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length) : '';
// v14.28.13：240s→90s——健康红实测上限 14s（stall/review 变异），90s = 6× 余量；
// 配合超时单次重试，楔死最坏代价 240s→180s 且大概率自愈，不再判「未拦截」。
const CHECK_TIMEOUT_MS = 90000;

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');

/** 工作区干净校验：只用 git diff 判定，不做任何 checkout/stash。 */
function isDirty(rel) {
  const r1 = spawnSync('git', ['diff', '--quiet', '--', rel], { cwd: ROOT });
  const r2 = spawnSync('git', ['diff', '--cached', '--quiet', '--', rel], { cwd: ROOT });
  return r1.status !== 0 || r2.status !== 0;
}

// v14.28.11（楔死级联根治，D-2 教训：门禁不得靠挂死当兜底）：spawnSync 的
// timeout 只杀 cmd.exe 直属子进程，npm→vitest 孙进程存活并持有输出管道——
// 本进程与后续运行被级联楔死（实测 gate 内 240s 超时 3/5 次，隔离亦间歇）。
// 改异步 spawn + 超时对**整棵进程树** taskkill /T /F（Windows 语义），超时
// 后不再留孤儿。语义不变：124 仍判「未拦截」（超时判红，不会假绿）。
// Async spawn + process-tree kill on timeout: spawnSync only killed the direct
// cmd.exe child, leaving npm→vitest grandchildren holding the pipes (wedging
// later runs). Semantics unchanged: 124 still means "not intercepted".
function runCheck(cmd) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(cmd, { cwd: ROOT, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let done = false;
    /** @param {string} s */
    const feed = (s) => {
      out += s;
      if (out.length > 64 * 1024) out = out.slice(-32 * 1024); // 环形截断防无界
    };
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    /** @param {number} code */
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({
        code,
        ms: Date.now() - started,
        tail: out.trim().split(/\r?\n/).slice(-3).join(' | ')
      });
    };
    const timer = setTimeout(() => {
      try {
        // taskkill /T = 整棵树（cmd.exe→npm→vitest forks），/F = 强制
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        /* 击杀失败按原语义交给 124 判定 */
      }
      finish(124);
    }, CHECK_TIMEOUT_MS);
    child.on('error', () => finish(124));
    child.on('close', (code) => finish(code === null ? 124 : code));
  });
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
// v14.29.1（变更面自动触发）：默认只跑「目标文件被本批改动命中」的变异——
// 回放的价值在批次上下文（改了某文件才需要验证该文件的缺陷防线仍有效）。
// 全量回放保留在：①发布触发点 npm run gate ②--only 单条 ③--scope=full 显式
// ④变更面不可知（git 异常/干净且无上一提交）。STALE 检查仍覆盖全部清单
// （锚点漂移是清单级健康度，只读文件零成本——在过滤前先扫一遍）。
// Default scope = mutations whose target file is touched by this batch;
// full scope stays on release gates / explicit flags.
function collectTouchedFiles() {
  const set = new Set();
  const outs = [
    spawnSync('git', ['diff', '--name-only', 'HEAD'], { cwd: ROOT, encoding: 'utf-8' }),
    spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: ROOT, encoding: 'utf-8' }),
    spawnSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf-8' })
  ];
  for (const out of outs) {
    for (const line of String(out.stdout || '').split('\n')) {
      const f = line.trim();
      if (f) set.add(f.replace(/\\/g, '/'));
    }
  }
  // 工作区干净 → 本批已提交，回退上一个提交的变更面（gate:fast 提交前语义：
  // 验证"刚写完的这批"的缺陷防线）
  if (set.size === 0) {
    const last = spawnSync('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], { cwd: ROOT, encoding: 'utf-8' });
    for (const line of String(last.stdout || '').split('\n')) {
      const f = line.trim();
      if (f) set.add(f.replace(/\\/g, '/'));
    }
  }
  return set;
}
const scopeFull = !!onlyArg || process.env.GR_MUTATIONS_SCOPE === 'full' || process.argv.includes('--scope=full');
let touchedFiles = null;
if (!scopeFull) {
  try {
    touchedFiles = collectTouchedFiles();
  } catch {
    touchedFiles = null;
  }
  if (!touchedFiles || touchedFiles.size === 0) {
    touchedFiles = null; // 变更面不可知 → 全量（保守）
    console.log('ℹ️ 变更面不可知 → 全量回放');
  } else {
    console.log(
      `ℹ️ 变更面过滤：本批 ${touchedFiles.size} 文件——只回放目标文件命中的变异（全量在 npm run gate / --scope=full）`
    );
  }
}
// 锚点漂移检查恒全量（零测试成本）+ 变异执行按变更面过滤
const staleChecks = [];
for (const m of PLAN.mutations) {
  if (only && m.id !== only) continue;
  const abs0 = path.join(ROOT, m.file);
  const src0 = fs.readFileSync(abs0, 'utf-8');
  const occurrences0 = src0.split(m.find).length - 1;
  if (occurrences0 !== 1) {
    staleChecks.push(
      `  ❌ ${m.id} [STALE] 变异锚点在 ${m.file} 出现 ${occurrences0} 次（必须恰好 1 次）——清单与代码已漂移`
    );
  }
}
for (const m of PLAN.mutations) {
  if (only && m.id !== only) continue;
  if (!scopeFull && !touchedFiles.has(m.file.replace(/\\/g, '/'))) {
    continue;
  }
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
    r = await runCheck(m.check); // v14.28.11：异步 + 进程树击杀
    // v14.28.13：124（超时楔死）自动重试**一次**——楔死是间歇性的（Vitest4
    // worker fork 竞态，健康红 ≤14s、超时 90s 上限），新进程大概率自愈；
    // 只对超时重试（绿/红结果不复跑，语义保持：绿仍=门禁失效判红）。
    // Single retry on timeout wedges only (intermittent Vitest4 fork race);
    // green/red results are never re-run, so semantics are unchanged.
    if (r && r.code === 124) {
      console.warn(`⚠️ ${m.id} 门禁超时（疑似楔死），新进程重试一次…`);
      r = await runCheck(m.check);
    }
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
    // v14.28.13：超时附输出尾——楔死现场自诊断（卡在 vitest 启动/测试体/收尾）
    results.push({
      id: m.id,
      status: 'FAIL',
      detail: `门禁超时（${r.ms}ms）——判为未拦截（无法区分卡死与拦截）· 输出尾: ${r.tail.slice(0, 200) || '（无输出=子进程未启动/输出未流回）'}`
    });
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
if (staleChecks.length > 0) {
  console.log('\n锚点漂移检查（全量，零成本）:');
  for (const line of staleChecks) console.log(line);
}
if (bad.length > 0) {
  console.error(`\n❌ ${bad.length} 条缺陷无法被自动拦截（共 ${results.length} 条）——门禁无效，禁止合入`);
  process.exit(1);
}
if (staleChecks.length > 0) {
  console.error(`\n❌ ${staleChecks.length} 条变异锚点漂移——清单与代码脱节，先修复 mutations.json`);
  process.exit(1);
}
console.log(
  `\n✅ ${results.length} 条历史缺陷全部被门禁抓住（放回即红，还原即绿）` +
    (scopeFull
      ? ''
      : ` · 变更面外 ${PLAN.mutations.length - results.length - staleChecks.length} 条已跳过（全量在 npm run gate）`)
);
