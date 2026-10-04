/**
 * 游戏雷达 Game Radar - 消息处理：收藏 / Favorites Handlers
 *
 * v14 B10：由 handlers.js 迁出——收藏切换与清单读取。
 * Moved from handlers.js (B10): favorite toggle and list.
 */
import { toggleFavorite, getFavorites } from '../storage/favorites.js'; // v10.6.0 F2 收藏

// v14 B10：领域 handler 段（action → handler 单处声明，handlers.js 聚合展开）
export const favoritesHandlers = {
  TOGGLE_FAVORITE: async (msg) => toggleFavorite(msg && msg.appId, msg && msg.name, msg && msg.releaseDate),
  GET_FAVORITES: async () => ({ favorites: await getFavorites() })
};
