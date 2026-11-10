/**
 * 游戏雷达 Game Radar - 统一浮窗管理器 / Unified Float Manager
 *
 * v3.1.0：所有扩展浮窗（状态栏/诊断、Steam 信息、下载站资源、下载历史）
 * 统一经 GR.float 创建与管理：分区定位（右上/右下/左下）、同区纵向堆叠防重叠、
 * 统一折叠/关闭、可整体收起。各浮窗的内容渲染逻辑保持独立。
 * v8.1.0：样式类化（.gr-float 系列，styles/content.css）——结构由 JS 生成、
 * 视觉统一走 CSS；支持 data-theme 主题跟随（applyTheme）。
 * v14.23.0（用户需求三连）：① 折叠按钮升级为 ⚙ 下拉菜单（折叠/缩放/重置 +
 * 可选缓存信息区，opts.menuInfo 注入）；② 右缘拖拽调宽（grFloatWidth 持久化）；
 * ③ 修复 v10.6.0 引入的折叠回归——切换条件把"当前状态"当"目标状态"传入，
 * 折叠按钮自那时起恒无操作（真机复现实证）。位置记忆（v11.0）恢复时补视口钳位。
 * All extension floats are created through GR.float: zoned placement, vertical
 * stacking, unified chrome. v14.23.0: fold button becomes a dropdown menu
 * (fold/zoom/reset + optional cache-info rows), right-edge drag-to-resize with
 * persistence, and a regression fix for the fold toggle (dead since v10.6.0);
 * position restore now clamps to the current viewport.
 */
// 浮窗区域 / Float zones
export const ZONE = {
  TOP_RIGHT: 'top-right', // 右上：Steam 信息等主浮窗 / main info floats
  TOP_LEFT: 'top-left', // 左上：Steam 信息浮窗（v6.4.4 起详情页默认左侧）/ left main floats
  BOTTOM_RIGHT: 'bottom-right', // 右下：状态/统计/诊断栏 / status-debug bar
  BOTTOM_LEFT: 'bottom-left' // 左下：辅助浮窗（下载站资源/历史）/ auxiliary floats
};

// 区域基准位置 / Zone base positions
/** @type {Record<string, {top?: string, left?: string, right?: string, bottom?: string}>} */
const BASE_POS = {
  'top-right': { top: '80px', right: '16px' },
  'top-left': { top: '80px', left: '16px' },
  'bottom-right': { right: '12px', bottom: '12px' },
  'bottom-left': { left: '16px', bottom: '12px' }
};

// 底部堆叠的间距 / stacking gap for bottom zones
const STACK_GAP = 12;

// v14.23.0：宽度/缩放钳位与步进（内容侧具名单源——铁律 13）
// Width/zoom clamps and step (content-side named single source).
const FLOAT_WIDTH_MIN = 260;
const FLOAT_WIDTH_MAX = 640;
const FLOAT_WIDTH_FALLBACK = 320; // style.width 解析失败时的兜底 / fallback
const FLOAT_SCALE_MIN = 0.8;
const FLOAT_SCALE_MAX = 1.4;
const FLOAT_SCALE_STEP = 0.1;
const FLOAT_SCALE_DEFAULT = 1;
// 位置恢复钳位保留边距（与拖拽钳位一致：至少露出可再抓取的标题栏）
// Viewport clamp margins on restore (same as drag: header stays reachable).
const EDGE_KEEP_X = 60;
const EDGE_KEEP_Y = 30;

/** @type {Record<string, any>} */ const floats = {}; // id → item
/** @type {Record<string, any[]>} */
const zoneStack = { 'top-right': [], 'top-left': [], 'bottom-right': [], 'bottom-left': [] };

// 是否底部堆叠区域 / is a bottom-stacking zone?
/** @param {string} zone @returns {boolean} */
function isBottomZone(zone) {
  return zone === ZONE.BOTTOM_RIGHT || zone === ZONE.BOTTOM_LEFT;
}

// 重新排列区域内的浮窗（从底部向上堆叠，防重叠）
// Re-stack floats in a bottom zone (bottom-up, no overlap)
/** @param {string} zone */
function refreshZone(zone) {
  if (!isBottomZone(zone)) return;
  let offset = 0;
  for (const item of zoneStack[zone]) {
    if (!item.root.parentNode) continue;
    item.root.style.bottom = parseInt(/** @type {string} */ (BASE_POS[zone].bottom), 10) + offset + 'px';
    offset += (item.lastHeight || 0) + STACK_GAP;
  }
}

// 全局主题（浮窗容器 data-theme；v8.1.0 内容侧跟随皮肤系统）
let floatTheme = '';
/** @param {string} [theme] */
export function applyFloatTheme(theme) {
  floatTheme = theme || '';
  for (const id of Object.keys(floats)) {
    if (floats[id].root) {
      // setAttribute 而非 dataset：测试模拟 DOM 无 dataset，且 CSS
      // [data-theme] 属性选择器对两者等价
      if (floatTheme) floats[id].root.setAttribute('data-theme', floatTheme);
      else floats[id].root.removeAttribute('data-theme');
    }
  }
}

// 存储写入小工具（try/catch + promise catch 双保险，历史语义保持）
// Storage write helper (try/catch plus promise catch; semantics preserved)
/** @param {Record<string, any>} obj */
function storeSet(obj) {
  try {
    chrome.storage.local.set(obj).catch(() => {});
  } catch {
    /* ignore */
  }
}

// 创建浮窗容器：返回内容区元素（chrome=false 时返回容器本身）
// Create a float container; returns the content area (or the container when
// chrome is disabled)
/**
 * @param {string} zone
 * @param {string} id
 * @param {{chrome?: boolean, width?: number, title?: string, folded?: boolean,
 *   onClose?: () => void, menuInfo?: () => Promise<string[]> | string[],
 *   menuItems?: Array<{action?: string, label: string, title?: string,
 *     onClick?: (btn: HTMLElement) => void | Promise<void>}>}} [opts]
 * @returns {HTMLDivElement}
 */
export function create(zone, id, opts = {}) {
  remove(id); // 幂等：先移除同 id 旧实例 / idempotent: drop a stale instance

  const root = document.createElement('div');
  root.id = id;
  root.className = 'gr-float gr-float-' + zone;
  // 定位由 JS 计算（动态堆叠），其余样式走 CSS 类
  root.style.cssText = `
      ${BASE_POS[zone].top ? `top:${BASE_POS[zone].top};` : ''}
      ${BASE_POS[zone].left ? `left:${BASE_POS[zone].left};` : ''}
      ${BASE_POS[zone].right ? `right:${BASE_POS[zone].right};` : ''}
      ${BASE_POS[zone].bottom ? `bottom:${BASE_POS[zone].bottom};` : ''}
      width:${opts.width || FLOAT_WIDTH_FALLBACK}px;
    `;
  if (floatTheme) root.setAttribute('data-theme', floatTheme);

  // v14.23.0：remove() 时需要清理的文档级监听（菜单外点关闭）统一登记
  // Teardown list for document-level listeners registered by this float.
  const teardownFns = [];

  let body = root;
  if (opts.chrome !== false) {
    // 标题栏：菜单 + 关闭（v14.23.0：折叠入口并入菜单）/ header: menu + close
    const header = document.createElement('div');
    header.className = 'gr-float-chrome';
    const title = document.createElement('span');
    title.className = 'gr-float-chrome-title';
    title.textContent = opts.title || '游戏雷达 Game Radar';
    const menuBtn = document.createElement('span');
    menuBtn.className = 'gr-float-chrome-btn gr-float-menu-btn'; // v14.24.0：专属类（E2E/测试选择器）
    menuBtn.textContent = '⚙';
    menuBtn.title = '浮窗菜单 / Menu';
    const closeBtn = document.createElement('span');
    closeBtn.className = 'gr-float-chrome-btn';
    closeBtn.textContent = '✕';
    closeBtn.title = '关闭 / Close';
    header.appendChild(title);
    header.appendChild(menuBtn);
    header.appendChild(closeBtn);
    root.appendChild(header);

    body = document.createElement('div');
    body.className = 'gr-float-body';
    root.appendChild(body);

    // ============ 折叠状态（键保持 foldKey 兼容 v10.6.0 记忆） ============
    const foldKey = 'grFloatFolded:' + id;
    const posKey = 'grFloatPos:' + id; // v11.0 B5：位置记忆键
    const widthKey = 'grFloatWidth:' + id; // v14.23.0：宽度记忆键
    const scaleKey = 'grFloatScale:' + id; // v14.23.0：缩放记忆键

    // ============ ⚙ 下拉菜单（折叠/缩放/重置/缓存信息） ============
    // v14.23.0：元素引用全走闭包（不用 querySelector——sim FakeEl 只查直接子级）
    const menu = document.createElement('div');
    menu.className = 'gr-float-menu';
    menu.style.display = 'none';
    const foldItem = document.createElement('button');
    foldItem.type = 'button';
    foldItem.className = 'gr-float-menu-item';
    const scaleRow = document.createElement('div');
    scaleRow.className = 'gr-float-menu-row';
    const scaleLabel = document.createElement('span');
    scaleLabel.className = 'gr-float-menu-row-label';
    scaleLabel.textContent = '缩放';
    const scaleDown = document.createElement('button');
    scaleDown.type = 'button';
    scaleDown.className = 'gr-float-menu-mini';
    scaleDown.textContent = '−';
    scaleDown.title = '缩小 / Zoom out';
    const scaleVal = document.createElement('span');
    scaleVal.className = 'gr-float-menu-row-val';
    const scaleUp = document.createElement('button');
    scaleUp.type = 'button';
    scaleUp.className = 'gr-float-menu-mini';
    scaleUp.textContent = '＋';
    scaleUp.title = '放大 / Zoom in';
    scaleRow.appendChild(scaleLabel);
    scaleRow.appendChild(scaleDown);
    scaleRow.appendChild(scaleVal);
    scaleRow.appendChild(scaleUp);
    scaleDown.addEventListener('click', () => applyScale(currentScale - FLOAT_SCALE_STEP, true));
    scaleUp.addEventListener('click', () => applyScale(currentScale + FLOAT_SCALE_STEP, true));
    const resetItem = document.createElement('button');
    resetItem.type = 'button';
    resetItem.className = 'gr-float-menu-item';
    resetItem.textContent = '重置位置与大小';
    const menuSep = document.createElement('div');
    menuSep.className = 'gr-float-menu-sep';
    const menuInfo = document.createElement('div');
    menuInfo.className = 'gr-float-menu-info';
    menu.appendChild(foldItem);
    menu.appendChild(scaleRow);
    menu.appendChild(resetItem);
    // v14.24.0（用户需求：手动更新/重新检索/选择机型迁入右上角 ⚙ 菜单）：浮窗
    // 专属菜单项（opts.menuItems 注入，data-menu-action 供测试/E2E 选择器）。
    // onClick 自管 busy 文案与反馈；菜单**不自动关闭**——更新/检索需数秒，
    // 进度要在菜单内可见，开合由点击语义与外点关闭共同负责。
    // v14.24.0: float-specific menu items (opts.menuItems, data-menu-action for
    // selectors). onClick owns busy feedback; the menu stays open so
    // multi-second actions keep visible progress.
    // v14.29.1（详情浮窗 3 连红根因）：menuSep 必须先入 menu 再作为
    // insertBefore 参照——参照节点非子节点时真实 DOM 抛 NotFoundError，
    // create() 整体失败 → 浮窗不渲染（FakeEl 旧实现"找不到就 push"掩盖了它）。
    // menuSep must be a child before being used as insertBefore reference.
    menu.appendChild(menuSep);
    (opts.menuItems || []).forEach((mi) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'gr-float-menu-item';
      if (mi.action) item.setAttribute('data-menu-action', mi.action);
      if (mi.title) item.title = mi.title;
      item.textContent = mi.label;
      item.addEventListener('click', () => {
        Promise.resolve(mi.onClick ? mi.onClick(item) : undefined).catch(() => {
          /* 回调自反馈失败文案 / callback reports its own failure state */
        });
      });
      menu.insertBefore(item, menuSep);
    });
    menu.appendChild(menuInfo);
    root.appendChild(menu);

    // 缩放走 body.style.zoom——浮窗内容模板全是内联 px 字号，根字号/换算
    // 都改不动它们，zoom 是 Chromium 单点生效的唯一手段（正文含图片等比缩放）
    // Zoom on the body: templates use inline px sizes everywhere, so zoom is
    // the only single-point scale that actually applies (Chromium-supported).
    let currentScale = FLOAT_SCALE_DEFAULT;
    /** @param {number} next @param {boolean} [persist] */
    function applyScale(next, persist) {
      currentScale = Math.round(Math.min(FLOAT_SCALE_MAX, Math.max(FLOAT_SCALE_MIN, next)) * 10) / 10;
      body.style.zoom = String(currentScale);
      scaleVal.textContent = Math.round(currentScale * 100) + '%';
      if (persist) storeSet({ [scaleKey]: currentScale });
    }
    function refreshMenuLabels() {
      foldItem.textContent = body.style.display === 'none' ? '展开浮窗' : '折叠浮窗';
      scaleVal.textContent = Math.round(currentScale * 100) + '%';
    }

    // 缓存信息区（opts.menuInfo 注入的异步行；打开菜单时刷新）
    async function loadMenuInfo() {
      if (typeof opts.menuInfo !== 'function') {
        menuSep.style.display = 'none';
        menuInfo.style.display = 'none';
        return;
      }
      menuSep.style.display = '';
      menuInfo.style.display = '';
      menuInfo.textContent = '缓存信息读取中…';
      try {
        const rows = await opts.menuInfo();
        menuInfo.textContent = '';
        (Array.isArray(rows) ? rows : []).forEach((line) => {
          const row = document.createElement('div');
          row.className = 'gr-float-menu-info-row';
          row.textContent = String(line); // textContent 天然转义 / safe by API
          menuInfo.appendChild(row);
        });
        if (!menuInfo.children.length) {
          menuSep.style.display = 'none';
          menuInfo.style.display = 'none';
        }
      } catch {
        menuInfo.textContent = '缓存信息不可用';
      }
    }

    // 开合与外点关闭（监听在关闭/移除时自摘，防泄漏）
    /** @type {((ev: MouseEvent) => void)|null} */
    let menuDocClose = null;
    function closeMenu() {
      menu.style.display = 'none';
      if (menuDocClose) {
        document.removeEventListener('mousedown', menuDocClose);
        menuDocClose = null;
      }
    }
    function openMenu() {
      menu.style.display = '';
      refreshMenuLabels();
      loadMenuInfo();
      if (!menuDocClose) {
        menuDocClose = (ev) => {
          const t = /** @type {Element|null} */ (ev && ev.target);
          // 菜单内 / 菜单按钮上的按下不关闭（交给各自 click 语义）
          if (t === menuBtn || (t && typeof t.closest === 'function' && t.closest('.gr-float-menu'))) return;
          closeMenu();
        };
        document.addEventListener('mousedown', menuDocClose);
      }
    }
    teardownFns.push(closeMenu);
    menuBtn.addEventListener('click', () => {
      if (menu.style.display === 'none') openMenu();
      else closeMenu();
    });

    // ============ 折叠（v14.23.0 回归修复） ============
    // v10.6.0 重构把切换写反：setFolded(当前是否隐藏) = 恒设为当前态，
    // 按钮自 v10.6.0 起点击无任何效果（真机复现实证）；正确语义 = 目标取反。
    // v10.6.0 refactor inverted the toggle (passed current state as target),
    // leaving the fold button dead ever since; fold = invert current state.
    const setFolded = (folded) => {
      body.style.display = folded ? 'none' : '';
      foldItem.textContent = folded ? '展开浮窗' : '折叠浮窗';
      storeSet({ [foldKey]: folded });
    };
    foldItem.addEventListener('click', () => {
      setFolded(body.style.display !== 'none');
      closeMenu();
    });

    // ============ 重置：位置/宽度/缩放一并回默认 ============
    resetItem.addEventListener('click', () => {
      applyScale(FLOAT_SCALE_DEFAULT, false);
      root.style.width = (opts.width || FLOAT_WIDTH_FALLBACK) + 'px';
      if (BASE_POS[zone].top) root.style.top = BASE_POS[zone].top;
      if (BASE_POS[zone].left) root.style.left = BASE_POS[zone].left;
      if (BASE_POS[zone].right) root.style.right = BASE_POS[zone].right;
      if (BASE_POS[zone].bottom) root.style.bottom = BASE_POS[zone].bottom;
      // chrome.storage：undefined 值 = 删除键（下次 create 不再恢复）
      storeSet({ [posKey]: undefined, [widthKey]: undefined, [scaleKey]: undefined });
      closeMenu();
    });

    // 恢复上次状态（折叠/位置/宽度/缩放一次读取；覆盖 opts.folded 默认——
    // 用户手动展开过则保持展开）
    try {
      chrome.storage.local
        .get([foldKey, posKey, widthKey, scaleKey])
        .then((d) => {
          if (!d) return;
          if (d[foldKey] === true) setFolded(true);
          // v14.23.0：宽度/缩放恢复（同一次读取；非法值忽略走默认）
          if (typeof d[widthKey] === 'number' && d[widthKey] >= FLOAT_WIDTH_MIN && d[widthKey] <= FLOAT_WIDTH_MAX) {
            root.style.width = d[widthKey] + 'px';
          }
          if (typeof d[scaleKey] === 'number' && d[scaleKey] >= FLOAT_SCALE_MIN && d[scaleKey] <= FLOAT_SCALE_MAX) {
            applyScale(d[scaleKey], false);
          }
          const pos = /** @type {{left?: number, top?: number}|undefined} */ (d[posKey]);
          if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
            // v14.23.0：恢复时按当前视口钳位（换屏/缩窗后旧坐标可能出屏）
            const left = Math.max(0, Math.min(window.innerWidth - EDGE_KEEP_X, pos.left));
            const top = Math.max(0, Math.min(window.innerHeight - EDGE_KEEP_Y, pos.top));
            root.style.left = left + 'px';
            root.style.top = top + 'px';
            root.style.right = 'auto';
            root.style.bottom = 'auto';
          }
        })
        .catch(() => {});
    } catch {
      /* ignore */
    }

    // v11.0 B5：标题栏拖拽 + 位置记忆——位置自由（按浮窗 id 持久化）
    // Header drag with per-float-id position persistence.
    header.style.cursor = 'move';
    header.addEventListener('mousedown', (ev) => {
      if (ev.target === menuBtn || ev.target === closeBtn) return; // 按钮不触发拖拽
      ev.preventDefault();
      const rect = root.getBoundingClientRect();
      const offX = ev.clientX - rect.left;
      const offY = ev.clientY - rect.top;
      const onMove = (mv) => {
        const left = Math.max(0, Math.min(window.innerWidth - 60, mv.clientX - offX));
        const top = Math.max(0, Math.min(window.innerHeight - 30, mv.clientY - offY));
        root.style.left = left + 'px';
        root.style.top = top + 'px';
        root.style.right = 'auto';
        root.style.bottom = 'auto';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const rect2 = root.getBoundingClientRect();
        storeSet({ [posKey]: { left: Math.round(rect2.left), top: Math.round(rect2.top) } });
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // ============ 右缘拖拽调宽（v14.23.0） ============
    // 手柄骑在右缘（右探 3px）避开 .gr-float-body 滚动条；宽度钳位 +
    // 视口右界钳位，拖完持久化（grFloatWidth，create 恢复）。
    // Right-edge handle straddles the border (3px out) to keep the body
    // scrollbar usable; clamped width persisted via grFloatWidth.
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'gr-float-resize';
    resizeHandle.title = '拖拽调整宽度 / Drag to resize';
    root.appendChild(resizeHandle);
    resizeHandle.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      const startX = ev.clientX;
      const startW = parseFloat(root.style.width) || opts.width || FLOAT_WIDTH_FALLBACK;
      const rect0 = root.getBoundingClientRect();
      const viewportMax = Math.max(FLOAT_WIDTH_MIN, window.innerWidth - rect0.left - 8);
      const onMove = (mv) => {
        const w = Math.min(FLOAT_WIDTH_MAX, viewportMax, Math.max(FLOAT_WIDTH_MIN, startW + (mv.clientX - startX)));
        root.style.width = w + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const w = parseFloat(root.style.width);
        if (w) storeSet({ [widthKey]: Math.round(w) });
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    closeBtn.addEventListener('click', () => {
      remove(id);
      if (typeof opts.onClose === 'function') opts.onClose();
    });
    // v10.4.0：默认折叠（settings.detailFloatExpanded 控制，详情页浮窗用）
    if (opts.folded) {
      body.style.display = 'none';
      foldItem.textContent = '展开浮窗';
    }
  }

  document.body.appendChild(root);

  const item = { zone, root, body, lastHeight: 0, teardown: teardownFns };
  floats[id] = item;
  if (!zoneStack[zone].includes(item)) zoneStack[zone].push(item); // v14.5.1：includes

  // 高度变化时自动重排同区浮窗（防重叠）/ auto re-stack on resize
  if (typeof ResizeObserver !== 'undefined') {
    item.observer = new ResizeObserver(() => {
      const h = root.offsetHeight || 0;
      if (h !== item.lastHeight) {
        item.lastHeight = h;
        refreshZone(zone);
      }
    });
    item.observer.observe(root);
  } else {
    item.lastHeight = root.offsetHeight || 200;
    refreshZone(zone);
  }

  return body;
}

// 关闭单个浮窗 / Close a single float
/** @param {string} id */
export function remove(id) {
  const item = floats[id];
  if (!item) return;
  (item.teardown || []).forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
  if (item.observer) item.observer.disconnect();
  const idx = zoneStack[item.zone].indexOf(item);
  if (idx !== -1) zoneStack[item.zone].splice(idx, 1);
  if (item.root.parentNode) item.root.parentNode.removeChild(item.root);
  delete floats[id];
  refreshZone(item.zone);
}

// 关闭全部浮窗 / Close all floats（测试清理用）
export function closeAll() {
  for (const id of Object.keys(floats)) remove(id);
}
