// @ts-strict
/**
 * 游戏雷达 Game Radar - storage.session 持久化辅助 / Session Persistence Helper
 *
 * v10.0.0：诊断类内存状态（API 监控 / 出站审计 / 告警限频）随 SW 冷启动
 * 清零——dashboard 出站审计几乎总是空窗口、24h 告警限频形同虚设。本辅助
 * 把这些状态以**防抖**方式持久化到 chrome.storage.session（生命周期与
 * 浏览器会话一致，恰覆盖 SW 重启窗口；小数据量，2s 防抖足够）。
 * 同步接口（内存优先，不破坏既有同步调用方）+ 异步预热（load）+ 防抖落盘。
 * session 不可用（测试环境/极旧 Chrome）时静默降级纯内存模式。
 *
 * Session-persisted state helper: debounced writes to chrome.storage.session
 * so diagnostic in-memory state survives SW cold starts; sync memory-first
 * interface; silently degrades to memory-only when session storage is absent.
 */
/**
 * 创建 session 持久化句柄（内存优先同步接口）
 * @param {string} key chrome.storage.session 键
 * @param {{ initial?: any, debounceMs?: number }} [options] initial 为初始状态（深拷贝隔离）
 */
export function createSessionPersist(key, options = {}) {
  const { initial = null, debounceMs = 2000 } = options || {};
  // v10.0.0：initial 深拷贝——reset() 若只赋引用，首个状态变更会污染 initial
  // 本体（对象型 initial 的 reset 失效）；这些载荷均为可 JSON 化纯数据
  const cloneInitial = () => (Array.isArray(initial) ? initial.slice() : JSON.parse(JSON.stringify(initial)));
  /** @type {any} */
  let memory = cloneInitial();
  let loaded = false;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let timer = null;

  // 从 session 读回（SW 启动时调用一次；之后内存为权威）
  async function load() {
    if (loaded) return;
    loaded = true;
    try {
      const data = await chrome.storage.session.get(key);
      if (data && data[key] !== undefined) memory = data[key];
    } catch {
      /* session 不可用 → 纯内存模式 */
    }
  }

  // 防抖落盘（内存变更后调用）/ debounced persist after memory changes
  function scheduleSave() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      saveNow().catch(() => {});
    }, debounceMs);
  }

  async function saveNow() {
    try {
      await chrome.storage.session.set({ [key]: memory });
    } catch {
      /* 落盘失败忽略（下次防抖重试） */
    }
  }

  return {
    // 同步读内存（返回内部引用，调用方原地修改后调用 scheduleSave）
    peek: () => memory,
    // 异步预热（幂等）/ async warm-up (idempotent)
    async load() {
      await load();
      return memory;
    },
    scheduleSave,
    // 立即落盘（SW 休眠前/测试用）/ immediate persist
    async flush() {
      await saveNow();
    },
    // 清空（测试/清理用——保持 loaded，不再从 session 读回旧数据）
    reset() {
      memory = cloneInitial();
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }
  };
}
