/**
 * 游戏雷达 Game Radar - 本地生成物清理 / Local artifacts cleaner
 *
 * v14.28.0（优化方案 S3 P3-3）：E2E/探针 profile、视觉 diff、coverage、运行时
 * 重写页、dist、打包 zip 等都是可重建产物，但长期堆积会占满磁盘（E2E profile
 * 单次上百 MB）。本脚本只删"可重建 + 已 gitignore"的目标，清单显式列在此处，
 * 不做通配扫描（防误删源码/入库 fixture）。
 *
 * 用法：npm run clean:artifacts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 可删除目标（仓库相对路径） / removable artifacts */
const TARGETS = [
  'tests/.e2e-profile',
  '.e2e-probe-profile',
  'tests/visual/diff',
  'tests/.timing.jsonl',
  'tests/fixtures/list-page.html',
  'coverage',
  'dist',
  'release'
];

let removed = 0;
for (const rel of TARGETS) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  fs.rmSync(abs, { recursive: true, force: true });
  console.log(`  已删除 ${rel}`);
  removed++;
}
console.log(removed > 0 ? `✅ 清理完成（${removed} 项）` : '✅ 无生成物需要清理');
