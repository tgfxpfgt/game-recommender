/**
 * 游戏雷达 Game Radar - 测试：AI/LLM 匹配兜底 / AI Match Fallback
 *
 * v6.4.16：规则匹配失败后的 LLM 兜底链路——LLM 提取官方名 →
 * storesearch/appdetails 官方校验（防幻觉）→ 缓存（成功 7d/失败 24h）。
 * 覆盖：纯函数解析 + 完整链路（mock storage + fetch，含真实 nameMatchesSearch
 * 校验路径——"生化危机9 安魂曲" → Resident Evil Requiem 3764200 场景）。
 */
import { test, expect, describe, beforeAll, afterAll } from 'vitest';
import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';
import { createFetchMock, installFetchMock } from '../helpers/fetch-mock.mjs';

// 单份 storage mock + chrome mock（模块单例共享：settings 缓存需显式重置）
const storage = createStorageMock();
const restoreChrome = installChromeStorageMock(storage);

const aiMod = await import(new URL('../../background/steam/ai-fallback.js', import.meta.url).href);
const settingsMod = await import(new URL('../../background/core/settings.js', import.meta.url).href);

// 预置 settings 并重置 settings 模块缓存（5s TTL 内存缓存会跨 test 泄漏）
function seedSettings(patch) {
  storage._reset({ settings: { ...patch } });
  settingsMod.resetSettingsCache();
}

// ============ 纯函数：LLM 响应解析 ============
describe('parseLlmMatchResponse', () => {
  const { parseLlmMatchResponse } = aiMod;

  test('标准 JSON 返回', () => {
    expect(parseLlmMatchResponse('{"name": "Resident Evil Requiem", "appid": 3764200}')).toEqual({
      name: 'Resident Evil Requiem',
      appId: 3764200
    });
  });

  test('JSON 包裹在散落文本中（代码块）', () => {
    const r = parseLlmMatchResponse('好的，结果如下：\n```json\n{"name": "艾尔登法环", "appid": null}\n```');
    expect(r).toEqual({ name: '艾尔登法环', appId: null });
  });

  test('appid 为 null 且 name 空 → null', () => {
    expect(parseLlmMatchResponse('{"name": "", "appid": null}')).toEqual(null);
  });

  test('非数字 appid 拒绝（防类型污染）', () => {
    const r = parseLlmMatchResponse('{"name": "X", "appid": "3764200"}');
    expect(r).toEqual({ name: 'X', appId: null });
  });

  test('无法解析 → null', () => {
    expect(parseLlmMatchResponse('抱歉我无法确定')).toEqual(null);
    expect(parseLlmMatchResponse('')).toEqual(null);
  });
});

// ============ 完整链路：llmMatchGame ============
describe('llmMatchGame 完整链路（规则失败 → LLM 兜底 → 官方校验）', () => {
  const { llmMatchGame } = aiMod;
  let fetchMock, restoreFetch;

  beforeAll(() => {
    seedSettings({
      useLLM: true,
      llmConfig: { provider: 'local', endpoint: 'http://localhost:11434/api/generate', model: 'qwen2.5:7b' }
    });
  });

  test('LLM 官方名 → storesearch 校验命中（Resident Evil Requiem 场景）', async () => {
    fetchMock = createFetchMock({
      '/api/generate': () => ({ response: '{"name": "Resident Evil Requiem", "appid": null}' }),
      '/api/storesearch': {
        items: [
          { id: 2050650, name: 'Resident Evil 4', type: 'app' },
          { id: 3764200, name: 'Resident Evil Requiem', type: 'app' },
          { id: 418370, name: 'Resident Evil 7 Biohazard', type: 'app' }
        ]
      }
    });
    restoreFetch = installFetchMock(fetchMock);
    const result = await llmMatchGame('生化危机9 安魂曲|中字-国语|Build.22898177', null);
    expect(result && result.appId).toEqual(3764200);
    expect(result && result.aiFallback).toEqual(true);
    // LLM 官方名确实走了 storesearch 官方索引校验
    expect(fetchMock._calls.some((u) => u.includes('/api/storesearch'))).toEqual(true);
    restoreFetch();
    restoreFetch = null;
  });

  test('LLM 直接给 appid → appdetails 官方名校验', async () => {
    fetchMock = createFetchMock({
      '/api/generate': () => ({ response: '{"name": "", "appid": 3764200}' }),
      '/api/appdetails': {
        3764200: { success: true, data: { steam_appid: 3764200, name: '生化危机 安魂曲' } }
      }
    });
    restoreFetch = installFetchMock(fetchMock);
    const result = await llmMatchGame('生化危机9 安魂曲', null);
    expect(result && result.appId).toEqual(3764200);
    restoreFetch();
    restoreFetch = null;
  });

  test('LLM 输出无法解析 → null（不信任）', async () => {
    fetchMock = createFetchMock({
      '/api/generate': () => ({ response: '我不确定这个游戏在 Steam 上叫什么。' })
    });
    restoreFetch = installFetchMock(fetchMock);
    const result = await llmMatchGame('某个奇怪游戏', null);
    expect(result).toEqual(null);
    restoreFetch();
    restoreFetch = null;
  });

  test('LLM 名搜索不到 → null（校验失败不采用）', async () => {
    fetchMock = createFetchMock({
      '/api/generate': () => ({ response: '{"name": "Nonexistent Game XYZ", "appid": null}' }),
      '/api/storesearch': { items: [] }
    });
    restoreFetch = installFetchMock(fetchMock);
    const result = await llmMatchGame('不存在游戏 XYZ', null);
    expect(result).toEqual(null);
    restoreFetch();
    restoreFetch = null;
  });

  test('失败结果缓存 24h（同标题不重复打 LLM）', async () => {
    fetchMock = createFetchMock({
      '/api/generate': () => ({ response: '{"name": "Nonexistent Game XYZ", "appid": null}' }),
      '/api/storesearch': { items: [] }
    });
    restoreFetch = installFetchMock(fetchMock);
    await llmMatchGame('缓存测试游戏 ABC', null);
    const before = fetchMock._calls.filter((u) => u.includes('/api/generate')).length;
    await llmMatchGame('缓存测试游戏 ABC', null);
    const after = fetchMock._calls.filter((u) => u.includes('/api/generate')).length;
    expect(after).toEqual(before); // 失败缓存命中，未再调 LLM
    restoreFetch();
    restoreFetch = null;
  });
});

// ============ 未配置 LLM → 静默跳过 ============
describe('llmMatchGame 未配置 LLM', () => {
  test('useLLM=false → 直接返回 null（不触发任何网络）', async () => {
    seedSettings({ useLLM: false, llmConfig: {} });
    const fakeFetch = () => {
      throw new Error('不应发起网络请求');
    };
    const prev = globalThis.fetch;
    globalThis.fetch = fakeFetch;
    try {
      expect(await aiMod.llmMatchGame('任意游戏', null)).toEqual(null);
    } finally {
      globalThis.fetch = prev;
    }
  });
});

afterAll(() => {
  restoreChrome();
});
