import { test, expect } from 'vitest';
/**
 * 游戏雷达 Game Radar - 测试：项目完整性（安全扫描分册）/ Integrity: Security Scans
 *
 * v14.3.0（第五轮 B9）：由 test-integrity.mjs 拆分——XSS 插值棘轮扫描、
 * content ESM 链 WAR 覆盖、主题变量键集合一致性。结构/清单/契约检查在
 * test-integrity.mjs 主册；共享工具在 integrity-helpers.mjs。
 */
('use strict');

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, BG, collectJs } from './integrity-helpers.mjs';

// ============ 12. XSS 转义静态扫描（v14.2.0，主报告 P1-2——铁律 #1 机器护栏） ============
// 扫描生产 JS 中 innerHTML 模板串的 ${...} 插值：不含引号的纯数字/布尔/变量
// 运算视为低风险跳过；其余（字符串拼接数据）未经 esc/escapeHtml/escapeAttr
// 包裹的计为"未防护插值"。当前总数记入 scripts/lint-baseline.json
// v14.2.0 审查核心发现修复（第三次审查报告 §2）：原"无引号即跳过"豁免漏掉
// 最典型攻击形态——纯变量插值 `${data.desc}`、转义并列裸变量
// `${escapeHtml(a)} ${b}`（受控实验 0/3 检出）。改**白名单制**：默认可疑、
// 明确放行——①转义函数须完整包裹（...$）②受控方法白名单（内部生成且格式
// 确定的数值/日期格式化输出）。检出数由 19 跳升属预期，新数字落基线逐批清。
const XSS_SCAN_DIRS = [
  'content',
  'options',
  'dashboard',
  'popup',
  'sidepanel',
  'welcome',
  'hub',
  'freegames',
  'shared'
];
const SAFE_INTERP_RE = /^\s*(?:[\w.]*\.)?(?:esc|escA|esc2|escapeHtml|escapeAttr)\s*\([\s\S]*\)$/;
const CONTROLLED_RE =
  /^\s*(?:[\w.]+\.)?(?:toFixed|toLocaleDateString|toLocaleString|formatRelativeTime|formatElapsed|formatDate|Math\.(?:round|floor|ceil|min|max|abs))\s*\([\s\S]*\)$/;
function scanXssInterpolations(file) {
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/innerHTML\s*(?:\+=|=)/.test(lines[i])) continue;
    let tpl = lines[i];
    let j = i;
    while (j + 1 < lines.length && (tpl.match(/`/g) || []).length % 2 === 1) {
      j += 1;
      tpl += '\n' + lines[j];
    }
    i = j; // 模板整体消费
    for (const m of tpl.matchAll(/\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
      const expr = m[1];
      if (SAFE_INTERP_RE.test(expr)) continue; // 转义函数完整包裹（默认放行的唯一通道）
      if (CONTROLLED_RE.test(expr)) continue; // 受控方法（数值/日期格式化，格式确定）
      out.push({
        file: path.relative(ROOT, file).replace(/\\/g, '/'),
        line: i + 1,
        expr: expr.replace(/\s+/g, ' ').slice(0, 90)
      });
    }
  }
  return out;
}
const xssFindings = XSS_SCAN_DIRS.flatMap((d) => collectJs(path.join(ROOT, d), [])).flatMap((f) =>
  scanXssInterpolations(f)
);
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf-8'));
const lintBaseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/lint-baseline.json'), 'utf-8'));
const xssBaseline = Number(lintBaseline.xssUnescapedInterpolations || 0);
// ============ 13. 内容 ESM import 链的 WAR 覆盖（v14.2.0） ============
// content 模块经 chrome.runtime.getURL 动态 import，其静态 import 的 shared
// 模块必须命中 web_accessible_resources 通配——此前 spy-scales/fm-keys 下沉
// shared 后不在 WAR，真机动态 import 全链失败而单测全绿（环境差异型盲区）。
test('content 静态 import 的 shared 模块均在 WAR 覆盖内', () => {
  const warRes = (manifest.web_accessible_resources || []).flatMap((w) => w.resources || []);
  const sharedImports = new Set();
  for (const f of collectJs(path.join(ROOT, 'content'), [])) {
    const src = fs.readFileSync(f, 'utf-8');
    for (const m of src.matchAll(/from\s+'[^']*\/\/shared\/([a-z0-9-]+\.js)'/g)) {
      sharedImports.add('shared/' + m[1]);
    }
  }
  const hit = (res) => warRes.some((w) => w.endsWith('*') && res.startsWith(w.slice(0, -1)));
  const uncovered = [...sharedImports].filter((r) => !warRes.includes(r) && !hit(r));
  expect(uncovered, 'WAR 未覆盖的内容侧共享依赖:\n  ' + uncovered.join('\n  ')).toEqual([]);
});

// ============ 14. 主题变量键集合一致（v14.3.0 B10） ============
// 19 套主题必须定义同一套 --gr-* 变量——新主题漏键会让该主题下消费方回退
// 默认值（SidePanel 主题失效的近因防御）。
test('主题变量键集合一致（19 套 --gr-* 全等）', () => {
  const css = fs.readFileSync(path.join(ROOT, 'styles/themes.css'), 'utf-8');
  const blocks = [...css.matchAll(/body\[data-theme='([^']+)'\]\s*\{([^}]*)\}/g)];
  expect(blocks.length).toBeGreaterThanOrEqual(19);
  const keySets = blocks.map(([, body]) => {
    const keys = [...body.matchAll(/(--gr-[a-z-]+)\s*:/g)].map((m) => m[1]).sort();
    return keys.join(',');
  });
  const first = keySets[0];
  // 逐块比对键集合（变量名集合全等，值可不同）
  const bad = [];
  for (let i = 1; i < keySets.length; i++) {
    if (keySets[i] !== first) bad.push(blocks[i] && blocks[i][1]);
  }
  expect(bad, `主题变量键漂移: ${bad.length} 块与首块不一致`).toEqual([]);
});

test('XSS 未防护插值 ≤ 棘轮基线（只降不升——铁律 #1 机器护栏）', () => {
  if (xssFindings.length > xssBaseline) {
    const detail = xssFindings
      .slice(0, 15)
      .map((f) => '  ' + f.file + ':' + f.line + ' ${' + f.expr + '}')
      .join('\n');
    console.error(`❌ XSS 未防护插值 ${xssFindings.length} > 基线 ${xssBaseline}:\n${detail}`);
  }
  expect(xssFindings.length).toBeLessThanOrEqual(xssBaseline);
});
