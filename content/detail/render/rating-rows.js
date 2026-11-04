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
  // v14.10.1（用户需求：浮窗同样显示没有评价信息的原因）：positiveRate null
  // 时不再整行消失——灰色"Steam 总体"行显示 Steam 官方语义原因
  //（需要更多用户评测来生成整体评价 / 无用户评测）+ 评测数 + 发售日期
  if (data.positiveRate === null || data.positiveRate === undefined) {
    const total = num(data.totalReviews);
    const reason = data.ratingDesc ? esc(String(data.ratingDesc)) : '暂无评测';
    const rel = data.releaseDate ? ` · 发售于 ${esc(String(data.releaseDate))}` : '';
    html +=
      '<div class="gr-detail-rate-row">' +
      '<div class="gr-detail-rate-head">' +
      '<span class="gr-detail-rate-label">Steam 总体</span>' +
      '<span class="gr-detail-rate-desc" style="color:#8f98a0">' +
      reason +
      '</span>' +
      '</div>' +
      '<div class="gr-detail-rate-bar"><div class="gr-detail-rate-fill" style="width:0;background:#555"></div></div>' +
      '<div class="gr-detail-rate-num">' +
      (total > 0 ? `共 ${fmt(total)} 条评测 · 不足 10 篇暂无整体评价` : '暂无用户评测') +
      rel +
      '</div>' +
      '</div>';
  }
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
    // v14.13 B10（报告 C P3-07 口径文档化）：30 天率基于最新 100 条评测自算
    //（appreviews filter=recent），热门游戏与官方 30 天聚合略有偏差
    html += row(
      '🕒 最近 30 天',
      data.recentPositiveRate + '% 好评（近 100 条评测口径）',
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
  // v14.15.0 N1：好评率走势迷你图——history ≥2 点才渲染（数据积累型，缓存
  // 每次成功重取追加一点；evictOldestByTs 30 点上限）。
  // Trend sparkline: rendered only with ≥2 accumulated history points.
  const history = Array.isArray(data.ratingHistory) ? data.ratingHistory : [];
  if (history.length >= 2) {
    html += buildSparklineSvg(history);
  }
  return html;
}

/**
 * 走势 SVG 生成（v14.15.0 N1 纯函数）：60×22 viewBox polyline，x 均分、
 * y 按历史 min-max 归一（全同值时居中）；点数 2-30。
 * @param {Array<{t: number, r: number}>} history - 时间升序点列（r=好评率 0-100）
 * @returns {string} SVG HTML（空历史返回 ''）
 */
export function buildSparklineSvg(history) {
  const pts = (Array.isArray(history) ? history : [])
    .filter((p) => p && Number.isFinite(Number(p.r)))
    .map((p) => ({ t: Number(p.t) || 0, r: Number(p.r) }));
  if (pts.length < 2) return '';
  const W = 60;
  const H = 22;
  const rates = pts.map((p) => p.r);
  const min = Math.min(...rates);
  const max = Math.max(...rates);
  const span = max - min || 1; // 全同值 → 居中
  const coords = pts.map((p, i) => {
    const x = pts.length === 1 ? W / 2 : (i / (pts.length - 1)) * W;
    const y = H - 2 - ((p.r - min) / span) * (H - 4);
    return x.toFixed(1) + ',' + y.toFixed(1);
  });
  const last = rates[rates.length - 1];
  return (
    '<div class="gr-detail-rate-row"><div class="gr-detail-rate-head">' +
    '<span class="gr-detail-rate-label">📈 走势</span>' +
    '<span class="gr-detail-rate-desc" style="color:#8f98a0">' +
    '近 ' +
    pts.length +
    ' 次记录 ' +
    min +
    '-' +
    max +
    '%</span></div>' +
    '<svg width="' +
    W +
    '" height="' +
    H +
    '" viewBox="0 0 ' +
    W +
    ' ' +
    H +
    '" style="width:100%;height:22px;" ' +
    'aria-hidden="true"><polyline points="' +
    coords.join(' ') +
    '" fill="none" stroke="#66c0f4" stroke-width="1.5" ' +
    'points-data-last="' +
    last +
    '"/></svg></div>'
  );
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
