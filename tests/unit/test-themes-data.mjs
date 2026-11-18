/**
 * 游戏雷达 Game Radar - 主题数据单源完整性测试（v15 阶段 3 主题数据化）
 *
 * themes-data.js 是 styles/themes/<name>.css 变量块的生成源——数据坏了 =
 * 构建产物坏（且 test-integrity-security 也会拦，本测试在源头先拦）。
 * 断言：①主题集合与 VALID_THEMES − steam 全等 ②每主题标题/设计注记/变量
 * 完整且非空 ③变量键 ∈ 已知键集（26 键联合，防笔误键）④构建再生后的锚点
 * 区与数据一致（幂等护栏——手改锚点区会被 build 覆盖，此处校验数据即真相）。
 * Data integrity guard for the theme data single source (build generation
 * source for styles/themes/*.css var blocks).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMES } from '../../shared/themes-data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// VALID_THEMES 单源提取（与 test-integrity-security 同款正则口径）
const su = fs.readFileSync(path.join(ROOT, 'shared/settings-utils.js'), 'utf-8');
const setBody = su.match(/const VALID_THEMES = new Set\(\[([\s\S]*?)\]\)/);
const validThemes = [...setBody[1].matchAll(/'([a-z0-9]+)'/g)].map((m) => m[1]).sort();

// 已知键集 = 19 文件变量键联合（26 键；防笔误键混入数据）
const KNOWN_KEYS = new Set([
  '--gr-accent',
  '--gr-accent-btn',
  '--gr-accent-btn-hover',
  '--gr-bg',
  '--gr-bg-deep',
  '--gr-border',
  '--gr-border-soft',
  '--gr-card',
  '--gr-card-hover',
  '--gr-control-h',
  '--gr-font',
  '--gr-gap',
  '--gr-grad-btn',
  '--gr-green',
  '--gr-orange',
  '--gr-page-grad',
  '--gr-panel',
  '--gr-panel-2',
  '--gr-radius',
  '--gr-radius-sm',
  '--gr-red',
  '--gr-shadow',
  '--gr-shadow-lg',
  '--gr-text',
  '--gr-text-bright',
  '--gr-text-dim'
]);

describe('主题数据单源（themes-data.js）完整性', () => {
  it('主题集合与 VALID_THEMES − steam 全等', () => {
    expect(Object.keys(THEMES).sort()).toEqual(validThemes.filter((t) => t !== 'steam'));
  });

  it('每主题标题与设计注记非空', () => {
    for (const [name, t] of Object.entries(THEMES)) {
      expect(t.title, name + ' 标题为空').toBeTruthy();
      expect(Array.isArray(t.desc) && t.desc.length > 0, name + ' 设计注记为空').toBe(true);
      for (const l of t.desc) {
        expect(typeof l === 'string' && l.length > 0, name + ' 注记行非空字符串').toBe(true);
      }
    }
  });

  it('每主题变量非空、值非空字符串、键 ∈ 已知键集', () => {
    for (const [name, t] of Object.entries(THEMES)) {
      const keys = Object.keys(t.vars);
      expect(keys.length, name + ' 变量块为空').toBeGreaterThan(0);
      for (const k of keys) {
        expect(KNOWN_KEYS.has(k), `${name} 变量键 ${k} 不在已知键集（笔误？）`).toBe(true);
        expect(typeof t.vars[k] === 'string' && t.vars[k].length > 0, `${name} ${k} 值为空`).toBe(true);
      }
    }
  });

  it('每主题变量块覆盖核心键集（ui-theme.css :root 减可选键）', () => {
    const uiTheme = fs.readFileSync(path.join(ROOT, 'styles/ui-theme.css'), 'utf-8');
    const rootBlock = uiTheme.match(/:root\s*\{([^}]*)\}/);
    const rootKeys = [...rootBlock[1].matchAll(/(--gr-[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
    const required = rootKeys.filter((k) => k !== '--gr-control-h' && k !== '--gr-font');
    for (const [name, t] of Object.entries(THEMES)) {
      const missing = required.filter((k) => !(k in t.vars));
      expect(missing, name + ' 缺少核心变量键: ' + missing.join(', ')).toEqual([]);
    }
  });

  it('构建再生后的锚点区与数据一致（幂等护栏）', () => {
    const dir = path.join(ROOT, 'styles/themes');
    for (const [name, t] of Object.entries(THEMES)) {
      const css = fs.readFileSync(path.join(dir, name + '.css'), 'utf-8');
      const begin = css.indexOf('/* GR-GENERATED-BEGIN');
      const endMark = '/* GR-GENERATED-END */';
      expect(begin !== -1 && css.indexOf(endMark) > begin, name + ' 缺少生成锚点').toBe(true);
      const varBlock = css.match(new RegExp(`body\\[data-theme='${name}'\\]\\s*\\{([^}]*)\\}`));
      const cssVars = [...varBlock[1].matchAll(/(--gr-[a-z0-9-]+)\s*:\s*([^;]+);/g)];
      expect(cssVars.length).toEqual(Object.keys(t.vars).length);
      for (const [k, v] of cssVars.map((m) => [m[1], m[2].trim()])) {
        expect(t.vars[k], `${name} ${k} 生成区与数据漂移（构建未跑或手改锚点区）`).toEqual(v);
      }
    }
  });
});
