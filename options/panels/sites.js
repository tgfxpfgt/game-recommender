/**
 * 游戏雷达 Game Radar - 站点管理与数据源面板模块 / Sites & Data Sources Panel
 *
 * v14 B2：由 options.js 拆分——自定义站点添加（严格主机名校验 + 按需权限请求，
 * v10.5.0 P0-C）、数据源开关渲染（游戏平台 + 辅助站，v6.4.19）、Steam 数据
 * 获取模块开关、trackedSites/steamSiteSearch 与站点规则联动的保存映射收集。
 * Split from options.js (B2): custom-site management (strict hostname check +
 * optional permission request), data-source & Steam-API-module toggles, and the
 * tracked-sites save mapping merged with adapter rule domains.
 * 共享状态与保存方法经 window.__OPTS__ 访问（普通页面脚本顺序加载）。
 */
(function (global) {
  'use strict';

  const OPTS = (global.__OPTS__ = global.__OPTS__ || {});

  // ============ 自定义站点权限（v14.27.0 P2-5） ============
  // manifest 的 optional_host_permissions 仍保留 http/https 通配——Chrome 要求
  // permissions.request 的 origin 必须落在 optional 声明内，该通配只是"可按需
  // 申请任意域"的伞形声明；实际授予面 = 用户弹窗确认的那一个域。
  // The wildcard optional declaration only enables arbitrary-origin requests;
  // the granted surface is exactly the single host the user confirmed.
  /**
   * 待申请的 origin：指定协议只申请该协议，裸域名申请 http+https（匹配模式不含端口）。
   * @param {string} site @param {string} protocol
   * @returns {string[]}
   */
  function permissionOrigins(site, protocol) {
    if (protocol === 'http' || protocol === 'https') return [`${protocol}://${site}/*`];
    return [`http://${site}/*`, `https://${site}/*`];
  }

  /**
   * 用户手势内申请站点权限；返回是否可用（无 permissions API 时视为可用）。
   * Request the site permission inside the user gesture.
   * @param {string} site @param {string} protocol
   * @returns {Promise<boolean>}
   */
  function requestSitePermission(site, protocol) {
    const perms = globalThis.chrome && globalThis.chrome.permissions;
    if (!perms || !perms.request) return Promise.resolve(true);
    try {
      return Promise.resolve(perms.request({ origins: permissionOrigins(site, protocol) })).catch(() => false);
    } catch {
      return Promise.resolve(false);
    }
  }

  // ============ 自定义站点管理 / Custom Site Management ============
  function bindSiteManagement() {
    // 添加网站
    document.getElementById('addSite').addEventListener('click', () => {
      const input = document.getElementById('newSite');
      // v10.5.0 P0-C：归一 + 严格校验为裸主机名，绝不向 permissions.request 传入
      // 通配/协议/路径（否则会误授予宽范围 origin）
      // Normalize to a bare hostname and validate strictly so we never request a
      // wildcard / malformed origin (least privilege).
      let raw = input.value.trim().toLowerCase();
      let protocol = '';
      if (raw.includes('://')) {
        try {
          const url = new URL(raw);
          // v14.27.0 P2-5：匹配模式不支持端口（授权覆盖该域全部端口）→ 显式拒绝，
          // 避免"填了 8080 却按整域授权"的误解
          if (url.port) {
            window.alert('请勿填写端口：权限按域名授予，自动覆盖该域全部端口');
            return;
          }
          protocol = url.protocol.replace(':', '');
          raw = url.hostname;
        } catch {
          /* 解析失败保留原值，下面正则再拒 / keep raw on parse failure; regex rejects below */
        }
      } else {
        raw = raw.split('/')[0];
      }
      const SITE_HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
      const site = raw;
      if (!SITE_HOST_RE.test(site)) {
        window.alert('请输入合法域名（形如 example.com 或 localhost，禁止 * / 协议 / 路径 / 端口）');
        return;
      }
      if (site && !OPTS.currentSettings.trackedSites.includes(site)) {
        OPTS.currentSettings.trackedSites.push(site);
        // v6.3.0：host_permissions 已收窄到内置域名，自定义站点经
        // optional_host_permissions 按需请求权限（用户手势内调用）
        // v14.27.0 P2-5：只申请用户实填的域；拒绝则降级（站点保留但不生效）
        const pending = requestSitePermission(site, protocol);
        OPTS.renderSiteManagement(OPTS.currentSettings);
        input.value = '';
        OPTS.scheduleAutoSave();
        void pending.then((granted) => {
          if (!granted) {
            window.alert(`未授予 ${site} 的访问权限：站点已保存但功能不会生效（删除后重新添加可再次授权）`);
          }
        });
      }
    });

    document.getElementById('newSite').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') document.getElementById('addSite').click();
    });
  }

  // ============ 数据源开关（游戏平台 + 辅助站）/ Data Source Toggles ============
  // v6.4.19：数据源开关渲染
  function renderDataSources() {
    const box = document.getElementById('dataSourceList');
    if (!box) return;
    const ds = OPTS.currentSettings.dataSources || {};
    const items = [
      ['steam', 'Steam 官方', '评分 / 详情 / 限免'],
      ['epic', 'Epic Games 官方', '限免（官方接口）'],
      ['gog', 'GOG', '限免'],
      ['gamerpower', 'GamerPower 聚合', '限免聚合（Steam/GOG 主源）'],
      ['bing', 'Bing 搜索', '辅助：appid 匹配兜底']
    ];
    box.innerHTML = items
      .map(
        ([key, name, desc]) => `
        <div class="setting-row">
          <div class="setting-label">
            <span class="label-text">${name}</span>
            <span class="label-desc">${desc}</span>
          </div>
          <label class="switch">
            <input type="checkbox" data-ds="${key}" ${ds[key] !== false ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>`
      )
      .join('');
    box.querySelectorAll('[data-ds]').forEach((cb) => {
      cb.addEventListener('change', () => {
        OPTS.currentSettings.dataSources = {
          ...(OPTS.currentSettings.dataSources || {}),
          [cb.dataset.ds]: cb.checked
        };
        OPTS.scheduleAutoSave();
      });
    });
  }

  // v6.4.19：Steam 数据获取模块开关（各带缓存 TTL 建议）
  function renderSteamApiModules() {
    const box = document.getElementById('steamApiModulesList');
    if (!box) return;
    const mods = OPTS.currentSettings.steamApiModules || {};
    const ttls = OPTS.currentSettings.cacheTtls || {};
    const ttlText = (key) => {
      const t = ttls[key];
      if (!t) return '';
      return `缓存建议：${t.value || 0} ${t.unit || ''}${t.value === 0 ? '（长期）' : ''}`;
    };
    const items = [
      ['meta', '名称 / 封面 / 类型', 'appdetails 基础信息（核心，关闭后无法识别游戏）', 'metaSteam'],
      ['rating', '好评率（总 + 30 天）', 'appreviews 评测统计（关闭则不请求）', 'steamDynamic'],
      ['detail', '详情页完整信息', '商店页解析：语言支持 / 标签 / 更新日期', 'detailSteam'],
      ['spy', 'SteamSpy 补充', '游玩时长 / 热度（无官方替代）', 'spySteam']
    ];
    box.innerHTML = items
      .map(
        ([key, name, desc, ttlKey]) => `
        <div class="setting-row">
          <div class="setting-label">
            <span class="label-text">${name}</span>
            <span class="label-desc">${desc} · ${ttlText(ttlKey)}</span>
          </div>
          <label class="switch">
            <input type="checkbox" data-mod="${key}" ${mods[key] !== false ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>`
      )
      .join('');
    box.querySelectorAll('[data-mod]').forEach((cb) => {
      cb.addEventListener('change', () => {
        OPTS.currentSettings.steamApiModules = {
          ...(OPTS.currentSettings.steamApiModules || {}),
          [cb.dataset.mod]: cb.checked
        };
        OPTS.scheduleAutoSave();
      });
    });
  }

  // ============ v14.16.0 N9：内置站独立开关（隐私最小化） ============
  // 关闭站 = 零功能分发（tracker initPage 前收口；静态注入为 MV3 沉没成本）。
  const BUILTIN_SITE_TOGGLES = [
    ['xdgame.com', 'XDGame'],
    ['xianyudanji.gg', '咸鱼单机'],
    ['gamer520.com', 'Gamer520'],
    ['3dmgame.com', '3DM'],
    ['ali213.net', '游侠网'],
    ['gamersky.com', '游民星空']
  ];
  function renderBuiltinSiteToggles() {
    const box = document.getElementById('builtinSiteList');
    if (!box) return;
    const disabled = OPTS.currentSettings.disabledSites || [];
    box.innerHTML = BUILTIN_SITE_TOGGLES.map(
      ([domain, name]) => `
      <div class="setting-row">
        <div class="setting-label">
          <span class="label-text">${name}</span>
          <span class="label-desc">${domain}（关闭后不注入不查评分）</span>
        </div>
        <label class="switch">
          <input type="checkbox" data-builtin-site="${domain}" ${disabled.includes(domain) ? '' : 'checked'}>
          <span class="slider"></span>
        </label>
      </div>`
    ).join('');
    box.querySelectorAll('[data-builtin-site]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const set = new Set(OPTS.currentSettings.disabledSites || []);
        if (cb.checked) set.delete(cb.dataset.builtinSite);
        else set.add(cb.dataset.builtinSite);
        OPTS.currentSettings.disabledSites = [...set];
        OPTS.scheduleAutoSave();
      });
    });
  }

  function bindDataSourceToggles() {
    renderDataSources();
    renderSteamApiModules();
    renderBuiltinSiteToggles();
  }

  // ============ 站点收集保存映射 / Tracked-Sites Save Mapping ============
  // 下载站与追踪管理（合并后的统一配置入口）——由 options.js saveSettings 调用
  function collectSitesSettings() {
    const rules = (OPTS.siteRules || {}).sites || [];
    const customSites = (OPTS.currentSettings.trackedSites || []).filter(
      (d) => !rules.some((s) => Array.isArray(s.domains) && s.domains.some((x) => d === x || d.includes(x)))
    ); // v10.9：domains 异型守卫
    const ruleTracked = [...document.querySelectorAll('.track-site-check:checked')].map((cb) => cb.dataset.domain);
    OPTS.currentSettings.trackedSites = [...new Set([...customSites, ...ruleTracked])];
    OPTS.currentSettings.steamSiteSearch = [...document.querySelectorAll('.steam-site-check:checked')].map(
      (cb) => cb.dataset.site
    );
  }

  OPTS.bindSiteManagement = bindSiteManagement;
  OPTS.bindDataSourceToggles = bindDataSourceToggles;
  OPTS.collectSitesSettings = collectSitesSettings;
})(typeof globalThis !== 'undefined' ? globalThis : this);
