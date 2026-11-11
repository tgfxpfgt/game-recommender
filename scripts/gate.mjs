/**
 * 游戏雷达 Game Radar - 统一质量门禁 / Unified Quality Gate
 *
 * v10.3.1（用户需求：精简流程、节省 token）：一条命令跑全部确定性门禁，
 * 替代手动多步（check → E2E → visual）。发布前必跑；日常开发可分子命令。
 *
 * 用法 / Usage:
 *   npm run gate            # 全量：vitest 全量 + E2E(MOCK) + visual（发布触发点）
 *   npm run gate -- --fast  # 快速：受影响测试（scripts/test-changed.mjs 按变更面
 *                           # 选择，白名单单源触碰自动升级全量）——每批提交前
 *   npm run gate -- --continue  # 失败不中止，跑完全部步骤后汇总（重负载机
 *                               # 一次看全貌；默认仍 fail-fast）
 *
 * 真实网络 E2E（npm run e2e，无 E2E_MOCK）为发布可选增强——受外网延迟
 * 影响偶发超时（已知环境敏感，见 CONTRIBUTING），不作为确定性门禁。
 */
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateStep } from './check-suite-budget.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fast = process.argv.includes('--fast');
// v14.7 批次 2（C-P2）：--continue 汇总模式——失败记录并继续，结尾统一退出。
// 重负载机（FaceFusion 类争核）排查不必逐败重跑。
const continueOnFail = process.argv.includes('--continue');
/** @type {Array<{name: string, code: number, reason: string, ring: string[], firstError: string}>} */
const failedSteps = [];

// v14.29.1（L3 时长预算）：步骤名 → 套件 id（scripts/suite-budgets.json）。
// 未列出的步骤不设预算；vitest 步长度随变更面变化（受影响套件/全量），
// 由整条门禁的总预算（gateFast/gateFull）兜底——它是用户真实等待的时间。
const STEP_BUDGET_IDS = {
  'coverage:gate（新增文件行覆盖）': 'coverageGate',
  'E2E 冒烟（MOCK 离线）': 'e2eMock',
  'visual（视觉回归）': 'visual'
};
const TAIL_LINES = 25;
const RING_LINES = 200; // 环形保留：够算末 25 行 + 首个错误行，不无界吃内存
const GATE_STARTED_AT = Date.now();

// v14.29.1（L3 诊断信息）：失败一次给足线索——步骤名/退出码/末 N 行/首个错误行。
// 实时流式回显（信息量不减）+ 环形缓冲留存摘要，避免为拿线索重跑全量或翻日志。
// v14.29.1 修正：**不用 spawnSync 捕获**——coverage:gate 这类"脚本再 spawn vitest
// 且输出超过管道缓冲的步骤在 Windows 上会卡死（实测 13 分钟无输出、CPU 空转）；
// 改异步 spawn 流式读取，既无死锁又保留实时输出。
/** @param {string} name @param {number} code @param {string[]} ring @param {string} firstError */
function printDiagnostics(name, code, ring, firstError) {
  const tail = ring.slice(-TAIL_LINES).join('\n');
  console.error(`\n----- 失败诊断: ${name} -----`);
  console.error(`步骤: ${name}`);
  console.error(`退出码: ${code}`);
  console.error(`首个错误行: ${firstError || '（输出中未见 FAIL/AssertionError/Error: 行）'}`);
  console.error(`输出最后 ${Math.min(TAIL_LINES, ring.length)} 行:`);
  console.error(tail || '（无输出）');
  console.error(`----- 失败诊断结束: ${name} -----`);
}

/**
 * 异步跑命令：实时回显 stdout/stderr，同时环形留存最后若干行。
 * @param {string} cmd 命令串
 * @param {Record<string,string>} env 附加环境变量
 * @returns {Promise<{code: number, ring: string[], firstError: string}>}
 */
function runCaptured(cmd, env) {
  return new Promise((resolve) => {
    // Windows 下 npm.cmd 必须经 shell 调用；命令串由本脚本拼接（无用户输入，无注入面）
    const child = spawn(cmd, {
      cwd: ROOT,
      shell: true,
      stdio: ['inherit', 'pipe', 'pipe'],
      env: { ...process.env, ...env }
    });
    const ring = [];
    let carry = '';
    let firstError = '';
    /** @param {string} chunk */
    const feed = (chunk) => {
      carry += chunk;
      const lines = carry.split(/\r?\n/);
      carry = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        ring.push(line);
        if (ring.length > RING_LINES) ring.shift();
        if (!firstError && /FAIL|AssertionError|Error:/.test(line)) firstError = line.trim().slice(0, 400);
      }
    };
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (s) => {
      process.stdout.write(s);
      feed(s);
    });
    child.stderr.on('data', (s) => {
      process.stderr.write(s);
      feed(s);
    });
    child.on('error', (e) => {
      resolve({ code: 124, ring, firstError: firstError || String(e).slice(0, 400) });
    });
    child.on('close', (code) => {
      if (carry.trim()) feed('\n');
      resolve({ code: code === null ? 124 : code, ring, firstError });
    });
  });
}

/**
 * 跑一个门禁步骤：流式回显 → 失败/超预算判红。
 * @param {string} name 步骤名（同时是预算映射键）
 * @param {string} cmd 命令串
 * @param {Record<string,string>} [env] 附加环境变量
 */
async function step(name, cmd, env = {}) {
  if (failedSteps.length > 0 && !continueOnFail) {
    console.error(`\n❌ 门禁失败: ${failedSteps[0].name}——后续步骤未执行: ${name}`);
    process.exit(1);
  }
  console.log(`\n===== ${name} =====`);
  const started = Date.now();
  const r = await runCaptured(cmd, env);
  const ms = Date.now() - started;
  const reasons = [];
  if (r.code !== 0) reasons.push(`exit ${r.code}`);
  const budgetId = STEP_BUDGET_IDS[name];
  if (budgetId) {
    const b = evaluateStep(budgetId, ms);
    if (b.over) {
      reasons.push(`墙钟超预算：${ms} ms > ${b.capMs} ms，先排除环境负载再重跑`);
    } else {
      console.log(`⏱️ ${name} 墙钟 ${ms}ms${b.capMs ? ` / 预算 ${b.capMs}ms` : '（暂无预算）'}`);
    }
  } else {
    console.log(`⏱️ ${name} 墙钟 ${ms}ms`);
  }
  if (reasons.length > 0) {
    console.error(`\n❌ 步骤失败: ${name}（${reasons.join('；')}）`);
    printDiagnostics(name, r.code, r.ring, r.firstError);
    if (!continueOnFail) process.exit(r.code || 1);
    failedSteps.push({ name, code: r.code, reason: reasons.join('；'), ring: r.ring, firstError: r.firstError });
    return;
  }
  console.log(`✅ ${name} 通过`);
}

// v14.23.0（用户指令：最小必要收敛——测试规模与变更面成正比）：check 拆步，
// fast 模式 vitest 走受影响选择（test-changed.mjs），全量模式保持原 check 语义
// v14.25.0：gate 上下文 sim 信号超时钳回 20s（快速失败）——已知进程级翻转
// 在满载下 60s 也救不回（实证 360s×2 假红墙钟），单跑隔离车道保持 60s 容忍
// v14.26.0（优化方案 P0-1）：首步查"被静态 import 却未跟踪"——该类问题会让
// 干净克隆的扩展完全无法装载，且只有 git 状态能发现（lint/typecheck 全绿）。
await step('check:imports（未跟踪静态导入）', 'node scripts/check-untracked-imports.mjs');
// v14.26.0（优化方案 P1-5）：文档/脚本引用路径存在性——断链会让 AI 助手按
// AGENTS.md 读到空文件后回退探索式读码（本轮回审查实际发生过）
await step('check:refs（引用路径存在性）', 'node scripts/check-referenced-paths.mjs');
// v14.28.0（优化方案 S3 P2-17）：文档版本/索引门禁——根目录 md 数量、"当前版本"
// 表述与 manifest 一致、索引链接不腐烂（文档腐烂是 AI 读错上下文的首要来源）
await step('check:docs（文档版本/索引一致性）', 'node scripts/check-doc-version.mjs');
// v14.28.6 R4-C：模块索引漂移/豁免合规——索引腐烂比没有索引更危险；重生成
// 一条命令（node scripts/gen-module-index.mjs），漏登记豁免视为未实现。
await step('check:modules（模块索引/豁免登记）', 'node scripts/check-module-index.mjs');
// v14.28.6 R4-D：占位实现 + 契约→handler 缺口——"看着像做完了"的两类假完成。
await step('check:stubs（占位实现/契约缺口）', 'node scripts/check-stubs.mjs');
// v14.29.0（A 类根治）：外部引用锁——代码里的 GitHub raw/jsDelivr URL 必须登记，
// 且 URL 分支必须等于登记默认分支（appListIndex 写死 main → 404 五个月零运行）。
await step('check:ext-refs（外部引用锁）', 'node scripts/check-external-refs.mjs');
// v14.28.9（G 类）：首次运行证据——外部资源"登记了 URL"不等于"真的跑通过"，
// required:true 必须有真实 bytes/entries/evidence，且与 ext-refs 交叉校验。
await step('check:first-run（首次运行证据）', 'node scripts/check-first-run.mjs');
// v14.29.0（E 类根治）：匹配语料分母——回放样本必须有 ground truth，
// 禁止"缺 expectedName / recorded 全 0 命中 / 豁免不写原因"的真空通过。
await step('check:corpus（匹配语料分母）', 'node scripts/check-match-corpus.mjs');
await step('lint', 'npm run lint');
await step('typecheck', 'npm run typecheck');
const GATE_VITEST_ENV = { GR_SIM_SIGNAL_TIMEOUT_MS: '20000' };
if (fast) {
  await step('vitest（受影响套件，白名单单源触碰自动升级全量）', 'node scripts/test-changed.mjs', GATE_VITEST_ENV);
} else {
  await step('vitest（全量两阶段）', 'npm test', GATE_VITEST_ENV);
}
await step('lint-ratchet（类型债棘轮）', 'node scripts/lint-ratchet.mjs');
// v14.29.0（D/C/F 类根治）：缺陷回放验证——把 4 类历史缺陷放回去，对应门禁
// 必须变红；绿 = 门禁失效即红。跑在 vitest 之后（需要先确认基线本身是绿的），
// 耗时约 15s；变异只作用于工作副本并按字节还原（不碰 git 状态）。
await step('verify:mutations（缺陷回放：放回必须变红）', 'node scripts/mutation-check.mjs');
// v14.26.0（优化方案 P1-2 后半 + P2-12）：体积预算——SW 静态图/静态注入/内容
// 闭包三项按实测基线锁定，任何增长即红（真机冷启动断言在 E2E，fast 模式不做）。
await step('perf-budget（体积预算）', 'node scripts/perf-budget.mjs --assert');
// v14.27.0（优化方案 P2-6）：WAR 从 module-manifest 派生——手工往 manifest 加
// 资源（或新增内容模块忘了重生成）在此处打回，`npm run war:gen` 一键修复。
await step('gen-war（WAR 派生一致性）', 'node scripts/gen-war.mjs --check');
await step('coverage:gate（新增文件行覆盖）', 'npm run coverage:gate');
// v14.11 B10（报告 B P1-01）：全局覆盖率快照棘轮——coverage:gate 只查新增
// 文件（push 后 diff-filter=A 恒空 = 恒绿），存量改动无约束；快照补全局
if (!fast) {
  await step('coverage:snapshot（全局覆盖率棘轮）', 'npm run coverage:snapshot');
}
if (!fast) {
  await step('E2E 冒烟（MOCK 离线）', 'npm run e2e', { E2E_MOCK: '1' });
}
// v14.24.1（fast 模式）：visual 按变更面跳过——基线只渲染 4 个扩展页
//（popup/options/dashboard/freegames）+ 主题样式 + 版本号文本，纯后台/内容/
// 工具/测试批次零视觉影响。触发面外（background/content/data/tests/docs/
// scripts）→ skip；全量 gate 不跳（发布触发点整体验证）。
if (fast) {
  const VISUAL_TRIGGERS = [
    'popup/',
    'options/',
    'dashboard/',
    'freegames/',
    'styles/',
    'icons/',
    'shared/',
    'manifest.json'
  ];
  let files = [];
  try {
    const norm = (s) =>
      s
        .split('\n')
        .map((f) => f.trim().replace(/\\/g, '/'))
        .filter(Boolean);
    files = [
      ...norm(execSync('git diff --name-only HEAD', { cwd: ROOT, encoding: 'utf-8' })),
      ...norm(execSync('git ls-files --others --exclude-standard', { cwd: ROOT, encoding: 'utf-8' }))
    ];
    if (files.length === 0)
      files = norm(execSync('git diff --name-only HEAD~1 HEAD', { cwd: ROOT, encoding: 'utf-8' }));
  } catch {
    files = ['<unknown>']; // git 异常保守跑 visual
  }
  const touches = files.some((f) => VISUAL_TRIGGERS.some((t) => f === t || f.startsWith(t)));
  if (!touches) {
    console.log(
      `\n===== visual（视觉回归）=====\n⏭️ 跳过：变更 ${files.length} 文件均不在视觉触发面（扩展页/样式/主题/版本号）`
    );
  } else {
    await step('visual（视觉回归）', 'npm run visual');
  }
} else {
  await step('visual（视觉回归）', 'npm run visual');
}
if (process.argv.includes('--bench')) {
  // v14.7 批次 13：性能基准（可选步骤——性能批次的前后对比入口）
  await step('perf-bench（性能基准）', 'node scripts/perf-bench.mjs');
}
await step('architecture（架构图自动更新）', 'node scripts/generate-architecture.mjs');
await step('release-smoke（发布打包冒烟）', 'npm run package');

const totalMs = Date.now() - GATE_STARTED_AT;
const totalBudgetId = fast ? 'gateFast' : 'gateFull';
const totalBudget = evaluateStep(totalBudgetId, totalMs);
console.log(
  `\n⏱️ 整条门禁墙钟: ${totalMs}ms${totalBudget.capMs ? ` / 预算 ${totalBudget.capMs}ms（${totalBudgetId}）` : `（${totalBudgetId} 暂无预算）`}`
);

if (failedSteps.length > 0) {
  console.error(`\n❌ 门禁失败（--continue 汇总）: ${failedSteps.map((f) => `${f.name}（${f.reason}）`).join('、')}`);
  // --continue 结束时对每个失败步骤再打一遍末 25 行摘要（不必回翻滚动缓冲）
  for (const f of failedSteps) printDiagnostics(f.name, f.code, f.ring, f.firstError);
  process.exit(1);
}
if (totalBudget.over) {
  console.error(`\n❌ 墙钟超预算：${totalMs} ms > ${totalBudget.capMs} ms，先排除环境负载再重跑（${totalBudgetId}）`);
  process.exit(1);
}
console.log('\n✅ 全部门禁通过（gate passed）');
