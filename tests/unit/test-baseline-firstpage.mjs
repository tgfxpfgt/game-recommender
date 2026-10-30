/**
 * 游戏雷达 Game Radar - 测试：三站第一页基准回放（用户需求 2）
 *
 * tests/fixtures/baseline-firstpage.json = 当前 3 个下载站首页的 ground-truth
 * 基准（站点详情页内嵌 appid 为准）。回放 searchSteamAppId（recorded 离线），
 * 逐条比对命中——**错配/未命中即失败**，把"第一页全对"变成可执行验收。
 * 与错题库（test-mismatch-samples）互补：错题库是历史事故现场，本基准是
 * 当前第一页的全量横截面。
 * First-page baseline replay: every sample must hit its ground-truth appid.
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

const BASELINE_PATH = new URL('../fixtures/baseline-firstpage.json', import.meta.url);
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));

const { parseGameTitle } = await import('../../background/core/title-parser.js');
const api = await import('../../background/steam/api-search.js');

function installReplay(sample) {
  const recorded = sample.recorded || {};
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

describe('三站第一页基准回放（批次 14）', () => {
  beforeEach(() => {
    storage._reset();
  });

  for (const sample of baseline.samples) {
    if (sample.skipVerify) continue; // 搜索路径不可判定的样本（元素直取可达）
    test(`基准 ${sample.id} → ${sample.expectedAppId}`, async () => {
      const restore = installReplay(sample);
      try {
        const terms = parseGameTitle(sample.rawTitle);
        // 覆盖护栏：recorded 必须覆盖至少一个解析词（防录制期词形漂移）
        const covered = terms.some((t) => Object.prototype.hasOwnProperty.call(sample.recorded, t));
        if (!covered) {
          expect(covered, `recorded 未覆盖解析词: ${sample.id}`).toEqual(true);
          return;
        }
        const r = await api.searchSteamAppId(terms, sample.rawTitle, null);
        expect(r, `${sample.id} 未命中（应为 ${sample.expectedAppId}）`).not.toEqual(null);
        expect(String(r.appId), `${sample.id} 错配`).toEqual(String(sample.expectedAppId));
      } finally {
        restore();
      }
    });
  }
});
