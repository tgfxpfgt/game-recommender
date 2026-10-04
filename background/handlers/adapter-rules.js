/**
 * 游戏雷达 Game Radar - 消息处理：适配器规则 / Adapter-Rules Handlers
 *
 * v14 B10：由 handlers.js 迁出——规则读取/保存/删除（保存与删除后同步
 * 自定义站点内容脚本注册）。
 * Moved from handlers.js (B10): adapter rules read/save/delete with
 * site-scripts sync on change.
 */
import { saveAdapterRules, deleteAdapterRules, getAllRules } from '../core/rules.js';
import { syncSiteScripts } from '../core/site-scripts.js';

async function handleGetAdapterRules() {
  return { rules: await getAllRules() };
}

async function handleSaveAdapterRules(message) {
  const result = await saveAdapterRules(message.rules);
  // v7.4.0：规则变化后同步自定义站点内容脚本注册（新增站点立即生效，
  // 无需等下一次 SW 启动）
  if (result.ok) syncSiteScripts().catch(() => {});
  return result;
}

async function handleDeleteAdapterRules() {
  await deleteAdapterRules();
  // 规则删除后自定义站点脚本残留注册无碍（tracker 按规则早退兜底）——
  // 不注销，保持幂等简单；仍同步以补注册其他新站点
  syncSiteScripts().catch(() => {});
  // v9.7.0：补 ok 字段——UI（panels/rules.js）判 resp.ok，此前恒 undefined
  // 导致"恢复内置规则"成功后无任何反馈
  return { ok: true, success: true };
}

// v14 B10：领域 handler 段（action → handler 单处声明，handlers.js 聚合展开）
export const adapterRulesHandlers = {
  GET_ADAPTER_RULES: handleGetAdapterRules,
  SAVE_ADAPTER_RULES: handleSaveAdapterRules,
  DELETE_ADAPTER_RULES: handleDeleteAdapterRules
};
