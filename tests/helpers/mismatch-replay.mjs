/**
 * 游戏雷达 Game Radar - 回放运行器（参数化）/ Parameterized Mismatch Replay
 *
 * v14.8 批次 2（R2 回放门·CI 侧全量）：错题库回放按**给定词表覆盖**重放——
 * 规则包词表变更后跑一遍，命中变差即拒绝（保序语义/新增词过度清洗的唯一
 * 全量验证；SW 内无法拦截 fetch，本运行器只在 vitest 语境可用）。
 * v14.8 批次 15：多源（错题库 + 三站第一页基准 + wrong-report 入册文件）+
 * Top-N 挑选（最难错的排前）+ 未命中样本改进度量。
 * 用法（规则包作者自验 / 更新后检验）：
 *   const r = await runMismatchReplay({ vocabOverride, topN: 10 });
 * Parameterized multi-source replay with Top-N picking (most error-prone
 * first) and miss-improvement semantics for null-expected samples.
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
const BASELINE_PATH = new URL('../fixtures/baseline-firstpage.json', import.meta.url);
// 第三源（可选）：dashboard 导出的错题样本人工入册文件——保存为
// tests/fixtures/wrong-report-samples.json 即自动并入 Top-N 池
const WRONG_SAMPLES_PATH = new URL('../fixtures/wrong-report-samples.json', import.meta.url);

/** 多源装载（缺失源跳过）/ Load all sample sources (missing ones skipped). */
function loadSamples() {
  const out = [];
  const push = (path, source) => {
    try {
      const d = JSON.parse(readFileSync(path, 'utf-8'));
      for (const s of d.samples || []) {
        if (s.skipVerify) continue; // 搜索路径不可判定样本（元素直取可达）
        out.push({ ...s, source });
      }
    } catch {
      /* 源缺失跳过 */
    }
  };
  push(SAMPLES_PATH, 'mismatch');
  push(BASELINE_PATH, 'baseline');
  push(WRONG_SAMPLES_PATH, 'wrong-report');
  return out;
}

/**
 * Top-N 挑选（最容易错的排前）：人工纠正 3 分 > 未命中 2 分 > 其余 1 分，
 * 同分按录制词数（现场复杂度）降序。
 * Pick the N most error-prone samples (user-corrected > miss > rest).
 * @param {Array<any>} pool
 * @param {number} n
 */
export function pickTopN(pool, n = 10) {
  const score = (s) => {
    if ((s.note || '').includes('手动确认')) return 3;
    if (s.kind === 'miss' || s.expectedAppId == null) return 2;
    return 1;
  };
  return [...pool]
    .sort((a, b) => score(b) - score(a) || Object.keys(b.recorded || {}).length - Object.keys(a.recorded || {}).length)
    .slice(0, n);
}

/**
 * @param {{id: string, rawTitle?: string, cleanTitle?: string, recordedTerms?: string[], recorded: Record<string, any>, expectedAppId: string|null, kind?: string}} sample
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
    // 未命中样本（expectedAppId null）= 改进度量非硬门槛——got 非 null 即
    // "现在找到了"（改进 ok），仍 null = 中性 ok
    if (sample.expectedAppId == null) {
      return { id: sample.id, ok: true, got, expected: 'miss(改进度量)' };
    }
    return { id: sample.id, ok: got === String(sample.expectedAppId), got, expected: String(sample.expectedAppId) };
  } finally {
    restore();
  }
}

/**
 * 按词表覆盖重放错题样本。override 应用失败/回放回退均不计入通过。
 * @param {{vocabOverride?: any, topN?: number}} [opts] - topN>0 时只跑最容易
 *   错的前 N 条（默认 0 = 全量三源）
 * @returns {Promise<{allOk: boolean, results: Array<{id: string, ok: boolean, got: string|null, expected: string}>, applyErrors?: string[]}>}
 */
export async function runMismatchReplay(opts = {}) {
  let applyErrors;
  if (opts.vocabOverride) {
    applyErrors = vocab.applyVocabOverride(opts.vocabOverride);
    api.reloadRetrievalRules();
  }
  storage._reset();
  const all = loadSamples();
  const chosen = opts.topN && opts.topN > 0 ? pickTopN(all, opts.topN) : all;
  const results = [];
  for (const sample of chosen) {
    results.push(await replayOne(sample));
  }
  if (opts.vocabOverride) {
    vocab.resetVocabOverride();
    api.reloadRetrievalRules();
  }
  return { allOk: results.every((r) => r.ok) && (!applyErrors || applyErrors.length === 0), results, applyErrors };
}
