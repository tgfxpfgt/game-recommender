/**
 * 游戏雷达 Game Radar - 内嵌 Steam 信息卡模板 / Inline Steam Card HTML
 *
 * v10.5.3 任务1：内嵌 Steam 信息区（1:1 复刻 XDGame）。用户反馈首版信息卡
 * 与 XDGame 原生「Steam 玩家评价」区不一致——本模板与 XDGame 详情页完全一致：
 * 相同 HTML 结构（steam-review-card 及全部子元素 /data-steam-* 属性）、相同
 * 数据口径：
 *   · 综合评分 = 修正口碑 / 10（一位小数）
 *   · 修正口碑 = 好评率经贝叶斯收缩（伪计数 m=1.52·total^0.655，下限 4.3，
 *     参数经 XDGame 线上接口 7 组真实样本回归校准，各点误差 ≤0.2pp）
 *   · 评级文本 = Steam 官方描述（英文 language=all 返回值映射中文）
 *   · 结论文案 = 按四舍五入后的修正口碑分档（≥90/≥85/≥75/≥65/≥50/≥40）
 * 无评测（total=0）不渲染——与 XDGame 卡片无数据时隐藏一致。注入与站点门控
 * 见 render/inline-card.js（v14.5.0 B6 迁至 render/）。
 * Inline Steam card markup (v10.5.3): pixel-faithful replica of XDGame's
 * native "Steam 玩家评价" card — same markup and data semantics. Hidden when
 * there are no reviews, exactly like the original. Mount + site gate live in
 * render/inline-card.js (moved in B6).
 */
import * as common from '../../core/common.js';
import { adjustedReputation, ratingTextInfo, verdictFor } from '../../core/steam-rating-logic.js';

const esc = (text) => common.escapeHtml(text);

/**
 * 内嵌 Steam 信息区模板（与 XDGame 原生卡片完全一致，值在渲染时预填充，
 * 保留其 data-steam-* 属性名以保持结构同构）。
 * Inline Steam card markup, a 1:1 replica of XDGame's native card with
 * values pre-filled (data-steam-* attributes kept for structural parity).
 * @param {Object} data - Steam 详情缓存（totalReviews/positiveRate/
 *   positiveReviews/negativeReviews/ratingDesc/appId）
 * @param {number} [cachedAt] - 缓存时间戳（ms）——「数据更新于」行
 * @returns {string} HTML；无评测数据返回空串（不注入）
 */
export function steamInlineSection(data, cachedAt) {
  if (!data) return '';
  // 与 XDGame 一致：无评测（total<=0）不展示 / no reviews → no card
  const total = typeof data.totalReviews === 'number' ? data.totalReviews : 0;
  if (total <= 0) return '';
  // 好评条数：新版缓存直取；旧缓存缺失时按整数好评率近似回退
  let positive = typeof data.positiveReviews === 'number' ? data.positiveReviews : null;
  if (positive === null && typeof data.positiveRate === 'number') {
    positive = Math.round((data.positiveRate / 100) * total);
  }
  if (positive === null || positive < 0) return '';

  const rawPercent = Math.min(Math.max((positive / total) * 100, 0), 100);
  const adjusted = adjustedReputation(positive, total);
  if (adjusted === null) return '';
  const score = (adjusted / 10).toFixed(1); // 综合评分 = 修正口碑/10
  const verdict = verdictFor(adjusted);
  const { text: ratingText, sentiment } = ratingTextInfo(data.ratingDesc, data.positiveRate);
  const levelIcon = sentiment === 'negative' ? 'fa-thumbs-down' : sentiment === 'mixed' ? 'fa-adjust' : 'fa-thumbs-up';
  const fmt = (n) => Number(n).toLocaleString('zh-CN'); // 千分位，XDGame formatNumber 同款

  // 「数据更新于 YYYY-MM-DD」（本地时区）；无时间戳则省略该行（XDGame 为 hidden）
  let updatedHtml = '';
  const d = cachedAt ? new Date(cachedAt) : null;
  if (d && !isNaN(d.getTime())) {
    const pad = (n) => String(n).padStart(2, '0');
    updatedHtml = `<small data-steam-updated>数据更新于 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}</small>`;
  }

  return `
    <section class="steam-review-card" data-steam-appid="${common.escapeAttr(String(data.appId || ''))}" aria-label="Steam 玩家评价">
      <div class="steam-review-overview">
        <div class="steam-review-heading">
          <span class="steam-review-icon fa fa-steam" aria-hidden="true"></span>
          <span><strong>Steam 玩家评价</strong><small>玩家评价统计</small></span>
        </div>
        <span class="steam-review-level is-${sentiment}" data-steam-level-wrap><i class="fa ${levelIcon}" data-steam-level-icon aria-hidden="true"></i><strong data-steam-rating-text>${esc(ratingText)}</strong></span>
      </div>
      <div class="steam-review-detail">
        <div class="steam-review-primary">
          <span class="steam-review-final-score"><strong data-steam-score>${score}</strong><span><b>/10</b><small>综合评分</small></span></span>
          <p class="steam-review-rate"><span>Steam 好评率 <b data-steam-raw>${rawPercent.toFixed(1)}%</b></span><span>· <b data-steam-total>${fmt(total)}</b> 条评价</span></p>
          ${updatedHtml}
        </div>
        <div class="steam-review-judgment">
          <p class="steam-review-verdict" data-steam-verdict>${esc(verdict)}</p>
          <div class="steam-review-meter" role="meter" aria-label="综合口碑" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${adjusted.toFixed(1)}" aria-valuetext="综合口碑 ${adjusted.toFixed(1)}%"><span data-steam-positive-bar style="width:${adjusted.toFixed(1)}%"></span></div>
          <p class="steam-review-meta"><span>好评 <b class="is-positive" data-steam-positive>${fmt(positive)}</b></span><span>差评 <b class="is-negative" data-steam-negative>${fmt(Math.max(total - positive, 0))}</b></span><span>修正口碑 <b data-steam-adjusted>${adjusted.toFixed(1)}%</b></span></p>
          <div id="gr-steam250-inline" style="display:none;margin-top:6px;font-size:12px;color:#7c8999;line-height:20px;"></div>
        </div>
      </div>
    </section>`;
}
