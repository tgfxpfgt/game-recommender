/**
 * game-radar v2 — 非 PC 平台识别
 * Platform detection: whole-segment matching (no substring) to avoid false
 * positives on game NAMES containing marker words; PC markers win first.
 */
import type { PlatformKind } from './types.js';

const PC_SEGMENTS = new Set(['pc', 'pc版', 'pc游戏', '电脑游戏', '电脑版', 'steam', 'steam版']);

const CONSOLE_SEGMENTS = new Set([
  '主机游戏',
  '主机整合',
  '主机',
  '掌机游戏',
  '掌机',
  '游戏机',
  '电视游戏',
  'switch',
  'switch2',
  'ns',
  'ns2',
  'nswitch',
  'nintendo',
  'ps5',
  'ps4',
  'ps3',
  'ps2',
  'ps1',
  'psv',
  'psvita',
  'psp',
  'playstation',
  'xbox',
  'xsx',
  'xss',
  'xboxone',
  'xbox360',
  'seriesx',
  'wii',
  'wiiu',
  '3ds',
  'nds',
  'gba',
  'gbc',
  'sfc',
  'fc',
  'ngc',
  'n64',
  '移植版',
  '移植'
]);

const EMULATOR_SEGMENTS = new Set([
  '模拟器',
  '模拟器整合',
  '模拟器游戏',
  'emulator',
  'rom',
  'roms',
  'yuzu',
  'ryujinx',
  'sudachi',
  'citron',
  'eden',
  'skyline',
  'dolphin',
  'cemu',
  'pcsx2',
  'pcsx',
  'rpcs3',
  'ppsspp',
  'vita3k',
  'xenia',
  'xemu',
  'mame',
  'winlator',
  'eggns',
  'retroarch',
  'kemulator',
  'kawaks'
]);

/** 修 depicts 结果标签（徽章文案） */
const TAGS: Record<PlatformKind, string> = { console: '主机', emulator: '模拟器' };

/** 分段：按常见分隔符切标题并小写 */
function segmentsOf(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[|丨/／,，、;；\s\-—_·]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 迭代剥后缀（版/中文/整合/游戏/包/移植…），产出中间形态供整段匹配 */
function variantsOf(seg: string): string[] {
  const suffixes = ['版', '中文', '汉化', '整合', '游戏', '专版', '版整合', '包', '移植', '主机', '掌机'];
  const out = [seg];
  let cur = seg;
  for (;;) {
    const hit = suffixes.find((s) => cur.length > s.length && cur.endsWith(s));
    if (!hit) break;
    cur = cur.slice(0, -hit.length);
    out.push(cur);
  }
  return out;
}

/** 段首 pc 或强 PC 词 → PC 守卫（"PC移植版"判 PC：主机→PC 移植版 Steam 有数据） */
function hasPcGuard(seg: string): boolean {
  return /^pc(?![a-z])/.test(seg) || PC_SEGMENTS.has(seg) || seg.includes('steam');
}

export interface PlatformVerdict {
  platform: PlatformKind;
  tag: string;
}

/**
 * 识别非 PC 平台。返回 null = PC（走 Steam 常规管线）。
 * PC 显式标记优先；模拟器优先于主机（"模拟器整合"是 ROM 包）。
 */
export function detectPlatform(rawTitle: string): PlatformVerdict | null {
  const segs = segmentsOf(rawTitle);
  if (segs.some((seg) => variantsOf(seg).some((v) => PC_SEGMENTS.has(v)) || hasPcGuard(seg))) {
    return null;
  }
  let emulator = false;
  let console_ = false;
  for (const seg of segs) {
    const variants = variantsOf(seg);
    if (variants.some((v) => EMULATOR_SEGMENTS.has(v))) {
      emulator = true;
      continue;
    }
    if (variants.some((v) => CONSOLE_SEGMENTS.has(v))) console_ = true;
  }
  if (emulator) return { platform: 'emulator', tag: TAGS.emulator };
  if (console_) return { platform: 'console', tag: TAGS.console };
  return null;
}
