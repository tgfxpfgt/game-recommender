/**
 * 游戏雷达 Game Radar - Steam 搜索共识裁决 / Search consensus
 *
 * v14.27.0（优化方案 P2-10）：自 steam/api-search.js 拆出——跨词共识的终选
 * 策略（同一 appId 被多个搜索词各自命中为该词最优 → 每多一词 +2，封顶 +4）。
 * 纯函数、无 IO，便于单测；候选收集仍在 search-candidates.js。
 * Pure consensus winner selection split out of api-search.js (P2-10).
 */

export const CONSENSUS_BONUS_PER_TERM = 2;
export const CONSENSUS_MAX_TERMS = 3; // 共识词数封顶（加成上限 = (3-1)*2 = 4）

/**
 * 在多词命中与全局最高分之间裁决最终候选。
 * Pick the final candidate between per-term hits (with consensus bonus) and
 * the global best score. Ties prefer more consensus terms.
 * @param {{appId: string|number, name: string, score: number}} globalBest
 * @param {Map<string, {appId: string|number, name: string, score: number, terms: number}>} termHits
 * @returns {{appId: string|number, name: string, score: number, terms: number}}
 */
export function pickConsensusWinner(globalBest, termHits) {
  let winner = { appId: globalBest.appId, name: globalBest.name, score: globalBest.score, terms: 1 };
  let winnerTotal = winner.score;
  for (const h of termHits.values()) {
    const total = h.score + (Math.min(h.terms, CONSENSUS_MAX_TERMS) - 1) * CONSENSUS_BONUS_PER_TERM;
    if (total > winnerTotal || (total === winnerTotal && h.terms > winner.terms)) {
      winner = h;
      winnerTotal = total;
    }
  }
  return winner;
}
