/**
 * 游戏雷达 Game Radar - 规则包 URL 协议白名单测试（v14.11 B4，报告 B/C P1-04）
 *
 * searchUrl/base 渲染进 href（escapeAttr 不拦 javascript: 伪协议）——恶意
 * 规则包可注入脚本链接。保存/导入共用校验 validateAdapterRules 拒绝非
 * http(s)，渲染侧（tracking.js）另有 protocol 复核兜底存量规则。
 */
import { test, expect } from 'vitest';
import { validateAdapterRules } from '../../background/core/rules.js';

const pkg = (searchUrl, base) => ({
  version: 1,
  sites: [
    {
      key: 'evil',
      name: 'Evil Site',
      domains: ['evil.example'],
      searchUrl,
      base
    }
  ]
});

test('javascript: 伪协议 searchUrl 被拒', () => {
  const r = validateAdapterRules(pkg('javascript:alert(document.domain)//', 'https://evil.example'));
  expect(r.ok).toBe(false);
  expect(r.error).toContain('仅允许 http(s) 协议');
});

test('javascript: 伪协议 base 被拒', () => {
  const r = validateAdapterRules(pkg('https://evil.example/search?q={q}', 'javascript:x'));
  expect(r.ok).toBe(false);
  expect(r.error).toContain('仅允许 http(s) 协议');
});

test('合法 http/https 规则放行', () => {
  const r = validateAdapterRules(pkg('https://evil.example/s?q={q}', 'http://evil.example'));
  expect(r.ok).toBe(true);
});

test('data: 协议同样被拒', () => {
  const r = validateAdapterRules(pkg('data:text/html,<script>1</script>', 'https://evil.example'));
  expect(r.ok).toBe(false);
  expect(r.error).toContain('仅允许 http(s) 协议');
});
