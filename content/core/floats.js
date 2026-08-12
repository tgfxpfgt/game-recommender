/**
 * Game Recommender - 统一浮窗管理器 / Unified Float Manager
 *
 * v3.1.0：所有扩展浮窗（状态栏/诊断、Steam 信息、下载站资源、下载历史）
 * 统一经 GR.float 创建与管理：分区定位（右上/右下/左下）、同区纵向堆叠防重叠、
 * 统一折叠/关闭、可整体收起。各浮窗的内容渲染逻辑保持独立。
 * All extension floats (status/debug bar, Steam info, download-site resources,
 * download history) are created through GR.float: zoned placement, vertical
 * stacking within a zone (no overlap), unified fold/close, and close-all.
 */
(function (global) {
  'use strict';

  const GR = (global.__GR__ = global.__GR__ || {});

  // 浮窗区域 / Float zones
  const ZONE = {
    TOP_RIGHT: 'top-right', // 右上：Steam 信息等主浮窗 / main info floats
    BOTTOM_RIGHT: 'bottom-right', // 右下：状态/统计/诊断栏 / status-debug bar
    BOTTOM_LEFT: 'bottom-left' // 左下：辅助浮窗（下载站资源/历史）/ auxiliary floats
  };

  // 区域基准位置 / Zone base positions
  const BASE_POS = {
    'top-right': { top: '80px', right: '16px' },
    'bottom-right': { right: '12px', bottom: '12px' },
    'bottom-left': { left: '16px', bottom: '12px' }
  };

  // 底部堆叠的间距 / stacking gap for bottom zones
  const STACK_GAP = 12;

  const floats = {}; // id → item
  const zoneStack = { 'top-right': [], 'bottom-right': [], 'bottom-left': [] };

  // 是否底部堆叠区域 / is a bottom-stacking zone?
  function isBottomZone(zone) {
    return zone === ZONE.BOTTOM_RIGHT || zone === ZONE.BOTTOM_LEFT;
  }

  // 重新排列区域内的浮窗（从底部向上堆叠，防重叠）
  // Re-stack floats in a bottom zone (bottom-up, no overlap)
  function refreshZone(zone) {
    if (!isBottomZone(zone)) return;
    let offset = 0;
    for (const item of zoneStack[zone]) {
      if (!item.root.parentNode) continue;
      item.root.style.bottom = parseInt(BASE_POS[zone].bottom, 10) + offset + 'px';
      offset += (item.lastHeight || 0) + STACK_GAP;
    }
  }

  // 创建浮窗容器：返回内容区元素（chrome=false 时返回容器本身）
  // Create a float container; returns the content area (or the container when
  // chrome is disabled)
  function create(zone, id, opts = {}) {
    remove(id); // 幂等：先移除同 id 旧实例 / idempotent: drop a stale instance

    const root = document.createElement('div');
    root.id = id;
    root.style.cssText = `
      position:fixed;z-index:2147483647;
      ${BASE_POS[zone].top ? `top:${BASE_POS[zone].top};` : ''}
      ${BASE_POS[zone].left ? `left:${BASE_POS[zone].left};` : ''}
      ${BASE_POS[zone].right ? `right:${BASE_POS[zone].right};` : ''}
      ${BASE_POS[zone].bottom ? `bottom:${BASE_POS[zone].bottom};` : ''}
      width:${opts.width || 320}px;
      background:#1b2838;border:1px solid #2a475e;border-radius:4px;
      font-family:Arial,Helvetica,sans-serif;color:#c7d5e0;font-size:13px;line-height:1.5;
      box-shadow:0 0 12px rgba(0,0,0,0.6);
    `;

    let body = root;
    if (opts.chrome !== false) {
      // 标题栏：折叠 + 关闭 / header: fold + close
      const header = document.createElement('div');
      header.style.cssText = `
        display:flex;align-items:center;gap:6px;padding:8px 12px;
        background:#16283a;border-bottom:1px solid #2a475e;
        font-weight:bold;font-size:12px;color:#66c0f4;
        cursor:default;user-select:none;
      `;
      const title = document.createElement('span');
      title.textContent = opts.title || 'Game Recommender';
      title.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      const foldBtn = document.createElement('span');
      foldBtn.textContent = '▾';
      foldBtn.title = '折叠 / Fold';
      foldBtn.style.cssText = 'cursor:pointer;color:#8f98a0;font-size:12px;padding:0 4px;';
      const closeBtn = document.createElement('span');
      closeBtn.textContent = '✕';
      closeBtn.title = '关闭 / Close';
      closeBtn.style.cssText = 'cursor:pointer;color:#8f98a0;font-size:13px;padding:0 4px;';
      header.appendChild(title);
      header.appendChild(foldBtn);
      header.appendChild(closeBtn);
      root.appendChild(header);

      body = document.createElement('div');
      body.style.cssText = 'max-height:calc(100vh - 140px);overflow-y:auto;';
      root.appendChild(body);

      // 折叠：隐藏内容区（高度变化由 ResizeObserver 感知，自动重排同区浮窗）
      foldBtn.addEventListener('click', () => {
        const folded = body.style.display === 'none';
        body.style.display = folded ? '' : 'none';
        foldBtn.textContent = folded ? '▾' : '▸';
      });
      closeBtn.addEventListener('click', () => {
        remove(id);
        if (typeof opts.onClose === 'function') opts.onClose();
      });
    }

    document.body.appendChild(root);

    const item = { zone, root, body, lastHeight: 0 };
    floats[id] = item;
    if (zoneStack[zone].indexOf(item) === -1) zoneStack[zone].push(item);

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
  function remove(id) {
    const item = floats[id];
    if (!item) return;
    if (item.observer) item.observer.disconnect();
    const idx = zoneStack[item.zone].indexOf(item);
    if (idx !== -1) zoneStack[item.zone].splice(idx, 1);
    if (item.root.parentNode) item.root.parentNode.removeChild(item.root);
    delete floats[id];
    refreshZone(item.zone);
  }

  // 关闭全部浮窗 / Close all floats
  function closeAll() {
    for (const id of Object.keys(floats)) remove(id);
  }

  GR.float = {
    ZONE,
    create,
    remove,
    closeAll
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
