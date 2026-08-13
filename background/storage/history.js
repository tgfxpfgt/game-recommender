/**
 * 游戏雷达 Game Radar - 下载历史 / Download History
 *
 * 记录每个游戏的下载行为（次数/站点/链接/网盘地址），上限 200 条。
 * Records per-game download behavior (count/site/url/pan-url), max 200 entries.
 */
import { dataStore } from '../../data/data-store.js';
import { DB_KEYS } from '../core/constants.js';

const MAX_HISTORY_ENTRIES = 200;

// 从 domain 推断站点 key 和名称 / Infer the site key/name from a domain
export function inferSiteFromDomain(domain) {
  if (!domain) return { key: 'unknown', name: '未知站点' };
  if (domain.includes('xdgame')) return { key: 'xdgame', name: 'XDGame' };
  if (domain.includes('xianyudanji')) return { key: 'xianyudanji', name: '咸鱼单机' };
  if (domain.includes('gamer520') || domain.includes('gamers520')) return { key: 'gamer520', name: 'Gamer520' };
  return { key: 'unknown', name: domain };
}

// 读取下载历史 / Read download history
export async function getDownloadHistory() {
  const stored = await dataStore.readModule(DB_KEYS.DOWNLOAD_HISTORY);
  return stored || {};
}

// 记录一次下载 / Record a download
export async function recordDownloadHistory(data) {
  if (!data.gameName) return;
  const gameName = data.gameName.trim();
  if (gameName.length < 2) return;

  const history = await getDownloadHistory();
  const existing = history[gameName] || { totalDownloads: 0 };
  const siteInfo = inferSiteFromDomain(data.domain);

  history[gameName] = {
    ...existing,
    lastDownloadTime: Date.now(),
    lastDownloadSite: data.siteKey || siteInfo.key,
    lastDownloadSiteName: data.siteName || siteInfo.name,
    lastDownloadUrl: data.detailUrl || data.url || '',
    lastPanUrl: data.downloadUrl || '',
    totalDownloads: (existing.totalDownloads || 0) + 1
  };

  // 限制历史记录数量（最多保留 200 条）
  const keys = Object.keys(history);
  if (keys.length > MAX_HISTORY_ENTRIES) {
    const sorted = keys.sort((a, b) => (history[b].lastDownloadTime || 0) - (history[a].lastDownloadTime || 0));
    for (let i = MAX_HISTORY_ENTRIES; i < sorted.length; i++) {
      delete history[sorted[i]];
    }
  }

  await dataStore.writeModule(DB_KEYS.DOWNLOAD_HISTORY, history);
}
