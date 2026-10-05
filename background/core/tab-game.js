// @ts-strict
/**
 * 游戏雷达 Game Radar - 当前标签页游戏快照 / Per-Tab Game Snapshot
 *
 * v14.1.0（第二轮 B9 补完）：SEARCH_STEAM / GET_STEAM_BY_APPID 成功解析时记录
 * {tabId → 游戏}，SidePanel 据此随当前 tab 联动显示对应游戏信息（无 tab 上下文
 * 的列表页批量检索不记录）。session 持久化——SW 冷启动不丢，浏览器重启自然清空。
 * Per-tab game snapshot: recorded on successful resolution so the SidePanel can
 * mirror the active tab's game. Session-scoped (survives SW restarts, cleared
 * with the browser session).
 */
import { createSessionPersist } from './session-persist.js';
import { STORAGE_CAPS } from './constants.js';

const MAX_TAB_ENTRIES = STORAGE_CAPS.tabGames; // v14.2.0：容量入单源（原裸字面量 24）
const persist = createSessionPersist('grTabGames', { initial: {} });

export async function warmupTabGames() {
  await persist.load();
}

/**
 * 记录一次解析成功（tabId 无效或数据不全时忽略）
 * @param {number|undefined} tabId
 * @param {{appId?: string|number, name?: string, positiveRate?: number|null, headerImage?: string, url?: string}} game
 */
export function noteTabGame(tabId, game) {
  if (typeof tabId !== 'number' || !Number.isInteger(tabId) || tabId < 0 || !game || !game.appId) return;
  const all = persist.peek();
  all[String(tabId)] = {
    // 截断长度：appId 12（数字 appId ≤10 位留余量）、URL 类 500（Steam 头图
    // 常规 ~120 字符，500 防异常长参注入）、名称 200（对齐 TOGGLE_FAVORITE 契约）
    appId: String(game.appId).slice(0, 12),
    name: String(game.name || '').slice(0, 200),
    positiveRate: Number.isFinite(game.positiveRate) ? game.positiveRate : null,
    headerImage: String(game.headerImage || '').slice(0, 500),
    url: String(game.url || '').slice(0, 500),
    at: Date.now()
  };
  // 容量上限：按时间淘汰最旧（防会话级存储无界增长）
  // Capacity cap: evict oldest entries by time.
  const keys = Object.keys(all);
  if (keys.length > MAX_TAB_ENTRIES) {
    keys
      .sort((a, b) => (all[a].at || 0) - (all[b].at || 0))
      .slice(0, keys.length - MAX_TAB_ENTRIES)
      .forEach((k) => delete all[k]);
  }
  persist.scheduleSave();
}

/**
 * 读取某标签页最近解析的游戏
 * @param {number|undefined} tabId
 * @returns {{appId: string, name: string, positiveRate: number|null, headerImage: string, url: string, at: number}|null}
 */
export function getTabGame(tabId) {
  if (typeof tabId !== 'number' || !Number.isInteger(tabId) || tabId < 0) return null;
  return persist.peek()[String(tabId)] || null;
}
