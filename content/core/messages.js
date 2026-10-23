/**
 * 游戏雷达 Game Radar - 内容侧消息路由 / Content Message Router
 *
 * v14.5.0 B7：由 tracker.js 消息监听迁出——四类入站消息（推荐刷新/最近统计
 * 重显/好评率推送/强制刷新）的处理器收敛于此；tracker 保留薄监听（模块未
 * 就绪时排队、boot 后接线冲放），装载行为与消息语义不变。
 * Inbound message handlers moved from tracker.js (B7); tracker keeps a thin
 * listener that queues early messages and wires the router after boot —
 * semantics unchanged.
 */

/**
 * 创建消息路由器（tracker boot 完成后接线）
 * @param {{bootPromise: Promise<{M: any, settings: any}>, getModules: () => any}} ctx
 * @returns {(message: any, sender: any, sendResponse: Function) => boolean|undefined}
 */
export function createMessageRouter({ bootPromise, getModules }) {
  // 统一取模块句柄：MODULES 就绪直取，否则等 boot（与原监听器双路径等价）
  const getM = async () => {
    const mods = getModules();
    if (mods && mods.status) return mods;
    const boot = await bootPromise;
    return boot.M;
  };
  // 推送类消息的就绪快路径：MODULES 就绪时**同步**应用（B7 前语义）——
  // 经 getM 的微任务延迟会让并发批次收尾（finishRatings）抢先终止 job，
  // 迟到推送被 ratingsJob 空值守卫静默丢弃（节 2/2b 竞态的根源）。
  // Push fast path: apply synchronously when modules are ready (pre-B7
  // semantics) — a microtask hop lets concurrent batch finalization win.
  /** @returns {{M: any}|null} */
  const readyM = () => {
    const mods = getModules();
    return mods && mods.status ? { M: mods } : null;
  };

  return function route(message, sender, sendResponse) {
    if (message.action === 'REFRESH_RECOMMENDATIONS') {
      // 刷新推荐需要 settings 来读取高亮阈值，并应用虚拟机过滤
      (async () => {
        try {
          const M = await getM();
          const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_SETTINGS' });
          const settings = resp?.settings;
          if (!settings) {
            sendResponse({ success: false });
            return;
          }
          const adapter = M.builder.getAdapter();
          // v10.5.3 任务2：首页不响应推荐刷新（首页无列表功能，防止徽章
          // 经消息通道错位注入）/ skip on homepages (no list features there)
          if (!M.list.isHomePageUrl() && (M.list.isListPageByUrl() || adapter.isListPage())) {
            let items = M.list.getListItemsSmart(adapter);
            // 应用关键词过滤规则（若已启用；v7.2.0 修正参数——原传 vmFilterKeywords 数组）
            if (settings.enableVmFilter) {
              items = M.list.applyVmFilter(items, settings);
            }
            M.list.requestRecommendations(items, settings);
          }
          sendResponse({ success: true });
        } catch (e) {
          sendResponse({ success: false, error: String(e) });
        }
      })();
      return true; // 异步响应 / Async response
    }
    if (message.action === 'SHOW_LAST_STATS') {
      // 弹窗请求重新显示最近一次统计 / Popup asks to re-show the latest stats
      const ready = readyM();
      if (ready) {
        try {
          ready.M.status.showLastStats();
        } catch (e) {
          console.warn('【游戏雷达】 最近统计重显失败:', e);
        }
      } else {
        getM()
          .then((M) => M.status.showLastStats())
          .catch(() => {});
      }
      sendResponse({ success: true });
      return; // 同步响应，无需保持消息通道 / sync response, no channel held
    }
    if (message.action === 'STEAM_RATINGS_UPDATE') {
      // 后台推送：缓存未命中的游戏已从 Steam 拉取完成（多波增量，done 标记收尾）
      // Background push: cache misses fetched from Steam (incremental waves + done)
      // 就绪快路径同步应用（徽章即时渲染，B7 前语义）；boot 未完成走延迟路径
      const ready = readyM();
      if (ready) {
        try {
          ready.M.list.applySteamRatingsUpdate(message.ratings, message.done === true);
        } catch (e) {
          // v6.4.10：推送处理错误可见（此前静默吞错——偶发状态下徽章丢失难排查）
          console.warn('【游戏雷达】 好评率推送处理失败:', e);
        }
      } else {
        bootPromise
          .then(({ M }) => M.list.applySteamRatingsUpdate(message.ratings, message.done === true))
          .catch((e) => {
            console.warn('【游戏雷达】 好评率推送处理失败:', e);
          });
      }
      sendResponse({ success: true });
      return; // 同步响应，无需保持消息通道 / sync response, no channel held
    }
    if (message.action === 'FORCE_REFRESH_PAGE') {
      // popup 强制刷新：收集当前页游戏引用 → 后台清除对应 Steam 缓存（忽视
      // 缓存有效期与 0 评测冷却）→ 重载页面后全部重新获取
      (async () => {
        try {
          const M = await getM();
          const names = new Set();
          const appIds = new Set();
          if (M.list.isDetailPageByUrl()) {
            const gn = M.detail.detectGameName();
            if (gn && gn.length > 1) names.add(gn);
            const img = M.builder.extractSteamImageInfo(document);
            if (img) appIds.add(img.appId);
          } else {
            const adapter = M.builder.getAdapter();
            if (M.list.isListPageByUrl() || adapter.isListPage()) {
              M.list.getListItemsSmart(adapter).forEach((item) => {
                if (item.name) names.add(item.name);
                const info = M.builder.extractSteamImageInfo(item.element);
                if (info) appIds.add(info.appId);
              });
            }
          }
          const resp = await window.__GR_MSG__.sendMessage({
            action: 'CLEAR_CACHE_FOR_PAGE',
            names: [...names],
            appIds: [...appIds]
          });
          M.debug.dbg(`♻️ 强制刷新：已清除 ${resp && resp.cleared} 条缓存，重载页面`);
          sendResponse({ success: true, cleared: resp && resp.cleared });
          location.reload();
        } catch (e) {
          sendResponse({ success: false, error: String(e) });
        }
      })();
      return true; // 异步响应 / Async response
    }
    // v3.4.1：未处理的消息不返回 true（不无谓地保持消息通道，避免拖住
    // Service Worker 生命周期）/ Unhandled messages return nothing, so no
    // message channel is held open
  };
}
