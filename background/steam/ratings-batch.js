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
 *
 * @invariant 全局 FIFO 单任务链：任一时刻至多一个评分任务在跑，新任务只入队不并行（并行会让限速窗口失败率翻倍）
 * @invariant STEAM_RATINGS_UPDATE 必须按任务创建时的 tabId 定向推送；tab 无接收端（关闭/导航）任务在开跑时即跳过
 * @invariant 单条目硬阈值放弃后结果仍可能迟到——缓存写入必须幂等（按 appId 覆盖），任务收尾以 done 标记为唯一终态
 */
import { getSteamPositiveRate, getSteamRatingsFromCacheOnly } from './orchestrator.js';
import { hasInvertedReviewCounts } from './api.js'; // v14.21.0：评价数倒挂污染指纹（预载重取自愈）
import { PERF_CONFIG } from '../core/constants.js';
import { getSettings } from '../core/settings.js'; // v14.5.0 B9：用户批大小接线
import { flushAllCaches } from '../storage/flush.js';
import { getSteamCacheEntry, isModuleValid, getModuleData, waitForSteamCacheWarmup } from '../storage/steam-cache.js';
import { getAppIdByUrl } from '../storage/url-index.js'; // v7.0.2：详情页网址第一候选
import { lookupAppIdByName } from '../storage/name-index.js';
import { Logger } from '../storage/logger.js';
import { getSteamApiStatus } from '../core/api-monitor.js';
import { metricInc, metricObserve } from '../core/metrics.js'; // v10.7.0：运行指标
import { withWatchdog } from '../core/mechanisms.js'; // v14.28.6 R4-A：单条目两级看门狗
import { getAppStats } from '../storage/app-stats.js'; // v10.1.0：a-b 徽章数据并入 ratings
import { recordTrace, gameKeyOf } from '../storage/diag-trace.js'; // v14.28.9：运行期诊断轨迹

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
  // v14.19.0：分类页平台提示（首波预检与任务创建共用——声明须在首波之前）
  const platformHint = typeof message.platformHint === 'string' ? message.platformHint.trim().slice(0, 24) : '';
  const ratings = {};
  const pending = [];

  // v14.7 批次 8：首波预热竞态修复——SW 启动预热（steam 缓存装载）在途时
  // 首波读缓存必然空转等二波；等待"预热完成或 800ms 超时"后再查。已预热时
  // 零开销。Warmup gate: the first cache-only wave waits for warmup (capped).
  await waitForSteamCacheWarmup(PERF_CONFIG.steamWarmupWaitMs).catch(() => {});

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
            cover: img ? img.cover : null,
            // v14.19.0：首波平台预检（提示词/映射——错误 Steam 缓存不再先于识别返回）
            platformHint: platformHint
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
      urls, // v14.8.2：name → 站点详情页 URL（盲区自愈详情页信号回捞）
      probeBudget: { left: PERF_CONFIG.detailProbeBudget }, // v14.8.2：回捞预算（仅实际探测扣减）
      mcBudget: { left: PERF_CONFIG.metacriticBudget }, // v14.10.0：Metacritic 查询预算（主机条目）
      platformHint, // v14.18.0：分类页平台提示（空串 = 无提示）
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

// v14.29.0（多下载站同时打开排队丢失根因）：检查点从"单槽只存运行任务"升级为
// **整条队列信封** {v:2, jobs:[运行中, ...排队...]}——此前排队任务只存在于内存
// jobQueue.pending，SW 被杀（Chrome 110+ 保活失效后）全部蒸发，对应 tab 只能
// 等 45s 强制收尾转"未返回"。activeJob 模块级引用供信封捕获运行中任务。
// Checkpoint upgraded from a single running-job slot to a full-queue envelope:
// previously pending jobs lived only in memory and evaporated with the SW.
/** @type {any|null} */
let activeJob = null;

/** 信封写入：运行中任务 + 全部排队任务（空队列 → 删除键）/ write the envelope */
async function persistQueueState() {
  const jobs = [];
  if (activeJob) jobs.push(activeJob);
  for (const j of jobQueue.pending) jobs.push(j);
  try {
    if (jobs.length === 0) await chrome.storage.session.remove(JOB_SESSION_KEY);
    else await chrome.storage.session.set({ [JOB_SESSION_KEY]: { v: 2, jobs } });
  } catch {
    /* session 不可用（极旧 Chrome）→ 退化为不可恢复模式 */
  }
}

// 清运行任务（任务收尾/死 tab 中止调用）——排队任务保留在信封中
async function clearPersistedJob() {
  activeJob = null;
  await persistQueueState();
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
// v14.8 批次 14（用户报告：多标签页同时打开时检测停在"待检测"）：跨 tab
// 并发使限速窗口内失败率翻倍（两任务并行 = anomaly 级联 → 各自 30s 暂停
// 循环 → 内容侧 45s 强制收尾时徽章停在"待检测"）。改**全局单任务链**：
// 所有 tab 的任务进同一条 FIFO 串行消化（各自推送回自己的 tabId 不变）；
// 后开标签的首波缓存命中仍即时返回（阶段 1 在任务外），只有未命中名等队。
// Global single-flight job chain since v14.8 (multi-tab parallel jobs doubled
// the failure rate inside the rate-limit window → anomaly cascade → stuck
// badges); phase-1 cache hits still return instantly for later tabs.
/** @type {{running: boolean, pending: Array<Object>}} */
const jobQueue = { running: false, pending: [] };

// v14.8.1（用户反馈：等待检测徽章看不到进展）：全局链运行态快照——当前任务
// {tabId,total,done} 供 GET_RATINGS_QUEUE_STATUS 查询与等待徽章实时队列信息。
// total 取任务起始长度（job.queue 会被批次边界收缩，不可作分母）。
// Global-chain run snapshot since v14.8.1: the waiting badges show live queue
// info ("检索中 N/M · 排队 X") from pushes + GET_RATINGS_QUEUE_STATUS polling.
/** @type {{tabId: number|null, total: number, done: number, phase?: string, stalled?: {name: string, phase: string, elapsedMs: number}|null}|null} */
let currentRun = null;

// v14.8.1：模块级推送器（runRatingJob 内的 push 与入队/开跑即时进度共用）
// v14.17.0：返回推送是否成功——tab 已关闭/导航中（无接收端）时调用方据此
// 中止该任务，不再为死 tab 白跑数分钟（多标签页全局链下后开 tab 全部陪等）。
/**
 * @param {number|null|undefined} tabId
 * @param {{progress?: {done: number, total: number, degraded: boolean, queued?: number, position?: number}, ratings?: Record<string, any>|null, done?: boolean}} payload
 * @returns {Promise<boolean>}
 */
async function pushToTab(tabId, payload) {
  if (tabId === null || tabId === undefined) return false;
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'STEAM_RATINGS_UPDATE', ...payload });
    return true;
  } catch {
    return false; // 无接收端（tab 关闭/页面导航中）
  }
}

// v14.8.1：全局评分队列状态快照（等待徽章"当前队列信息"的数据源）
// v14.29.0：可选 senderTabId → 附 `you`（本页视角：排队位置/前方条目/本页
// 条目数）——此前快照只有全局任务数，等待徽章无法表达"本页排第几位、还有
// 多少项在自己前面"。position = 前方任务数（0 = 下一个就轮到/正在跑），
// running 标记本页任务是否正在运行；aheadItems 含运行中任务的剩余条目。
// Queue status snapshot; with senderTabId it carries `you` — this tab's live
// queue position, items ahead and own total (the old snapshot had no per-tab
// view at all).
export function getRatingsQueueStatus(senderTabId) {
  /** @type {{running: boolean, pending: number, current: any, degraded: boolean, you?: {position: number, running: boolean, total: number, aheadItems: number}}} */
  const status = {
    running: jobQueue.running,
    pending: jobQueue.pending.length,
    current: currentRun ? { ...currentRun } : null,
    degraded: getSteamApiStatus().anomaly
  };
  if (senderTabId !== null && senderTabId !== undefined) {
    const idx = jobQueue.pending.findIndex((j) => j && j.tabId === senderTabId);
    if (idx !== -1) {
      const job = jobQueue.pending[idx];
      const aheadJobs = jobQueue.pending.slice(0, idx);
      const aheadItems =
        aheadJobs.reduce((n, j) => n + (Array.isArray(j.queue) ? j.queue.length : 0), 0) +
        (currentRun ? Math.max(0, (currentRun.total || 0) - (currentRun.done || 0)) : 0);
      status.you = {
        position: idx, // 前方任务数（0 = 自己是下一个）
        running: false,
        total: Array.isArray(job.queue) ? job.queue.length : 0,
        aheadItems
      };
    } else if (currentRun && currentRun.tabId === senderTabId) {
      status.you = { position: 0, running: true, total: currentRun.total, aheadItems: 0 };
    }
  }
  return status;
}

function runNextGlobal() {
  const job = jobQueue.pending.shift();
  if (!job) {
    jobQueue.running = false;
    return;
  }
  jobQueue.running = true;
  activeJob = job; // v14.29.0：信封捕获运行中任务（flush/收尾按整队持久化）
  // v14.8.1：任务开跑即时推送（此前首个波次可能数分钟后——限流降速期间
  // 等待徽章一直静态"等待检索"，用户无从判断卡在哪）
  const totalAtStart = Array.isArray(job.queue) ? job.queue.length : 0;
  currentRun = { tabId: job.tabId ?? null, total: totalAtStart, done: 0 };
  // v14.29.0：出队后其余排队任务位置前移——即时推送新位置（等待徽章不再
  // 依赖 5s 轮询才知道自己前进了）
  pushQueuePositions();
  // v14.17.0：任务硬截止预置（续跑任务继承原值——"总时长有界"语义不随 SW
  // 重启重置）；测试可预置过去时刻注入截止路径
  if (!job.deadlineAt) job.deadlineAt = Date.now() + PERF_CONFIG.ratingsJobMaxRuntimeMs;
  (async () => {
    try {
      // v14.17.0：开跑推送移入任务体并检测死 tab——tab 已关闭/无接收端时直接
      // 跳过该任务（此前整只任务照跑数分钟，后开 tab 在全局链上全部陪等）
      const started = await pushToTab(job.tabId, {
        progress: {
          done: 0,
          total: totalAtStart,
          degraded: getSteamApiStatus().anomaly,
          queued: jobQueue.pending.length,
          position: 0
        }
      });
      if (!started) {
        Logger.info('Steam', `评分任务跳过（tab 无接收端，疑似已关闭/导航中）: tab=${job.tabId}`);
        job.queue = [];
        await clearPersistedJob();
        if (jobQueue.pending.length === 0) teardownResumeAlarm();
        return;
      }
      // v14.8.1：任务生命周期日志（E2E/线上排查"停在待检测"的关键观测点）
      Logger.info('Steam', `评分任务开始: ${job.queue ? job.queue.length : '?'} 项 → tab=${job.tabId}`);
      await persistQueueState();
      setupResumeAlarm();
      await runRatingJob(job);
    } catch (e) {
      // v14.17.0：链路异常兜底——任务体自吞异常，此为最后防线；必须给内容侧
      // done 终态（否则该 tab 等 45s 强制收尾，徽章停留"排队"视觉）
      Logger.warn('Steam', '评分任务链路异常', String(e));
      pushToTab(job.tabId, { ratings: null, done: true });
    } finally {
      Logger.info('Steam', `评分任务结束: tab=${job.tabId}`);
      currentRun = null;
      activeJob = null; // v14.29.0：信封随任务生命周期复位
      jobQueue.running = false;
      runNextGlobal();
    }
  })();
}

// v14.29.0：排队位置广播——向所有排队任务推送实时位置（位置推送失败的 tab
// 就地出队：死 tab 任务不占全局链位，后开 tab 等待直接缩短）
function pushQueuePositions() {
  jobQueue.pending.forEach((j, i) => {
    pushToTab(j.tabId, {
      progress: {
        done: 0,
        total: Array.isArray(j.queue) ? j.queue.length : 0,
        degraded: getSteamApiStatus().anomaly,
        queued: jobQueue.pending.length,
        position: i
      }
    }).then((ok) => {
      if (ok) return;
      const idx = jobQueue.pending.indexOf(j);
      if (idx !== -1) jobQueue.pending.splice(idx, 1);
      Logger.info('Steam', `排队任务剔除（tab 无接收端）: tab=${j.tabId}`);
      persistQueueState().catch(() => {});
    });
  });
}

// 发起任务（fire-and-forget；全局 FIFO 串行，永不丢弃）
// start a job (fire-and-forget; single global FIFO chain, never dropped)
// v14.8.1：链忙时即时推送排队位置（"排队中·前方 N 项"），不再静默等首波
// v14.29.0：同 tab 旧任务替换——页面刷新/翻页后旧任务的页面上下文已失效，
// 保留它会让旧推送与新批次交错且多占一个队列位；最新入队者顶替同 tab 旧任务。
export function startRatingJob(job) {
  if (job.tabId !== null && job.tabId !== undefined) {
    const dupIdx = jobQueue.pending.findIndex((j) => j && j.tabId === job.tabId);
    if (dupIdx !== -1) {
      Logger.info('Steam', `排队任务替换（同 tab 旧任务过时）: tab=${job.tabId}`);
      jobQueue.pending[dupIdx] = job;
      pushQueuePositions();
      persistQueueState().catch(() => {});
      return true;
    }
  }
  jobQueue.pending.push(job);
  if (jobQueue.running) {
    // v14.29.0：入队即整队持久化（排队任务不再只存在于内存）+ 全体位置广播
    persistQueueState().catch(() => {});
    pushQueuePositions();
  } else {
    runNextGlobal();
  }
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
  /** @type {any|null} */
  let envelope = null;
  try {
    const data = await chrome.storage.session.get(JOB_SESSION_KEY);
    envelope = (data && data[JOB_SESSION_KEY]) || null;
  } catch {
    return { resumed: false, reason: 'no-session' };
  }
  // v14.29.0：信封形态 {v:2, jobs:[...]}；兼容 v14 旧单槽形态（单任务对象）。
  // Envelope form since v14.29.0; the legacy single-job object is still accepted.
  /** @type {Array<any>} */
  let jobs = [];
  if (envelope && Array.isArray(envelope.jobs)) jobs = envelope.jobs.filter((j) => j && Array.isArray(j.queue));
  else if (envelope && Array.isArray(envelope.queue)) jobs = [envelope];
  if (jobs.length === 0) return { resumed: false, reason: 'no-job' };
  // 陈旧过滤：超龄任务丢弃；全部超龄 → stale（同步拆除 1min resume alarm，
  // 防 SW 之后无限每分钟唤醒——v14.11 B8）
  const now = Date.now();
  jobs = jobs.filter((j) => j.startedAt && now - j.startedAt <= JOB_MAX_AGE_MS);
  if (jobs.length === 0) {
    await clearPersistedJob();
    if (jobQueue.pending.length === 0) teardownResumeAlarm();
    return { resumed: false, reason: 'stale' };
  }
  // v14.6.2 修复（审查 A4）：经 startRatingJob 重新入队串行消化（保持全局
  // FIFO 次序：运行中任务在前，排队任务按原顺序跟随）。入队即返回（队列
  // fire-and-forget 串行消化；持久化由队列首步负责）。
  for (const j of jobs) startRatingJob(j);
  return { resumed: true, remaining: jobs.reduce((n, j) => n + (j.queue ? j.queue.length : 0), 0) };
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
  // v14.17.0：任务硬截止（runNextGlobal 预置，续跑继承）+ 异常降速暂停总额 +
  // 死 tab 标记——三者共同保证"全局单任务链"的单任务时长有界（多标签页排队
  // 等待有界），并有界自愈（丢项刷新重查 / 死 tab 直接让位）。
  const deadlineAt = job.deadlineAt || Date.now() + PERF_CONFIG.ratingsJobMaxRuntimeMs;
  job.deadlineAt = deadlineAt;
  let totalPauseMs = 0;
  let tabDead = false;
  // v14.28.9：任务级轨迹（enter/exit/stall/push/fail + 波次 counts）
  const traceStartedAt = Date.now();
  let traceTotal = 0;
  let traceDone = 0;
  let failedCount = 0;
  let waveSeq = 0;
  // v14.28.6 R4-A：任务心跳定时器（finally 统一清理，防 try 内声明后被 finally 丢失）
  /** @type {ReturnType<typeof setInterval>|null} */
  let heartbeatTimer = null;
  // v14.28.8：停滞边沿推送定时器（单次 setTimeout，非轮询；finally 清理）
  /** @type {ReturnType<typeof setTimeout>|null} */
  let stallTimer = null;
  try {
    // v14.17.0：推送改感知成功——失败置 tabDead（无接收端 = tab 关闭/导航中）
    const push = async (payload) => {
      const ok = await pushToTab(job.tabId, payload);
      if (!ok) tabDead = true;
      return ok;
    };
    // v6.4.15：并发自适应（恢复时重算——限流状态可能已变化）
    // v14.5.0 B9：用户设置接线——settings.ratingsBatchSize（v10.7.0 起设置键
    // 收集但从未被消费，UI 配置静默失效）作为基础批大小；API 异常降速仍走
    // PERF_CONFIG（自适应优先于用户偏好）；设置不可达回退 PERF_CONFIG
    let baseBatch = PERF_CONFIG.ratingsBatchSize;
    // v14.28.6 R4-A：看门狗两级阈值（设置可覆盖，0/未设 = PERF_CONFIG 默认）——
    // 用户裁决：阈值不是结论而是可调参数，默认偏宽松
    let itemSoftMs = PERF_CONFIG.ratingsItemSoftWarnMs;
    let itemHardMs = PERF_CONFIG.ratingsItemHardTimeoutMs;
    try {
      const settings = await getSettings();
      if (settings && settings.ratingsBatchSize) baseBatch = settings.ratingsBatchSize;
      if (settings && Number(settings.ratingsItemSoftWarnMs) > 0) itemSoftMs = Number(settings.ratingsItemSoftWarnMs);
      if (settings && Number(settings.ratingsItemHardTimeoutMs) > 0)
        itemHardMs = Number(settings.ratingsItemHardTimeoutMs);
    } catch {
      /* 设置不可达回退 PERF_CONFIG */
    }
    // 软阈值必须严格小于硬阈值（误配成"软即硬"会让软阈值失去留证意义）
    if (itemHardMs > 0 && itemSoftMs >= itemHardMs) itemSoftMs = Math.floor(itemHardMs / 2);
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
    traceTotal = totalNames;
    recordTrace({
      stage: 'ratings',
      event: 'enter',
      wave: 0,
      counts: { total: totalNames, done: 0, failed: 0 }
    });
    let doneCount = 0;
    let consecutiveAnomaly = 0;
    /** @type {Map<string, any>} */
    const pendingWave = new Map(); // 未推送结果（≥ batchSize 或收尾时成波推送）
    const retryNames = []; // 网络失败/限流（null 或 failed 标记）
    /** @type {{done: boolean, promise: Promise<void>}|null} */
    let anomalyGate = null; // 共享暂停门（所有 worker 等同一窗口，防 N 个独立定时器）
    // v14.28.6 R4-A：在途条目表（真实起点 + 当前阶段）——软阈值告警与状态栏
    // "卡在哪一步、已等多久"的证据来源；key = 游戏名
    /** @type {Map<string, {startedAt: number, phase: string}>} */
    const inFlight = new Map();
    /** @type {string} */
    let lastPhase = '';
    // 任务级心跳（15s 一次，日志留证"任务还活着 + 卡在哪个阶段"）
    heartbeatTimer = setInterval(() => {
      if (tabDead) return;
      Logger.info(
        'Steam',
        `评分任务心跳: ${Math.min(doneCount, totalNames)}/${totalNames} 阶段=${lastPhase || '-'} 在途=${inFlight.size}`
      );
    }, PERF_CONFIG.ratingsHeartbeatMs);

    // 最慢在途条目超过软阈值 → 状态栏 stalled 证据（长度 0 或 1，避免推送膨胀）
    const stalledInfo = () => {
      if (inFlight.size === 0) return null;
      const now = Date.now();
      /** @type {{name: string, phase: string, elapsedMs: number}|null} */
      let worst = null;
      for (const [n, v] of inFlight) {
        const elapsedMs = now - v.startedAt;
        if (!worst || elapsedMs > worst.elapsedMs) worst = { name: n, phase: v.phase, elapsedMs };
      }
      return worst && worst.elapsedMs >= itemSoftMs ? worst : null;
    };

    // v14.7 批次 5：条目级进度（重试轮不重复计数，done 钳到 total）
    // v14.8.1：progress 增 queued（全局链排队任务数）+ 同步 currentRun.done
    const progressPayload = () => {
      const doneNow = Math.min(doneCount, totalNames);
      const stalled = stalledInfo();
      if (currentRun) {
        currentRun.done = doneNow;
        currentRun.phase = lastPhase;
        currentRun.stalled = stalled;
      }
      return {
        progress: {
          done: doneNow,
          total: totalNames,
          degraded: getSteamApiStatus().anomaly,
          queued: jobQueue.pending.length,
          // v14.28.6 R4-A：当前阶段 + 超软阈值的在途条目（无则 null）
          phase: lastPhase,
          stalled
        }
      };
    };

    // v14.28.8：停滞期**边沿**推送——进度此前只挂载在成波推送（flushWave）上，
    // 停滞时 pendingWave 不满 → 一次推送都不发；20s 软阈值只落日志，用户看到的
    // UI 从 0.4s 到 40s 完全静止（实测 40.3s 才见"限流降速"）。
    // 做法：单次 setTimeout 精确排在"最早在途条目越过软阈值"的时刻（+20ms），
    // 仅在停滞签名（条目|阶段|5s 桶）变化时推送一次，之后每 5s 桶续一次；
    // 不引入高频轮询（条目完成由 flushWave 正常推送）。
    // Edge-triggered stall push: a single timeout fires when the earliest
    // in-flight item crosses the soft threshold; pushes only when the stall
    // signature (item|phase|5s bucket) changes. No polling loop.
    const STALL_BUCKET_MS = 5000;
    /** @type {string} */
    let lastStallKey = '';
    const scheduleStallCheck = () => {
      if (tabDead || stallTimer) return;
      if (inFlight.size === 0) return;
      const now = Date.now();
      let earliest = Infinity;
      for (const v of inFlight.values()) earliest = Math.min(earliest, v.startedAt + itemSoftMs);
      // 尚未越过软阈值 → 精确排到该时刻；已越过（重排/多条目）→ 下一个 5s 桶
      const delay = earliest > now ? earliest - now + 20 : STALL_BUCKET_MS;
      stallTimer = setTimeout(
        async () => {
          stallTimer = null;
          if (tabDead) return;
          const info = stalledInfo();
          if (!info) {
            lastStallKey = ''; // 停滞解除：下一条目开始时重新排程
            return;
          }
          const key = `${info.name}|${info.phase}|${Math.floor(info.elapsedMs / STALL_BUCKET_MS)}`;
          if (key !== lastStallKey) {
            lastStallKey = key;
            // v14.28.9：停滞边沿进入轨迹（durMs = 最慢在途条目已等待时长）
            recordTrace({
              stage: 'ratings',
              event: 'stall',
              durMs: info.elapsedMs,
              gameKey: gameKeyOf(info.name),
              wave: waveSeq,
              counts: { total: traceTotal, done: Math.min(traceDone, traceTotal), failed: failedCount }
            });
            await push({ ratings: null, ...progressPayload() });
          }
          scheduleStallCheck();
        },
        Math.max(20, delay)
      );
    };

    // 成波推送 + 检查点（SW 被杀后从当前 pass 未完成处续跑——比旧实现多覆盖
    // 在途项，耐久性更好）/ Flush a wave + checkpoint (also covers in-flight).
    /** @param {string[]} passNames @param {Set<string>} completedInPass @param {boolean} force */
    const flushWave = async (passNames, completedInPass, force) => {
      if (pendingWave.size === 0 || tabDead) return;
      if (!force && pendingWave.size < batchSize) return;
      const wave = {};
      for (const [n, r] of pendingWave) wave[n] = r;
      pendingWave.clear();
      const batchT0 = Date.now();
      // v9.7.0：每波落盘（原每 5 批）——SW 被杀时损失限单波
      await flushAllCaches();
      // v14.17.0：推送感知成功（死 tab → tabDead → worker 循环与后续波次中止）
      await push({ ratings: wave, ...progressPayload() });
      waveSeq++;
      recordTrace({
        stage: 'ratings',
        event: 'push',
        wave: waveSeq,
        durMs: Date.now() - batchT0,
        counts: { total: traceTotal, done: Math.min(traceDone, traceTotal), failed: failedCount }
      });
      // v14.8.1：波次推送日志（排查推送丢失——tab 关闭时 sendMessage 静默失败）
      Logger.info('Steam', `评分波次推送: ${Object.keys(wave).length} 项 → tab=${job.tabId}`);
      job.queue = passNames.filter((n) => !completedInPass.has(n));
      job.retried = retried;
      await persistQueueState(); // v14.29.0：整队信封（含排队任务）替代单槽检查点
      metricObserve('batch.ms', Date.now() - batchT0);
      // 限流降速：异常时收缩波次阈值，恢复后回基础批大小
      batchSize = getSteamApiStatus().anomaly ? PERF_CONFIG.ratingsBatchSizeAnomaly : baseBatch;
    };

    /** @param {string[]} passNames @param {{concurrency?: number}} [poolOpts] */
    const runPool = async (passNames, poolOpts = {}) => {
      if (passNames.length === 0) return;
      const completedInPass = new Set();
      let cursor = 0;
      // 异常降速：所有 worker 共享同一暂停窗口 / Shared anomaly pause gate.
      const maybePause = async () => {
        if (getSteamApiStatus().anomaly) {
          // v14.17.0：暂停总额预算——耗尽后不再暂停（裸跑剩余项，防 30s×N 波次
          // 级联把单任务拖到 15 分钟级）；本次暂停也不得跨越任务硬截止
          if (totalPauseMs >= PERF_CONFIG.anomalyPauseTotalCapMs) return;
          const wait = consecutiveAnomaly >= 2 ? PERF_CONFIG.anomalyConsecutivePauseMs : PERF_CONFIG.anomalyWaitMs;
          if (Date.now() + wait >= deadlineAt) return;
          if (!anomalyGate) {
            consecutiveAnomaly++;
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
          if (gate) {
            const pauseT0 = Date.now();
            await gate.promise;
            totalPauseMs += Date.now() - pauseT0;
          }
        } else {
          consecutiveAnomaly = 0;
          anomalyGate = null;
        }
      };
      const worker = async () => {
        // v14.17.0：worker 循环三重守卫——队列空 / 死 tab / 任务硬截止
        while (cursor < passNames.length && !tabDead && Date.now() < deadlineAt) {
          const name = passNames[cursor++];
          await maybePause();
          /** @type {any} */
          let r = null;
          let watchdogHit = false;
          let fetchError = false;
          const itemMeta = { startedAt: Date.now(), phase: 'start' };
          inFlight.set(name, itemMeta);
          scheduleStallCheck(); // v14.28.8：排到该条目越过软阈值的时刻
          try {
            const urlAppId = job.urlAppIds && job.urlAppIds[name] ? job.urlAppIds[name] : null;
            const img =
              (job.imageData && job.imageData[name]) ||
              (job.appIds && job.appIds[name] ? { appId: job.appIds[name] } : null);
            // v14.28.6 R4-A：两级看门狗——软阈值只告警留证（记录条目/阶段/耗时），
            // 硬阈值才放弃该条目并继续队列（用户裁决：误杀 > 晚发现）
            r = await withWatchdog(
              () =>
                getSteamPositiveRate(name, {
                  ignoreNegativeCache: true,
                  appId: urlAppId || (img ? img.appId : null),
                  cover: img ? img.cover : null,
                  // v14.8.2：盲区自愈——miss 时按任务预算回捞站点详情页 appid 信号
                  pageUrl: job.urls && job.urls[name] ? job.urls[name] : null,
                  probeBudget: job.probeBudget || null,
                  // v14.10.0：主机条目 Metacritic 查询预算
                  mcBudget: job.mcBudget || null,
                  // v14.18.0：分类页平台提示（规则 listPlatformHints，空串 = 无）
                  platformHint: job.platformHint || '',
                  // v14.28.6 R4-A：阶段回调（告警留证 / 状态栏 stalled 用）
                  onPhase: (/** @type {string} */ phase) => {
                    itemMeta.phase = phase;
                    lastPhase = phase;
                  }
                }),
              {
                label: name,
                softMs: itemSoftMs,
                hardMs: itemHardMs,
                onSoftWarn: (info) => {
                  metricInc('batch.itemSlow', 1);
                  Logger.warn(
                    'Steam',
                    `评分条目慢（不放弃）: ${name} 阶段=${itemMeta.phase} 已 ${info.elapsedMs}ms（软阈值 ${info.thresholdMs}ms）`
                  );
                },
                onTimeout: (info) => {
                  metricInc('batch.itemTimeout', 1);
                  Logger.warn(
                    'Steam',
                    `评分条目超硬阈值已放弃: ${name} 阶段=${itemMeta.phase} 已 ${info.elapsedMs}ms（硬阈值 ${info.thresholdMs}ms）`
                  );
                }
              }
            );
            // 硬阈值放弃：让出队列继续下一条（结果迟到由缓存幂等写入承接）
            if (r && r.__watchdogTimeout) {
              r = null;
              watchdogHit = true;
            }
          } catch {
            r = null;
            fetchError = true;
          } finally {
            inFlight.delete(name);
          }
          completedInPass.add(name);
          doneCount++;
          traceDone++;
          // v14.28.9：单条失败入轨迹（failKind 由既有故障语义推导——超时/异常/
          // 显式 failed/确定性未找到），counts.failed 只计真实故障（notfound 不算）
          /** @type {string|null} */
          let failKind = null;
          if (watchdogHit) failKind = 'timeout';
          else if (fetchError) failKind = 'network';
          else if (r && r.failed) failKind = r.errorType || (getSteamApiStatus().anomaly ? 'ratelimit' : 'network');
          else if (!r) failKind = 'notfound';
          if (failKind) {
            if (failKind !== 'notfound') failedCount++;
            recordTrace({
              stage: 'ratings',
              event: 'fail',
              failKind,
              durMs: Date.now() - itemMeta.startedAt,
              gameKey: gameKeyOf(name),
              wave: waveSeq,
              counts: { total: traceTotal, done: Math.min(traceDone, traceTotal), failed: failedCount }
            });
          }
          pendingWave.set(name, r ? mergeAppStat(r, statsMap) : null);
          // v14.28.3：**只重试明确标记为失败的结果**（网络/限流/超时 →
          // orchestrator-list 置 failed:true）。此前 `!r` 也入重试队列，而
          // 全 miss 的确定性结果（phaseSearch 返回 null）同样 `!r` → 整批
          // 90 项被第二轮原样重打，批量链耗时直接翻倍（实测 90 项全 miss
          // 153s 中约一半来自这一轮）。确定性 miss 由内容侧"未找到·点击重查"
          // 徽章承接，不牺牲失败统计准确性。
          // Only explicitly-failed results are retried (network/ratelimit/timeout);
          // deterministic misses (null) no longer trigger a full second pass.
          // v14.28.8：noRetry（整窗网络故障且无 appId）不再自动重试——全站
          // 不可达时重试只是把同一超时再跑一遍；用户点击重查可随时再试。
          if (r && r.failed && !r.noRetry) retryNames.push(name);
          metricInc('batch.items', 1);
          await flushWave(passNames, completedInPass, false);
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(poolOpts.concurrency || concurrency, passNames.length) }, worker)
      );
      await flushWave(passNames, completedInPass, true);
    };

    await runPool(allNames);
    // 一轮结束后重试失败的条目（最多一轮，防无限循环）
    // v14.17.0：死 tab / 已过硬截止时跳过重试轮（丢项走刷新重查自愈，不再拖链）
    // v14.28.3：重试轮改为**限并发 + 先退避**——全失败的最慢路径此前以同样
    // 并发立刻硬打第二轮，在限流/网络故障期正好把限流队列再次打满。退避
    // 6000ms 让限流窗口与瞬时网络抖动先恢复；并发降到 1 让重试轮退化为
    // 串行游标，不再与其他标签页/新一轮任务抢 slot。两项合起来把"最慢路径"
    // 从 2×全量并发突刺压到 1×串行，且不改变失败统计口径。
    // Retry pass is now backoff-first and single-concurrency instead of an
    // immediate full-speed duplicate of round one.
    if (retryNames.length > 0 && !retried && !tabDead && Date.now() < deadlineAt) {
      retried = true;
      const retryWait = PERF_CONFIG.retryBackoffMs;
      if (Date.now() + retryWait < deadlineAt) {
        await new Promise((r) => setTimeout(r, retryWait));
        // v14.28.3：必须传快照副本——runPool 的 worker 以 `cursor < passNames.length`
        // 推进，而重试失败的条目会再次 push 进 retryNames；若直接传同一个数组
        // （passNames === retryNames），数组长度随 push 增长、游标永远追不上，
        // 重试轮变成**无界循环**（全 miss 批次实测：20 项 233s 未收尾、node 堆
        // 涨到 4GB OOM；真机表现为 SW 单线程被持续占满、其余消息饥饿）。
        // Pass a snapshot: runPool advances on cursor < passNames.length, and
        // failed retries push back into retryNames — aliasing the same array
        // makes the retry pass unbounded (observed: 233s/OOM on a 20-item run).
        await runPool(retryNames.slice(), { concurrency: PERF_CONFIG.retryConcurrency });
      }
    }
    // 全部完成：done 标记（内容脚本据此收尾并显示统计）+ 清任务
    job.queue = [];
    if (tabDead) {
      // v14.17.0：死 tab 中止——无接收端，done 推送无意义；清检查点与续跑
      // alarm（防 SW 下次唤醒空转续跑），finally 复位全局链衔接下一任务
      Logger.info('Steam', `评分任务中止（tab 无接收端）: tab=${job.tabId}`);
      await clearPersistedJob();
      if (jobQueue.pending.length === 0) teardownResumeAlarm(); // v14.29.0：仍有排队任务时保留 alarm
      return;
    }
    await clearPersistedJob();
    if (jobQueue.pending.length === 0) teardownResumeAlarm(); // v14.29.0：仍有排队任务时保留 alarm
    // v14.17.0：截止丢项也照常推 done——内容侧立即收尾并给出"未返回·点击重查"
    // 徽章（不再等到 45s 强制收尾，多标签页排队视觉即"卡住"的主因之一）
    push({ ratings: null, done: true, ...progressPayload() });
  } catch (e) {
    Logger.warn('Steam', '后台补拉好评率失败', String(e));
    // v14.17.0：任务体异常同样推 done 终态（tab 已死时推送自然失败即弃）
    pushToTab(job.tabId, { ratings: null, done: true });
  } finally {
    // v14.28.9：任务级 exit（正常/异常/死 tab 都关闭 ratings 阶段——只有真正
    // 未走完的任务才在轨迹里留下"有 enter 无 exit"）
    recordTrace({
      stage: 'ratings',
      event: 'exit',
      durMs: Date.now() - traceStartedAt,
      wave: waveSeq,
      counts: { total: traceTotal, done: Math.min(traceDone, traceTotal), failed: failedCount }
    });
    clearInterval(keepAlive);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (stallTimer) clearTimeout(stallTimer); // v14.28.8：任务收尾清停滞推送定时器
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
        // v14.21.0：评价数倒挂条目（旧回退误写）不跳过，预载重取自愈
        const rating = isModuleValid(cached, 'rating') ? getModuleData(cached, 'rating') : null;
        if (rating && rating.positiveRate !== undefined && !hasInvertedReviewCounts(rating)) continue;
        needsPrefetch.push(name);
      } else {
        needsPrefetch.push(name);
      }
    } catch {
      needsPrefetch.push(name);
    }
  }
  if (needsPrefetch.length === 0) return { success: true };

  // v14.18.0：分类页平台提示（同 handleGetSteamRatings——预载下一页是同
  // 分类页翻页，提示词同源继承）
  const prefetchHint = typeof message.platformHint === 'string' ? message.platformHint.trim().slice(0, 24) : '';

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
                cover: img ? img.cover : null,
                // v14.18.0：分类页平台提示（下一页预载与主流程同语义）
                platformHint: prefetchHint
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
