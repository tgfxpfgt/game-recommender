/**
 * 游戏雷达 Game Radar - Steam 搜索候选生成 / Search candidates
 *
 * v14.27.0（优化方案 P2-10）：自 steam/api-search.js 拆出——本文件承载
 * 候选生成（storesearch 单次/轻量搜索）与名称相关性判定、候选打分等纯函数；
 * 共识裁决在 search-consensus.js，兜底链在 search-fallback.js，api-search.js
 * 保留编排与对外 re-export（import 路径不变）。
 * Split out of api-search.js: candidate generation, relevance checks and scoring.
 * api-search.js keeps orchestration and re-exports so import paths stay stable.
 */
import { recordSteamCall, recordDomainCall } from '../core/api-monitor.js';
import { fetchWithTimeout } from '../core/utils.js';
import { ENDPOINTS } from '../core/constants.js';
import { getCompiledRetrievalRules, invalidateRetrievalRulesCache } from '../../shared/retrieval-vocab.js'; // v14.6.3 R1：词表单源
import { pickConsensusWinner } from './search-consensus.js';

// v14.7 批次 12（R2 第一步）：消费侧"用时取用" + 热更重载——
// · 导出正则用 export let（ESM 活绑定：重赋值对全部消费方可见），词表覆盖
//   更新后 reloadRetrievalRules() 即刻生效；
// · 内部消费（EN 噪声词/版本对照）经取用函数，热路径开销 = 编译单例缓存命中。
// Live bindings + hot-reload: rule-package vocab overrides take effect via
// reloadRetrievalRules(); ESM export-let rebinding propagates to consumers.
export let ADDON_NAME_PATTERN = getCompiledRetrievalRules().addonNamePattern;
export let DEMO_NAME_PATTERN = getCompiledRetrievalRules().demoNamePattern;
const noiseEnWordsOf = () => getCompiledRetrievalRules().noiseEnWords;
export const versionSuffixesOf = () => getCompiledRetrievalRules().versionSuffixes;

/** 词表热更入口（R2 第二步下发通道消费）/ Hot-reload entry for vocab overrides. */
export function reloadRetrievalRules() {
  invalidateRetrievalRulesCache();
  ADDON_NAME_PATTERN = getCompiledRetrievalRules().addonNamePattern;
  DEMO_NAME_PATTERN = getCompiledRetrievalRules().demoNamePattern;
}

// 标题与缓存名是否相关（v3.3.10）：提取双方 CJK/英文词集合（去停用词），
// 任一语言共同词非空 → 相关；双方均为单语言且语言不同 → 跨语言信任；
// 混合语言且无共同词 → 不相关。用于 searchSteamGame 缓存命中校验，
// 防止名称索引粘性条目（历史误写钉死的 appId）命中缓存反复返回错误游戏。
// Title-vs-cached-name relevance (v3.3.10): shared CJK/EN tokens make them
// related; single-language pairs of different languages are trusted across
// languages; mixed-language pairs with no shared token are unrelated. Guards
// cache hits against sticky name-index entries that pin the wrong appId.
export function namesRelated(title, cachedName) {
  const norm = (s) => String(s || '').toLowerCase();
  // 中文词（连续 2+ 汉字）/ CJK tokens
  const cjkWords = (s) => norm(s).match(/[\u4e00-\u9fff\u3400-\u4dbf]{2,}/g) || [];
  // 英文词（≥4 字符，排除 of/the/and/ii 等短词与下载站噪声词）/
  // EN tokens (≥4 chars, excluding short words and download-site noise)
  const enWords = (s) => (norm(s).match(/[a-z][a-z0-9']{3,}/g) || []).filter((w) => !noiseEnWordsOf().has(w));
  const tCjk = cjkWords(title),
    tEn = enWords(title);
  const cCjk = cjkWords(cachedName),
    cEn = enWords(cachedName);
  const hasCommon = (a, b) => a.some((w) => b.includes(w));
  if (hasCommon(tCjk, cCjk) || hasCommon(tEn, cEn)) return true;
  // 跨语言信任：双方均单语言且语言不同（纯英文标题 vs 纯中文缓存名等）
  // v6.4.17：加数字冲突校验——"生化危机9" 跨语言匹配 "Resident Evil 4"
  // （系列旧作）被拒；候选无数字（"Resident Evil Requiem"）不冲突
  const tSingle = tCjk.length === 0 || tEn.length === 0;
  const cSingle = cCjk.length === 0 || cEn.length === 0;
  if (tSingle && cSingle && tCjk.length > 0 !== cCjk.length > 0) {
    return digitSetsOverlap(title, cachedName);
  }
  return false;
}

// v6.4.16：标题核心词提取（CJK 连续 2+ 汉字 + 英文 ≥4 字符，剔除数字段）——
// 供删词变体校验与候选打分使用。规范化小写。
// Core title tokens (CJK runs + EN words) for variant checks and scoring.
// v6.4.17：英文词排除下载站噪声（Build 号/标签等，官方名几乎不会用）——
// 否则 "Build.22898177" 的 build 使标题被判"混合语言"，跨语言信任失效，
// 纯英文官方名（Resident Evil Requiem）被误拒。
// v14.7 批次 12：NOISE_EN_WORDS 改用时取用（noiseEnWordsOf）。
// v14.6.2 修复（审查 A11）：导出单源——orchestrator-detail 的交叉验证 enWordsOf
// 曾是第二套实现（不排噪声词，下载站 Build/crack 段被当内容词污染覆盖判据），
// 现统一消费本函数（噪声词表 NOISE_EN_WORDS 单点维护）。
// Exported as the single source for "EN content words" (noise words filtered);
// the cross-validation in orchestrator-detail now consumes this.
function coreTokensOf(text) {
  const norm = String(text || '').toLowerCase();
  const cjk = norm.match(/[\u4e00-\u9fff\u3400-\u4dbf]{2,}/g) || [];
  const en = (norm.match(/[a-z][a-z0-9']{3,}/g) || []).filter((w) => !noiseEnWordsOf().has(w));
  return [...cjk, ...en];
}
export { coreTokensOf };

// v6.4.17：跨语言数字冲突校验——双方数字集合非空且无交集 → 冲突。
// 用于跨语言信任分支："生化危机9" vs "Resident Evil 4"（{9}∩{4}=∅ 冲突，
// 系列旧作）；"生化危机9" vs "Resident Evil Requiem"（候选无数字不冲突）。
// Digit-conflict guard for cross-language trust (blocks same-series old entries).
export function digitSetsOverlap(a, b) {
  const nums = (s) => (String(s).match(/\d+/g) || []).map((n) => Number(n));
  const na = nums(a);
  const nb = nums(b);
  if (na.length === 0 || nb.length === 0) return true; // 任一无数字 → 不冲突
  return na.some((x) => nb.includes(x));
}

// v14.6.2（审查 A1 加固单源，nameMatchesSearch 数字对齐放行与
// matchCandidateScore 加分共用）——序号语义数字提取：≤2 位数字（系列序号
// "4"），或标题**唯一**数字（"赛博朋克2077" 的 2077 是名本体，虽撞
// 19xx/20xx 年份形态仍参与对齐）；年份噪声（"英雄连2 2024版" 的 2024
// 非唯一）排除。
// Sequence-number extraction shared by the alignment pass and scoring:
// ≤2-digit numbers, or the title's sole number (2077-type name-body),
// excluding non-sole year-shaped noise.
/** @param {string} s @returns {Array<string>} */
export function seqNumsOf(s) {
  // v14.16.0 N10：导出单源（name-index 系列聚合复用）
  const all = String(s).match(/\d+/g) || [];
  const seq = all.filter((n) => n.length <= 2);
  if (seq.length === 0 && all.length === 1) seq.push(all[0]);
  return seq;
}

/**
 * 名称相关性校验（v3.2.2）：防止下载站噪声词/删词变体匹配到无关游戏或续作。
 * 规范化后要求"结果名包含搜索词"；若原始标题中搜索词之后紧跟数字（如
 * "PC Building Simulator 2" 删词后变体缺失"2"），结果名必须也含数字——
 * 精确匹配时同样生效（变体词恰为前作名时拒绝）。
 * Name-relevance check: the result must contain the search term (normalized);
 * when the raw title has a digit right after the term, the result must too
 * (blocks sequel/1st-gen mismatches such as "PC Building Simulator 2" → gen 1,
 * including when the variant term equals the predecessor's exact name).
 * @param {string} resultName - storesearch 结果名
 * @param {string} term - 搜索词
 * @param {string} rawName - 原始下载站标题
 * @returns {boolean} 是否相关
 */
export function nameMatchesSearch(resultName, term, rawName) {
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[\s\-_:：|.'!！?？\[\]()（）×•·]/g, '');
  const rn = norm(resultName);
  const tn = norm(term);
  if (!rn || !tn || rn.length < 2 || tn.length < 2) return false;
  // 纯短英文词（≤3 字母，如 PC/VR/HD）：仅精确匹配接受，防"PC"匹配"Gunner, HEAT, PC!"类
  if (/^[a-z]{1,3}$/.test(tn) && rn !== tn) return false;

  // 续作防护：原始标题中该词后紧跟数字，而结果名无数字 → 视为不相关
  const rawNorm = norm(rawName);
  const idx = rawNorm.indexOf(tn);
  const next = idx >= 0 ? rawNorm[idx + tn.length] : '';
  const digitGap = !!next && /\d/.test(next) && !/\d/.test(rn);
  const cnOf = (s) => /[\u4e00-\u9fff]/.test(s);

  if (rn === tn) return !digitGap;
  if (rn.includes(tn)) return !digitGap;

  // v6.4.19：数字间隔（digitGap）仅对同语言候选拒绝——跨语言候选（中文俗称
  // 标题 vs 英文官方名）允许"官方名无俗称序号"（如 生化危机9 → Resident Evil
  // Requiem：官方未加序号，但互联网习惯加 9）。同语言仍拒绝（防 1 代/旧作）。
  if (digitGap && cnOf(tn) === cnOf(rn)) return false;

  // 跨语言信任：搜索词与结果名一中文一英文时（如英文搜索词命中官方中文名
  // 条目"Gladiator Guild Manager"→"角斗士公会经理"），信任 storesearch 索引
  // 匹配；数字差异（1代/2代）仍拒绝。
  // v6.4.16 收紧：中文搜索词命中英文结果名**不再无条件信任**——schinese
  // 搜索对中文词的英文结果常为索引噪声（新作中文索引缺失时返回任意英文
  // 条目，如"生化危机9" → "Jrago III"类）；仅当原始标题含英文词且与结果
  // 名有共同英文词时才放行。英文搜索词命中中文结果名保留信任。
  // v6.4.19 俗称序号例外：标题含数字（"生化危机9"）且候选无数字（官方名
  // 未加序号 "Resident Evil Requiem"）→ 放行（storesearch 索引相关性保证
  // 候选与搜索词同源）。
  if (cnOf(tn) !== cnOf(rn)) {
    if (cnOf(tn)) {
      // 用原始 resultName 提取英文词（norm 去空格后无法分词）
      const rawEn = coreTokensOf(rawName).filter((w) => /^[a-z]/.test(w));
      const rEn = coreTokensOf(resultName).filter((w) => /^[a-z]/.test(w));
      if (rawEn.length > 0 && rawEn.some((w) => rEn.includes(w))) return true;
      // v14.6.1：数字对齐放行——结果名含与原始标题相同的序号（"生化危机4"
      // → "Resident Evil 4"）是比"无数字"更强的同源信号，置于俗称序号例外
      // 之前：带正确序号的候选不得被"结果须无数字"的旧例外拒绝（gamer520
      // 123938 错配 Requiem 根因——schinese 索引空 → 去数字变体"生化危机"
      // 命中无数字的最新作挤掉带 4 的正主）。
      // v14.6.2 审查加固：数字是弱信号，裸放行曾被实测反例击穿（年份碰撞
      // "英雄连2 2024版"→"F1 2024"）。护栏走 seqNumsOf（模块级单源，与
      // matchCandidateScore 共用）：序号语义 = ≤2 位，或标题唯一数字（如
      // "赛博朋克2077" 的 2077 是名本体，虽撞年份形态仍参与对齐）。残留
      // 风险（纯单数字索引噪声，前提是该游戏 schinese 索引恰为空）由人工
      // 纠正知识库与路线图批次 1"未找到重试"兜底。
      if (seqNumsOf(rawName).some((n) => seqNumsOf(resultName).includes(n))) return true;
      return /\d/.test(rawName) && !/\d/.test(resultName);
    }
    return true;
  }
  return false;
}

// v6.4.16：删词变体校验——结果名除包含搜索词外，还须与原始标题的**其他
// 核心词**有交集。防通用词变体错配：标题"生化危机9 安魂曲"的删词变体
// "安魂曲"会命中任何名字含"安魂曲"的游戏（如"Jrago III 夜之安魂曲"），
// 而它与标题整体无关。变体搜索（扩展组合搜索）专用。
// Variant-search guard: the result must also share a core token with the part
// of the raw title that the variant dropped (blocks generic-word mismatches).
export function nameMatchesSearchVariant(resultName, term, rawName) {
  if (!nameMatchesSearch(resultName, term, rawName)) return false;
  const tn = String(term || '').toLowerCase();
  const others = coreTokensOf(rawName).filter((w) => !tn.includes(w));
  if (others.length === 0) return true;
  const rn = String(resultName || '').toLowerCase();
  // v6.4.19：结果名为纯英文（无 CJK）时，中文"其他核心词"跨语言不可比——
  // 仅校验英文 others（若无英文 others 则交 nameMatchesSearch 的跨语言分支
  // 把关：含搜索词 + 俗称序号/共同英文词例外）
  if (!/[\u4e00-\u9fff]/.test(rn)) {
    const enOthers = others.filter((w) => /^[a-z]/.test(w));
    if (enOthers.length === 0) return true;
    return enOthers.some((w) => rn.includes(w));
  }
  return others.some((w) => rn.includes(w));
}

// v6.4.16：候选相关性打分（多候选排序用）——共同核心词数优先，
// 跨语言（无共同词）得分 0 不再被采用。
// Candidate relevance score for multi-candidate ranking (score 0 = rejected).
export function matchCandidateScore(resultName, term, rawName) {
  const rn = String(resultName || '').toLowerCase();
  const tn = String(term || '').toLowerCase();
  const rTokens = coreTokensOf(resultName);
  const rawTokens = coreTokensOf(rawName);
  let score = 0;
  // 与原始标题的共同核心词（CJK 词 ×2 / 英文词 ×3——英文更稀缺更可信）
  for (const w of rawTokens) {
    if (/^[a-z]/.test(w)) {
      if (rTokens.includes(w)) score += 3;
    } else if (rTokens.includes(w)) {
      score += 2;
    }
  }
  // 搜索词包含关系
  if (rn === tn) score += 2;
  else if (tn.length >= 2 && rn.includes(tn)) score += 1;
  // v14.8 批次 14（三站基准发现）：站点自命名整词包容——候选名包含完整
  // CJK 搜索词（站方对该游戏的中文命名）+3：专属度高于泛化 EN 词覆盖
  //（"死亡空间：重制版" vs 泛化 "Dead Space 2" 的判别器）
  if (/[一-鿿]{2,}/.test(tn) && rn.includes(tn)) score += 3;
  // 数字一致性（v6.4.19：数字集合有交集才加分——"生化危机9" vs "Resident
  // Evil 4" 都有数字但不同，不得加分；"赛博朋克2077" vs "Cyberpunk 2077" 加分）
  // v14.6.2 审查加固：与 nameMatchesSearch 数字对齐放行同护栏（seqNumsOf
  // 模块级单源）——年份碰撞/大数不再加分，标题唯一数字（2077 类名本体）保留
  const numAligned = seqNumsOf(rawName).some((x) => seqNumsOf(resultName).includes(x));
  if (numAligned) score += 1;
  // v14.6.1：跨语言（中文标题 vs 英文候选）时数字对齐是唯一硬序号信号——
  // 追加 +1（合计 2 分），确保带正确序号的候选（生化危机4 → Resident Evil 4）
  // 排序稳定高于无数字例外候选（Requiem 1 分），不受 storesearch 顺序波动影响
  if (numAligned && /[\u4e00-\u9fff]/.test(rawName) && !/[\u4e00-\u9fff]/.test(resultName)) {
    score += 1;
  }
  // v6.4.19：俗称序号例外加分——中文标题含数字（"生化危机9"）、英文候选
  // 无数字（官方名未加序号 "Resident Evil Requiem"）→ 最低 1 分可被采用
  // （storesearch 相关性排序保证候选同源；多个无数字候选按出现顺序取前）
  if (
    /[\u4e00-\u9fff]/.test(rawName) &&
    !/[\u4e00-\u9fff]/.test(resultName) &&
    /\d/.test(rawName) &&
    !/\d/.test(resultName)
  ) {
    score += 1;
  }
  return score;
}

// v9.6.0：候选按 type 筛选与排序——Steam storesearch 的 items 带 type
// 字段（game/dlc/music/series/bundle/software/demo 等）：明确非游戏类型
// （dlc/music/series/bundle/video）在存在游戏候选时剔除（音乐集/原声带/
// DLC 常含游戏名会干扰匹配）；type=game 加排序权重（线索优先）。
// 全为非游戏候选时兜底保留（名称相关性校验仍在，避免无结果）。
// Pure candidate ranker by Steam type (DLC/music excluded when game exists).
const GAME_CANDIDATE_TYPES = new Set(['game', 'software', 'demo']);
export function rankCandidatesByType(items) {
  const all = Array.isArray(items) ? items : [];
  const games = all.filter((i) => GAME_CANDIDATE_TYPES.has(String((i && i.type) || '').toLowerCase()));
  const pool = games.length > 0 ? games : all;
  return pool
    .map((item) => ({ item, typeBonus: String((item && item.type) || '').toLowerCase() === 'game' ? 20 : 0 }))
    .sort((a, b) => b.typeBonus - a.typeBonus)
    .map((r) => r.item);
}

// v14.8.2（详情页信号回捞配套）：CJK 双字组 Dice 相似度——同语言候选的
// 独立复核信号（短名/无 CJK 返回 -1 = 无法判定，调用方跳过）。仅作校验
// 工具，不参与 matchCandidateScore 评分（383ce44 评分实验回退语义不变）。
// CJK character-bigram Dice similarity: an independent validation signal for
// same-language candidates (returns -1 = undecidable; NOT a scoring input).
/** @param {string} a @param {string} b @returns {number} */
export function cjkBigramDice(a, b) {
  /** @param {string} s @returns {Set<string>} */
  const bigrams = (s) => {
    const cjk = (String(s).match(/[\u4e00-\u9fff]/g) || []).join('');
    const out = new Set();
    for (let i = 0; i < cjk.length - 1; i++) out.add(cjk.slice(i, i + 2));
    return out;
  };
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size < 5 || B.size < 5) return -1;
  let shared = 0;
  for (const g of A) if (B.has(g)) shared++;
  return (2 * shared) / (A.size + B.size);
}

// v14.8.2（跨词共识专项，实测 storesearch term=寂静岭 仅返回"黎明杀机-寂静岭"）：
// **外族前缀跨界条目检测**——候选名包含搜索词，但搜索词之前还有一段外族 CJK
// 品牌块（如"黎明杀机-寂静岭"之于标题"寂静岭：陨落小镇"；该 DLC 会经
// resolveDlcToBase 解析成黎明杀机正主 = 错配链）。判外族：前缀块剥离站点
// 修饰词（noiseTitle w 词条——豪华版/重制 等版本后缀不是外族内容）后仍 ≥2 字
// 且不出现在标题规范化文本中。**仅前缀形状**：官方名副标题后缀（"上古卷轴5：
// 天际"的天际）不受影响；不含搜索词的候选（永恒终焉 之于站名 永恒的尽头）
// 不进入本检测。
// v14.8.2 (cross-word consensus): crossover-entry shape — the candidate
// contains the term but carries a FOREIGN CJK brand block BEFORE it ("DBD -
// Silent Hill" for a Silent Hill title); such DLC entries resolve to the
// foreign franchise's main game = the whole mismatch chain.
/** @param {string} resultName @param {string} term @param {string} rawName @returns {boolean} */
export function isCrossoverEntry(resultName, term, rawName) {
  const rn = String(resultName || '');
  const tn = String(term || '').trim();
  if (!rn || tn.length < 2) return false;
  const idx = rn.toLowerCase().indexOf(tn.toLowerCase());
  if (idx <= 0) return false; // 搜索词不在候选名内，或就位于开头（无前缀）
  const rawNorm = String(rawName || '')
    .toLowerCase()
    .replace(/[\s\-_:：|.'!！?？\[\]()（）×•·]/g, '');
  const { noisePatternAll } = getCompiledRetrievalRules(); // 站点修饰词剥离（热更感知）
  const before = rn.slice(0, idx);
  for (const run of before.match(/[\u4e00-\u9fff]{2,}/g) || []) {
    const rest = run.replace(noisePatternAll, ''); // 版本后缀（豪华版/重制 等）不是外族内容
    for (const m of rest.match(/[\u4e00-\u9fff]{2,}/g) || []) {
      if (!rawNorm.includes(m)) return true; // 外族品牌块
    }
  }
  return false;
}

// 单次搜索实现（网络全挂时抛错供外层重试；无结果返回 null 表示"确实未找到"）
// 结果需通过名称相关性校验（防噪声词/删词变体误匹配无关游戏或续作）。
// One search pass (throws on total network failure for outer retry; null = not
// found). Results must pass the name-relevance check.
export async function searchSteamAppIdOnce(searchTerms, rawName, excludeAppId, lang = 'schinese') {
  // v14.8 批次 14（三站基准回放发现）：原实现**按词序首中即返**——第一词的
  // 低分错配候选（如"恶魔城"命中《夜族崛起》恶魔城传奇典藏包，1 分）会抢先
  // 返回，正确候选（"Castlevania" 全词覆盖 10 分）永不被搜索。改**全词扫描
  // 取全局最优**：高确信（≥6=两个英文词覆盖）提前退出控成本，否则扫完所有
  // 词取最高分（跨词比较——与 orchestrator 交叉验证同向）。
  // Scan ALL terms and return the global best candidate (confident hits
  // ≥6 exit early to bound cost).
  const CONFIDENT_SCORE = 6;
  /** @type {{appId: string, name: string, englishName: string, score: number}|null} */
  let globalBest = null;
  // v14.8.2：跨词共识收集——同一 appId 被多个搜索词各自命中为该词最优 →
  // 每多一词 +2（封顶 +4）后参与终选（单词候选分数不变）。锚点护栏：置信
  // 退出（≥6）语义不动，共识只影响"扫完全词后"的终选比较。裁决策略在
  // search-consensus.js（pickConsensusWinner）。
  /** @type {Map<string, {appId: string, name: string, score: number, terms: number}>} */
  const termHits = new Map();
  // 混合标题（含 EN 段）：CJK 候选的早期退出需候选名覆盖 ≥2 个标题 EN 词
  // ——否则泛化 EN 词覆盖（Dead Space 2 的 dead+space=6）会压过 CJK 精准
  // 匹配（"死亡空间：重制版" 7 分）。纯 CJK 标题的 CJK 命中仍是决定性的。
  const enSegment = (String(rawName).match(/[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ0-9 &:.'\-]{5,}/) || [''])[0].trim();
  const mixedTitle = enSegment.length > 0;
  const enWords = mixedTitle ? coreTokensOf(enSegment).filter((w) => /^[a-z]/.test(w)) : [];
  const hasEnCoverage = (name) => enWords.filter((w) => coreTokensOf(name).includes(w)).length >= 2;
  for (const term of searchTerms) {
    /** @type {{total?: number, items: Array<{id: number, name: string, type?: string}>}|null} */
    let cnData = null;
    for (let attempt = 0; attempt < 2 && cnData === null; attempt++) {
      try {
        const resp = await fetchWithTimeout(
          `${ENDPOINTS.steamSearch}?term=${encodeURIComponent(term)}&l=${lang}&cc=cn`
        );
        // v9.7.0：传入 status 且非 2xx 不计成功（与 api-details/reviews 一致）
        recordSteamCall(resp.ok || resp.status === 404, resp.status); // v10.3.0：404=空结果非失败
        recordDomainCall('store', resp.ok || resp.status === 404); // v11.0 B2
        if (resp.status === 404) {
          // v14.10.1（E2E MOCK 回归 5a 根因）：404 = 索引确认无此词 → **终态
          // 空结果**（此前 continue→重试→`!cnData` throw→外层 catch 记失败——
          // 全 miss 场景（MOCK/离线）每项 2 次失败记录 → 失败率 >40% → anomaly
          // 级联 → worker 共享暂停 30s → 批次拖过收尾窗口。404 终态化后 miss
          // 零失败记录，真机语义不变（Steam 检索空词返回 200+空 items，404
          // 仅网络层/离线路径出现）。
          cnData = { total: 0, items: [] };
          break;
        }
        if (!resp.ok) continue;
        cnData = await resp.json();
      } catch {
        recordSteamCall(false, 0); /* 中文搜索失败不阻断流程 */
        recordDomainCall('store', false); // v14.0.0：网络失败计入 store 域熔断
      }
    }

    // 网络失败（两次尝试均未返回）：抛错 → 外层重试一次（抗瞬时抖动）
    if (!cnData) throw new Error('Steam 搜索网络失败');

    // （v14.31.3）cnData 恒真（394 行 throw 兜底）——去掉 CodeQL trivial-conditional
    // 标记的冗余判断
    const cnItems = cnData.items || [];
    if (cnItems.length > 0) {
      // 名称相关性校验：优先非 Demo/附属且与搜索词相关的项；无相关项则尝试下一词
      // v3.3.13：排除曾报错的错误 appid（人工纠正知识库的"黑名单"项）
      // v6.4.16：多候选打分排序——此前取第一个通过者，跨语言/索引噪声
      // 候选会直接中选；现按与完整标题的共同核心词评分，分数 0 不采用
      // v9.6.0：先按 type 排名（game 优先、去 DLC/音乐集），再名称相关性打分
      const typeRanked = rankCandidatesByType(cnItems);
      const related = typeRanked
        .filter(
          (i) =>
            String(i.id) !== String(excludeAppId) &&
            !ADDON_NAME_PATTERN.test(i.name || '') &&
            !isCrossoverEntry(i.name, term, rawName) && // v14.8.2：跨界条目不参选
            nameMatchesSearch(i.name, term, rawName)
        )
        .map((i) => ({ item: i, score: matchCandidateScore(i.name, term, rawName) }))
        .sort((a, b) => b.score - a.score);
      const best = related[0];
      if (!best || best.score < 1) continue;
      // v14.8.2：共识收集（同一 appId 多词命中）
      const hitKey = String(best.item.id);
      const prevHit = termHits.get(hitKey);
      if (prevHit) {
        prevHit.terms += 1;
        prevHit.score = Math.max(prevHit.score, best.score);
      } else {
        termHits.set(hitKey, { appId: best.item.id, name: best.item.name, score: best.score, terms: 1 });
      }
      if (best.score >= CONFIDENT_SCORE && (!mixedTitle || hasEnCoverage(best.item.name))) {
        return {
          appId: best.item.id,
          name: best.item.name,
          englishName: best.item.name
        };
      }
      if (!globalBest || best.score > globalBest.score) {
        globalBest = {
          appId: best.item.id,
          name: best.item.name,
          englishName: best.item.name,
          score: best.score
        };
      }
    }
  }
  if (globalBest) {
    // v14.8.2：终选带跨词共识加成——多词共同命中的候选优先于单词高分候选
    const winner = pickConsensusWinner(globalBest, termHits);
    return {
      appId: winner.appId,
      name: winner.name,
      englishName: winner.name
    };
  }
  return null;
}
