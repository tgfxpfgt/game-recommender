/**
 * 游戏雷达 Game Radar - 匹配置信度三态 / Match Confidence (v14.28.7 R4-B2)
 *
 * 用户二次校准（2026-11-11，替换 v14.28.6 的"年份缺失即推测"）：
 * 1. **平台不一致 → 推测**（含主机/移动/云游戏标题命中 Steam 同名条目）——
 *    错配主因，必须最优先判；
 * 2. **年份**：一侧缺失**不降级**；两侧都有且相差 **> 1 年** → 推测；
 * 3. **标题相似度**是主门槛，达不到阈值 → 推测（确认必须有实际门槛）。
 * 数据来源只作为"推测依据"展示，不作为确认捷径；任何来源走同一把尺子。
 * Platform mismatch is judged first (console/mobile/cloud titles hitting a
 * same-name Steam entry). A missing year never downgrades; only a gap of more
 * than one year does. Title similarity is the main gate. Source is evidence
 * only, never a confirmation shortcut.
 */
import { trimPlatformTokens } from '../../shared/platform-detect.js';
import { cjkBigramDice } from './api-search.js';

export const MATCH_CONFIRMED = 'confirmed';
export const MATCH_SUSPECTED = 'suspected';

// 标题相似度门槛（用户裁决：确认必须有实际门槛）。达到即过标题门，否则一律
// 推测。阈值不在业务代码本地放宽——分布实测若推测过半，报告数字由用户决定。
// Title-similarity gate. Threshold is not loosened locally; if the measured
// distribution has more than half suspected, report the numbers instead.
export const TITLE_SIMILARITY_THRESHOLD = 0.75;

// 数据来源标签（仅用于"推测依据"展示，不参与置信度判定）
// Source labels: evidence only, never a gate.
export const MATCH_SOURCE_LABELS = {
  image: '页面封面图 appId',
  url: '详情页网址索引',
  index: '名称索引缓存',
  correction: '用户报错纠正记录',
  directory: 'Steam 全量目录精确命中',
  storesearch: 'Steam 商店搜索',
  english: '英文名兜底搜索',
  community: 'Steam 社区搜索',
  probe: '站点详情页内嵌信号',
  unknown: '未知来源'
};

const REASON_TEXT = {
  'all-match': '标题一致，平台为 PC，发行年份相符',
  'year-unknown': '标题一致，平台为 PC；发行年份仅一侧可知（不降级）',
  'no-result-name': 'Steam 结果未返回标题，无法核对',
  'platform-unconfirmed': '未能确认是 PC 版本（主机/移动/云游戏同名条目）',
  'title-mismatch': '匹配标题与页面标题相似度不足',
  'year-mismatch': '页面年份与 Steam 发行年份相差超过 1 年',
  'user-correction': '用户已确认的映射（人工纠正记录）'
};

/**
 * 从日期串提取发行年份（支持 "2022-02-25" / "2022年2月25日" / "2022"）。
 * Release year out of a Steam date string; null when unparsable.
 * @param {string} value
 * @returns {number|null}
 */
export function yearOfDateString(value) {
  const m = String(value || '').match(/(\d{4})/);
  if (!m) return null;
  const y = Number(m[1]);
  return y >= 1970 && y <= 2100 ? y : null;
}

/**
 * 从页面标题提取发行年份（仅接受**独立段**的 4 位年份，1990-2035）。
 * 独立段 = 被括号/分隔符/空白包住，避免把游戏名里的数字（如"2077"）当年份。
 * 年份缺失 → null（新规则：一侧缺失不降级，调用方照常比对）。
 * Extract a release year only when it appears as a standalone segment.
 * @param {string} rawTitle
 * @returns {number|null}
 */
export function extractTitleYear(rawTitle) {
  const text = String(rawTitle || '');
  const re = /(?:^|[|丨，,、/\\\s(（\[【])((?:19|20)\d{2})(?=$|[|丨，,、/\\\s)）\]】])/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const y = Number(m[1]);
    if (y >= 1990 && y <= 2035) return y;
  }
  return null;
}

/**
 * 页面标题的**全部身份段**：按站点分隔符（| / 空格破折号）切段，逐段去掉
 * 年份与平台标记。下载站常把官方中英文名并列（"人类/Humankind - 站名"），
 * 逐段比对才能把 Steam 英文名与页面里的英文段对上。
 * All identity segments of a page title: split on site separators (|, /, spaced
 * dash) and strip the year and platform tokens from each. Download sites often
 * list both the Chinese and English official names, so per-segment comparison
 * can match an English Steam result against the page's English segment.
 * @param {string} rawTitle
 * @returns {string[]}
 */
export function pageTitleCores(rawTitle) {
  const parts = String(rawTitle || '')
    .split(/[|丨/／]+|\s+[-–—]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  /** @type {string[]} */
  const out = [];
  for (const part of parts) {
    let text = part;
    const year = extractTitleYear(text);
    if (year !== null) text = text.replace(String(year), ' ');
    // 版本号不是身份（v1.6.155963 / 1.0.3）——先去掉，避免污染序号比对
    // Version tags are not identity; strip them before number comparison.
    text = text.replace(/\bv\d+(?:\.\d+)+\b/gi, ' ').replace(/\b\d+\.\d+(?:\.\d+)+\b/g, ' ');
    // trimPlatformTokens 只用于英文名（它按非字母数字切词，会把 CJK 段吃掉）
    // Only English segments go through trimPlatformTokens (it splits on
    // non-alphanumerics and would otherwise drop CJK text).
    if (!/[\u4e00-\u9fff]/.test(text)) text = trimPlatformTokens(text) || text;
    // 语言标签不是身份（"官方中文/汉化版"等只影响可玩性，不影响是哪款游戏）
    // Language tags are not identity; strip them from the trailing edge only.
    text = text.replace(/(?:官方中文|简体中文|繁体中文|中文版|汉化版|汉化|中文|官中)\s*$/, '').trim();
    text = text.replace(/\s{2,}/g, ' ').trim();
    if (text) out.push(text);
  }
  return out;
}

/**
 * 页面标题的"身份段"（第一段，保留旧导出语义）。身份核对不用检索候选
 * （parseGameTitle 的删词变体会把"王国之泪"拆出"塞尔达传说"误配前作）。
 * First identity segment (backward-compatible export).
 * @param {string} rawTitle
 * @returns {string}
 */
export function pageTitleCore(rawTitle) {
  return pageTitleCores(rawTitle)[0] || '';
}

/** @param {string} s @returns {string} 归一化：小写、去空白与标点 */
function normalizeTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s\-_:：|.'!！?？\[\]()（）×•·™®©]/g, '');
}

/** @param {string} s @returns {Set<string>} 拉丁/数字词元集合 */
function latinTokens(s) {
  return new Set(
    String(s || '')
      .toLowerCase()
      .match(/[a-z0-9]+/g) || []
  );
}

/**
 * 单段相似度（0-1）：完全相等 1 → **序号护栏** → 包含 0.9+ → CJK 二元 Dice
 * → 拉丁词元 Dice。序号护栏：页面身份段带数字时，结果名的数字必须被页面
 * 覆盖（"黑色行动 6" vs "黑色行动 7" 判 0.4，防续作/版本串味）；页面无数字
 * 而结果带数字 → 0.6（无法核对，交给其他段的最大值）。**不做跨语言无条件放行**
 * ——确认必须有实际门槛（用户裁决）。
 * Pairwise similarity: exact → numeric guard → containment → CJK bigram Dice
 * → Latin token Dice. The numeric guard keeps sequel numbers apart. There is no
 * unconditional cross-language pass: confirmation must clear a real threshold.
 * @param {string} resultName
 * @param {string} core
 * @returns {number}
 */
function pairSimilarity(resultName, core) {
  const rn = normalizeTitle(resultName);
  const cn = normalizeTitle(core);
  if (!rn || !cn || rn.length < 2 || cn.length < 2) return 0;
  if (rn === cn) return 1;
  // 序号护栏 / numeric guard
  const nums = (s) => new Set(String(s).match(/\d+/g) || []);
  const rNums = nums(resultName);
  const cNums = nums(core);
  if (cNums.size > 0) {
    for (const n of rNums) if (!cNums.has(n)) return 0.4;
    if (rNums.size === 0) return 0.6;
  } else if (rNums.size > 0) {
    return 0.6;
  }
  let best = 0;
  if (rn.includes(cn)) best = Math.min(1, 0.9 + 0.1 * (cn.length / rn.length));
  else if (cn.includes(rn)) best = Math.min(1, 0.9 + 0.1 * (rn.length / cn.length));
  if (best >= TITLE_SIMILARITY_THRESHOLD) return best;
  const dice = cjkBigramDice(resultName, core);
  if (dice > best) best = dice;
  if (best >= TITLE_SIMILARITY_THRESHOLD) return best;
  const A = latinTokens(resultName);
  const B = latinTokens(core);
  if (A.size > 0 && B.size > 0) {
    let shared = 0;
    for (const t of A) if (B.has(t)) shared++;
    const tokenDice = (2 * shared) / (A.size + B.size);
    if (tokenDice > best) best = tokenDice;
  }
  return best;
}

/**
 * 标题相似度（0-1）：取页面各身份段的最大值。
 * Best similarity across the page title's identity segments.
 * @param {string} resultName
 * @param {string} gameName
 * @returns {number}
 */
export function titleSimilarity(resultName, gameName) {
  let best = 0;
  for (const core of pageTitleCores(gameName)) {
    const s = pairSimilarity(resultName, core);
    if (s > best) best = s;
  }
  return Math.round(best * 100) / 100;
}

/**
 * 标题是否过门槛（主门槛）。
 * Whether the title clears the similarity gate.
 * @param {string} resultName
 * @param {string} gameName
 * @returns {boolean}
 */
export function titleMatches(resultName, gameName) {
  return titleSimilarity(resultName, gameName) >= TITLE_SIMILARITY_THRESHOLD;
}

/**
 * 置信度打标：平台最优先 → 标题主门槛 → 年份（一侧缺失不降级，相差 >1 年
 * 才降级）。返回可直接展示的依据（匹配标题/来源/平台/相似度/原因）。
 * Rate a match: platform first, then the title gate, then the year rule (a
 * missing year never downgrades; only a gap > 1 year does).
 * @param {{
 *   gameName: string,
 *   resultName?: string|null,
 *   platform?: 'pc'|'non-pc',
 *   pageYear?: number|null,
 *   steamYear?: number|null,
 *   source?: string
 * }} input
 * @returns {{confidence: 'confirmed'|'suspected', reason: string, reasonText: string,
 *   resultName: string, source: string, sourceLabel: string, platformLabel: string,
 *   similarity: number, pageYear: number|null, steamYear: number|null}}
 */
export function rateMatchConfidence(input) {
  const gameName = String(input.gameName || '');
  const resultName = String(input.resultName || '');
  /** @type {string} */
  const sourceKey = input.source && MATCH_SOURCE_LABELS[input.source] ? String(input.source) : 'unknown';
  const pageYear = Number.isFinite(input.pageYear) ? Number(input.pageYear) : null;
  const steamYear = Number.isFinite(input.steamYear) ? Number(input.steamYear) : null;
  const platformOk = input.platform === 'pc';
  const similarity = resultName ? titleSimilarity(resultName, gameName) : 0;
  /** @type {{resultName: string, source: string, sourceLabel: string, platformLabel: string,
   *   similarity: number, pageYear: number|null, steamYear: number|null}} */
  const base = {
    resultName,
    source: sourceKey,
    sourceLabel: MATCH_SOURCE_LABELS[sourceKey] || '未知来源',
    platformLabel: platformOk ? 'PC' : '非 PC（主机/移动/云游戏）',
    similarity,
    pageYear,
    steamYear
  };
  /**
   * @param {string} reason
   * @returns {{confidence: 'confirmed'|'suspected', reason: string, reasonText: string,
   *   resultName: string, source: string, sourceLabel: string, platformLabel: string,
   *   similarity: number, pageYear: number|null, steamYear: number|null}}
   */
  const suspected = (reason) => ({
    ...base,
    confidence: /** @type {const} */ ('suspected'),
    reason,
    reasonText: REASON_TEXT[reason] || ''
  });
  // 0) v14.28.13（三目标审查 P1-2）：人工纠正来源强制 confirmed——用户手动确认
  //    的映射优先于自动相似度/平台/年份判定（纠正后仍标「推测」语义不合理；
  //    相似度等字段随 base 携带仅作展示）。单源落点：列表/详情两条管线同函数。
  //    Human correction forces confirmed — user judgment outranks the gates;
  //    single source covers both list and detail pipelines.
  if (sourceKey === 'correction') {
    return { ...base, confidence: 'confirmed', reason: 'user-correction', reasonText: REASON_TEXT['user-correction'] };
  }
  // 1) 平台最优先——错配主因 / platform mismatch comes first
  if (!platformOk) return suspected('platform-unconfirmed');
  // 2) 标题相似度主门槛 / the title gate
  if (!resultName) return suspected('no-result-name');
  if (similarity < TITLE_SIMILARITY_THRESHOLD) return suspected('title-mismatch');
  // 3) 年份：一侧缺失不降级；两侧都有且相差 > 1 年才降级
  //    Missing year on one side never downgrades; a gap > 1 year does.
  let reason = 'year-unknown';
  if (pageYear !== null && steamYear !== null) {
    if (Math.abs(pageYear - steamYear) > 1) return suspected('year-mismatch');
    reason = 'all-match';
  }
  return {
    ...base,
    confidence: MATCH_CONFIRMED,
    reason,
    reasonText: REASON_TEXT[reason]
  };
}
