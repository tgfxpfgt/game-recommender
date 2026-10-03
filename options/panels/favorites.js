/**
 * 游戏雷达 Game Radar - 收藏折扣与周报面板模块 / Favorites & Digest Panel
 *
 * v14 B2：由 options.js 拆分——ITAD 多套 API 配置管理（添加/切换激活/删除/
 * 测试激活项/脱敏显示，v6.4.19）与收藏折扣监控/周报开关的保存映射收集
 * （v11.0 B3 / v13 B9）。
 * Split from options.js (B2): ITAD multi-profile key management and the
 * favorite-price-watch / weekly-digest save mapping collector.
 * 共享状态与保存方法经 window.__OPTS__ 访问（普通页面脚本顺序加载）。
 */
(function (global) {
  'use strict';

  const OPTS = (global.__OPTS__ = global.__OPTS__ || {});

  // v6.4.19：密钥脱敏显示（保留末 4 位）/ Mask API key (keep last 4 chars)
  function maskKey(key) {
    if (!key) return '';
    const k = String(key);
    return k.length <= 4 ? '••••' : '••••' + k.slice(-4);
  }

  // ============ ITAD 多套配置管理 / ITAD Multi-Profile Management ============
  // v6.4.19：添加/切换激活/删除（限免校验使用）
  function renderItadProfiles() {
    const box = document.getElementById('itadProfileList');
    if (!box) return;
    const profiles = OPTS.currentSettings.itadProfiles || [];
    const activeId = OPTS.currentSettings.itadActiveProfileId;
    box.innerHTML = '';
    if (profiles.length === 0) {
      box.innerHTML =
        '<div style="font-size:12px;color:#8f98a0;">暂无配置——上方添加（可选）。未配置时跳过 ITAD 校验</div>';
      return;
    }
    profiles.forEach((p, idx) => {
      const isActive = String(p.id) === String(activeId) || (!activeId && idx === 0);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:6px;';
      row.innerHTML = `<label class="check-item" style="flex:0 0 auto;" title="设为激活配置（限免校验使用）">
            <input type="radio" name="itadActive" data-act="${idx}" ${isActive ? 'checked' : ''}>
          </label>
          <span style="min-width:80px;font-size:12.5px;color:${isActive ? '#66c0f4' : 'inherit'};font-weight:${isActive ? '700' : '400'};">${escapeHtml(p.name || '配置 ' + (idx + 1))}${isActive ? ' ⭐' : ''}</span>
          <span style="font-size:10.5px;color:#5a6a7a;white-space:nowrap;">${p.createdAt ? '添加于 ' + new Date(p.createdAt).toLocaleDateString('zh-CN') : ''}</span>
          <code style="font-size:12px;color:#8f98a0;">${maskKey(p.key)}</code>
          <button class="btn btn-danger btn-sm" data-rdel="${idx}" style="margin-left:auto;">删除</button>`;
      box.appendChild(row);
      row.querySelector('[data-act]').addEventListener('change', () => {
        OPTS.currentSettings.itadActiveProfileId = p.id;
        OPTS.scheduleAutoSave();
        renderItadProfiles();
      });
      row.querySelector('[data-rdel]').addEventListener('click', () => {
        const profiles2 = (OPTS.currentSettings.itadProfiles || []).filter((_, i) => i !== idx);
        OPTS.currentSettings.itadProfiles = profiles2;
        if (String(OPTS.currentSettings.itadActiveProfileId) === String(p.id)) {
          OPTS.currentSettings.itadActiveProfileId = profiles2.length > 0 ? profiles2[0].id : null;
        }
        OPTS.scheduleAutoSave();
        renderItadProfiles();
      });
    });
  }

  function bindItadProfiles() {
    document.getElementById('itadAddBtn').addEventListener('click', () => {
      const name = document.getElementById('itadNewName').value.trim();
      const key = document.getElementById('itadNewKey').value.trim();
      if (!key) {
        document.getElementById('itadTestResult').textContent = '⚠️ 请输入 API Key';
        return;
      }
      const id = 'p' + Date.now();
      // v7.1.0：记录创建时间（凭证卫生——轮换提示依据）
      const profiles = [
        ...(OPTS.currentSettings.itadProfiles || []),
        {
          id,
          name: name || '配置 ' + ((OPTS.currentSettings.itadProfiles || []).length + 1),
          key,
          createdAt: Date.now()
        }
      ];
      OPTS.currentSettings.itadProfiles = profiles;
      OPTS.currentSettings.itadActiveProfileId = OPTS.currentSettings.itadActiveProfileId || id;
      document.getElementById('itadNewName').value = '';
      document.getElementById('itadNewKey').value = '';
      document.getElementById('itadTestResult').textContent = '✅ 已添加并设为激活';
      OPTS.scheduleAutoSave();
      renderItadProfiles();
    });
    document.getElementById('itadTestBtn').addEventListener('click', async () => {
      const result = document.getElementById('itadTestResult');
      const profiles = OPTS.currentSettings.itadProfiles || [];
      const active =
        profiles.find((p) => String(p.id) === String(OPTS.currentSettings.itadActiveProfileId)) || profiles[0];
      if (!active || !active.key) {
        result.textContent = '⚠️ 暂无配置，请先添加';
        return;
      }
      result.textContent = '测试中...';
      try {
        const r = await fetch(
          'https://api.isthereanydeal.com/v02/game/prices/?key=' + encodeURIComponent(active.key) + '&appids=steam/730'
        );
        // v7.1.0：失效时提示轮换（凭证卫生）
        if (r.status === 200) result.textContent = `✅ 「${active.name || '配置'}」Key 有效`;
        else if (r.status === 401 || r.status === 403)
          result.textContent = `❌ 「${active.name || '配置'}」Key 已失效——建议删除后重新添加（轮换）`;
        else result.textContent = '⚠️ 服务异常（' + r.status + '）';
      } catch {
        result.textContent = '❌ 网络错误';
      }
    });
    renderItadProfiles();
  }

  // ============ 收藏折扣监控 / 周报保存映射 / Favorites & Digest Save Mapping ============
  // v11.0 B3 / v13 B9：由 options.js saveSettings 调用（DOM → currentSettings）
  function collectFavoriteSettings() {
    OPTS.currentSettings.favoritePriceWatch = document.getElementById('favoritePriceWatch').checked;
    const favTh = parseInt(document.getElementById('favoriteDiscountThreshold').value);
    OPTS.currentSettings.favoriteDiscountThreshold =
      Number.isInteger(favTh) && favTh >= 50 && favTh <= 100 ? favTh : 80;
    OPTS.currentSettings.weeklyDigestEnabled = document.getElementById('weeklyDigestEnabled').checked; // v13 B9
  }

  OPTS.bindItadProfiles = bindItadProfiles;
  OPTS.collectFavoriteSettings = collectFavoriteSettings;
})(typeof globalThis !== 'undefined' ? globalThis : this);
