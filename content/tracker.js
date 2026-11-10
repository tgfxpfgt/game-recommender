/**
 * 游戏雷达 Game Radar - 内容脚本入口（装载器）/ Content Script Entry (Loader)
 *
 * v6.0.0：内容脚本 ESM 化（动态 import 路径）——Chrome content_scripts 官方
 * 不支持原生 ESM，本入口保持经典脚本，内部 await import() 并行加载模块
 *（模块间依赖由 ESM import 图显式表达，替代旧 __GR__ 全局命名空间）。
 * v14.5.0 B7：装载器瘦身——仅保留"模块加载（boot）+ 预热 + 消息接线 + 启动
 * 触发 + 更新自检"；页面检测/分发迁 core/page-init.js（M.pageInit），入站
 * 消息处理器迁 core/messages.js（M.messages，薄监听排队 + boot 后冲放）。
 * B7 slim-down: loader only — module loading, warm-up, message wiring,
 * startup trigger and the update self-check.
 */
(function () {
  'use strict';

  if (window.__gameRecommenderTracker) return;
  window.__gameRecommenderTracker = true;

  // ============ 模块加载（动态 import，零构建） ============
  // v8.2.0：JSDoc 类型化——MODULES 形状固定，`M.float` 类键名错误编译期可捕获
  /**
   * @typedef {{
   *   common: any, floats: any, status: any, debug: any, builder: any,
   *   badges: any, listBatch: any, list: any, listState: any,
   *   detailTemplates: any, detail: any, tracking: any,
   *   messages: any, pageInit: any,
   *   qrUnlock: any, xdgrid: any
   * }} GRModules
   */
  /** @type {GRModules|null} */
  let MODULES = null;

  // v14.26.0（优化方案 P1-3）：按页面场景分流装载——列表页不装载详情域
  //（sidebar/candidates ~80KB），详情页不装载列表域（徽章/批次 ~80KB）。
  // 判定仅用 URL（core/page-url.js），粗判失误由 ensureScope 在分发时补齐。
  // Scope-based loading: a list page never evaluates the detail cluster and
  // vice versa; a coarse URL guess is repaired on demand by ensureScope().
  const MODULE_KEYS = [
    'common',
    'floats',
    'status',
    'debug',
    'builder',
    'badges',
    'listBatch',
    'list',
    'listState',
    'detailTemplates',
    'detail',
    'tracking',
    'messages',
    'pageInit',
    'qrUnlock',
    'xdgrid'
  ];
  /** @type {Map<string, Promise<any>>} 文件 → 装载 Promise（去重，故并行安全） */
  const loadPromises = new Map();
  /** @type {any} 清单与设置缓存（ensureScope 补加载时复用） */
  let manifestCache = null;
  let settingsCache = null;

  /** 全键空壳（未装载的键 = null，便于调用方判存在）@returns {GRModules} */
  function emptyModules() {
    MODULES = /** @type {GRModules} */ (Object.fromEntries(MODULE_KEYS.map((k) => [k, null])));
    return MODULES;
  }

  /** 装载单个模块文件（同一文件只评估一次）@param {string} file @returns {Promise<any>} */
  function loadOne(file) {
    let p = loadPromises.get(file);
    if (!p) {
      p = import(chrome.runtime.getURL(file));
      loadPromises.set(file, p);
    }
    return p;
  }

  /**
   * 装载与 scope 匹配的模块集合（已装载的键跳过）
   * @param {'list'|'detail'|'both'} scope
   */
  async function loadScope(scope) {
    const mods0 = MODULES || emptyModules();
    const { CORE_MODULES, OPTIONAL_MODULES } = (manifestCache ??= await import(
      chrome.runtime.getURL('content/module-manifest.js')
    ));
    const targets = [...CORE_MODULES, ...OPTIONAL_MODULES].filter((mod) => {
      if (mods0[mod.key]) return false;
      // 可选模块开关关闭 → 代码零加载（settings 缺失视为开）
      if (mod.setting && settingsCache && settingsCache[mod.setting] === false) return false;
      return mod.scope === 'all' || scope === 'both' || mod.scope === scope;
    });
    const loaded = await Promise.all(targets.map((mod) => loadOne(mod.file)));
    targets.forEach((mod, i) => {
      mods0[mod.key] = loaded[i];
    });
    return mods0;
  }

  /**
   * 按需补加载指定场景模块（页面分发自愈兜底）
   * @param {'list'|'detail'|'both'} scope
   * @returns {Promise<GRModules>}
   */
  async function ensureScope(scope) {
    return loadScope(scope);
  }

  // v9.1.0：boot 计时（性能基线）
  const BOOT_T0 = Date.now();
  // ============ 预热（模块加载 + 设置/规则并行） ============
  // Warm-up: module load, settings and site rules all run in parallel.
  const bootPromise = (async () => {
    // v10.4.4：设置先行——可选模块的加载与否取决于开关状态
    const settingsEarly = await (async () => {
      try {
        const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_SETTINGS' }, null, { timeout: 3000 });
        return resp?.settings || null;
      } catch {
        return null; // 后台不可达时 init 会自行重试
      }
    })();
    settingsCache = settingsEarly;
    // v14.26.0 P1-3：URL 粗判场景 → 只装载该侧模块集（未知结构 = both）
    let scope = /** @type {'list'|'detail'|'both'} */ ('both');
    try {
      const pageUrl = await import(chrome.runtime.getURL('content/core/page-url.js'));
      scope = pageUrl.detectPageScope(location.hostname, location.pathname, location.search);
    } catch {
      /* 判定失败 → both（与旧全量装载等价） */
    }
    const M = await ensureScope(scope);
    try {
      await M.builder.loadSiteRules();
      M.builder.buildSiteAdapters(M.builder.getSITE_RULES());
    } catch {
      /* 规则加载失败时回退内置规则 */
    }
    // v9.1.0：boot 完成 → Perf 日志上报（后台落盘 runtimeLog，可脚本分析）
    try {
      window.__GR_MSG__
        .sendMessage(
          { action: 'LOG_PERF', source: 'content-boot', metric: location.hostname, durationMs: Date.now() - BOOT_T0 },
          null,
          { timeout: 2000 }
        )
        .catch(() => {});
    } catch {
      /* 忽略上报失败 */
    }
    return { M, settings: settingsEarly, ensureScope };
  })();
  // v8.2.0：boot 就绪信号（测试等待模块+预热完成——推送不再走延迟路径）
  window.__grBootPromise = bootPromise;

  // ============ 消息接线（薄监听 + boot 后路由） ============
  // v14.5.0 B7：处理器在 core/messages.js（M.messages.createMessageRouter）。
  // 模块装载完成前的早到消息排队（保持通道），boot 后统一冲放——与原实现
  // "MODULES 就绪直处理 / 否则 bootPromise.then"语义等价。
  // v14.6.2 修复：B8 竞态排查期间一段"[临时实验]"内联处理代码曾随重构提交——
  // 它把 boot 前到达的**任何 action** 都当 STEAM_RATINGS_UPDATE 处理并谎报
  // success（REFRESH_RECOMMENDATIONS/FORCE_REFRESH 等语义丢失），且本排队数组
  // 从未入队（冲放机制死亡）。真因已在 messages.js 的 readyM() 同步快路径
  // 修复，实验代码删除、还原排队语义。
  // Early messages queue (channel held) until the router is wired post-boot.
  /** @type {Function|null} */
  let route = null;
  let bootFailed = false; // v14.8 批次 7：boot 失败后新消息直接错误应答（不再无限排队）
  /** @type {Array<[any, any, Function]>} */
  const queued = [];
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (route) return route(message, sender, sendResponse);
    // v14.8 批次 7：boot 已失败 → 错误应答（防静默悬空与队列无界增长）
    if (bootFailed) {
      try {
        sendResponse({ error: 'boot-failed: 模块装载失败，页面功能不可用' });
      } catch {
        /* 应答失败忽略 */
      }
      return true;
    }
    queued.push([message, sender, sendResponse]);
    return true; // 排队等待冲放 / queued until flush
  });
  bootPromise
    .then(({ M }) => {
      const r = M.messages.createMessageRouter({
        bootPromise,
        getModules: () => MODULES,
        ensureScope
      });
      route = r;
      queued.splice(0).forEach(([m, s, res]) => r(m, s, res));
    })
    .catch((e) => {
      // v14.8 批次 7：boot 失败 → 排队消息逐条错误应答后清队（原实现静默
      // 悬空——sendResponse 永不调用，页面功能瘫痪无诊断信号）
      bootFailed = true;
      const pending = queued.splice(0);
      for (const [, , res] of pending) {
        try {
          res({ error: 'boot-failed: ' + String(e) });
        } catch {
          /* 应答失败忽略 */
        }
      }
      console.error('【游戏雷达】 boot 失败，已应答 ' + pending.length + ' 条排队消息');
    });

  // ============ Startup / 启动 ============
  // document_start 注入：boot（模块加载+预热）已在顶层并行执行，DOM 就绪立即
  // init（无额外延迟）。Injected at document_start: boot (module load + warm-up)
  // already runs in parallel; init fires as soon as the DOM is ready.
  // v14.5.0 B7：页面检测与功能分发在 core/page-init.js（M.pageInit.initPage）。
  const startInit = () => {
    bootPromise
      .then((boot) => {
        // v14.16.0 N9：内置站独立开关——用户关闭的站点零功能（boot 已完成的
        // 模块装载是静态注入的沉没成本，功能分发在此收口；隐私最小化诉求）
        const disabled = (boot.settings && boot.settings.disabledSites) || [];
        const host = location.hostname.replace(/^www\./, '');
        if (disabled.some((d) => host === d || host.endsWith('.' + d))) {
          console.debug('[游戏雷达] 站点已禁用（disabledSites）——跳过功能分发:', host);
          return;
        }
        return boot.M.pageInit.initPage(boot);
      })
      .catch((e) => console.warn('【游戏雷达】 初始化失败:', e));
  };
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    startInit();
  } else {
    window.addEventListener('DOMContentLoaded', startInit, { once: true });
  }

  // ============ 扩展更新自检（v7.3.0：旧版本问题根治） ============
  // Extension update self-check: compare the last injected version against the
  // manifest version; on change, show a one-time toast asking for a page
  // refresh. Content scripts of an updated extension do NOT re-inject into
  // already-open tabs, so a stale page silently runs old logic — the root
  // cause of many "settings not saving" reports.
  // v14.5.0 B7：chrome.storage.local 直调收敛至 common 封装（storageLocalGet/Set）。
  const EXT_VER_KEY = 'extLastInjectedVersion';
  async function checkExtensionUpdate() {
    try {
      const ver = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '';
      if (!ver) return;
      const m = (p) => chrome.runtime.getURL(p);
      const common = await import(m('content/core/common.js'));
      const last = await common.storageLocalGet(EXT_VER_KEY);
      if (last && last !== ver) showUpdateToast(ver);
      if (last !== ver) await common.storageLocalSet(EXT_VER_KEY, ver);
    } catch {
      /* 存储不可用时静默（不影响主流程） */
    }
  }

  function showUpdateToast(ver) {
    try {
      if (document.getElementById('gr-update-toast')) return;
      const toast = document.createElement('div');
      toast.id = 'gr-update-toast';
      toast.textContent = `游戏雷达已更新至 v${ver}，刷新页面后生效（当前页仍为旧版本）`;
      const refresh = document.createElement('button');
      refresh.type = 'button';
      refresh.textContent = '刷新';
      refresh.addEventListener('click', () => window.location.reload());
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'gr-update-close';
      close.textContent = '✕';
      close.addEventListener('click', () => toast.remove());
      toast.appendChild(refresh);
      toast.appendChild(close);
      (document.documentElement || document.body).appendChild(toast);
    } catch {
      /* DOM 未就绪或样式异常时静默 */
    }
  }

  // 顶层立即执行（document_start 阶段 html 元素已存在）
  void checkExtensionUpdate();
})();
