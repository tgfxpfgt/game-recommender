import { fetchWithTimeout } from '../core/utils.js';
import { Logger } from '../storage/logger.js';

/**
 * Game Recommender - Steam API 子模块：api-supplement.js
 *
 * v5.0.0：由 steam/api.js 按职能拆分。
 */


// --- SteamDB 信息 ---

export async function fetchSteamDbInfo(appId) {
  const steamdbUrl = `https://steamdb.info/app/${appId}/`;
  try {
    const resp = await fetchWithTimeout(steamdbUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    });
    const html = await resp.text();
    const isBlocked = !resp.ok ||
      /Just a moment|cf-browser-verification|challenge-platform|Checking your browser|Attention Required/i.test(html);

    if (isBlocked) {
      return { url: steamdbUrl, available: false, blocked: true };
    }

    const ratingMatch = html.match(/<div[^>]*class="[^"]*header-rating[^"]*"[^>]*>\s*<span[^>]*>([\d.]+)%?<\/span>/i) ||
                        html.match(/([\d.]+)%\s*(?:positive|好评)/i);
    const playersMatch = html.match(/([\d,]+)\s*(?:players|人在玩)/i);
    const priceMatch = html.match(/Lowest Price[\s\S]*?([\d.,]+\s*(?:¥|\$|USD|CNY))/i);
    const reviewCountMatch = html.match(/([\d,]+)\s*(?:reviews|评测|评价)/i);

    return {
      url: steamdbUrl,
      rating: ratingMatch ? ratingMatch[1] : null,
      reviewCount: reviewCountMatch ? reviewCountMatch[1] : null,
      currentPlayers: playersMatch ? playersMatch[1] : null,
      lowestPrice: priceMatch ? priceMatch[1] : null,
      available: true,
      blocked: false
    };
  } catch (e) {
    Logger.debug('Steam', 'SteamDB获取失败:', e.message);
    return { url: steamdbUrl, available: false, blocked: true };
  }
}

// --- SteamSpy 信息（SteamDB 被拦截时的补充数据） ---

// v3.3.6：实测 SteamSpy 响应的可用字段为 positive/negative/ccu(当前在线)/
// owners(拥有者区间)/average_forever(平均游玩分钟)——原 players_2weeks/
// players_forever 字段并不存在，恒为 null，已改为 ccu/owners。
// Field fix: the real SteamSpy payload exposes positive/negative/ccu/owners/
// average_forever; the previously-read players_2weeks/players_forever never
// exist and were always null.


// --- SteamSpy 信息（SteamDB 被拦截时的补充数据） ---

// v3.3.6：实测 SteamSpy 响应的可用字段为 positive/negative/ccu(当前在线)/
// owners(拥有者区间)/average_forever(平均游玩分钟)——原 players_2weeks/
// players_forever 字段并不存在，恒为 null，已改为 ccu/owners。
// Field fix: the real SteamSpy payload exposes positive/negative/ccu/owners/
// average_forever; the previously-read players_2weeks/players_forever never
// exist and were always null.
export async function fetchSteamSpyInfo(appId) {
  try {
    const resp = await fetchWithTimeout(`https://steamspy.com/api.php?request=appdetails&appid=${appId}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data || !data.appid) return null;

    const total = (data.positive || 0) + (data.negative || 0);
    // v4.0.0：新增原始数值字段（averageForeverMin / ownersLow / ownersHigh），
    // 供推荐引擎时长/热度信号归一化——此前 average_forever 被转成"X小时"
    // 字符串、owners 区间串，原始数值全部丢失。嵌套对象整体入 spy 模块，
    // 无需缓存迁移，旧缓存 7 天 TTL 后自动刷新。
    // v4.0.0: raw numeric fields for engine signals (playtime/heat); the old
    // code collapsed average_forever into "X小时" and owners into a range
    // string, losing the numbers. Nested in the spy module, so no cache
    // migration; stale entries refresh after the 7-day TTL.
    const avgMin = typeof data.average_forever === 'number' ? data.average_forever : null;
    const ownersMatch = typeof data.owners === 'string'
      ? data.owners.replace(/,/g, '').match(/(\d+)\s*\.\.\s*(\d+)/) : null;
    return {
      positiveRate: total > 0 ? Math.round(data.positive / total * 100) : null,
      reviewCount: total > 0 ? total.toLocaleString() : null,
      currentPlayers: data.ccu ? data.ccu.toLocaleString() : null,
      owners: data.owners || null,
      ownersLow: ownersMatch ? parseInt(ownersMatch[1], 10) : null,
      ownersHigh: ownersMatch ? parseInt(ownersMatch[2], 10) : null,
      averagePlaytime: avgMin ? Math.round(avgMin / 60) + '小时' : null,
      averageForeverMin: avgMin
    };
  } catch (e) {
    Logger.debug('Steam', 'SteamSpy获取失败:', e.message);
    return null;
  }
}

// --- 组装最终结果对象 ---

