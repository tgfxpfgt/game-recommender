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
 *
 * v14.17.0（用户报告：民间移植主机游戏/模拟器整合版未识别，被当 PC 检索）：
 * 1. 词表扩充——模拟器产品名（yuzu/ryujinx/eden/sudachi/citron 等民间移植
 *    常见段）、主机数字版 ROM 格式段（nsp/xci/nsz/wbfs 等）；
 * 2. 后缀**迭代**剥离——"switch整合版/NS整合包/主机游戏移植版"等组合段逐层
 *    还原到机型词（旧实现只剥一层，"Switch中文版"这类双层修饰整段落空）；
 * 3. 组合段二级匹配（**仅限无子串误伤风险的强词**）——"Switch模拟器整合版/
 *    yuzu模拟器"整体一段时经"含'模拟器'+同段伴随模拟器名/短机型前缀"命中；
 *    仍守 PC 优先与游戏名内含标记词的双重护栏（PC装机模拟器/游戏开发模拟器
 *    /Switchball 类 PC 游戏不误判——机型拉丁词只整段匹配、不做子串）。
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

// v14.17.0：主机数字版 ROM/封装格式段（console 语义——底物是主机游戏，评分
// 仍可试 Metacritic；区别于模拟器条目直接零网络打标）。整段匹配，均为无
// 英文词冲突的短码（nsp/xci 与 PC 常见词汇无重叠）。
// Console ROM/package format segments (console semantics — the underlying item
// is a console game; Metacritic is still attempted, unlike emulator items).
const ROM_FORMAT_MARKERS = ['nsp', 'xci', 'nsz', 'nro', 'wbfs', 'rvz', 'vpk', 'chd'];

// 模拟器标记（优先级高于主机——"模拟器整合"含主机语义但性质是 ROM 包）。
// v14.17.0：追加模拟器产品名（民间移植标题常以模拟器名作独立段，如
// "塞尔达|Yuzu|整合包"）——均为整段匹配，不做子串（"Ecco The Dolphin"类
// 游戏名内含模拟器词的 PC 游戏不得误判）。
const EMULATOR_MARKERS = [
  '模拟器整合',
  '模拟器游戏',
  '安卓模拟器',
  '模拟器',
  'emulator',
  'rom',
  'roms',
  // 模拟器产品名（小写整段；eden 仅整段——子串会误伤 sweden 类词）
  // v14.18.0：追加 retroarch/kemulator/kawaks（咸鱼单机模拟器版分类页真实
  // 标题："GBA经典游戏整合包-RetroArch模拟器"等三站内整合包）
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
];

// v14.10.1：显式 PC 标记——站点同时标 PC 与主机时 PC 优先（Steam 有该游戏，
// 走常规管线；"PC|Xbox 双平台"条目不得进主机分支）
const PC_MARKERS = ['pc', 'pc版', 'pc游戏', '电脑游戏', '电脑版', 'steam', 'steam版'];

// v14.17.0：PC 组合段强词（子串）——段首 pc（后随非小写字母，"pce游戏"不误守）
// 或含 steam/pc游戏 等强词；《PC装机模拟器》守卫即靠段首 pc。
// PC composite guard: segment-leading "pc" (not followed by a lowercase letter)
// or strong PC substrings.
const PC_SUBSTR_MARKERS = ['steam', 'pc游戏', 'pc版', '电脑游戏', '电脑版'];
const PC_LEADING_RE = /^pc(?![a-z])/;

// v14.17.0：模拟器名子串表（**仅作"模拟器"组合段的伴随佐证**，不独立命中——
// 独立命中用 EMULATOR_MARKERS 整段）。"yuzu模拟器/Ryujinx模拟器"整体一段时
// 经"含模拟器 + 本表佐证"命中。
const EMULATOR_NAME_SUBSTR = [
  'yuzu',
  'ryujinx',
  'sudachi',
  'citron',
  'eden',
  'skyline',
  'dolphin',
  'cemu',
  'citra',
  'pcsx2',
  'rpcs3',
  'ppsspp',
  'vita3k',
  'xenia',
  'xemu',
  'mame',
  'winlator',
  'eggns',
  // v14.18.0：咸鱼单机整合包标题实证（RetroArch/KEmulator/Kawaks）
  'retroarch',
  'kemulator',
  'kawaks',
  'emulator'
];

// v14.17.0：短机型前缀（组合段"ns模拟器/ps4模拟器"——机型短码无法整段命中时
// 的伴随佐证；前缀锚定，不做子串）。
const SHORT_BRAND_PREFIX_RE =
  /^(?:nswitch|switch2|switch|ns2|ns|ps5|ps4|ps3|ps2|psp|psv|ps1|psvita|wiiu|wii|3ds|nds|gba|gbc|sfc|ngc|n64|pce|xbox|xsx|xss)/;

// 段尾常见修饰剥离（v14.17.0 改迭代：逐层剥到无可剥，每层产出中间变体）——
// "switch整合版"→[原,'switch整合','switch']；"主机游戏移植版"→[原,'主机游戏移植','主机游戏']。
// 追加 包/移植/主机/掌机 四个民间移植高频修饰。
const SEGMENT_SUFFIXES = ['版', '中文', '汉化', '整合', '游戏', '专版', '版整合', '包', '移植', '主机', '掌机'];

/** @param {string} rawName @returns {string[]} */
function segmentsOf(rawName) {
  return String(rawName || '')
    .split(/[|丨/／,，、;；\s\-—_·]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** @param {string} seg @returns {string[]} 段本身 + 迭代剥修饰后缀的全部中间变体 */
function segVariants(seg) {
  const out = [seg];
  let cur = seg;
  // 迭代剥离：每层最多剥一个后缀（首个命中的），直到无可剥或长度触底
  for (;;) {
    let stripped = false;
    for (const suf of SEGMENT_SUFFIXES) {
      if (cur.length > suf.length && cur.endsWith(suf)) {
        cur = cur.slice(0, -suf.length);
        out.push(cur);
        stripped = true;
        break;
      }
    }
    if (!stripped) break;
  }
  return out;
}

/** @param {string} seg @returns {boolean} PC 守卫：段首 pc 或强 PC 词（子串） */
function hasPcGuard(seg) {
  if (PC_LEADING_RE.test(seg)) return true;
  return PC_SUBSTR_MARKERS.some((w) => seg.includes(w));
}

/**
 * "含'模拟器'组合段"的伴随佐证：同段出现模拟器名子串或短机型前缀——
 * 排除《游戏开发模拟器》《PC装机模拟器》类游戏名（无佐证即不命中）。
 * v14.18.0：追加"整合"（语序变体"整合模拟器版"——咸鱼单机真实标题实证，
 * 与"模拟器整合"同义，仅词序相反）。
 * @param {string} seg @returns {boolean}
 */
function hasEmulatorCorroboration(seg) {
  if (EMULATOR_NAME_SUBSTR.some((w) => seg.includes(w))) return true;
  if (seg.includes('整合')) return true;
  return SHORT_BRAND_PREFIX_RE.test(seg);
}

/**
 * 识别非 PC 平台条目。纯函数。
 * @param {string} rawName - 列表项原始标题（含平台段）
 * @returns {{kind: 'pc'|'console'|'emulator', tag: string}} kind=console/emulator 时 tag 为徽章文案
 */
export function detectPlatform(rawName) {
  const segs = segmentsOf(rawName);
  // v14.10.1：显式 PC 标记优先——多平台条目（"PC|Xbox"）Steam 有数据走常规管线
  // v14.17.0：PC 判定叠加组合段守卫（段首 pc / steam 等强词子串）
  if (segs.some((seg) => segVariants(seg).some((v) => PC_MARKERS.includes(v)) || hasPcGuard(seg))) {
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
    // 组合段二级匹配："switch模拟器整合版/yuzu模拟器"整体一段——含"模拟器"
    // 且同段有模拟器名/短机型前缀佐证才命中（游戏名内含"模拟器"的 PC 游戏
    // 无佐证，不误判）
    if (seg.includes('模拟器') && hasEmulatorCorroboration(seg)) {
      emulatorHit = true;
      continue;
    }
    if (variants.some((v) => CONSOLE_MARKERS.includes(v)) || variants.some((v) => ROM_FORMAT_MARKERS.includes(v))) {
      consoleHit = true;
    }
  }
  if (emulatorHit) return { kind: 'emulator', tag: '模拟器' };
  if (consoleHit) return { kind: 'console', tag: '主机' };
  return { kind: 'pc', tag: '' };
}

// v14.17.0：EN 段尾平台词表（Metacritic slug 推导前剥离——"The Legend of
// Zelda TotK NSP/Ryujinx"这类"英文名+平台标记"组合若不剥离，slug 必 404）。
// 纯词尾剥离（拆词后从尾部逐个弹出），不碰标题主体。
const EN_PLATFORM_TAIL_TOKENS = new Set([
  'switch',
  'switch2',
  'nswitch',
  'ns',
  'ns2',
  'nsp',
  'xci',
  'nsz',
  'nro',
  'rom',
  'roms',
  'wii',
  'wiiu',
  'ps5',
  'ps4',
  'ps3',
  'ps2',
  'ps1',
  'psp',
  'psv',
  'psvita',
  'vita',
  'playstation',
  'nintendo',
  'xbox',
  'xboxone',
  'xbox360',
  'xsx',
  'xss',
  'seriesx',
  'one',
  'emulator',
  'yuzu',
  'ryujinx',
  'sudachi',
  'citron',
  'eden',
  'skyline',
  'dolphin',
  'cemu',
  'citra',
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
  'pc',
  'steam'
]);

/**
 * 剥离英文名尾部的平台/模拟器/格式词（纯函数，可单测）。
 * "Elden Ring Switch" → "Elden Ring"；全被剥光时返回原文（保底非空）。
 * @param {string} enName @returns {string}
 */
export function trimPlatformTokens(enName) {
  const raw = String(enName || '').trim();
  const words = raw.split(/[^A-Za-z0-9]+/).filter(Boolean);
  while (words.length > 1 && EN_PLATFORM_TAIL_TOKENS.has(words[words.length - 1].toLowerCase())) {
    words.pop();
  }
  return words.join(' ') || raw;
}
