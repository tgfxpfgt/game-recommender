/**
 * 游戏雷达 Game Radar - 错题库回放测试（tests/fixtures/mismatch-samples.json）
 *
 * v14.6.2（用户要求）：appid 匹配错误的现场样例离线存储——检索算法任何变更
 * （阈值/护栏/变体/打分）后必须跑本套件：逐词 storesearch 用 recorded 回放，
 * 断言命中 expectedAppId。命中变差（错配/漏配）即失败——把"效果不会变差"
 * 变成可执行的验收条件。
 * Offline replay of recorded mismatch samples: every sample replays its
 * recorded per-term storesearch responses through searchSteamAppId and must
 * still hit the expected appid after any retrieval change.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';
import { installFetchMock } from '../helpers/fetch-mock.mjs';

await import('../../shared/escape.js');
const storage = createStorageMock();
installChromeStorageMock(storage);
globalThis.window = globalThis.window || {};
globalThis.location = globalThis.location || { href: 'http://test/', search: '', origin: 'http://test' };
globalThis.chrome = globalThis.chrome || { runtime: { getManifest: () => ({ version: '0-test' }) } };

const SAMPLES_PATH = new URL('../fixtures/mismatch-samples.json', import.meta.url);
const samples = JSON.parse(readFileSync(SAMPLES_PATH, 'utf-8'));

const { parseGameTitle } = await import('../../background/core/title-parser.js');
const api = await import('../../background/steam/api-search.js');

// parseGameTitle 属于 title-parser（内容侧 common.cleanPageTitle 在 clean 后
// 管线等价）——样例直接携带 cleanTitle 避免跨侧依赖
function termsFor(sample) {
  if (sample.recordedTerms && sample.recordedTerms.length > 0) return sample.recordedTerms;
  return parseGameTitle(sample.cleanTitle || sample.rawTitle);
}

function installReplay(sample) {
  const recorded = sample.recorded || {};
  // storesearch 按 term 精确分发（term 经 encodeURIComponent 编码进 URL）——
  // recorded 无该词 = 当时返回空（total 0）
  const mock = async (url) => {
    const u = decodeURIComponent(String(url));
    const m = u.match(/term=([^&]+)/);
    const term = m ? m[1] : '';
    const hit = recorded[term];
    const payload = hit || { total: 0, items: [] };
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  };
  return installFetchMock(mock);
}

describe('错题库回放（mismatch-samples）', () => {
  beforeEach(() => {
    storage._reset();
  });

  for (const sample of samples.samples) {
    test(`回放 ${sample.id} → ${sample.expectedAppId} (${sample.expectedName})`, async () => {
      const restore = installReplay(sample);
      try {
        const terms = termsFor(sample);
        // 至少一个 recorded 词要覆盖到（防 recorded 键与 parseGameTitle 输出
        // 错位导致回放空转——空转的套件等于没锁）
        const clean = sample.cleanTitle || sample.rawTitle;
        const allTerms = new Set([...terms, clean]);
        const covered = [...allTerms].some((t) => Object.prototype.hasOwnProperty.call(sample.recorded, t));
        expect(covered, `recorded 未覆盖 parseGameTitle 输出: ${sample.id}`).toEqual(true);
        const r = await api.searchSteamAppId(terms, sample.rawTitle, null);
        expect(r, `${sample.id} 应命中 ${sample.expectedAppId}`).not.toEqual(null);
        expect(String(r.appId)).toEqual(String(sample.expectedAppId));
      } finally {
        restore();
      }
    });
  }
});
