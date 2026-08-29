/**
 * 游戏雷达 Game Radar - 下载站列表布局定制 / Download-Site Grid Customizer
 *
 * v10.2.0：XDGAME 专属（油猴脚本移植）。
 * v10.4.0：**泛化为所有下载站**——不再硬编码站点选择器，而是经适配器提取
 * 当前列表项（builder.getListItems），计算各项的最低公共祖先作为列表容器，
 * 对容器施加 grid 布局（每行图标数/图标宽度/卡片间距）并对项内图片施加
 * 封面高度。**按站点分别配置**（xdgame 迁移为默认启用；其他站默认关闭，
 * 点齿轮启用）；设置持久化 chrome.storage.local。
 * Site-agnostic grid customization: detects the list container as the lowest
 * common ancestor of adapter-extracted items; per-site config with a gear
 * panel; xdgame migrates as enabled-by-default, other sites opt-in.
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
const PANEL_ID = 'gr-xdgrid-panel';
const BTN_ID = 'gr-xdgrid-fab';
// 列表项少于该值不做布局定制（详情页/内容过少页面无意义）
const MIN_ITEMS = 3;

export function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// 整体容器宽度（固定图标宽模式）/ container width for fixed-icon-width mode
export function computeFrameWidth(cfg) {
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
    css += `width:${computeFrameWidth(cfg)}px;max-width:none;`;
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

function normalizeCfg(cfg) {
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
async function detectAndApply(all, host) {
  const cfg = normalizeCfg((all.sites && all.sites[host]) || { ...DEFAULTS, enabled: host.includes('xdgame.com') });
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

// ============ 设置面板（悬浮齿轮 + 面板，纯 DOM，无内联事件） ============
let uiBuilt = false;

function buildUI(all, host, cfg) {
  if (uiBuilt || document.getElementById(BTN_ID)) return;
  uiBuilt = true;

  const fab = document.createElement('div');
  fab.id = BTN_ID;
  fab.title = '列表布局设置（游戏雷达）';
  fab.textContent = '⚙';
  fab.style.cssText = [
    'position:fixed',
    'right:16px',
    'bottom:16px',
    'z-index:2147483600',
    'width:40px',
    'height:40px',
    'border-radius:50%',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'font-size:20px',
    'line-height:1',
    'cursor:pointer',
    'user-select:none',
    'background:rgba(50,54,60,.85)',
    'color:#fff',
    'box-shadow:0 2px 10px rgba(0,0,0,.35)',
    'transition:transform .15s, background .15s',
    'font-family:sans-serif'
  ].join(';');
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.style.cssText = [
    'position:fixed',
    'right:16px',
    'bottom:66px',
    'z-index:2147483600',
    'width:270px',
    'padding:14px',
    'border-radius:12px',
    'background:#fff',
    'color:#333',
    'box-shadow:0 6px 24px rgba(0,0,0,.18)',
    'font:12px/1.6 sans-serif',
    'display:none'
  ].join(';');
  panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <b style="font-size:13px">列表布局设置（本站）</b>
        <span data-xg="close" style="cursor:pointer;color:#999;padding:0 4px;font-size:14px">✕</span>
      </div>
      <label style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;cursor:pointer">
        <span>启用本站定制</span>
        <input data-xg="enabled" type="checkbox" ${cfg.enabled ? 'checked' : ''}
          style="width:16px;height:16px;cursor:pointer">
      </label>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span>每行图标数</span><b data-xg="colsVal">${cfg.cols}</b>
      </div>
      <input data-xg="cols" type="range" min="1" max="12" step="1" value="${cfg.cols}"
        style="width:100%;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span>图标宽度(px)</span>
        <input data-xg="iconW" type="number" min="0" max="600" step="2" value="${cfg.iconW}"
          style="width:64px;padding:2px 4px;border:1px solid #ddd;border-radius:4px">
      </div>
      <div data-xg="modeHint" style="color:#4a9eff;margin-bottom:8px">图标大小不变，容器随列数加宽</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span>封面高度(px)</span>
        <input data-xg="iconH" type="number" min="0" max="500" step="5" value="${cfg.iconH}"
          style="width:64px;padding:2px 4px;border:1px solid #ddd;border-radius:4px">
      </div>
      <div style="color:#999;margin-bottom:8px">0 = 保持站点原始比例</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span>卡片间距(px)</span><b data-xg="gapVal">${cfg.gap}</b>
      </div>
      <input data-xg="gap" type="range" min="0" max="40" step="1" value="${cfg.gap}"
        style="width:100%;margin-bottom:8px">
      <button data-xg="reset"
        style="width:100%;padding:6px 0;border:none;border-radius:6px;cursor:pointer;
        background:#f0f2f5;color:#666">恢复默认（本站）</button>
    `;
  document.body.appendChild(panel);

  const $ = (name) => panel.querySelector(`[data-xg="${name}"]`);

  const syncHint = () => {
    const w = parseInt($('iconW').value, 10) || 0;
    $('modeHint').textContent = w > 0 ? '图标大小不变，容器随列数加宽' : '自适应压缩：图标变小，容器不变';
  };

  const refresh = () => {
    // 面板改动后重检测容器并应用（项数随滚动变化的站点）
    const items = (() => {
      try {
        return builder.getAdapter().getListItems();
      } catch {
        return [];
      }
    })();
    applyLayout(all.sites[host], items);
  };

  const update = () => {
    cfg.enabled = $('enabled').checked;
    cfg.cols = parseInt($('cols').value, 10);
    cfg.iconW = Math.max(0, parseInt($('iconW').value, 10) || 0);
    cfg.iconH = Math.max(0, parseInt($('iconH').value, 10) || 0);
    cfg.gap = parseInt($('gap').value, 10);
    $('colsVal').textContent = cfg.cols;
    $('gapVal').textContent = cfg.gap;
    syncHint();
    all.sites[host] = normalizeCfg(cfg);
    saveAllSettings(all);
    refresh();
  };

  ['cols', 'gap', 'iconW', 'iconH', 'enabled'].forEach((k) => $(k).addEventListener('input', update));
  $('close').addEventListener('click', () => {
    panel.style.display = 'none';
  });
  fab.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });
  $('reset').addEventListener('click', () => {
    cfg.enabled = DEFAULTS.enabled;
    cfg.cols = DEFAULTS.cols;
    cfg.iconW = DEFAULTS.iconW;
    cfg.iconH = DEFAULTS.iconH;
    cfg.gap = DEFAULTS.gap;
    $('enabled').checked = cfg.enabled;
    $('cols').value = cfg.cols;
    $('iconW').value = cfg.iconW;
    $('iconH').value = cfg.iconH;
    $('gap').value = cfg.gap;
    update();
  });
  syncHint();
}

// 初始化（所有已追踪下载站；每站独立配置；幂等）/ init (all tracked sites)
// v10.4.0：settings.xdgridEnabled 为总开关（关闭 = 全站不激活）
export async function init(settings) {
  if (settings && settings.xdgridEnabled === false) return;
  const host = common.getCurrentDomain();
  const all = await loadAllSettings();
  const cfg = normalizeCfg((all.sites && all.sites[host]) || { ...DEFAULTS, enabled: host.includes('xdgame.com') });
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
