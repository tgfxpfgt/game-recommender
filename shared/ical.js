/**
 * 游戏雷达 Game Radar - iCalendar 生成器 / iCalendar builder
 *
 * v14.16.0（功能报告 N7）：限免导出 .ics——时间敏感收益（错过=损失）进用户
 * 已有的日历提醒渠道。纯函数、零依赖、单测友好（golden 断言）。
 * RFC 5545 口径：DTSTART/DTEND 用 UTC 基本格式（YYYYMMDDTHHMMSSZ，Z 后缀），
 * 文本字段转义（反斜杠/分号/逗号/换行），UID 确定性生成（id+起止哈希）。
 * Pure, dependency-free .ics builder for the free-games page export.
 */
'use strict';

(function (/** @type {any} */ global) {
  /** @param {number} n @returns {string} 两位补零 */
  const pad2 = (/** @type {number} */ n) => String(n).padStart(2, '0');

  /** @param {Date} d @returns {string} UTC 基本格式（Z 后缀） */
  function toIcsUtc(d) {
    return (
      d.getUTCFullYear() +
      pad2(d.getUTCMonth() + 1) +
      pad2(d.getUTCDate()) +
      'T' +
      pad2(d.getUTCHours()) +
      pad2(d.getUTCMinutes()) +
      pad2(d.getUTCSeconds()) +
      'Z'
    );
  }

  /** RFC 5545 TEXT 转义（反斜杠/分号/逗号/换行） */
  /** @param {unknown} s */
  function escText(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  /**
   * 由限免游戏列表构建 VCALENDAR 文本。
   * @param {Array<{id: string, name: string, endTime?: string, url?: string, source?: string, description?: string}>} games
   * @param {Date} [now] - 注入时钟（测试确定性）
   * @returns {string} ics 全文（无有效条目时含 VCALENDAR 骨架 + 0 VEVENT）
   */
  function buildIcal(games, now) {
    const ref = now || new Date();
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//GameRadar//FreeGames//CN',
      'CALSCALE:GREGORIAN',
      'X-WR-CALNAME:游戏雷达 限免提醒'
    ];
    for (const g of Array.isArray(games) ? games : []) {
      const endMs = Date.parse(g.endTime || '');
      if (!Number.isFinite(endMs)) continue; // 无有效截止 → 无法成事件
      const startMs = endMs - 24 * 3600e3; // 提醒窗：截止前 24h 起（全天可玩窗口）
      const uid = 'gr-' + String(g.id || 'x').replace(/[^a-zA-Z0-9-]/g, '') + '-' + endMs + '@game-radar';
      lines.push(
        'BEGIN:VEVENT',
        'UID:' + uid,
        'DTSTAMP:' + toIcsUtc(ref),
        'DTSTART:' + toIcsUtc(new Date(startMs)),
        'DTEND:' + toIcsUtc(new Date(endMs)),
        'SUMMARY:' + escText('[限免] ' + (g.name || '') + '（' + (g.source || '') + '）'),
        'DESCRIPTION:' + escText((g.description || '') + (g.url ? '\n领取: ' + g.url : '')),
        'END:VEVENT'
      );
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  global.__GR_ICAL__ = { buildIcal };
})(typeof globalThis !== 'undefined' ? globalThis : this);
