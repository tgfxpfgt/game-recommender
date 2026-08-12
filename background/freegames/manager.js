/**
 * Game Recommender - 限免游戏管理 / Free Games Manager
 *
 * 聚合 Epic / GOG / Steam / GamerPower 限免信息，每日刷新并去重；
 * 角标显示当天新增数量；领取状态标记。
 * Aggregates Epic/GOG/Steam/GamerPower giveaways with daily refresh,
 * name-based dedup, badge count for today's new items and claim states.
 */
import { dataStore } from '../../data/data-store.js';
import { DB_KEYS } from '../core/constants.js';
import { fetchWithTimeout } from '../core/utils.js';
import { Logger } from '../storage/logger.js';

const ONE_DAY = 24 * 3600 * 1000;

// v3.4.1：外链协议白名单——第三方 API 的链接/图片只允许 http(s)
// （防止 javascript: 等伪协议注入弹出页 href/src）
// Protocol whitelist for giveaway links/images (http(s) only, blocks javascript:)
const SAFE_URL_RE = /^https?:\/\//i;
function sanitizeGameUrl(url) {
  return (typeof url === 'string' && SAFE_URL_RE.test(url)) ? url : '';
}

async function fetchEpicFreeGames() {
  const games = [];
  try {
    const url = 'https://store-site-backend-official.ak.epicgames.com/freeGamesPromotions?locale=zh-CN&country=CN&allowCountries=CN';
    const resp = await fetchWithTimeout(url);
    const data = await resp.json();
    const elements = data?.data?.Catalog?.searchStore?.elements || [];
    for (const el of elements) {
      const promo = el.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0];
      if (!promo) continue;
      const now = Date.now();
      const start = new Date(promo.startDate).getTime();
      const end = new Date(promo.endDate).getTime();
      if (now < start || now > end) continue;

      const img = el.keyImages?.find(i => i.type === 'OfferImageWide')?.url ||
                  el.keyImages?.[0]?.url || '';
      games.push({
        id: 'epic-' + el.id,
        platform: 'epic',
        platformName: 'Epic Games',
        claimType: 'direct',
        source: 'Epic Games Store',
        name: el.title,
        description: el.description || '',
        image: img,
        url: `https://store.epicgames.com/zh-CN/p/${el.productSlug || el.urlSlug}`,
        originalPrice: el.price?.totalPrice?.fmtPrice?.originalPrice || '',
        endTime: promo.endDate,
        claimed: false
      });
    }
  } catch (e) {
    Logger.debug('FreeGames', 'Epic限免获取失败:', e.message);
  }
  return games;
}

async function fetchGogFreeGames() {
  const games = [];
  try {
    const resp = await fetchWithTimeout('https://www.gog.com/games/ajax/filtered?mediaType=game&price=free&limit=25', {
      headers: { 'Accept': 'application/json' }
    });
    if (!resp.ok) return games;
    const data = await resp.json();
    const products = data?.products || [];
    for (const p of products.slice(0, 10)) {
      games.push({
        id: 'gog-' + p.id,
        platform: 'gog',
        platformName: 'GOG',
        claimType: 'direct',
        source: 'GOG',
        name: p.title,
        description: '',
        image: p.image ? `https:${p.image}.jpg` : '',
        url: `https://www.gog.com${p.url}`,
        originalPrice: p.price?.finalPrice ? `¥${p.price.finalPrice}` : '免费',
        endTime: '',
        claimed: false
      });
    }
  } catch (e) {
    Logger.debug('FreeGames', 'GOG限免获取失败:', e.message);
  }
  return games;
}

async function fetchSteamFreeGames() {
  const games = [];
  try {
    const resp = await fetchWithTimeout('https://store.steampowered.com/api/featuredcategories/?l=schinese&cc=cn');
    if (!resp.ok) return games;
    const data = await resp.json();
    const specials = data?.specials?.items || [];
    for (const item of specials) {
      if (item.final_price === 0 || item.discount_percent === 100) {
        games.push({
          id: 'steam-' + item.id,
          platform: 'steam',
          platformName: 'Steam',
          claimType: 'direct',
          source: 'Steam',
          name: item.name,
          description: '',
          image: item.large_capsule_image || item.small_capsule_image || '',
          url: `https://store.steampowered.com/app/${item.id}/`,
          originalPrice: item.final_price === 0 ? '免费' : '',
          endTime: '',
          claimed: false
        });
      }
    }
  } catch (e) {
    Logger.debug('FreeGames', 'Steam限免获取失败:', e.message);
  }
  return games;
}

// 判断 GamerPower 条目为官方直领还是第三方领取（需条件）
// Classify a GamerPower giveaway: official direct vs third-party (key-based)
// v4.2.0：导出供单测（纯函数）
export function classifyGamerPowerGiveaway(item) {
  const title = (item.title || '').toLowerCase();
  const instructions = (item.instructions || '').toLowerCase();

  const hasKeyInTitle = /\bkey\b/.test(title);
  const thirdPartySignals = [
    'alienware', 'unlock your key', 'get your key', 'redeem the key',
    'redeem your key', 'indiegala', 'humble bundle', 'fanatical',
    'grabfree', 'key giveaway', 'claim your key', 'your free key'
  ];
  const hasThirdPartyInstruction = thirdPartySignals.some(kw => instructions.includes(kw));

  if (hasKeyInTitle || hasThirdPartyInstruction) return 'thirdparty';
  return 'direct';
}

// v4.2.0：导出供单测（纯函数）
export function extractThirdPartySource(item) {
  const instructions = (item.instructions || '').toLowerCase();
  if (instructions.includes('alienware')) return 'Alienware Arena';
  if (instructions.includes('indiegala')) return 'IndieGala';
  if (instructions.includes('humble')) return 'Humble Bundle';
  if (instructions.includes('fanatical')) return 'Fanatical';
  return '第三方平台';
}

async function fetchGamerPowerFreeGames() {
  const games = [];
  try {
    const resp = await fetchWithTimeout('https://www.gamerpower.com/api/giveaways');
    if (!resp.ok) return games;
    const data = await resp.json();
    if (!Array.isArray(data)) return games;

    for (const item of data) {
      const platforms = (item.platforms || '').toLowerCase();
      let platform = 'other';
      let platformName = '其他';
      if (platforms.includes('epic')) { platform = 'epic'; platformName = 'Epic Games'; }
      else if (platforms.includes('steam')) { platform = 'steam'; platformName = 'Steam'; }
      else if (platforms.includes('gog')) { platform = 'gog'; platformName = 'GOG'; }
      else if (platforms.includes('itch')) { platform = 'itch'; platformName = 'Itch.io'; }
      // v4.1.0：微软商店（GamerPower 的 platforms 可能出现 "Microsoft Store"，
      // 此前无关键字落入 other 被丢弃）
      else if (platforms.includes('microsoft')) { platform = 'microsoft'; platformName = 'Microsoft Store'; }
      else if (platforms.includes('drm-free') || platforms.includes('pc')) { platform = 'pc'; platformName = 'PC'; }

      if (platform === 'other') continue;

      const claimType = classifyGamerPowerGiveaway(item);
      const source = claimType === 'thirdparty' ? extractThirdPartySource(item) : platformName;

      games.push({
        id: 'gp-' + item.id,
        platform,
        platformName,
        claimType,
        source,
        name: item.title || '',
        description: item.description || '',
        image: item.image || '',
        url: item.open_giveaway_url || item.giveaway_url || '',
        originalPrice: item.worth || '',
        endTime: (item.end_date && item.end_date !== 'N/A') ? item.end_date : '',
        claimed: false
      });
    }
  } catch (e) {
    Logger.debug('FreeGames', 'GamerPower限免获取失败:', e.message);
  }
  return games;
}

async function fetchAllFreeGames() {
  const [epic, gog, steam, gamerpower] = await Promise.all([
    fetchEpicFreeGames(),
    fetchGogFreeGames(),
    fetchSteamFreeGames(),
    fetchGamerPowerFreeGames()
  ]);

  const merged = [...epic, ...gog, ...steam];
  const seenNames = new Set(merged.map(g => normalizeGameName(g.name)));

  for (const gp of gamerpower) {
    const norm = normalizeGameName(gp.name);
    if (!seenNames.has(norm)) {
      seenNames.add(norm);
      merged.push(gp);
    }
  }

  // v3.4.1：统一协议白名单（入口收敛，防第三方 API 注入伪协议链接）
  for (const g of merged) {
    g.url = sanitizeGameUrl(g.url);
    g.image = sanitizeGameUrl(g.image);
  }

  return merged;
}

function normalizeGameName(name) {
  return (name || '').toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/giveaway|free|限免|领取/gi, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
    .trim();
}

// 刷新限免游戏（force 强制重新拉取）/ Refresh free games (force re-fetches)
export async function refreshFreeGames(force = false) {
  const stored = await dataStore.readModule(DB_KEYS.FREE_GAMES);
  const existing = stored || { lastUpdate: 0, games: [] };

  if (!force && existing.lastUpdate && (Date.now() - existing.lastUpdate < ONE_DAY)) {
    await updateFreeGamesBadge();
    return existing;
  }

  const newGames = await fetchAllFreeGames();
  const existingMap = new Map(existing.games.map(g => [g.id, g]));
  const now = Date.now();
  newGames.forEach(g => {
    const old = existingMap.get(g.id);
    if (old) {
      g.claimed = old.claimed || false;
      g.firstSeen = old.firstSeen || now;
    } else {
      g.firstSeen = now;
    }
  });

  const result = { lastUpdate: now, games: newGames };
  await dataStore.writeModule(DB_KEYS.FREE_GAMES, result);
  await updateFreeGamesBadge();
  return result;
}

// 更新工具栏角标（当天新增数量）/ Update the toolbar badge (today's new count)
async function updateFreeGamesBadge() {
  try {
    const stored = await dataStore.readModule(DB_KEYS.FREE_GAMES);
    const games = (stored && stored.games) || [];
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();
    const newToday = games.filter(g => g.firstSeen && g.firstSeen >= todayStartMs).length;
    chrome.action.setBadgeText({ text: newToday > 0 ? String(newToday) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
  } catch (e) {
    Logger.debug('FreeGames', '更新badge失败:', e.message);
  }
}

// 标记领取 / Mark a game as claimed
export async function claimFreeGame(gameId) {
  const fg = await dataStore.readModule(DB_KEYS.FREE_GAMES) || { games: [] };
  const game = fg.games.find(g => g.id === gameId);
  if (game) {
    game.claimed = true;
    await dataStore.writeModule(DB_KEYS.FREE_GAMES, fg);
    await updateFreeGamesBadge();
  }
  return { success: true };
}

// 获取限免数据（供页面与消息使用）/ Get free-games data
export async function getFreeGamesData(force = false) {
  const freeData = await refreshFreeGames(force);
  Logger.info('FreeGames', `获取限免游戏`, { count: freeData.games ? freeData.games.length : 0 });
  return { data: freeData };
}
