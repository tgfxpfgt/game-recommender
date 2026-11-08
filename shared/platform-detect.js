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

// ============ v14.19.0：手动主机机型选择（用户需求：详情页匹配错误时） ============
// 详情页检索到错误 Steam 条目时，除"重试自动匹配/候选选择"外，用户可直接
// 声明该条目是主机游戏并选择机型 → 后台转 Metacritic 评分并持久化映射
// （列表页随映射显示 MC/平台徽章，错误 Steam 徽章不再出现）。
// Manual console-type picker: on a wrong Steam match on the detail page the
// user declares the console type; the backend scores it via Metacritic and
// persists a mapping that list pages honor with MC/platform badges.
// v14.20.0（用户需求：全主机类型）：按厂商分组扩至全机型——任天堂/索尼/
// 微软/世嘉 + 通用 + 模拟器 ROM。id 全小写 ASCII（契约 platform ≤20 字符）；
// label = 按钮文案，tag = 徽章/映射文案。厂商序由 MANUAL_PLATFORM_BRANDS 单源。
/** @type {Array<{id: string, label: string, kind: 'console'|'emulator', tag: string, brand: string}>} */
export const MANUAL_PLATFORM_OPTIONS = [
  // 任天堂
  { id: 'switch', label: 'Switch', kind: 'console', tag: 'Switch', brand: 'nintendo' },
  { id: 'switch2', label: 'Switch 2', kind: 'console', tag: 'Switch2', brand: 'nintendo' },
  { id: 'wiiu', label: 'Wii U', kind: 'console', tag: 'WiiU', brand: 'nintendo' },
  { id: 'wii', label: 'Wii', kind: 'console', tag: 'Wii', brand: 'nintendo' },
  { id: 'ngc', label: 'NGC', kind: 'console', tag: 'NGC', brand: 'nintendo' },
  { id: 'n64', label: 'N64', kind: 'console', tag: 'N64', brand: 'nintendo' },
  { id: 'sfc', label: 'SFC', kind: 'console', tag: 'SFC', brand: 'nintendo' },
  { id: 'fc', label: 'FC', kind: 'console', tag: 'FC', brand: 'nintendo' },
  { id: '3ds', label: '3DS', kind: 'console', tag: '3DS', brand: 'nintendo' },
  { id: 'nds', label: 'NDS', kind: 'console', tag: 'NDS', brand: 'nintendo' },
  { id: 'gba', label: 'GBA', kind: 'console', tag: 'GBA', brand: 'nintendo' },
  // 索尼
  { id: 'ps5', label: 'PS5', kind: 'console', tag: 'PS5', brand: 'sony' },
  { id: 'ps4', label: 'PS4', kind: 'console', tag: 'PS4', brand: 'sony' },
  { id: 'ps3', label: 'PS3', kind: 'console', tag: 'PS3', brand: 'sony' },
  { id: 'ps2', label: 'PS2', kind: 'console', tag: 'PS2', brand: 'sony' },
  { id: 'ps1', label: 'PS1', kind: 'console', tag: 'PS1', brand: 'sony' },
  { id: 'psp', label: 'PSP', kind: 'console', tag: 'PSP', brand: 'sony' },
  { id: 'psv', label: 'PSV', kind: 'console', tag: 'PSV', brand: 'sony' },
  // 微软
  { id: 'xbox-series', label: 'Xbox Series X|S', kind: 'console', tag: 'Xbox Series', brand: 'microsoft' },
  { id: 'xboxone', label: 'Xbox One', kind: 'console', tag: 'XboxOne', brand: 'microsoft' },
  { id: 'xbox360', label: 'Xbox 360', kind: 'console', tag: 'Xbox360', brand: 'microsoft' },
  { id: 'xbox', label: 'Xbox', kind: 'console', tag: 'Xbox', brand: 'microsoft' },
  // 世嘉
  { id: 'dc', label: 'DC', kind: 'console', tag: 'DC', brand: 'sega' },
  { id: 'ss', label: 'SS', kind: 'console', tag: 'SS', brand: 'sega' },
  { id: 'md', label: 'MD', kind: 'console', tag: 'MD', brand: 'sega' },
  { id: 'gg', label: 'GG', kind: 'console', tag: 'GG', brand: 'sega' },
  // 通用（v14.21.0：按 M 站分类口径补齐其余有评分分类的平台——M 站无分时
  // 优雅降级为纯机型徽章，罗列广度无风险）
  { id: 'gb', label: 'GB', kind: 'console', tag: 'GB', brand: 'generic' },
  { id: 'gbc', label: 'GBC', kind: 'console', tag: 'GBC', brand: 'generic' },
  { id: 'neogeo', label: 'Neo Geo', kind: 'console', tag: 'NeoGeo', brand: 'generic' },
  { id: 'pce', label: 'PC Engine', kind: 'console', tag: 'PCE', brand: 'generic' },
  { id: 'segacd', label: 'Mega CD', kind: 'console', tag: 'MegaCD', brand: 'generic' },
  { id: 'atari2600', label: 'Atari 2600', kind: 'console', tag: 'Atari', brand: 'generic' },
  { id: 'wonderswan', label: 'WonderSwan', kind: 'console', tag: 'WS', brand: 'generic' },
  { id: 'console', label: '其他主机', kind: 'console', tag: '主机', brand: 'generic' },
  { id: 'emu', label: '模拟器 ROM', kind: 'emulator', tag: '模拟器', brand: 'generic' }
];

// 厂商分组序（单源——候选面板按此渲染分组行；label = 分组标题）
export const MANUAL_PLATFORM_BRANDS = [
  { id: 'nintendo', label: '任天堂' },
  { id: 'sony', label: '索尼' },
  { id: 'microsoft', label: '微软' },
  { id: 'sega', label: '世嘉' },
  { id: 'generic', label: '通用' }
];

/**
 * 机型选项 id → 选项对象（纯函数，可单测；非法 id 返回 null——契约/处理器守卫用）。
 * @param {string} id @returns {{id: string, label: string, kind: 'console'|'emulator', tag: string, brand: string}|null}
 */
export function resolveManualPlatformOption(id) {
  const idStr = String(id || '');
  return MANUAL_PLATFORM_OPTIONS.find((o) => o.id === idStr) || null;
}

/**
 * 从标题提取英文段（纯函数，可单测）——Metacritic slug 推导的输入。
 * v14.19.0 修复：取**最长**匹配而非首个——"xxx|v1.1.1|官方中文|English Name"
 * 类标题（咸鱼单机真实形态）首个 ASCII 段是版本号（'v1.1.1' 恰好满足
 * {3,}），首匹配 slug='v1-1-1' 必 404；最长段即真实英文名。无英文段返回空串。
 * @param {string} rawTitle @returns {string} 无英文段返回空串
 */
export function extractEnNameSegment(rawTitle) {
  const matches = String(rawTitle || '').match(/[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ0-9&:.'\- ]{3,}/g) || [];
  let best = '';
  for (const m of matches) {
    const t = m.trim();
    if (t.length > best.length) best = t;
  }
  return best;
}
