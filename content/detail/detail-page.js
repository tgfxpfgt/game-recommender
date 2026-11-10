/**
 * 游戏雷达 Game Radar - 详情页模块入口 / Detail Page Module Entry
 *
 * 游戏名提取（去徽章/噪声分段）与详情页浮窗入口装配。
 * v14 B3：实现拆分至子模块（入口 API 不变——tracker/download-tracking 的
 * `detail.*` 调用面与 module-manifest 装载均不变）：
 *   sidebar.js     Steam 信息浮窗全生命周期（装载/纠错回调/渲染/按钮绑定/
 *                  Steam250/ITAD/收藏行/内嵌信息卡）
 *   candidates.js  手动选择浮窗（候选列表/搜索/键盘导航）
 *   tracking.js    下载站资源浮窗、下载历史浮窗、TRACK_EVENT 采集
 * Name extraction and the detail-page float entry. Implementations split
 * into sidebar/candidates/tracking since B3; the exported surface is
 * unchanged (tracker keeps calling detail.*).
 */
import * as sidebar from './sidebar.js';
// v14.26.0 P1-3：游戏名提取下沉 detect-name.js（下载追踪按需用到，避免把
// 整个详情域拖进列表页闭包）；此处 re-export 保持 detail.detectGameName 调用面。
export { detectGameName } from './detect-name.js';

// v14 B3：下载站资源浮窗与下载历史浮窗迁至 tracking.js——re-export 保持入口
// v14.22.0：steam250 游戏页入口一并 re-export（page-init 调用面 + 纯函数可测）
export {
  injectDownloadSitePanel,
  injectDownloadHistoryPanel,
  injectSteam250Panel,
  steam250AppIdFromUrl,
  steam250NameFromTitle
} from './tracking.js';

// ============ Steam详情浮窗入口 ============
// v14 B3：浮窗装载/渲染/按钮回调整体迁至 sidebar.js（createSteamFloat，
// 闭包状态 steamData/reportIssue 随编排迁移）——入口保留委托，调用面不变。
export function injectSteamButton(gameName, settings) {
  sidebar.createSteamFloat(gameName, settings);
}
