/**
 * 游戏雷达 Game Radar - 消息处理：设置 / Settings Handlers
 *
 * v14 B10：由 handlers.js 迁出——GET/SAVE/RESET_SETTINGS 与 xdgrid 过滤
 * 滑块的窄化持久化（SAVE_RATING_FILTER_CFG）。
 * Moved from handlers.js (B10): settings get/save/reset and the narrow
 * rating-filter persistence.
 */
import { DEFAULT_SETTINGS } from '../core/constants.js';
import { getSettings, saveSettings, saveRatingFilterCfg } from '../core/settings.js'; // v10.9：窄化过滤持久化

async function handleGetSettings() {
  return { settings: await getSettings() };
}

async function handleSaveSettings(message) {
  await saveSettings(message.settings);
  return { success: true };
}

async function handleResetSettings() {
  const settings = DEFAULT_SETTINGS;
  await saveSettings(settings);
  // v9.7.0：返回 settings 供 UI 立即重渲染——此前只回 {success} 而 UI 判
  // resp.settings，恒走失败分支；且失败分支不重渲染时旧 DOM 值会被下一次
  // saveSettings 整包覆盖回去
  return { success: true, settings };
}

// v14.1.0：返回默认值快照——设置页"每项恢复默认"微按钮的单源数据（与
// RESET_SETTINGS 不同：只取值不落盘，由页面合并后走常规保存）
async function handleGetDefaultSettings() {
  return { defaults: DEFAULT_SETTINGS };
}

// v14 B10：领域 handler 段（action → handler 单处声明，handlers.js 聚合展开）
export const settingsHandlers = {
  GET_SETTINGS: handleGetSettings,
  SAVE_SETTINGS: handleSaveSettings,
  RESET_SETTINGS: handleResetSettings,
  GET_DEFAULT_SETTINGS: handleGetDefaultSettings, // v14.1.0：单条恢复默认数据源
  SAVE_RATING_FILTER_CFG: (m) => saveRatingFilterCfg(m.enabled, m.minRating) // v10.9：xdgrid 过滤滑块
};
