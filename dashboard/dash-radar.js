/**
 * 游戏雷达 Game Radar - Dashboard 画像雷达（第九轮 B3）/ Profile Radar
 *
 * v14.8 批次 9：Top8 游戏画像五维雷达（零依赖 SVG，与趋势图同风格）。
 * 维度=画像真实数据归一化：下载 / 查看 / 转化率（下载÷查看）/ Steam 评分
 *（/100）/ 关键词数。纯函数 renderProfileRadarSvg（单测直驱）+ 挂载包装。
 * Top-8 five-axis radar from real profile data (zero-dependency SVG).
 * 经典脚本（跨文件全局作用域，同 dash-stats/dash-diagnostics 约定）。
 */

// @ts-nocheck - classic script
const RADAR_AXES = [
  { key: 'downloads', label: '下载' },
  { key: 'views', label: '查看' },
  { key: 'conversion', label: '转化率' },
  { key: 'rating', label: '评分' },
  { key: 'keywords', label: '关键词' }
];
const RADAR_COLORS = ['#66c0f4', '#a3cf06', '#ff7b00', '#b48ce0', '#e74c3c', '#2ecc71', '#f39c12', '#8f98a0'];

/** 单游戏五维原始值（评分已 /100 归一）/ Raw axis values (rating pre-scaled). */
/** @param {any} p */
function radarValuesOf(p) {
  const views = Number(p.views) || 0;
  const downloads = Number(p.downloads) || 0;
  return {
    downloads,
    views,
    conversion: views > 0 ? downloads / views : 0,
    rating: (Number(p.steamRating) || 0) / 100,
    keywords: Array.isArray(p.keywords) ? p.keywords.length : 0,
    name: String(p.name || p.gameName || '未知')
  };
}

/**
 * 雷达 SVG（纯函数，Node 单测直驱）。各维独立 max 归一化（防单维压制）。
 * @param {Array<any>} profiles
 * @returns {string} SVG markup + 图例（空数据返回空串）
 */
/** @param {any[]} profiles */
function renderProfileRadarSvg(profiles) {
  const list = (profiles || [])
    .map(radarValuesOf)
    .filter((v) => v.downloads > 0 || v.views > 0)
    .slice(0, 8);
  if (list.length === 0) return '';
  const maxes = {};
  for (const axis of RADAR_AXES) {
    maxes[axis.key] = Math.max(...list.map((v) => v[axis.key]), 0.01) || 1;
  }
  const SIZE = 260;
  const C = SIZE / 2;
  const R = 92;
  const angleOf = (i) => (Math.PI * 2 * i) / RADAR_AXES.length - Math.PI / 2;
  const pointAt = (i, ratio) => {
    const a = angleOf(i);
    return `${(C + Math.cos(a) * R * ratio).toFixed(1)},${(C + Math.sin(a) * R * ratio).toFixed(1)}`;
  };
  const esc = (s) => String(s).replace(/</g, '&lt;');
  let svg = `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="游戏画像雷达图">`;
  for (const ratio of [0.25, 0.5, 0.75, 1]) {
    const pts = RADAR_AXES.map((_, i) => pointAt(i, ratio)).join(' ');
    svg += `<polygon points="${pts}" fill="none" stroke="rgba(255,255,255,0.08)" />`;
  }
  RADAR_AXES.forEach((axis, i) => {
    const a = angleOf(i);
    svg += `<line x1="${C}" y1="${C}" x2="${(C + Math.cos(a) * R).toFixed(1)}" y2="${(C + Math.sin(a) * R).toFixed(1)}" stroke="rgba(255,255,255,0.1)" />`;
    const lx = C + Math.cos(a) * (R + 18);
    const ly = C + Math.sin(a) * (R + 14);
    svg += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="11" fill="#8f98a0" text-anchor="middle">${axis.label}</text>`;
  });
  list.forEach((v, gi) => {
    const pts = RADAR_AXES.map((axis, i) => {
      const ratio = Math.min(1, v[axis.key] / (maxes[axis.key] || 1));
      return pointAt(i, Math.max(0.03, ratio));
    }).join(' ');
    const color = RADAR_COLORS[gi % RADAR_COLORS.length];
    svg += `<polygon points="${pts}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="1.5" /><title>${esc(v.name)}</title>`;
  });
  svg += '</svg>';
  const legend = list
    .map(
      (v, gi) =>
        `<span style="font-size:11px;color:${RADAR_COLORS[gi % RADAR_COLORS.length]};margin-right:8px;">■ ${esc(v.name)}</span>`
    )
    .join('');
  return svg + `<div style="margin-top:6px;">${legend}</div>`;
}

/** DOM 挂载（dash-stats 经典全局调用）/ DOM mount wrapper. */
/** @param {any[]} profiles */
function renderProfileRadar(profiles) {
  const host = document.getElementById('profileRadar');
  if (!host) return;
  host.innerHTML = renderProfileRadarSvg(profiles);
}
window.renderProfileRadar = renderProfileRadar; // 经典链跨文件全局挂载
