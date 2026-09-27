/**
 * 游戏雷达 Game Radar - 转义防线鲁棒性 + 候选 appId 规范化单测
 *
 * v10.8.1 修复回归：v10.5.0 安全清扫把候选渲染改为 escapeAttr(c.appId)，而
 * searchSteamAppId 返回的 appId 是 Steam storesearch 的数字——数字无 .replace
 * 抛 TypeError，候选浮窗整体"搜索失败"。双层修复：escapeAttr 入参 String
 * 强转（防线自身不得因类型崩溃）+ 候选 appId 边界规范化。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// shared/escape.js（IIFE 挂 globalThis；escapeAttr 为纯 String 操作，Node 可测）
await import('../../shared/escape.js');
const { escapeAttr } = globalThis;

// 候选 handler：mock 掉 api-search（searchSteamAppId 返回数字 appId 的真实形态）
vi.mock('../../background/steam/api-search.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    searchSteamAppId: vi.fn().mockResolvedValue({ appId: 12345, name: '测试游戏', englishName: 'Test Game' })
  };
});

describe('escapeAttr 鲁棒性（v10.8.1 回归）', () => {
  it('数字入参不抛错且正确字符串化（候选 appId 场景）', () => {
    expect(escapeAttr(12345)).toEqual('12345');
    expect(escapeAttr(0)).toEqual('0');
  });
  it('null/undefined → 空串；false → "false"（String 化语义，比旧 || 更保真）', () => {
    expect(escapeAttr(null)).toEqual('');
    expect(escapeAttr(undefined)).toEqual('');
    expect(escapeAttr(false)).toEqual('false');
  });
  it('对象入参不抛错（防线不得因类型崩溃）', () => {
    expect(typeof escapeAttr({})).toEqual('string');
    expect(typeof escapeAttr(['a'])).toEqual('string');
  });
  it('字符串转义语义不变（引号/尖括号/&）', () => {
    expect(escapeAttr('a&b"c<d>')).toEqual('a&amp;b&quot;c&lt;d&gt;');
    expect(escapeAttr('https://x.com/a?b=1&c=2')).toEqual('https://x.com/a?b=1&amp;c=2');
  });
});

describe('候选 appId 规范化（v10.8.1 回归）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('SEARCH_STEAM_CANDIDATES 返回字符串 appId（数字入库即崩渲染）', async () => {
    const { handleSearchSteamCandidates } = await import('../../background/handlers/steam.js');
    const resp = await handleSearchSteamCandidates({ gameName: '测试游戏' });
    expect(resp.candidates.length).toBeGreaterThan(0);
    expect(typeof resp.candidates[0].appId).toEqual('string');
    expect(resp.candidates[0].appId).toEqual('12345');
  });
});
