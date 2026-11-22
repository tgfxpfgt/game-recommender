/**
 * 游戏雷达 Game Radar - 设置键审计（v14.42.6，用户指令：失效/脱控面盘点）
 *
 * 三面交叉：DEFAULT_SETTINGS 键 × 代码消费（content+background）× 设置面板 UI
 * （options/popup 引用）。分类：
 *   DEAD     — 无任何消费（键存在但功能不存在）
 *   NO_UI    — 有消费但面板无开关（实际不受设置控制）
 *   FAKE_UI  — 面板有开关但无消费（开关是假的）
 *   OK       — 消费与 UI 齐备
 * 输出 markdown 报告（docs/reports/settings-audit.md）。--strict 时 DEAD/FAKE 退出码 1（可做门禁）。
 * Usage: node scripts/audit-settings.mjs [--strict]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { DEFAULT_SETTINGS } = await import(new URL('../background/core/constants.js', import.meta.url).href);

// 递归展平键路径（顶层键为主，嵌套组记 dotted path）
/** @param {any} obj @param {string} prefix @returns {string[]} */
function flatten(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj || {})) {
    const p = prefix ? prefix + '.' + k : k;
    out.push(p);
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...flatten(v, p));
  }
  return out;
}
const keys = flatten(DEFAULT_SETTINGS);

// 收集源文件文本（content/background/options/popup/shared）
/** @param {string} rel @returns {string} */
const read = (rel) => {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch {
    return '';
  }
};
const globJs = (dir) => {
  const out = [];
  /** @param {string} d */
  const walk = (d) => {
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(ROOT, d), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = d + '/' + e.name;
      if (e.isDirectory()) walk(rel);
      else if (/\.(js|mjs|html)$/.test(e.name)) out.push({ rel, text: read(rel) });
    }
  };
  walk(dir);
  return out;
};
const biz = [...globJs('content'), ...globJs('background')];
const ui = [...globJs('options'), ...globJs('popup'), ...globJs('sidepanel')];

// 引用判定：键路径叶子名 + 顶层名出现即计（保守——避免动态路径漏报）
const mentions = (/** @type {string} */ key, /** @type {{text: string}[]} */ files) =>
  files.filter((f) => f.text.includes(key)).length;

const rows = [];
for (const key of keys) {
  const leaf = key.split('.').pop();
  const bizHits = mentions(leaf, biz);
  const uiHits = mentions(leaf, ui);
  // 嵌套组键以顶层对象名判定（组名在消费侧必然出现）
  const isGroup = key.includes('.');
  const bizRef = isGroup ? bizHits : bizHits;
  const uiRef = isGroup ? uiHits : uiHits;
  let cls;
  if (bizRef === 0 && uiRef === 0) cls = 'DEAD';
  else if (bizRef > 0 && uiRef === 0) cls = 'NO_UI';
  else if (bizRef === 0 && uiRef > 0) cls = 'FAKE_UI';
  else cls = 'OK';
  rows.push({ key, leaf, bizHits, uiHits, cls });
}

// 报告
const groups = { DEAD: [], NO_UI: [], FAKE_UI: [], OK: [] };
for (const r of rows) groups[r.cls].push(r);
const md = [
  '# 设置键审计（' + new Date().toISOString().slice(0, 10) + '）',
  '',
  '> 机器生成：node scripts/audit-settings.mjs——键 × 代码消费 × 面板 UI 三面交叉。',
  '> leaf 名粗粒度匹配（保守）：DEAD/FAKE_UI 需人工复核后处置。',
  '',
  '- 总键数（含嵌套）: ' + rows.length,
  '- OK: ' +
    groups.OK.length +
    '　NO_UI（脱控）: ' +
    groups.NO_UI.length +
    '　DEAD（死键）: ' +
    groups.DEAD.length +
    '　FAKE_UI（假开关）: ' +
    groups.FAKE_UI.length,
  '',
  '## NO_UI — 有消费但面板无开关（实际不受设置控制）',
  '',
  ...groups.NO_UI.map((r) => '- `' + r.key + '`（代码引用 ' + r.bizHits + ' 处）'),
  '',
  '## DEAD — 无任何消费',
  '',
  ...(groups.DEAD.length ? groups.DEAD.map((r) => '- `' + r.key + '`') : ['（无）']),
  '',
  '## FAKE_UI — 面板有开关但无消费',
  '',
  ...(groups.FAKE_UI.length ? groups.FAKE_UI.map((r) => '- `' + r.key + '`') : ['（无）']),
  ''
];
fs.mkdirSync(path.join(ROOT, 'docs/reports'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs/reports/settings-audit.md'), md.join('\n'));
console.log(
  'OK=' +
    groups.OK.length +
    ' NO_UI=' +
    groups.NO_UI.length +
    ' DEAD=' +
    groups.DEAD.length +
    ' FAKE_UI=' +
    groups.FAKE_UI.length
);
console.log('报告: docs/reports/settings-audit.md');
if (process.argv.includes('--strict') && (groups.DEAD.length || groups.FAKE_UI.length)) process.exit(1);
