/**
 * 游戏雷达 Game Radar - 测试：R2 词表规则包通道（批次 12）
 *
 * 覆盖：覆盖词表键级合并生效（内置在前追加）→ 热更传播到消费方（导出活
 * 绑定 + title-parser 用时取用）；校验失败回退（非法覆盖不生效，已生效的
 * 合法覆盖保持）；存储装载器（retrieval-override）读入→应用/失败保持。
 * R2 channel: override merge + hot-reload propagation, validation fallback,
 * and the storage loader.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';

const storage = createStorageMock();
installChromeStorageMock(storage);

const vocab = await import('../../shared/retrieval-vocab.js');
const apiSearch = await import('../../background/steam/api-search.js');
const parser = await import('../../background/core/title-parser.js');
const overrideLoader = await import('../../background/steam/retrieval-override.js?t=r2');
const dataStore = (await import('../../data/data-store.js')).dataStore;
const { DB_KEYS } = await import('../../background/core/constants.js');

beforeEach(() => {
  vocab.resetVocabOverride();
  apiSearch.reloadRetrievalRules(); // 与重置同步：导出活绑定回到内置词表
  storage._reset();
});

describe('R2 词表覆盖（批次 12）', () => {
  test('覆盖键级合并生效：新词命中、原词不回归、热更传播到活绑定与用时取用', async () => {
    expect(apiSearch.ADDON_NAME_PATTERN.test(' XXX 云端存档 ')).toEqual(false); // 内置无此词
    const errors = vocab.applyVocabOverride({
      version: 1,
      addonKeywords: [['w', '云端存档']],
      noiseTitle: [['w', '存档检测词']]
    });
    expect(errors).toEqual([]);
    apiSearch.reloadRetrievalRules();
    // 导出活绑定已切新词表 / live binding sees the new vocab
    expect(apiSearch.ADDON_NAME_PATTERN.test(' XXX 云端存档 ')).toEqual(true);
    // 原词不回归（内置在前追加）/ built-ins still present
    expect(apiSearch.ADDON_NAME_PATTERN.test('Hollow Knight: DLC 包')).toEqual(true);
    // title-parser 用时取用：新噪声词被清洗 / per-use fetch picks up the merge
    const cands = parser.parseGameTitle('某游戏|存档检测词');
    expect(cands.join('|').includes('存档检测词')).toEqual(false);
    expect(cands.some((c) => c.includes('某游戏'))).toEqual(true);
  });

  test('校验失败回退：非法覆盖不生效，内置保持', () => {
    const errors = vocab.applyVocabOverride({
      version: 1,
      addonKeywords: [
        ['x', ''],
        ['bad', 'kind']
      ]
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(apiSearch.ADDON_NAME_PATTERN.test(' XXX 云端存档 ')).toEqual(false); // 从未生效的探针词
  });

  test('存储装载器：合法覆盖应用 / 非法覆盖保持已生效词表', async () => {
    await dataStore.writeModule(DB_KEYS.RETRIEVAL_VOCAB_OVERRIDE, {
      version: 1,
      addonKeywords: [['w', '原画集设定']]
    });
    const r1 = await overrideLoader.ensureRetrievalVocabOverride();
    expect(r1.applied).toEqual(true);
    expect(apiSearch.ADDON_NAME_PATTERN.test(' XXX 原画集设定 ')).toEqual(true);
    // 非法覆盖 → 保持当前词表（已生效的合法覆盖不被破坏，内置兜底）
    await dataStore.writeModule(DB_KEYS.RETRIEVAL_VOCAB_OVERRIDE, { version: 1, editionWords: 'not-an-array' });
    const r2 = await overrideLoader.ensureRetrievalVocabOverride();
    expect(r2.applied).toEqual(false);
    expect(r2.errors.length).toBeGreaterThan(0);
    expect(apiSearch.ADDON_NAME_PATTERN.test(' XXX 原画集设定 ')).toEqual(true);
  });
});
