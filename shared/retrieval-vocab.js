// @ts-strict
/**
 * 游戏雷达 Game Radar - 检索规则词表（单源数据 + 校验 + 编译）/ Retrieval Vocab
 *
 * v14.6.3（R1，调研 docs/检索规则与编码分离-技术调研-2026-10.md）：把检索管线
 * 的"数据形态规则"从代码字面量分离为本词表——标题噪声序列、下载站尾段词、
 * 版本后缀对照、附属/Demo 关键词、版本词、EN 噪声词。规则骨架（编译出的正则
 * 如何被消费）留在代码；本表只存"词"，新增噪声词 = 加一行条目。
 *
 * v14.6.3 R1：条目 1:1 迁移自 title-parser.js noisePattern / api-search.js
 * NOISE_EN_WORDS·VERSION_SUFFIX_PAIRS·ADDON|DEMO_NAME_PATTERN /
 * orchestrator-detail EDITION_WORDS / common.js cleanPageTitle 尾段词——
 * golden 等价测试（tests/unit/test-retrieval-vocab.mjs）断言编译源与旧字面量
 * 逐字节一致，错题库（tests/fixtures/mismatch-samples.json）回放全绿为门禁。
 *
 * **保序语义**：噪声序列的 alternation 顺序参与删除语义（重叠词先长后短，
 * 如 Switch520.com 先于 Switch520，否则 ".com" 残留）；新增词条追加在
 * 同类词附近，勿整体重排。shared/patterns.js（经典脚本）的 noisePatternSource
 * 已随 R1 退役——内容侧 ESM 消费方直接 import 本模块编译产物。
 *
 * Retrieval vocab (R1): the data-shaped rules of the title→appid pipeline as
 * an ordered word list; the rule skeleton stays in code. Golden equivalence
 * tests pin compiled sources to the pre-R1 literals; the mismatch-sample
 * replay suite is the regression gate. Order matters (overlapping words:
 * longest first decides the deletion span).
 */

/**
 * 条目形态：['w', 字面词]（编译时转义）/ ['re', 正则片段]（原样）/
 * ['b', 词]（\b 边界包裹，addon/demo 用）。Entry kinds: w=literal (escaped),
 * re=regex fragment (verbatim), b=word wrapped in \b boundaries.
 * @typedef {[string, string]} VocabEntry
 */

/** @type {{version: number, noiseTitle: VocabEntry[], noiseEnWords: string[], junkCandidateWords: VocabEntry[], titleTailStripWords: string[], versionSuffixes: Array<[string, string]>, addonKeywords: VocabEntry[], demoKeywords: VocabEntry[], editionWords: string[]}} */
export const RETRIEVAL_VOCAB = {
  version: 1,

  // 中文标题噪声序列（下载站修饰/版本/资源/发布组词；段级丢弃与搜索清洗共用）。
  // CN title noise sequence (site modifiers/versions/resources/release groups).
  noiseTitle: [
    ['w', '中文'],
    ['w', '汉化'],
    ['w', '破解'],
    ['w', '免安装'],
    ['w', '绿色'],
    ['w', '学习'],
    ['w', '未加密'],
    ['w', '完整版'],
    ['w', '豪华版'],
    ['w', '豪华'],
    ['w', '终极'],
    ['w', '数字'],
    ['w', '典藏'],
    ['w', '年度'],
    ['w', '重制'],
    ['w', '复刻'],
    ['w', '增强'],
    ['w', '正式'],
    ['w', '官方'],
    ['w', '简繁'],
    ['w', '简体'],
    ['w', '繁体'],
    ['w', '中英'],
    ['w', '多语言'],
    ['w', '特别版'],
    ['w', '标准版'],
    ['w', '支持者版'],
    ['w', '解压即撸'],
    ['w', '预购特典'],
    ['w', '预购'],
    ['w', '特典'],
    ['w', '抢先试玩'],
    ['w', '抢先体验'],
    ['w', '抢先'],
    ['w', '试玩'],
    ['w', '体验版'],
    ['w', '修改器'],
    ['w', '加速器'],
    ['w', '作弊'],
    ['w', '全季票'],
    ['w', '季票'],
    ['w', '顶置'],
    ['w', '置顶'],
    ['w', '汇总贴'],
    ['w', '汇总'],
    ['w', '索引'],
    ['w', '爆火'],
    ['w', '热门'],
    ['w', '版'],
    ['re', 'v[\\d.]+'],
    ['re', 'V[\\d.]+'],
    ['re', '\\d+\\.\\d+[\\d.]*'],
    ['re', 'Build[.\\s]*\\d+'],
    ['re', 'update\\s*\\d+'],
    ['re', 'DLC.*'],
    ['w', '全DLC'],
    ['w', '整合'],
    ['w', '硬盘'],
    ['w', '免DVD'],
    ['w', 'CODEX'],
    ['w', 'FLT'],
    ['w', 'RELOADED'],
    ['w', 'SKIDROW'],
    ['w', 'EMPRESS'],
    ['w', 'GOG'],
    ['w', 'Razor1911'],
    ['w', 'FitGirl'],
    ['re', '\\d+\\s*GB'],
    ['w', '百度网盘'],
    ['w', '网盘'],
    ['w', '下载'],
    ['w', '游戏下载'],
    ['w', '免费下载'],
    ['w', '迅雷'],
    ['w', '磁力'],
    ['w', 'BT'],
    ['w', '种子'],
    ['w', '支持手柄'],
    ['w', '手柄'],
    ['w', '支持'],
    ['w', '新游发布'],
    ['w', '免安装绿色版'],
    ['w', 'Switch520.com'],
    ['w', 'Switch520'],
    ['w', '520.com'],
    ['re', '\\s+The\\s+Game\\s*']
  ],

  // 英文噪声词（EN token ≥4 字符的排除表——coreTokensOf/namesRelated 消费）。
  // EN noise tokens (excluded from "EN content words" extraction).
  noiseEnWords: ['build', 'plus', 'full', 'crack', 'repack', 'update'],

  // 候选垃圾词（^锚定单 token 过滤——parseGameTitle 的 junkPattern；与噪声
  // 序列子集 + pc/vr/3d/hd 尾缀，保序）。
  // Junk-candidate words (^-anchored single-token filter; noise subset plus
  // pc/vr/3d/hd tags; order preserved).
  junkCandidateWords: [
    ['w', '豪华'],
    ['w', '解压即撸'],
    ['w', '预购特典'],
    ['w', '预购'],
    ['w', '特典'],
    ['w', '中文'],
    ['w', '汉化'],
    ['w', '破解'],
    ['w', '免安装'],
    ['w', '绿色'],
    ['w', '完整版'],
    ['w', '豪华版'],
    ['w', '终极'],
    ['w', '修改器'],
    ['w', '加速器'],
    ['w', '作弊'],
    ['w', '全季票'],
    ['w', '季票'],
    ['w', 'pc'],
    ['w', 'vr'],
    ['w', '3d'],
    ['w', 'hd'],
    ['re', 'build[.\\s]*\\d+'],
    ['re', '\\d+[\\d.]*'],
    ['re', 'v[\\d.]+']
  ],

  // cleanPageTitle 尾段剥离词（"(下载|游戏下载|...).*$" 尾段清空语义，保序）。
  // Page-title tail-strip words (delete-to-end semantics; order preserved).
  titleTailStripWords: ['下载', '游戏下载', '免费下载', '破解版', '汉化版', '中文版', '绿色版', '免安装'],

  // 版本后缀对照（中文标题后缀 → 英文官方后缀；findVersionVariant 消费）。
  // Version-suffix pairs (CN suffix → EN official suffix).
  versionSuffixes: [
    ['增强版', 'Enhanced'],
    ['重制版', 'Remastered'],
    ['复刻版', 'Remake'],
    ['豪华版', 'Deluxe'],
    ['终极版', 'Ultimate'],
    ['年度版', 'Game of the Year'],
    ['典藏版', 'Collector'],
    ['黄金版', 'Gold']
  ],

  // 附属内容关键词（ADDON_NAME_PATTERN：非本体条目识别）。'b' = \b 边界包裹
  // （防误伤 ghost/post 等合法名），中文词与短语无边界（与旧字面量一致）。
  // Add-on keywords ('b' = \b-wrapped to spare names like Ghost; CN words and
  // phrases are bare, matching the legacy literal).
  addonKeywords: [
    ['b', 'demo'],
    ['w', '试玩'],
    ['b', 'trial'],
    ['w', 'prologue'],
    ['w', '序章'],
    ['w', '序幕'],
    ['b', 'soundtrack'],
    ['b', 'ost'],
    ['b', 'artbook'],
    ['b', 'dlc'],
    ['w', 'supporter pack'],
    ['w', '支持者包'],
    ['w', 'fan pack'],
    ['w', 'wallpaper'],
    ['w', 'screenshot'],
    ['w', '原声带'],
    ['w', '美术集'],
    ['w', '设定集'],
    ['w', '艺术集'],
    ['w', '画集'],
    ['w', '壁纸'],
    ['w', '原画集'],
    ['w', '收藏版'],
    ['w', '内容包'],
    ['w', '扩展包'],
    ['w', '追加内容'],
    ['w', '组合包']
  ],

  // Demo/试玩版标识（isDemo 徽章）/ Demo-trial edition markers (isDemo badge).
  demoKeywords: [
    ['b', 'demo'],
    ['w', '试玩'],
    ['b', 'trial']
  ],

  // 版本词（交叉验证覆盖判据排除表——命中名缺版本后缀属正常，EDITION_WORDS）。
  // Edition words (excluded from the coverage cross-check; a hit name missing
  // the edition suffix is expected).
  editionWords: [
    'edition',
    'enhanced',
    'deluxe',
    'upgrade',
    'remastered',
    'remaster',
    'definitive',
    'complete',
    'goty',
    'bundle',
    'collection',
    'demo',
    'trial'
  ]
};

/**
 * 转义正则字面量特殊字符（字面词编译用）/ Escape regex literals for word lists.
 * @param {string} s
 */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 单条目编译为正则源片段 / Compile one entry into a regex source fragment.
 * @param {VocabEntry} entry
 */
function entrySource([kind, value]) {
  if (kind === 'w') return escapeRe(value);
  if (kind === 'b') return `\\b${escapeRe(value)}\\b`;
  return value; // 're'：片段原样（校验时已确认可编译）/'re': verbatim (validated)
}

/**
 * 词表校验（结构/类型/去重/正则片段可编译）。返回错误消息数组，空 = 合法。
 * v14.7 批次 12（R2）：参数化——内置词表与规则包覆盖数据共用同一校验。
 * Validate the vocab; returns error messages (empty = valid).
 * @param {{version: number, noiseTitle: VocabEntry[], noiseEnWords: string[], junkCandidateWords: VocabEntry[], titleTailStripWords: string[], versionSuffixes: Array<[string, string]>, addonKeywords: VocabEntry[], demoKeywords: VocabEntry[], editionWords: string[]}} [target] - 缺省校验内置词表
 * @returns {string[]}
 */
export function validateRetrievalVocab(target) {
  const errors = [];
  const v = target || RETRIEVAL_VOCAB;
  /** @param {unknown} x */
  const isStrArr = (x) => Array.isArray(x) && x.length > 0 && x.every((w) => typeof w === 'string' && w.length > 0);
  if (v.version !== 1) errors.push('version 必须为 1');
  // 条目序列校验：kind 合法 + 值非空 + 正则片段可编译 + 字面词不重复
  // Entry checks: known kind, non-empty value, compilable fragments, no dup words
  /** @param {string} key @param {string[]} kinds */
  const checkEntries = (key, kinds) => {
    const arr = v[key];
    if (!Array.isArray(arr) || arr.length === 0) {
      errors.push(`${key} 必须为非空条目数组`);
      return;
    }
    const words = new Set();
    for (const e of arr) {
      if (!Array.isArray(e) || e.length !== 2 || !kinds.includes(e[0]) || typeof e[1] !== 'string' || !e[1]) {
        errors.push(`${key} 条目形态非法: ${JSON.stringify(e)}`);
        continue;
      }
      if (e[0] === 're') {
        try {
          new RegExp(e[1]);
        } catch (err) {
          errors.push(`${key} 正则片段不可编译: ${e[1]} (${String(err)})`);
        }
      } else if (e[0] === 'w') {
        if (words.has(e[1])) errors.push(`${key} 重复字面词: ${e[1]}`);
        words.add(e[1]);
      }
    }
  };
  checkEntries('noiseTitle', ['w', 're']);
  checkEntries('addonKeywords', ['b', 'w']);
  checkEntries('demoKeywords', ['b', 'w']);
  checkEntries('junkCandidateWords', ['w', 're']);
  for (const key of ['noiseEnWords', 'titleTailStripWords', 'editionWords']) {
    if (!isStrArr(v[key])) errors.push(`${key} 必须为非空字符串数组`);
  }
  if (
    !Array.isArray(v.versionSuffixes) ||
    v.versionSuffixes.length === 0 ||
    !v.versionSuffixes.every((p) => Array.isArray(p) && p.length === 2 && p.every((s) => typeof s === 'string'))
  ) {
    errors.push('versionSuffixes 必须为 [cn, en] 对数组');
  }
  return errors;
}

/** @type {{version: number, noiseTitle: VocabEntry[], noiseEnWords: string[], junkCandidateWords: VocabEntry[], titleTailStripWords: string[], versionSuffixes: Array<[string, string]>, addonKeywords: VocabEntry[], demoKeywords: VocabEntry[], editionWords: string[]}} */
let activeVocab = RETRIEVAL_VOCAB; // v14.7 批次 12：当前生效词表（内置或合并覆盖）

/** @type {ReturnType<typeof compileRules>|null} */
let compiledCache = null;

/**
 * 实际编译（getCompiledRetrievalRules 的单例体）/ The compile body (singleton).
 */
function compileRules() {
  const v = activeVocab; // v14.7 批次 12：编译当前生效词表（内置或合并覆盖）
  // 中文标题噪声：保序拼接——test 用（无 g，lastIndex 状态残留防护，v3.4.1
  // 教训）与 replace 用（g，清掉每一处噪声）双版本由同一 source 构造。
  const noiseSource = v.noiseTitle.map(entrySource).join('|');
  const tailSource = v.titleTailStripWords.map(escapeRe).join('|');
  const addonSource = v.addonKeywords.map(entrySource).join('|');
  const demoSource = v.demoKeywords.map(entrySource).join('|');
  const junkSource = v.junkCandidateWords.map(entrySource).join('|');
  return {
    noisePattern: new RegExp(noiseSource, 'i'),
    noisePatternAll: new RegExp(noiseSource, 'gi'),
    titleTailStripPattern: new RegExp(`(?:${tailSource}).*$`, 'i'),
    addonNamePattern: new RegExp(addonSource, 'i'),
    demoNamePattern: new RegExp(demoSource, 'i'),
    junkCandidatePattern: new RegExp(`^(?:${junkSource})$`, 'i'),
    noiseEnWords: new Set(v.noiseEnWords),
    editionWords: new Set(v.editionWords),
    versionSuffixes: v.versionSuffixes
  };
}

/**
 * 编译词表为各消费端正则/集合（模块级惰性单例——启动一次，之后零开销）。
 * 编译语义与 R1 前的字面量版本 1:1 等价（golden 测试 + 错题库门禁）。
 * v14.7 批次 12（R2 第一步）：消费侧"用时取用"——本函数每次调用返回当前
 * 缓存；词表热更（规则包覆盖）经 invalidateRetrievalRulesCache 失效后，
 * 下一次调用自动以新词表重编译。
 * Compile the vocab into regexes/sets (lazy singleton; semantics identical to
 * the pre-R1 literals). Consumers fetch per-use; a vocab hot-update
 * invalidates the cache and the next call recompiles.
 */
export function getCompiledRetrievalRules() {
  if (!compiledCache) compiledCache = compileRules();
  return compiledCache;
}

/**
 * 失效编译缓存（R2 热更入口：词表数据变更后调用，下一次消费即重编译）。
 * 内置词表常量本身不可变——失效只影响"覆盖词表"场景（批次 12 第二步的
 * 规则包下发）与测试隔离。
 * Invalidate the compiled cache (R2 hot-update entry; the next consumer call
 * recompiles from the current vocab data).
 */
export function invalidateRetrievalRulesCache() {
  compiledCache = null;
}

/**
 * v14.7 批次 12（R2 第二步骨架）：词表覆盖应用——规则包下发的词表数据与
 * 内置**键级合并**（数组键 override 追加在后，内置在前；保序语义=追加不
 * 重排），校验通过才生效并失效编译缓存，失败返回错误数组（调用方保持
 * 内置词表 = 回退语义）。
 * Apply a vocab override from a rule package: key-wise merge (override
 * arrays append after the built-ins), validate, then invalidate — on
 * validation failure the built-in vocab stays in effect (fallback).
 * @param {{version?: number, noiseTitle?: VocabEntry[], noiseEnWords?: string[], junkCandidateWords?: VocabEntry[], titleTailStripWords?: string[], versionSuffixes?: Array<[string, string]>, addonKeywords?: VocabEntry[], demoKeywords?: VocabEntry[], editionWords?: string[]}} override
 * @returns {string[]} 校验错误（空 = 已生效）
 */
export function applyVocabOverride(override) {
  if (!override || typeof override !== 'object') return ['override 必须为对象'];
  // 显式非法（键存在但形态错误）→ 拒绝整包：静默 no-op 会掩盖损坏的规则包
  // （调用方"applied=true"的语义是"覆盖已生效"，no-op 成功是谎报）。
  // A known key present but malformed rejects the WHOLE override — a silent
  // no-op would mask a corrupt rule package behind applied=true.
  for (const key of [
    'noiseTitle',
    'noiseEnWords',
    'junkCandidateWords',
    'titleTailStripWords',
    'versionSuffixes',
    'addonKeywords',
    'demoKeywords',
    'editionWords'
  ]) {
    const v = override[key];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.length === 0) return [`${key} 覆盖必须为非空数组`];
  }
  const merged = { ...RETRIEVAL_VOCAB };
  for (const key of [
    'noiseTitle',
    'noiseEnWords',
    'junkCandidateWords',
    'titleTailStripWords',
    'versionSuffixes',
    'addonKeywords',
    'demoKeywords',
    'editionWords'
  ]) {
    const extra = override[key];
    if (Array.isArray(extra) && extra.length > 0) {
      merged[key] = [...merged[key], ...extra]; // 追加语义：内置在前，保序不重排
    }
  }
  const errors = validateRetrievalVocab(merged);
  if (errors.length > 0) return errors;
  activeVocab = merged;
  invalidateRetrievalRulesCache();
  return [];
}

/** 当前生效词表重置为内置（回退/测试用）/ Reset to the built-in vocab. */
export function resetVocabOverride() {
  activeVocab = RETRIEVAL_VOCAB;
  invalidateRetrievalRulesCache();
}
