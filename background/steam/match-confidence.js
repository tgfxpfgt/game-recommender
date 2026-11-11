/**
 * 游戏雷达 Game Radar - 匹配置信度三态 / Match Confidence (v14.28.6 R4-B)
 *
 * 用户裁决（2026-11-11）：
 * 1. 确认的**唯一**条件 = 平台 + 标题 + 发行年份三者一致；缺任一 → 推测。
 *    发行年份缺失按缺失处理（禁止"取近似值"补齐）。
 * 2. 推测不得用符号（≈/虚线下划线）表达——徽章文字写「推测」，配色琥珀；
 *    悬停/详情必须给出依据（匹配到的标题 + 数据来源）。
 * 3. 因此"来源"（目录索引/商店搜索/详情页信号…）只作为依据展示，
 *    **不作为**确认条件；任何来源都走同一把尺子。
 * Confirmed requires platform + title + release-year all consistent; anything
 * missing downgrades to "suspected" (never approximated). The source is shown
 * as evidence only, never as a shortcut to "confirmed".
 */
import { trimPlatformTokens } from '../../shared/platform-detect.js';
import { nameMatchesSearch } from './api-search.js';

export const MATCH_CONFIRMED = 'confirmed';
export const MATCH_SUSPECTED = 'suspected';

// 数据来源标签（仅用于"推测依据"展示，不参与置信度判定）
// Source labels: evidence only, never a gate.
export const MATCH_SOURCE_LABELS = {
  image: '页面封面图 appId',
  url: '详情页网址索引',
  index: '名称索引缓存',
  directory: 'Steam 全量目录精确命中',
  storesearch: 'Steam 商店搜索',
  english: '英文名兜底搜索',
  community: 'Steam 社区搜索',
  probe: '站点详情页内嵌信号',
  unknown: '未知来源'
};

const REASON_TEXT = {
  'all-match': '平台、标题、发行年份三项一致',
  'no-result-name': 'Steam 结果未返回标题，无法核对',
  'platform-unconfirmed': '未能确认是 PC 版本',
  'title-mismatch': '匹配标题与页面标题不一致',
  'no-page-year': '页面标题未含发行年份，无法核对年份',
  'no-steam-year': 'Steam 未返回发行日期，无法核对年份',
  'year-mismatch': '页面年份与 Steam 发行年份不一致'
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
 * 年份缺失 → null（调用方按"缺失即推测"处理，不做近似补齐）。
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
 * 页面标题的"身份段"：去掉站点分隔符后的后缀（|官方中文）、年份、平台标记。
 * 用于**身份核对**（不是检索）——检索候选（parseGameTitle 的删词变体）会把
 * "塞尔达传说：王国之泪"拆出"塞尔达传说"从而误配前作，不能拿来判同一性。
 * Identity segment of a page title: strip site suffixes, the year and platform
 * tokens. Search variants are intentionally NOT used here (too loose).
 * @param {string} rawTitle
 * @returns {string}
 */
export function pageTitleCore(rawTitle) {
  const year = extractTitleYear(rawTitle);
  let text = String(rawTitle || '').split(/[|丨/]/)[0];
  if (year !== null) text = text.replace(String(year), ' ');
  text = trimPlatformTokens(text) || text;
  return text.replace(/\s{2,}/g, ' ').trim();
}

/**
 * 标题一致性：Steam 结果名 vs 页面标题身份段（复用检索同源判定，但输入是
 * 身份段，避免删词变体与"续作序号"误判）。
 * Title consistency on the identity segment (not the loose search variants).
 * @param {string} resultName
 * @param {string} gameName
 * @returns {boolean}
 */
export function titleMatches(resultName, gameName) {
  const core = pageTitleCore(gameName);
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[\s\-_:：|.'!！?？\[\]()（）×•·]/g, '');
  const rn = norm(resultName);
  const cn = norm(core);
  if (!rn || !cn || rn.length < 2 || cn.length < 2) return false;
  if (rn === cn) return true;
  // 页面标题比 Steam 名长（带"豪华版/决定版"等后缀）→ 同一身份
  if (rn.includes(cn)) return true;
  // 反向：Steam 名比页面标题长——多出来的必须是纯修饰词，带序号即不同代
  if (cn.includes(rn)) return !/\d/.test(cn.replace(rn, ''));
  // 其余交检索同源判定（跨语言等语义规则单源）
  return nameMatchesSearch(resultName, core, core);
}

/**
 * 三要素打标。任一要素不成立/缺失 → suspected（并给出可直接展示的 reasonText）。
 * @param {{
 *   gameName: string,
 *   resultName?: string|null,
 *   platform?: 'pc'|'non-pc',
 *   pageYear?: number|null,
 *   steamYear?: number|null,
 *   source?: string
 * }} input
 * @returns {{confidence: 'confirmed'|'suspected', reason: string, reasonText: string,
 *   resultName: string, source: string, sourceLabel: string, pageYear: number|null, steamYear: number|null}}
 */
export function rateMatchConfidence(input) {
  const gameName = String(input.gameName || '');
  const resultName = String(input.resultName || '');
  /** @type {string} */
  const sourceKey = input.source && MATCH_SOURCE_LABELS[input.source] ? String(input.source) : 'unknown';
  const pageYear = Number.isFinite(input.pageYear) ? Number(input.pageYear) : null;
  const steamYear = Number.isFinite(input.steamYear) ? Number(input.steamYear) : null;
  /** @type {{resultName: string, source: string, sourceLabel: string, pageYear: number|null, steamYear: number|null}} */
  const base = {
    resultName,
    source: sourceKey,
    sourceLabel: MATCH_SOURCE_LABELS[sourceKey] || '未知来源',
    pageYear,
    steamYear
  };
  /**
   * @param {string} reason
   * @returns {{confidence: 'confirmed'|'suspected', reason: string, reasonText: string,
   *   resultName: string, source: string, sourceLabel: string, pageYear: number|null, steamYear: number|null}}
   */
  const suspected = (reason) => ({
    ...base,
    confidence: /** @type {const} */ ('suspected'),
    reason,
    reasonText: REASON_TEXT[reason] || ''
  });
  if (!resultName) return suspected('no-result-name');
  if (input.platform !== 'pc') return suspected('platform-unconfirmed');
  if (!titleMatches(resultName, gameName)) return suspected('title-mismatch');
  if (pageYear === null) return suspected('no-page-year');
  if (steamYear === null) return suspected('no-steam-year');
  if (pageYear !== steamYear) return suspected('year-mismatch');
  return {
    ...base,
    confidence: MATCH_CONFIRMED,
    reason: 'all-match',
    reasonText: REASON_TEXT['all-match']
  };
}
