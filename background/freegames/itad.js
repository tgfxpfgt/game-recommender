/**
 * 游戏雷达 Game Radar - ITAD 价格域 / ITAD Price Domain
 *
 * v14.2.0（主报告 P2-1）：manager.js 三域拆分——本文件承载 ITAD 二次校验、
 * 历史最低价、收藏折扣轮询（含发售提醒）与收藏价格表（两处 TTL 缓存）。
 * ITAD secondary check, all-time-low, favorite price watch (with release
 * reminders) and the dashboard price table.
 */
import { ENDPOINTS, STORAGE_CAPS } from '../core/constants.js';
import { fetchWithTimeout } from '../core/utils.js';
import { getSettings } from '../core/settings.js';
import { createTtlCache } from '../core/mechanisms.js';
import { getFavorites } from '../storage/favorites.js';
import { Logger } from '../storage/logger.js';
import { notifyBase } from './notify.js'; // v14.3.0：通知构造单源（B8）

// v6.3.3：ITAD 二次校验（可选 key）——确认 Steam 游戏当前确实免费（价格 0），
// 防 GamerPower 数据过期/错误导致的误报；无 key 或失败时容错放行（按原分类）
// ITAD secondary check: confirm the game is currently free (price 0)
// v14.2.0：导出（三域拆分后 notify 域复核 Steam 候选时消费）
export async function checkItadFree(appId) {
  try {
    // v6.4.19：多套配置——使用激活配置的 key；旧 itadApiKey 兼容为隐式配置
    const settings = await getSettings();
    const key = activeItadKey(settings);
    if (!key || !appId) return null;
    const resp = await fetchWithTimeout(`${ENDPOINTS.itadPrices}?key=${key}&appids=steam/${appId}`);
    // v9.7.0：非 2xx 区分凭证失效（401/403 → key 失效告警）与其他失败
    if (resp.status === 401 || resp.status === 403) {
      Logger.warn('FreeGames', `ITAD校验凭证失效（HTTP ${resp.status}，检查激活 Key 是否有效）`);
      return null;
    }
    if (!resp.ok) return null;
    const data = await resp.json();
    const entry = data && data['steam/' + appId];
    const price = entry && entry.lowest && entry.lowest.price !== undefined ? entry.lowest.price : null;
    return price === null ? null : price <= 0;
  } catch (e) {
    // v7.1.0：校验失败提升为 warn（凭证卫生——API 失效可被发现）
    // v9.7.0：文案区分网络/CORS 失败与 Key 失效——fetch 异常多为网络问题，
    // 恒报"检查 Key"会误导用户（无 Key 用户也不会走到这里：上方已早退）
    Logger.warn('FreeGames', 'ITAD校验请求失败（网络不可达或被拦截，按原分类放行）:', String(e));
    return null;
  }
}

// v10.6.0 F1：ITAD 历史最低价（详情浮窗展示；12h 内存缓存防频繁请求）。
// 复用 v02/game/prices 端点的 lowest 字段（与 checkItadFree 同源）。
// ITAD all-time-low price for the detail float (same endpoint as the free
// check); 12h in-memory cache.
// v10.7.0：TTL 缓存收敛至 core/mechanisms.js 工厂（值可为 null = 负缓存）
// v14.2.0：补 max（复审轮 P2-4——无界缓存 SW 长驻无保障）
const itadLowestCache = createTtlCache({ ttlMs: 12 * 3600 * 1000, max: STORAGE_CAPS.itadPriceCache });

export async function getItadLowest(appId) {
  const key = String(appId || '').trim();
  if (!key) return null;
  const settings = await getSettings();
  const apiKey = activeItadKey(settings);
  if (!apiKey) return null; // 未配置 Key → 功能静默（与限免校验同策略）
  const cached = itadLowestCache.peek(key);
  if (cached !== undefined) return cached; // 命中（含 null 负缓存）
  /** @type {{price: number, shop: string}|null} */
  let info = null;
  try {
    const resp = await fetchWithTimeout(`${ENDPOINTS.itadPrices}?key=${apiKey}&appids=steam/${key}&region=cn`);
    if (resp.status === 401 || resp.status === 403) {
      Logger.warn('FreeGames', `ITAD 最低价查询凭证失效（HTTP ${resp.status}）`);
      itadLowestCache.set(key, null);
      return null;
    }
    if (!resp.ok) return null;
    const data = await resp.json();
    const entry = data && data['steam/' + key];
    const lowest = entry && entry.lowest;
    if (lowest && lowest.price !== undefined) {
      info = { price: lowest.price, shop: (lowest.shop && lowest.shop.name) || '' };
    }
  } catch (e) {
    Logger.debug('FreeGames', 'ITAD 最低价查询失败:', String(e));
  }
  itadLowestCache.set(key, info);
  return info;
}

// v11.0 B3：收藏折扣监控——ITAD 轮询收藏游戏现价，折扣 ≥ 阈值 → 通知。
// Favorite price watch: poll ITAD for favorited games, notify on discount.
// v14.2.0：补 max（复审轮 P2-4）
const favPriceCache = createTtlCache({ ttlMs: 24 * 3600e3, max: STORAGE_CAPS.itadPriceCache }); // 现价（number|null = 负缓存）

async function fetchFavoriteCurrentPrice(appId, apiKey) {
  const cached = favPriceCache.peek(String(appId));
  if (cached !== undefined) return cached;
  /** @type {number|null} */
  let price = null;
  try {
    const resp = await fetchWithTimeout(`${ENDPOINTS.itadPrices}?key=${apiKey}&appids=steam/${appId}&region=cn`);
    if (resp.ok) {
      const data = await resp.json();
      const entry = data && data['steam/' + appId];
      const prices = entry && entry.prices;
      if (Array.isArray(prices) && prices.length > 0) {
        // 取最低现价（prices[].price 为美元原值字段，按 ITAD v02 形态取最小）
        const nums = prices.map((p2) => Number(p2.price)).filter((v) => Number.isFinite(v) && v >= 0);
        if (nums.length > 0) price = Math.min.apply(null, nums);
      }
    }
  } catch (e) {
    Logger.debug('FreeGames', '收藏现价查询失败:', String(e));
  }
  favPriceCache.set(String(appId), price);
  return price;
}

export async function watchFavoritePrices() {
  const settings = await getSettings();
  if (settings.favoritePriceWatch === false) return { skipped: true, notified: 0 };
  const apiKey = activeItadKey(settings);
  if (!apiKey) return { skipped: true, notified: 0 }; // 无 Key 零请求
  const favorites = await getFavorites();
  const keys = Object.keys(favorites).slice(0, 50); // 上限 50（防无界轮询）
  const threshold = Number(settings.favoriteDiscountThreshold) || 0.8; // 现价 ≤ 最低 × 阈值
  let notified = 0;
  for (const appId of keys) {
    const lowest = await getItadLowest(appId); // 复用 12h 缓存
    if (!lowest || !Number.isFinite(lowest.price) || lowest.price <= 0) continue;
    const current = await fetchFavoriteCurrentPrice(appId, apiKey);
    if (!Number.isFinite(current) || current <= 0) continue;
    if (current <= lowest.price * threshold) {
      const name = (favorites[appId] && favorites[appId].name) || 'AppID ' + appId;
      notifyBase('💥 收藏折扣提醒', `${name} 现价 ${current.toFixed(2)}（历史最低 ${lowest.price.toFixed(2)} @ ${lowest.shop || 'ITAD'}）`, {
        icon: chrome.runtime.getURL('icons/icon128.png')
      });
      notified += 1;
    }
  }
  // v12 B6：发售日提醒——收藏中未发售且 48h 内发售的游戏，通知一次（标记防重）
  let releaseNotified = 0;
  for (const appId of keys) {
    const info = favorites[appId];
    const rd = Date.parse((info && info.releaseDate) || '');
    if (isNaN(rd)) continue;
    const daysTo = Math.ceil((rd - Date.now()) / 86400000);
    if (daysTo < 0 || daysTo > 2) continue;
    const markKey = 'grReleaseNotified:' + appId;
    const marked = await new Promise((res) => {
      try {
        chrome.storage.local
          .get(markKey)
          .then((d) => res(!!(d && d[markKey])))
          .catch(() => res(false));
      } catch {
        res(true);
      }
    });
    if (marked) continue;
    try {
      chrome.storage.local.set({ [markKey]: true }).catch(() => {});
    } catch {
      /* ignore */
    }
    const name = (info && info.name) || 'AppID ' + appId;
    notifyBase('🚀 收藏游戏发售提醒', `${name} ${daysTo <= 0 ? '今天' : daysTo + ' 天后'}发售（${info.releaseDate || ''}）`, {
      icon: chrome.runtime.getURL('icons/icon128.png')
    });
    releaseNotified += 1;
  }

  Logger.info(
    'FreeGames',
    `收藏折扣监控完成：${keys.length} 个收藏，折扣通知 ${notified} 条，发售提醒 ${releaseNotified} 条`
  );
  return { skipped: false, notified, releaseNotified };
}

// v14.1.0：收藏价格表——dashboard 收藏列数据源。逐条复用 getItadLowest（12h）
// 与 favPriceCache（24h）两处 TTL 缓存，缓存冷时才逐条发请求（上限 50 同
// watchFavoritePrices）；无 ITAD Key 返回 configured:false 由 UI 显示引导。
// Favorite price table for the dashboard columns; reuses both TTL caches so a
// warm session costs zero requests. configured:false when no ITAD key.
export async function getFavoritePrices() {
  const settings = await getSettings();
  const apiKey = activeItadKey(settings);
  if (!apiKey) return { configured: false, prices: {} };
  const favorites = await getFavorites();
  const keys = Object.keys(favorites).slice(0, 50);
  /** @type {Record<string, {current: number|null, lowest: number|null, shop: string}>} */
  const prices = {};
  for (const appId of keys) {
    const lowest = await getItadLowest(appId);
    const current = await fetchFavoriteCurrentPrice(appId, apiKey);
    prices[appId] = {
      current: Number.isFinite(current) && current > 0 ? Math.round(current * 100) / 100 : null,
      lowest: lowest && Number.isFinite(lowest.price) && lowest.price > 0 ? Math.round(lowest.price * 100) / 100 : null,
      shop: (lowest && lowest.shop) || ''
    };
  }
  return { configured: true, prices };
}

// v6.4.19：解析当前激活的 ITAD key（profiles 优先，旧 itadApiKey 兼容）
// Resolve the active ITAD key (profiles first; legacy itadApiKey as fallback)
function activeItadKey(settings) {
  const profiles = Array.isArray(settings.itadProfiles) ? settings.itadProfiles : [];
  const active = profiles.find((p) => p && String(p.id) === String(settings.itadActiveProfileId));
  if (active && active.key) return active.key;
  const first = profiles.find((p) => p && p.key);
  if (first) return first.key;
  return settings.itadApiKey || '';
}
