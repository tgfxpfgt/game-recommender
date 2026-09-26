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
  await addBehaviorLog(message.data);

  if (message.data.type === 'click_download') {
    // v10.1.0：下载计数 a（AppID 维度，跨站点聚合）——内容侧在详情页解析出
    // appId 后经 DOM 数据桥接（documentElement.dataset.grAppId）随事件带上；
    // 无 appId（列表页点击等场景）不计入（无法关联）
    // v10.2.0：站点去重键（同站 24h 内重复下载不重复计数；未识别站点用
    // domain 本身，各自独立去重）
    if (message.data.appId) {
      const inferred = inferSiteFromDomain(message.data.domain || '');
      const siteKey = inferred.key !== 'unknown' ? inferred.key : String(message.data.domain || 'unknown').slice(0, 64);
      await recordAppDownload(String(message.data.appId), siteKey);
    }
    await updateGameProfile({
      name: message.data.gameName,
      event: 'download',
      keywords: message.data.keywords
    });
    await recordDownloadHistory(message.data);
    Logger.info('Download', `下载"${message.data.gameName}"`, {
      method: message.data.method,
      domain: message.data.domain
    });
  }
  if (message.data.type === 'view_detail') {
    await updateGameProfile({
      name: message.data.gameName,
      event: 'view',
      keywords: message.data.keywords
    });
  }
  // Steam标签回写
  // v6.3.2 C3：不感兴趣标记（推荐反馈循环负信号）
  if (message.data.type === 'dislike_game') {
    await updateGameProfile({ name: message.data.gameName, event: 'dislike', keywords: message.data.keywords });
  }
  if (message.data.type === 'steam_tags_update') {
    await updateGameProfile({
      name: message.data.gameName,
      event: 'view',
      keywords: message.data.keywords,
      steamAppId: message.data.steamAppId,
      steamRating: message.data.steamRating
    });
  }
  // 节流更新偏好模型；下载事件强制刷新（更具信号价值）
  await maybeUpdatePreferences(message.data.type === 'click_download');
  return { success: true };
}
