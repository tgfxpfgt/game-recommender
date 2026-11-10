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
import { spawnSync, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fast = process.argv.includes('--fast');
// v14.7 批次 2（C-P2）：--continue 汇总模式——失败记录并继续，结尾统一退出。
// 重负载机（FaceFusion 类争核）排查不必逐败重跑。
const continueOnFail = process.argv.includes('--continue');
const failedSteps = [];

function step(name, cmd, env = {}) {
  if (failedSteps.length > 0 && !continueOnFail) {
    console.error(`\n❌ 门禁失败: ${failedSteps[0]}——后续步骤未执行: ${name}`);
    process.exit(1);
  }
  console.log(`\n===== ${name} =====`);
  // Windows 下 npm.cmd 必须经 shell 调用；命令串由本脚本拼接（无用户输入，无注入面）
  const r = spawnSync(cmd, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...env }
  });
  if (r.status !== 0) {
    console.error(`\n❌ 步骤失败: ${name}（exit ${r.status}）`);
    if (!continueOnFail) process.exit(r.status || 1);
    failedSteps.push(name);
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
step('check:imports（未跟踪静态导入）', 'node scripts/check-untracked-imports.mjs');
// v14.26.0（优化方案 P1-5）：文档/脚本引用路径存在性——断链会让 AI 助手按
// AGENTS.md 读到空文件后回退探索式读码（本轮回审查实际发生过）
step('check:refs（引用路径存在性）', 'node scripts/check-referenced-paths.mjs');
step('lint', 'npm run lint');
step('typecheck', 'npm run typecheck');
const GATE_VITEST_ENV = { GR_SIM_SIGNAL_TIMEOUT_MS: '20000' };
if (fast) {
  step('vitest（受影响套件，白名单单源触碰自动升级全量）', 'node scripts/test-changed.mjs', GATE_VITEST_ENV);
} else {
  step('vitest（全量两阶段）', 'npm test', GATE_VITEST_ENV);
}
step('lint-ratchet（类型债棘轮）', 'node scripts/lint-ratchet.mjs');
// v14.26.0（优化方案 P1-2 后半 + P2-12）：体积预算——SW 静态图/静态注入/内容
// 闭包三项按实测基线锁定，任何增长即红（真机冷启动断言在 E2E，fast 模式不做）。
step('perf-budget（体积预算）', 'node scripts/perf-budget.mjs --assert');
step('coverage:gate（新增文件行覆盖）', 'npm run coverage:gate');
// v14.11 B10（报告 B P1-01）：全局覆盖率快照棘轮——coverage:gate 只查新增
// 文件（push 后 diff-filter=A 恒空 = 恒绿），存量改动无约束；快照补全局
if (!fast) {
  step('coverage:snapshot（全局覆盖率棘轮）', 'npm run coverage:snapshot');
}
if (!fast) {
  step('E2E 冒烟（MOCK 离线）', 'npm run e2e', { E2E_MOCK: '1' });
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
    step('visual（视觉回归）', 'npm run visual');
  }
} else {
  step('visual（视觉回归）', 'npm run visual');
}
if (process.argv.includes('--bench')) {
  // v14.7 批次 13：性能基准（可选步骤——性能批次的前后对比入口）
  step('perf-bench（性能基准）', 'node scripts/perf-bench.mjs');
}
step('architecture（架构图自动更新）', 'node scripts/generate-architecture.mjs');
step('release-smoke（发布打包冒烟）', 'npm run package');

if (failedSteps.length > 0) {
  console.error(`\n❌ 门禁失败（--continue 汇总）: ${failedSteps.join('、')}`);
  process.exit(1);
}
console.log('\n✅ 全部门禁通过（gate passed）');
