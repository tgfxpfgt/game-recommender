/**
 * 游戏雷达 Game Radar - stripSecrets 单源测试（v14.11 B3，报告 B/C P1-03）
 *
 * 导出/备份密钥剔除的回归锁：ITAD 密钥（itadApiKey/itadProfiles[].key）此前
 * 从未剔除而 UI 承诺已剔除——虚假安全声明。本测试钉死全部密钥字段剔除 +
 * 非敏感字段保留 + 原对象不被修改。
 */
import { describe, test, expect } from 'vitest';
import { stripSecrets } from '../../background/core/sanitize.js';

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
