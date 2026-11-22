/**
 * 游戏雷达 Game Radar - 用户可见文案单源（zh-CN）/ UI text single source
 *
 * v14.39.0（文案集中层首域——v15 计划"非 i18n 文案字典"落地）：面向用户的
 * 固定 UI 文案按域分组收敛为此处字典，t('域.键', vars) 引用；{var} 占位符
 * 运行时替换。**日志/诊断文案（dbg/console）保留散写不入字典**（AGENTS 口径
 * ——字典只管用户可见面）。首批迁移域：徽章（badges）+ 列表评分状态机
 * （status-bar/list-state 收尾与排队文案）；其余域（浮窗菜单/详情模板/设置页）
 * 按批次渐进迁移（ledger 见 docs/modules/INDEX.md 本模块行）。
 * User-visible fixed strings grouped by domain; logs stay inline by design.
 * First batch: badge + rating-pipeline status strings; other domains migrate
 * incrementally.
 *
 * 内容侧与页面侧均为 classic/ESM 共用形态（同 shared/ui-tokens.js）：IIFE
 * 挂 globalThis.__GR_UI_TEXT__ + ESM re-export。t() 支持点路径与 {var} 替换
 * （缺键返回键名本身——新增文案漏登记在 UI 上可见，不会静默空串）。
 * t() resolves dot paths and substitutes {var} placeholders; a missing key
 * renders as the key itself (visible, never a silent empty string).
 * @invariant 值为用户可见 zh-CN 固定文案；占位符形如 {name}，vars 缺失时
 * 占位符原样保留（可见可查，不抛错）。
 */
(function (global) {
  'use strict';

  /** @type {Record<string, any>} 域分组字典 / domain-grouped dictionary */
  const TEXT = {
    badge: {
      workingWait: '⏳ 等待检索',
      workingRetryTitle: '点击立即重查（穿透负缓存）',
      networkErrorText: '⚠️ 网络异常·点击重查',
      networkErrorTitle:
        'Steam 网络/限流故障，本次未能完成检索（并非 Steam 无此游戏）\n点击立即重查 · 网络恢复后刷新页面也会自动重试',
      notFoundText: '未找到',
      notFoundTitle:
        '未在 Steam 找到该游戏\n点击立即重查（穿透负缓存）· 负缓存分级退避 15min→1h→2h 后自动重查 · 或按 Alt+Shift+G 强制刷新本页',
      errorDefault: '⚠️ 检索异常',
      errorQueryFailed: '查询失败',
      errorNotReturned: '⚠️ 未返回·点击重查',
      mcTitlePrefix: 'Metacritic 媒体评分 {score}',
      mcNameSuffix: '（{name}）',
      mcTagSuffix: ' · {tag}平台',
      mcUserTitle: 'Metacritic 用户评分 {score}（0-10 制）',
      platformEmulatorTitle: '模拟器/ROM 整合条目——非 Steam 游戏，未检索评分',
      platformConsoleTitle: '主机平台游戏——评分优先 Metacritic（本条暂无可得评分）',
      recDislikeTitle: '不感兴趣'
    },
    queue: {
      // v14.28.6 R4-A 阶段中文名（stalled.phase 映射）
      phasePlatform: '平台识别',
      phaseCache: '查缓存',
      phaseSearch: '搜索匹配',
      phaseValidate: '校验条目',
      phaseReviews: '取评价',
      phaseNames: '补全名称',
      phaseWrite: '写缓存',
      phaseStart: '启动',
      phaseUnknown: '未知步骤',
      youPosition: '排队中·前方 {n} 页',
      aheadItems: '前方约 {n} 项',
      pageTotal: '本页 {n} 项',
      searching: '检索中 {done}/{total}',
      pending: '排队 {n}',
      progPosition: '排队中·前方 {n} 项',
      stuckAt: '卡在{phase} {secs}s',
      degraded: '限流降速',
      waiting: '等待检索'
    },
    status: {
      progressTitle: '正在获取 Steam 好评率',
      queuedDetail: '已排队 {n} 个，缓存优先检索中...',
      cachePriority: '缓存优先检索中...',
      steamUpdateTitle: '正在从 Steam 更新缓存',
      pendingFetch: '{n} 个未命中缓存，后台拉取中',
      queueAhead: ' · 全局排队中·前方 {n} 页',
      steamProgress: ' · Steam 检索 {done}/{total}',
      degradedSuffix: ' · Steam 访问受限，自动恢复中'
    },
    finish: {
      title: 'Steam 好评率获取完成',
      summaryShown: '{n} 个好评率',
      summaryFiltered: ' · {n} 个已过滤',
      summaryNotFound: ' · {n} 个未找到',
      summaryFailed: ' · {n} 个网络异常（点击徽章可重查）',
      summaryUnresolved: ' · {n} 个暂未返回（点击条目旁徽章可重查）',
      rowsQueried: '查询 {a} 个游戏 · 提取 {b} 个',
      rowsFailed: '网络异常: {list}（非 Steam 无此游戏）',
      rowsNotFound: '未找到: {list}',
      rowsFiltered: '已过滤 {n} 个（点击恢复全部）',
      restoredTitle: '已恢复被过滤游戏',
      restoredSummary: '恢复了 {n} 个游戏（位置可能略有变化）'
    }
  };

  /**
   * 取文案（点路径 + {var} 替换）。缺键返回键名本身（可见可查）；vars 缺失
   * 时占位符原样保留。key 之外的参数不参与校验（宽松契约——文案层不抛错）。
   * Resolve a dot path and substitute {var} placeholders. Missing keys return
   * the key itself (visible, never silent).
   * @param {string} key @param {Record<string, any>} [vars]
   * @returns {string}
   */
  function t(key, vars) {
    const parts = String(key || '').split('.');
    let node = /** @type {any} */ (TEXT);
    for (const p of parts) {
      if (node && typeof node === 'object' && p in node) node = node[p];
      else return key; // 缺键可见（键名即 UI 上的呈现，漏登记不会被静默吞掉）
    }
    let out = typeof node === 'string' ? node : key;
    if (vars) {
      for (const k of Object.keys(vars)) {
        out = out.replace(new RegExp('\\{' + k + '\\}', 'g'), String(vars[k] ?? '{' + k + '}'));
      }
    }
    return out;
  }

  global.__GR_UI_TEXT__ = { TEXT, t };
})(/** @type {typeof globalThis} */ (typeof globalThis !== 'undefined' ? globalThis : this));

// ESM 形态（内容/页面 bundle import 用；classic eval 时 export 被打包器消化）
const ref =
  typeof globalThis !== 'undefined' && globalThis.__GR_UI_TEXT__
    ? globalThis.__GR_UI_TEXT__
    : { TEXT: {}, t: (/** @type {string} */ k) => k };
export const TEXT = ref.TEXT;
export const t = ref.t;
