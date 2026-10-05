/**
 * 游戏雷达 Game Radar - 消息处理：收藏 / Favorites Handlers
 *
 * v14 B10：由 handlers.js 迁出——收藏切换与清单读取。
 * v14.1.0：新增 GET_FAVORITE_PRICES（dashboard 收藏现价/历史最低列，复用
 * ITAD 两处 TTL 缓存；无 Key 返回 configured:false 由 UI 显示引导）。
 * Moved from handlers.js (B10); v14.1.0 adds the favorites price table.
 */
import { toggleFavorite, getFavorites } from '../storage/favorites.js'; // v10.6.0 F2 收藏
import { getFavoritePrices } from '../freegames/manager.js'; // v14.1.0：价格列
import { fetchWithTimeout } from '../core/utils.js'; // v14.2.0：Key 测试改走后台（铁律 #8）
import { ENDPOINTS } from '../core/constants.js';

// v14 B10：领域 handler 段（action → handler 单处声明，handlers.js 聚合展开）
export const favoritesHandlers = {
  TOGGLE_FAVORITE: async (msg) => toggleFavorite(msg && msg.appId, msg && msg.name, msg && msg.releaseDate),
  GET_FAVORITES: async () => ({ favorites: await getFavorites() }),
  GET_FAVORITE_PRICES: async () => getFavoritePrices(), // v14.1.0
  // v14.2.0（补充轮 P1-3）：ITAD Key 测试改走后台 fetchWithTimeout——此前
  // options 页面裸 fetch（不受 SSRF 校验/限速/出站审计），端点字面量第二份副本。
  // 固定探测 appids=steam/730（CS2，恒存在），只回 ok/status 不回价格体。
  TEST_ITAD_KEY: async (msg) => {
    const key = String((msg && msg.key) || '').slice(0, 200);
    if (!key) return { ok: false, status: 0 };
    try {
      const resp = await fetchWithTimeout(
        `${ENDPOINTS.itadPrices}?key=${encodeURIComponent(key)}&appids=steam/730`
      );
      return { ok: resp.ok, status: resp.status };
    } catch {
      return { ok: false, status: 0 };
    }
  }
};
