/**
 * 游戏雷达 Game Radar - 列表页好评率管线 / List-Page Rating Pipeline
 *
 * v14.3.0（第五轮 B4）：由 orchestrator.js 拆分——getSteamRatingsFromCacheOnly
 * （第一波零网络命中）与 getSteamPositiveRate（缓存优先 → 类型校验 → 评价
 * 获取 → 0 评测重搜 → 三层缓存写入）。
 * The list-page pipeline: zero-network first wave + the full cache-first
 * rating lookup (type validation → review fetch → zero-review re-search →
 * 3-layer cache writes).
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
  needsRatingRefetch
} from './api.js';
import { isModuleValid, getMergedData, getSteamCacheEntry, setSteamCacheEntry } from '../storage/steam-cache.js';
import { recordGameInRegistry } from '../storage/registry.js';
import { lookupAppIdByName, recordNameIndex, isRecentlySearchedNotFound } from '../storage/name-index.js';
import { lookupWrongReportCorrection } from '../storage/wrong-reports.js';
import { matchAppListExact } from './app-list-index.js'; // v14.6：全量目录离线索引
import { getSteamApiStatus } from '../core/api-monitor.js'; // v14.6.2 审查 A2：负缓存网络守卫
import { fetchWithTimeout } from '../core/utils.js'; // v14.8.2：详情页信号回捞
import { extractSteamAppIdSignals } from './orchestrator-shared.js'; // v14.8.2：盲区自愈
import { cjkBigramDice, nameMatchesSearch } from './api-search.js'; // v14.8.2：探针候选校验
import { parseGameTitle, pickRegistryEnName } from '../core/title-parser.js';
import { Logger } from '../storage/logger.js';
import { applyCacheHit, isDemoCacheWithoutRating } from './orchestrator-shared.js';

/**
 * 仅缓存命中查询（列表页第一波，无网络请求）。
 * 缓存命中（含 Demo 自愈跳过）即返回，否则返回 null → 调用方转入 Steam 拉取。
 * Cache-only lookup (first wave on list pages, zero network). Returns the
 * cached rating when valid (demo-without-rating self-heals to a miss).
 */
export async function getSteamRatingsFromCacheOnly(gameName, options = {}) {
  if (!gameName) return null;
  let appId = options.appId ? String(options.appId) : null;
  if (!appId) {
    appId = await lookupAppIdByName(gameName);
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
  if (!isModuleValid(cached, 'rating') || merged.positiveRate === undefined || needsRatingRefetch(merged)) return null;
  if (isDemoCacheWithoutRating(merged)) return null;

  // v5.0.0：统一命中返回（补写注册表 + 自愈 + 三段式字段）
  return applyCacheHit(merged, appId, gameName);
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

export async function getSteamPositiveRate(gameName, options = {}) {
  if (!gameName) return null;

  // v14.6.2 修复（审查 A3）：人工纠正知识库提前——封面直取/缓存命中路径
  // 此前不校验 wrongAppId，用户报错纠正后列表页仍持续显示错徽章直至缓存
  // 过期（detail 管线 v3.3.13 已覆盖，列表侧同语义补齐）
  const corr = await lookupWrongReportCorrection(gameName);

  // 0. appId 优先（列表页封面图提取），否则名称索引
  let appId = options.appId ? String(options.appId) : null;
  if (!appId) {
    appId = await lookupAppIdByName(gameName);
  }
  // 纠正黑名单命中（封面直取/索引粘性条目钉住的错 appId）→ 视为 miss 走重搜
  if (appId && corr && String(appId) === String(corr.wrongAppId)) {
    appId = null;
  }

  // 2. 若有 appId，检查 Steam 动态缓存（含 Demo 自愈；v3.3.7：rating 模块有效判定）
  let usableAppId = appId;
  if (appId) {
    const cached = await getSteamCacheEntry(appId);
    const merged = getMergedData(cached) || {};
    if (isModuleValid(cached, 'rating') && merged.positiveRate !== undefined && !needsRatingRefetch(merged)) {
      // 自愈：命中 Demo 版且无评测的缓存 → 视为无效，重新搜索完整版
      if (!isDemoCacheWithoutRating(merged)) {
        // v5.0.0：统一命中返回（补写注册表 + 自愈 + 三段式字段）
        return applyCacheHit(merged, appId, gameName);
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
    // 4. 搜索 appId（若已有 appId 但缓存过期，跳过搜索直接获取评价；
    //    v3.3.13：排除曾报错的错误 appid）
    /** @type {string|number|null} */
    let foundAppId = usableAppId;
    let foundName = gameName;
    /** @type {import('../core/types.js').SteamSearchResult|null} */
    let searchResult = null;
    // corr 已在函数开头查询（v14.6.2 审查 A3：提前覆盖缓存命中路径）；
    // 此处沿用其 wrongAppId 作为搜索黑名单（v3.3.13 语义不变）
    if (!foundAppId) {
      // v14.6：全量目录离线索引（调研建议 1）——归一化精确命中免网络。
      // 下架游戏 storesearch 搜不到（结构性盲区）；目录命中后评分走
      // appreviews（不受商店在架状态影响），4.5/5.5 步 appdetails 仅在
      // 0 评测/缺英文名时才触发 → 下架游戏可正常出徽章。
      const dirHit = await matchAppListExact(gameName, corr ? corr.wrongAppId : null);
      if (dirHit) {
        searchResult = { appId: dirHit.appId, name: dirHit.name, englishName: dirHit.name };
      } else {
        searchResult = await searchSteamAppId(parseGameTitle(gameName), gameName, corr ? corr.wrongAppId : null);
        // v14.3.2（P2-1）：中文检索未命中 → raw 标题英文段兜底（同 detail 管线）
        if (!searchResult && options.rawTitle) {
          const enSeg = (options.rawTitle.match(/[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ0-9 ®™©:&.'\-]{5,}/) || [''])[0].trim();
          if (enSeg) {
            searchResult = await searchSteamAppId([enSeg], options.rawTitle, corr ? corr.wrongAppId : null, 'english');
            // v14.6：社区搜索端点兜底（调研建议 3，免 key 仅英文）——
            // 英文 storesearch 未命中时的轻量补充，结果经同一相关性校验
            if (!searchResult) {
              searchResult = await searchCommunityApps(enSeg, options.rawTitle, corr ? corr.wrongAppId : null);
            }
          }
        }
      }
      if (!searchResult && options.pageUrl) {
        // v14.8.2（storesearch 新游戏盲区自愈，用户指定专项）：storesearch 对
        // 新游戏结构性缺失（实测：泰坦之旅2/深海迷航2 全名与家族词检索均 0
        // 结果/仅前作）→ **站点详情页信号回捞**：列表项详情页内嵌 steam CDN
        // appid 信号（host 无关，三站 26 样本实证）→ 提取后经 appdetails
        // 名称相关性校验（防站点胶囊图误标：潜行者2 3765020 实证信号错误），
        // 通过则作为 searchResult 进入常规管线（DLC 解析/缓存/注册表全复用）。
        // 有界：调用方按任务预算供给（probeBudget.left 仅实际探测扣减——命中
        // 缓存的调用不占预算）；探测失败 = 维持 miss（负缓存语义不变）。残余
        // 风险：站点信号错误且误标名无数字/无共同词时俗称序号例外可能放行——
        // 由人工纠正知识库（wrongAppId 黑名单）兜底。
        /** @type {{appId: string, name: string, englishName: string}|null} */
        let probe = null;
        if (!options.probeBudget || options.probeBudget.left > 0) {
          if (options.probeBudget) options.probeBudget.left -= 1;
          probe = await probeDetailSignal(gameName, options.pageUrl, corr ? corr.wrongAppId : null);
        }
        if (probe) {
          Logger.info('Steam', `详情页信号回捞命中: "${gameName}" → ${probe.appId} (${probe.name})`);
          searchResult = probe;
        }
      }
      if (!searchResult) {
        // 记录负缓存 / Record negative cache
        // v14.6.2 修复（审查 A2）：补网络故障守卫（detail 管线 v9.7.0 已有、
        // 列表侧漏）——store 熔断打开时 searchSteamAppId 短路返回 null，与
        // "确认未找到"不可区分，固化后 2h 内恢复也不重查
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
      foundAppId = searchResult.appId;
      foundName = searchResult.name;
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
      // v3.3.7：缓存 type 从合并视图读取（meta 模块）
      const cachedType = usableAppId ? (await getSteamCacheEntry(usableAppId)) || null : null;
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
      if (reviewSummary.total > 0) {
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
    if (positiveRate === null) {
      // 英文名缺失时才并行补英文（避免 validateSteamNames 误判重搜）
      const needsEn = !/[A-Za-z]{2,}/.test(officialEn);
      const [cnData, enData] = await Promise.all([
        fetchSteamAppDetails(foundAppId, 'schinese').catch(() => null),
        needsEn ? fetchSteamAppDetails(foundAppId, 'english').catch(() => null) : Promise.resolve(null)
      ]);
      officialCn = (cnData && cnData.name) || officialCn;
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
            if (rs2.total > 0) positiveRate = Math.round((rs2.positive / rs2.total) * 100);
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
    //    v3.3.8：列表页独立获取最近更新日期（不依赖详情页访问；缓存已有则复用；
    //    GetNewsForApp 在 api.steampowered.com 独立限流域，不影响商店 API 配额）。
    const existing = usableAppId ? getMergedData(await getSteamCacheEntry(usableAppId)) || {} : {};
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
      ratingRetriedAt: positiveRate === null ? Date.now() : existing.ratingRetriedAt
    };
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

    return {
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
      releaseDate: existing.releaseDate || ''
    };
  } catch (e) {
    Logger.warn('Steam', `获取好评率异常: ${gameName}`, String(e));
    Logger.debug('Steam', '获取Steam好评率失败:', String(e));
    return null;
  }
}
