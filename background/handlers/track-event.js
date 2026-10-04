/**
 * 游戏雷达 Game Radar - 消息处理：行为追踪 / Behavior-Tracking Handlers
 *
 * v10.7.0 批次5：由 handlers.js 迁出（内联业务归位 handlers/ 子目录）——
 * 下载/详情/负反馈事件 → 行为日志 + a-b 统计 + 画像 + 历史 + 偏好模型节流。
 * Moved from handlers.js; event → log + app-stats + profile + history +
 * preference-throttle pipeline.
 */
import { addBehaviorLog, updateGameProfile, maybeUpdatePreferences } from '../storage/behavior.js';
import { recordAppDownload } from '../storage/app-stats.js';
import { inferSiteFromDomain, recordDownloadHistory } from '../storage/history.js';
import { Logger } from '../storage/logger.js';

export async function handleTrackEvent(message) {
  return applyTrackEvent(message.data);
}

// v14 B10：批量追踪（TRACK_EVENT_BATCH）——内容侧 v12 B3 攒批（500ms 窗口或
// 满 10 条一次性送达），此前无 handler 且契约默认拒绝，批量事件被整批丢弃；
// 逐条走与单发完全相同的管线，单条失败不丢整批
export async function handleTrackEventBatch(message) {
  const events = Array.isArray(message && message.events) ? message.events : [];
  let applied = 0;
  for (const data of events) {
    try {
      await applyTrackEvent(data);
      applied++;
    } catch (e) {
      Logger.warn('Track', `批量事件单条失败（跳过）: ${String(e)}`);
    }
  }
  return { success: true, applied };
}

// 单事件管线（单发与批量共用）/ one-event pipeline (shared by single & batch)
async function applyTrackEvent(data) {
  await addBehaviorLog(data);

  if (data.type === 'click_download') {
    // v10.1.0：下载计数 a（AppID 维度，跨站点聚合）——内容侧在详情页解析出
    // appId 后经 DOM 数据桥接（documentElement.dataset.grAppId）随事件带上；
    // 无 appId（列表页点击等场景）不计入（无法关联）
    // v10.2.0：站点去重键（同站 24h 内重复下载不重复计数；未识别站点用
    // domain 本身，各自独立去重）
    if (data.appId) {
      const inferred = inferSiteFromDomain(data.domain || '');
      const siteKey = inferred.key !== 'unknown' ? inferred.key : String(data.domain || 'unknown').slice(0, 64);
      await recordAppDownload(String(data.appId), siteKey);
    }
    await updateGameProfile({
      name: data.gameName,
      event: 'download',
      keywords: data.keywords
    });
    await recordDownloadHistory(data);
    Logger.info('Download', `下载"${data.gameName}"`, {
      method: data.method,
      domain: data.domain
    });
  }
  if (data.type === 'view_detail') {
    await updateGameProfile({
      name: data.gameName,
      event: 'view',
      keywords: data.keywords
    });
  }
  // Steam标签回写
  // v6.3.2 C3：不感兴趣标记（推荐反馈循环负信号）
  if (data.type === 'dislike_game') {
    await updateGameProfile({ name: data.gameName, event: 'dislike', keywords: data.keywords });
  }
  if (data.type === 'steam_tags_update') {
    await updateGameProfile({
      name: data.gameName,
      event: 'view',
      keywords: data.keywords,
      steamAppId: data.steamAppId,
      steamRating: data.steamRating
    });
  }
  // 节流更新偏好模型；下载事件强制刷新（更具信号价值）
  await maybeUpdatePreferences(data.type === 'click_download');
  return { success: true };
}

// v14 B10：领域 handler 段（action → handler 单处声明，handlers.js 聚合展开）
export const trackEventHandlers = {
  TRACK_EVENT: handleTrackEvent,
  TRACK_EVENT_BATCH: handleTrackEventBatch
};
