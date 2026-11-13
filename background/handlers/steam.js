import { dataStore } from '../../data/data-store.js';
import { flushAllCaches } from '../storage/flush.js';
import { DB_KEYS, detailSteamCacheTtlMs } from '../core/constants.js';
import { parseGameTitle } from '../core/title-parser.js';
import {
  searchSteamAppId,
  fetchSteamFullDetailsByAppId,
  scanAndHealRegistry,
  planDetailRefresh, // v14.28.8：缓存残缺时的模块级部分刷新计划
  namesRelated,
  findVersionVariant,
  needsRatingRefetch, // v14.24.0：URL 缓存先行命中判定（与 tryCacheServed 同口径）
  hasInvertedReviewCounts // v14.24.0：倒挂缓存自愈指纹
} from '../steam/api.js';
import { searchSteamGame } from '../steam/orchestrator.js';
import { captureMismatchSample } from '../steam/mismatch-samples.js'; // v14.8 批次 3：错题采集
import { getSteamApiStatus } from '../core/api-monitor.js'; // v10.9.3：失败原因诊断
import { readDownloadUrlsStore } from '../storage/download-urls.js';
import { Logger } from '../storage/logger.js';
import { flushNameIndex, recordNameIndex, lookupAppIdByName, deleteNameIndexEntry } from '../storage/name-index.js';
import { negativeCacheRemainingMs } from '../storage/name-index.js'; // v14.15.0 O3：负缓存剩余
import { flushRegistry, recordGameInRegistry } from '../storage/registry.js';
import {
  flushSteamCache,
  getSteamCacheEntry,
  setSteamCacheEntry,
  deleteSteamCacheEntry,
  isModuleValid,
  getModuleData,
  getMergedData,
  latestModuleTs,
  isDetailCacheComplete // v14.28.8：完整性单源（按字段所属模块判定）
} from '../storage/steam-cache.js';
import { recordWrongReport, flushWrongReports } from '../storage/wrong-reports.js';
import { setManualPlatform, flushManualPlatforms } from '../storage/manual-platforms.js'; // v14.19.0：手动主机机型映射
import {
  resolveManualPlatformOption,
  extractEnNameSegment,
  trimPlatformTokens,
  detectPlatform
} from '../../shared/platform-detect.js'; // v14.19.0：机型选项单源；v14.29.2：URL 先行平台守卫
import { fetchMetacriticScore } from '../steam/api-metacritic.js'; // v14.19.0：主机条目评分
import { getAppIdByUrl, setUrlAppIdArbitrated, deleteUrlAppId } from '../storage/url-index.js'; // v7.0.2：详情页网址第一候选
import { noteTabGame, getTabGame } from '../core/tab-game.js'; // v14.1.0：SidePanel 当前页联动
import { recordUsageCounter, recordUsageDuration, recordUsageEvent } from '../storage/usage-evidence.js'; // v14.25.0：使用证据档案
import { gameKeyOf } from '../storage/diag-trace.js'; // v14.29.0：标题哈希（同站冲突豁免判定）

/**
 * 游戏雷达 Game Radar - 消息处理：Steam 查询 / Steam Message Handlers
 *
 * v5.0.0：由 handlers.js 拆分——搜索/直取/手动映射/候选/预热/报错/自愈。
 */

// v14.1.0：解析成功 → 记录 {tabId → 游戏} 快照（SidePanel"当前页游戏"
// 联动数据源；无 tab 上下文的列表页批量检索 sender 无 tab，自动忽略）
// Record a per-tab snapshot after a successful resolution (SidePanel mirror).
function noteResolvedGame(sender, data) {
  const tabId = sender && sender.tab ? sender.tab.id : undefined;
  if (data && data.appId) {
    noteTabGame(tabId, {
      appId: data.appId,
      name: data.name,
      positiveRate: data.positiveRate ?? null,
      headerImage: data.headerImage || '',
      url: data.url || ''
    });
  }
}

// --- Steam 查询 / Steam lookups ---
// v7.0.2：详情页网址作为检索第一候选——同一 URL 始终指向同一 appId，
// 消除列表页/详情页两条匹配路径的分歧；匹配成功后记录 URL → appId
// v12 B3：in-flight 去重——同游戏并发请求共享同一 Promise（多标签页同游戏
// 不再各自全链搜索 3 倍 Steam 请求）
const inFlightSearches = new Map();

export async function handleSearchSteam(message, sender) {
  // v14.7 批次 1（A-P3）：key 纳入语义参数——仅按 gameName 去重会让
  // ignoreNegativeCache/rawTitle/appId 语义被首次请求合并（"穿透负缓存的重试"
  // 吃到普通查询的 in-flight 结果 = 穿透失效；反之普通查询吃到穿透结果）。
  // Dedupe key includes semantic params so a negative-cache-piercing retry
  // never merges with a plain lookup of the same name (and vice versa).
  const dedupeKey = [
    String(message.gameName || ''),
    message.ignoreNegativeCache ? 'pierce' : 'normal',
    String(message.appId || ''),
    String(message.rawTitle || '')
  ].join('|');
  const inflight = inFlightSearches.get(dedupeKey);
  if (inflight) return inflight;
  // v14.11 B1：检索生命周期日志（E2E 详情节挂起定位观测点）
  const t0 = Date.now();
  Logger.info('Steam', `SEARCH_STEAM 开始: "${String(message.gameName || '').slice(0, 30)}"`);
  const job = doHandleSearchSteam(message, sender)
    .then((r) => {
      Logger.info(
        'Steam',
        `SEARCH_STEAM 完成: ${Date.now() - t0}ms → ${r && r.data ? r.data.appId : r && r.reason ? r.reason : 'null'}`
      );
      return r;
    })
    .catch((e) => {
      Logger.warn('Steam', `SEARCH_STEAM 异常: ${Date.now() - t0}ms ${String(e).slice(0, 80)}`);
      throw e;
    })
    .finally(() => inFlightSearches.delete(dedupeKey));
  inFlightSearches.set(dedupeKey, job);
  return job;
}

async function doHandleSearchSteam(message, sender) {
  const t0 = Date.now(); // v14.25.0：证据档案——检索耗时样本
  const pageUrl = sender && sender.tab ? sender.tab.url : '';
  // v14.29.2（用户报告：主机/模拟器详情页仍走 PC 流程）：URL 索引先行路径的
  // 平台守卫——主机整合/移植版/模拟器标题若被 URL 索引钉住一个错误 appId，
  // 此前会先发整套详情拉取（~6 出站请求）后才被 namesRelated 推翻。非 PC
  // 标题跳过 URL 先行，落回 searchSteamGame（其 phaseDetailPlatform 在一切
  // 检索前单源短路：映射 > 模拟器 > 主机 MC > PC）。
  // URL-index shortcut guard: non-PC titles skip the URL-first path entirely
  // and fall through to searchSteamGame, whose platform pre-check short-circuits
  // before ANY lookup (manual mapping > emulator > console MC > PC).
  if (detectPlatform(String(message.gameName || '')).kind !== 'pc') {
    Logger.info('Steam', `非 PC 标题跳过 URL 索引先行: "${String(message.gameName || '').slice(0, 40)}"`);
  } else if (pageUrl) {
    const urlAppId = await getAppIdByUrl(pageUrl);
    // v14.24.0（用户报告：详情页浮窗有缓存也慢）：URL 命中路径此前**直接全量拉取**
    //（appdetails×2+商店页+评测+spy+公告 ~6 出站请求），缓存完全被绕过——每次
    // 打开详情页都慢。现缓存先行：有效完整条目（含好评率重取/倒挂自愈/评论回填
    // 标记/名称相关性四重判定，与 orchestrator tryCacheServed 同口径）直接合并
    // 返回零出站；未命中才刷新——v14.28.8 起按模块级计划只补残缺模块。
    // v14.24.0: cache-first on the URL-index hit — the path used to bypass the
    // cache entirely (~6 outbound requests every visit). A valid complete entry
    // (same guard set as orchestrator tryCacheServed) is served with zero
    // outbound requests; otherwise fall through to a (partial) refresh.
    if (urlAppId) {
      const cachedEntry = await getSteamCacheEntry(urlAppId);
      const cachedDetail = isModuleValid(cachedEntry, 'detail', detailSteamCacheTtlMs())
        ? getModuleData(cachedEntry, 'detail')
        : null;
      const cachedMerged = getMergedData(cachedEntry) || null;
      if (
        cachedEntry && // TS 收窄：latestModuleTs(cachedEntry) 需非空 / TS narrowing
        cachedDetail &&
        cachedMerged &&
        cachedMerged.appId &&
        cachedMerged.name &&
        isDetailCacheComplete(cachedEntry) && // v14.28.8：传整个条目（字段按所属模块读）
        !needsRatingRefetch(cachedMerged) &&
        !hasInvertedReviewCounts(cachedMerged) &&
        !!cachedMerged.cnReviewsFetchedAt && // v14.24.0：缺标记旧缓存 → 全量拉取一次回填评论
        namesRelated(message.gameName, cachedMerged.name)
      ) {
        Logger.info('Steam', `网址索引命中缓存 "${message.gameName}" → ${cachedMerged.name}（零出站）`, {
          appId: cachedMerged.appId
        });
        recordUsageCounter('match.urlCacheServe'); // v14.25.0：缓存先行直返
        recordUsageDuration('search', Date.now() - t0);
        noteResolvedGame(sender, cachedMerged); // v14.1.0：SidePanel 联动
        return { data: cachedMerged, cachedAt: latestModuleTs(cachedEntry) };
      }
      // v14.25.0：缺评论回填标记的旧缓存条目转全量拉取（v14.24.0 自愈路径落账）
      if (cachedDetail && cachedMerged && !cachedMerged.cnReviewsFetchedAt) {
        recordUsageEvent('reviews', 'backfill', { appId: String(urlAppId) });
      }
      // v14.28.8：有缓存条目 → 只补缺失/过期模块；无条目 → 全量
      const refreshModules = cachedEntry ? planDetailRefresh(cachedEntry, cachedMerged) : undefined;
      const byUrl = await fetchSteamFullDetailsByAppId(urlAppId, { refreshModules });
      if (byUrl) {
        recordUsageCounter('match.urlFetch'); // v14.25.0：缓存未命中刷新（部分/全量）
        recordUsageDuration('search', Date.now() - t0);
        // v14.28.8：此路径此前不写缓存 → 缓存永远补不齐；现在写回本次拉到的模块
        // （picked 子集只更新对应模块，未涉及模块的字段与 ts 不动）
        await setSteamCacheEntry(byUrl.appId, byUrl);
        // 部分刷新：返回"旧合并视图 + 本次补到的字段"
        const view = refreshModules && cachedMerged ? { ...cachedMerged, ...byUrl } : byUrl;
        // v9.7.0：URL 命中同样过名称相关性校验（与 handleGetSteamByAppId
        // 的直取校验对称）——URL 索引由历史匹配写入，一旦写入错误 appId 而
        // 命中路径无校验短路返回，错误被永久固化（报错清理不覆盖 URL 索引
        // 时换绑永远不会发生）。不相关 → 清除错误绑定，继续标题搜索路径
        if (namesRelated(message.gameName, view.name)) {
          Logger.info('Steam', `网址索引命中 "${message.gameName}" → ${view.name}`, { appId: byUrl.appId });
          await flushAllCaches();
          const newEntry = await getSteamCacheEntry(byUrl.appId);
          noteResolvedGame(sender, view); // v14.1.0：SidePanel 联动
          return { data: view, cachedAt: newEntry ? latestModuleTs(newEntry) : null };
        }
        Logger.warn(
          'Steam',
          `网址索引 appId ${urlAppId} 与标题不相关（${view.name} vs ${message.gameName}），清除错误绑定`
        );
        await deleteUrlAppId(pageUrl);
      }
      // 详情获取失败（如缓存损坏）→ 继续标题搜索路径
    }
  }
  // v10.9.2：ignoreNegativeCache 穿透（详情页对未命中自动重试一次）
  // v10.9.3：reason 诊断——未命中时区分"确认不在 Steam"与"Steam 接口不可达/
  // 网络异常"，透传给详情页候选浮窗展示（此前静默弹候选，用户无从判断）
  /** @type {import('../core/types.js').GameResult|null} */
  let steamResult = null;
  /** @type {string|null} */
  let reason = null;
  try {
    steamResult = await searchSteamGame(message.gameName, {
      ignoreNegativeCache: message.ignoreNegativeCache === true,
      rawTitle: message.rawTitle, // v14.3.1：原始标题透传（扩展搜索英文变体）
      appId: message.appId // v14.3.2：元素直取 appId（统一入口）
    });
  } catch (e) {
    reason = 'error: ' + String((e && /** @type {Error} */ (e).message) || e).slice(0, 120);
  }
  // v14.15.0 O3：负缓存剩余时间随响应下发（候选面板展示真实自动重查等待）
  let negativeCacheMs = 0;
  if (!steamResult) {
    negativeCacheMs = await negativeCacheRemainingMs(message.gameName);
  }
  if (!steamResult && !reason) {
    const api = getSteamApiStatus();
    const negNote = negativeCacheMs > 0 ? `，负缓存 ${Math.ceil(negativeCacheMs / 60000)} 分钟后自动重查` : '';
    reason =
      api.failed > 0
        ? `steam-api-unreachable（窗口内 ${api.failed} 次 Steam 接口失败——请检查网络/加速器后点重试）`
        : 'not-found（Steam 商店检索无匹配' + negNote + '）';
    Logger.warn('Steam', `未命中原因: ${reason} — "${message.gameName}"`);
  }
  if (steamResult) {
    Logger.info('Steam', `匹配"${message.gameName}" → ${steamResult.name}`, {
      appId: steamResult.appId,
      rating: steamResult.ratingDesc
    });
    recordUsageCounter('match.searchOk'); // v14.25.0：标题检索命中
    recordUsageDuration('search', Date.now() - t0);
    // 记录 URL → appId（详情页网址作为后续检索第一候选）
    // v14.29.0：仲裁写入——推测级不覆盖已有不同绑定（防漂移钉死），同站
    // 冲突（另一页已绑定同一 appId）不固化第二侧
    if (pageUrl) {
      const arb = await setUrlAppIdArbitrated(pageUrl, steamResult.appId, {
        confidence: steamResult.matchConfidence || null,
        titleHash: gameKeyOf(message.gameName || '')
      });
      if (!arb.written && arb.reason === 'host-conflict') {
        Logger.warn('Steam', `网址索引写入跳过（同站冲突）: ${steamResult.appId} 已绑定另一页`);
      }
    }
  } else {
    Logger.warn('Steam', `未找到"${message.gameName}"`);
    recordUsageCounter('match.miss'); // v14.25.0：检索未命中（原因随事件流）
    recordUsageEvent('match', 'miss', {
      kind: String(reason || 'not-found')
        .split('（')[0]
        .slice(0, 40)
    });
  }
  await flushAllCaches();
  // 返回缓存时间戳供详情页浮窗显示"缓存于 xx 分钟前"（模块化：取最近模块时间）
  const cachedEntry = steamResult ? await getSteamCacheEntry(steamResult.appId) : null;
  noteResolvedGame(sender, steamResult); // v14.1.0：SidePanel 联动
  return { data: steamResult, cachedAt: cachedEntry ? latestModuleTs(cachedEntry) : null, reason, negativeCacheMs };
}

export async function handleRefreshSteamCache(message) {
  recordUsageCounter('refresh.named'); // v14.25.0：无 appId 的名称刷新（证据档案）
  // 通过名称索引查找 appId，以 appId 为键删除缓存
  const appId = await lookupAppIdByName(message.gameName);
  if (appId) {
    await deleteSteamCacheEntry(appId);
  }
  // v10.9.2：手动刷新强制穿透负缓存（刷新语义 = 不接受历史未命中结论）
  const steamResult = await searchSteamGame(message.gameName, { ignoreNegativeCache: true });
  await flushAllCaches();
  const cachedEntry = steamResult ? await getSteamCacheEntry(steamResult.appId) : null;
  if (steamResult) {
    Logger.info('Steam', `手动刷新缓存"${message.gameName}" → ${steamResult.name}`, { appId: steamResult.appId });
  }
  return { data: steamResult, cachedAt: cachedEntry ? latestModuleTs(cachedEntry) : null };
}

// 直接通过 appId 获取 Steam 详情（绕过名称搜索；图片 URL 含 appId 时使用）
// v3.3.7：缓存命中要求"detail 模块未过期（详情页独立 TTL）+ 数据完整"——
// 仅 detail 过期时重新获取详情，meta/rating/spy 模块保留（部分刷新）。
// v3.3.14：图片提取的 appId 可能与页面标题无关（gamer520 侧边推荐图是 Steam
// CDN 封面，会被全页图提取误取）——有 gameName 时校验名称相关性，不相关
// 拒绝并转标题搜索；manual=true（手动选择候选）跳过校验（用户主动确认）。

// 直接通过 appId 获取 Steam 详情（绕过名称搜索；图片 URL 含 appId 时使用）
// v3.3.7：缓存命中要求"detail 模块未过期（详情页独立 TTL）+ 数据完整"——
// 仅 detail 过期时重新获取详情，meta/rating/spy 模块保留（部分刷新）。
// v3.3.14：图片提取的 appId 可能与页面标题无关（gamer520 侧边推荐图是 Steam
// CDN 封面，会被全页图提取误取）——有 gameName 时校验名称相关性，不相关
// 拒绝并转标题搜索；manual=true（手动选择候选）跳过校验（用户主动确认）。
// v7.0.3：检索顺序统一为「网址索引 → 封面直取 → 标题搜索 → 搜索引擎」——
// 直取（GET_STEAM_BY_APPID）也先查网址索引；manual（用户手动选择）优先于一切
export async function handleGetSteamByAppId(message, sender) {
  let appId = message.appId;
  const gameName = message.gameName || '';
  const manual = message.manual === true;
  // v14.24.0（用户需求：手动更新/重新检索必须真实刷新）：forceRefresh=true 时
  // 跳过缓存直取，且**先删除该 appId 缓存**——拉取失败也不留旧数据（下次
  // 加载自动重取），拉取成功写回全新条目。
  // v14.24.0: forceRefresh (menu "manual update" semantics) skips the cache
  // serve and deletes the entry up front — a failed fetch leaves no stale data.
  const forceRefresh = message.forceRefresh === true;
  const pageUrl = sender && sender.tab ? sender.tab.url : '';
  // 网址索引第一候选（非手动路径）：同一详情页网址始终指向同一 appId
  if (!manual && pageUrl) {
    const urlAppId = await getAppIdByUrl(pageUrl);
    if (urlAppId) {
      if (String(urlAppId) !== String(appId)) {
        Logger.info('Steam', `网址索引优先: ${appId} → ${urlAppId}（${pageUrl}）`);
      }
      appId = urlAppId;
    }
  }

  if (forceRefresh) {
    recordUsageCounter('refresh.forced'); // v14.25.0：菜单"手动更新/重新检索"真实清缓存
    await deleteSteamCacheEntry(appId);
    await flushSteamCache();
  }

  const cached = forceRefresh ? null : await getSteamCacheEntry(appId);
  const detailData =
    cached && isModuleValid(cached, 'detail', detailSteamCacheTtlMs()) ? getModuleData(cached, 'detail') : null;
  const cachedMerged = cached ? getMergedData(cached) : null;
  if (detailData && cachedMerged) {
    // v14.25.0：缓存直返路径计数（在守卫判定前落账 = 直取流量分布证据）
    recordUsageCounter('direct.cacheServe');
    // 返回合并视图（detail 判定完整性；meta/rating 字段随合并返回供浮窗渲染）；
    // v3.3.14：非手动路径校验名称相关性（侧边推荐缓存也可能被误取）
    // v14.24.0：好评率重取/倒挂自愈/评论回填标记三重判定对齐 tryCacheServed——
    // 污染条目不再被直取路径永久顶住
    // v14.28.8：完整性按条目判定（detail 模块永远没有 name——名称从合并视图读）
    if (
      (manual || !gameName || namesRelated(gameName, cachedMerged.name)) &&
      isDetailCacheComplete(cached) &&
      !needsRatingRefetch(cachedMerged) &&
      !hasInvertedReviewCounts(cachedMerged) &&
      !!cachedMerged.cnReviewsFetchedAt
    ) {
      noteResolvedGame(sender, cachedMerged); // v14.1.0：SidePanel 联动
      return { data: cachedMerged, cachedAt: latestModuleTs(cached) };
    }
    if (!gameName || namesRelated(gameName, cachedMerged.name)) {
      Logger.info('Steam', `直取缓存判定不命中（重取/倒挂/评论回填），转缓存未命中刷新: ${cachedMerged.name}`);
    } else {
      Logger.warn('Steam', `图片 appId ${appId} 与页面标题不相关（${cachedMerged.name} vs ${gameName}），拒绝缓存命中`);
      return { data: null, cachedAt: null, reason: 'name-mismatch' }; // v14.28.12（B2-F4）：失败带原因
    }
  }

  try {
    // v14.28.8：有缓存条目 → 只补缺失/过期模块；无条目 → 全量
    const refreshModules = cached ? planDetailRefresh(cached, cachedMerged) : undefined;
    const result = await fetchSteamFullDetailsByAppId(appId, { refreshModules });
    if (!result) return { data: null, cachedAt: null, reason: 'no-data' }; // v14.28.12（B2-F4）
    recordUsageCounter('direct.fetch'); // v14.25.0：直取缓存未命中刷新（部分/全量）
    // 部分刷新：校验/返回用"旧合并视图 + 本次补到的字段"（写缓存只写 result）
    const view = refreshModules && cachedMerged ? { ...cachedMerged, ...result } : result;
    // v3.3.14：名称相关性校验（手动选择跳过）
    if (!manual && gameName && !namesRelated(gameName, view.name)) {
      Logger.warn('Steam', `图片 appId ${appId} 与页面标题不相关（${view.name} vs ${gameName}），拒绝并转标题搜索`);
      return { data: null, cachedAt: null, reason: 'name-mismatch' }; // v14.28.12（B2-F4）
    }

    // v4.1.1：版本后缀补搜（findVersionVariant）——标题含"增强版"等版本词、
    // 封面/直取 appId 是旧版时升级到新版（如 gamer520 40746 封面 271590 是
    // GTA5 老版，标题"侠盗猎车手V 增强版"应匹配 3240220）；命中则整体走新版
    let target = result;
    let targetView = view;
    if (!manual && gameName) {
      const variant = await findVersionVariant(appId, gameName);
      if (variant && String(variant.appId) !== String(appId)) {
        const variantResult = await fetchSteamFullDetailsByAppId(variant.appId);
        if (variantResult) {
          Logger.info(
            'Steam',
            `版本后缀补搜: "${gameName}" 封面 ${appId} 为旧版 → 升级 ${variant.appId} ${variantResult.name}`
          );
          target = variantResult;
          targetView = variantResult;
        }
      }
    }

    await setSteamCacheEntry(target.appId, target);
    await recordGameInRegistry(target.appId, {
      cnName: targetView.name,
      enName: targetView.englishName || targetView.name,
      gameName,
      tags: targetView.genres,
      coverImage: targetView.headerImage || ''
    });
    if (gameName) await recordNameIndex(gameName, target.appId);
    // v7.0.3：直取匹配成功也回写网址索引（统一详情页/列表页/Steam 页匹配）
    // v14.29.0：仲裁写入——直取 appId 来自页面封面而非相似度猜测，且已过
    // namesRelated 门 → 确认级（版本后缀补搜升级同强度）
    if (pageUrl) {
      await setUrlAppIdArbitrated(pageUrl, target.appId, {
        confidence: 'confirmed',
        titleHash: gameKeyOf(gameName || '')
      });
    }

    await flushAllCaches();
    const newEntry = await getSteamCacheEntry(target.appId);
    Logger.info('Steam', `通过 appId ${target.appId} 直接获取: ${targetView.name}`);
    noteResolvedGame(sender, targetView); // v14.1.0：SidePanel 联动
    return { data: targetView, cachedAt: newEntry ? latestModuleTs(newEntry) : null };
  } catch (e) {
    Logger.error('Steam', `通过 appId ${appId} 获取失败: ${String(e)}`);
    return { data: null, cachedAt: null, reason: 'fetch-failed' }; // v14.28.12（B2-F4）：与"无数据"区分
  }
}

// 保存用户手动选择的"游戏名→appId"映射

// 保存用户手动选择的"游戏名→appId"映射
export async function handleSaveManualMapping(message) {
  const gameName = (message.gameName || '').trim();
  const appId = message.appId;
  if (!gameName || !appId) return { success: false };
  recordUsageCounter('mapping.manual'); // v14.25.0：手动绑定/候选选择落账

  await recordNameIndex(gameName, appId);
  await recordGameInRegistry(appId, { cnName: gameName, gameName });
  await flushNameIndex();
  await flushRegistry();
  // v3.3.13：手动选择 = 用户确认正确 appid → 记录为纠正知识（长期有效）
  await recordWrongReport(gameName, { correctAppId: appId, source: 'manual' });
  await flushWrongReports();
  // v14.8 批次 3：错题现场自动采集（rawTitle 在场才采集；fire-and-forget
  // 不阻塞确认应答）——采集→入册→回放门闭环的采集端
  if (message.rawTitle) {
    captureMismatchSample({ gameName, rawTitle: message.rawTitle, correctAppId: appId }).catch(() => {});
  }
  Logger.info('Steam', `保存手动映射: "${gameName}" → appId ${appId}`);
  return { success: true };
}

// 搜索候选游戏列表（手动选择浮窗）

// v14.19.0（用户需求：详情页匹配错误时手动选择主机机型）：用户在候选浮窗
// 声明"这是主机/模拟器游戏"并选择机型 → ①按机型转 Metacritic 评分（EN 段
// 取 rawTitle 优先、gameName 兜底，剥平台词后推 slug）；②持久化映射（长期
// 终态，列表/详情两管线优先于一切索引消费——错误 Steam 徽章随映射消失）；
// ③清该名名称索引（错误 Steam 条目的粘性钉住解除）。响应携带 MC 数据供
// 浮窗即时渲染 MC 视图。
export async function handleSetManualPlatform(message) {
  const gameName = (message.gameName || '').trim();
  const option = resolveManualPlatformOption(message.platform);
  if (!gameName || !option) return { success: false, error: '参数缺失或机型不合法' };
  recordUsageEvent('platform', 'declared', { kind: option.kind }); // v14.25.0：机型声明落账
  // EN 段：标题优先（详情页标题常带"中文名|版本|英文名"多段），游戏名兜底
  const enSource = typeof message.rawTitle === 'string' && message.rawTitle.trim() ? message.rawTitle : gameName;
  const enName = trimPlatformTokens(extractEnNameSegment(enSource));
  /** @type {number|null} */
  let mcScore = null;
  /** @type {string|null} */
  let mcName = null;
  if (option.kind === 'console' && enName && enName.length >= 3) {
    // 声明时一次性抓分（主机条目评分源，预算 = 单次；失败置 null 不阻断映射）
    mcScore = await fetchMetacriticScore(enName).catch(() => null);
    if (mcScore != null) mcName = enName;
  }
  await setManualPlatform(gameName, {
    kind: option.kind,
    tag: option.tag,
    mcScore,
    mcName
  });
  await flushManualPlatforms();
  // 错误 Steam 条目的名称索引粘性钉住解除（映射检查先于索引，此步为 hygiene）
  await deleteNameIndexEntry(gameName).catch(() => {});
  Logger.info('Steam', `手动平台声明: "${gameName}" → ${option.kind}/${option.tag} (MC ${mcScore ?? '—'})`);
  return {
    success: true,
    kind: option.kind,
    tag: option.tag,
    mcScore,
    mcName,
    name: gameName
  };
}

// 搜索候选游戏列表（手动选择浮窗）
export async function handleSearchSteamCandidates(message) {
  const searchTerms = parseGameTitle(message.gameName || '');
  const candidates = [];
  const seen = new Set();
  for (const term of searchTerms.slice(0, 3)) {
    try {
      const result = await searchSteamAppId([term], term);
      if (result) {
        // v10.8.1：appId 规范化为字符串（storesearch 的 item.id 是数字——
        // 内容侧 escapeAttr 曾因数字入参抛 TypeError，见 shared/escape.js 同修）
        const item = { appId: String(result.appId), name: result.name };
        if (!seen.has(item.appId)) {
          seen.add(item.appId);
          candidates.push({ appId: item.appId, name: item.name, price: null, image: '' });
        }
      }
    } catch {
      /* 单个词失败继续 */
    }
  }
  return { candidates: candidates.slice(0, 10) };
}

// 强制刷新当前页缓存（popup"强制刷新"）：按 appIds/names 删除 Steam 缓存与
// 名称索引（含负缓存），页面重载后从 Steam 全新拉取（忽略 TTL 与 0 评测冷却）。
// Force-refresh the current page's Steam cache (popup button): deletes cache and
// name-index entries (negative ones included); the reload then fetches
// everything fresh from Steam, ignoring cache TTLs and the zero-review cooldown.
export async function handleClearCacheForPage(message) {
  recordUsageCounter('cache.forceClearPage'); // v14.25.0：popup 强制刷新当前页
  const names = message.names || [];
  const appIds = message.appIds || [];
  const seen = new Set();
  let cleared = 0;
  for (const id of appIds) {
    const key = String(id);
    if (!seen.has(key)) {
      seen.add(key);
      await deleteSteamCacheEntry(key);
      cleared++;
    }
  }
  for (const name of names) {
    const appId = await lookupAppIdByName(name);
    if (appId && !seen.has(String(appId))) {
      seen.add(String(appId));
      await deleteSteamCacheEntry(String(appId));
      cleared++;
    }
    // 名称索引条目（正/负缓存）一并删除，防止负缓存拦截重新获取
    await deleteNameIndexEntry(name);
  }
  await flushSteamCache();
  await flushNameIndex();
  Logger.info('Cache', `强制刷新清除 ${cleared} 条 Steam 缓存（${names.length} 个游戏名）`);
  return { success: true, cleared };
}

// Steam 商品页缓存预取（v3.3.8）：浏览 store.steampowered.com/app/{id}/ 时
// 预热该游戏缓存——detail 模块有效则跳过（防重复请求）；否则完整拉取并记录
// 名称索引（回下载站列表页徽章/筛选立即命中）
// Steam-store-page cache warm-up: prefetch the game's full data while browsing
// its store page (skipped when the detail module is still valid); the name
// index entry makes download-site list badges hit instantly afterwards.
export async function handleCacheSteamPage(message) {
  const appId = String(message.appId || '');
  const gameName = message.gameName || '';
  if (!appId) return { success: false };
  try {
    const cached = await getSteamCacheEntry(appId);
    const detail = isModuleValid(cached, 'detail', detailSteamCacheTtlMs()) ? getModuleData(cached, 'detail') : null;
    if (detail && isDetailCacheComplete(cached)) return { success: true, cached: true };
    // v14.28.8：残缺缓存只补缺失模块（无条目 → 全量）
    const plan = cached ? planDetailRefresh(cached, getMergedData(cached)) : undefined;
    const result = await fetchSteamFullDetailsByAppId(appId, { refreshModules: plan });
    if (!result) return { success: false };
    await setSteamCacheEntry(appId, result);
    if (gameName) await recordNameIndex(gameName, appId);
    await flushSteamCache();
    await flushNameIndex();
    Logger.info('Steam', `Steam 商品页缓存预取: appId ${appId} (${result.name})`);
    return { success: true, cached: false };
  } catch (e) {
    Logger.warn('Steam', `Steam 商品页缓存预取失败: appId ${appId}`, String(e));
    return { success: false };
  }
}

// 人工报错重检索（v3.3.11）：详情页浮窗"报错"按钮——用户发现检索到错误的
// appid 时，清除该 appId 的 Steam 缓存/名称索引（正/负缓存都删，防负缓存
// 拦截重检索）/下载站网址映射（30 天错误映射一并清除），随后重新检索。
// 注册表不删：它是 Steam 官方信息，错误的是"标题→appId"的映射。
// v9.7.0：同时清除当前页的网址索引绑定（sender.tab.url）——此前报错不覆盖
// URL 索引，重载页面后 SEARCH_STEAM 仍命中同一错误 appId 原样返回，报错
// 自愈闭环被 URL 第一候选短路击穿。
// Manual wrong-appId report: clears the wrong appId's Steam cache, name-index
// entries (both signs, so the negative cache can't block the re-search),
// download-URL mappings and the page's URL-index binding; the registry is kept
// (it holds official Steam info, only the title→appId mapping was wrong).
export async function handleReportWrongAppId(message, sender) {
  const appId = String(message.appId || '');
  const gameName = message.gameName || '';
  const pageUrl = sender && sender.tab ? sender.tab.url : '';
  recordUsageEvent('report', 'wrongAppId', { appId: appId || undefined }); // v14.25.0：人工报错落账
  if (appId) {
    await deleteSteamCacheEntry(appId);
    const urlStore = await readDownloadUrlsStore();
    for (const bucket of Object.values(urlStore.sites || {})) {
      if (bucket[appId]) delete bucket[appId];
    }
    await dataStore.writeModule(DB_KEYS.DOWNLOAD_URLS, urlStore);
  }
  // v9.7.0：报错页面必然是写入了错误绑定的来源页（或其复读者）——清除后
  // 重载将重新走标题搜索，匹配成功即换绑正确 appId
  if (pageUrl) await deleteUrlAppId(pageUrl);
  if (gameName) await deleteNameIndexEntry(gameName);
  await flushSteamCache();
  await flushNameIndex();
  // v3.3.13：记录报错样本（长期有效，供检索纠正知识库与错误排除）
  if (gameName && appId) {
    await recordWrongReport(gameName, { wrongAppId: appId, source: 'report' });
    await flushWrongReports();
  }
  Logger.info('Cache', `人工报错: 清除 appId ${appId || '?'} 缓存（${gameName}）`);
  return { success: true };
}

// --- 缓存过期清理（v3.0.0）---

// --- 名称批量自愈（v3.1.0）---
export async function handleHealRegistryNames(message) {
  const result = await scanAndHealRegistry(Math.min(50, (message && message.limit) || 20));
  Logger.info(
    'Steam',
    `名称批量自愈: 扫描 ${result.scanned} 条, 修复 ${result.healed} 条, 剩余 ${result.remaining} 条`
  );
  return result;
}

// v14 B10：领域 handler 段（action → handler 单处声明，handlers.js 聚合展开）
// GET_STEAM_RATINGS/PREFETCH 归口自此（实现在 steam/ratings-batch.js）
import { handleGetSteamRatings, handlePrefetchSteamRatings, getRatingsQueueStatus } from '../steam/ratings-batch.js';

// v14.7 批次 3：未找到徽章点击重试——穿透负缓存单游戏重查。窄化 action 直调
// searchSteamGame（URL 索引只在 handleSearchSteam 记录，本路径不写——列表页
// sender URL 是列表页，写入会污染 URL→appId 缓存）。 Throttling is on the
// content side (10s/game).
export async function handleRetryGameLookup(message) {
  recordUsageCounter('retry.lookup'); // v14.25.0：未找到徽章点击重查
  const result = await searchSteamGame(String(message.gameName || ''), { ignoreNegativeCache: true });
  return result || null;
}

export const steamHandlers = {
  SEARCH_STEAM: handleSearchSteam,
  RETRY_GAME_LOOKUP: handleRetryGameLookup, // v14.7 批次 3
  REFRESH_STEAM_CACHE: handleRefreshSteamCache,
  GET_STEAM_BY_APPID: handleGetSteamByAppId,
  SAVE_MANUAL_MAPPING: handleSaveManualMapping,
  SET_MANUAL_PLATFORM: handleSetManualPlatform, // v14.19.0：手动主机机型声明
  SEARCH_STEAM_CANDIDATES: handleSearchSteamCandidates,
  GET_STEAM_RATINGS: handleGetSteamRatings,
  PREFETCH_STEAM_RATINGS: handlePrefetchSteamRatings,
  // v14.8.1：等待检测徽章实时队列信息（内容侧 5s 轮询消费）
  // v14.29.0：透传 sender tabId → 快照附 `you`（本页排队位置/前方条目数）
  GET_RATINGS_QUEUE_STATUS: (m, sender) => getRatingsQueueStatus(sender && sender.tab ? sender.tab.id : null),
  CLEAR_CACHE_FOR_PAGE: handleClearCacheForPage,
  CACHE_STEAM_PAGE: handleCacheSteamPage,
  REPORT_WRONG_APPID: handleReportWrongAppId,
  HEAL_REGISTRY_NAMES: handleHealRegistryNames,
  GET_TAB_GAME: (m) => ({ game: getTabGame(m && m.tabId) }) // v14.1.0：SidePanel 当前页游戏
};

// --- Steam API 状态监测（v3.3.0）---
