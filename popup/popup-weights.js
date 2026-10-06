/**
 * 游戏雷达 Game Radar - Popup 权重滑块 / Popup Weight Sliders
 *
 * v14.3.0（第五轮 B6）：由 popup.js 拆分——动态十项权重滑块渲染与
 * 权重和指示（classic 脚本全局，popup.js 调用；change 直接全量保存权重）。
 * Dynamic weight sliders + sum indicator, split from popup.js.
 */

// ============ 权重渲染 / Weights ============
function renderWeights(weights) {
  const box = document.getElementById('ppWeights');
  if (!box) return;
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
  box.innerHTML = '';
  WEIGHT_KEYS.forEach(([key, label]) => {
    const row = document.createElement('div');
    row.className = 'ctrl-row';
    row.innerHTML = `<span class="ctrl-label">${label}</span>
      <div class="threshold-control">
        <input type="range" data-w="${key}" min="0" max="100" step="5">
        <span data-wv="${key}" class="threshold-value">0%</span>
      </div>`;
    box.appendChild(row);
    const slider = row.querySelector('[data-w]');
    slider.value = Math.round((weights[key] || 0) * 100);
    row.querySelector('[data-wv]').textContent = slider.value + '%';
    slider.addEventListener('input', (e) => {
      row.querySelector('[data-wv]').textContent = e.target.value + '%';
      updateWeightSum();
    });
    slider.addEventListener('change', async (e) => {
      const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_SETTINGS' });
      const latest = resp && resp.settings ? resp.settings : {};
      latest.weights = { ...(latest.weights || {}), [key]: Number(e.target.value) / 100 };
      const utils = globalThis.__GR_SETTINGS_UTILS__ || {};
      if (utils.applyPatch) utils.applyPatch(latest, { weights: latest.weights });
      await window.__GR_MSG__.sendMessage({ action: 'SAVE_SETTINGS', settings: latest });
      updateWeightSum();
    });
  });
  updateWeightSum();
}

function updateWeightSum() {
  const box = document.getElementById('ppWeights');
  const sumEl = document.getElementById('ppWeightSum');
  if (!box || !sumEl) return;
  let sum = 0;
  box.querySelectorAll('[data-w]').forEach((s) => {
    sum += Number(s.value) || 0;
  });
  sumEl.textContent = (sum / 100).toFixed(2);
}

// classic 脚本跨文件全局：挂 window 供 popup.js 调用
Object.assign(window, { renderWeights, updateWeightSum });
