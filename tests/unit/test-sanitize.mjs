/**
 * 游戏雷达 Game Radar - stripSecrets 单源测试（v14.11 B3，报告 B/C P1-03）
 *
 * 导出/备份密钥剔除的回归锁：ITAD 密钥（itadApiKey/itadProfiles[].key）此前
 * 从未剔除而 UI 承诺已剔除——虚假安全声明。本测试钉死全部密钥字段剔除 +
 * 非敏感字段保留 + 原对象不被修改。
 */
import { describe, test, expect } from 'vitest';
import { stripSecrets, sanitizeLogData, sanitizeUrlText } from '../../background/core/sanitize.js';

describe('stripSecrets（导出/备份密钥剔除单源）', () => {
  test('剔除全部四类密钥（llm/steam/itad 单键/itadProfiles key）', () => {
    const s = stripSecrets({
      llmConfig: { apiKey: 'sk-secret', endpoint: 'http://localhost:11434', model: 'qwen' },
      steamApiKey: 'STEAMKEY',
      itadApiKey: 'ITADKEY',
      itadProfiles: [
        { id: 'p1', name: '主配置', key: 'ITADKEY1' },
        { id: 'p2', name: '备用', key: 'ITADKEY2' }
      ],
      enabled: true,
      uiTheme: 'steam'
    });
    expect(s.llmConfig.apiKey).toEqual('');
    expect(s.llmConfig.endpoint).toEqual('http://localhost:11434'); // 非敏感保留
    expect(s.steamApiKey).toEqual('');
    expect(s.itadApiKey).toEqual('');
    expect(s.itadProfiles[0].key).toEqual('');
    expect(s.itadProfiles[0].name).toEqual('主配置'); // 非敏感保留
    expect(s.itadProfiles[1].key).toEqual('');
    expect(s.enabled).toBe(true);
    expect(s.uiTheme).toEqual('steam');
    // 全文检索无密钥残留（导出文件级验收口径）
    expect(JSON.stringify(s)).not.toContain('sk-secret');
    expect(JSON.stringify(s)).not.toContain('ITADKEY');
    expect(JSON.stringify(s)).not.toContain('STEAMKEY');
  });

  test('缺失字段安全（不产生 undefined 键污染）+ 原对象不被修改', () => {
    const original = { enabled: true };
    const s = stripSecrets(original);
    expect(s.enabled).toBe(true);
    expect('itadApiKey' in s).toBe(false);
    expect('steamApiKey' in s).toBe(false);
    expect(original.itadApiKey).toBeUndefined();
  });

  test('空入参安全', () => {
    expect(stripSecrets(null)).toEqual({});
    expect(stripSecrets(undefined)).toEqual({});
  });
});

// v14.26.0 P1-8：日志脱敏回归锁——带密钥的 URL 曾原样落盘，导出诊断包即外带
// 凭据；规则 = URL 只留 origin+path（appid/id 白名单保留）+ 递归剔密钥字段。
describe('sanitizeLogData / sanitizeUrlText（日志脱敏）', () => {
  test('URL 裁 query 与 hash，保留 origin+path 与 appid/id 白名单', () => {
    expect(sanitizeUrlText('https://api.isthereanydeal.com/games/lookup/v1?key=ITADKEY&appid=730&id=9#x')).toEqual(
      'https://api.isthereanydeal.com/games/lookup/v1?appid=730&id=9'
    );
    // 无 URL / 非字符串原样
    expect(sanitizeUrlText('无链接文本')).toEqual('无链接文本');
    expect(sanitizeUrlText(null)).toEqual(null);
  });

  test('递归剔除密钥字段并裁剪嵌套 URL（含数组）', () => {
    const clean = sanitizeLogData({
      url: 'https://store.steampowered.com/app/730/?cc=us&key=SECRET',
      nested: { apiKey: 'sk-x', token: 'tkn', keep: 'v' },
      list: [{ password: 'p', href: 'https://a.test/x?secret=1' }]
    });
    expect(clean.url).toEqual('https://store.steampowered.com/app/730/');
    expect(clean.nested.apiKey).toEqual('');
    expect(clean.nested.token).toEqual('');
    expect(clean.nested.keep).toEqual('v');
    expect(clean.list[0].password).toEqual('');
    expect(clean.list[0].href).toEqual('https://a.test/x');
    // 全文检索无密钥残留（导出文件级验收口径）
    const text = JSON.stringify(clean);
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('sk-x');
    expect(text).not.toContain('tkn');
  });

  test('原始类型与超深结构安全', () => {
    expect(sanitizeLogData(42)).toEqual(42);
    expect(sanitizeLogData(true)).toBe(true);
    expect(sanitizeLogData(null)).toEqual(null);
    let deep = { leaf: 1 };
    for (let i = 0; i < 10; i++) deep = { deep };
    expect(JSON.stringify(sanitizeLogData(deep))).toContain('…'); // 深度上限截断
  });
});
