/**
 * 游戏雷达 Game Radar - 半自动发布脚本 / Release Script
 *
 * v7.0.7：消除手动发布 5 步的遗漏风险（版本不一致/门禁漏跑/顺序错），
 * **保留 Mimosa 深度扫描 seal 流程**（脚本输出扫描提示，seal 由人工补入
 * release notes）。流程：
 *   1. 校验工作区干净 + manifest/package 版本一致
 *   2. 门禁全验：npm run check（lint+typecheck+vitest）+ coverage:gate
 *   3. bump 版本（manifest + package；版本号取自参数或交互输入）
 *   4. 从 git log 生成 CHANGELOG 草稿（conventional 类型分组）
 *   5. 提交 + tag（vX.Y.Z）+ push（交互确认）
 *   6. gh release create --draft（notes 含 changelog 草稿 + seal 占位）
 *   7. 提示执行 Mimosa 深度扫描并补 seal
 *
 * 用法 / Usage: node scripts/release.mjs [版本号] [--skip-e2e] [--yes]
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const requestedVersion = args.find((a) => /^\d+\.\d+\.\d+$/.test(a)) || null;
const skipE2e = args.includes('--skip-e2e');
const yes = args.includes('--yes');

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}
function ask(question) {
  if (yes) return 'y';
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase());
    });
  });
}
function fail(msg) {
  console.error('❌ ' + msg);
  process.exit(1);
}

// ============ 1. 前置校验 ============
console.log('== 1. 前置校验 ==');
const dirty = run('git status --porcelain').trim();
if (dirty) fail('工作区有未提交改动，请先提交:\n' + dirty);
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf-8'));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
if (manifest.version !== pkg.version) {
  fail(`版本不一致: manifest=${manifest.version} package=${pkg.version}`);
}
const current = manifest.version;
console.log(`当前版本: v${current}`);

// ============ 2. 门禁全验 ============
console.log('== 2. 门禁全验 ==');
run('npm run check');
console.log('✅ lint + typecheck + vitest 通过');
run('npm run coverage:gate');
console.log('✅ 覆盖率门禁通过');
if (!skipE2e) {
  console.log('   （可选）完整 E2E 请本地执行: npm run e2e');
}

// ============ 3. 版本号 ============
const version = requestedVersion || (await ask(`输入新版本号（当前 v${current}，回车跳过 → 仅打包说明）: `)) || current;
const isBump = version !== current;
const tag = 'v' + version;

// ============ 4. CHANGELOG 草稿 ============
console.log('== 3. CHANGELOG 草稿 ==');
let changelog = '';
try {
  const base = run('git merge-base HEAD origin/main').trim() || 'HEAD~1';
  const log = run(`git log --oneline ${base}..HEAD`).trim();
  const types = {
    feat: '✨ 新功能',
    fix: '🐛 修复',
    perf: '⚡ 性能',
    refactor: '🔧 重构',
    docs: '📝 文档',
    chore: '🧹 维护',
    test: '✅ 测试',
    style: '🎨 样式',
    build: '📦 构建',
    ci: '🔁 CI'
  };
  const groups = {};
  for (const line of log.split('\n')) {
    const m = /^([a-z]+)(\([^)]*\))?:\s*(.+)$/.exec(line.trim());
    if (m && types[m[1]]) (groups[m[1]] = groups[m[1]] || []).push(m[3]);
  }
  for (const [t, label] of Object.entries(types)) {
    if (groups[t] && groups[t].length) changelog += `- **${label}**：${groups[t].join('；')}\n`;
  }
  if (!changelog) changelog = '- （无 conventional 提交记录，请人工补充）';
  console.log(changelog);
} catch {
  changelog = '- （无法生成，请人工补充）';
}

// ============ 5. bump + 提交 + tag + push ============
if (isBump) {
  console.log(`== 4. bump 到 v${version} ==`);
  manifest.version = version;
  pkg.version = version;
  fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(ROOT, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  run('git add manifest.json package.json');
  const summary = changelog.split('\n')[0].replace('- ', '').slice(0, 80);
  run(`git commit -m "chore: v${version} 发布准备"`);
  run(`git tag ${tag}`);
  const ok = await ask(`推送 v${version} 到远端并创建 Release 草稿？(y/N) `);
  if (ok === 'y') {
    run('git push origin main');
    run(`git push origin ${tag}`);
    const notes = `## v${version}\n\n${changelog}\n\n---\n🔒 Mimosa 深度扫描 seal 待补充（发布流程下一步执行）`;
    run(
      `gh release create ${tag} --title "游戏雷达 Game Radar v${version}" --notes "${notes.replace(/"/g, '\\"')}" --draft`
    );
    console.log(`✅ Release 草稿已创建: https://github.com/tgfxpfgt/game-recommender/releases/tag/${tag}`);
    console.log('\n⚠️ 下一步（人工）:');
    console.log('  1. 运行 Mimosa 深度安全扫描（focusFiles 覆盖本次改动）');
    console.log('  2. 将 seal 补入 release notes（gh release edit）');
    console.log('  3. 发布草稿');
  } else {
    console.log('⏸ 已跳过推送——本地 commit + tag 已完成，可手动 push/release');
  }
} else {
  console.log('⏸ 版本未变化，仅输出 changelog 草稿（供人工整理发布说明）');
}
