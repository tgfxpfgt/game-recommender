/**
 * 游戏雷达 Game Radar - 列表页批量好评率 / List-Page Rating Batches
 *
 * v3.4.0：从 handlers.js 拆分——列表页两波好评率查询（缓存命中即时返回 +
 * 未命中后台批量拉取并增量推送）与下一页预载预热。SW 保活、限流降速、
 * 失败重试、落盘降频（每 5 批一次）均集中于此。
 *
 * Two-phase list-page rating lookup (cache hits return instantly; misses are
 * fetched in batches with incremental pushes) plus next-page prefetch warming.
 * Keep-alive, rate-limit slowdown, retry and debounced persistence live here.
 */
import { getSteamPositiveRate, getSteamRatingsFromCacheOnly } from './orchestrator.js';
import { flushAllCaches } from '../storage/flush.js';
import { getSteamCacheEntry, isModuleValid, getModuleData } from '../storage/steam-cache.js';
import { getAppIdByUrl } from '../storage/url-index.js'; // v7.0.2：详情页网址第一候选
import { lookupAppIdByName } from '../storage/name-index.js';
import { Logger } from '../storage/logger.js';
import { getSteamApiStatus } from '../core/api-monitor.js';

// 列表页批量好评率查询（两阶段：缓存命中即时返回，未命中后台拉取后推送）
// Two-phase list-page rating lookup: cached hits return immediately; misses are
// fetched from Steam in the background and pushed back via STEAM_RATINGS_UPDATE.
export async function handleGetSteamRatings(message, sender) {
  const ratingNames = message.names || [];
  const imageData = message.imageData || {};
  const appIds = message.appIds || {};
  const urls = message.urls || {}; // v7.0.2：name → 详情页网址（URL 索引第一候选）
  const cacheOnly = message.cacheOnly === true; // 兜底重试：只查缓存，不触发后台拉取
  const ratings = {};
  const pending = [];

  // 阶段0（v7.0.2）：详情页网址索引第一候选——同 URL 已匹配过 appId 的
  // 直接按该 appId 查缓存（统一列表页/详情页匹配结果）
  // Phase 0: detail-URL index as the first candidate.
  const urlAppIds = {};
  for (const name of ratingNames) {
    const u = urls[name];
    if (!u) continue;
    try {
      const appId = await getAppIdByUrl(u);
      if (appId) urlAppIds[name] = appId;
    } catch {
      /* 索引异常忽略 */
    }
  }

  // 阶段1：仅查缓存（无网络），命中即时返回 / Phase 1: cache-only, instant hits
  try {
    await Promise.all(
      ratingNames.map(async (name) => {
        try {
          const urlAppId = urlAppIds[name] || null;
          const img = imageData[name] || (appIds[name] ? { appId: appIds[name] } : null);
          const r = await getSteamRatingsFromCacheOnly(name, {
            appId: urlAppId || (img ? img.appId : null),
            cover: img ? img.cover : null
          });
          if (r) ratings[name] = r;
          else pending.push(name);
        } catch {
          pending.push(name);
        }
      })
    );
  } catch {
    pending.push(...ratingNames.filter((n) => !ratings[n]));
  }

  // 阶段2：未命中 → 后台继续从 Steam 拉取（忽略负缓存），**按批落盘并推送
  // 增量**（防 SW 休眠导致整批结果丢失）；全部完成后推送 done 标记供内容脚本收尾。
  // 批内每 10s 调用扩展 API 保活，防止 SW 空闲休眠中断循环（中国网络下 Steam
  // 请求常挂起 5-15s，批内等待可能超过 MV3 SW 的 30s 空闲限制）；批内失败/限流
  // 的游戏自动进入重试队列（最多一轮）。
  // v3.4.0：落盘降频——每 5 批一次全量 flush（60 游戏 ≈ 12 次而非 60 次写入），
  // 配合 keepAlive 与最终 flush 兜底。
  // Phase 2: fetch misses in the background; batches are persisted and pushed
  // incrementally (survives SW suspension). A keep-alive call every 10s prevents
  // idle suspension; failed/rate-limited games retry once. Persistence is
  // debounced to every 5th batch since v3.4.0 (~12 writes instead of ~60).
  if (!cacheOnly && pending.length > 0) {
    const tabId = sender && sender.tab ? sender.tab.id : null;
    const names = pending.slice();
    (async () => {
      const keepAlive = setInterval(() => {
        chrome.runtime.getPlatformInfo().catch(() => {});
      }, 10000);
      try {
        // v6.4.15：并发自适应——正常 6 并发提速（中国网络下 Steam 请求常
        // 挂起 5-15s，3 并发时 50 游戏列表需约 1 分钟，后半部分长时间无徽章）；
        // 检测到限流异常时降为 2 并配合下方降速等待
        const anomaly = getSteamApiStatus().anomaly;
        const batchSize = anomaly ? 2 : 6;
        const push = (payload) => {
          if (tabId !== null && tabId !== undefined) {
            chrome.tabs.sendMessage(tabId, { action: 'STEAM_RATINGS_UPDATE', ...payload }).catch(() => {});
          }
        };
        let queue = names;
        let retried = false;
        let consecutiveAnomaly = 0;
        let batchCount = 0;
        while (queue.length > 0) {
          const batch = queue.slice(0, batchSize);
          queue = queue.slice(batchSize);
          const wave = {};
          const retryBatch = [];
          await Promise.all(
            batch.map(async (name) => {
              try {
                const urlAppId = urlAppIds[name] || null;
                const img = imageData[name] || (appIds[name] ? { appId: appIds[name] } : null);
                const r = await getSteamPositiveRate(name, {
                  ignoreNegativeCache: true,
                  appId: urlAppId || (img ? img.appId : null),
                  cover: img ? img.cover : null
                });
                wave[name] = r;
                // 网络失败/限流（null 或 failed 标记）→ 进入重试队列
                if (!r || r.failed) retryBatch.push(name);
              } catch {
                wave[name] = null;
                retryBatch.push(name);
              }
            })
          );
          // v3.4.0：每 5 批落盘一次 + 循环结束兜底（写放大 ~80% 下降）
          batchCount++;
          if (batchCount % 5 === 0 || queue.length === 0) {
            await flushAllCaches();
          }
          push({ ratings: wave });
          // 限流降速：Steam API 异常状态时拉大批次间隔；连续异常暂停 30s 等窗口恢复
          if (getSteamApiStatus().anomaly) {
            consecutiveAnomaly++;
            const wait = consecutiveAnomaly >= 2 ? 30000 : 5000;
            if (queue.length > 0 || retryBatch.length > 0) await new Promise((r) => setTimeout(r, wait));
          } else {
            consecutiveAnomaly = 0;
          }
          // 一轮结束后重试失败的条目（最多一轮，防无限循环）
          if (queue.length === 0 && retryBatch.length > 0 && !retried) {
            retried = true;
            queue = retryBatch;
          }
        }
        // 全部完成：done 标记（内容脚本据此收尾并显示统计）
        push({ ratings: null, done: true });
      } catch (e) {
        Logger.warn('Steam', '后台补拉好评率失败', String(e));
      } finally {
        clearInterval(keepAlive);
      }
    })();
  }

  return { ratings, pending: pending.length };
}

// 预热下一页 Steam 缓存（仅填充缓存不返回数据）
export async function handlePrefetchSteamRatings(message) {
  const ratingNames = message.names || [];
  const imageData = message.imageData || {};
  const appIds = message.appIds || {};
  const covers = message.covers || {};
  if (ratingNames.length === 0) return { success: true };

  // 过滤：跳过已有有效缓存（预载同样忽略负缓存，重试一次值得）
  const needsPrefetch = [];
  for (const name of ratingNames) {
    try {
      const appId = await lookupAppIdByName(name);
      if (appId) {
        const cached = await getSteamCacheEntry(appId);
        // v3.3.7：rating 模块有效（含好评率）即跳过；仅 rating 过期才预载
        const rating = isModuleValid(cached, 'rating') ? getModuleData(cached, 'rating') : null;
        if (rating && rating.positiveRate !== undefined) continue;
        needsPrefetch.push(name);
      } else {
        needsPrefetch.push(name);
      }
    } catch {
      needsPrefetch.push(name);
    }
  }
  if (needsPrefetch.length === 0) return { success: true };

  // 预载同样批内保活，防 SW 休眠中断（见 handleGetSteamRatings 说明）
  // Keep-alive during prefetch batches too (see handleGetSteamRatings)
  const keepAlive = setInterval(() => {
    chrome.runtime.getPlatformInfo().catch(() => {});
  }, 10000);
  try {
    const batchSize = 4;
    for (let i = 0; i < needsPrefetch.length; i += batchSize) {
      const batch = needsPrefetch.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (name) => {
          try {
            const img = imageData[name] || (appIds[name] ? { appId: appIds[name], cover: covers[name] } : null);
            await getSteamPositiveRate(name, {
              ignoreNegativeCache: true,
              appId: img ? img.appId : null,
              cover: img ? img.cover : null
            });
          } catch {}
        })
      );
      // 预载同样限流降速 / same rate-limit slowdown as the main flow
      if (getSteamApiStatus().anomaly) {
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    await flushAllCaches();
    return { success: true };
  } finally {
    clearInterval(keepAlive);
  }
}
