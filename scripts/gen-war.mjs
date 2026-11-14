/**
 * 游戏雷达 Game Radar - web_accessible_resources 派生 / Generate WAR
 *
 * v14.27.0（优化方案 P2-6）：manifest 的 web_accessible_resources 此前是三条
 * 目录通配（`content/*.js`、`lib/*.js`、`shared/*.js`）——向页面暴露的扩展
 * 资源面是"整个目录"，且新增/删除模块时与 module-manifest 必然漂移。
 * 现改为从单源派生：入口 = module-manifest 的 CORE/OPTIONAL 文件 + tracker 的
 * `getURL()` 动态装载字面量，递归静态 import 求闭包，只暴露真正会被页面上下文
 * 加载的文件；matches 取 content_scripts 的注入域名（同一事实源）。
 *
 * 用法 / Usage:
 *   node scripts/gen-war.mjs            # 打印派生结果与 manifest 的差异
 *   node scripts/gen-war.mjs --check    # 有差异退出 1（gate / CI）
 *   node scripts/gen-war.mjs --write    # 回写 manifest.json（只改 WAR 段）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { walk, trackerDynamicTargets } from './perf-budget.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'manifest.json');
// 允许出现在 WAR 的目录（被页面上下文以 chrome-extension:// 加载的 ESM）
const WAR_PREFIXES = ['content/', 'shared/', 'lib/'];

/** 派生 WAR 块 / compute the expected web_accessible_resources block */
async function computeWar() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'));
  const mod = await import(new URL('../content/module-manifest.js', import.meta.url).href);
  const modLoaders = await import(new URL('../content/module-loaders.js', import.meta.url).href);
  const entries = [
    ...mod.CORE_MODULES.map((m) => m.file),
    ...mod.OPTIONAL_MODULES.map((m) => m.file),
    // v15 绿地阶段 0：tracker 动态装载收敛到 module-loaders.js 桥后，getURL
    // 字面量不再覆盖直引文件（manifest/timeouts/page-url/loaders 本身）——
    // 桥的装载映射单源即派生补集。
    ...Object.keys(modLoaders.MODULE_LOADERS),
    ...trackerDynamicTargets()
  ];
  // 闭包内任何文件里的 getURL('…js') 动态装载目标都要并入（如 qr-unlock 的
  // lib/vendor/qrcode-reader.js）——迭代到不动点，最多 5 轮
  let files = [];
  let missing = [];
  for (let round = 0; round < 5; round++) {
    const res = walk([...new Set(entries)]);
    files = res.files;
    missing = res.missing;
    const extra = [];
    for (const f of files) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf-8');
      for (const m of src.matchAll(/getURL\(\s*'([^']+\.js)'/g)) {
        if (!entries.includes(m[1])) extra.push(m[1]);
      }
    }
    if (extra.length === 0) break;
    entries.push(...extra);
  }
  const resources = files.filter((f) => WAR_PREFIXES.some((p) => f.startsWith(p)));
  const matches = [];
  for (const entry of manifest.content_scripts || []) {
    for (const m of entry.matches || []) if (!matches.includes(m)) matches.push(m);
  }
  return { resources, matches, missing };
}

/** 与 manifest 现有 WAR 逐项比对，返回差异描述（空 = 一致） */
function diffWar(current, expected) {
  const cur = current && current[0] ? current[0] : { resources: [], matches: [] };
  const diffs = [];
  const cmp = (label, a, b) => {
    const onlyA = a.filter((x) => !b.includes(x));
    const onlyB = b.filter((x) => !a.includes(x));
    if (onlyA.length > 0) diffs.push(`${label} 多出: ${onlyA.join(', ')}`);
    if (onlyB.length > 0) diffs.push(`${label} 缺失: ${onlyB.join(', ')}`);
    if (onlyA.length === 0 && onlyB.length === 0 && a.join('|') !== b.join('|')) diffs.push(`${label} 顺序不一致`);
  };
  cmp('resources', cur.resources || [], expected.resources);
  cmp('matches', cur.matches || [], expected.matches);
  return diffs;
}

/** 只替换 manifest 末尾的 WAR 段（前面的格式与键序保持原样） */
function writeWar(expected) {
  const text = fs.readFileSync(MANIFEST, 'utf-8');
  const keyIdx = text.indexOf('"web_accessible_resources"');
  if (keyIdx < 0) throw new Error('manifest 缺少 web_accessible_resources');
  const head = text.slice(0, keyIdx).replace(/\s+$/, '\n');
  const block = JSON.stringify(
    { web_accessible_resources: [{ resources: expected.resources, matches: expected.matches }] },
    null,
    2
  );
  // 去掉 JSON.stringify 的外层大括号，整体再缩进一层（该键位于 manifest 顶层）
  const body = block
    .split('\n')
    .slice(1, -1)
    .map((l) => '  ' + l)
    .join('\n');
  fs.writeFileSync(MANIFEST, head + body + '\n}\n', 'utf-8');
}

const expected = await computeWar();
if (expected.missing.length > 0) {
  console.error('❌ 派生入口存在缺失文件:', expected.missing.join(', '));
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'));
const diffs = diffWar(manifest.web_accessible_resources, expected);

if (process.argv.includes('--write')) {
  writeWar(expected);
  console.log(`✅ 已回写 manifest WAR：${expected.resources.length} 个资源 / ${expected.matches.length} 个域名`);
} else if (process.argv.includes('--check')) {
  if (diffs.length > 0) {
    console.error('❌ web_accessible_resources 与 module-manifest 派生结果不一致：');
    for (const d of diffs) console.error('  - ' + d);
    console.error('  修复：node scripts/gen-war.mjs --write');
    process.exit(1);
  }
  console.log('✅ web_accessible_resources 与派生结果一致');
} else {
  console.log(`派生：${expected.resources.length} 个资源 / ${expected.matches.length} 个域名`);
  if (diffs.length === 0) console.log('与 manifest 一致');
  else for (const d of diffs) console.log('  - ' + d);
}
