/**
 * 游戏雷达 Game Radar - 功能使用统计（模块分级数据源）/ Feature Usage Meter
 *
 * v14.40.0（用户指令 3 扩展）：模块分级台账 docs/module-tiers.md 的**自动
 * 统计数据源**——埋点在 track-event 管线（全部 TRACK_EVENT type 过 meter）+
 * 关键页面/后台入口（启动/设置打开/备份/导入导出），计数进 core/metrics.js
 * 会话持久化计数器（键 = usage.<feature>，有界由 metricInc 保证）。
 *
 * 分级更新流：usage 计数（会话持久）→ `node scripts/gen-module-tiers.mjs`
 * 读 GET_RUNTIME_METRICS 快照（或 e2e-probe dump）→ 与 docs/module-tiers.md
 * 现表对比 → 输出建议调级（**只建议不自动改表**——T 级投入变化是人工决策，
 * CHANGELOG 纪律要求可追溯）。计数上限（MAX_COUNTER_KEYS 64）内键数固定 ~20，
 * 不会挤掉其他指标。
 *
 * Feature-usage meters feed the module-tiers ledger: track-event pipeline
 * meters every TRACK_EVENT type; the tiers script reads metrics snapshots and
 * *suggests* tier changes (tier moves stay a human decision).
 */

// 特性 → 计数键（稳定命名，分级脚本按前缀聚合；勿重命名——跨版本统计连续性）
export const USAGE_KEYS = {
  viewList: 'usage.view_list',
  viewDetail: 'usage.view_detail',
  clickDetail: 'usage.click_detail',
  clickDownload: 'usage.click_download',
  steamTagsUpdate: 'usage.steam_tags_update',
  dislikeGame: 'usage.dislike_game',
  pagePopup: 'usage.page_popup',
  pageOptions: 'usage.page_options',
  pageDashboard: 'usage.page_dashboard',
  pageFreegames: 'usage.page_freegames',
  pageSidepanel: 'usage.page_sidepanel',
  pageWelcome: 'usage.page_welcome',
  pageHub: 'usage.page_hub',
  backupCreate: 'usage.backup_create',
  backupRestore: 'usage.backup_restore',
  dataExport: 'usage.data_export',
  dataImport: 'usage.data_import',
  qrUnlock: 'usage.qr_unlock',
  xdgridOpen: 'usage.xdgrid_open',
  steamPagePanel: 'usage.steam_page_panel'
};

import { metricInc } from './metrics.js';

/** @param {string} key */
export function meterUsage(key) {
  metricInc(key);
}

// TRACK_EVENT type → usage key（白名单外的 type 不计）
/** @param {string} type */
export function meterTrackType(type) {
  /** @type {Record<string, string>} */
  const map = {
    view_list: USAGE_KEYS.viewList,
    view_detail: USAGE_KEYS.viewDetail,
    click_detail: USAGE_KEYS.clickDetail,
    click_download: USAGE_KEYS.clickDownload,
    steam_tags_update: USAGE_KEYS.steamTagsUpdate,
    dislike_game: USAGE_KEYS.dislikeGame
  };
  const key = map[String(type || '')];
  if (key) metricInc(key);
}
