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

// 双基准：三站列表页第一页 + 用户指认的问题页（xdgame list_3——老游戏横截面）
const baseline = ['baseline-firstpage.json', 'baseline-xd3.json'].flatMap((f) => {
  try {
    return JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), 'utf-8')).samples;
  } catch {
    return [];
  }
});

const { parseGameTitle } = await import('../../background/core/title-parser.js');
const api = await import('../../background/steam/api-search.js');
// v14.8 批次 17：熔断器隔离——api-monitor 模块单例跨测试文件持续生效，
// 前序文件的失败累积会触发熔断使本套件全部短路返回 null（间歇性全 null
// 的根因）。每用例前重置。
const monitor = await import('../../background/core/api-monitor.js');

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
    monitor.resetDomainStatus(); // 熔断/分域状态隔离（防前序文件失败连坐）
  });

  for (const sample of baseline) {
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
        if (process.env.GR_DEBUG_SEARCH) {
          console.error(
            '[DBG-T] ' +
              sample.id +
              ' terms=' +
              JSON.stringify(terms) +
              ' r=' +
              JSON.stringify(r) +
              ' circuit=' +
              monitor.isCircuitOpen('store') +
              ' state=' +
              monitor.circuitState('store')
          );
        }
        expect(r, `${sample.id} 未命中（应为 ${sample.expectedAppId}）`).not.toEqual(null);
        expect(String(r.appId), `${sample.id} 错配`).toEqual(String(sample.expectedAppId));
      } finally {
        restore();
      }
    });
  }
});
