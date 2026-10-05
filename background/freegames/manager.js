/**
 * 游戏雷达 Game Radar - 限免游戏管理（编排壳）/ Free Games Manager (orchestrator)
 *
 * 聚合 Epic / GOG / Steam / GamerPower 限免信息，每日刷新并去重；
 * 角标显示当天新增数量；领取状态标记。
 * Aggregates Epic/GOG/Steam/GamerPower giveaways with daily refresh,
 * name-based dedup, badge count for today's new items and claim states.
 *
 * v14.2.0（主报告 P2-1）：741 行三域拆分为 fetch（抓取/分类/Steam 判定）/
 * itad（ITAD 价格域）/ notify（通知/角标/领取）三个单职责模块；本文件仅保留
 * 刷新编排（in-flight 复用 + 开关门控）与 re-export——handlers/service-worker
 * 的既有 import 路径不变。
 */
import { dataStore } from '../../data/data-store.js';
import { DB_KEYS } from '../core/constants.js';
import { getSettings } from '../core/settings.js';
import { Logger } from '../storage/logger.js';
import {
  fetchAllFreeGames,
  determineSteamFreeType,
  classifyGamerPowerGiveaway,
  classifyFreeType,
  extractThirdPartySource
} from './fetch.js';
import { getItadLowest, watchFavoritePrices, getFavoritePrices } from './itad.js';
import { getLastNotifyGames, notifyNewFreeGames, updateFreeGamesBadge, claimFreeGame } from './notify.js';

// re-export（消费面兼容——此前全部自 manager 导出）
export { getLastNotifyGames, claimFreeGame };
export { getItadLowest, watchFavoritePrices, getFavoritePrices };
export { determineSteamFreeType, classifyGamerPowerGiveaway, classifyFreeType, extractThirdPartySource };

const ONE_DAY = 24 * 3600 * 1000;

// 刷新限免游戏（force 强制重新拉取）/ Refresh free games (force re-fetches)
// v9.7.0：in-flight 复用——启动/alarm/UI 三处触发源可能并发（SW 启动即发
// 起 + alarm 同时到点），并发刷新各自读旧库、各自整体覆盖写，用户在两写
// 之间 claimFreeGame 设置的 claimed 标志会被最后写者以旧基线覆盖丢失
/** @type {Promise<Object>|null} */
let refreshInFlight = null;
export function refreshFreeGames(force = false) {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      return await doRefreshFreeGames(force);
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function doRefreshFreeGames(force = false) {
  // v10.6.0 N4：限免监控总开关——关闭后跳过全部外部源抓取与通知
  //（限免页显示上次数据；角标不受影响）
  const fgSettings = await getSettings();
  if (fgSettings.freeGamesEnabled === false && !force) {
    await updateFreeGamesBadge();
    return (await dataStore.readModule(DB_KEYS.FREE_GAMES)) || { lastUpdate: 0, games: [] };
  }
  if (fgSettings.freeGamesEnabled === false) {
    Logger.info('FreeGames', '限免监控已关闭，跳过刷新');
    return { lastUpdate: 0, games: [] };
  }
  const stored = await dataStore.readModule(DB_KEYS.FREE_GAMES);
  const existing = stored || { lastUpdate: 0, games: [] };

  if (!force && existing.lastUpdate && Date.now() - existing.lastUpdate < ONE_DAY) {
    await updateFreeGamesBadge();
    return existing;
  }

  const newGames = await fetchAllFreeGames();
  const existingMap = new Map(existing.games.map((g) => [g.id, g]));
  const now = Date.now();
  /** @type {Array<Object>} */
  const fresh = []; // 首次出现的游戏（v6.3.2 C2 通知用）/ newly appeared games
  newGames.forEach((g) => {
    const old = existingMap.get(g.id);
    if (old) {
      g.claimed = old.claimed || false;
      g.firstSeen = old.firstSeen || now;
    } else {
      g.firstSeen = now;
      fresh.push(g);
    }
  });

  const result = { lastUpdate: now, games: newGames };
  await dataStore.writeModule(DB_KEYS.FREE_GAMES, result);
  await updateFreeGamesBadge();
  await notifyNewFreeGames(fresh);
  return result;
}

// 获取限免数据（供页面与消息使用）/ Get free-games data
export async function getFreeGamesData(force = false) {
  const freeData = await refreshFreeGames(force);
  Logger.info('FreeGames', `获取限免游戏`, { count: freeData.games ? freeData.games.length : 0 });
  return { data: freeData };
}
