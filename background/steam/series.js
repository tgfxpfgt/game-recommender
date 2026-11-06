// @ts-strict
/**
 * 游戏雷达 Game Radar - 系列作品聚合 / Series Aggregation
 *
 * v14.16.0（功能报告 N10）：浮窗"系列作品"行数据面——名称索引（用户积累的
 * 本地字典）中与基准名共享核心词、且序号集合不同的条目（前作/续作/衍生）。
 * 放 steam 层（api-search 词法 + name-index 数据）遵守分层矩阵；纯读取
 *（有界内存遍历，零 IO/零网络），上限 6 条。
 * Aggregates series entries from the learned name index; pure read, bounded.
 */
import { getNameIndexSnapshot } from '../storage/name-index.js';
import { coreTokensOf, seqNumsOf } from './api-search.js';

const SERIES_MAX = 6;

/**
 * 聚合与基准名同系列的其他条目。
 * @param {string} baseName - 当前浮窗游戏名
 * @param {string|number|null} [excludeAppId] - 基准自身
 * @returns {Promise<Array<{name: string, appId: string}>>}
 */
export async function getSeriesEntries(baseName, excludeAppId) {
  const base = String(baseName || '').trim();
  if (!base) return [];
  const snapshot = await getNameIndexSnapshot();
  const baseTokens = coreTokensOf(base).filter((w) => (/^[a-z]/.test(w) ? w.length >= 3 : w.length >= 2));
  if (baseTokens.length === 0) return [];
  const baseSeq = seqNumsOf(base);
  const baseDeSpaced = base.replace(/\s|\||-|:|：|、|·/g, '');
  const out = [];
  for (const [name, entry] of Object.entries(snapshot)) {
    if (!entry || entry.appId === null || entry.appId === undefined) continue;
    if (excludeAppId != null && String(entry.appId) === String(excludeAppId)) continue;
    if (name.toLowerCase() === base.toLowerCase()) continue;
    const tokens = coreTokensOf(name).filter((w) => (/^[a-z]/.test(w) ? w.length >= 3 : w.length >= 2));
    // 覆盖判据：候选核心词全部出现在基准名中（共享前作核心词）；序号集合
    // 不同 = 前作/续作（相同则为同名异写，跳过）
    if (tokens.length === 0) continue;
    let covered = true;
    for (const w of tokens) {
      if (baseDeSpaced.indexOf(w) < 0) {
        covered = false;
        break;
      }
    }
    if (!covered) continue;
    const seq = seqNumsOf(name);
    // 序号语义：baseSeq=[2]、cand=[]（前作无号）——空集与非空集视为不同
    //（前作形态）；同号同长为同名异写跳过
    const sameSeq =
      baseSeq.length === seq.length && baseSeq.length === 0
        ? true
        : baseSeq.length === seq.length && baseSeq.every((x) => seq.includes(x));
    if (sameSeq && name.length === base.length) continue;
    out.push({ name, appId: String(entry.appId) });
    if (out.length >= SERIES_MAX) break;
  }
  return out;
}
