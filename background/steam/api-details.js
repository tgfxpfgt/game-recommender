import { recordSteamCall } from '../core/api-monitor.js';
import { fetchWithTimeout } from '../core/utils.js';
import { Logger } from '../storage/logger.js';
import { ADDON_NAME_PATTERN } from './api-search.js';

/**
 * 游戏雷达 Game Radar - Steam API 子模块：api-details.js
 *
 * v5.0.0：由 steam/api.js 按职能拆分。
 */

// 名称校验：中文名含中文、英文名含英文、不命中附属内容关键词
// Name validation for zero-review verification and registry writes
export function validateSteamNames(cnName, enName) {
  const cn = cnName || '';
  const en = enName || '';
  const issues = [];
  if (cn && !/[\u4e00-\u9fff]/.test(cn)) issues.push('中文名不含中文');
  if (en && !/[A-Za-z]{2,}/.test(en)) issues.push('英文名不含英文');
  if (ADDON_NAME_PATTERN.test(cn) || ADDON_NAME_PATTERN.test(en)) issues.push('疑似附属内容');
  return { valid: issues.length === 0, issues };
}

// 从 appdetails 数据解析"游戏本体" appId（v3.2.6+，v3.2.10 补 demo，v3.3.4 兼容真实字段）：
//   - type=game → 自身
//   - type=demo → 优先解析所属本体（demo 页面同样带 fullgame，如
//     "杀死影子 Demo" 2947640 → 2660230）；无 fullgame 的独立 Demo 保留自身
//   - type=dlc 且含 fullgame → 返回所属本体 appId（DLC 页面提供）
//   - 其他（bundle/mod/music/soundtrack/video/software/hardware 等非本体）→ null
// 注意：appdetails 响应的应用 ID 字段是 `steam_appid`（无 `appid`），
// 两者都兼容（测试/模拟数据可能用 appid）。
// Resolve the base-game appId from appdetails data: game stays; a demo resolves
// to its full game when fullgame exists (e.g. "杀死影子 Demo" 2947640 →
// 2660230), otherwise stays; a DLC with fullgame resolves to its base game;
// every other non-base type (bundle/mod/music/video/software/hardware...) → null.
// Note: the real appdetails payload names the app id `steam_appid` (there is no
// `appid` field); both are accepted (tests/mock data may use `appid`).

// 从 appdetails 数据解析"游戏本体" appId（v3.2.6+，v3.2.10 补 demo，v3.3.4 兼容真实字段）：
//   - type=game → 自身
//   - type=demo → 优先解析所属本体（demo 页面同样带 fullgame，如
//     "杀死影子 Demo" 2947640 → 2660230）；无 fullgame 的独立 Demo 保留自身
//   - type=dlc 且含 fullgame → 返回所属本体 appId（DLC 页面提供）
//   - 其他（bundle/mod/music/soundtrack/video/software/hardware 等非本体）→ null
// 注意：appdetails 响应的应用 ID 字段是 `steam_appid`（无 `appid`），
// 两者都兼容（测试/模拟数据可能用 appid）。
// Resolve the base-game appId from appdetails data: game stays; a demo resolves
// to its full game when fullgame exists (e.g. "杀死影子 Demo" 2947640 →
// 2660230), otherwise stays; a DLC with fullgame resolves to its base game;
// every other non-base type (bundle/mod/music/video/software/hardware...) → null.
// Note: the real appdetails payload names the app id `steam_appid` (there is no
// `appid` field); both are accepted (tests/mock data may use `appid`).
export function baseAppIdFromDetails(data) {
  if (!data || typeof data !== 'object') return null;
  const selfId = data.appid || data.steam_appid;
  if (data.type === 'game') {
    return selfId ? String(selfId) : null;
  }
  if (data.type === 'demo') {
    if (data.fullgame && data.fullgame.appid) return String(data.fullgame.appid);
    return selfId ? String(selfId) : null;
  }
  if (data.type === 'dlc' && data.fullgame && data.fullgame.appid) {
    return String(data.fullgame.appid);
  }
  return null;
}

// 缓存条目是否为"好评率获取失败固化"（positiveRate 与 ratingDesc 均为空）。
// 网络失败/限流时若把 null 写入缓存会固化"只显示 AppID"，命中时需重新获取。
// Is a cached entry a "failed-rating snapshot" (both positiveRate and ratingDesc
// empty)? Such entries must be re-fetched instead of served from cache.

// 封面图 URL：优先已有封面，否则按 appId 构造 Steam CDN header 图（纯函数，可单测）
// Cover URL: keep the provided cover, else build the Steam CDN header URL
export function coverImageFor(appId, fallback) {
  if (fallback && /^https?:\/\//i.test(fallback)) return fallback;
  if (appId) return `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
  return '';
}

// --- 搜索 ---

// 单次搜索实现（网络全挂时抛错供外层重试；无结果返回 null 表示"确实未找到"）
// 结果需通过名称相关性校验（防噪声词/删词变体误匹配无关游戏或续作）。
// One search pass (throws on total network failure for outer retry; null = not
// found). Results must pass the name-relevance check.

// --- 应用详情 ---

// 获取应用详情（language: schinese/english 等，name 随语言） / Fetch app details
export async function fetchSteamAppDetails(appId, language = 'schinese') {
  const detailUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=${language}`;
  try {
    const response = await fetchWithTimeout(detailUrl);
    const detailData = await response.json();
    recordSteamCall(true);
    if (!detailData[appId] || !detailData[appId].success) return null;
    return detailData[appId].data;
  } catch {
    recordSteamCall(false);
    return null;
  }
}

// --- 商店页面 HTML ---

// --- 商店页面 HTML ---

export async function fetchStorePageHtml(appId) {
  try {
    const storePageUrl = `https://store.steampowered.com/app/${appId}/?cc=cn&l=schinese`;
    const resp = await fetchWithTimeout(storePageUrl, { headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' } });
    return await resp.text();
  } catch (e) {
    Logger.debug('Steam', '获取商店页面失败:', String(e));
    return '';
  }
}

// --- 中文语言支持解析 ---

// --- 中文语言支持解析 ---

export function parseChineseLanguageSupport(storeHtml, gameData) {
  let chineseSupported = false;
  let simplifiedChinese = false;
  let chineseHasAudio = false;
  let chineseHasSubtitles = false;

  // 方法1：解析商店页语言支持表 (game_language_options)
  if (storeHtml) {
    const langTableMatch = storeHtml.match(/<table[^>]*class="[^"]*game_language_options[^"]*"[\s\S]*?<\/table>/i);
    if (langTableMatch) {
      const langTable = langTableMatch[0];
      const rows = langTable.match(/<tr[\s\S]*?<\/tr>/gi) || [];
      for (const row of rows) {
        const isSimplifiedRow = /简体中文|Chinese\s*\(Simplified\)/i.test(row);
        const isChineseRow = /中文|Chinese/i.test(row) && !/繁体|Traditional/i.test(row);
        if (isSimplifiedRow || isChineseRow) {
          const hasCheck = /✓|&#10003;|class="[^"]*check/i.test(row);
          const cells = row.match(/<td[\s\S]*?<\/td>/gi) || [];
          if (hasCheck || cells.some((c) => /✓|&#10003;|check/i.test(c))) {
            chineseSupported = true;
            if (isSimplifiedRow) simplifiedChinese = true;
            if (cells.length >= 3) {
              chineseHasAudio = /✓|&#10003;|check/i.test(cells[2] || '');
              chineseHasSubtitles = /✓|&#10003;|check/i.test(cells[3] || '');
            }
          }
        }
      }
    }
  }

  // 方法2：回退到 supported_languages 字段
  // v6.3.0：String() 防御——异常响应（对象/数组）下 replace 抛错会中断整个
  // 搜索链（官方字段优先原则：HTML 解析失败必须有兜底且兜底自身不得抛错）
  if (!chineseSupported) {
    const supportedLangs = String(gameData.supported_languages || '');
    const cleanLangs = supportedLangs.replace(/<[^>]+>/g, ' ');
    chineseSupported = /简体中文|繁体中文|Chinese|中文/i.test(cleanLangs);
    simplifiedChinese = /简体中文|Simplified\s*Chinese/i.test(cleanLangs);
  }

  return { chineseSupported, simplifiedChinese, chineseHasAudio, chineseHasSubtitles };
}

// --- 用户标签解析 ---

// 解析商店页用户标签；商店页被拦截/抓取失败时降级为官方分类
// （gameData.categories）兜底，避免"热门用户标签"区块整体消失（v3.3.9）。
// Parse store-page user tags; when the store HTML is unavailable fall back to
// the official categories so the tag section never disappears entirely.

// --- 用户标签解析 ---

// 解析商店页用户标签；商店页被拦截/抓取失败时降级为官方分类
// （gameData.categories）兜底，避免"热门用户标签"区块整体消失（v3.3.9）。
// Parse store-page user tags; when the store HTML is unavailable fall back to
// the official categories so the tag section never disappears entirely.
export function parseUserTags(storeHtml, gameData) {
  if (storeHtml) {
    const tagMatches = storeHtml.match(/<a[^>]*class="[^"]*app_tag[^"]*"[^>]*>[\s\S]*?<\/a>/gi);
    if (tagMatches && tagMatches.length > 0) {
      const seenTags = new Set();
      return tagMatches
        .map((m) =>
          m
            .replace(/<[^>]+>/g, '')
            .replace(/&[a-z]+;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        )
        .filter((t) => {
          if (t.length < 1 || t.length > 30) return false;
          const lower = t.toLowerCase();
          if (seenTags.has(lower)) return false;
          seenTags.add(lower);
          return true;
        })
        .slice(0, 10);
    }
  }
  // 降级：官方分类（Single-player/多人等）作为标签兜底 / fallback: official categories
  return gameData && Array.isArray(gameData.categories)
    ? gameData.categories
        .map((c) => c.description)
        .filter(Boolean)
        .slice(0, 10)
    : [];
}

// --- 评测获取 ---

// 近 30 天评测窗口（秒）/ 30-day recent-review window (seconds)
