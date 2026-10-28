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
import { PERF_CONFIG } from '../core/constants.js';
import { getSettings } from '../core/settings.js'; // v14.5.0 B9：用户批大小接线
import { flushAllCaches } from '../storage/flush.js';
import { getSteamCacheEntry, isModuleValid, getModuleData } from '../storage/steam-cache.js';
import { getAppIdByUrl } from '../storage/url-index.js'; // v7.0.2：详情页网址第一候选
import { lookupAppIdByName } from '../storage/name-index.js';
import { Logger } from '../storage/logger.js';
import { getSteamApiStatus } from '../core/api-monitor.js';
import { metricInc, metricObserve } from '../core/metrics.js'; // v10.7.0：运行指标
import { getAppStats } from '../storage/app-stats.js'; // v10.1.0：a-b 徽章数据并入 ratings

// v10.1.0：把 AppID 行为统计（a 下载 / b 详情页打开）并入 rating 条目——
// wave 1 / 推送 / 刷新全链路自动携带，内容侧 prependBadge 直接渲染 "a-b" 徽章
function mergeAppStat(r, statsMap) {
  if (!r || !r.appId || !statsMap) return r;
  const stat = statsMap[String(r.appId)];
  if (!stat) return r;
  return { ...r, appDownloads: stat.downloads, appDetailViews: stat.detailViews };
}

// 列表页批量好评率查询（两阶段：缓存命中即时返回，未命中后台拉取后推送）
// Two-phase list-page rating lookup: cached hits return immediately; misses are
// fetched from Steam in the background and pushed back via STEAM_RATINGS_UPDATE.
/** @param {import('../core/types.js').MessagePayload} message */
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
  // v10.1.0：批量读 a-b 统计一次（内存缓存，零额外 IO）
  const statsMap = await getAppStats();
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
          if (r) ratings[name] = mergeAppStat(r, statsMap);
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
  // v10.0.0：任务状态持久化到 storage.session——Chrome 110+ SW 存活满 5 分钟
  // 后扩展 API 调用不再重置空闲计时器（keepAlive 失效），SW 被杀后由 alarm
  // 唤醒新实例从上个批次边界续跑（已完成的名字不入队，不重复拉取）。
  // Phase 2: fetch misses in the background; batches are persisted and pushed
  // incrementally. Since v10.0.0 the job state is checkpointed to session
  // storage after every batch; a fresh SW resumes from the last boundary.
  if (!cacheOnly && pending.length > 0) {
    const tabId = sender && sender.tab ? sender.tab.id : null;
    const job = {
      tabId,
      queue: pending.slice(), // 待拉取名字（批次边界推进）/ names awaiting fetch
      retried: false, // 失败重试轮是否已用 / retry round used
      urlAppIds,
      imageData,
      appIds,
      startedAt: Date.now()
    };
    startRatingJob(job);
  }

  return { ratings, pending: pending.length };
}

// ============ 可恢复批处理任务 / Resumable rating job (v10.0.0) ============

const JOB_SESSION_KEY = 'grRatingsBatchJob';
const JOB_MAX_AGE_MS = 60 * 60 * 1000; // 超过 1h 的任务视为陈旧丢弃
const RESUME_ALARM = 'ratingsBatchResume';

async function persistJob(job) {
  try {
    await chrome.storage.session.set({ [JOB_SESSION_KEY]: job });
  } catch {
    /* session 不可用（极旧 Chrome）→ 退化为不可恢复模式 */
  }
}

async function clearPersistedJob() {
  try {
    await chrome.storage.session.remove(JOB_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function setupResumeAlarm() {
  try {
    chrome.alarms.create(RESUME_ALARM, { periodInMinutes: 1 });
  } catch {
    /* alarms 不可用（测试环境）忽略 */
  }
}

function teardownResumeAlarm() {
  try {
    chrome.alarms.clear(RESUME_ALARM);
  } catch {
    /* ignore */
  }
}

// v10.3.0：按 tab 队列化——此前单一 jobRunning 守卫在多标签页并发时
// **整只丢弃**后到任务（对应页面徽章永不渲染，E2E 间歇性 3b 失败根因）。
// 跨 tab 并发（推送各自独立互不干扰）、同 tab 串行（内容侧 done 衔接语义）
/** @type {Map<string, {running: boolean, pending: Array<Object>}>} */
const jobQueues = new Map();

function queueKey(tabId) {
  return tabId === null || tabId === undefined ? 'null' : String(tabId);
}

function runNextForTab(key) {
  const q = jobQueues.get(key);
  if (!q || q.running) return;
  const job = q.pending.shift();
  if (!job) return;
  q.running = true;
  (async () => {
    try {
      await persistJob(job);
      setupResumeAlarm();
      await runRatingJob(job);
    } finally {
      q.running = false;
      runNextForTab(key);
    }
  })();
}

// 发起任务（fire-and-forget；同 tab 串行、跨 tab 并发，永不丢弃）
// start a job (fire-and-forget; serialized per tab, concurrent across tabs)
export function startRatingJob(job) {
  const key = queueKey(job.tabId);
  let q = jobQueues.get(key);
  if (!q) {
    q = { running: false, pending: [] };
    jobQueues.set(key, q);
  }
  q.pending.push(job);
  runNextForTab(key);
  return true;
}

// SW 冷启动/alarm 唤醒时续跑检查点任务。
// v14.6.2 修复（审查 A4）：改经 startRatingJob 入该 tab 队列串行消化——
// 原实现直接 runRatingJob 绕过 jobQueues，SW 重启后同 tab 新 job 与续跑
// job 并发，两路推送交错破坏"同 tab 串行 + done 衔接"契约。alarm 重复
// 唤醒的幂等性由 startRatingJob 入队 + 检查点覆盖式持久化自然保证。
// Resume the checkpointed job after a SW cold start or alarm wake; the job
// re-enters the per-tab queue so repeated alarm wakes stay serialized.
export async function resumeRatingsBatch() {
  /** @type {{queue?: Array<Object>, startedAt?: number}|null} */
  let job = null;
  try {
    const data = await chrome.storage.session.get(JOB_SESSION_KEY);
    job = (data && data[JOB_SESSION_KEY]) || null;
  } catch {
    return { resumed: false, reason: 'no-session' };
  }
  if (!job || !Array.isArray(job.queue)) return { resumed: false, reason: 'no-job' };
  if (!job.startedAt || Date.now() - job.startedAt > JOB_MAX_AGE_MS) {
    await clearPersistedJob();
    return { resumed: false, reason: 'stale' };
  }
  // v14.6.2 修复（审查 A4）：经 startRatingJob 重新入该 tab 队列——原实现
  // 直接 runRatingJob 绕过 jobQueues，SW 重启后同 tab 新 job（用户翻页/刷新
  // 触发）与续跑 job 并发，两路推送交错破坏"同 tab 串行 + done 衔接"契约
  // （旧 job 先推 done:true 会截断新 job 的增量）。入队即返回（队列
  // fire-and-forget 串行消化；persistJob 由队列首步负责）。
  startRatingJob(job);
  return { resumed: true, remaining: job.queue.length };
}

// 任务主循环（批次边界推进 job.queue 并持久化；SW 被杀后从最后边界续跑）
// Job main loop: job.queue advances per batch and is checkpointed; a killed SW
// resumes from the last boundary.
async function runRatingJob(job) {
  const keepAlive = setInterval(() => {
    chrome.runtime.getPlatformInfo().catch(() => {});
  }, PERF_CONFIG.ratingsKeepAliveIntervalMs);
  // v10.1.0：a-b 统计批量读一次（任务期共享）
  const statsMap = await getAppStats();
  try {
    const push = (payload) => {
      if (job.tabId !== null && job.tabId !== undefined) {
        chrome.tabs.sendMessage(job.tabId, { action: 'STEAM_RATINGS_UPDATE', ...payload }).catch(() => {});
      }
    };
    // v6.4.15：并发自适应（恢复时重算——限流状态可能已变化）
    // v14.5.0 B9：用户设置接线——settings.ratingsBatchSize（v10.7.0 起设置键
    // 收集但从未被消费，UI 配置静默失效）作为基础批大小；API 异常降速仍走
    // PERF_CONFIG（自适应优先于用户偏好）；设置不可达回退 PERF_CONFIG
    let baseBatch = PERF_CONFIG.ratingsBatchSize;
    try {
      const settings = await getSettings();
      if (settings && settings.ratingsBatchSize) baseBatch = settings.ratingsBatchSize;
    } catch {
      /* 设置不可达回退 PERF_CONFIG */
    }
    let batchSize = getSteamApiStatus().anomaly ? PERF_CONFIG.ratingsBatchSizeAnomaly : baseBatch;
    const allNames = job.queue;
    let retried = job.retried === true;
    // v14.7 批次 6：worker pool——N 并发消费名字队列。150ms 全局限速不变
    //（steamRateLimit 按 slot 串行放行），网络等待跨名字重叠（60 游戏纯限速
    // 9s → ~3s）。波次推送/检查点/异常降速语义与旧批循环一致。
    // Worker pool: N concurrent consumers over the name queue; the 150ms rate
    // limit still paces slots, waits overlap across names.
    const concurrency = Math.max(1, Number(PERF_CONFIG.steamFetchConcurrency) || 3);
    const totalNames = allNames.length;
    let doneCount = 0;
    let consecutiveAnomaly = 0;
    /** @type {Map<string, any>} */
    const pendingWave = new Map(); // 未推送结果（≥ batchSize 或收尾时成波推送）
    const retryNames = []; // 网络失败/限流（null 或 failed 标记）
    /** @type {{done: boolean, promise: Promise<void>}|null} */
    let anomalyGate = null; // 共享暂停门（所有 worker 等同一窗口，防 N 个独立定时器）

    // v14.7 批次 5：条目级进度（重试轮不重复计数，done 钳到 total）
    const progressPayload = () => ({
      progress: {
        done: Math.min(doneCount, totalNames),
        total: totalNames,
        degraded: getSteamApiStatus().anomaly
      }
    });

    // 成波推送 + 检查点（SW 被杀后从当前 pass 未完成处续跑——比旧实现多覆盖
    // 在途项，耐久性更好）/ Flush a wave + checkpoint (also covers in-flight).
    const flushWave = async (passNames, completedInPass, force) => {
      if (pendingWave.size === 0) return;
      if (!force && pendingWave.size < batchSize) return;
      const wave = {};
      for (const [n, r] of pendingWave) wave[n] = r;
      pendingWave.clear();
      const batchT0 = Date.now();
      // v9.7.0：每波落盘（原每 5 批）——SW 被杀时损失限单波
      await flushAllCaches();
      push({ ratings: wave, ...progressPayload() });
      job.queue = passNames.filter((n) => !completedInPass.has(n));
      job.retried = retried;
      await persistJob(job);
      metricObserve('batch.ms', Date.now() - batchT0);
      // 限流降速：异常时收缩波次阈值，恢复后回基础批大小
      batchSize = getSteamApiStatus().anomaly ? PERF_CONFIG.ratingsBatchSizeAnomaly : baseBatch;
    };

    const runPool = async (passNames) => {
      if (passNames.length === 0) return;
      const completedInPass = new Set();
      let cursor = 0;
      // 异常降速：所有 worker 共享同一暂停窗口 / Shared anomaly pause gate.
      const maybePause = async () => {
        if (getSteamApiStatus().anomaly) {
          if (!anomalyGate) {
            consecutiveAnomaly++;
            const wait = consecutiveAnomaly >= 2 ? PERF_CONFIG.anomalyConsecutivePauseMs : PERF_CONFIG.anomalyWaitMs;
            /** @type {(v?: void) => void} */
            let resolveGate = () => {};
            const gate = {
              done: false,
              promise: new Promise((res) => {
                resolveGate = res;
              })
            };
            setTimeout(() => {
              gate.done = true;
              resolveGate();
            }, wait);
            anomalyGate = gate;
          }
          const gate = anomalyGate;
          if (gate) await gate.promise;
        } else {
          consecutiveAnomaly = 0;
          anomalyGate = null;
        }
      };
      const worker = async () => {
        while (cursor < passNames.length) {
          const name = passNames[cursor++];
          await maybePause();
          /** @type {any} */
          let r = null;
          try {
            const urlAppId = job.urlAppIds && job.urlAppIds[name] ? job.urlAppIds[name] : null;
            const img =
              (job.imageData && job.imageData[name]) ||
              (job.appIds && job.appIds[name] ? { appId: job.appIds[name] } : null);
            r = await getSteamPositiveRate(name, {
              ignoreNegativeCache: true,
              appId: urlAppId || (img ? img.appId : null),
              cover: img ? img.cover : null
            });
          } catch {
            r = null;
          }
          completedInPass.add(name);
          doneCount++;
          pendingWave.set(name, r ? mergeAppStat(r, statsMap) : null);
          // 网络失败/限流（null 或 failed 标记）→ 进入重试队列
          if (!r || r.failed) retryNames.push(name);
          metricInc('batch.items', 1);
          await flushWave(passNames, completedInPass, false);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, passNames.length) }, worker));
      await flushWave(passNames, completedInPass, true);
    };

    await runPool(allNames);
    // 一轮结束后重试失败的条目（最多一轮，防无限循环）
    if (retryNames.length > 0 && !retried) {
      retried = true;
      await runPool(retryNames);
    }
    // 全部完成：done 标记（内容脚本据此收尾并显示统计）+ 清任务
    job.queue = [];
    await clearPersistedJob();
    teardownResumeAlarm();
    push({ ratings: null, done: true, ...progressPayload() });
  } catch (e) {
    Logger.warn('Steam', '后台补拉好评率失败', String(e));
  } finally {
    clearInterval(keepAlive);
  }
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
        const cached = await getSteamCacheEntry(appId, 'rating');
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

  // v9.7.0：预取改后台分离任务（与 GET_STEAM_RATINGS 阶段 2 一致）——此前
  // 整个循环在消息处理内 await，sendResponse 通道被占住数分钟，SW 中途被杀
  // 时内容脚本收到 port closed 拒绝。预取本就不返回数据，立即响应无行为损失
  (async () => {
    // 预载同样批内保活，防 SW 休眠中断（见 handleGetSteamRatings 说明）
    // Keep-alive during prefetch batches too (see handleGetSteamRatings)
    const keepAlive = setInterval(() => {
      chrome.runtime.getPlatformInfo().catch(() => {});
    }, PERF_CONFIG.ratingsKeepAliveIntervalMs);
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
          // v14.6.2：修漂移——原字面量 3000 与注释"同主流程"不符（主流程
          // anomalyWaitMs=5000）；统一走 PERF_CONFIG 单源
          await new Promise((r) => setTimeout(r, PERF_CONFIG.anomalyWaitMs));
        }
        // v9.7.0：每批落盘（同主流程——SW 长循环被杀时损失限单批）
        await flushAllCaches();
      }
    } catch (e) {
      Logger.warn('Steam', '预取好评率失败', String(e));
    } finally {
      clearInterval(keepAlive);
      await flushAllCaches().catch(() => {});
    }
  })();
  return { success: true, background: true };
}
