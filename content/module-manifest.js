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
 * 边界语义（v14.2.0 消歧义）：本清单只登记**顶层装载单元**（tracker 动态 import 的入口）；
 * 被入口静态 import 的内部依赖模块（如 detail/sidebar.js、steam-rating-logic.js）无需登记。
 *
 * v14.26.0（优化方案 P1-3）：新增 `scope` 字段——`'all'` 恒装载；`'list'` 仅
 * 列表页/首页场景；`'detail'` 仅详情页/Steam 商店页场景。tracker 用 URL 粗判
 * （core/page-url.js）决定首屏装载集合，未装载的一侧在页面分发真正需要时
 * 由 `ensureScope()` 补加载（自愈兜底，判定失误不会导致功能缺失）。
 * Added `scope`: 'all' always loads; 'list' only on list/home pages; 'detail'
 * only on detail/Steam pages. The loader picks the first-screen set from a
 * coarse URL classification and lazily loads the other side on demand.
 */

/** @type {Array<{key: string, file: string, scope: 'all'|'list'|'detail'}>} */
export const CORE_MODULES = [
  { key: 'common', file: 'content/core/common.js', scope: 'all' },
  { key: 'floats', file: 'content/core/floats.js', scope: 'all' },
  { key: 'status', file: 'content/core/status-bar.js', scope: 'all' },
  { key: 'debug', file: 'content/core/debug.js', scope: 'all' },
  { key: 'messages', file: 'content/core/messages.js', scope: 'all' }, // v14.5.0 B7：入站消息路由域
  { key: 'pageInit', file: 'content/core/page-init.js', scope: 'all' }, // v14.5.0 B7：页面检测与功能分发域
  { key: 'builder', file: 'content/adapters/builder.js', scope: 'all' },
  { key: 'badges', file: 'content/list/badges/core.js', scope: 'list' }, // v14.5.0 B6：域拆分入口（working/rec/badge-base 同目录）
  { key: 'listBatch', file: 'content/list/list-batch.js', scope: 'list' },
  { key: 'list', file: 'content/list/list-page.js', scope: 'list' },
  { key: 'listState', file: 'content/list/list-state.js', scope: 'list' },
  { key: 'detailTemplates', file: 'content/detail/detail-templates.js', scope: 'detail' },
  { key: 'detail', file: 'content/detail/detail-page.js', scope: 'detail' },
  { key: 'tracking', file: 'content/tracking/download-tracking.js', scope: 'all' }
];

// 可选模块：setting = 控制其加载的 DEFAULT_SETTINGS 开关键（false → 代码零加载）
/** @type {Array<{key: string, file: string, setting: string, scope: 'all'|'list'|'detail'}>} */
export const OPTIONAL_MODULES = [
  { key: 'qrUnlock', file: 'content/detail/qr-unlock.js', setting: 'qrUnlockEnabled', scope: 'all' },
  { key: 'xdgrid', file: 'content/list/xdgrid.js', setting: 'xdgridEnabled', scope: 'list' }
];
