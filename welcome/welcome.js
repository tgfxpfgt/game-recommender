/**
 * 游戏雷达 Game Radar - 欢迎页 / Welcome Page
 *
 * v7.4.0：安装（source=install）显示功能导览；更新（source=update）显示
 * What's new。由 SW runtime.onInstalled 打开；也可手动访问
 * welcome/welcome.html?source=install|update。
 * v14.1.0（第一轮 B6 补完）：首次安装分步引导——追踪站点 → 好评率过滤阈值 →
 * 主题 → 备份建议，完成后打开 dashboard。设置写入走 GET_SETTINGS +
 * SAVE_SETTINGS（扩展页特权路径；逐项修改基于最新设置合并，避免整包覆盖）。
 */
'use strict';

(function () {
  const manifest = /** @type {{version?: string}} */ (
    (chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest()) || {}
  );
  const ver = manifest.version || '';
  const verEl = document.getElementById('extVersion');
  if (verEl && ver) verEl.textContent = 'v' + ver;

  const source = new URLSearchParams(location.search).get('source') || 'install';
  const isUpdate = source === 'update';
  document.getElementById('installSection').classList.toggle('hidden', isUpdate);
  document.getElementById('updateSection').classList.toggle('hidden', !isUpdate);
  document.getElementById('welcomeSubtitle').textContent = isUpdate
    ? '已更新到新版本，看看有什么新变化'
    : '下载站好游戏，一眼看穿';

  document.getElementById('openHubBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'OPEN_HUB' }).catch(() => {});
    window.close();
  });
  document.getElementById('closeBtn').addEventListener('click', () => window.close());

  // ============ v14.1.0：首次安装分步引导 ============
  if (!isUpdate) {
    initGuide().catch(() => {});
  } else {
    document.getElementById('guideSection').classList.add('hidden');
  }

  /** @type {{trackedSitesTouched: boolean, uiTheme: string, enableFilter: boolean, minRating: number}} */
  const guideState = {
    trackedSitesTouched: false,
    uiTheme: 'steam',
    enableFilter: true,
    minRating: 90
  };

  async function initGuide() {
    document.getElementById('installSection').classList.add('hidden');
    document.getElementById('guideSection').classList.remove('hidden');

    // 步骤 1：站点状态检查
    try {
      const [settingsResp, rulesResp] = await Promise.all([
        window.__GR_MSG__.sendMessage({ action: 'GET_SETTINGS' }),
        window.__GR_MSG__.sendMessage({ action: 'GET_ADAPTER_RULES' })
      ]);
      const settings = (settingsResp && settingsResp.settings) || {};
      const rules = (rulesResp && (rulesResp.rules || rulesResp.sites)) || {};
      const sites = Array.isArray(rules.sites) ? rules.sites : [];
      const builtInDomains = [];
      for (const s of sites) {
        for (const d of Array.isArray(s.domains) ? s.domains : []) builtInDomains.push(d);
      }
      const tracked = Array.isArray(settings.trackedSites) ? settings.trackedSites : [];
      const statusEl = document.getElementById('guideSiteStatus');
      const enableBtn = document.getElementById('guideEnableAll');
      if (tracked.length > 0) {
        statusEl.innerHTML = `✅ 已启用 <b>${tracked.length}</b> 个站点（含自定义）`;
      } else {
        statusEl.innerHTML = '⚠️ 尚未启用任何站点';
        if (enableBtn && builtInDomains.length > 0) {
          enableBtn.style.display = '';
          enableBtn.addEventListener('click', async () => {
            await saveSettingsPatch({ trackedSites: [...new Set(builtInDomains)] });
            guideState.trackedSitesTouched = true;
            statusEl.innerHTML = `✅ 已启用 <b>${builtInDomains.length}</b> 个内置站点`;
            enableBtn.style.display = 'none';
          });
        }
      }
    } catch {
      const statusEl = document.getElementById('guideSiteStatus');
      if (statusEl) statusEl.textContent = '（读取设置失败——可稍后在设置中心配置）';
    }

    // 步骤 2：过滤阈值
    const filterCb = document.getElementById('guideFilterEnabled');
    const slider = document.getElementById('guideMinRating');
    const sliderVal = document.getElementById('guideMinRatingVal');
    filterCb.checked = guideState.enableFilter;
    slider.addEventListener('input', () => {
      sliderVal.textContent = slider.value + '%';
    });
    filterCb.addEventListener('change', () => {
      guideState.enableFilter = filterCb.checked;
      slider.disabled = !filterCb.checked;
    });

    // 步骤 3：主题（点击即预览）
    const themes = ['steam', 'ios17', 'cyberpunk', 'morandi'];
    const themeLabels = { steam: 'Steam 深蓝', ios17: 'iOS 17', cyberpunk: '赛博朋克', morandi: '莫兰迪' };
    const themeBox = document.getElementById('guideThemeBtns');
    themeBox.innerHTML = themes
      .map(
        (t) => `<button type="button" data-theme-pick="${t}" class="guide-theme-btn">${themeLabels[t] || t}</button>`
      )
      .join('');
    themeBox.querySelectorAll('[data-theme-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        guideState.uiTheme = btn.dataset.themePick;
        document.body.dataset.theme = guideState.uiTheme; // 即时预览
        themeBox.querySelectorAll('[data-theme-pick]').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
    themeBox.querySelector('[data-theme-pick="steam"]').classList.add('active');

    // 导航
    const steps = [1, 2, 3, 4].map((n) => document.getElementById('guideStep' + n));
    const dots = document.getElementById('guideDots');
    const prevBtn = document.getElementById('guidePrev');
    const nextBtn = document.getElementById('guideNext');
    let step = 0;
    const show = () => {
      steps.forEach((el, i) => el.classList.toggle('hidden', i !== step));
      dots.innerHTML = steps.map((_, i) => `<span class="dot${i === step ? ' on' : ''}"></span>`).join('');
      prevBtn.style.visibility = step === 0 ? 'hidden' : 'visible';
      nextBtn.textContent = step === steps.length - 1 ? '完成，打开面板 🚀' : '下一步';
    };
    prevBtn.addEventListener('click', () => {
      if (step > 0) {
        step--;
        show();
      }
    });
    nextBtn.addEventListener('click', async () => {
      if (step < steps.length - 1) {
        step++;
        show();
        return;
      }
      // 完成：收集两步的设置一次保存（site enable 已在点击时即时保存）
      guideState.minRating = parseInt(slider.value, 10) || 0;
      try {
        await saveSettingsPatch({
          enableRatingFilter: guideState.enableFilter,
          minSteamRatingFilter: guideState.minRating,
          uiTheme: guideState.uiTheme
        });
      } catch {
        /* 保存失败不阻断（用户可稍后在设置中心配置） */
      }
      window.location.href = chrome.runtime.getURL('dashboard/dashboard.html');
    });
    document.getElementById('guideSkipFeature').addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('guideSection').classList.add('hidden');
      document.getElementById('installSection').classList.remove('hidden');
    });
    show();
  }

  // 基于最新设置合并式保存（仅改动引导涉及的键，不整包覆盖其他并发修改）
  async function saveSettingsPatch(patch) {
    const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_SETTINGS' });
    const settings = (resp && resp.settings) || {};
    const merged = { ...settings, ...patch };
    await window.__GR_MSG__.sendMessage({ action: 'SAVE_SETTINGS', settings: merged });
  }
})();
