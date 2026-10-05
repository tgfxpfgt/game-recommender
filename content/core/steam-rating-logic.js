/**
 * 游戏雷达 Game Radar - Steam 评分口径单源 / Steam Rating Logic (single source)
 *
 * v10.7.0 批次1：由 detail-templates.js 下沉——修正口碑/结论文案/评级文案/
 * 销量热度四个纯函数是列表徽章与详情浮窗**共用**的评分口径，此前寄居在
 * 详情页模板文件里导致 content/list 反向 import content/detail 跨层耦合。
 * 此处只放纯逻辑（可独立单测），模板留在 detail-templates.js。
 * Pure scoring helpers sunk from detail-templates.js (v10.7.0): shared by
 * list badges and the detail float; templates stay in detail-templates.js.
 */
import { SPY_SCALES } from '../../shared/spy-scales.js'; // v14.2.0：刻度单源（原字面量 /7 与 engine 分裂，补充轮 P1-2）

// Steam 评级描述 → 中短文案 + 三档情感（XDGame 同口径）
// Steam review desc → short CN text + 3-band sentiment (XDGame semantics)
const RATING_TEXT_MAP = {
  'Overwhelmingly Positive': ['好评如潮', 'positive'],
  'Very Positive': ['特别好评', 'positive'],
  Positive: ['好评', 'positive'],
  'Mostly Positive': ['多半好评', 'positive'],
  Mixed: ['褒贬不一', 'mixed'],
  'Mostly Negative': ['多半差评', 'negative'],
  Negative: ['差评', 'negative'],
  'Very Negative': ['特别差评', 'negative'],
  'Overwhelmingly Negative': ['差评如潮', 'negative'],
  // 中文描述直通（键与值同文）/ Chinese descs passthrough
  好评如潮: ['好评如潮', 'positive'],
  特别好评: ['特别好评', 'positive'],
  好评: ['好评', 'positive'],
  多半好评: ['多半好评', 'positive'],
  褒贬不一: ['褒贬不一', 'mixed'],
  多半差评: ['多半差评', 'negative'],
  差评: ['差评', 'negative'],
  特别差评: ['特别差评', 'negative'],
  差评如潮: ['差评如潮', 'negative']
};

// 销量热度等级（owners 区间中点对数 ÷ salesLogDivisor：<35% 冷门、≥35% 一般、
// ≥60% 热门、≥85% 爆款）——浮窗 SteamSpy 面板与 v10.5.3 内嵌信息区共用
// Sales heat grade from the owners midpoint (log10/divisor), shared by the
// float's SteamSpy panel and the v10.5.3 inline info section.
export function heatLabelFor(spy) {
  if (!spy || typeof spy.ownersLow !== 'number' || typeof spy.ownersHigh !== 'number' || spy.ownersHigh <= 0) return '';
  const mid = (spy.ownersLow + spy.ownersHigh) / 2;
  const h = Math.min(Math.log10(mid) / SPY_SCALES.salesLogDivisor, 1);
  return h >= 0.85 ? '爆款' : h >= 0.6 ? '热门' : h >= 0.35 ? '一般' : '冷门';
}

/**
 * 评级文案（XDGame 同口径）
 * @param {string} desc - Steam ratingDesc（英文或中文）
 * @param {number} positiveRate - 好评率（0-100）
 * @returns {{text: string, sentiment: 'positive'|'mixed'|'negative'}}
 */
export function ratingTextInfo(desc, positiveRate) {
  const hit = RATING_TEXT_MAP[String(desc || '').trim()];
  if (hit) return { text: hit[0], sentiment: hit[1] };
  // Steam 少量评测特例（"1 user review(s)" 等）——XDGame 同口径按褒贬不一
  if (/user reviews?$/i.test(String(desc || ''))) return { text: '褒贬不一', sentiment: 'mixed' };
  if (typeof positiveRate !== 'number') return { text: '玩家评价', sentiment: 'positive' };
  if (positiveRate >= 70) return { text: `${Math.round(positiveRate)}% 好评`, sentiment: 'positive' };
  if (positiveRate >= 40) return { text: `${Math.round(positiveRate)}% 好评`, sentiment: 'mixed' };
  return { text: `${Math.round(positiveRate)}% 差评`, sentiment: 'negative' };
}

/**
 * 修正口碑（XDGame「修正口碑」口径）：好评率向 50% 贝叶斯收缩，伪计数随
 * 样本量次线性增长 m = max(1.52·total^0.655, 4.3)。参数按 XDGame 线上接口
 * （/plus/steam_review_summary.php）7 组真实样本回归校准，各点误差 ≤0.2pp
 * （含 total=1 单评测、total≈9.7k 大样本两端）。
 * Bayesian-shrunk positive rate ("adjusted reputation"), calibrated against
 * XDGame's live endpoint (max error 0.2pp across 7 observed samples).
 * @param {number} positive - 好评条数
 * @param {number} total - 评测总数
 * @returns {number|null} 修正口碑（0-100，一位小数）；参数无效返回 null
 */
export function adjustedReputation(positive, total) {
  if (typeof positive !== 'number' || typeof total !== 'number' || total <= 0) return null;
  const raw = Math.min(Math.max(positive / total, 0), 1);
  const m = Math.max(1.52 * Math.pow(total, 0.655), 4.3);
  const adj = 0.5 + (raw - 0.5) * (total / (total + m));
  return Math.round(Math.min(Math.max(adj, 0), 1) * 1000) / 10;
}

/**
 * 结论文案：按四舍五入后的修正口碑分档（阈值经 XDGame 线上 45 组样本验证：
 * 89.9→极高 / 89.2→出色 / 74.6→很好 / 74→不错 / 64.2→尚可 / 48.7→分歧）。
 * <40 站内无差评样本，措辞按其文案风格拟定。
 * Verdict text banded on the rounded adjusted percent (XDGame thresholds).
 * @param {number} adjustedPercent - 修正口碑（0-100）
 * @returns {string}
 */
export function verdictFor(adjustedPercent) {
  const a = Math.round(adjustedPercent);
  if (a >= 90) return '玩家认可度极高，值得优先体验';
  if (a >= 85) return '口碑表现出色，推荐下载体验';
  if (a >= 75) return '整体口碑很好，值得下载体验';
  if (a >= 65) return '整体表现不错，感兴趣可以尝试';
  if (a >= 50) return '口碑尚可，建议结合玩法判断';
  if (a >= 40) return '玩家评价分歧较大，建议先了解内容';
  return '口碑较差，请谨慎选择';
}
