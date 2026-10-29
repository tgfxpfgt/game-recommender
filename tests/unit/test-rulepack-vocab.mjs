/**
 * 游戏雷达 Game Radar - 测试：R2 规则包词表通道（第八轮批次 1）
 *
 * 覆盖：v2 规则包导入（sites 生效 + retrievalVocab 写入 override 存储 + 热
 * 更传播）；v1 包（无词表段）导入不清空既有覆盖；非法词表段整包拒绝；
 * GET 导出附带覆盖增量。
 * R2 channel: v2 pack import (sites + vocab override + hot reload), v1 packs
 * leave existing overrides intact, malformed vocab rejects the pack, GET
 * attaches the override for export.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';

const storage = createStorageMock();
installChromeStorageMock(storage);

const handlersMod = await import('../../background/handlers/adapter-rules.js');
const vocab = await import('../../shared/retrieval-vocab.js');
const dataStore = (await import('../../data/data-store.js')).dataStore;
const apiSearch = await import('../../background/steam/api-search.js');
const { DB_KEYS } = await import('../../background/core/constants.js');

const V1_PACK = {
  version: 2,
  sites: [
    {
      key: 'example',
      name: '示例站',
      domains: ['example.com'],
      urlPatterns: ['example.com'],
      selectors: { listItems: '.item', titleLink: 'a.title' },
      features: {}
    }
  ]
};

beforeEach(async () => {
  storage._reset(); // mock 无 local.remove——_reset 即全清（含词表覆盖）
  vocab.resetVocabOverride(); // 内存生效层同步回内置（存储清了但 activeVocab 残留）
  apiSearch.reloadRetrievalRules();
});

describe('R2 规则包词表通道（批次 1）', () => {
  test('v2 包导入：站点生效 + 词表覆盖写入 + 热更传播到导出活绑定', async () => {
    const resp = await handlersMod.adapterRulesHandlers.SAVE_ADAPTER_RULES({
      rules: { ...V1_PACK, retrievalVocab: { version: 1, addonKeywords: [['w', '云端存档']] } }
    });
    expect(resp.ok).toEqual(true);
    expect(resp.vocabApplied).toEqual(true);
    expect(apiSearch.ADDON_NAME_PATTERN.test(' XXX 云端存档 ')).toEqual(true);
    // 词表段已从 ADAPTER_RULES 剥离（单独存储）
    const stored = await dataStore.readModule(DB_KEYS.ADAPTER_RULES);
    expect(stored.retrievalVocab).toEqual(undefined);
    expect(await dataStore.readModule(DB_KEYS.RETRIEVAL_VOCAB_OVERRIDE)).toEqual({
      version: 1,
      addonKeywords: [['w', '云端存档']]
    });
  });

  test('v1 包（无词表段）导入不清空既有覆盖', async () => {
    await dataStore.writeModule(DB_KEYS.RETRIEVAL_VOCAB_OVERRIDE, {
      version: 1,
      addonKeywords: [['w', '原画集设定']]
    });
    const resp = await handlersMod.adapterRulesHandlers.SAVE_ADAPTER_RULES({ rules: { ...V1_PACK } });
    expect(resp.ok).toEqual(true);
    expect(resp.vocabSegment).toEqual(null);
    expect(await dataStore.readModule(DB_KEYS.RETRIEVAL_VOCAB_OVERRIDE)).toEqual({
      version: 1,
      addonKeywords: [['w', '原画集设定']]
    });
  });

  test('非法词表段（非对象）整包拒绝；段内容非法时站点生效但词表回退并上报', async () => {
    const bad1 = await handlersMod.adapterRulesHandlers.SAVE_ADAPTER_RULES({
      rules: { ...V1_PACK, retrievalVocab: 'not-an-object' }
    });
    expect(bad1.ok).toEqual(false);
    expect(bad1.error).toContain('retrievalVocab');
    // 段形态合法但词表内容非法 → 站点生效、词表回退、错误可见
    const bad2 = await handlersMod.adapterRulesHandlers.SAVE_ADAPTER_RULES({
      rules: { ...V1_PACK, retrievalVocab: { version: 1, addonKeywords: 'oops' } }
    });
    expect(bad2.ok).toEqual(true);
    expect(bad2.vocabApplied).toEqual(false);
    expect(bad2.vocabErrors.length).toBeGreaterThan(0);
    expect(apiSearch.ADDON_NAME_PATTERN.test(' XXX 云端存档 ')).toEqual(false);
  });

  test('GET 导出附带词表覆盖增量', async () => {
    await dataStore.writeModule(DB_KEYS.RETRIEVAL_VOCAB_OVERRIDE, {
      version: 1,
      addonKeywords: [['w', '云端存档']]
    });
    const resp = await handlersMod.adapterRulesHandlers.GET_ADAPTER_RULES();
    expect(resp.rules.merged.retrievalVocab).toEqual({
      version: 1,
      addonKeywords: [['w', '云端存档']]
    });
  });
});
