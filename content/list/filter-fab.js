/**
 * 游戏雷达 Game Radar - 列表页好评率过滤悬浮控件 / List-Page Rating-Filter FAB
 *
 * v10.5.1 任务1：在列表页提供一个常驻悬浮按钮，展开后有"开关 + 滑块"，
 * 实时调节 Steam 好评率过滤阈值：
 *   - 开关 → settings.enableRatingFilter
 *   - 滑块(0-100) → settings.minSteamRatingFilter
 * 改动即时作用于已渲染列表（list-state.applyLiveRatingFilter，不重新取数），
 * 并异步持久化到全局设置（与设置页/popup 同一份 enableRatingFilter/
 * minSteamRatingFilter 键，不新增设置项）。
 * A persistent list-page FAB with a toggle + slider that adjusts the Steam
 * positive-rate filter in real time (live re-filter of rendered items, no
 * re-fetch) and persists to the existing global settings keys.
 */
import * as listState from './list-state.js';
import * as debug from '../core/debug.js';

const dbg = (...a) => debug.dbg(...a);
const BTN_ID = 'gr-rfilter-fab';
const PANEL_ID = 'gr-rfilter-panel';
let built = false;

// 读取当前设置整包（用于合并后整体回存，saveSettings 是整包覆盖语义）
async function loadSettings() {
  try {
    const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_SETTINGS' }, null, { timeout: 3000 });
    return (resp && resp.settings) || null;
  } catch {
    return null;
  }
}

// 合并两处阈值后整体回存（GET→patch→SAVE full），避免整包覆盖丢字段
async function persist(enableRatingFilter, minSteamRatingFilter) {
  const full = await loadSettings();
  if (!full) return; // 后台不可达：本地实时过滤仍生效，仅不落盘
  full.enableRatingFilter = enableRatingFilter;
  full.minSteamRatingFilter = minSteamRatingFilter;
  try {
    await window.__GR_MSG__.sendMessage({ action: 'SAVE_SETTINGS', settings: full }, null, { timeout: 3000 });
  } catch {
    /* 保存失败静默（本地过滤已生效） */
  }
}

function onChange(controls) {
  const enabled = controls.enabled.checked;
  const min =
    listState && Number.isFinite(Number(controls.slider.value))
      ? Math.min(100, Math.max(0, parseInt(controls.slider.value, 10)))
      : 0;
  controls.rateVal.textContent = min;
  controls.slider.disabled = !enabled;
  controls.hint.textContent = enabled ? `已隐藏好评率 < ${min}% 的游戏` : '过滤关闭（显示全部已取好评率的游戏）';
  // 1) 立即作用于当前列表（不重新取数）
  const { shown, filtered } = listState.applyLiveRatingFilter({
    enableRatingFilter: enabled,
    minSteamRatingFilter: min
  });
  dbg(`实时好评率过滤：显示 ${shown} / 隐藏 ${filtered}（阈值 ${enabled ? min : 'off'}）`);
  // 2) 异步持久化到全局设置
  persist(enabled, min).catch(() => {});
}

function buildUI(settings) {
  if (built || document.getElementById(BTN_ID)) return;
  built = true;
  const startEnabled = !!settings.enableRatingFilter;
  const startMin = Math.min(100, Math.max(0, parseInt(settings.minSteamRatingFilter, 10) || 0));

  const fab = document.createElement('div');
  fab.id = BTN_ID;
  fab.title = '好评率过滤（游戏雷达）';
  fab.textContent = '🎚';
  fab.style.cssText = [
    'position:fixed',
    'left:16px',
    'bottom:16px',
    'z-index:2147483600',
    'width:40px',
    'height:40px',
    'border-radius:50%',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'font-size:18px',
    'line-height:1',
    'cursor:pointer',
    'user-select:none',
    'background:rgba(50,54,60,.85)',
    'color:#fff',
    'box-shadow:0 2px 10px rgba(0,0,0,.35)',
    'font-family:sans-serif'
  ].join(';');
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.style.cssText = [
    'position:fixed',
    'left:16px',
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
        <b style="font-size:13px">好评率过滤（实时）</b>
        <span data-rf="close" style="cursor:pointer;color:#999;padding:0 4px;font-size:14px">✕</span>
      </div>
      <label style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;cursor:pointer">
        <span>启用好评率过滤</span>
        <input data-rf="enabled" type="checkbox" ${startEnabled ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer">
      </label>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span>最低好评率</span><b><span data-rf="rateVal">${startMin}</span>%</b>
      </div>
      <input data-rf="slider" type="range" min="0" max="100" step="5" value="${startMin}"
        ${startEnabled ? '' : 'disabled'} style="width:100%;margin-bottom:8px">
      <div data-rf="hint" style="color:#4a9eff">${
        startEnabled ? `已隐藏好评率 < ${startMin}% 的游戏` : '过滤关闭（显示全部已取好评率的游戏）'
      }</div>
    `;
  document.body.appendChild(panel);

  const $ = (name) => panel.querySelector(`[data-rf="${name}"]`);
  const controls = { enabled: $('enabled'), slider: $('slider'), rateVal: $('rateVal'), hint: $('hint') };
  controls.enabled.addEventListener('change', () => onChange(controls));
  controls.slider.addEventListener('input', () => onChange(controls));
  $('close').addEventListener('click', () => {
    panel.style.display = 'none';
  });
  fab.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });
}

/**
 * 列表页初始化悬浮控件（幂等；非列表页/无 body 时静默跳过）。
 * @param {Object} settings 当前设置（enableRatingFilter/minSteamRatingFilter）
 */
export function init(settings) {
  if (!settings || !document.body) return;
  try {
    buildUI(settings);
  } catch (e) {
    dbg('好评率过滤控件构建失败（不影响过滤主流程）: ' + String(e));
  }
}

export const _internal = { onChange, persist, buildUI };
