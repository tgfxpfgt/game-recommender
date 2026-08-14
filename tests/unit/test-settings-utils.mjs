/**
 * 游戏雷达 Game Radar - 测试：设置深路径工具 / Settings Path Utilities
 *
 * v6.4.11：shared/settings-utils.js（deepSet / getByPath / applyPatch）。
 * 验证点号路径深读写——此前 savePatch 用 Object.assign 扁平合并，
 * 'badgeVisibility.recent' 被拍平为字面量顶层键，嵌套设置无法保存。
 * Tests dotted-path deep read/write used by popup / vista / options saves.
 */
import { describe, test, expect } from 'vitest';
import '../../shared/settings-utils.js';

const utils = globalThis.__GR_SETTINGS_UTILS__;
const { deepSet, getByPath, applyPatch } = utils;

describe('settings-utils deepSet', () => {
  test('点号路径深写入已存在嵌套 / deep set into existing nested object', () => {
    const obj = { badgeVisibility: { recent: true, all: true }, llmConfig: { provider: 'local' } };
    deepSet(obj, 'badgeVisibility.recent', false);
    expect(obj.badgeVisibility.recent).toBe(false);
    expect(obj.badgeVisibility.all).toBe(true); // 兄弟字段不受影响
    expect(Object.keys(obj)).not.toContain('badgeVisibility.recent'); // 不残留字面量键
  });

  test('中间层不存在时自动创建 / intermediate objects are created', () => {
    const obj = {};
    deepSet(obj, 'llmConfig.endpoint', 'http://localhost:11434');
    expect(obj.llmConfig.endpoint).toBe('http://localhost:11434');
    expect(obj.llmConfig).toEqual({ endpoint: 'http://localhost:11434' });
  });

  test('单层键等同普通赋值 / single-level key behaves like plain assign', () => {
    const obj = { enabled: true };
    deepSet(obj, 'enabled', false);
    expect(obj.enabled).toBe(false);
  });

  test('三层路径 / three-level path', () => {
    const obj = {};
    deepSet(obj, 'a.b.c', 42);
    expect(obj.a.b.c).toBe(42);
  });
});

describe('settings-utils getByPath', () => {
  test('读取嵌套值 / read nested value', () => {
    const obj = { llmConfig: { temperature: 0.3 } };
    expect(getByPath(obj, 'llmConfig.temperature')).toBe(0.3);
  });

  test('缺失路径返回 fallback / missing path returns fallback', () => {
    expect(getByPath({}, 'a.b.c', 7)).toBe(7);
    expect(getByPath(null, 'a.b', 'x')).toBe('x');
  });

  test('值为 undefined 时返回 fallback / undefined value falls back', () => {
    expect(getByPath({ a: undefined }, 'a', 1)).toBe(1);
  });
});

describe('settings-utils applyPatch', () => {
  test('点号键与普通键混合合并 / dotted and plain keys merge together', () => {
    const obj = { enabled: true, badgeVisibility: { recent: true } };
    applyPatch(obj, { enabled: false, 'badgeVisibility.recent': false, 'llmConfig.model': 'qwen2.5:7b' });
    expect(obj.enabled).toBe(false);
    expect(obj.badgeVisibility.recent).toBe(false);
    expect(obj.llmConfig.model).toBe('qwen2.5:7b');
    // 不得残留字面量点号键 / no literal dotted keys remain
    expect(Object.keys(obj)).not.toContain('badgeVisibility.recent');
    expect(Object.keys(obj)).not.toContain('llmConfig.model');
  });

  test('空补丁不改变对象 / empty patch is a no-op', () => {
    const obj = { a: 1 };
    applyPatch(obj, {});
    expect(obj).toEqual({ a: 1 });
  });
});
