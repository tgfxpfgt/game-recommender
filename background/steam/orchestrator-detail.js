/**
 * 游戏雷达 Game Radar - 详情页搜索管线 / Detail-Page Search Pipeline
 *
 * v14.3.0（第五轮 B4）：由 orchestrator.js 拆分——searchSteamGame 全流程：
 * 名称索引 → 人工纠正知识库 → 动态缓存（含 Demo 自愈）→ 兜底搜索
 * （Bing/LLM）→ 完整详情 → 三层缓存写入。
 * The detail-page pipeline: name index → wrong-report corrections → dynamic
 * cache (demo self-heal) → fallback search (Bing/LLM) → full details →
 * 3-layer cache writes.
 */
import {
  searchSteamAppId,
  fetchSteamFullDetailsByAppId,
  isDemoAppId,
  ensureRegistryEntry,
  ensureValidRegistryNames,
  needsRatingRefetch,
  isCompleteCacheData,
  namesRelated
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
import { parseGameTitle } from '../core/title-parser.js';
import { Logger } from '../storage/logger.js';
import { detailSteamCacheTtlMs } from '../core/constants.js';
import { llmMatchGame, webSearchFallback } from './ai-fallback.js'; // v6.4.16/17：规则匹配失败后的匹配兜底
import { getSteamApiStatus } from '../core/api-monitor.js'; // v9.7.0：网络故障期跳过负缓存
import { isDemoCacheWithoutRating } from './orchestrator-shared.js';

/**
 * 搜索游戏并获取完整 Steam 详情（详情页/浮窗使用）
 * 流程：名称索引 → 动态缓存（含 Demo 自愈）→ 搜索 → 完整详情 → 三层缓存。
 * Search a game and fetch full Steam details (detail pages/panels).
 */
export async function searchSteamGame(gameName, options = {}) {
  // 1. 通过名称索引查找 appId / Lookup appId via name index
  /** @type {string|number|null} */
  let appId = await lookupAppIdByName(gameName);

  // 1.5 人工纠正知识库优先（v3.3.13）：该标题曾报错并手动确认了正确 appid——
  // 用户确认 > 自动匹配；同时清除该名负缓存（纠正名不应被负缓存拦截）
  const correction = await lookupWrongReportCorrection(gameName);
  /** @type {string|number|null} */
  let excludeAppId = null;
  if (correction) {
    appId = correction.correctAppId;
    excludeAppId = correction.wrongAppId;
    await deleteNameIndexEntry(gameName);
  }

  // 2. 若有 appId，检查 Steam 动态缓存（v3.3.7 模块化：detail 模块有效且
  //    数据完整才命中——列表页仅 rating 模块的条目不满足，转完整拉取，
  //    拉取只更新 detail/spy 模块，meta/rating 保留）。
  //    v3.3.10：命中前校验标题与缓存名相关——名称索引粘性条目（历史误写
  //    钉死 appId）在此被推翻，转重新搜索自愈（如 16598 页误钉 2001760）
  if (appId) {
    const cached = await getSteamCacheEntry(appId, 'detail');
    const detail = isModuleValid(cached, 'detail', detailSteamCacheTtlMs()) ? getModuleData(cached, 'detail') : null;
    const merged = getMergedData(cached) || {};
    // 无好评率条目（0 评测/失败固化）按冷却期重新获取
    if (
      detail &&
      merged.appId &&
      merged.name &&
      isCompleteCacheData(detail) &&
      !needsRatingRefetch(merged) &&
      namesRelated(gameName, merged.name)
    ) {
      // 自愈：Demo 版缓存无好评率 → 忽略缓存，重新搜索完整版
      if (isDemoCacheWithoutRating(merged)) {
        appId = null;
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
        return merged;
      }
    } else if (await isDemoAppId(appId)) {
      // 缓存缺失/过期且该 appId 是 Demo 版 → 重新搜索完整版
      appId = null;
    }
  } else if (!options.ignoreNegativeCache && (await isRecentlySearchedNotFound(gameName))) {
    // 3. 无 appId 时，检查负缓存（v10.9.2：ignoreNegativeCache 可穿透——详情页
    // 对未命中自动重试一次，历史失败遗留的负缓存不再永久阻断自动匹配）
    return null;
  }

  try {
    // 4. 搜索 appId（若已有 appId 但缓存过期，跳过搜索直接获取详情；
    //    v3.3.13：排除曾报错的错误 appid）
    // v14.3.2：rawTitle 三阶段匹配（franchise 区分策略，审查报告 P1-A）
    // 阶段 1：中文检索（现有逻辑）
    // 阶段 2：交叉验证——内容词覆盖判据（替代 v14.3.1 零交集判据）：
    //   正确命中名覆盖 raw 英文段全部内容词；franchise 兄弟篇只覆盖头词、
    //   缺失特征词（如 "德米欧 x D&D" 缺 neverwinter/nights）。
    //   触发条件：rawWords ≥ 2 且（零交集 或 覆盖不全）→ 英文重搜 l=english。
    //   单调改进护栏：仅当英文结果覆盖严格更优才替换。
    // 阶段 3：中文全空 → raw 标题英文段兜底。
    const enSegment = options.rawTitle
      ? (options.rawTitle.match(/[A-Za-z][A-Za-z0-9 &:.'\-]{5,}/) || [''])[0].trim()
      : '';
    // 版本级噪声词（命中名缺版本后缀属正常，不计入覆盖判据）
    const EDITION_WORDS = new Set([
      'edition', 'enhanced', 'deluxe', 'upgrade', 'remastered', 'remaster',
      'definitive', 'complete', 'goty', 'bundle', 'collection', 'demo', 'trial'
    ]);
    /** @param {string} s */
    const enWordsOf = (s) => new Set((String(s).toLowerCase().match(/[a-z][a-z0-9]{3,}/g) || []));
    if (!appId) {
      let searchResult = await searchSteamAppId(parseGameTitle(gameName), gameName, excludeAppId);
      // 阶段 2：内容词覆盖交叉验证
      if (searchResult && enSegment) {
        const rawWords = [...enWordsOf(enSegment)].filter((w) => !EDITION_WORDS.has(w));
        const coverOf = (name) => rawWords.filter((w) => enWordsOf(name).has(w)).length;
        const hitCover = coverOf(searchResult.name);
        // rawWords ≥ 2 护栏：单词段区分度不足，不触发
        const needEn =
          rawWords.length >= 2 && (hitCover === 0 || hitCover < rawWords.length);
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
            }
            // 等覆盖/更差 → 保留中文命中（防英文段拼写噪声抖动）
          }
        }
      }
      // 阶段 3：中文全空 → raw 标题英文段兜底
      if (!searchResult && enSegment) {
        searchResult = await searchSteamAppId([enSegment], options.rawTitle, excludeAppId, 'english');
      }
      if (!searchResult) {
        // v6.4.16：规则匹配失败 → 匹配兜底（防幻觉：均经官方数据校验后才采用）
        // v6.4.17：搜索引擎兜底（Bing，免费无需配置）优先 → AI/LLM 兜底（用户配置时）
        // 错配比未找到更糟——兜底均失败时返回 null（显示"未找到"，可走报错纠正黑名单）
        const fallback =
          (await webSearchFallback(gameName, excludeAppId)) || (await llmMatchGame(gameName, excludeAppId));
        if (fallback) {
          appId = fallback.appId;
        } else {
          // 记录负缓存 / Record negative cache
          // v9.7.0：网络故障期不做负缓存固化——searchSteamAppId 吞掉网络异常
          // 返回 null（与"确认未找到"不可区分），断网时会把故障固化为 2h 负
          // 缓存。窗口内有失败记录即视为网络不可靠，跳过负缓存（本路径可重试）
          const apiStatus = getSteamApiStatus();
          if (apiStatus.failed === 0) {
            await recordNameIndex(gameName, null);
          } else {
            Logger.warn(
              'Steam',
              `搜索未命中且窗口内 ${apiStatus.failed} 次 API 失败（疑似网络问题），跳过负缓存: "${gameName}"`
            );
          }
          return null;
        }
      } else {
        appId = searchResult.appId;
      }
    }

    // 5. 获取完整 Steam 详情 / Fetch full Steam details
    let result = await fetchSteamFullDetailsByAppId(appId);
    if (!result) return null;

    // v14.3.2：DLC → 自动解析为本体 appId（与列表页 step 4.5 对齐）。
    // fetchSteamFullDetailsByAppId 返回 appdetails 原始 type/fullgame 字段——
    // DLC 命中时好评率/评测数据归属 DLC 而非本体，需替换后重取本体详情。
    if (result.type === 'dlc' && result.fullgame) {
      const baseId = String(result.fullgame.appid || result.fullgame.appId || '');
      if (baseId && baseId !== String(appId)) {
        Logger.info('Steam', `DLC 解析: ${result.name} (DLC ${appId}) → 本体 ${baseId} (${result.fullgame.name || ''})`);
        const baseResult = await fetchSteamFullDetailsByAppId(baseId);
        if (baseResult) {
          appId = baseId;
          result = baseResult;
        }
        // 本体获取失败 → 保留 DLC 数据（劣于无数据）
      }
    }

    // 6. 写入三层缓存：Steam 动态缓存(24h) + 游戏注册表(永久) + 名称索引
    //    注册表以 Steam 官方中英文名为准，下载站标题入 names 变体，封面一并缓存
    // v6.4.10：好评率重试计数——获取失败（positiveRate null）→ +1（刷新重试
    // 上限 3 次），成功 → 归零
    {
      const oldCached = await getSteamCacheEntry(appId);
      const oldRating = oldCached ? getModuleData(oldCached, 'rating') : null;
      const oldCount = (oldRating && oldRating.ratingFailCount) || 0;
      result.ratingFailCount = result.positiveRate == null ? oldCount + 1 : 0;
    }
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

    return result;
  } catch (error) {
    console.error('Steam API 调用失败:', error);
    return null;
  }
}
