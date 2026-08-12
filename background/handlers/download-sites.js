import { getDownloadSites } from '../core/rules.js';
import { getSettings } from '../core/settings.js';
import { fetchWithTimeout } from '../core/utils.js';
import { searchDownloadSites, extractDetailMeta } from '../sites/search.js';
import { recordDownloadUrl, recordDownloadUrlsBatch, getDownloadUrls } from '../storage/download-urls.js';
import { getDownloadHistory, inferSiteFromDomain } from '../storage/history.js';
import { Logger } from '../storage/logger.js';
import { getGameRegistryEntry } from '../storage/registry.js';

/**
 * Game Recommender - 消息处理：下载站 / Download-Site Handlers
 *
 * v5.0.0：由 handlers.js 拆分——下载站搜索/历史/访问/批量记录。
 */

// --- 下载站搜索（Steam 页浮窗）---
export async function handleSearchDownloadSites(message) {
  const settings = await getSettings();
  const allSites = await getDownloadSites();
  const enabledKeys = settings.steamSiteSearch || allSites.map((s) => s.key);
  const sites = await searchDownloadSites(message.gameName, message.appId, enabledKeys);

  // 兜底 1：缓存优先。全部未命中且提供 appId 时，优先使用下载站网址缓存
  // （列表页/详情页访问时已记录 appId → 下载页地址）。解决英文官方名与中文站
  // 标题跨语言不匹配导致的漏检（如 Gothic 1 Remake → 哥特王朝 重制版）。
  // Fallback 1: the download-URL cache (recorded from list/detail visits) — it
  // bridges cross-language mismatches between EN official names and CN titles.
  if (sites.every((s) => !s.found) && message.appId) {
    const cached = await getDownloadUrls(message.appId);
    for (const s of sites) {
      const entry = cached[s.key];
      if (entry && entry.url) {
        s.found = true;
        s.detailUrl = entry.url;
        // 顺带刷新详情页元信息（失败不影响结果）
        try {
          const dResp = await fetchWithTimeout(entry.url, { headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' } });
          if (dResp.ok) {
            const meta = extractDetailMeta(await dResp.text(), s.key);
            Object.assign(s, {
              updateDate: meta.updateDate,
              version: meta.version,
              size: meta.size,
              panUrl: meta.panUrl,
              panCode: meta.panCode
            });
          }
        } catch {
          /* 元信息失败忽略 */
        }
      }
    }
    if (sites.some((s) => s.found)) {
      Logger.info('DownloadSites', `缓存命中: "${message.gameName}" (appId ${message.appId}) 下载站网址缓存直接返回`);
    }
  }

  // 兜底 2：全部未命中且提供了 appId 时，用注册表中的官方中英文名与
  // 下载站标题变体重新搜索（跨语言桥接）。
  // Fallback 2: retry with the registry's official CN/EN names AND download-site
  // title variants (cross-language bridge).
  if (sites.every((s) => !s.found) && message.appId) {
    const entry = await getGameRegistryEntry(message.appId);
    const officialNames = [
      ...new Set([entry && entry.cnName, entry && entry.enName, ...((entry && entry.names) || [])].filter(Boolean))
    ].filter((n) => n && n !== message.gameName);
    for (const name of officialNames) {
      const retry = await searchDownloadSites(name, message.appId, enabledKeys);
      retry.forEach((r) => {
        const target = sites.find((s) => s.key === r.key);
        if (r.found && target && !target.found) Object.assign(target, r);
      });
      if (sites.some((s) => s.found)) break;
    }
    if (sites.some((s) => s.found)) {
      Logger.info('DownloadSites', `兜底重试命中: "${message.gameName}" → 注册表名重搜`);
    }
  }

  Logger.info('DownloadSites', `搜索"${message.gameName}"`, { found: sites.filter((s) => s.found).map((s) => s.key) });
  return { sites };
}

// --- 下载历史 ---

// --- 下载历史 ---
export async function handleGetDownloadHistory(message) {
  const history = await getDownloadHistory();
  if (message.gameName) {
    return { record: history[message.gameName] || null };
  }
  return { history };
}

// 详情页访问记录（更新下载站网址缓存 lastAccessed）

// 详情页访问记录（更新下载站网址缓存 lastAccessed）
export async function handleTrackDownloadSiteVisit(message) {
  const data = message.data || {};
  const appId = data.appId;
  const url = data.url || '';
  if (!appId || !url) return { success: false };
  const siteInfo = inferSiteFromDomain(data.domain || '');
  if (siteInfo.key === 'unknown') return { success: false };
  await recordDownloadUrl(String(appId), siteInfo.key, siteInfo.name, url);
  return { success: true };
}

// 列表页批量记录下载页地址

// 列表页批量记录下载页地址
export async function handleRecordDownloadUrlsBatch(message) {
  const data = message.data || {};
  const siteInfo = inferSiteFromDomain(data.domain || '');
  if (siteInfo.key === 'unknown') return { success: false };
  await recordDownloadUrlsBatch(siteInfo.key, siteInfo.name, data.entries || []);
  return { success: true };
}

// --- 游戏缓存管理 / Game cache management ---
