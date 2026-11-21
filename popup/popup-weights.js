/**
 * 游戏雷达 Game Radar - Popup 权重滑块 / Popup Weight Sliders
 *
 * v14.3.0（第五轮 B6）：由 popup.js 拆分——动态十项权重滑块渲染与
 * 权重和指示（classic 脚本全局，popup.js 调用；change 直接全量保存权重）。
 * Dynamic weight sliders + sum indicator, split from popup.js.
 * v15 阶段 3 全量迁移：滑块行 Preact h() 渲染（innerHTML 2 处退役；
 * input/change 事件经 props 直连）。
 */

// ============ 权重渲染 / Weights ============
/** @param {Record<string, any>} weights */
function renderWeights(weights) {
  const box = document.getElementById('ppWeights');
  if (!box) return;
  const PP = /** @type {any} */ (globalThis).__GR_PREACT__;
  const WEIGHT_KEYS = [
    ['clickRate', '点击率'],
    ['downloadRate', '下载率'],
    ['keywordMatch', '关键词'],
    ['steamRating', 'Steam 好评'],
    ['playTime', '游玩时长'],
    ['heat', '热度'],
    ['sales', '销量'],
    ['reviews', '评论数'],
    ['appStatDownload', '下载计数 a'],
    ['appStatDetailView', '未下载惩罚 b']
  ];
  const rows = WEIGHT_KEYS.map(([key, label]) =>
    PP.h(
      'div',
      { class: 'ctrl-row', key },
      PP.h('span', { class: 'ctrl-label' }, label),
      PP.h(
        'div',
        { class: 'threshold-control' },
        PP.h('input', {
          type: 'range',
          'data-w': key,
          min: '0',
          max: '100',
          step: '5',
          value: String(Math.round((weights[key] || 0) * 100)),
          onInput: (/** @type {any} */ ev) => {
            const wv = box.querySelector(`[data-wv="${key}"]`);
            if (wv) wv.textContent = ev.target.value + '%';
            updateWeightSum();
          },
          onChange: async (/** @type {any} */ ev) => {
            try {
              const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_SETTINGS' });
              const latest = resp && resp.settings ? resp.settings : {};
              latest.weights = {
                ...(latest.weights || {}),
                [key]: Number(ev.target.value) / 100
              };
              const utils = globalThis.__GR_SETTINGS_UTILS__ || {};
              if (utils.applyPatch) utils.applyPatch(latest, { weights: latest.weights });
              await window.__GR_MSG__.sendMessage({ action: 'SAVE_SETTINGS', settings: latest });
              updateWeightSum();
            } catch (err) {
              // v14.12 B10（报告 C P2-03）：保存失败不再静默
              console.warn('权重保存失败:', err);
            }
          }
        }),
        PP.h('span', { 'data-wv': key, class: 'threshold-value' }, '0%')
      )
    )
  );
  PP.render(PP.h(PP.Fragment, null, rows), box);
  // 初始阈值文案（渲染后按实际值回填——与原 appendChild 后同步赋值一致）
  box.querySelectorAll('[data-w]').forEach((/** @type {any} */ s) => {
    const wv = s.closest('.threshold-control') && s.closest('.threshold-control').querySelector('[data-wv]');
    if (wv) wv.textContent = s.value + '%';
  });
  updateWeightSum();
}

function updateWeightSum() {
  const box = document.getElementById('ppWeights');
  const sumEl = document.getElementById('ppWeightSum');
  if (!box || !sumEl) return;
  let sum = 0;
  box.querySelectorAll('[data-w]').forEach((/** @type {any} */ s) => {
    sum += Number(s.value) || 0;
  });
  sumEl.textContent = (sum / 100).toFixed(2);
}

// classic 脚本跨文件全局：挂 window 供 popup.js 调用
Object.assign(window, { renderWeights, updateWeightSum });
