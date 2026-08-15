/**
 * 游戏雷达 Game Radar - 限免游戏管理 / Free Games Manager
 *
 * 聚合 Epic / GOG / Steam / GamerPower 限免信息，每日刷新并去重；
 * 角标显示当天新增数量；领取状态标记。
 * Aggregates Epic/GOG/Steam/GamerPower giveaways with daily refresh,
 * name-based dedup, badge count for today's new items and claim states.
 */
import { dataStore } from '../../data/data-store.js';
import { DB_KEYS } from '../core/constants.js';
import { fetchWithTimeout } from '../core/utils.js';
import { getSettings } from '../core/settings.js';
import { Logger } from '../storage/logger.js';

const ONE_DAY = 24 * 3600 * 1000;

// v3.4.1：外链协议白名单——第三方 API 的链接/图片只允许 http(s)
// （防止 javascript: 等伪协议注入弹出页 href/src）
// Protocol whitelist for giveaway links/images (http(s) only, blocks javascript:)
const SAFE_URL_RE = /^https?:\/\//i;
function sanitizeGameUrl(url) {
  return typeof url === 'string' && SAFE_URL_RE.test(url) ? url : '';
}

async function fetchEpicFreeGames() {
  const games = [];
  try {
    const url =
      'https://store-site-backend-official.ak.epicgames.com/freeGamesPromotions?locale=zh-CN&country=CN&allowCountries=CN';
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

      const img = el.keyImages?.find((i) => i.type === 'OfferImageWide')?.url || el.keyImages?.[0]?.url || '';
      games.push({
        id: 'epic-' + el.id,
        platform: 'epic',
        platformName: 'Epic Games',
        claimType: 'direct',
        source: 'Epic Games Store',
        freeType: 'limited', // 官方 freeGamesPromotions 天然限时（v6.3.3 确认官方直连）
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
    Logger.debug('FreeGames', 'Epic限免获取失败:', String(e));
  }
  return games;
}

async function fetchGogFreeGames() {
  const games = [];
  try {
    const resp = await fetchWithTimeout('https://www.gog.com/games/ajax/filtered?mediaType=game&price=free&limit=25', {
      headers: { Accept: 'application/json' }
    });
    if (!resp.ok) return games;
    const data = await resp.json();
    const products = data?.products || [];
    for (const p of products.slice(0, 10)) {
      // v6.3.3：原价 0 = 永久免费（f2p 不推送）；原价 > 0 且现价 0 = 限时领取
      const basePrice = p.price?.basePrice || 0;
      const freeType = basePrice > 0 ? 'limited' : classifyFreeType(p, false);
      games.push({
        id: 'gog-' + p.id,
        platform: 'gog',
        platformName: 'GOG',
        claimType: 'direct',
        source: 'GOG',
        freeType,
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
    Logger.debug('FreeGames', 'GOG限免获取失败:', String(e));
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
          freeType: 'limited',
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
    Logger.debug('FreeGames', 'Steam限免获取失败:', String(e));
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
    'alienware',
    'unlock your key',
    'get your key',
    'redeem the key',
    'redeem your key',
    'indiegala',
    'humble bundle',
    'fanatical',
    'grabfree',
    'key giveaway',
    'claim your key',
    'your free key'
  ];
  const hasThirdPartyInstruction = thirdPartySignals.some((kw) => instructions.includes(kw));

  if (hasKeyInTitle || hasThirdPartyInstruction) return 'thirdparty';
  return 'direct';
}

// v6.3.3：限免三类区分（纯函数，导出供单测）——用户决策：
// ✅ limited 限时领取 100% OFF（可入库）· ⚠️ weekend 免费周末（不入库）
// · ❌ f2p 永久免费（不推送）· key 垃圾 key 活动（过滤）
// Classify free-game type: limited / weekend / f2p / key (filtered)
export function classifyFreeType(item, hasEndDate = true) {
  const text = ((item.title || '') + ' ' + (item.description || '') + ' ' + (item.instructions || '')).toLowerCase();
  // 免费周末：标题/描述明确（Steam Free Weekend）
  if (/free weekend|免费周末|freeplay weekend|周末免费/i.test(text)) return 'weekend';
  // 垃圾 key 活动（第三方领取）→ 过滤（不收录不推送）
  if (classifyGamerPowerGiveaway(item) === 'thirdparty') return 'key';
  // 永久免费：无结束时间 + 明确 F2P 特征
  if (!hasEndDate && /free to play|永久免费|f2p|免费畅玩|免费游玩/i.test(text)) return 'f2p';
  return 'limited';
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
      if (platforms.includes('epic')) {
        platform = 'epic';
        platformName = 'Epic Games';
      } else if (platforms.includes('steam')) {
        platform = 'steam';
        platformName = 'Steam';
      } else if (platforms.includes('gog')) {
        platform = 'gog';
        platformName = 'GOG';
      } else if (platforms.includes('itch')) {
        platform = 'itch';
        platformName = 'Itch.io';
      }
      // v4.1.0：微软商店（GamerPower 的 platforms 可能出现 "Microsoft Store"，
      // 此前无关键字落入 other 被丢弃）
      else if (platforms.includes('microsoft')) {
        platform = 'microsoft';
        platformName = 'Microsoft Store';
      } else if (platforms.includes('drm-free') || platforms.includes('pc')) {
        platform = 'pc';
        platformName = 'PC';
      }

      if (platform === 'other') continue;

      const claimType = classifyGamerPowerGiveaway(item);
      // v6.3.3：垃圾 key 活动过滤（第三方领取，不收录不推送）
      if (claimType === 'thirdparty') continue;
      const source = platformName;
      const hasEndDate = !!item.end_date && item.end_date !== 'N/A';
      const freeType = classifyFreeType(item, hasEndDate);

      games.push({
        id: 'gp-' + item.id,
        platform,
        platformName,
        claimType,
        source,
        freeType,
        name: item.title || '',
        description: item.description || '',
        image: item.image || '',
        url: item.open_giveaway_url || item.giveaway_url || '',
        originalPrice: item.worth || '',
        endTime: hasEndDate ? item.end_date : '',
        claimed: false
      });
    }
  } catch (e) {
    Logger.debug('FreeGames', 'GamerPower限免获取失败:', String(e));
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
  const seenNames = new Set(merged.map((g) => normalizeGameName(g.name)));

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
  return (name || '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/giveaway|free|限免|领取/gi, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
    .trim();
}

// 刷新限免游戏（force 强制重新拉取）/ Refresh free games (force re-fetches)
export async function refreshFreeGames(force = false) {
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

// v6.3.3：ITAD 二次校验（可选 key）——确认 Steam 游戏当前确实免费（价格 0），
// 防 GamerPower 数据过期/错误导致的误报；无 key 或失败时容错放行（按原分类）
// ITAD secondary check: confirm the game is currently free (price 0)
async function checkItadFree(appId) {
  try {
    // v6.4.19：多套配置——使用激活配置的 key；旧 itadApiKey 兼容为隐式配置
    const settings = await getSettings();
    const key = activeItadKey(settings);
    if (!key || !appId) return null;
    const resp = await fetchWithTimeout(
      `https://api.isthereanydeal.com/v02/game/prices/?key=${key}&appids=steam/${appId}`
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const entry = data && data['steam/' + appId];
    const price = entry && entry.lowest && entry.lowest.price !== undefined ? entry.lowest.price : null;
    return price === null ? null : price <= 0;
  } catch (e) {
    // v7.1.0：校验失败提升为 warn（凭证卫生——API 失效可被发现）
    Logger.warn('FreeGames', 'ITAD校验失败（检查激活 Key 是否有效）:', String(e));
    return null;
  }
}

// v6.4.19：解析当前激活的 ITAD key（profiles 优先，旧 itadApiKey 兼容）
// Resolve the active ITAD key (profiles first; legacy itadApiKey as fallback)
export function activeItadKey(settings) {
  const profiles = Array.isArray(settings.itadProfiles) ? settings.itadProfiles : [];
  const active = profiles.find((p) => p && String(p.id) === String(settings.itadActiveProfileId));
  if (active && active.key) return active.key;
  const first = profiles.find((p) => p && p.key);
  if (first) return first.key;
  return settings.itadApiKey || '';
}

// v6.4.2：Steam 官方接口判定 100% OFF 类型——用户决策：
// appdetails（官方 API）为主：is_free 权威信号 F2P；price_overview 原价>0 现价 0
// = 喜加一入库（-100% 促销）；无原价免费 = 免费周末（Play Now 模式）。
// 商店页按钮复核（Play Now vs Add to Cart）——防免费周末误判为喜加一。
// Steam official judgment: is_free (F2P), price_overview initial>0 & final=0
// (limited claim), initial=0 free (weekend); store-page button double-check.
// v6.4.3：Steam 官方判定结果内存缓存（12h——通知去重，防重复 appdetails+商店页请求）
/** @type {Map<string, {type: string|null, ts: number}>} */
const steamTypeCache = new Map();
const STEAM_TYPE_CACHE_TTL = 12 * 3600e3;

export async function determineSteamFreeType(appId) {
  // 缓存命中（含 null 结果）→ 直接返回
  const hit = steamTypeCache.get(String(appId));
  if (hit && Date.now() - hit.ts < STEAM_TYPE_CACHE_TTL) return hit.type;
  try {
    const resp = await fetchWithTimeout(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&l=schinese&cc=cn&filters=basic,price_overview`
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const d = data && data[appId] && data[appId].data;
    if (!d) return null;
    // F2P 永久免费：官方 is_free 权威信号（Dota 2 等无价格区）
    if (d.is_free === true) {
      steamTypeCache.set(String(appId), { type: 'f2p', ts: Date.now() });
      return 'f2p';
    }
    const price = d.price_overview;
    if (!price) return 'f2p';
    // 促销免费（-100%）：原价 > 0 且现价 0 → 喜加一入库
    if ((price.initial || 0) > 0 && price.final === 0) {
      // 商店页按钮复核：Play Now（免费周末）会显示立即游玩而非加入购物车
      const type = await verifyStorePageButtons(appId);
      const t = type === 'weekend' ? 'weekend' : 'limited';
      steamTypeCache.set(String(appId), { type: t, ts: Date.now() });
      return t;
    }
    // 现价 0 但无原价：免费周末（Play Now 模式）或数据异常 → weekend 保守处理
    if (price.final === 0) {
      steamTypeCache.set(String(appId), { type: 'weekend', ts: Date.now() });
      return 'weekend';
    }
    const result = null; // 当前非免费（数据过期）
    steamTypeCache.set(String(appId), { type: result, ts: Date.now() });
    return result;
  } catch (e) {
    Logger.debug('FreeGames', 'Steam官方判定失败:', String(e));
    steamTypeCache.set(String(appId), { type: null, ts: Date.now() });
    return null;
  }
}

// 商店页按钮复核：Add to Cart（入库）vs Play Now（免费周末）
// Store-page button check: Add to Cart (claimable) vs Play Now (weekend)
async function verifyStorePageButtons(appId) {
  try {
    const resp = await fetchWithTimeout(`https://store.steampowered.com/app/${appId}/?l=schinese`, {
      headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' }
    });
    if (!resp.ok) return 'limited'; // 页面失败 → 保持 appdetails 判定（喜加一）
    const html = await resp.text();
    if (/立即游玩|play now/i.test(html)) return 'weekend';
    return 'limited';
  } catch (e) {
    Logger.debug('FreeGames', '商店页复核失败:', String(e));
    return 'limited';
  }
}

// v6.3.2 C2：新限免推送通知（聚合一条，防骚扰；通知权限在 manifest）
// Push notification for new free games (one aggregated notification)
async function notifyNewFreeGames(newOnes) {
  try {
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
    const names = newOnes
      .slice(0, 3)
      .map((g) => g.name)
      .join('、');
    chrome.notifications.create('gr-free-games', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `🎮 新增 ${newOnes.length} 款限免游戏`,
      message: names + (newOnes.length > 3 ? ` 等 ${newOnes.length} 款` : ''),
      priority: 1
    });
  } catch (e) {
    Logger.debug('FreeGames', '限免通知失败:', String(e));
  }
}

// 更新工具栏角标（当天新增数量）/ Update the toolbar badge (today's new count)
async function updateFreeGamesBadge() {
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

// 获取限免数据（供页面与消息使用）/ Get free-games data
export async function getFreeGamesData(force = false) {
  const freeData = await refreshFreeGames(force);
  Logger.info('FreeGames', `获取限免游戏`, { count: freeData.games ? freeData.games.length : 0 });
  return { data: freeData };
}
