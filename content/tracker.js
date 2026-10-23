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

  // v10.4.4：可选模块按设置条件导入——关闭后**模块代码完全不加载**
  //（资源占用需求）；settings 为 null（SW 冷启动超时）时默认全加载，
  // init 的重试路径会补齐设置
  // v10.7.0 批次4：模块清单由 content/module-manifest.js 单源驱动（原 12+2
  // 个 import 字面量与测试/校验两处手工同步）
  async function ensureModules(settings) {
    if (MODULES) return MODULES;
    // 逐模块 getURL（动态 import 的 URL 由浏览器解析；测试环境 getURL 可 mock）
    const m = (p) => chrome.runtime.getURL(p);
    const { CORE_MODULES, OPTIONAL_MODULES } = await import(m('content/module-manifest.js'));
    const coreMods = await Promise.all(CORE_MODULES.map((mod) => import(m(mod.file))));
    const loaded = {}; // v14 B5：checkJs 进化对象类型，无需 any 断言
    CORE_MODULES.forEach((mod, i) => {
      loaded[mod.key] = coreMods[i];
    });
    // 可选模块（开关默认开；settings 缺失视为开）
    await Promise.all(
      OPTIONAL_MODULES.map(async (mod) => {
        if (settings && settings[mod.setting] === false) return;
        loaded[mod.key] = await import(m(mod.file));
      })
    );
    MODULES = {
      common: loaded.common,
      floats: loaded.floats,
      status: loaded.status,
      debug: loaded.debug,
      builder: loaded.builder,
      badges: loaded.badges,
      listBatch: loaded.listBatch,
      list: loaded.list,
      listState: loaded.listState,
      detailTemplates: loaded.detailTemplates,
      detail: loaded.detail,
      tracking: loaded.tracking,
      messages: loaded.messages, // v14.5.0 B7：消息路由域
      pageInit: loaded.pageInit, // v14.5.0 B7：页面检测与分发域
      qrUnlock: loaded.qrUnlock || null,
      xdgrid: loaded.xdgrid || null
    };
    return MODULES;
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
    const M = await ensureModules(settingsEarly);
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
    return { M, settings: settingsEarly };
  })();
  // v8.2.0：boot 就绪信号（测试等待模块+预热完成——推送不再走延迟路径）
  window.__grBootPromise = bootPromise;

  // ============ 消息接线（薄监听 + boot 后路由） ============
  // v14.5.0 B7：处理器在 core/messages.js（M.messages.createMessageRouter）。
  // 模块装载完成前的早到消息排队（保持通道），boot 后统一冲放——与原实现
  // "MODULES 就绪直处理 / 否则 bootPromise.then"语义等价。
  // Early messages queue (channel held) until the router is wired post-boot.
  /** @type {Function|null} */
  let route = null;
  /** @type {Array<[any, any, Function]>} */
  const queued = [];
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (route) return route(message, sender, sendResponse);
    // [临时实验] 排队消息改为同步内联处理（绕过 bootPromise 路由）
    (async () => {
      const { M } = await bootPromise;
      M.list.applySteamRatingsUpdate(message.ratings, message.done === true);
      sendResponse({ success: true });
    })().catch(() => sendResponse({ success: false }));
    return true;
  });
  bootPromise
    .then(({ M }) => {
      const r = M.messages.createMessageRouter({ bootPromise, getModules: () => MODULES });
      route = r;
      queued.splice(0).forEach(([m, s, res]) => r(m, s, res));
    })
    .catch(() => {});

  // ============ Startup / 启动 ============
  // document_start 注入：boot（模块加载+预热）已在顶层并行执行，DOM 就绪立即
  // init（无额外延迟）。Injected at document_start: boot (module load + warm-up)
  // already runs in parallel; init fires as soon as the DOM is ready.
  // v14.5.0 B7：页面检测与功能分发在 core/page-init.js（M.pageInit.initPage）。
  const startInit = () => {
    bootPromise
      .then((boot) => boot.M.pageInit.initPage(boot))
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
