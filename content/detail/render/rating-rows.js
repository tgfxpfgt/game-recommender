/**
 * 游戏雷达 Game Radar - 评分区块渲染器 / Rating Row Renderers
 *
 * v14.5.0 B6：由 detail-templates.js steamSidebar 拆出——四重评价行
 * （Steam 总体/最近30天/简体中文/SteamSpy）与综合推荐理由行的纯 HTML 构建。
 * 颜色走 shared/patterns.js 单源（ratingColorFor/ratingBgFor）。
 * Row builders split from steamSidebar (B6): the four rating rows and the
 * composite-verdict row as pure HTML builders; colors via patterns single source.
 */
import * as common from '../../core/common.js';

const esc = (text) => common.escapeHtml(text);

/**
 * 四重评价行（Steam总体/最近30天/简体中文/SteamSpy——有值才渲染）
 * @param {Object} data - Steam 详情数据（positiveRate/recentPositiveRate/cnPositiveRate/steamspy…）
 * @param {Object|null} spy - SteamSpy 子对象
 * @returns {string} HTML
 */
export function renderRatingRows(data, spy) {
  const P2 = globalThis.__GR_PATTERNS__ || {};
  const colorOf = (v) =>
    P2.ratingColorFor ? P2.ratingColorFor(v) : v >= 80 ? '#66c0f4' : v >= 60 ? '#a3cf06' : '#ff7b00';
  const fmt = (n) => (n === null || n === undefined ? 0 : Number(n).toLocaleString());
  // v14.6.2 修复（审查 B4）：rate 数值归一化后入模板——异型缓存条目
  //（positiveRate 为字符串）曾是注入点，与同文件 fmt() 的 Number 防线对齐
  const num = (v) => (v === null || v === undefined ? 0 : Number(v) || 0);
  const row = (label, desc, rate, total, color) =>
    '<div class="gr-detail-rate-row">' +
    '<div class="gr-detail-rate-head">' +
    '<span class="gr-detail-rate-label">' +
    label +
    '</span>' +
    '<span class="gr-detail-rate-desc" style="color:' +
    color +
    '">' +
    esc(desc) +
    '</span>' +
    '</div>' +
    '<div class="gr-detail-rate-bar"><div class="gr-detail-rate-fill" style="width:' +
    Math.max(0, Math.min(100, num(rate))) +
    '%;background:' +
    color +
    '"></div></div>' +
    '<div class="gr-detail-rate-num">' +
    num(rate) +
    '% · ' +
    fmt(total) +
    ' 条评测</div>' +
    '</div>';
  let html = '';
  if (data.positiveRate !== null && data.positiveRate !== undefined) {
    html += row(
      'Steam 总体',
      data.ratingDesc || data.positiveRate + '% 好评',
      data.positiveRate,
      data.totalReviews || 0,
      colorOf(data.positiveRate)
    );
  }
  if (data.recentPositiveRate !== null && data.recentPositiveRate !== undefined) {
    html += row(
      '🕒 最近 30 天',
      data.recentPositiveRate + '% 好评',
      data.recentPositiveRate,
      data.recentTotalReviews || 0,
      colorOf(data.recentPositiveRate)
    );
  }
  if (data.cnPositiveRate !== null && data.cnPositiveRate !== undefined) {
    html += row(
      '🇨🇳 简体中文',
      data.cnRatingDesc || data.cnPositiveRate + '% 好评',
      data.cnPositiveRate,
      data.cnTotalReviews || 0,
      colorOf(data.cnPositiveRate)
    );
  }
  if (spy && spy.positiveRate !== null && spy.positiveRate !== undefined) {
    html += row('📊 SteamSpy', spy.positiveRate + '% 好评', spy.positiveRate, spy.reviewCount || 0, '#67c1f5');
  }
  return html;
}

/**
 * 综合推荐理由行（v4.1.0：好评率 70% + 中文 30% 口径 + 热度/时长因子，与推荐引擎同源）
 * @param {Object} data - Steam 详情数据
 * @param {Object|null} spy - SteamSpy 子对象（热度/时长展示用）
 * @param {() => string} spyHeatLabel - 热度等级（heatLabelFor 柯里化，与内嵌卡同口径）
 * @returns {string} HTML
 */
export function renderVerdictRow(data, spy, spyHeatLabel) {
  let s = 0.4; // 无好评率中性值（对齐引擎 steamScore）
  if (data.positiveRate !== null && data.positiveRate !== undefined) {
    s = Math.min((data.positiveRate / 100) * 0.7 + (data.chineseSupported ? 0.3 : 0), 1);
  }
  // v14.6.2 修复（审查 B4）：外部数据字段（positiveRate/heat/playtime）一律
  // esc 后入模板——异型缓存曾是注入点（同文件 row() 的 esc 防线对齐）
  const parts = [];
  if (data.positiveRate !== null && data.positiveRate !== undefined) {
    parts.push(`好评率 ${esc(String(data.positiveRate))}%`);
  }
  parts.push(data.chineseSupported ? '中文支持' : '暂无中文');
  const heat = spyHeatLabel();
  if (heat) parts.push(`热度 ${esc(String(heat))}`);
  if (spy && spy.averagePlaytime) parts.push(`平均时长 ${esc(String(spy.averagePlaytime))}`);
  return `<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);font-size:11px;color:#acb2b8;">综合推荐 <span class="gr-detail-blue">${Math.round(s * 100)}%</span><span style="color:#8f98a0;">（${parts.join(' · ')}）</span></div>`;
}
