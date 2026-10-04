/**
 * 游戏雷达 Game Radar - 消息处理：运行日志 / Runtime-Log Handlers
 *
 * v14 B10：由 handlers.js 迁出——运行日志读取/清空/导出。
 * Moved from handlers.js (B10): runtime log read/clear/export.
 */
import { getRuntimeLogs, clearRuntimeLogs } from '../storage/logger.js';

// v14 B10：领域 handler 段（action → handler 单处声明，handlers.js 聚合展开）
export const logsHandlers = {
  GET_RUNTIME_LOGS: async (msg) => ({ logs: await getRuntimeLogs(msg.limit) }),
  CLEAR_RUNTIME_LOGS: async () => {
    await clearRuntimeLogs();
    return { success: true };
  },
  EXPORT_LOGS: async () => ({ logs: await getRuntimeLogs() })
};
