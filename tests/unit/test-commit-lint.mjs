// 游戏雷达 Game Radar - commit-lint 单元测试
// v14.33.0（提交与版本规范治理）：Conventional Commits 1.0.0 校验器回归。
// 校验器 = scripts/commit-lint.mjs（commit-msg 钩子与 npm run lint:commits 同源实现）；
// 本套件锁定规则语义，防止校验器被静默放宽（如恢复逗号多 scope/超长 subject）。
import { describe, it, expect } from 'vitest';
import { lintMessage, COMMIT_TYPES, SUBJECT_MAX } from '../../scripts/commit-lint.mjs';

describe('commit-lint（Conventional Commits 1.0.0）', () => {
  it('合规单行提交通过', () => {
    expect(lintMessage('fix: 修复详情页检索失败')).toEqual({ ok: true, errors: [] });
  });

  it('合规带 scope 与空行分隔的 body 通过', () => {
    expect(lintMessage('feat(ui): 徽章组件化\n\n- innerHTML 退役\n- token 单源接入')).toEqual({
      ok: true,
      errors: []
    });
  });

  it('缺类型前缀 → 红', () => {
    const r = lintMessage('修复详情页检索失败');
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain('type(scope)?: subject');
  });

  it('未知类型 → 红', () => {
    expect(lintMessage('deploy: 上线').ok).toBe(false);
  });

  it('scope 含逗号（历史多 scope 写法）→ 红', () => {
    expect(lintMessage('chore(security,ci): CodeQL 告警清零').ok).toBe(false);
  });

  it('scope 含大写 → 红', () => {
    expect(lintMessage('feat(UI): 徽章').ok).toBe(false);
  });

  it('subject 超 72 字符 → 红（细节应移入 body），恰 72 通过', () => {
    // 上限计冒号后的 subject 本体（不含 "fix: " 前缀）：72 边界绿、73 超限红
    expect(lintMessage('fix: ' + 'x'.repeat(72)).ok).toBe(true);
    expect(lintMessage('fix: ' + 'x'.repeat(73)).ok).toBe(false);
    expect(SUBJECT_MAX).toBe(72);
  });

  it('subject 结尾中/英文句号 → 红', () => {
    expect(lintMessage('fix: 修复检索。').ok).toBe(false);
    expect(lintMessage('fix: fix search.').ok).toBe(false);
  });

  it('subject 与 body 之间无空行 → 红', () => {
    expect(lintMessage('fix: 修复\n- 要点直接贴着主题').ok).toBe(false);
  });

  it('subject 带 ! 但缺 BREAKING CHANGE 说明 → 红', () => {
    expect(lintMessage('feat!: 破坏性改动').ok).toBe(false);
  });

  it('subject 带 ! 且 footer 有 BREAKING CHANGE → 绿', () => {
    expect(lintMessage('feat!: 破坏性改动\n\nBREAKING CHANGE: 备份格式变更，旧文件需迁移').ok).toBe(true);
  });

  it('仅 footer 声明 BREAKING CHANGE（subject 无 !）→ 绿（CC 规范允许）', () => {
    expect(lintMessage('feat: 备份格式升级\n\nBREAKING CHANGE: 旧备份需迁移').ok).toBe(true);
  });

  it('Merge/Revert 自动提交跳过（git 自动生成信息）', () => {
    expect(lintMessage('Merge branch "main" of example').ok).toBe(true);
    expect(lintMessage('Revert "feat: x"\n\nThis reverts commit abc.').ok).toBe(true);
  });

  it('类型白名单覆盖 CC 常用 11 类', () => {
    expect(COMMIT_TYPES).toEqual(
      expect.arrayContaining([
        'feat',
        'fix',
        'refactor',
        'perf',
        'docs',
        'test',
        'build',
        'ci',
        'chore',
        'style',
        'revert'
      ])
    );
  });

  it('subject 上限为 72 字符（行业惯例 50-72 区间取上限）', () => {
    expect(SUBJECT_MAX).toBe(72);
  });
});
