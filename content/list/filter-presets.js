// @ts-strict
/**
 * 游戏雷达 Game Radar - 过滤预设纯逻辑 / Filter-Preset Pure Logic
 *
 * v14.2.0（复审轮 P1-5）：从 xdgrid.js buildUI 闭包外移——"上限 10 淘汰最早"
 * 与"重名即更新"的组合此前无测试且不可测（闭包内定义）。纯函数化后可独立
 * 单测；xdgrid 只保留 DOM 绑定。
 * Pure preset upsert/cap logic extracted from the xdgrid buildUI closure so
 * the combined semantics (cap-10 evict-oldest + same-name update) is testable.
 */

export const PRESET_CAP = 10;
export const PRESET_NAME_MAX = 20;

/**
 * 规范化阈值（0-100 整数钳制）
 * @param {unknown} v
 * @returns {number}
 */
export function clampPct(v) {
  const n = parseInt(String(v), 10);
  if (Number.isNaN(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/**
 * 写入或更新预设（重名 = 原位更新语义已弃用——现实现为"移除后追加到末尾"，
 * 与 xdgrid 既有行为一致：重名保存视为最新编辑，淘汰排序按 at）。
 * 超过 PRESET_CAP 时淘汰 at 最早者（at 相同按数组序先到先淘汰）。
 * @param {Array<{name: string, enabled: boolean, min: number, at: number}>} presets
 * @param {string} name
 * @param {boolean} enabled
 * @param {number} min
 * @param {number} [now]
 * @returns {{presets: Array<{name: string, enabled: boolean, min: number, at: number}>, name: string}}
 */
export function upsertPreset(presets, name, enabled, min, now = Date.now()) {
  const clean = String(name || '')
    .trim()
    .slice(0, PRESET_NAME_MAX);
  const base = Array.isArray(presets) ? presets : [];
  if (!clean) return { presets: base.slice(), name: '' }; // 空名拒绝（presets 原样返回）
  const rest = base.filter((x) => x && x.name !== clean);
  rest.push({ name: clean, enabled: enabled !== false, min: clampPct(min), at: now });
  rest.sort((a, b) => a.at - b.at); // at 相同保持插入序（稳定排序），淘汰最早的
  while (rest.length > PRESET_CAP) rest.shift();
  return { presets: rest, name: clean };
}
