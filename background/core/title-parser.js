// @ts-strict
/**
 * 游戏雷达 Game Radar - 游戏标题解析 / Game Title Parser
 *
 * 从下载站标题中解析可用于 Steam 搜索的候选名称（去噪声、分段、
 * 中英文子串提取、优先级排序）。
 * Parses searchable name candidates from download-site titles (noise removal,
 * segmentation, CN/EN substring extraction, priority ordering).
 *
 * v3.4.1：由 background/steam/ 下沉至 core/ —— 纯函数工具被 storage 层
 * （name-index）与业务层共用，下沉后恢复 core→storage→业务层 单向依赖。
 * v14.6.3：噪声词表单源下沉 shared/retrieval-vocab.js（R1 词表数据层）。
 */
import { getCompiledRetrievalRules } from '../../shared/retrieval-vocab.js';

// 噪声词表（下载站标题常见修饰/版本词）：v14.6.3 R1 单源 = shared/retrieval-vocab.js
// （保序词条数据），此处只消费编译产物——test 用（无 g，lastIndex 状态残留
// 防护，v3.4.1 教训）与 replace 用（g，清掉每一处噪声）双版本由词表模块提供。
// Noise vocab: single source = shared/retrieval-vocab.js (ordered entries);
// this module only consumes the compiled patterns (no-g for .test, g for
// .replace — both built from one source by the vocab module).
// v14.7 批次 12（R2 第一步）：消费侧"用时取用"——词表热更（规则包覆盖）
// 经 invalidateRetrievalRulesCache 失效后，下一次解析即用新词。编译单例
// 缓存命中，开销为一次函数调用。
// Fetch compiled rules per use so a vocab hot-update takes effect on the
// next parse (compiled singleton keeps this a cheap call).
/** 局部别名：当前编译产物 / local alias for the current compiled rules */
const retrievalRules = getCompiledRetrievalRules;
const noisePatternOf = () => retrievalRules().noisePattern;
const noisePatternAllOf = () => retrievalRules().noisePatternAll;
const junkPatternOf = () => retrievalRules().junkCandidatePattern;
// 判断整段是否仅由噪声词组成 / Is a segment pure noise?
function isPureNoise(text) {
  const stripped = text.replace(noisePatternAllOf(), '').replace(/[\s\|\-:：、]+/g, '');
  return stripped.length === 0;
}

// 分段：移除括号/书名号后按 |、带空格连字符、中文分隔符 ×•· 与冒号拆分
// （v3.3.8 加冒号：官方中文名常为 "英文名: 中文名" 形式，如 "Windrose: 风启之旅"，
// 下载站只认 "Windrose" 或 "风启之旅"——整段带冒号搜索全部落空，必须分段）
// Split a title into segments (brackets removed; |, spaced dashes, ×•· and
// colons split — CN names are often "English: 中文" like "Windrose: 风启之旅",
// and download sites only match either half, so colons must split).
function splitTitleSegments(rawName) {
  if (!rawName) return [];
  if (typeof rawName !== 'string') rawName = String(rawName); // v10.9：边界防御
  const name = rawName
    .trim()
    .replace(/[\(\[\【].*?[\)\]\】]/g, '')
    .replace(/[《》]/g, '');
  return name
    .split(/[|]+|\s+[-–—]\s+|[×•·]|[:：]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

/**
 * 解析游戏标题为搜索候选列表（最多 5 个，按优先级排序）
 * 分段规则：|、" -" 及中文分隔符 ×•·（× 常见于译名如"地城英雄×龙与地下城"）。
 * Parse a title into search candidates (max 5, priority-ordered).
 * Segmentation: |, spaced dashes and CN separators ×•·.
 */
export function parseGameTitle(rawName) {
  if (!rawName) return [];

  const rawParts = splitTitleSegments(rawName);

  const candidates = [];
  const seen = new Set();
  function addCandidate(text) {
    const t = text.trim().replace(/\s+/g, ' ');
    if (t.length >= 2 && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      candidates.push(t);
    }
  }

  for (const part of rawParts) {
    if (isPureNoise(part)) continue;

    // 版本/DLC 信息段（含 Build/DLC/全DLC/版本号）整体跳过——其中的
    // DLC 名（如"初心请鞭"）不是游戏主名，不应成为搜索候选
    // Skip version/DLC info segments entirely: DLC names must not become
    // search candidates (e.g. "初心请鞭" matched a DLC instead of the base game)
    if (/\bDLC\b|Build[.\s]*\d+|^V?\d+\.\d+/.test(part)) continue;

    // 1) 整段清洗后作为候选（保留主名，去掉噪声词）
    const cleaned = part.replace(noisePatternAllOf(), ' ').replace(/\s+/g, ' ').trim();
    if (cleaned.length >= 2) addCandidate(cleaned);

    // 2) 英文子串作为补充候选（v3.3.8：去除尾随冒号等标点——贪婪匹配会把
    //    "Windrose: 风启之旅" 抽出 "Windrose:"，下载站搜不到）
    const en = part.match(/[A-Za-z][A-Za-z0-9\s':&.!\-]+[A-Za-z0-9'.!]?/g);
    if (en)
      en.forEach((m) => {
        const cleanedEn = m
          .replace(noisePatternAllOf(), ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/[:：\s\-]+$/g, '');
        if (cleanedEn.length >= 2) addCandidate(cleanedEn);
      });

    // 3) 中文子串作为补充候选（同样清洗噪声词，避免"抢先试玩"等污染搜索词）
    //    CN substring candidates (also noise-cleaned to keep search terms clean)
    const cn = part.match(/[\u4e00-\u9fff\u3400-\u4dbf][\u4e00-\u9fff\u3400-\u4dbf0-9\s:：!！]+/g);
    if (cn)
      cn.forEach((m) => {
        const cleanedCn = m.replace(noisePatternAllOf(), ' ').replace(/\s+/g, ' ').trim();
        if (cleanedCn.length >= 2) addCandidate(cleanedCn);
      });
  }

  if (candidates.length === 0) {
    // 兜底：整名清理后仍须是有效名称（纯噪声/仅残留分隔符时不生成候选）
    // Fallback: the cleaned whole name must still be a valid title; pure-noise
    // or separator-only leftovers produce no candidates
    const fallback = splitTitleSegments(rawName)
      .join(' ')
      .replace(noisePatternAllOf(), ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const strippedFallback = fallback.replace(/[\s\|\-:：、]+/g, '');
    if (strippedFallback.length >= 2) addCandidate(fallback);
  }

  // v14.6.3 R1：junk 单 token 过滤词表单源 = shared/retrieval-vocab.js
  //（junkCandidatePattern，^锚定形态由词表模块编译）
  const filtered = candidates.filter((c) => !junkPatternOf().test(c.trim()));
  const finalCandidates = filtered.length > 0 ? filtered : candidates;

  // 无任何有效候选时返回空数组 / Return [] when no valid candidates exist
  if (finalCandidates.length === 0) return [];

  const first = finalCandidates[0];
  const rest = finalCandidates.slice(1);
  // 优先英文（更易在 Steam 搜到），同语言时按长度降序
  rest.sort((a, b) => {
    const aIsEnglish = /^[A-Za-z]/.test(a);
    const bIsEnglish = /^[A-Za-z]/.test(b);
    if (aIsEnglish && !bIsEnglish) return -1;
    if (!aIsEnglish && bIsEnglish) return 1;
    return b.length - a.length;
  });

  return [first, ...rest].slice(0, 5);
}

// 清洗游戏名（取第一个候选）/ Clean a game name (first candidate)
export function cleanGameName(name) {
  const candidates = parseGameTitle(name);
  return candidates[0] || name || '';
}

// 选择注册表英文名：优先下载站标题中的英文段（与站点一致），
// 回退 Steam 官方英文名（可能为全大写形式）。
// Pick the registry EN name: the EN segment from the download-site title first,
// falling back to the Steam official EN name (may be ALL-CAPS).
export function pickRegistryEnName(gameName, steamEnName) {
  const enFromTitle = parseGameTitle(gameName || '').find((t) => /^[A-Za-z]/.test(t));
  return enFromTitle || steamEnName || '';
}

// ============ 自适应检索（v3.1.2） / Adaptive search ============

// 生成扩展搜索变体（静态候选全部失败时使用）：
//   尾部逐词删除（最多 3 层）→ 头部删 1 词 → 动态噪声词移除；
//   静态噪声清洗 + 去重；每段最多 4 个，总上限 8 个。
// Generate extended search variants (used when all static candidates fail):
// tail-word removal (≤3), head-word removal, dynamic-noise removal; cleaned &
// deduped; ≤4 per segment, ≤8 in total.
export function generateSearchVariants(rawName, extraNoiseWords = []) {
  const extra = (extraNoiseWords || [])
    .filter((w) => typeof w === 'string' && w.length >= 2)
    .map((w) => w.toLowerCase());
  const variants = [];
  const seen = new Set();
  const add = (text) => {
    const cleaned = text.replace(noisePatternAllOf(), ' ').replace(/\s+/g, ' ').trim();
    const key = cleaned.toLowerCase();
    if (cleaned.length >= 2 && !seen.has(key)) {
      seen.add(key);
      variants.push(cleaned);
    }
  };
  for (const seg of splitTitleSegments(rawName)) {
    if (isPureNoise(seg)) continue;
    const words = seg.split(/\s+/).filter((w) => w.length >= 2);
    if (words.length < 2) continue;
    // a. 尾部逐词删除（噪声多在尾部，如"抢先试玩/解压即撸"）
    for (let i = 1; i <= Math.min(3, words.length - 1); i++) {
      add(words.slice(0, words.length - i).join(' '));
    }
    // b. 头部删 1 词（防前置噪声）
    add(words.slice(1).join(' '));
    // c. 动态噪声词移除（已学习确认的词直接删除）
    const kept = words.filter((w) => !extra.includes(w.toLowerCase()));
    if (kept.length > 0 && kept.length < words.length) add(kept.join(' '));
    if (variants.length >= 8) break;
  }
  return variants.slice(0, 8);
}

// 从"成功搜索词 vs 原始标题"中提取候选噪声词（供自动学习计数）。
// 仅取成功词所在段的其他词；排除静态噪声表已覆盖的词（避免重复学习）。
// Extract candidate noise words from the gap between the raw title and the
// successful search term (words in the same segment, excluding known static
// noise). Counted over time; only recurring words become active.
export function extractNoiseCandidates(rawName, successTerm) {
  if (!rawName || !successTerm) return [];
  const found = [];
  for (const seg of splitTitleSegments(rawName)) {
    if (!seg.includes(successTerm) || seg.length <= successTerm.length) continue;
    const remainder = seg
      .replace(successTerm, '')
      .replace(/[\s\|\-:：、]+/g, ' ')
      .trim();
    if (!remainder) continue;
    for (const w of remainder.split(/\s+/)) {
      if (w.length < 2 || w.length > 10) continue;
      if (!/[\u4e00-\u9fff]/.test(w)) continue; // 主要学习中文修饰词 / CN modifiers
      if (noisePatternOf().test(w)) continue; // 静态表已覆盖的不学
      if (!found.includes(w)) found.push(w);
    }
  }
  return found;
}
