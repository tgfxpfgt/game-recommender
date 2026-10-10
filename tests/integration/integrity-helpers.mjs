/**
 * 游戏雷达 Game Radar - 完整性测试共享工具 / Integrity Test Shared Helpers
 *
 * v14.3.0（第五轮 B9）：test-integrity.mjs 拆分配套——ROOT/BG/collectJs
 * 供主册（test-integrity.mjs）与安全分册（test-integrity-security.mjs）
 * 共享。非 vitest 套件（不匹配 test-*.mjs，include 自检不涉及）。
 */
('use strict');

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const BG = path.join(ROOT, 'background');

// 递归收集目录下全部 .js / collect all JS files under a dir
export function collectJs(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) collectJs(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}
