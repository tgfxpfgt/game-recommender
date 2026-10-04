/**
 * 游戏雷达 Game Radar - 消息处理：限免与 ITAD / Free-Games & ITAD Handlers
 *
 * v14 B10：由 handlers.js 迁出——限免数据/领取与 ITAD 最低价查询。
 * GET_ITAD_LOWEST 原为内联 + 动态 import（MV3 SW 动态 import 不可靠，
 * 铁律 #2）——改静态导入归位。
 * Moved from handlers.js (B10): free-games data/claim and ITAD lowest-price
 * query (dynamic import replaced with a static one — iron law #2).
 */
import { getFreeGamesData, claimFreeGame, getItadLowest } from '../freegames/manager.js';

// v14 B10：领域 handler 段（action → handler 单处声明，handlers.js 聚合展开）
export const freegamesHandlers = {
  GET_FREE_GAMES: async (msg) => getFreeGamesData(msg.force === true),
  CLAIM_FREE_GAME: async (msg) => claimFreeGame(msg.gameId),
  GET_ITAD_LOWEST: async (msg) => ({ info: await getItadLowest(msg && msg.appId) })
};
