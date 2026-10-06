/**
 * 游戏雷达 Game Radar - 设置面板（浮窗模块顺序）/ Settings Panel (FM Order)
 *
 * v14.3.0（第五轮 B3）：settings.js 529 行拆分后本文件保留浮窗模块顺序 UI
 *（写侧——读侧在 detail-templates.js；键序单源 shared/fm-keys.js，options.html
 * 以 module script 加载）。渲染器在 settings-render.js、事件绑定在
 * settings-bind.js；经 window.__OPTS__ 命名空间协作。
 * FM-order UI remains here after the B3 split; renderers/bindings live in
 * settings-render.js / settings-bind.js via the __OPTS__ namespace.
 */
(function (global) {
  'use strict';

  const OPTS = (global.__OPTS__ = global.__OPTS__ || {});

  // v14.1.0：浮窗模块顺序（写侧——读侧在 detail-templates.js）
  // v14.2.0：键序/文案改读 globalThis.__GR_FM_KEYS__（shared/fm-keys.js 单源，
  // options.html 以 module script 加载、先于 DOMContentLoaded 执行；此前为本地
  // 硬编码副本——全仓 5 份键副本之一，复审轮 P1-2）。
  let fmOrderState = []; // 面板内工作副本（renderFmOrder 重建）

  function renderFmOrder(savedOrder) {
    const list = document.getElementById('fmOrderList');
    const fm = globalThis.__GR_FM_KEYS__;
    if (!list || !fm) return;
    const valid = Array.isArray(savedOrder) ? savedOrder.filter((k) => fm.keys.includes(k)) : [];
    fmOrderState = [...valid];
    for (const k of fm.keys) if (!fmOrderState.includes(k)) fmOrderState.push(k); // 补缺失
    list.innerHTML = fmOrderState
      .map(
        (k, i) => `
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="flex:1;">${i + 1}. ${fm.labels[k]}</span>
        <button type="button" class="gr-btn gr-btn-sm fm-order-up" data-key="${k}" ${i === 0 ? 'disabled' : ''} title="上移">↑</button>
        <button type="button" class="gr-btn gr-btn-sm fm-order-down" data-key="${k}" ${i === fmOrderState.length - 1 ? 'disabled' : ''} title="下移">↓</button>
      </div>`
      )
      .join('');
  }

  function moveFmModule(key, delta) {
    const i = fmOrderState.indexOf(key);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= fmOrderState.length) return;
    [fmOrderState[i], fmOrderState[j]] = [fmOrderState[j], fmOrderState[i]];
    OPTS.currentSettings.floatModules = {
      ...(OPTS.currentSettings.floatModules || {}),
      order: [...fmOrderState]
    };
    renderFmOrder(fmOrderState);
    OPTS.scheduleAutoSave();
  }

  function bindFmOrderEvents() {
    const list = document.getElementById('fmOrderList');
    if (!list || list.dataset.grBound) return;
    list.dataset.grBound = '1';
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn || !btn.dataset.key) return;
      moveFmModule(btn.dataset.key, btn.classList.contains('fm-order-up') ? -1 : 1);
    });
    const resetBtn = document.getElementById('fmOrderReset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        delete OPTS.currentSettings.floatModules.order; // 未自定义语义 = 不写 order 键
        renderFmOrder(undefined);
        OPTS.scheduleAutoSave();
      });
    }
  }

  OPTS.bindFmOrderEvents = bindFmOrderEvents;
  OPTS.renderFmOrder = renderFmOrder;
})(typeof globalThis !== 'undefined' ? globalThis : this);
