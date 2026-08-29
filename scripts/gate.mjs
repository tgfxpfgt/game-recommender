/**
 * 游戏雷达 Game Radar - 统一质量门禁 / Unified Quality Gate
 *
 * v10.3.1（用户需求：精简流程、节省 token）：一条命令跑全部确定性门禁，
 * 替代手动多步（check → E2E → visual）。发布前必跑；日常开发可分子命令。
 *
 * 用法 / Usage:
 *   npm run gate            # 全量：check + E2E(MOCK) + visual
 *   npm run gate -- --fast  # 跳过 E2E（仅 check + visual）
 *
 * 真实网络 E2E（npm run e2e，无 E2E_MOCK）为发布可选增强——受外网延迟
 * 影响偶发超时（已知环境敏感，见 CONTRIBUTING），不作为确定性门禁。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fast = process.argv.includes('--fast');

function step(name, cmd, env = {}) {
  console.log(`\n===== ${name} =====`);
  // Windows 下 npm.cmd 必须经 shell 调用；命令串由本脚本拼接（无用户输入，无注入面）
  const r = spawnSync(cmd, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...env }
  });
  if (r.status !== 0) {
    console.error(`\n❌ 门禁失败: ${name}（exit ${r.status}）`);
    process.exit(r.status || 1);
  }
  console.log(`✅ ${name} 通过`);
}

step('check（lint + typecheck + vitest）', 'npm run check');
if (!fast) {
  step('E2E 冒烟（MOCK 离线）', 'npm run e2e', { E2E_MOCK: '1' });
}
step('visual（视觉回归）', 'npm run visual');

console.log('\n✅ 全部门禁通过（gate passed）');
