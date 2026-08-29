/**
 * 游戏雷达 Game Radar - XDGAME 列表布局自定义 / XDGAME Grid Customizer
 *
 * v10.2.0（用户需求）：把独立油猴脚本（XDGAME 列表布局自定义 v1.1.0）移植
 * 进扩展——自定义 xdgame.com 列表页每行图标数、图标宽度、图标高度、卡片间距；
 * 默认模式图标大小不变、整体框架随列数自动放大；iconW=0 为自适应压缩模式；
 * iconH=0 保持站点原始封面比例 (92:43)。设置持久化 chrome.storage.local。
 * 悬浮齿轮按钮 + 设置面板（纯 DOM，无内联事件处理器——CSP 约定）。
 * Port of the standalone userscript: per-row icon count / icon width / icon
 * height / gap for xdgame.com list pages, with a floating gear + panel UI.
 */
import * as common from '../core/common.js';
import * as debug from '../core/debug.js';

const dbg = (...a) => debug.dbg(...a);

export const STORE_KEY = 'xdgridSettings';
// iconW > 0：图标宽度固定（默认 258 ≈ 站点原始尺寸），整体框架随列数放大
// iconW = 0：自适应压缩模式（图标缩小挤进原 1400px 框架）
// iconH = 0：封面高度保持站点原始比例 (92:43)
export const DEFAULTS = { cols: 5, iconW: 258, iconH: 0, gap: 18 };
// 站点容器左右内边距合计（.soft 元素 padding 18px × 2）
const CONTAINER_PAD = 36;

const STYLE_ID = 'gr-xdgrid-style';
const PANEL_ID = 'gr-xdgrid-panel';
const BTN_ID = 'gr-xdgrid-fab';

export function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// 整体框架宽度（图标固定宽度模式）/ frame width for fixed-icon-width mode
export function computeFrameWidth(cfg) {
  const cols = clampInt(cfg.cols, 1, 20, DEFAULTS.cols);
  const iconW = clampInt(cfg.iconW, 0, 600, DEFAULTS.iconW);
  const gap = clampInt(cfg.gap, 0, 80, DEFAULTS.gap);
  if (iconW <= 0) return 0;
  return cols * iconW + (cols - 1) * gap + CONTAINER_PAD;
}

// 生成站点覆盖 CSS（纯函数，可单测）/ build the site-override CSS (pure)
export function buildCss(cfg) {
  const cols = clampInt(cfg.cols, 1, 20, DEFAULTS.cols);
  const gap = clampInt(cfg.gap, 0, 80, DEFAULTS.gap);
  const iconW = clampInt(cfg.iconW, 0, 600, DEFAULTS.iconW);
  const iconH = clampInt(cfg.iconH, 0, 500, DEFAULTS.iconH);

  let css = '';
  if (iconW > 0) {
    // 模式一：图标大小不变，整体框架放大（只放大顶层 .container，内嵌容器保持原样）
    css += `
.container:not(.container .container) { width: ${computeFrameWidth(cfg)}px !important; }
.soft-list-page .soft.list ul.game-list.view-grid {
  grid-template-columns: repeat(${cols}, ${iconW}px) !important;
  gap: ${gap}px !important;
}`;
  } else {
    // 模式二：自适应压缩（图标变小，框架不变）
    css += `
.soft-list-page .soft.list ul.game-list.view-grid {
  grid-template-columns: repeat(${cols}, minmax(0, 1fr)) !important;
  gap: ${gap}px !important;
}`;
  }
  // 图标高度 > 0 时固定高度；= 0 时保持站点原始比例 (92/43)
  if (iconH > 0) {
    css += `
.soft-list-page .soft.list ul.game-list.view-grid > li .grid-cover {
  aspect-ratio: auto !important;
  height: ${iconH}px !important;
}
.soft-list-page .soft.list ul.game-list.view-grid > li .grid-cover img {
  height: 100% !important;
  object-fit: cover !important;
}`;
  }
  return css;
}

// 应用样式（幂等 style 元素）/ apply styles (idempotent style element)
export function applyStyle(cfg) {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = buildCss(cfg);
}

// 设置读写（chrome.storage.local，缺失字段回退默认）/ settings I/O
export async function loadSettings() {
  try {
    const data = await chrome.storage.local.get(STORE_KEY);
    const saved = data && data[STORE_KEY];
    return Object.assign({}, DEFAULTS, saved && typeof saved === 'object' ? saved : {});
  } catch {
    return Object.assign({}, DEFAULTS);
  }
}

export function saveSettings(cfg) {
  try {
    chrome.storage.local.set({ [STORE_KEY]: cfg }).catch(() => {});
  } catch {
    /* ignore */
  }
}

// ============ 设置面板（悬浮齿轮 + 面板，纯 DOM） ============
let uiBuilt = false;

function buildUI(cfg, onChange) {
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
  fab.addEventListener('mouseenter', () => {
    fab.style.background = 'rgba(80,140,255,.95)';
    fab.style.transform = 'scale(1.08)';
  });
  fab.addEventListener('mouseleave', () => {
    fab.style.background = 'rgba(50,54,60,.85)';
    fab.style.transform = 'scale(1)';
  });
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.style.cssText = [
    'position:fixed',
    'right:16px',
    'bottom:66px',
    'z-index:2147483600',
    'width:250px',
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
        <b style="font-size:13px">列表布局设置</b>
        <span data-xg="close" style="cursor:pointer;color:#999;padding:0 4px;font-size:14px">✕</span>
      </div>
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
      <div data-xg="modeHint" style="color:#4a9eff;margin-bottom:8px">图标大小不变，框架自动放大</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span>图标高度(px)</span>
        <input data-xg="iconH" type="number" min="0" max="500" step="5" value="${cfg.iconH}"
          style="width:64px;padding:2px 4px;border:1px solid #ddd;border-radius:4px">
      </div>
      <div style="color:#999;margin-bottom:8px">0 = 保持原始比例</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span>卡片间距(px)</span><b data-xg="gapVal">${cfg.gap}</b>
      </div>
      <input data-xg="gap" type="range" min="0" max="40" step="1" value="${cfg.gap}"
        style="width:100%;margin-bottom:8px">
      <div data-xg="frameInfo" style="color:#999;margin-bottom:10px"></div>
      <button data-xg="reset"
        style="width:100%;padding:6px 0;border:none;border-radius:6px;cursor:pointer;
        background:#f0f2f5;color:#666">恢复默认</button>
    `;
  document.body.appendChild(panel);

  const $ = (name) => panel.querySelector(`[data-xg="${name}"]`);

  const syncHint = () => {
    const w = parseInt($('iconW').value, 10) || 0;
    $('modeHint').textContent = w > 0 ? '图标大小不变，框架自动放大' : '自适应压缩：图标变小，框架不变';
    $('frameInfo').textContent = w > 0 ? `当前整体框架宽度：${computeFrameWidth(cfg)}px` : '';
  };

  const update = () => {
    cfg.cols = parseInt($('cols').value, 10);
    cfg.iconW = Math.max(0, parseInt($('iconW').value, 10) || 0);
    cfg.iconH = Math.max(0, parseInt($('iconH').value, 10) || 0);
    cfg.gap = parseInt($('gap').value, 10);
    $('colsVal').textContent = cfg.cols;
    $('gapVal').textContent = cfg.gap;
    syncHint();
    applyStyle(cfg);
    saveSettings(cfg);
    onChange && onChange(cfg);
  };

  $('cols').addEventListener('input', update);
  $('gap').addEventListener('input', update);
  $('iconW').addEventListener('input', update);
  $('iconH').addEventListener('input', update);
  $('close').addEventListener('click', () => {
    panel.style.display = 'none';
  });
  fab.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });
  $('reset').addEventListener('click', () => {
    cfg.cols = DEFAULTS.cols;
    cfg.iconW = DEFAULTS.iconW;
    cfg.iconH = DEFAULTS.iconH;
    cfg.gap = DEFAULTS.gap;
    $('cols').value = cfg.cols;
    $('iconW').value = cfg.iconW;
    $('iconH').value = cfg.iconH;
    $('gap').value = cfg.gap;
    update();
  });
  syncHint();
}

// 初始化（仅 xdgame.com 生效；幂等；v10.3.0 支持独立开关）/ init
export async function init(settings) {
  const domain = common.getCurrentDomain();
  if (!domain.includes('xdgame.com')) return; // 站点守卫 / site guard
  // v10.3.0：独立开关（settings.xdgridEnabled，默认开）——关闭早退，
  // 不应用样式、不注入面板（已开页面刷新后生效）
  if (settings && settings.xdgridEnabled === false) return;
  try {
    const cfg = await loadSettings();
    applyStyle(cfg);
    if (document.body) buildUI(cfg);
    else document.addEventListener('DOMContentLoaded', () => buildUI(cfg), { once: true });
    dbg('XDGAME 列表布局自定义已激活');
  } catch (e) {
    dbg('XDGAME 布局自定义初始化失败: ' + String(e));
  }
}
