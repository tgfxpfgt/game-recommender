/**
 * 游戏雷达 Game Radar - 下载站列表布局定制（装配壳）/ Grid Customizer (shell)
 *
 * v10.2.0：XDGAME 专属（油猴脚本移植）。v10.4.0：**泛化为所有下载站**。
 * v14.3.0（第五轮 B2）：600 行按域拆分——布局引擎 xdgrid-layout.js（配置迁移/
 * 容器探测/样式计算/重试应用）、面板 UI xdgrid-panel.js（齿轮 + 双标签）；
 * 本文件保留 init 装配与既有导出兼容（computeContainerStyle/migrateLegacy/
 * commonAncestor 经 re-export 供 test-wiring 消费，调用面零改动）。
 * Site-agnostic grid customization shell: init wiring + re-exports.
 */
import * as common from '../core/common.js';
import * as debug from '../core/debug.js';
import * as builder from '../adapters/builder.js';
import { loadAllSettings, detectAndApply, normalizeCfg, DEFAULTS } from './xdgrid-layout.js';
import { buildUI } from './xdgrid-panel.js';

const dbg = (...a) => debug.dbg(...a);

// re-export（消费面兼容——test-wiring 等经 xdgrid.js 引用布局纯函数）
export { computeContainerStyle, migrateLegacy, commonAncestor } from './xdgrid-layout.js';

// 初始化（所有已追踪下载站；每站独立配置；幂等）/ init (all tracked sites)
// v10.4.0：settings.xdgridEnabled 为总开关（关闭 = 全站不激活）
export async function init(settings) {
  if (settings && settings.xdgridEnabled === false) return;
  const host = common.getCurrentDomain();
  const all = await loadAllSettings();
  const features = await builder.getSiteFeatures();
  const defaultEnabled = features.gridLayoutDefault === true || host.includes('xdgame.com'); // 兜底同上
  const cfg = normalizeCfg((all.sites && all.sites[host]) || { ...DEFAULTS, enabled: defaultEnabled });
  await detectAndApply(all, host);
  try {
    if (document.body) buildUI(all, host, cfg);
  } catch (e) {
    // 面板构建失败（测试模拟 DOM 的 innerHTML 不解析子节点等）→ 仅无 UI，
    // 布局应用不受影响
    dbg('列表布局面板构建失败（不影响布局应用）: ' + String(e));
  }
  dbg('列表布局定制模块已就绪（' + host + (cfg.enabled ? '，已启用）' : '，未启用）'));
}
