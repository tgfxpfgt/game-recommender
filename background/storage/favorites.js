/**
 * 游戏雷达 Game Radar - 收藏/关注清单 / Favorites Watchlist
 *
 * v10.6.0（新增功能 F2）：本地收藏——列表/详情一键收藏游戏，dashboard 愿望单
 * 展示；与限免监控联动（收藏游戏进限免时通知优先提示）。数据全本地
 * （OPFS 模块），随备份/清除全链路管理。
 * Local favorites watchlist: one-click favorite from list/detail, dashboard
 * wishlist, integrated with free-game monitoring (favorites in giveaways are
 * surfaced first). Fully local via the OPFS data store.
 */
import { dataStore } from '../../data/data-store.js';
import { DB_KEYS, STORAGE_CAPS } from '../core/constants.js';
import { withLock } from '../core/mechanisms.js'; // v14.11 B6：收藏切换 RMW 锁

const MAX_FAVORITES = STORAGE_CAPS.favorites; // v10.7.0：单源 STORAGE_CAPS

/**
 * 读取收藏清单（appId 升序稳定；新增时间随条目返回）
 * @returns {Promise<Object>} { [appId]: { name, addedAt } }
 */
export async function getFavorites() {
  const stored = await dataStore.readModule(DB_KEYS.FAVORITES);
  return stored && typeof stored === 'object' ? stored : {};
}

/**
 * 切换收藏状态（存在则移除，不存在则添加）
 * @param {string|number} appId
 * @param {string} name 游戏名（徽章/浮窗展示用）
 * @returns {Promise<{favorited: boolean, full?: boolean}>}
 */
// v14.11 B6（报告 D P0-5）：收藏切换 RMW 串行锁——TOGGLE_FAVORITE 在内容侧
// 白名单内，多标签页/双击并发时读-改-写以同一旧基线覆盖写（后写吞掉前者的
// 增删；对照 download-urls/history/app-stats 均已持锁，唯此遗漏）
const withFavLock = withLock();

/**
 * 切换收藏状态（存在则移除，不存在则添加）
 * @param {string|number} appId
 * @param {string} name 游戏名（徽章/浮窗展示用）
 * @param {string} [releaseDate] 发售日期（v12 B6 追踪用）
 * @returns {Promise<{favorited: boolean, full?: boolean}>}
 */
export async function toggleFavorite(appId, name, releaseDate) {
  const key = String(appId || '').trim();
  if (!key) return { favorited: false };
  return withFavLock(async () => {
    const favorites = await getFavorites();
    if (favorites[key]) {
      delete favorites[key];
      await dataStore.writeModule(DB_KEYS.FAVORITES, favorites);
      return { favorited: false };
    }
    if (Object.keys(favorites).length >= MAX_FAVORITES) return { favorited: false, full: true };
    favorites[key] = {
      name: String(name || '').slice(0, 200),
      releaseDate: String(releaseDate || '').slice(0, 40), // v12 B6：发售追踪
      addedAt: Date.now()
    };
    await dataStore.writeModule(DB_KEYS.FAVORITES, favorites);
    return { favorited: true };
  });
}
