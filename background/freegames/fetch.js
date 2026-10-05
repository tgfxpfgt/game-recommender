/**
 * 游戏雷达 Game Radar - 限免抓取域 / Free-Games Fetch Domain
 *
 * v14.2.0（主报告 P2-1）：manager.js 三域拆分——本文件承载各源抓取
 * （Epic/GOG/Steam/GamerPower）、免费类型分类纯函数与 Steam 官方判定。
 * 纯函数导出供单测；被 manager（编排）与 notify（Steam 候选复核）消费。
 * Per-source fetchers, classification pure functions and official Steam
 * type judgment; consumed by manager (orchestration) and notify.
 */
import { ENDPOINTS } from '../core/constants.js';
import { fetchWithTimeout } from '../core/utils.js';
import { createTtlCache } from '../core/mechanisms.js';
import { Logger } from '../storage/logger.js';

export const ONE_DAY = 24 * 3600 * 1000;

// v3.4.1：外链协议白名单——第三方 API 的链接/图片只允许 http(s)
// （防止 javascript: 等伪协议注入弹出页 href/src）
// Protocol whitelist for giveaway links/images (http(s) only, blocks javascript:)
const SAFE_URL_RE = /^https?:\/\//i;
/** @param {string} url */
function sanitizeGameUrl(url) {
  return typeof url === 'string' && SAFE_URL_RE.test(url) ? url : '';
}

async function fetchEpicFreeGames() {
  const games = [];
  try {
    const url = ENDPOINTS.epicPromotions;
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
        url: `${ENDPOINTS.epicStore}${el.productSlug || el.urlSlug}`,
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
    const resp = await fetchWithTimeout(ENDPOINTS.gogFreeApi, {
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
        url: `${ENDPOINTS.gogStore}${p.url}`,
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
    const resp = await fetchWithTimeout(`${ENDPOINTS.steamFeatured}?l=schinese&cc=cn`);
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
          url: `${ENDPOINTS.steamStoreApp}${item.id}/`,
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
/** @param {{title?: string, instructions?: string}} item */
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
/** @param {{title?: string, description?: string, instructions?: string}} item */
export function classifyFreeType(item, hasEndDate = true) {
  const text = ((item.title || '') + ' ' + (item.description || '') + ' ' + (item.instructions || '')).toLowerCase();
  // 免费周末：标题/描述明确（Steam Free Weekend）
  if (/free weekend|免费周末|freeplay weekend|周末免费/i.test(text)) return 'weekend';
  // 垃圾 key 活动（第三方领取）→ 过滤（不收录不推送）
  if (classifyGamerPowerGiveaway(item) === 'thirdparty') return 'key';
  // 永久免费：无结束时间 + 明确 F2P 特征
  if (!hasEndDate && /free to play|永久免费|f2p|免费畅玩|免费游玩/i.test(text)) return 'f2p';
  return 'limited';
}

// v4.2.0：导出供单测（纯函数）
/** @param {{instructions?: string}} item */
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
    const resp = await fetchWithTimeout(ENDPOINTS.gamerPower);
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

export async function fetchAllFreeGames() {
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

/** @param {string} name */
function normalizeGameName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/giveaway|free|限免|领取/gi, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
    .trim();
}

// v6.4.2：Steam 官方接口判定 100% OFF 类型——用户决策：
// appdetails（官方 API）为主：is_free 权威信号 F2P；price_overview 原价>0 现价 0
// = 喜加一入库（-100% 促销）；无原价免费 = 免费周末（Play Now 模式）。
// 商店页按钮复核（Play Now vs Add to Cart）——防免费周末误判为喜加一。
// Steam official judgment: is_free (F2P), price_overview initial>0 & final=0
// (limited claim), initial=0 free (weekend); store-page button double-check.
// v6.4.3：Steam 官方判定结果内存缓存（12h——通知去重，防重复 appdetails+商店页请求）
// v10.7.0：TTL 缓存收敛至 core/mechanisms.js 工厂（值可为 null = 负缓存）
// v14.2.0：补 max（复审轮 P2-4——无界缓存 SW 长驻无保障）
const steamTypeCache = createTtlCache({ ttlMs: 12 * 3600e3, max: 500 });

export async function determineSteamFreeType(appId) {
  // 缓存命中（含 null 结果）→ 直接返回
  const hit = steamTypeCache.peek(String(appId));
  if (hit !== undefined) return hit;
  try {
    const resp = await fetchWithTimeout(
      `${ENDPOINTS.steamAppDetails}?appids=${appId}&l=schinese&cc=cn&filters=basic,price_overview`
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const d = data && data[appId] && data[appId].data;
    if (!d) return null;
    // F2P 永久免费：官方 is_free 权威信号（Dota 2 等无价格区）
    if (d.is_free === true) {
      steamTypeCache.set(String(appId), 'f2p');
      return 'f2p';
    }
    const price = d.price_overview;
    if (!price) return 'f2p';
    // 促销免费（-100%）：原价 > 0 且现价 0 → 喜加一入库
    if ((price.initial || 0) > 0 && price.final === 0) {
      // 商店页按钮复核：Play Now（免费周末）会显示立即游玩而非加入购物车
      const type = await verifyStorePageButtons(appId);
      const t = type === 'weekend' ? 'weekend' : 'limited';
      steamTypeCache.set(String(appId), t);
      return t;
    }
    // 现价 0 但无原价：免费周末（Play Now 模式）或数据异常 → weekend 保守处理
    if (price.final === 0) {
      steamTypeCache.set(String(appId), 'weekend');
      return 'weekend';
    }
    const result = null; // 当前非免费（数据过期）
    steamTypeCache.set(String(appId), result);
    return result;
  } catch (e) {
    Logger.debug('FreeGames', 'Steam官方判定失败:', String(e));
    steamTypeCache.set(String(appId), null);
    return null;
  }
}

// 商店页按钮复核：Add to Cart（入库）vs Play Now（免费周末）
// Store-page button check: Add to Cart (claimable) vs Play Now (weekend)
async function verifyStorePageButtons(appId) {
  try {
    const resp = await fetchWithTimeout(`${ENDPOINTS.steamStoreApp}${appId}/?l=schinese`, {
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
