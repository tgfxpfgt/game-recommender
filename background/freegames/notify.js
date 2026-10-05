/**
 * 游戏雷达 Game Radar - 限免通知域 / Free-Games Notify Domain
 *
 * v14.2.0（主报告 P2-1）：manager.js 三域拆分——本文件承载新限免推送通知
 * （含 ITAD/Steam 双重复核）、工具栏角标、领取标记与通知点击数据。
 * Push notification (with ITAD + Steam double-check), toolbar badge,
 * claim marking and the notification-click payload.
 */
import { dataStore } from '../../data/data-store.js';
import { DB_KEYS } from '../core/constants.js';
import { getSettings } from '../core/settings.js';
import { getFavorites } from '../storage/favorites.js';
import { Logger } from '../storage/logger.js';
import { checkItadFree } from './itad.js';
import { determineSteamFreeType } from './fetch.js';

// v7.4.0：最近一次限免通知内容（SW 点击通知时读取）
// v9.7.0：同步持久化到 chrome.storage.session——通知存活数分钟～数小时而
// SW 空闲 30s 即被杀，点击通知唤醒的是全新 SW 实例，纯内存变量必然为空
//（"点击通知打开商店页"100% 失效）；storage.session 生命周期与浏览器会话
// 一致，恰覆盖通知存活窗口
let lastNotifyGames = [];
const NOTIFY_SESSION_KEY = 'grLastNotifyGames';
export async function getLastNotifyGames() {
  if (lastNotifyGames.length > 0) return lastNotifyGames;
  try {
    const data = await chrome.storage.session.get(NOTIFY_SESSION_KEY);
    const stored = data && data[NOTIFY_SESSION_KEY];
    if (Array.isArray(stored) && stored.length > 0) {
      lastNotifyGames = stored;
      return stored;
    }
  } catch {
    /* session 存储不可用（极旧 Chrome）→ 空数组（与旧行为一致） */
  }
  return [];
}

// v6.3.2 C2：新限免推送通知（聚合一条，防骚扰；通知权限在 manifest）
// Push notification for new free games (one aggregated notification)
export async function notifyNewFreeGames(newOnes) {
  // v14.2.0：导出（manager 编排消费）
  try {
    // v10.3.0：限免通知独立开关——关闭后跳过推送（限免页/角标不受影响）
    const notifySettings = await getSettings();
    if (notifySettings.notifyFreeGames === false) return;
    // v6.3.3：仅推送限时领取（limited）——weekend/f2p/key 不打扰
    let limited = newOnes.filter((g) => g.freeType !== 'weekend' && g.freeType !== 'f2p' && g.freeType !== 'key');
    if (!chrome.notifications || limited.length === 0) return;
    // Steam 平台候选：ITAD 确认免费（可选 key）+ Steam 官方判定类型（v6.4.2）
    if (limited.some((g) => g.platform === 'steam')) {
      const checked = await Promise.all(
        limited.map(async (g) => {
          if (g.platform !== 'steam') return true;
          const appId = (g.url.match(/\/app\/(\d+)/) || [])[1];
          // ITAD 二次校验（可选 key；无 key/失败容错放行）
          const isFree = await checkItadFree(appId);
          if (isFree === false) return false;
          // Steam 官方判定：喜加一（limited）才通知——免费周末/F2P 过滤
          const officialType = await determineSteamFreeType(appId);
          if (officialType === 'f2p' || officialType === 'weekend') return false;
          return true; // null（无法判定）→ 按现有分类放行
        })
      );
      limited = limited.filter((_, i) => checked[i]);
    }
    if (limited.length === 0) return;
    newOnes = limited;
    // v7.4.0：记录通知内容 → SW 点击通知时打开首个游戏商店页
    lastNotifyGames = newOnes;
    // v9.7.0：同步写 session 存储（SW 被杀后点击通知仍可读取）
    try {
      await chrome.storage.session.set({ [NOTIFY_SESSION_KEY]: newOnes });
    } catch {
      /* session 不可用时退化为纯内存（旧行为） */
    }
    const names = newOnes
      .slice(0, 3)
      .map((g) => g.name)
      .join('、');
    // v10.6.0 F2：收藏游戏进限免 → 通知标题优先提示（愿望单联动）
    /** @type {{name?: string}|null} */
    let favHit = null;
    try {
      const favs = await getFavorites();
      favHit = newOnes.find((g) => {
        const appId = ((g.url && g.url.match(/\/app\/(\d+)/)) || [])[1] || (g.steamId && String(g.steamId));
        return appId && favs[appId];
      });
    } catch {
      /* 收藏读取失败不影响通知 */
    }
    chrome.notifications.create('gr-free-games', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: favHit ? `⭐ 收藏游戏进限免：${(favHit.name || '').slice(0, 30)}` : `🎮 新增 ${newOnes.length} 款限免游戏`,
      message: names + (newOnes.length > 3 ? ` 等 ${newOnes.length} 款` : ''),
      priority: 1
    });
  } catch (e) {
    Logger.debug('FreeGames', '限免通知失败:', String(e));
  }
}

// 更新工具栏角标（当天新增数量）/ Update the toolbar badge (today's new count)
export async function updateFreeGamesBadge() {
  try {
    const stored = await dataStore.readModule(DB_KEYS.FREE_GAMES);
    const games = (stored && stored.games) || [];
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();
    const newToday = games.filter((g) => g.firstSeen && g.firstSeen >= todayStartMs).length;
    chrome.action.setBadgeText({ text: newToday > 0 ? String(newToday) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
  } catch (e) {
    Logger.debug('FreeGames', '更新badge失败:', String(e));
  }
}

// 标记领取 / Mark a game as claimed
export async function claimFreeGame(gameId) {
  const fg = (await dataStore.readModule(DB_KEYS.FREE_GAMES)) || { games: [] };
  const game = fg.games.find((g) => g.id === gameId);
  if (game) {
    game.claimed = true;
    await dataStore.writeModule(DB_KEYS.FREE_GAMES, fg);
    await updateFreeGamesBadge();
  }
  return { success: true };
}
