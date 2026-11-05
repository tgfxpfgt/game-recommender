/**
 * 游戏雷达 Game Radar - 测试：N7 iCalendar 生成器 / ics builder tests
 *
 * v14.16.0：golden 断言（UTC 基本格式/TEXT 转义/确定性 UID/无效截止跳过/
 * 空数据骨架）——ics 是机器消费格式，格式漂移 = 日历导入失败。
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(path.join(ROOT, 'shared/ical.js'), 'utf-8');
const sandbox = { globalThis: {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const { buildIcal } = sandbox.globalThis.__GR_ICAL__;

describe('N7 buildIcal（限免 .ics 导出）', () => {
  const NOW = new Date('2026-11-06T00:00:00Z');

  test('单事件 golden：UTC 格式/24h 提醒窗/确定性 UID', () => {
    const ics = buildIcal(
      [
        {
          id: 'epic-xyz',
          name: '免费游戏A',
          source: 'Epic Games Store',
          endTime: '2026-11-10T16:00:00Z',
          url: 'https://epicgames.com/x',
          description: '描述, 带; 特殊字符'
        }
      ],
      NOW
    );
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('DTSTAMP:20261106T000000Z');
    expect(ics).toContain('DTSTART:20261109T160000Z'); // 截止前 24h
    expect(ics).toContain('DTEND:20261110T160000Z');
    expect(ics).toContain('UID:gr-epic-xyz-1794326400000@game-radar');
    expect(ics).toContain('SUMMARY:[限免] 免费游戏A（Epic Games Store）'); // 全角括号不需 RFC 转义
    expect(ics).toContain('描述\\, 带\\; 特殊字符');
    expect(ics).toContain('END:VEVENT');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toEqual(true);
  });

  test('无效/缺失截止跳过；空数据出骨架（0 VEVENT）', () => {
    const ics = buildIcal(
      [
        { id: 'a', name: '无截止' },
        { id: 'b', name: '坏时间', endTime: 'not-a-date' }
      ],
      NOW
    );
    expect(ics).not.toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VCALENDAR');
    expect(buildIcal([], NOW).match(/BEGIN:VEVENT/g) || []).toEqual([]);
  });
});
