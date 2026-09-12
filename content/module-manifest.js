/**
 * 游戏雷达 Game Radar - 内容模块清单（单源）/ Content Module Manifest
 *
 * v10.7.0 批次4：内容模块此前散落三处手工同步（tracker.js ensureModules 的
 * import 列表、test-content-sim 的 MODULE_FILES、integrity 校验），加一个
 * 模块漏一处即静默漂移。本清单是唯一事实源：
 *   - tracker.js 按清单装载（核心并行 + 可选按设置条件加载）
 *   - test-content-sim 的加载文件表由此派生
 *   - test-integrity 校验清单中每个文件真实存在
 * 新增内容模块 = 本清单一行 + 业务文件（可选模块另有 setting 键声明）。
 * Single source of truth for content modules; tracker loads from here, the
 * content-sim derives its file list, integrity checks existence.
 */

/** @type {Array<{key: string, file: string}>} */
export const CORE_MODULES = [
  { key: 'common', file: 'content/core/common.js' },
  { key: 'floats', file: 'content/core/floats.js' },
  { key: 'status', file: 'content/core/status-bar.js' },
  { key: 'debug', file: 'content/core/debug.js' },
  { key: 'builder', file: 'content/adapters/builder.js' },
  { key: 'badges', file: 'content/list/badges.js' },
  { key: 'listBatch', file: 'content/list/list-batch.js' },
  { key: 'list', file: 'content/list/list-page.js' },
  { key: 'listState', file: 'content/list/list-state.js' },
  { key: 'detailTemplates', file: 'content/detail/detail-templates.js' },
  { key: 'detail', file: 'content/detail/detail-page.js' },
  { key: 'tracking', file: 'content/tracking/download-tracking.js' }
];

// 可选模块：setting = 控制其加载的 DEFAULT_SETTINGS 开关键（false → 代码零加载）
/** @type {Array<{key: string, file: string, setting: string}>} */
export const OPTIONAL_MODULES = [
  { key: 'qrUnlock', file: 'content/detail/qr-unlock.js', setting: 'qrUnlockEnabled' },
  { key: 'xdgrid', file: 'content/list/xdgrid.js', setting: 'xdgridEnabled' }
];
