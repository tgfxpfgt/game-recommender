// @ts-strict
/**
 * 游戏雷达 Game Radar - 错题样本采集 / Mismatch Sample Capture
 *
 * v14.8 批次 3：用户手动确认正确 appId（候选浮窗选择/报错纠正）时自动采集
 * 检索现场——rawTitle + 逐词 storesearch 命中快照（按错题库 fixtures 格式），
 * 写入 wrongReportSamples 存储（FIFO 上限 20 条）。dashboard 错题库卡一键
 * 复制 JSON，人工审后并入 tests/fixtures/mismatch-samples.json → 回放门防
 * 回归（采集→入册→防回归闭环的采集端）。
 * Auto-capture on user confirmation: rawTitle + per-term storesearch snapshot
 * (mismatch-fixture format), FIFO cap 20; dashboard card copies the JSON.
 */

import { dataStore } from '../../data/data-store.js';
import { DB_KEYS, ENDPOINTS } from '../core/constants.js';
import { parseGameTitle } from '../core/title-parser.js';
import { fetchWithTimeout } from '../core/utils.js';
import { Logger } from '../storage/logger.js';

const SAMPLES_CAP = 20; // FIFO 上限（错题样本是高价值小数据）
const TERMS_CAP = 8; // 单样本采集词上限（防超长标题刷请求）

/** @returns {Promise<Array<any>>} */
async function readSamples() {
  try {
    const stored = await dataStore.readModule(DB_KEYS.WRONG_REPORT_SAMPLES);
    return Array.isArray(stored && stored.samples) ? stored.samples : [];
  } catch {
    return [];
  }
}

/** @param {Array<any>} samples */
async function writeSamples(samples) {
  try {
    await dataStore.writeModule(DB_KEYS.WRONG_REPORT_SAMPLES, {
      v: 1,
      updatedAt: Date.now(),
      samples: samples.slice(0, SAMPLES_CAP)
    });
  } catch (e) {
    Logger.warn('MismatchSamples', `错题样本写入失败: ${String(e).slice(0, 120)}`);
  }
}

/** 列出已采集样本（dashboard 卡消费）/ List captured samples. */
export async function getWrongReportSamples() {
  return { samples: await readSamples() };
}

/** 清空已采集样本（并入册后清理用）/ Clear captured samples. */
export async function clearWrongReportSamples() {
  await writeSamples([]);
  return { success: true };
}

/**
 * 采集一次错题现场（fire-and-forget——失败静默，绝不影响确认主流程）。
 * Capture one mismatch scene; failures are silent (never blocks the confirm).
 * @param {{gameName?: string, rawTitle?: string, correctAppId?: string|number}} scene
 */
export async function captureMismatchSample(scene) {
  try {
    const rawTitle = String(scene.rawTitle || '').slice(0, 300);
    const appId = String(scene.correctAppId || '');
    if (!rawTitle || !appId) return { captured: false, reason: 'missing-fields' };
    const samples = await readSamples();
    // 去重：同一 rawTitle+appId 已采集过则跳过（重复确认不重复采集）
    if (samples.some((s) => s.rawTitle === rawTitle && s.expectedAppId === appId)) {
      return { captured: false, reason: 'duplicate' };
    }
    const terms = parseGameTitle(rawTitle).slice(0, TERMS_CAP);
    /** @type {Record<string, any>} */
    const recorded = {};
    for (const term of terms) {
      try {
        const resp = await fetchWithTimeout(
          `${ENDPOINTS.steamSearch}?term=${encodeURIComponent(term)}&l=schinese&cc=cn`
        );
        recorded[term] = await resp.json();
      } catch {
        recorded[term] = { total: 0, items: [] }; // 失败按空记录（回放语义一致）
      }
    }
    samples.unshift({
      id: `manual-${appId}-${Date.now().toString(36)}`,
      rawTitle,
      expectedAppId: appId,
      expectedName: '',
      note: '用户手动确认自动采集',
      recorded
    });
    await writeSamples(samples);
    Logger.info('MismatchSamples', `错题样本已采集: "${rawTitle.slice(0, 40)}" → ${appId}`);
    return { captured: true };
  } catch (e) {
    Logger.warn('MismatchSamples', `错题样本采集失败（静默）: ${String(e).slice(0, 120)}`);
    return { captured: false, reason: String(e) };
  }
}
