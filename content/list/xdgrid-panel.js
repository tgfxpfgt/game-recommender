/**
 * 游戏雷达 Game Radar - 列表工具面板 / Grid Customizer Panel
 *
 * 悬浮齿轮 + 双标签面板（布局/过滤），纯 DOM 无内联事件。
 * v14.3.0（第五轮 B2）：由 xdgrid.js 拆分——面板 UI 单域（DOM 构建 + 绑定）；
 * 布局引擎在 xdgrid-layout.js（applyLayout/normalizeCfg/saveAllSettings/
 * DEFAULTS 经导入消费），装配壳在 xdgrid.js。
 * The floating gear + two-tab panel (layout/filter): DOM construction and
 * bindings only; the layout engine lives in xdgrid-layout.js.
 * v14.14.0（重构序 6a）：buildUI 拆五段（createFab/createPanel/buildLayoutTab/
 * buildFilterTab/bindTabsAndFab/bindLayoutReset）；buildUI 只做装配，行为不变。
 */
import * as debug from '../core/debug.js';
import * as builder from '../adapters/builder.js';
import * as listState from './list-state.js';
import { upsertPreset, clampPct } from './filter-presets.js';
import { applyLayout, normalizeCfg, saveAllSettings, DEFAULTS } from './xdgrid-layout.js';
import { mountView, h, Fragment } from '../core/preact-mount.js'; // v15 阶段 3 全量迁移：面板 Preact 渲染

/** @param {...any} a */
const dbg = (...a) => debug.dbg(...a);

const PANEL_ID = 'gr-xdgrid-panel';
const BTN_ID = 'gr-xdgrid-fab';

/** 站点布局配置 / Per-site layout config. @typedef {{enabled: boolean, cols: number, iconW: number, iconH: number, gap: number}} XdgridCfg */

let uiBuilt = false;

/** 创建悬浮齿轮按钮 / Create the floating gear button. */
function createFab() {
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
  return fab;
}

/** 创建面板容器（v15 阶段 3 全量迁移：Preact h() 渲染，data-xg/data-rf 选择器接线不变） / Create the panel container. @param {XdgridCfg} cfg */
function createPanel(cfg) {
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
  mountView(
    panel,
    h(
      Fragment,
      null,
      h(
        'div',
        { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px' },
        h('b', { style: 'font-size:13px' }, '列表页工具（本站）'),
        h('span', { 'data-xg': 'close', style: 'cursor:pointer;color:#999;padding:0 4px;font-size:14px' }, '✕')
      ),
      h(
        'div',
        { style: 'display:flex;gap:6px;margin-bottom:10px' },
        h(
          'button',
          {
            'data-xg': 'tabLayout',
            style:
              'flex:1;padding:5px 0;border:1px solid #4a9eff;border-radius:6px;cursor:pointer;background:#eaf3ff;color:#2d6cb5;font-weight:bold'
          },
          '布局'
        ),
        h(
          'button',
          {
            'data-xg': 'tabFilter',
            style:
              'flex:1;padding:5px 0;border:1px solid #ddd;border-radius:6px;cursor:pointer;background:#f5f5f5;color:#666'
          },
          '过滤'
        )
      ),
      h(
        'div',
        { 'data-xg': 'paneLayout' },
        h(
          'label',
          { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;cursor:pointer' },
          h('span', null, '启用本站定制'),
          h('input', {
            'data-xg': 'enabled',
            type: 'checkbox',
            checked: !!cfg.enabled,
            style: 'width:16px;height:16px;cursor:pointer'
          })
        ),
        h(
          'div',
          { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px' },
          h('span', null, '每行图标数'),
          h('b', { 'data-xg': 'colsVal' }, String(cfg.cols))
        ),
        h('input', {
          'data-xg': 'cols',
          type: 'range',
          min: '1',
          max: '12',
          step: '1',
          value: String(cfg.cols),
          style: 'width:100%;margin-bottom:10px'
        }),
        h(
          'div',
          { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px' },
          h('span', null, '图标宽度(px)'),
          h('input', {
            'data-xg': 'iconW',
            type: 'number',
            min: '0',
            max: '600',
            step: '2',
            value: String(cfg.iconW),
            style: 'width:64px;padding:2px 4px;border:1px solid #ddd;border-radius:4px'
          })
        ),
        h('div', { 'data-xg': 'modeHint', style: 'color:#4a9eff;margin-bottom:8px' }, '图标大小不变，容器随列数加宽'),
        h(
          'div',
          { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px' },
          h('span', null, '封面高度(px)'),
          h('input', {
            'data-xg': 'iconH',
            type: 'number',
            min: '0',
            max: '500',
            step: '5',
            value: String(cfg.iconH),
            style: 'width:64px;padding:2px 4px;border:1px solid #ddd;border-radius:4px'
          })
        ),
        h('div', { style: 'color:#999;margin-bottom:8px' }, '0 = 保持站点原始比例'),
        h(
          'div',
          { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px' },
          h('span', null, '卡片间距(px)'),
          h('b', { 'data-xg': 'gapVal' }, String(cfg.gap))
        ),
        h('input', {
          'data-xg': 'gap',
          type: 'range',
          min: '0',
          max: '40',
          step: '1',
          value: String(cfg.gap),
          style: 'width:100%;margin-bottom:8px'
        }),
        h(
          'button',
          {
            'data-xg': 'reset',
            style: 'width:100%;padding:6px 0;border:none;border-radius:6px;cursor:pointer;background:#f0f2f5;color:#666'
          },
          '恢复默认（本站）'
        )
      ),
      h(
        'div',
        { 'data-xg': 'paneFilter', style: 'display:none' },
        h(
          'label',
          { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;cursor:pointer' },
          h('span', null, '启用好评率过滤'),
          h('input', { 'data-rf': 'enabled', type: 'checkbox', style: 'width:16px;height:16px;cursor:pointer' })
        ),
        h(
          'div',
          { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px' },
          h('span', null, '最低好评率'),
          h('b', null, h('span', { 'data-rf': 'rateVal' }, '0'), '%')
        ),
        h('input', {
          'data-rf': 'slider',
          type: 'range',
          min: '0',
          max: '100',
          step: '5',
          value: '0',
          style: 'width:100%;margin-bottom:8px'
        }),
        h('div', { 'data-rf': 'hint', style: 'color:#4a9eff;margin-bottom:4px' }, '过滤关闭'),
        h('div', { 'data-rf': 'reach', style: 'color:#999;margin-bottom:6px' }),
        h('div', { style: 'color:#999' }, '实时作用于当前列表（不重新取数）；设置全站生效'),
        h(
          'div',
          { style: 'border-top:1px solid #e5e7eb;margin:10px 0;padding-top:8px' },
          h('div', { style: 'margin-bottom:6px' }, '本地排序（不重新取数）'),
          h(
            'div',
            { style: 'display:flex;gap:6px' },
            h(
              'button',
              {
                'data-rf': 'sortRating',
                style: 'flex:1;padding:5px 0;border:none;border-radius:6px;cursor:pointer;background:#f0f2f5;color:#666'
              },
              '好评率↓'
            ),
            h(
              'button',
              {
                'data-rf': 'sortUpdate',
                style: 'flex:1;padding:5px 0;border:none;border-radius:6px;cursor:pointer;background:#f0f2f5;color:#666'
              },
              '更新日期↓'
            ),
            h(
              'button',
              {
                'data-rf': 'sortReset',
                style: 'flex:1;padding:5px 0;border:none;border-radius:6px;cursor:pointer;background:#f0f2f5;color:#666'
              },
              '取消'
            )
          ),
          h('div', { 'data-rf': 'sortHint', style: 'color:#999;margin-top:4px' })
        ),
        h(
          'div',
          { 'data-rf': 'presetBox', style: 'border-top:1px solid #e5e7eb;margin-top:10px;padding-top:8px' },
          h('div', { style: 'margin-bottom:6px' }, '过滤预设（跨刷新持久）'),
          h(
            'div',
            { style: 'display:flex;gap:4px;margin-bottom:6px' },
            h('input', {
              'data-rf': 'presetName',
              placeholder: '预设名（如 95+）',
              maxLength: 20,
              style: 'flex:1;min-width:0;padding:3px 6px;font-size:12px;border:1px solid #ddd;border-radius:6px'
            }),
            h(
              'button',
              {
                'data-rf': 'presetSave',
                title: '把当前过滤条件（开关+阈值）存为该名字的预设',
                style: 'padding:3px 10px;border:none;border-radius:6px;cursor:pointer;background:#eaf3ff;color:#2d6cb5'
              },
              '存当前'
            )
          ),
          h('div', { 'data-rf': 'presetList', style: 'display:flex;flex-wrap:wrap;gap:4px;color:#999;font-size:12px' })
        )
      )
    )
  );
  document.body.appendChild(panel);
  return panel;
}

// ============ 布局标签页 / Layout tab ============

/**
 * 布局标签页绑定 / Layout-tab bindings.
 * @param {{all: {sites: Record<string, any>}, host: string, cfg: XdgridCfg, panel: HTMLElement}} ctx
 * @returns {{$: (name: string) => any, update: () => void}}
 */
function buildLayoutTab(ctx) {
  const { all, host, cfg, panel } = ctx;
  /** @param {string} name @returns {any} 调用方直接取 .value/.checked */
  const $ = (name) => panel.querySelector(`[data-xg="${name}"]`);

  const syncHint = () => {
    const w = parseInt($('iconW').value, 10) || 0;
    $('modeHint').textContent = w > 0 ? '图标大小不变，容器加宽并向两侧居中扩展' : '自适应压缩：图标变小，容器不变';
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
  syncHint();
  return { $, update };
}

/**
 * 开合与双标签切换绑定 / Fab toggle + tab switch bindings.
 * @param {{fab: HTMLElement, panel: HTMLElement, refreshFilterControls: () => Promise<void>}} ctx
 */
function bindTabsAndFab(ctx) {
  const { fab, panel, refreshFilterControls } = ctx;
  /** @param {string} name @returns {any} 调用方直接取 .style */
  const $ = (name) => panel.querySelector(`[data-xg="${name}"]`);
  fab.addEventListener('click', () => {
    const opening = panel.style.display === 'none';
    panel.style.display = opening ? 'block' : 'none';
    if (opening) refreshFilterControls();
  });
  // v10.6.0：双标签切换（布局/过滤）
  const paneL = $('paneLayout');
  const paneF = $('paneFilter');
  const tabL = $('tabLayout');
  const tabF = $('tabFilter');
  const switchTab = (/** @type {boolean} */ showLayout) => {
    paneL.style.display = showLayout ? '' : 'none';
    paneF.style.display = showLayout ? 'none' : '';
    tabL.style.background = showLayout ? '#eaf3ff' : '#f5f5f5';
    tabL.style.color = showLayout ? '#2d6cb5' : '#666';
    tabF.style.background = showLayout ? '#f5f5f5' : '#eaf3ff';
    tabF.style.color = showLayout ? '#666' : '#2d6cb5';
  };
  tabL.addEventListener('click', () => switchTab(true));
  tabF.addEventListener('click', () => switchTab(false));
}

// ============ 过滤标签页（自 filter-fab 合并，v10.6.0） ============

/**
 * 过滤标签页绑定 / Filter-tab bindings.
 * @param {{panel: HTMLElement}} ctx
 * @returns {{refreshFilterControls: () => Promise<void>}}
 */
function buildFilterTab(ctx) {
  const { panel } = ctx;
  const rf = {
    enabled: panel.querySelector('[data-rf="enabled"]'),
    slider: panel.querySelector('[data-rf="slider"]'),
    rateVal: panel.querySelector('[data-rf="rateVal"]'),
    hint: panel.querySelector('[data-rf="hint"]')
  };
  const applyFilterChange = () => {
    const enabled = rf.enabled.checked;
    const min = Math.min(100, Math.max(0, parseInt(rf.slider.value, 10) || 0));
    rf.rateVal.textContent = String(min);
    rf.slider.disabled = !enabled;
    rf.hint.textContent = enabled ? `已隐藏好评率 < ${min}% 的游戏` : '过滤关闭（显示全部已取好评率的游戏）';
    // 1) 实时作用于当前列表（不重新取数）
    const { shown, filtered } = listState.applyLiveRatingFilter({
      enableRatingFilter: enabled,
      minSteamRatingFilter: min
    });
    dbg(`实时好评率过滤：显示 ${shown} / 隐藏 ${filtered}（阈值 ${enabled ? min : 'off'}）`);
    // 2) 窄化持久化（v10.9）——内容侧直发全量 SAVE_SETTINGS 被 sender 门禁拒绝
    //（特权写不对 web 源开放），改走只含两个键的 SAVE_RATING_FILTER_CFG
    (async () => {
      try {
        await chrome.runtime.sendMessage({ action: 'SAVE_RATING_FILTER_CFG', enabled, minRating: min });
      } catch {
        /* 后台不可达：本地实时过滤仍生效，仅不落盘 */
      }
    })();
  };
  const refreshFilterControls = async () => {
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
      const fs2 = (resp && resp.settings) || {};
      const enabled = fs2.enableRatingFilter === true;
      const min = Math.min(100, Math.max(0, parseInt(fs2.minSteamRatingFilter, 10) || 0));
      rf.enabled.checked = enabled;
      rf.slider.value = String(min);
      rf.slider.disabled = !enabled;
      rf.rateVal.textContent = String(min);
      rf.hint.textContent = enabled ? `已隐藏好评率 < ${min}% 的游戏` : '过滤关闭';
    } catch {
      /* 读取失败保持默认 */
    }
  };
  rf.enabled.addEventListener('change', applyFilterChange);
  // v12 B8：本地排序按钮（复用 list-state 信号与数据，纯 DOM 重排）
  // v13 B7：排序模式持久化（grListSort:<host>，刷新后保持）
  const sortKey = 'grListSort:' + location.hostname;
  const applySort = async (/** @type {string} */ mode, /** @type {boolean} */ persist = true) => {
    const sortHint = panel.querySelector('[data-rf="sortHint"]');
    const sortState = await listState.applyLocalSort(mode);
    if (sortHint) {
      sortHint.textContent =
        mode === 'none'
          ? '已恢复原顺序'
          : sortState > 0
            ? `已按${mode === 'rating' ? '好评率' : '更新日期'}排序 ${sortState} 项`
            : '无可排序数据';
    }
    if (persist) {
      try {
        chrome.storage.local.set({ [sortKey]: mode }).catch(() => {});
      } catch {
        /* ignore */
      }
    }
  };
  const sortRatingBtn = panel.querySelector('[data-rf="sortRating"]');
  const sortUpdateBtn = panel.querySelector('[data-rf="sortUpdate"]');
  const sortResetBtn = panel.querySelector('[data-rf="sortReset"]');
  if (sortRatingBtn) sortRatingBtn.addEventListener('click', () => applySort('rating'));
  if (sortUpdateBtn) sortUpdateBtn.addEventListener('click', () => applySort('update'));
  if (sortResetBtn) sortResetBtn.addEventListener('click', () => applySort('none'));
  // v14.1.0（第二轮 B8 后半）：过滤命名预设——当前过滤条件（开关+阈值）存为
  // 命名预设一键切换；按 host 隔离存 chrome.storage.local，跨刷新持久。
  // Named filter presets, host-scoped, persisted in chrome.storage.local.
  const presetKey = 'grFilterPresets:' + location.hostname;
  const presetName = panel.querySelector('[data-rf="presetName"]');
  const presetSaveBtn = panel.querySelector('[data-rf="presetSave"]');
  const presetList = panel.querySelector('[data-rf="presetList"]');
  const readPresets = async () => {
    try {
      const d = await chrome.storage.local.get(presetKey);
      const arr = d && d[presetKey];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  };
  const renderPresets = async () => {
    if (!presetList) return;
    const presets = await readPresets();
    if (presets.length === 0) {
      presetList.textContent = '暂无预设';
      return;
    }
    // v15 阶段 3 全量迁移：预设 chips Preact 重挂载（原 innerHTML='' +
    // createElement 循环退役；onClick prop 直连，重渲染差分复用节点）
    mountView(
      presetList,
      h(
        Fragment,
        null,
        presets.map((/** @type {any} */ p) =>
          h(
            'span',
            {
              key: String(p.name),
              style:
                'display:inline-flex;align-items:center;gap:3px;padding:2px 6px;font-size:12px;background:#eaf3ff;color:#2d6cb5;border-radius:6px;'
            },
            h(
              'button',
              {
                type: 'button',
                title: '应用此预设',
                style: 'border:none;background:none;color:inherit;cursor:pointer;font-size:12px;padding:0;',
                onClick: () => {
                  rf.enabled.checked = p.enabled !== false;
                  rf.slider.value = String(Math.min(100, Math.max(0, Number(p.min) || 0)));
                  applyFilterChange(); // 复用既有链路：实时过滤 + 窄化持久化
                }
              },
              `${p.name}（${p.enabled ? '≥' + p.min + '%' : '关'}）`
            ),
            h(
              'button',
              {
                type: 'button',
                title: '删除预设',
                style: 'border:none;background:none;color:#99a;cursor:pointer;font-size:11px;padding:0;',
                onClick: async () => {
                  const rest = (await readPresets()).filter((/** @type {any} */ x) => x.name !== p.name);
                  try {
                    await chrome.storage.local.set({ [presetKey]: rest });
                  } catch {
                    /* ignore */
                  }
                  renderPresets();
                }
              },
              '✕'
            )
          )
        )
      )
    );
  };
  if (presetSaveBtn && presetName) {
    presetSaveBtn.addEventListener('click', async () => {
      // v14.2.0：写入逻辑外移 filter-presets.js（重名更新 + 上限 10 淘汰最早，可单测）
      const { presets, name } = upsertPreset(
        await readPresets(),
        String(presetName.value || ''),
        rf.enabled.checked,
        clampPct(rf.slider.value)
      );
      if (!name) {
        presetName.placeholder = '请先输入预设名';
        return;
      }
      try {
        await chrome.storage.local.set({ [presetKey]: presets });
      } catch {
        /* 存储失败时预设仅本次会话可用 */
      }
      presetName.value = '';
      renderPresets();
    });
  }
  renderPresets();
  // v13 B8：面板打开时显示 Steam 接口可达性（不可达时提示数据可能不完整）
  try {
    chrome.runtime
      .sendMessage({ action: 'GET_API_STATUS' })
      .then((resp) => {
        const reach = panel.querySelector('[data-rf="reach"]');
        if (!reach || !resp || !resp.domains) return;
        const dm = resp.domains;
        const lamp = (/** @type {string} */ v) => (v === 'ok' ? '🟢' : v === 'down' ? '🔴' : '⚪');
        reach.textContent = 'Steam 可达性：商店 ' + lamp(dm.store) + ' / API ' + lamp(dm.api);
        if (dm.store === 'down' || dm.storeCircuit === 'open') {
          reach.style.color = '#e67e22';
          reach.textContent += '——数据可能不完整';
        }
      })
      .catch(() => {});
  } catch {
    /* ignore */
  }
  // 回显持久化模式（面板打开时重放；none/未设置不重放）
  // v14.0.0：等待批次空闲后再重放——此前 buildUI 即刻重放，评分任务尚在加载
  // （可排序项 < 2）时重放落空，持久化的排序在刷新后静默丢失。
  try {
    chrome.storage.local
      .get(sortKey)
      .then(async (d) => {
        const saved = /** @type {string} */ (d && d[sortKey]);
        if (!saved || saved === 'none') return;
        const idle = await listState.waitForBatchIdle(60000);
        if (!idle) return; // 超时放弃（数据未就绪时强排无意义）
        applySort(saved, false);
      })
      .catch(() => {});
  } catch {
    /* ignore */
  }

  rf.slider.addEventListener('input', () => {
    rf.rateVal.textContent = String(Math.min(100, Math.max(0, parseInt(rf.slider.value, 10) || 0)));
  });
  rf.slider.addEventListener('change', applyFilterChange);
  return { refreshFilterControls };
}

// ============ 恢复默认（布局域）/ Layout reset ============

/**
 * 恢复默认绑定（需要布局标签页返回的 $/update）/ Layout reset binding.
 * @param {{cfg: XdgridCfg, $: (name: string) => any, update: () => void}} ctx
 */
function bindLayoutReset(ctx) {
  const { cfg, $, update } = ctx;
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
}

// ============ 装配入口 / Assembly entry ============

/**
 * 装配入口 / Assembly entry.
 * @param {{sites: Record<string, any>}} all
 * @param {string} host
 * @param {XdgridCfg} cfg
 */
export function buildUI(all, host, cfg) {
  if (uiBuilt || document.getElementById(BTN_ID)) return;
  uiBuilt = true;
  // v14.40.0：面板装配 = 用户开启布局定制的真实信号（LOG_PERF 宽松通道——
  // TRACK_EVENT 白名单外会被契约拒绝；后台按 source=usage/metric 映射
  // usage.xdgrid_open）。分级统计是聚合信号，失败静默。
  try {
    window.__GR_MSG__
      .sendMessage({ action: 'LOG_PERF', source: 'usage', metric: 'xdgrid_open', durationMs: 0 })
      .catch(() => {});
  } catch {
    /* 上报失败不影响功能 */
  }
  const fab = createFab();
  const panel = createPanel(cfg);
  const layoutApi = buildLayoutTab({ all, host, cfg, panel });
  const { refreshFilterControls } = buildFilterTab({ panel });
  bindTabsAndFab({ fab, panel, refreshFilterControls });
  bindLayoutReset({ cfg, $: layoutApi.$, update: layoutApi.update });
}
