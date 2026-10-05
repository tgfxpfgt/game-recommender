/**
 * 游戏雷达 Game Radar - 过滤预设纯逻辑单测
 *
 * v14.2.0（复审轮 P1-5）：重名更新 + 上限 10 淘汰最早的组合语义此前定义在
 * xdgrid buildUI 闭包内不可测——外移 filter-presets.js 后独立验证。
 */
import { describe, it, expect } from 'vitest';
import { upsertPreset, clampPct, PRESET_CAP } from '../../content/list/filter-presets.js';

describe('upsertPreset（过滤预设组合语义）', () => {
  it('新增预设并按 at 排序', () => {
    const { presets } = upsertPreset([], 'A', true, 90, 100);
    const { presets: p2 } = upsertPreset(presets, 'B', false, 50, 200);
    expect(p2.map((x) => x.name)).toEqual(['A', 'B']);
    expect(p2[1]).toEqual({ name: 'B', enabled: false, min: 50, at: 200 });
  });

  it('重名保存 = 更新（移除旧条目后追加到末尾，视为最新编辑）', () => {
    let ps = upsertPreset([], 'A', true, 90, 100).presets;
    ps = upsertPreset(ps, 'B', true, 50, 200).presets;
    ps = upsertPreset(ps, 'A', false, 95, 300).presets;
    expect(ps.map((x) => x.name)).toEqual(['B', 'A']);
    expect(ps[1]).toEqual({ name: 'A', enabled: false, min: 95, at: 300 });
  });

  it(`超过 ${PRESET_CAP} 上限淘汰 at 最早者（at 全等按插入序）`, () => {
    let ps = [];
    for (let i = 0; i < PRESET_CAP + 2; i++) {
      ps = upsertPreset(ps, 'P' + i, true, 50, 1000 + i).presets;
    }
    expect(ps.length).toEqual(PRESET_CAP);
    expect(ps[0].name).toEqual('P2'); // P0/P1 被淘汰
    expect(ps[PRESET_CAP - 1].name).toEqual('P11');
  });

  it('空名/纯空白名被拒（返回空 name，presets 不变）', () => {
    const { name, presets } = upsertPreset([], '   ', true, 90);
    expect(name).toEqual('');
    expect(presets).toEqual([]);
  });

  it('名字超长截断到 20；min 越界/非法钳制 0-100', () => {
    const { presets } = upsertPreset([], 'x'.repeat(30), true, 999);
    expect(presets[0].name.length).toEqual(20);
    expect(presets[0].min).toEqual(100);
    expect(clampPct(-5)).toEqual(0);
    expect(clampPct('abc')).toEqual(0);
    expect(clampPct(60.9)).toEqual(60);
  });
});
