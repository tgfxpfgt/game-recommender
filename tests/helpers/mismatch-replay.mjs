/**
 * 游戏雷达 Game Radar - 回放运行器（参数化）/ Parameterized Mismatch Replay
 *
 * v14.8 批次 2（R2 回放门·CI 侧全量）：错题库回放按**给定词表覆盖**重放——
 * 规则包词表变更后跑一遍，命中变差即拒绝（保序语义/新增词过度清洗的唯一
 * 全量验证；SW 内无法拦截 fetch，本运行器只在 vitest 语境可用）。
 * 用法（规则包作者自验）：
 *   const results = await runMismatchReplay({ vocabOverride: pack.retrievalVocab });
 *   // results.every(r => r.ok) 为 false 的样本即回退理由
 * Parameterized replay: replays the mismatch samples under a vocab override;
 * any regression = reject the pack (full replay gate, CI-only).
 */
import { readFileSync } from 'node:fs';
import { createStorageMock, installChromeStorageMock } from './storage-mock.mjs';
import { installFetchMock } from './fetch-mock.mjs';

await import('../../shared/escape.js');
const storage = createStorageMock();
installChromeStorageMock(storage);
globalThis.window = globalThis.window || {};
globalThis.location = globalThis.location || { href: 'http://test/', search: '', origin: 'http://test' };
globalThis.chrome = globalThis.chrome || { runtime: { getManifest: () => ({ version: '0-test' }) } };

const { parseGameTitle } = await import('../../background/core/title-parser.js');
const api = await import('../../background/steam/api-search.js');
const vocab = await import('../../shared/retrieval-vocab.js');

const SAMPLES_PATH = new URL('../fixtures/mismatch-samples.json', import.meta.url);
const samples = JSON.parse(readFileSync(SAMPLES_PATH, 'utf-8'));

/**
 * @param {{id: string, rawTitle?: string, cleanTitle?: string, recordedTerms?: string[], recorded: Record<string, any>, expectedAppId: string}} sample
 * @returns {Promise<{id: string, ok: boolean, got: string|null, expected: string}>}
 */
async function replayOne(sample) {
  const recorded = sample.recorded || {};
  const restore = installFetchMock(async (url) => {
    const u = decodeURIComponent(String(url));
    const m = u.match(/term=([^&]+)/);
    const term = m ? m[1] : '';
    const hit = recorded[term];
    const payload = hit || { total: 0, items: [] };
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  });
  try {
    const terms =
      sample.recordedTerms && sample.recordedTerms.length > 0
        ? sample.recordedTerms
        : parseGameTitle(sample.cleanTitle || sample.rawTitle);
    const r = await api.searchSteamAppId(terms, sample.rawTitle, null);
    const got = r ? String(r.appId) : null;
    return { id: sample.id, ok: got === String(sample.expectedAppId), got, expected: String(sample.expectedAppId) };
  } finally {
    restore();
  }
}

/**
 * 按词表覆盖重放全部错题样本。override 应用失败/回放回退均不计入通过。
 * Replay all samples under a vocab override (applied then reset).
 * @param {{vocabOverride?: any}} [opts]
 * @returns {Promise<{allOk: boolean, results: Array<{id: string, ok: boolean, got: string|null, expected: string}>, applyErrors?: string[]}>}
 */
export async function runMismatchReplay(opts = {}) {
  let applyErrors;
  if (opts.vocabOverride) {
    applyErrors = vocab.applyVocabOverride(opts.vocabOverride);
    api.reloadRetrievalRules();
  }
  storage._reset();
  const results = [];
  for (const sample of samples.samples) {
    results.push(await replayOne(sample));
  }
  if (opts.vocabOverride) {
    vocab.resetVocabOverride();
    api.reloadRetrievalRules();
  }
  return { allOk: results.every((r) => r.ok) && (!applyErrors || applyErrors.length === 0), results, applyErrors };
}
