/**
 * 游戏雷达 Game Radar - 列表布局引擎 / Grid Layout Engine
 *
 * v10.2.0：XDGAME 专属（油猴脚本移植）。v10.4.0：**泛化为所有下载站**——
 * 经适配器提取当前列表项，计算最低公共祖先作为列表容器，施加 grid 布局。
 * v14.3.0（第五轮 B2）：由 xdgrid.js 拆分——布局引擎单域（配置迁移/容器探测/
 * 样式计算/重试应用）；面板 UI 在 xdgrid-panel.js，装配壳在 xdgrid.js。
 * Layout engine: config migration, container detection, style computation,
 * retry-apply. Panel UI lives in xdgrid-panel.js; shell in xdgrid.js.
 */
import * as common from '../core/common.js';
import * as debug from '../core/debug.js';
import * as builder from '../adapters/builder.js';

const dbg = (...a) => debug.dbg(...a);

export const STORE_KEY = 'xdgridSettings';
// 默认配置（iconW>0 固定图标宽、容器随列数加宽；iconW=0 自适应压缩；
// iconH=0 保持站点原始封面比例）
export const DEFAULTS = { enabled: false, cols: 5, iconW: 258, iconH: 0, gap: 18 };
// 站点容器左右内边距合计（xdgame .soft padding 18px × 2——框架宽度计算的
// 历史基线，其他站点按需微调）
const CONTAINER_PAD = 36;
// 列表项少于该值不做布局定制（详情页/内容过少页面无意义）
export const MIN_ITEMS = 3;

export function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// 整体容器宽度（固定图标宽模式）/ container width for fixed-icon-width mode
function computeFrameWidth(cfg) {
  const cols = clampInt(cfg.cols, 1, 20, DEFAULTS.cols);
  const iconW = clampInt(cfg.iconW, 0, 600, DEFAULTS.iconW);
  const gap = clampInt(cfg.gap, 0, 80, DEFAULTS.gap);
  if (iconW <= 0) return 0;
  return cols * iconW + (cols - 1) * gap + CONTAINER_PAD;
}

// 容器 grid 样式（纯函数，可单测）/ container grid style (pure, testable)
export function computeContainerStyle(cfg) {
  const cols = clampInt(cfg.cols, 1, 20, DEFAULTS.cols);
  const gap = clampInt(cfg.gap, 0, 80, DEFAULTS.gap);
  const iconW = clampInt(cfg.iconW, 0, 600, DEFAULTS.iconW);
  let css = 'display:grid;';
  if (iconW > 0) {
    css += `grid-template-columns:repeat(${cols}, ${iconW}px);`;
    // v10.5.1 任务2：固定宽模式下容器按列数定宽；站点把容器钉在左侧导致只向
    // 右扩展（右列溢出/被裁）。margin auto 水平居中 → 增列时向两侧对称扩展，
    // 每格图标完整可见。
    css += `width:${computeFrameWidth(cfg)}px;max-width:none;margin-left:auto;margin-right:auto;`;
  } else {
    css += `grid-template-columns:repeat(${cols}, minmax(0, 1fr));`;
  }
  css += `gap:${gap}px;`;
  return css;
}

// 旧配置迁移（纯函数，可单测）：v10.2.0 的扁平配置（仅 xdgame 使用）→
// v10.4.0 按站点映射（迁移站默认启用）；已是新形状则原样返回
// Legacy migration (pure): flat v10.2.0 config → per-site map, enabled.
export function migrateLegacy(stored, host) {
  if (!stored || typeof stored !== 'object') return { sites: {} };
  if (stored.sites && typeof stored.sites === 'object') return stored; // 已是新形状
  // 旧扁平形状：有 cols 等字段 → 归入当前站点并默认启用
  if (typeof stored.cols === 'number') {
    return { sites: { [host]: { ...DEFAULTS, enabled: true, ...stored } } };
  }
  return { sites: {} };
}

// 设置读写（按站点）/ per-site settings I/O
export async function loadAllSettings() {
  try {
    const data = await chrome.storage.local.get(STORE_KEY);
    return migrateLegacy(data && data[STORE_KEY], common.getCurrentDomain());
  } catch {
    return { sites: {} };
  }
}

export function saveAllSettings(all) {
  try {
    chrome.storage.local.set({ [STORE_KEY]: all }).catch(() => {});
  } catch {
    /* ignore */
  }
}

export function normalizeCfg(cfg) {
  return {
    enabled: (cfg && cfg.enabled) === true,
    cols: clampInt(cfg && cfg.cols, 1, 20, DEFAULTS.cols),
    iconW: clampInt(cfg && cfg.iconW, 0, 600, DEFAULTS.iconW),
    iconH: clampInt(cfg && cfg.iconH, 0, 500, DEFAULTS.iconH),
    gap: clampInt(cfg && cfg.gap, 0, 80, DEFAULTS.gap)
  };
}

/**
 * 最低公共祖先（纯 DOM 遍历，FakeEl 兼容——只走 parentNode 链）
 * Lowest common ancestor of elements (parentNode-walk; FakeEl-compatible).
 * @param {Array<any>} els
 * @returns {any|null}
 */
export function commonAncestor(els) {
  const valid = (els || []).filter((e) => e && e.parentNode !== undefined);
  if (valid.length === 0) return null;
  const chains = valid.map((el) => {
    const chain = [];
    let cur = el;
    while (cur) {
      chain.push(cur);
      cur = cur.parentNode;
    }
    return chain;
  });
  const [first, ...rest] = chains;
  for (const candidate of first) {
    if (rest.every((chain) => chain.includes(candidate))) return candidate;
  }
  return null;
}

// 应用布局：检测容器 + 施加 grid + 项内图片封面高度（返回应用到的容器）
// Apply layout: detect container, apply grid + per-item cover height caps.
export function applyLayout(cfg, items) {
  if (!cfg.enabled) return null;
  const list = (items || []).filter((it) => it && it.element);
  if (list.length < MIN_ITEMS) return null;
  const container = commonAncestor(list.map((it) => it.element));
  if (!container || container === document.body || container === document.documentElement) return null;
  container.style.cssText += ';' + computeContainerStyle(cfg);
  if (cfg.iconH > 0) {
    for (const it of list) {
      const imgs = it.element.querySelectorAll ? it.element.querySelectorAll('img') : [];
      for (const img of imgs) {
        img.style.maxHeight = cfg.iconH + 'px';
        img.style.objectFit = 'cover';
      }
    }
  }
  dbg(`列表布局定制已应用（${list.length} 项）`);
  return container;
}

// 检测列表容器并应用（重试适配 AJAX 延迟渲染）/ detect + apply with retries
// v10.7.0 批次4：默认启用改由 adapter 规则 features.gridLayoutDefault 声明
//（内置 xdgame 规则声明为 true）——不再写死 host 判断；自定义站经规则即可启用
export async function detectAndApply(all, host) {
  const features = await builder.getSiteFeatures();
  const defaultEnabled = features.gridLayoutDefault === true || host.includes('xdgame.com'); // host 判断兜底（规则加载失败时保底）
  const cfg = normalizeCfg((all.sites && all.sites[host]) || { ...DEFAULTS, enabled: defaultEnabled });
  if (!cfg.enabled) return null;
  const adapter = builder.getAdapter();
  const scan = () => {
    try {
      return adapter.getListItems();
    } catch {
      return [];
    }
  };
  let items = scan();
  let applied = null;
  if (items.length >= MIN_ITEMS) {
    applied = applyLayout(cfg, items);
  } else {
    // AJAX 延迟渲染重试（最多 10s；列表页主流程已有 4s 等待兜底）
    for (let i = 0; i < 10 && !applied; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      items = scan();
      if (items.length >= MIN_ITEMS) applied = applyLayout(cfg, items);
    }
  }
  return applied;
}
