import { fetchWithTimeout } from '../core/utils.js';
import { Logger } from '../storage/logger.js';

/**
 * 游戏雷达 Game Radar - Steam API 子模块：api-supplement.js
 *
 * v5.0.0：由 steam/api.js 按职能拆分。
 * v6.2.1：SteamDB 网页抓取移除（fetchSteamDbInfo 仅产出展示链接且解析字段
 * 从未被消费——链接改模板拼接，官方 API 优先）；SteamSpy 保留（玩家人数/
 * 热度无官方替代，spy 模块 7 天缓存）。
 */

// --- SteamSpy 信息（玩家人数/热度补充数据） ---

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
    const ownersMatch =
      typeof data.owners === 'string' ? data.owners.replace(/,/g, '').match(/(\d+)\s*\.\.\s*(\d+)/) : null;
    return {
      positiveRate: total > 0 ? Math.round((data.positive / total) * 100) : null,
      reviewCount: total > 0 ? total.toLocaleString() : null,
      currentPlayers: data.ccu ? data.ccu.toLocaleString() : null,
      owners: data.owners || null,
      ownersLow: ownersMatch ? parseInt(ownersMatch[1], 10) : null,
      ownersHigh: ownersMatch ? parseInt(ownersMatch[2], 10) : null,
      averagePlaytime: avgMin ? Math.round(avgMin / 60) + '小时' : null,
      averageForeverMin: avgMin
    };
  } catch (e) {
    Logger.debug('Steam', 'SteamSpy获取失败:', String(e));
    return null;
  }
}

// --- 组装最终结果对象 ---
