/**
 * 游戏雷达 Game Radar - 匹配置信度行 / Match Confidence Row
 *
 * v14.28.7（R4-B3）：详情面板、浮窗、内嵌卡共用同一渲染。用户裁决——"只在
 * 列表徽章上标推测等于没修，用户看到错配的地方就是详情"：推测态必须给出
 * 依据（Steam 命中标题 / 数据来源 / 平台判定），确认态低调展示不干扰。
 * Shared by the detail panel, float and inline card: a suspected match always
 * carries its evidence (matched Steam title, source, platform verdict).
 */
import * as common from '../../core/common.js';

const esc = (text) => common.escapeHtml(text);

/**
 * 置信度行 HTML；无 matchConfidence（旧缓存/直取路径/主机映射）→ 空串。
 * @param {Record<string, any>} data
 * @returns {string}
 */
export function renderMatchConfidenceRow(data) {
  if (!data) return '';
  const c = data.matchConfidence;
  if (c !== 'confirmed' && c !== 'suspected') return '';
  const suspected = c === 'suspected';
  const color = suspected ? '#ffcc33' : '#8f98a0';
  const bg = suspected ? 'rgba(255,204,51,0.12)' : 'rgba(143,152,160,0.10)';
  const border = suspected ? '1px dashed #ffcc33' : '1px solid rgba(143,152,160,0.3)';
  const label = suspected ? '⚠ 推测匹配' : '✓ 已确认';
  const parts = [];
  if (data.matchName) parts.push('Steam 命中「' + esc(data.matchName) + '」');
  if (data.matchSource) parts.push('来源：' + esc(data.matchSource));
  if (data.matchPlatform) parts.push('平台：' + esc(data.matchPlatform));
  const evidence = parts.join(' · ');
  const reason = data.matchNote ? esc(data.matchNote) : '';
  const detail = [reason, evidence].filter(Boolean).join(' · ');
  return `
      <div class="gr-match-confidence" data-match-confidence="${suspected ? 'suspected' : 'confirmed'}" style="display:flex;align-items:flex-start;gap:6px;flex-wrap:wrap;margin:6px 0 8px;">
        <span style="display:inline-block;padding:2px 8px;font-size:11px;font-weight:bold;color:${color};background:${bg};border:${border};border-radius:3px;white-space:nowrap;">${label}</span>
        ${detail ? `<span style="flex:1;min-width:0;font-size:11px;line-height:1.6;color:#8f98a0;word-break:break-all;">${detail}</span>` : ''}
      </div>`;
}
