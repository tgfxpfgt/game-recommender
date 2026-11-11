/**
 * 游戏雷达 Game Radar - 详情页搜索管线 / Detail-Page Search Pipeline
 *
 * v14.3.0（第五轮 B4）：由 orchestrator.js 拆分——searchSteamGame 全流程：
 * 名称索引 → 人工纠正知识库 → 动态缓存（含 Demo 自愈）→ 兜底搜索
 * （Bing/LLM）→ 完整详情 → 三层缓存写入。
 * The detail-page pipeline: name index → wrong-report corrections → dynamic
 * cache (demo self-heal) → fallback search (Bing/LLM) → full details →
 * 3-layer cache writes.
 * v14.14.0（重构序 6b）：searchSteamGame ~272 行拆分——缓存命中判定
 * tryCacheServed / 搜索流 searchAppIdFlow / 详情获取 fetchDetailsResolveDlc /
 * 缓存写入 writeSearchCaches 提为模块函数；主函数只做编排（行为不变）。
 * searchSteamGame split: cache-hit check, search flow, detail fetch and
 * cache writes extracted as module functions; the main fn only orchestrates.
 */
import {
  searchSteamAppId,
  searchCommunityApps,
  fetchSteamFullDetailsByAppId,
  isDemoAppId,
  ensureRegistryEntry,
  ensureValidRegistryNames,
  needsRatingRefetch,
  hasInvertedReviewCounts, // v14.21.0：评价数倒挂污染指纹（旧回退误写条目自愈）
  isCompleteCacheData,
  namesRelated,
  coreTokensOf // v14.6.2 审查 A11：英文内容词单源（排噪声词）
} from './api.js';
import {
  isModuleValid,
  getModuleData,
  getMergedData,
  getSteamCacheEntry,
  setSteamCacheEntry
} from '../storage/steam-cache.js';
import { recordGameInRegistry } from '../storage/registry.js';
import {
  lookupAppIdByName,
  recordNameIndex,
  isRecentlySearchedNotFound,
  deleteNameIndexEntry
} from '../storage/name-index.js';
import { lookupWrongReportCorrection } from '../storage/wrong-reports.js';
import { getManualPlatform } from '../storage/manual-platforms.js'; // v14.19.0：手动主机机型映射
import { parseGameTitle } from '../core/title-parser.js';
import { Logger } from '../storage/logger.js';
import { detailSteamCacheTtlMs } from '../core/constants.js';
import { llmMatchGame, webSearchFallback } from './ai-fallback.js'; // v6.4.16/17：规则匹配失败后的匹配兜底
import { getSteamApiStatus } from '../core/api-monitor.js'; // v9.7.0：网络故障期跳过负缓存
import { appendRatingHistory, isDemoCacheWithoutRating, resolveDlcToBase } from './orchestrator-shared.js'; // v14.15.0 N1：走势历史
import { matchAppListExact } from './app-list-index.js'; // v14.6：全量目录离线索引
import { getCompiledRetrievalRules } from '../../shared/retrieval-vocab.js'; // v14.6.3 R1：词表单源
import { captureMismatchSample } from './mismatch-samples.js'; // v14.8 批次 15：未命中自动采集
import { rateMatchConfidence, extractTitleYear, yearOfDateString } from './match-confidence.js'; // v14.28.7 R4-B3
import { detectOffSteamPlatform } from '../../shared/platform-detect.js'; // v14.28.7 R4-B3

// ============ 匹配置信度打标（v14.28.7 R4-B3）/ Match confidence ============
// 用户裁决：详情面板与浮窗必须与列表徽章同尺子标推测——"只在列表标推测等于
// 没修，用户看到错配的地方就是详情"。页面身份取 rawTitle（document.title，
// 平台/年份标记都在这里），标题比对用 Steam 命中名；字段随响应下发不落缓存
//（规则升级后旧缓存不会被旧判定钉死）。
// Same ruler as the list badge; the page identity comes from rawTitle (platform
// and year live there). Fields ride the response only, never the cache.
/**
 * @template {Record<string, any>} T
 * @param {T} result
 * @param {string} gameName
 * @param {string} pageTitle
 * @param {string} source
 * @returns {T}
 */
function attachMatch(result, gameName, pageTitle, source) {
  if (!result || typeof result !== 'object') return result;
  const page = pageTitle || gameName;
  const m = rateMatchConfidence({
    gameName: page,
    resultName: result.name || '',
    platform: detectOffSteamPlatform(page) ? 'non-pc' : 'pc',
    pageYear: extractTitleYear(page),
    steamYear: yearOfDateString(result.releaseDate),
    source
  });
  /** @type {any} */
  const out = result;
  out.matchConfidence = m.confidence;
  out.matchName = m.resultName;
  out.matchSource = m.sourceLabel;
  out.matchPlatform = m.platformLabel;
  out.matchNote = m.reasonText;
  return out;
}

/**
 * 搜索游戏并获取完整 Steam 详情（详情页/浮窗使用）
 * 流程：名称索引 → 动态缓存（含 Demo 自愈）→ 搜索 → 完整详情 → 三层缓存。
 * Search a game and fetch full Steam details (detail pages/panels).
 * v14.14.0（重构序 6b）：searchSteamGame ~272 行拆分——缓存命中判定
 * tryCacheServed / 搜索流 searchAppIdFlow / 详情获取 fetchDetailsResolveDlc /
 * 缓存写入 writeSearchCaches 提为模块函数；主函数只做编排（行为不变）。
 * searchSteamGame split: cache-hit check, search flow, detail fetch and
 * cache writes extracted as module functions; the main fn only orchestrates.
 * @param {string} gameName
 * @param {{[k: string]: any}} [options]
 */
export async function searchSteamGame(gameName, options = {}) {
  // v14.19.0（用户需求：详情页手动主机机型声明）：手动映射优先于一切检索——
  // 声明过的条目返回 MC 形态数据（浮窗 MC 视图渲染；数组字段按模板归一化
  // 语义补空），不再走 Steam 检索（错误 Steam 条目不再出现）。
  const manual = await getManualPlatform(gameName);
  if (manual) {
    return {
      appId: null,
      name: gameName,
      platformOnly: true,
      platformTag: manual.tag,
      mcScore: manual.mcScore,
      mcName: manual.mcName,
      genres: [],
      userTags: [],
      developers: [],
      description: '',
      reviews: []
    };
  }
  // v14.3.2：Phase 0 — 元素直取 appId + DLC 解析（内容侧封面图提取的 appId 作为起点，
  // 经 resolveDlcToBase 解析后与名称索引/纠正路径汇合——统一入口消 aside 双管线分叉）
  // v14.28.7 R4-B3：页面身份 = rawTitle（含平台/年份标记），无则退 gameName
  const pageTitle = options.rawTitle || gameName;
  /** @type {string|number|null} */
  let appId = null;
  // v14.28.7 R4-B3：appId 来源链（文案证据，仅随响应展示）
  /** @type {string} */
  let appIdSource = 'unknown';
  if (options.appId) {
    appId = await resolveDlcToBase(String(options.appId));
    if (appId) appIdSource = 'image';
  }

  // 1. 通过名称索引查找 appId / Lookup appId via name index
  if (!appId) {
    appId = await lookupAppIdByName(gameName);
    if (appId) appIdSource = 'index';
  }

  // 1.5 人工纠正知识库优先（v3.3.13）：该标题曾报错并手动确认了正确 appid——
  // 用户确认 > 自动匹配；同时清除该名负缓存（纠正名不应被负缓存拦截）
  const correction = await lookupWrongReportCorrection(gameName);
  /** @type {string|number|null} */
  let excludeAppId = null;
  if (correction) {
    appId = correction.correctAppId;
    appIdSource = 'correction';
    excludeAppId = correction.wrongAppId;
    await deleteNameIndexEntry(gameName);
  }

  // 2. 若有 appId，检查 Steam 动态缓存（v3.3.7 模块化：detail 模块有效且
  //    数据完整才命中——列表页仅 rating 模块的条目不满足，转完整拉取，
  //    拉取只更新 detail/spy 模块，meta/rating 保留）。
  //    v3.3.10：命中前校验标题与缓存名相关——名称索引粘性条目（历史误写
  //    钉死 appId）在此被推翻，转重新搜索自愈（如 16598 页误钉 2001760）
  if (appId) {
    // v14.14.0（重构序 6b）：命中判定/Demo 自愈/注册表补写提取为 tryCacheServed
    const hit = await tryCacheServed(gameName, appId);
    // v14.28.7 R4-B3：命中同样标置信度（来源链 = 上图取/名称索引/人工纠正）
    if (hit.served && hit.merged) return attachMatch(hit.merged, gameName, pageTitle, appIdSource);
    appId = hit.appId ?? null;
  } else if (!options.ignoreNegativeCache && (await isRecentlySearchedNotFound(gameName))) {
    // 3. 无 appId 时，检查负缓存（v10.9.2：ignoreNegativeCache 可穿透——详情页
    // 对未命中自动重试一次，历史失败遗留的负缓存不再永久阻断自动匹配）
    return null;
  }

  try {
    // 4. 搜索 appId（若已有 appId 但缓存过期，跳过搜索直接获取详情；
    //    v3.3.13：排除曾报错的错误 appid）
    // v14.14.0（重构序 6b）：三阶段匹配（enSegment 交叉验证/英文兜底）随搜索流
    // 移入模块函数 searchAppIdFlow
    // v14.7 批次 1（A-P2-1）：直取/名称索引来源的 appId 相关性护栏——
    // 缓存命中路径已有同款校验（上方 namesRelated），fresh-fetch 路径此前
    // 缺失：错误封面 appId 会被 fetch+缓存+索引三层钉死。搜索流/人工纠正
    // 来源可信（appIdTrusted），直取与索引来源不相关 → 转标题重搜一次。
    // Relevance guard for element-provided / name-index appIds (the cache-hit
    // path already has it); search/correction origins are trusted.
    /** @type {boolean} */
    let appIdTrusted = false;
    if (!appId) {
      const flow = await searchAppIdFlow(gameName, options, excludeAppId);
      if (!flow) return null;
      appId = flow.appId;
      appIdSource = flow.source;
      appIdTrusted = true;
    }
    const first = await fetchDetailsResolveDlc(appId);
    if (!first) return null;
    appId = first.appId;
    let result = first.detail;
    if (!namesRelated(gameName, result.name)) {
      if (appIdTrusted) {
        // 搜索流/纠正来源自带相关性校验，仍不相关 = 罕见边界（如改名）——
        // 保留结果（劣于反复重搜）；Trusted origins carry their own checks.
        Logger.warn('Steam', `相关性护栏: 可信来源 appId ${appId} ("${result.name}") 与 "${gameName}" 不相关，保留`);
      } else {
        Logger.warn(
          'Steam',
          `相关性护栏: 直取/索引 appId ${appId} ("${result.name}") 与标题 "${gameName}" 不相关，转标题重搜`
        );
        const again = await searchAppIdFlow(gameName, options, excludeAppId);
        if (!again) return null;
        appId = again.appId;
        appIdSource = again.source;
        appIdTrusted = true;
        const second = await fetchDetailsResolveDlc(appId);
        if (!second) return null;
        appId = second.appId;
        result = second.detail;
      }
    }

    // 6. 写入三层缓存（动态缓存+注册表+名称索引）——v14.14.0（重构序 6b）
    // 提取为 writeSearchCaches
    await writeSearchCaches(appId, result, gameName);

    // v14.28.7 R4-B3：置信度在缓存写入之后打标——不落盘（规则升级即生效）
    return attachMatch(result, gameName, pageTitle, appIdSource);
  } catch (error) {
    console.error('Steam API 调用失败:', error);
    return null;
  }
}

// ============ 步骤 4 搜索流（v14.14.0 提取为模块函数）/ Search flow ============

/**
 * 步骤 4 搜索流——v14.7 批次 1 局部闭包提升为模块函数（护栏重搜路径复用）。
 * 目录索引精确命中 → 中文检索 → 三阶段匹配（enSegment 交叉验证/英文段兜底/
 * 社区端点）→ Bing/LLM 兜底 → 负缓存（网络故障期跳过）。
 * @param {string} gameName
 * @param {{[k: string]: any}} options
 * @param {string|number|null} excludeAppId
 * @returns {Promise<{appId: string|number, source: string}|null>}
 */
async function searchAppIdFlow(gameName, options, excludeAppId) {
  // v14.3.2：rawTitle 三阶段匹配（franchise 区分策略，审查报告 P1-A）
  // 阶段 1：中文检索（现有逻辑）
  // 阶段 2：交叉验证——内容词覆盖判据（替代 v14.3.1 零交集判据）：
  //   正确命中名覆盖 raw 英文段全部内容词；franchise 兄弟篇只覆盖头词、
  //   缺失特征词（如 "德米欧 x D&D" 缺 neverwinter/nights）。
  //   触发条件：rawWords ≥ 2 且（零交集 或 覆盖不全）→ 英文重搜 l=english。
  //   单调改进护栏：仅当英文结果覆盖严格更优才替换。
  // 阶段 3：中文全空 → raw 标题英文段兜底。
  const enSegment = options.rawTitle
    ? (options.rawTitle.match(/[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ0-9 ®™©:&.'\-]{5,}/) || [''])[0].trim()
    : '';
  // 版本级噪声词（命中名缺版本后缀属正常，不计入覆盖判据）——
  // v14.6.3 R1：单源 = shared/retrieval-vocab.js 编译产物
  const EDITION_WORDS = getCompiledRetrievalRules().editionWords;
  /** @param {string} s */
  const enWordsOf = (s) =>
    // v14.6.2 修复（审查 A11）：单源化至 coreTokensOf（排下载站噪声词
    // build/crack/repack 等）——原第二套实现把噪声段当内容词污染覆盖判据
    new Set(coreTokensOf(s).filter((w) => /^[a-z]/.test(w)));
  // v14.7 批次 1（A-P2-1）：步骤 4 搜索流提取为局部函数——直取/索引来源
  // 的 appId 相关性护栏失败时可重入（下方护栏用）。
  // Search flow extracted as a re-entrant helper for the relevance guard.
  // v14.6：全量目录离线索引（调研建议 1）——归一化精确命中作为检索结果
  //（阶段 2 交叉验证照常运行防 franchise 误配）；目录未命中走在线检索。
  /** @type {import('../core/types.js').SteamSearchResult|null} */
  let searchResult = null;
  // v14.28.7 R4-B3：命中来源（目录/商店检索/英文重搜/社区/兜底）
  /** @type {string} */
  let source = 'unknown';
  const dirHit = await matchAppListExact(gameName, excludeAppId);
  if (dirHit) {
    searchResult = { appId: dirHit.appId, name: dirHit.name, englishName: dirHit.name };
    source = 'directory';
  } else {
    searchResult = await searchSteamAppId(parseGameTitle(gameName), gameName, excludeAppId);
    if (searchResult) source = 'storesearch';
  }
  // 阶段 2：内容词覆盖交叉验证
  if (searchResult && enSegment) {
    const rawWords = [...enWordsOf(enSegment)].filter((w) => !EDITION_WORDS.has(w));
    const coverOf = (name) => rawWords.filter((w) => enWordsOf(name).has(w)).length;
    const hitCover = coverOf(searchResult.name);
    // rawWords ≥ 2 护栏：单词段区分度不足，不触发
    const needEn = rawWords.length >= 2 && (hitCover === 0 || hitCover < rawWords.length);
    if (needEn) {
      Logger.info(
        'Steam',
        `交叉验证: 中文命中 "${searchResult.name}" 覆盖 ${hitCover}/${rawWords.length} 内容词（需 ${rawWords.join('+')}），英文重搜`
      );
      const enResult = await searchSteamAppId([enSegment], options.rawTitle, excludeAppId, 'english');
      if (enResult) {
        const enCover = coverOf(enResult.name);
        // 单调改进护栏：仅当英文结果覆盖严格更优才替换
        if (enCover > hitCover) {
          Logger.info('Steam', `交叉验证升级: "${enResult.name}" 覆盖 ${enCover}/${rawWords.length}，替换`);
          searchResult = enResult;
          source = 'english';
        }
        // 等覆盖/更差 → 保留中文命中（防英文段拼写噪声抖动）
      }
    }
  }
  // 阶段 3：中文全空 → raw 标题英文段兜底
  if (!searchResult && enSegment) {
    searchResult = await searchSteamAppId([enSegment], options.rawTitle, excludeAppId, 'english');
    if (searchResult) source = 'english';
    // v14.6：社区搜索端点兜底（调研建议 3，免 key 仅英文）——英文
    // storesearch 未命中时的轻量补充，结果经同一相关性校验
    if (!searchResult) {
      searchResult = await searchCommunityApps(enSegment, options.rawTitle, excludeAppId);
      if (searchResult) source = 'community';
    }
  }
  if (!searchResult) {
    // v6.4.16：规则匹配失败 → 匹配兜底（防幻觉：均经官方数据校验后才采用）
    // v6.4.17：搜索引擎兜底（Bing，免费无需配置）优先 → AI/LLM 兜底（用户配置时）
    // 错配比未找到更糟——兜底均失败时返回 null（显示"未找到"，可走报错纠正黑名单）
    const fallback = (await webSearchFallback(gameName, excludeAppId)) || (await llmMatchGame(gameName, excludeAppId));
    if (fallback) {
      return { appId: fallback.appId, source: 'unknown' };
    } else {
      // 记录负缓存 / Record negative cache
      // v9.7.0：网络故障期不做负缓存固化——searchSteamAppId 吞掉网络异常
      // 返回 null（与"确认未找到"不可区分），断网时会把故障固化为 2h 负
      // 缓存。v14.7 批次 4：部分成功窗口扩展——窗口内**有任一成功**
      //（total > failed）即网络可用，miss 是真实未找到，允许负缓存；
      // 仅纯失败窗口（failed>0 且无成功）跳过（可重试）。
      const apiStatus = getSteamApiStatus();
      if (apiStatus.failed === 0 || apiStatus.total > apiStatus.failed) {
        // v14.8 批次 15：未命中现场自动采集（错题库原料——rawTitle+逐词
        // storesearch 快照；fire-and-forget 不阻塞主流程）
        captureMismatchSample({
          gameName,
          rawTitle: options.rawTitle || gameName,
          correctAppId: null
        }).catch(() => {});
        await recordNameIndex(gameName, null);
      } else {
        Logger.warn(
          'Steam',
          `搜索未命中且窗口内 ${apiStatus.failed} 次 API 失败（疑似网络问题），跳过负缓存: "${gameName}"`
        );
      }
      return null;
    }
  }
  return { appId: searchResult.appId, source };
}
// 详情获取 + DLC→本体解析（v14.3.2 逻辑抽取为局部函数——护栏重搜路径
// 复用；返回 {appId, detail}，appId 更新为本体 id）。fetchSteamFullDetails
// ByAppId 返回 appdetails 原始 type/fullgame 字段——DLC 命中时好评率/评测
// 数据归属 DLC 而非本体，需替换后重取本体详情。
/**
 * @param {string|number} id
 * @returns {Promise<{appId: string|number, detail: Object}|null>}
 */
async function fetchDetailsResolveDlc(id) {
  let r = await fetchSteamFullDetailsByAppId(id);
  if (!r) return null;
  // finalId 保留调用方原始类型（number appId 写名称索引的类型契约，
  // test-handlers 断言 lookupAppIdByName 返回 number）——仅 DLC 解析时
  // 更新为 fullgame 原始值。
  let finalId = id;
  if (r.type === 'dlc' && r.fullgame) {
    const baseId = r.fullgame.appid || r.fullgame.appId || '';
    if (baseId && String(baseId) !== String(id)) {
      Logger.info('Steam', `DLC 解析: ${r.name} (DLC ${id}) → 本体 ${baseId} (${r.fullgame.name || ''})`);
      const baseResult = await fetchSteamFullDetailsByAppId(baseId);
      if (baseResult) {
        finalId = baseId;
        r = baseResult;
      }
      // 本体获取失败 → 保留 DLC 数据（劣于无数据）
    }
  }
  return { appId: finalId, detail: r };
}

// ============ 缓存命中判定（v14.14.0 提取）/ Cache-hit check ============

/**
 * 缓存命中判定（重构序 6b）：detail 模块有效且完整、无好评率重取需求、名称
 * 相关 → 命中（幂等补写注册表后返回 merged）；Demo 缓存无好评率或 appId 本身
 * 为 Demo → 返回 served:false + appId:null 触发重搜完整版。
 * @param {string} gameName
 * @param {string|number} appId
 * @returns {Promise<{served: boolean, merged?: Object, appId?: string|number|null}>}
 */
async function tryCacheServed(gameName, appId) {
  const cached = await getSteamCacheEntry(appId, 'detail');
  const detail = isModuleValid(cached, 'detail', detailSteamCacheTtlMs()) ? getModuleData(cached, 'detail') : null;
  const merged = getMergedData(cached) || {};
  // 无好评率条目（0 评测/失败固化）按冷却期重新获取
  // v14.21.0：评价数倒挂条目（cnTotalReviews > totalReviews，旧商店页回退
  // 把最近 30 天行误当全时段写入）同样不命中——按需重取自愈
  if (
    detail &&
    merged.appId &&
    merged.name &&
    isCompleteCacheData(detail) &&
    !needsRatingRefetch(merged) &&
    !hasInvertedReviewCounts(merged) &&
    // v14.24.0（用户报告：浮窗依旧没有具体评论）：缺评论回填标记的旧缓存条目
    // 不命中——转完整拉取一次，社区页评论正文随写缓存回填（此后标记在位，
    // 空 reviews = 确实无评论，不再循环重取）
    // v14.24.0: cache entries without the review-backfill marker (written
    // before the community-reviews fallback existed) miss once so comments
    // backfill; marked-but-empty stays served (genuinely no reviews).
    !!merged.cnReviewsFetchedAt &&
    namesRelated(gameName, merged.name)
  ) {
    // 自愈：Demo 版缓存无好评率 → 忽略缓存，重新搜索完整版
    if (isDemoCacheWithoutRating(merged)) {
      return { served: false, appId: null };
    } else {
      // 缓存命中：幂等补写注册表（含封面），防止缓存管理页缺失条目/封面；
      // 中英文名异常（占位/缺失）时自动按 appId 重新获取（自愈）
      await ensureRegistryEntry(
        merged.appId || appId,
        merged.name,
        merged.englishName,
        gameName,
        merged.headerImage || '',
        merged.type
      );
      await ensureValidRegistryNames(merged.appId || appId, merged.name, merged.englishName, gameName);
      return { served: true, merged };
    }
  } else if (await isDemoAppId(appId)) {
    // 缓存缺失/过期且该 appId 是 Demo 版 → 重新搜索完整版
    return { served: false, appId: null };
  }
  return { served: false, appId };
}

// ============ 三层缓存写入（v14.14.0 提取）/ Cache writes ============

/**
 * 三层缓存写入（重构序 6b）：好评率重试计数 + Steam 动态缓存 + 游戏注册表
 * （中英文名+变体+封面）+ 名称索引（官方中英文名离线化覆盖）。
 * @param {string|number} appId
 * @param {Record<string, any>} result
 * @param {string} gameName
 */
async function writeSearchCaches(appId, result, gameName) {
  {
    const oldCached = await getSteamCacheEntry(appId);
    const oldRating = oldCached ? getModuleData(oldCached, 'rating') : null;
    const oldCount = (oldRating && oldRating.ratingFailCount) || 0;
    result.ratingFailCount = result.positiveRate == null ? oldCount + 1 : 0;
  }
  appendRatingHistory(result, result.positiveRate); // v14.15.0 N1：走势点（成功重取才入点）
  await setSteamCacheEntry(appId, result);
  await recordGameInRegistry(appId, {
    cnName: result.name,
    enName: result.englishName || result.name,
    gameName,
    tags: result.genres,
    coverImage: result.headerImage || ''
  });
  await recordNameIndex(gameName, appId);
  // v14 F3：官方中英文名也入名称索引——后续任一名称搜索均先命中本地字典，
  // 不再出网（扩大 appId 离线清单覆盖率）
  if (result.name && result.name !== gameName) await recordNameIndex(result.name, appId).catch(() => {});
  if (result.englishName && result.englishName !== result.name && result.englishName !== gameName) {
    await recordNameIndex(result.englishName, appId).catch(() => {});
  }
}
