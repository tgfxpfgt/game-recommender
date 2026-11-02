/**
 * 游戏雷达 Game Radar - 规则包 URL 协议白名单测试（v14.11 B4，报告 B/C P1-04）
 *
 * searchUrl/base 渲染进 href（escapeAttr 不拦 javascript: 伪协议）——恶意
 * 规则包可注入脚本链接。保存/导入共用校验 validateAdapterRules 拒绝非
 * http(s)，渲染侧（tracking.js）另有 protocol 复核兜底存量规则。
 */
import { test, expect } from 'vitest';
import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';
const storage = createStorageMock();
installChromeStorageMock(storage);
globalThis.window = globalThis.window || {};
globalThis.location = globalThis.location || { href: 'http://test/', search: '', origin: 'http://test' };
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

// v14.13 B9（报告 D P2"多域名丢失"论断复核）：多域名规则 save→load 往返
// 域名集合不变（渲染侧 checkbox 只取 domains[0] 是展示层事，规则数据不丢）
test('多域名规则往返：saveAdapterRules 后 domains 集合不变', async () => {
  storage._reset();
  const rulesMod = await import('../../background/core/rules.js');
  const multi = {
    version: 1,
    sites: [
      {
        key: 'gamer520',
        name: 'Gamer520',
        domains: ['gamer520.com', 'gamers520.com'],
        searchUrl: 'https://www.gamer520.com/?s={q}',
        base: 'https://www.gamer520.com'
      }
    ]
  };
  const r = await rulesMod.saveAdapterRules(multi);
  expect(r.ok).toBe(true);
  const saved = await (await import('../../data/data-store.js')).dataStore.readModule('adapterRules');
  expect(saved.sites[0].domains).toEqual(['gamer520.com', 'gamers520.com']);
});
