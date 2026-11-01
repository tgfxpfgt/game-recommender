/**
 * 游戏雷达 Game Radar - 非 PC 平台识别（v14.10.0，用户需求：主机/模拟器条目）
 *
 * 下载站会提供主机游戏/主机整合/模拟器/模拟器整合（有时带机型：PS5/NS2/
 * Switch 等）。此类条目**不走 Steam 检索**（模拟器 ROM 包检索必错配；主机
 * 独占 Steam 无数据），评分优先 Metacritic。
 * 识别基于标题**分段精确匹配**（|/丨/，/空格等分隔）：避免子串误伤——
 * 《PC装机模拟器》这类游戏名内含"模拟器"的 PC 游戏不得误判。
 * 纯函数、零依赖；分层矩阵 open（后台/内容侧均可消费）。
 * Non-PC platform detection: console/emulator items skip the Steam search
 * entirely; ratings come from Metacritic first. Segment-EXACT matching guards
 * against game NAMES containing the marker words (PC Building Simulator).
 */

// 主机平台标记（小写；整段匹配——带常见后缀变体枚举而非通配）
const CONSOLE_MARKERS = [
  // 机型拉丁标记（整段小写匹配；无子串风险）
  'ns2',
  'ns',
  'switch',
  'switch2',
  'nswitch',
  'nintendo',
  'playstation5',
  'playstation4',
  'playstation3',
  'playstation2',
  'playstation',
  'ps5',
  'ps4',
  'ps3',
  'ps2',
  'ps1',
  'psv',
  'psvita',
  'psp',
  'vita',
  'xbox',
  'xsx',
  'xss',
  'xboxone',
  'xbox360',
  'seriesx',
  'series s',
  'wii',
  'wiiu',
  '3ds',
  'nds',
  'ndsl',
  'dsi',
  'gba',
  'gbc',
  'gb',
  'sfc',
  'fc',
  'md',
  'pce',
  'dc',
  'ss',
  'ngc',
  'n64',
  // CJK 标记（整段/常用组合段）
  '主机游戏',
  '主机整合',
  '主机',
  '掌机游戏',
  '掌机',
  '游戏机',
  '电视游戏',
  'switch游戏',
  'ns游戏',
  'ps5游戏',
  'ps4游戏'
];

// 模拟器标记（优先级高于主机——"模拟器整合"含主机语义但性质是 ROM 包）
const EMULATOR_MARKERS = ['模拟器整合', '模拟器游戏', '安卓模拟器', '模拟器', 'emulator', 'rom'];

// v14.10.1：显式 PC 标记——站点同时标 PC 与主机时 PC 优先（Steam 有该游戏，
// 走常规管线；"PC|Xbox 双平台"条目不得进主机分支）
const PC_MARKERS = ['pc', 'pc版', 'pc游戏', '电脑游戏', '电脑版', 'steam', 'steam版'];

// 段尾常见修饰剥离一次后重试（NS2版/主机中文 等组合段）
const SEGMENT_SUFFIXES = ['版', '中文', '汉化', '整合', '游戏', '专版', '版整合'];

/** @param {string} rawName @returns {string[]} */
function segmentsOf(rawName) {
  return String(rawName || '')
    .split(/[|丨/／,，、;；\s\-—_·]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** @param {string} seg @returns {string[]} 段本身 + 剥一层常见修饰后缀的变体 */
function segVariants(seg) {
  const out = [seg];
  for (const suf of SEGMENT_SUFFIXES) {
    if (seg.length > suf.length && seg.endsWith(suf)) {
      out.push(seg.slice(0, -suf.length));
      break;
    }
  }
  return out;
}

/**
 * 识别非 PC 平台条目。纯函数。
 * @param {string} rawName - 列表项原始标题（含平台段）
 * @returns {{kind: 'pc'|'console'|'emulator', tag: string}} kind=console/emulator 时 tag 为徽章文案
 */
export function detectPlatform(rawName) {
  const segs = segmentsOf(rawName);
  // v14.10.1：显式 PC 标记优先——多平台条目（"PC|Xbox"）Steam 有数据走常规管线
  if (segs.some((seg) => segVariants(seg).some((v) => PC_MARKERS.includes(v)))) {
    return { kind: 'pc', tag: '' };
  }
  let consoleHit = false;
  let emulatorHit = false;
  for (const seg of segs) {
    const variants = segVariants(seg);
    if (variants.some((v) => EMULATOR_MARKERS.includes(v))) {
      emulatorHit = true;
      continue;
    }
    if (variants.some((v) => CONSOLE_MARKERS.includes(v))) {
      consoleHit = true;
    }
  }
  if (emulatorHit) return { kind: 'emulator', tag: '模拟器' };
  if (consoleHit) return { kind: 'console', tag: '主机' };
  return { kind: 'pc', tag: '' };
}
