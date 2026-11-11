/**
 * 游戏雷达 Game Radar - 列表页好评率管线 / List-Page Rating Pipeline
 *
 * v14.3.0（第五轮 B4）：由 orchestrator.js 拆分——getSteamRatingsFromCacheOnly
 * （第一波零网络命中）与 getSteamPositiveRate（缓存优先 → 类型校验 → 评价
 * 获取 → 0 评测重搜 → 三层缓存写入）。
 * The list-page pipeline: zero-network first wave + the full cache-first
 * rating lookup (type validation → review fetch → zero-review re-search →
 * 3-layer cache writes).
 *
 * @invariant 第一波 getSteamRatingsFromCacheOnly 零网络，且返回非 null 即终态（第二波不会纠错）——故平台预检必须发生在第一波内部
 * @invariant console 条目第一波一律返回 null 交第二波 phasePlatform（Metacritic）；emulator 返回 platformOnly 终态
 * @invariant 缓存写入以 appId 为键、可重复覆盖（幂等）——看门狗放弃后迟到的结果允许覆盖旧值
 */
import {
  searchSteamAppId,
  searchCommunityApps,
  fetchSteamAppDetails,
  fetchReviewSummary,
  fetchLastUpdate,
  validateSteamNames,
  DEMO_NAME_PATTERN,
  ADDON_NAME_PATTERN,
  coverImageFor,
  isDemoAppId,
  baseAppIdFromDetails,
  needsRatingRefetch,
  hasInvertedReviewCounts // v14.21.0：评价数倒挂污染指纹（旧回退误写条目自愈）
} from './api.js';
import { isModuleValid, getMergedData, getSteamCacheEntry, setSteamCacheEntry } from '../storage/steam-cache.js';
import { recordGameInRegistry } from '../storage/registry.js';
import { lookupAppIdByName, recordNameIndex, isRecentlySearchedNotFound } from '../storage/name-index.js';
import { lookupWrongReportCorrection } from '../storage/wrong-reports.js';
import { matchAppListExact } from './app-list-index.js'; // v14.6：全量目录离线索引
import { getSteamApiStatus } from '../core/api-monitor.js'; // v14.6.2 审查 A2：负缓存网络守卫
import { fetchWithTimeout } from '../core/utils.js'; // v14.8.2：详情页信号回捞
import { appendRatingHistory, extractSteamAppIdSignals, isNewReleaseDate } from './orchestrator-shared.js'; // v14.8.2：盲区自愈；v14.9.1：新发售判定
import { detectPlatform, trimPlatformTokens, extractEnNameSegment } from '../../shared/platform-detect.js'; // v14.10.0：非 PC 平台识别；v14.17.0：EN 段剥离；v14.19.0：EN 段提取单源
import { fetchMetacriticScore } from './api-metacritic.js'; // v14.10.0：主机条目评分源
import { getManualPlatform } from '../storage/manual-platforms.js'; // v14.19.0：手动主机机型映射
import { cjkBigramDice, nameMatchesSearch } from './api-search.js'; // v14.8.2：探针候选校验
import { parseGameTitle, pickRegistryEnName } from '../core/title-parser.js';
import { Logger } from '../storage/logger.js';
import { applyCacheHit, isDemoCacheWithoutRating } from './orchestrator-shared.js';
// v14.28.6 R4-B：三要素置信度（平台+标题+发行年份一致才 confirmed）
import { rateMatchConfidence, extractTitleYear, yearOfDateString } from './match-confidence.js';

// v14.28.6 R4-B：把三要素置信度挂到结果上（确认/推测 + 依据串），内容侧据此
// 渲染「推测」徽章与悬停依据（匹配标题 / 数据来源 / 缺哪一项）。
// Attach the 3-factor confidence (and human-readable evidence) to a result.
function attachMatch(result, { gameName, resultName, source, steamYear }) {
  if (!result || typeof result !== 'object') return result;
  const m = rateMatchConfidence({
    gameName,
    resultName: resultName || result.name || '',
    platform: 'pc',
    pageYear: extractTitleYear(gameName),
    steamYear: steamYear !== null && steamYear !== undefined ? steamYear : yearOfDateString(result.releaseDate),
    source
  });
  result.matchConfidence = m.confidence;
  result.matchName = m.resultName;
  result.matchSource = m.sourceLabel;
  result.matchNote = m.reasonText;
  return result;
}

/**
 * 仅缓存命中查询（列表页第一波，无网络请求）。
 * 缓存命中（含 Demo 自愈跳过）即返回，否则返回 null → 调用方转入 Steam 拉取。
 * Cache-only lookup (first wave on list pages, zero network). Returns the
 * cached rating when valid (demo-without-rating self-heals to a miss).
 */
export async function getSteamRatingsFromCacheOnly(gameName, options = {}) {
  if (!gameName) return null;
  // v14.19.0：首波平台预检（零网络）——手动映射优先于一切索引；标题/分类页
  // 提示词识别出的模拟器条目直接打标（此前首波无平台检查，URL/名称索引钉住
  // 的错误 Steam 缓存会先于第二波识别返回——106902 类"主机游戏匹配错误后
  // 列表页依旧显示错误信息"的根因之一）。主机条目首波不抓分（零网络语义），
  // 返回 null 转第二波 phasePlatform 常规流程。
  const manual0 = await getManualPlatform(gameName);
  if (manual0) {
    if (manual0.kind === 'console' && manual0.mcScore != null) {
      return {
        mcScore: manual0.mcScore,
        mcName: manual0.mcName,
        platformTag: manual0.tag,
        appId: null,
        name: gameName
      };
    }
    return { platformOnly: true, platformTag: manual0.tag, appId: null, name: gameName };
  }
  // v14.28.6 R4-B：首波必须做**标题级**平台预检（此前仅在分类页提示词存在时
  // 才判模拟器）——主机独占标题若被 URL/名称索引钉住一个无关 Steam appId，
  // 首波缓存命中即返回"看起来成功"的错误徽章，第二波永远不会纠正（第一波
  // 结果是终态）。主机条目首波保持零网络：不抓分，返回 null 交第二波
  // phasePlatform（Metacritic）。
  // Wave 1 must run a title-level platform pre-check: a console-only title pinned
  // to an unrelated Steam appId would otherwise return a wrong badge as final.
  const hint0 = typeof options.platformHint === 'string' ? options.platformHint.trim() : '';
  const plat0 = detectPlatform(hint0 ? `${gameName}|${hint0}` : gameName);
  if (plat0.kind === 'emulator') {
    return { platformOnly: true, platformTag: plat0.tag, appId: null, name: gameName };
  }
  if (plat0.kind === 'console') return null;
  /** @type {string} */
  let appSource = options.appId ? 'image' : 'unknown';
  let appId = options.appId ? String(options.appId) : null;
  if (!appId) {
    appId = await lookupAppIdByName(gameName);
    if (appId) appSource = 'index';
  }
  // v14.6.2 修复（审查 A3）：首波缓存命中同样校验纠正黑名单——封面直取的
  // 错 appId 命中错误缓存时不再返回（该名进入 pending 走重搜纠正）
  if (appId) {
    const corr0 = await lookupWrongReportCorrection(gameName);
    if (corr0 && String(appId) === String(corr0.wrongAppId)) return null;
  }
  if (!appId) return null;

  const cached = await getSteamCacheEntry(appId);
  const merged = getMergedData(cached) || {};
  // 无好评率条目（0 评测/失败固化）按冷却期重新获取（v3.3.7：rating 模块有效判定）
  // v14.21.0：评价数倒挂条目（旧回退误写）不命中，重取自愈
  if (
    !isModuleValid(cached, 'rating') ||
    merged.positiveRate === undefined ||
    needsRatingRefetch(merged) ||
    hasInvertedReviewCounts(merged)
  )
    return null;
  if (isDemoCacheWithoutRating(merged)) return null;

  // v5.0.0：统一命中返回（补写注册表 + 自愈 + 三段式字段）
  // v14.28.6 R4-B：附三要素置信度（确认/推测 + 依据）
  return attachMatch(await applyCacheHit(merged, appId, gameName), {
    gameName,
    resultName: merged.name,
    source: appSource,
    steamYear: yearOfDateString(merged.releaseDate)
  });
}

/**
 * 轻量级 Steam 好评率查询（列表页用，缓存优先，仅获取好评率）
 * options.ignoreNegativeCache：列表页批量场景跳过负缓存（用户主动浏览值得重试）。
 * Lightweight rating lookup for list pages (cache-first).
 */
// v14.8.2（盲区自愈）：站点详情页信号回捞——抓取列表项详情页，提取内嵌
// steam CDN appid 信号（按出现次数降序取前 3 个候选），逐个经 appdetails
// 名称相关性校验（nameMatchesSearch 全语义：跨语言数字对齐/俗称序号例外；
// 同语言候选加 cjkBigramDice 复核防无关放行）。任一通过 → 作为搜索结果；
// 全部失败/网络异常 → null（维持 miss）。每名至多调用一次（worker 预算控制）。
// Detail-signal probe: fetch the item's own detail page, extract the embedded
// Steam appid signals, and validate each via appdetails name-relevance before
// accepting; any failure keeps the item as a miss.
/**
 * @param {string} gameName
 * @param {string} pageUrl
 * @param {string|number|null} excludeAppId
 * @returns {Promise<{appId: string, name: string, englishName: string}|null>}
 */
async function probeDetailSignal(gameName, pageUrl, excludeAppId) {
  try {
    const resp = await fetchWithTimeout(pageUrl);
    if (!resp.ok) return null;
    const html = await resp.text();
    const ids = extractSteamAppIdSignals(html).slice(0, 3);
    for (const appId of ids) {
      if (excludeAppId && String(appId) === String(excludeAppId)) continue;
      const details = await fetchSteamAppDetails(appId, 'schinese').catch(() => null);
      if (!details || !details.name) continue;
      const dtype = String(details.type || '').toLowerCase();
      // 明确非游戏载体（原声带/视频/硬件/捆绑包）跳过；DLC 交给 4.5 步解析本体
      if (dtype && ['music', 'video', 'hardware', 'bundle'].includes(dtype)) continue;
      const name = String(details.name);
      if (!nameMatchesSearch(name, gameName, gameName)) continue;
      // 同语言候选 Dice 复核（防俗称序号例外放行无关同语言游戏——误标信号防线）
      if (/[\u4e00-\u9fff]/.test(name)) {
        const d = cjkBigramDice(gameName, name);
        if (d !== -1 && d < 0.28) {
          Logger.debug('Steam', `详情页信号候选 Dice 过低剔除: ${appId} (${name})`);
          continue;
        }
      }
      return { appId, name, englishName: name };
    }
  } catch {
    /* 探测失败 = 维持 miss（负缓存语义不变） */
  }
  return null;
}

// v14.13 B1（报告 A W1 + B P3-02）：四阶段拆分（同文件步函数，对外签名
// 不变，锚点门硬验收）。Phase 1——非 PC 平台预检（模拟器/主机/Metacritic）。
/**
 * @param {string} gameName
 * @param {Object} options
 * @returns {Promise<Object|null>} 平台终态结果（null = PC 条目继续后续阶段）
 */
async function phasePlatform(gameName, options) {
  // v14.19.0（用户需求：详情页手动主机机型声明）：用户手动映射**优先于一切
  // 识别与索引**——声明过的条目直接返回 MC/平台终态（MC 分为声明时抓取的
  // 固化值；缺失时按主机条目走常规 Metacritic 预算补查一次）
  const manual = await getManualPlatform(gameName);
  if (manual) {
    if (manual.kind === 'console' && manual.mcScore != null) {
      return { mcScore: manual.mcScore, mcName: manual.mcName, platformTag: manual.tag, appId: null, name: gameName };
    }
    if (manual.kind === 'console') {
      const enSegManual = trimPlatformTokens(extractEnNameSegment(manual.mcName || gameName));
      if (enSegManual && (!options.mcBudget || options.mcBudget.left > 0)) {
        if (options.mcBudget) options.mcBudget.left -= 1;
        const mcRetry = await fetchMetacriticScore(enSegManual).catch(() => null);
        if (mcRetry != null) {
          return { mcScore: mcRetry, mcName: enSegManual, platformTag: manual.tag, appId: null, name: gameName };
        }
      }
    }
    return { platformOnly: true, platformTag: manual.tag, appId: null, name: gameName };
  }
  // v14.18.0（两站真实页面实证）：分类页平台提示——咸鱼单机"模拟器版"/
  // XDGAME"模拟器整合"分类页的条目标题**不含**任何平台标记（标签在标题外
  // 的独立元素），标题级识别必然落空。内容侧经规则 listPlatformHints 声明
  // （URL 模式 → 提示词）随批次注入，此处拼接为附加段参与识别（PC 守卫
  // 仍优先——标题带 steam/pc 段的双平台条目不被提示词带偏）。
  const hint = typeof options.platformHint === 'string' ? options.platformHint.trim() : '';
  const plat = detectPlatform(hint ? `${gameName}|${hint}` : gameName);
  if (plat.kind === 'pc') return null;
  if (plat.kind === 'emulator') {
    return { platformOnly: true, platformTag: plat.tag, appId: null, name: gameName };
  }
  const enSeg = trimPlatformTokens(extractEnNameSegment(gameName));
  // v14.17.0：EN 段先剥尾部平台/模拟器/格式词再推导 slug——"The Legend of
  // Zelda TotK NSP/Ryujinx"类"英文名+平台标记"标题不剥离则 slug 必 404。
  // 全剥光时 trimPlatformTokens 返回原文，deriveMetacriticSlug 自身有短 slug 守卫。
  /** @type {number|null} */
  let mcScore = null;
  if (enSeg && (!options.mcBudget || options.mcBudget.left > 0)) {
    if (options.mcBudget) options.mcBudget.left -= 1;
    mcScore = await fetchMetacriticScore(enSeg).catch(() => null);
  }
  if (mcScore != null) {
    return { mcScore, mcName: enSeg, platformTag: plat.tag, appId: null, name: gameName };
  }
  return { platformOnly: true, platformTag: plat.tag, appId: null, name: gameName };
}

// Phase 2——appId 解析：目录索引 → 标题检索 → EN 段兜底 → 社区搜索 →
// 详情页信号回捞 → 负缓存记录（含网络故障守卫，v14.6.2 A2 语义内聚于此）。
/**
 * @param {string} gameName
 * @param {Object} options
 * @param {{correctAppId: string, wrongAppId: string|null}|null} corr
 * @param {string|number|null} usableAppId 已知 appId（缓存过期/Demo 重搜场景跳过搜索）
 * @returns {Promise<{appId: string|number, name: string, englishName: string|null, searched: boolean, source: string}|null>}
 *   null = 确认未找到（负缓存已按守卫语义处理）；englishName 在 usableAppId
 *   直取路径为 null（调用方 5.5 步按 pickRegistryEnName 补齐）；
 *   source = 命中来源（v14.28.6 R4-B，仅作推测依据展示，不参与置信度判定）
 */
async function phaseSearch(gameName, options, corr, usableAppId) {
  let foundAppId = usableAppId;
  let foundName = gameName;
  /** @type {string} */
  let searchSource = 'unknown';
  /** @type {import('../core/types.js').SteamSearchResult|null} */
  let searchResult = null;
  if (!foundAppId) {
    // v14.6：全量目录离线索引（调研建议 1）——归一化精确命中免网络。
    const dirHit = await matchAppListExact(gameName, corr ? corr.wrongAppId : null);
    if (dirHit) {
      searchResult = { appId: dirHit.appId, name: dirHit.name, englishName: dirHit.name };
      searchSource = 'directory';
    } else {
      searchResult = await searchSteamAppId(parseGameTitle(gameName), gameName, corr ? corr.wrongAppId : null);
      if (searchResult) searchSource = 'storesearch';
      // v14.3.2（P2-1）：中文检索未命中 → raw 标题英文段兜底（同 detail 管线）
      if (!searchResult && options.rawTitle) {
        const enSeg = (options.rawTitle.match(/[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ0-9 ®™©:&.'\-]{5,}/) || [''])[0].trim();
        if (enSeg) {
          searchResult = await searchSteamAppId([enSeg], options.rawTitle, corr ? corr.wrongAppId : null, 'english');
          if (searchResult) searchSource = 'english';
          // v14.6：社区搜索端点兜底（调研建议 3，免 key 仅英文）
          if (!searchResult) {
            searchResult = await searchCommunityApps(enSeg, options.rawTitle, corr ? corr.wrongAppId : null);
            if (searchResult) searchSource = 'community';
          }
        }
      }
    }
    if (!searchResult && options.pageUrl) {
      // v14.8.2（storesearch 新游戏盲区自愈）：站点详情页信号回捞（详见
      // 上面各注释——预算/校验/黑名单语义不变）
      /** @type {{appId: string, name: string, englishName: string}|null} */
      let probe = null;
      if (!options.probeBudget || options.probeBudget.left > 0) {
        if (options.probeBudget) options.probeBudget.left -= 1;
        probe = await probeDetailSignal(gameName, options.pageUrl, (corr && corr.wrongAppId) || null);
      }
      if (probe) {
        Logger.info('Steam', `详情页信号回捞命中: "${gameName}" → ${probe.appId} (${probe.name})`);
        searchResult = probe;
        searchSource = 'probe';
      }
    }
    if (!searchResult) {
      // 记录负缓存（v14.6.2 A2 网络故障守卫内聚）
      const apiStatus = getSteamApiStatus();
      if (apiStatus.failed === 0) {
        await recordNameIndex(gameName, null);
      } else {
        Logger.warn(
          'Steam',
          `列表页搜索未命中且窗口内 ${apiStatus.failed} 次 API 失败（疑似网络问题），跳过负缓存: "${gameName}"`
        );
      }
      return null;
    }
    foundAppId = searchResult.appId; // v14.13 B1：Phase2 摘取时补回（appId/name 赋值）
    foundName = searchResult.name;
  }
  // searched=false = 已知 appId 路径（englishName 由调用方 5.5 步补齐）
  return {
    appId: foundAppId,
    name: foundName,
    englishName: searchResult ? searchResult.englishName || searchResult.name : null,
    searched: !!searchResult,
    source: searchSource
  };
}

export async function getSteamPositiveRate(gameName, options = {}) {
  if (!gameName) return null;

  // v14.28.6 R4-A：阶段回调——供批量链看门狗"卡在哪一步"留证与状态栏展示；
  // 观测出口异常绝不影响主流程（calling code 出错不能变成检索失败）
  const onPhase = typeof options.onPhase === 'function' ? options.onPhase : null;
  const phase = (/** @type {string} */ p) => {
    if (!onPhase) return;
    try {
      onPhase(p);
    } catch {
      /* 观测出口异常不改变检索语义 */
    }
  };
  phase('platform');

  // v14.10.0（用户需求：主机/模拟器条目 + 评分优先 Metacritic）：非 PC 平台
  // 识别在**一切 Steam 检索之前**——模拟器 ROM 包检索必错配（标题含大量游戏
  // 名片段），主机独占 Steam 无数据。模拟器 → 平台标签徽章（零网络）；主机 →
  // Metacritic 优先（标题 EN 段推导 slug，预算有界），无 EN/无分 → 平台标签。
  // 平台结果非 failed/非 miss——不进负缓存与重试语义（标签即终态）。
  const platResult = await phasePlatform(gameName, options);
  if (platResult) return platResult;

  // v14.6.2 修复（审查 A3）：人工纠正知识库提前——封面直取/缓存命中路径
  // 此前不校验 wrongAppId，用户报错纠正后列表页仍持续显示错徽章直至缓存
  // 过期（detail 管线 v3.3.13 已覆盖，列表侧同语义补齐）
  const corr = await lookupWrongReportCorrection(gameName);

  // 0. appId 优先（列表页封面图提取），否则名称索引
  // v14.28.6 R4-B：记录 appId 来源（推测依据展示用）
  let idSource = options.appId ? 'image' : 'unknown';
  let appId = options.appId ? String(options.appId) : null;
  if (!appId) {
    appId = await lookupAppIdByName(gameName);
    if (appId) idSource = 'index';
  }
  // 纠正黑名单命中（封面直取/索引粘性条目钉住的错 appId）→ 视为 miss 走重搜
  if (appId && corr && String(appId) === String(corr.wrongAppId)) {
    appId = null;
  }

  // v14.29.0：同一次调用内 Steam 缓存读去重——此前同一 appId 会
  // getSteamCacheEntry 三次（命中判定 :312 / type 校验 :368 / 写回合并 :484）。
  // 本函数在这三处之间不写 steam-cache（唯一写点 :513 在最后），因此复用首次
  // 读到的合并视图是安全的；批量链 90 项 × 3 → 1，减少 2 次/项的 await 往返。
  // Deduplicate the Steam cache read within one call (3 reads -> 1). This
  // function does not write the cache between the three read sites.
  /** @type {any} */
  let cachedEntryMemo = null;
  /** @type {string|null} */
  let cachedEntryMemoKey = null;
  /** @param {any} id */
  const readCachedOnce = async (id) => {
    const key = id === null || id === undefined ? null : String(id);
    if (key === null) return null;
    if (cachedEntryMemoKey === key) return cachedEntryMemo;
    cachedEntryMemo = await getSteamCacheEntry(id);
    cachedEntryMemoKey = key;
    return cachedEntryMemo;
  };

  // 2. 若有 appId，检查 Steam 动态缓存（含 Demo 自愈；v3.3.7：rating 模块有效判定）
  phase('cache');
  let usableAppId = appId;
  if (appId) {
    const cached = await readCachedOnce(appId);
    const merged = getMergedData(cached) || {};
    if (
      isModuleValid(cached, 'rating') &&
      merged.positiveRate !== undefined &&
      !needsRatingRefetch(merged) &&
      !hasInvertedReviewCounts(merged) // v14.21.0：倒挂污染条目不命中（重取自愈）
    ) {
      // 自愈：命中 Demo 版且无评测的缓存 → 视为无效，重新搜索完整版
      if (!isDemoCacheWithoutRating(merged)) {
        // v5.0.0：统一命中返回（补写注册表 + 自愈 + 三段式字段）
        // v14.28.6 R4-B：附三要素置信度（确认/推测 + 依据）
        return attachMatch(await applyCacheHit(merged, appId, gameName), {
          gameName,
          resultName: merged.name,
          source: idSource,
          steamYear: yearOfDateString(merged.releaseDate)
        });
      }
      usableAppId = null;
    } else if (await isDemoAppId(appId)) {
      // 缓存缺失/过期且该 appId 是 Demo 版 → 重新搜索完整版
      usableAppId = null;
    }
  } else if (!options.ignoreNegativeCache) {
    // 3. 无 appId 时，检查负缓存（列表页批量场景可忽略）
    if (await isRecentlySearchedNotFound(gameName)) {
      Logger.debug('Steam', `负缓存命中，跳过: ${gameName}`);
      return null;
    }
  }

  try {
    // 4. 搜索 appId（v14.13 B1：Phase 2 步函数——目录/检索/EN 兜底/回捞/
    //    负缓存记录内聚；若已有 appId 但缓存过期，跳过搜索直接获取评价）
    /** @type {string|number|null} */
    let foundAppId = usableAppId;
    let foundName = gameName;
    /** @type {import('../core/types.js').SteamSearchResult|null} */
    let searchResult = null;
    // v14.28.6 R4-B：本次命中的搜索来源（未搜索时回落到 appId 来源）
    /** @type {string|null} */
    let searchSource = null;
    if (!foundAppId) {
      phase('search');
      const hit = await phaseSearch(gameName, options, corr, usableAppId);
      if (!hit) return null;
      foundAppId = hit.appId;
      foundName = hit.name;
      searchResult = hit.searched ? { appId: hit.appId, name: hit.name, englishName: hit.englishName } : null;
      searchSource = hit.source || null;
    }

    // 4.5 appId 校验（v3.2.6，v3.3.2 按需化）：DLC 等非游戏本体 → 自动解析为
    // 所属本体（fullgame）；其他非本体类型（bundle/mod/music 等）→ 返回 type 标记。
    // 网络失败时保持原值继续（防误杀）。**按需执行**：缓存条目已有 type（说明该
    // appId 此前已校验并解析为本体）或游戏名不疑似附属内容（正常游戏名几乎不可
    // 能是 DLC/bundle）时跳过网络校验，省 1 请求/游戏——批量列表页请求量减 20%，
    // 显著降低 Steam 限流与慢网下批内挂起风险。
    // appId validation (on-demand since v3.3.2): a DLC resolves to its base game,
    // other non-base types (bundle/mod/music) return a type marker. Skipped when
    // the cache already carries a type (already validated/resolved) or the name
    // shows no add-on hints — saves 1 request per game (~20% fewer in batch).
    /** @type {string|null} */
    let appType = null;
    if (foundAppId) {
      phase('validate');
      // v3.3.7：缓存 type 从合并视图读取（meta 模块）
      const cachedType = usableAppId ? (await readCachedOnce(usableAppId)) || null : null;
      const cachedTypeVal = cachedType ? (getMergedData(cachedType) || {}).type : null;
      if (cachedTypeVal) {
        appType = cachedTypeVal;
      } else if (ADDON_NAME_PATTERN.test(foundName)) {
        const baseCheck = await fetchSteamAppDetails(foundAppId, 'schinese').catch(() => null);
        if (baseCheck) {
          appType = baseCheck.type || 'game';
          const baseId = baseAppIdFromDetails(baseCheck);
          if (baseId && baseId !== String(foundAppId)) {
            Logger.warn(
              'Steam',
              `appId ${foundAppId} 为 DLC/非本体，自动解析为本体 ${baseId}（${(baseCheck.fullgame && baseCheck.fullgame.name) || ''}）`
            );
            foundAppId = baseId;
            foundName = (baseCheck.fullgame && baseCheck.fullgame.name) || foundName;
          } else if (!baseId) {
            // bundle/mod/music 等非本体且无法解析：返回 type 标记（徽章显示 type 值而非"未找到"）
            Logger.warn('Steam', `appId ${foundAppId} 类型 ${baseCheck.type} 非游戏本体且无法解析，返回 type 标记`);
            return { positiveRate: null, ratingDesc: null, appId: foundAppId, name: foundName, type: baseCheck.type };
          }
        }
      }
    }

    // 5. 获取评价统计（好评率 + 近 30 天好评率，v3.3.6 一次请求同取）。
    //    获取失败（网络/限流）→ 不写缓存并标记 failed，
    //    下次访问自动重试（避免 null 固化导致长期只显示 AppID）。
    phase('reviews');
    const reviewSummary = await fetchReviewSummary(foundAppId);
    // v10.5.3：最终生效的评测统计——0 评测重搜本体成功后由 rs2 覆盖（此前
    // mergedData/返回值仍读旧 appId 的 reviewSummary，total 与新 appId 不一致）
    let finalSummary = reviewSummary;
    if (!reviewSummary) {
      Logger.warn('Steam', `好评率获取失败: ${gameName} (appId ${foundAppId})，不写缓存待重试`);
      return {
        positiveRate: null,
        ratingDesc: null,
        appId: foundAppId,
        name: foundName,
        failed: true,
        type: appType || 'game'
      };
    }
    /** @type {number|null} */
    let positiveRate = null;
    /** @type {string|null} */
    let ratingDesc = null;
    /** @type {number|null} */
    let recentRate = null;
    let recentTotal = 0;
    if (reviewSummary) {
      ratingDesc = reviewSummary.desc || null;
      // v14.8.2：低评测形态 positive=null（Steam 未生成整体评价）→ 正确落入
      // "暂无整体评价"语义（5.5 步 0 评测同路径），不得算出 NaN
      if (reviewSummary.total > 0 && reviewSummary.positive != null) {
        positiveRate = Math.round((reviewSummary.positive / reviewSummary.total) * 100);
      }
      if (reviewSummary.recent) {
        recentRate = reviewSummary.recent.rate;
        recentTotal = reviewSummary.recent.total;
      }
    }

    // 5.5 官方中英文名：搜索路径用搜索结果英文名；0 评测时轻量获取官方名
    //     并验证 Demo/附属内容（校验失败 → 重搜本体）。
    //     v3.3.2：officialEn 已有可靠英文名时仅请求 schinese（省 1 请求/0 评测游戏）
    let officialCn = foundName;
    let officialEn = searchResult ? searchResult.englishName || foundName : pickRegistryEnName(gameName, foundName);
    // v14.9.1：发售日期/未发售标记（5.5 步顺带提取——徽章"新游/未发售"标签 +
    // 悬停展示，让用户知晓为何只有 AppID：刚发售或评测不足）
    let fetchedReleaseDate = '';
    let fetchedComingSoon = false;
    if (positiveRate === null) {
      phase('names');
      // 英文名缺失时才并行补英文（避免 validateSteamNames 误判重搜）
      const needsEn = !/[A-Za-z]{2,}/.test(officialEn);
      const [cnData, enData] = await Promise.all([
        fetchSteamAppDetails(foundAppId, 'schinese').catch(() => null),
        needsEn ? fetchSteamAppDetails(foundAppId, 'english').catch(() => null) : Promise.resolve(null)
      ]);
      officialCn = (cnData && cnData.name) || officialCn;
      if (cnData && cnData.release_date) {
        fetchedReleaseDate = cnData.release_date.date || fetchedReleaseDate;
        fetchedComingSoon = !!cnData.release_date.coming_soon;
      }
      if (enData && enData.name) officialEn = enData.name;
      // 名称校验：Demo/试玩或附属内容 → 视为无效匹配，重搜本体
      const nameCheck = validateSteamNames(officialCn, officialEn);
      if (!nameCheck.valid || DEMO_NAME_PATTERN.test(officialCn + ' ' + officialEn)) {
        Logger.warn('Steam', `0评测匹配无效(${nameCheck.issues.join('/')}): ${foundAppId} ${officialCn}，重搜`);
        const reSearch = await searchSteamAppId(parseGameTitle(gameName), gameName, corr ? corr.wrongAppId : null);
        if (reSearch) {
          foundAppId = reSearch.appId;
          foundName = reSearch.name;
          officialCn = reSearch.name;
          officialEn = reSearch.englishName || officialCn;
          const rs2 = await fetchReviewSummary(foundAppId);
          if (rs2) {
            finalSummary = rs2; // v10.5.3：重搜后以新 appId 的统计为准
            ratingDesc = rs2.desc || null;
            if (rs2.total > 0 && rs2.positive != null) positiveRate = Math.round((rs2.positive / rs2.total) * 100);
            if (rs2.recent) {
              recentRate = rs2.recent.rate;
              recentTotal = rs2.recent.total;
            }
          }
        }
      }
    }

    // 6. 合并写入 Steam 动态缓存（自愈场景不留存旧 Demo 数据；含封面/type 供补写）。
    //    确认 0 评测（positiveRate null）时记录重试时间，冷却期内不再重复请求。
    //    v3.3.6：近 30 天好评率随同一请求写入缓存（徽章三段式数据源）。
    //    v3.3.7：existing 为模块合并视图（setSteamCacheEntry 按字段自动路由，
    //    只更新 meta/rating 模块，detail/spy 保留）。
    phase('write');
    //    v3.3.8：列表页独立获取最近更新日期（不依赖详情页访问；缓存已有则复用；
    //    GetNewsForApp 在 api.steampowered.com 独立限流域，不影响商店 API 配额）。
    const existing = usableAppId ? getMergedData(await readCachedOnce(usableAppId)) || {} : {};
    const headerImage = coverImageFor(foundAppId, options.cover);
    let lastUpdate = existing.lastUpdate || null;
    if (!lastUpdate) {
      lastUpdate = await fetchLastUpdate(foundAppId).catch(() => null);
    }
    const mergedData = {
      ...existing,
      appId: foundAppId,
      name: foundName,
      englishName: officialEn,
      positiveRate,
      ratingDesc,
      headerImage,
      type: appType || 'game',
      // v10.5.3：totalReviews/positiveReviews/negativeReviews 统一读
      // finalSummary（0 评测重搜后以新 appId 为准，修复旧值不一致）
      totalReviews: finalSummary ? finalSummary.total : 0,
      positiveReviews: finalSummary ? finalSummary.positive : null,
      negativeReviews: finalSummary ? finalSummary.negative : null,
      recentPositiveRate: recentRate,
      recentTotalReviews: recentTotal,
      lastUpdate: lastUpdate || existing.lastUpdate || null,
      // v14.9.1：发售日期/未发售随缓存持久化（缓存命中路径徽章标签复用）
      releaseDate: fetchedReleaseDate || existing.releaseDate || '',
      comingSoon: fetchedComingSoon || !!existing.comingSoon,
      ratingRetriedAt: positiveRate === null ? Date.now() : existing.ratingRetriedAt
    };
    appendRatingHistory(mergedData, positiveRate); // v14.15.0 N1：走势点
    await setSteamCacheEntry(foundAppId, mergedData);

    // 7. 同步更新游戏注册表和名称索引：官方中英文名 + 封面图 + 标题变体 + type
    await recordGameInRegistry(foundAppId, {
      cnName: officialCn,
      enName: officialEn,
      gameName,
      coverImage: headerImage,
      type: appType || 'game'
    });
    await recordNameIndex(gameName, foundAppId);

    return attachMatch(
      {
        positiveRate,
        ratingDesc,
        appId: foundAppId,
        name: foundName,
        // v10.5.3：好评/差评原始条数随返回（列表页综合评分徽章数据源；
        // finalSummary 同 mergedData——重搜后以新 appId 统计为准）
        totalReviews: finalSummary ? finalSummary.total : 0,
        positiveReviews: finalSummary ? finalSummary.positive : null,
        negativeReviews: finalSummary ? finalSummary.negative : null,
        recentPositiveRate: recentRate,
        recentTotalReviews: recentTotal,
        lastUpdate: lastUpdate || existing.lastUpdate || null,
        // v14.9.1：发售日期/新发售标记随返回（徽章"新游/未发售"标签 + 悬停展示）
        releaseDate: fetchedReleaseDate || existing.releaseDate || '',
        comingSoon: fetchedComingSoon || !!existing.comingSoon,
        isNewRelease: !fetchedComingSoon && isNewReleaseDate(fetchedReleaseDate || existing.releaseDate || '')
      },
      {
        gameName,
        resultName: foundName,
        source: searchSource || idSource,
        steamYear: yearOfDateString(fetchedReleaseDate || existing.releaseDate || '')
      }
    );
  } catch (e) {
    Logger.warn('Steam', `获取好评率异常: ${gameName}`, String(e));
    Logger.debug('Steam', '获取Steam好评率失败:', String(e));
    return null;
  }
}
