/**
 * 游戏雷达 Game Radar - 统一质量门禁 / Unified Quality Gate
 *
 * v10.3.1（用户需求：精简流程、节省 token）：一条命令跑全部确定性门禁，
 * 替代手动多步（check → E2E → visual）。发布前必跑；日常开发可分子命令。
 *
 * 用法 / Usage:
 *   npm run gate            # 全量：check + E2E(MOCK) + visual
 *   npm run gate -- --fast  # 跳过 E2E（仅 check + visual）
 *   npm run gate -- --continue  # 失败不中止，跑完全部步骤后汇总（重负载机
 *                               # 一次看全貌；默认仍 fail-fast）
 *
 * 真实网络 E2E（npm run e2e，无 E2E_MOCK）为发布可选增强——受外网延迟
 * 影响偶发超时（已知环境敏感，见 CONTRIBUTING），不作为确定性门禁。
 */
import { spawnSync } from 'node:child_process';
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

step('check（lint + typecheck + vitest）', 'npm run check');
step('lint-ratchet（类型债棘轮）', 'node scripts/lint-ratchet.mjs');
step('coverage:gate（新增文件行覆盖）', 'npm run coverage:gate');
if (!fast) {
  step('E2E 冒烟（MOCK 离线）', 'npm run e2e', { E2E_MOCK: '1' });
}
step('visual（视觉回归）', 'npm run visual');
step('architecture（架构图自动更新）', 'node scripts/generate-architecture.mjs');
step('release-smoke（发布打包冒烟）', 'npm run package');

if (failedSteps.length > 0) {
  console.error(`\n❌ 门禁失败（--continue 汇总）: ${failedSteps.join('、')}`);
  process.exit(1);
}
console.log('\n✅ 全部门禁通过（gate passed）');
