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
import { ROOT, collectJs } from './integrity-helpers.mjs';

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

// ============ 14. 主题文件一致性（v14.3.0 B10 引入；v14.3.2 改扫描拆分文件） ============
// styles/themes/<name>.css 每主题一文件（applyTheme 动态加载）。四重守护：
// ①文件集合与 settings-utils 的 VALID_THEMES 全等（steam 为默认主题，定义于
//   ui-theme.css :root，无独立文件）；②每文件变量块 ⊇ 核心键集（:root 减可选
//   键——漏键 = 该主题下消费方回退 steam 默认，SidePanel 主题失效的近因防御）；
//   ③仅部分主题定义的键必须 ∈ 可选键白名单（防笔误/半截键漂移）；④每文件内
//   所有 data-theme 选择器与文件名一致（拆分归属漂移防御）。
//   契约为「核心全量 + 可选覆盖」而非全等：--gr-control-h（紧凑终端系）与
//   --gr-font（等宽/衬线主题）是有意的按主题覆盖。注：v14.3.0 旧断言因解构
//   笔误（([, body]) 取到主题名而非块体）从未实际生效，本版为首个真实校验。
const THEME_OPTIONAL_KEYS = new Set(['--gr-control-h', '--gr-font']);
test('主题文件与变量键一致（19 文件 ↔ VALID_THEMES，核心键全覆盖）', () => {
  const dir = path.join(ROOT, 'styles/themes');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .sort();
  // VALID_THEMES 单源提取（shared/settings-utils.js 经典脚本，正则取 Set 字面量）
  const su = fs.readFileSync(path.join(ROOT, 'shared/settings-utils.js'), 'utf-8');
  const setBody = su.match(/const VALID_THEMES = new Set\(\[([\s\S]*?)\]\)/);
  expect(setBody, 'settings-utils.js 中未找到 VALID_THEMES 声明').not.toBeNull();
  const validThemes = [...setBody[1].matchAll(/'([a-z0-9]+)'/g)].map((m) => m[1]).sort();
  expect(validThemes.length, 'VALID_THEMES 应含 steam + 19 主题').toBe(20);
  expect(
    files.map((f) => f.replace('.css', '')),
    '主题文件集合应与 VALID_THEMES − steam 全等'
  ).toEqual(validThemes.filter((t) => t !== 'steam'));
  // 核心键 = ui-theme.css :root（steam 默认）减可选覆盖键
  const uiTheme = fs.readFileSync(path.join(ROOT, 'styles/ui-theme.css'), 'utf-8');
  const rootBlock = uiTheme.match(/:root\s*\{([^}]*)\}/);
  expect(rootBlock, 'ui-theme.css 缺少 :root 默认主题块').not.toBeNull();
  const rootKeys = [...rootBlock[1].matchAll(/(--gr-[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
  const requiredKeys = rootKeys.filter((k) => !THEME_OPTIONAL_KEYS.has(k)).sort();
  // 逐文件：归属一致 + 变量块校验
  const keyFileCount = new Map(); // 变量键 → 定义它的文件数
  for (const f of files) {
    const css = fs.readFileSync(path.join(dir, f), 'utf-8');
    const name = f.replace('.css', '');
    // 归属一致：本文件内所有 data-theme 引用必须是文件自身主题
    const foreign = [...css.matchAll(/data-theme='([^']+)'/g)].map((m) => m[1]).filter((t) => t !== name);
    expect(foreign, `${f} 含其他主题的选择器（拆分归属漂移）`).toEqual([]);
    // 变量块：body[data-theme='<name>'] { ... }（match()[1] = 块体）
    const varBlock = css.match(new RegExp(`body\\[data-theme='${name}'\\]\\s*\\{([^}]*)\\}`));
    expect(varBlock, `${f} 缺少变量块 body[data-theme='${name}']`).not.toBeNull();
    const keys = [...varBlock[1].matchAll(/(--gr-[a-z0-9-]+)\s*:/g)].map((m) => m[1]).sort();
    expect(keys.length, `${f} 变量块为空`).toBeGreaterThan(0);
    const missing = requiredKeys.filter((k) => !keys.includes(k));
    expect(missing, `${f} 缺少核心变量键: ${missing.join(', ')}`).toEqual([]);
    for (const k of keys) keyFileCount.set(k, (keyFileCount.get(k) || 0) + 1);
  }
  // 非全量键（部分主题才有）必须是有意可选键——防笔误/半截键混入
  for (const [k, n] of keyFileCount) {
    if (n < files.length) {
      expect(THEME_OPTIONAL_KEYS.has(k), `变量键 ${k} 仅 ${n}/${files.length} 套主题定义且不在可选白名单`).toBe(true);
    }
  }
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
