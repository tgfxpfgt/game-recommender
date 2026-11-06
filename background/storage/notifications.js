// @ts-strict
/**
 * 游戏雷达 Game Radar - 站内通知中心存储 / Notification Center Storage
 *
 * v14.16.0（功能报告 N6）：chrome.notifications 即焚——用户错过即不可追溯
 *（"上周那个限免叫什么"无解）。本模块在通知构造单源（notifyBase）落库点
 * 记录环形 50 条 + 未读数，popup 通知中心面板消费。
 * Ring-buffer(50) notification history + unread count for the popup center.
 */
import { createSessionPersist } from '../core/session-persist.js';

const CAP = 50;
const NOTIF_INITIAL = { items: [], unread: 0 };
// initial 经 any 中转——createSessionPersist options 形参无 initial 泛型字段声明
const persist = createSessionPersist('grNotificationCenter', /** @type {any} */ (NOTIF_INITIAL));

/** @type {{items: Array<{id: string, title: string, message: string, ts: number}>, unread: number}|null} */
let memory = null;

async function load() {
  if (memory) return memory;
  memory = /** @type {{items: Array<{id: string, title: string, message: string, ts: number}>, unread: number}} */ (
    await persist.load()
  );
  return memory;
}

/**
 * 落库一条通知（环形 50；notifyBase 单源调用——system 通知照旧，站内可追溯）。
 * @param {string} title
 * @param {string} message
 * @returns {Promise<void>}
 */
export async function recordNotification(title, message) {
  const m = await load();
  // id 仅作列表键（非加密用途）——ts+索引确定性生成（Mimosa 弱随机提示响应）
  m.items.unshift({ id: 'n' + Date.now() + '-' + (m.items.length + 1), title, message, ts: Date.now() });
  while (m.items.length > CAP) m.items.pop();
  m.unread = (m.unread || 0) + 1;
  persist.scheduleSave(); // session-persist 工厂规范用法（peek+scheduleSave）
}

/** 全量读取（popup 通知中心段；含未读数）。 */
export async function getNotifications() {
  const m = await load();
  return { items: m.items, unread: m.unread || 0 };
}

/** 全部已读（popup 打开通知中心段时调用；角标随之清零）。 */
export async function markNotificationsRead() {
  const m = await load();
  m.unread = 0;
  persist.scheduleSave();
  return { success: true };
}
