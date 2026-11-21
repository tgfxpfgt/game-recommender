/**
 * 游戏雷达 Game Radar - 候选手动选择模块 / Manual Select Candidates Module
 *
 * v14 B3：由 detail-page.js 拆分——手动选择浮窗（候选列表/关键词搜索/
 * 键盘导航 ↑↓→Enter/Esc，v12 B5）。
 * Split from detail-page.js (B3): the manual-select float (candidate list,
 * keyword search, keyboard navigation since v12 B5).
 * 由 sidebar.js 的装载/纠错路径调用（自动匹配失败 → 手动选择兜底）。
 * v15 阶段 3 全量迁移：面板与候选列表 Preact h() 渲染（innerHTML 11 处退役
 * ——文本插值天然转义；事件经 props 直连，规避宿主页 CSP 内联禁令）。
 * 共享容器经 core/preact-mount.js mountView（异源 DOM 清场纪律）。
 * Panel and candidate list rendered via Preact h() trees; events wired
 * through props (no inline handlers); shared container mounted via mountView.
 */
import { mountView, h, render, Fragment } from '../core/preact-mount.js';
import { MANUAL_PLATFORM_OPTIONS, MANUAL_PLATFORM_BRANDS, detectPlatform } from '../../shared/platform-detect.js'; // v14.19.0：机型选项单源；v14.20.0：厂商分组；v14.42.0：平台标注校验
import * as builder from '../adapters/builder.js'; // v14.42.0：规则读取单源（getRuleForCurrentSite）

// v14.42.0：详情页平台标注提取（规则 detailPlatformSelectors 声明选择器）。
// 背景：非 PC 专列页（XDGAME /list/2/ 家族、gamer520 /yzb-2）的**详情页**
// 标题同样不含平台段——站点标注在标题旁徽章（XDGAME .tit-badge "Xbox移植"）、
// 分类面包屑/分类标签（gamer520 meta-category "移植P"）里，纯标题级
// detectPlatform 落空 → 详情页走 PC 检索必错配。落在 candidates（详情域，
// platform-detect 本就在本闭包——若经 builder 引入会把整个词表拖进列表闭包
// +27KB，perf-budget 实测）。页级缓存（pathname 页内不变）。
// Detail-page platform annotation extraction (rule-declared selectors).
// Hosted in candidates: the detail closure already carries platform-detect.
/** @type {string|null} */
let detailPlatformHintCache = null;
export async function getDetailPlatformHint() {
  if (detailPlatformHintCache !== null) return detailPlatformHintCache;
  const rule = builder.getRuleForCurrentSite();
  const selectors = rule && Array.isArray(rule.detailPlatformSelectors) ? rule.detailPlatformSelectors : [];
  /** @type {string[]} */
  const found = [];
  for (const sel of selectors) {
    // 逐选择器防御（导入规则包可能畸形）：非法选择器跳过不抛错
    if (typeof sel !== 'string' || !sel || sel.length > 120) continue;
    /** @type {any[]} */
    let els = [];
    try {
      els = Array.from(document.querySelectorAll(sel));
    } catch {
      continue;
    }
    for (const el of els.slice(0, 8)) {
      const text = String(el.textContent || '')
        .trim()
        .slice(0, 24);
      if (!text || text.length > 24) continue;
      // 语义校验：**逐段独立**判定（"PC PLAY"与"移植P"同页共存时整串探针会被
      // PC guard 整体拦下——gamer520 详情页真实形态）；去重（徽章与面包屑常
      // 同标注）。 Per-segment validation + dedup (badge & breadcrumb repeat).
      if (detectPlatform(text).kind !== 'pc' && !found.includes(text)) found.push(text);
    }
  }
  detailPlatformHintCache = found.length > 0 ? found.join('|') : '';
  return detailPlatformHintCache;
}

// v14.7 批次 3/4：「跳过，稍后自动重试」的页面会话级已跳过集——同一游戏
// 本页不再自动弹候选浮窗（跨页面由分级负缓存首档 15min 兜底）。
// Page-session dismissed set: the float won't auto-pop again for the same
// game on this page; cross-page reloads are covered by the 15-min first tier
// of the graded negative cache.
const dismissedGames = new Set();

/**
 * 手动绑定 AppID 输入解析（v14.15.0 N3）：接受两种形态——纯数字（1-10 位，
 * 与契约 APP_ID_RE 同口径）或 Steam 商店 URL（store.steampowered.com/app/数字，
 * 用户从浏览器地址栏整段粘贴）。其余形态返回 null（候选面板提示格式错误）。
 * Parse a manual-bind input: bare digits (1-10, same shape as contract
 * APP_ID_RE) or a Steam store URL; anything else → null (format hint).
 * @param {string} input
 * @returns {string|null} appId 数字串或 null
 */
export function parseManualAppIdInput(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  const urlMatch = text.match(/store\.steampowered\.com\/app\/(\d{1,10})(?!\d)/i);
  if (urlMatch) return urlMatch[1];
  if (/^\d{1,10}$/.test(text)) return text;
  return null;
}

// v14.13 B6（报告 D P1-9）：上一任键盘监听器引用——searchAndRender 重入时
// 直摘旧监听（此前每次搜索累积一个全局 keydown，↑/↓ 跳变/Enter 触发陈旧项）
/** @type {((ev: KeyboardEvent) => void) | null} */
let prevKbHandler = null;
/** @param {string} gameName */
export function isGameDismissed(gameName) {
  return dismissedGames.has(String(gameName || ''));
}

// 候选列表状态行（加载/空态/错误统一形态——居中提示，Preact 文本插值转义）
// Shared status line for the candidate list (loading/empty/error).
const LIST_STATUS_STYLE = 'padding:20px;text-align:center;color:#8f98a0;font-size:12px;';
/** @param {HTMLElement} listEl @param {string} text @param {string} [color] */
function renderListStatus(listEl, text, color) {
  render(h('div', { style: color ? LIST_STATUS_STYLE + 'color:' + color + ';' : LIST_STATUS_STYLE }, text), listEl);
}

// 候选行基础样式（v10 时代内联样式原样保留——渐进迁移不动视觉）
// Candidate row base style (visual parity with the innerHTML era).
const CANDIDATE_ROW_STYLE =
  'display:flex;align-items:center;gap:10px;padding:8px;margin:4px 0;' +
  'background:rgba(0,0,0,0.2);border:1px solid #2a475e;border-radius:3px;' +
  'cursor:pointer;transition:background 0.2s,border-color 0.2s;';

// 手动选择浮窗：自动搜索失败时显示候选游戏列表供用户选择
// v10.9.3：reason（后台诊断：not-found / steam-api-unreachable / error:…）展示 +
// 重试按钮（穿透负缓存重新自动匹配）——此前静默弹候选，用户无从判断失败原因
// v14.19.0（用户需求）：新增主机机型手动选择——匹配错误且实为主机/模拟器
// 条目时，选择机型后转 Metacritic 评分并持久化映射（列表页随之纠正）。
// v14.24.0（用户需求：选择机型迁入 ⚙ 菜单）：主视图入口按钮移除（菜单
// "🎮 选择主机机型"直达）；openPlatformView=true 时渲染后直接切机型专页。
// v14.24.0: main-view entry button removed (menu item jumps straight to the
// platform view); openPlatformView=true auto-switches after render.
export function renderManualSelectPanel(
  /** @type {any} */ panel,
  /** @type {string} */ gameName,
  /** @type {(() => void)|undefined} */ onClose,
  /** @type {((d: any, id: any) => void)|undefined} */ onSelect,
  /** @type {string} */ reason,
  /** @type {(() => Promise<any>)|undefined} */ onRetry,
  /** @type {((p: string) => Promise<any>)|undefined} */ onPickPlatform,
  openPlatformView = false
) {
  const reasonText = String(reason || '').trim();
  // 闭包内 TS 收窄失效兜底（回调形态的可选参数——渲染分支已守卫，直传类型化局部量）
  const retryFn = /** @type {(() => Promise<any>)|undefined} */ (onRetry);

  // v14.19.0：主机/模拟器机型选择（onPickPlatform 在场才渲染——回调由
  // sidebar.js/sidebar-actions.js 提供：SET_MANUAL_PLATFORM → MC 评分 → MC 视图）
  // v14.20.0（用户需求：全主机类型）：按厂商分组渲染（任天堂/索尼/微软/世嘉/
  // 通用——MANUAL_PLATFORM_BRANDS 单源），flex-wrap 自适应换行
  // v14.22.2：35 个机型按钮平铺不显眼——收敛为**机型选择专页**（厂商分组 +
  // 状态行 + 返回按钮 + Esc）。v14.24.0（用户需求：选择机型迁入 ⚙ 菜单）：
  // 主视图入口按钮移除——菜单"🎮 选择主机机型"直达专页（openPlatformView），
  // 候选搜索视图保持紧凑
  const platformBrandRows = onPickPlatform
    ? MANUAL_PLATFORM_BRANDS.map((/** @type {any} */ b) => {
        const opts = MANUAL_PLATFORM_OPTIONS.filter((/** @type {any} */ o) => o.brand === b.id);
        if (opts.length === 0) return null;
        return h(
          'div',
          { style: 'display:flex;align-items:flex-start;gap:6px;margin-bottom:6px;' },
          h('span', { style: 'flex:none;width:46px;padding-top:5px;font-size:11px;color:#8f98a0;' }, b.label),
          h(
            'div',
            { style: 'display:flex;gap:5px;flex-wrap:wrap;' },
            opts.map((/** @type {any} */ o) =>
              h(
                'button',
                {
                  class: 'gr-btn gr-manual-platform',
                  'data-platform': String(o.id),
                  title: `声明为 ${o.label} 并查询 Metacritic`,
                  style: 'padding:4px 9px;font-size:11px;'
                },
                o.label
              )
            )
          )
        );
      }).filter(Boolean)
    : [];

  // v13 B10：预填未命中原因（诊断信息直接进 issue）
  const bodyLines = [
    '游戏名: ' + gameName,
    '页面: ' + location.href,
    '版本: ' + (chrome.runtime.getManifest ? chrome.runtime.getManifest().version : '')
  ];
  if (reasonText) bodyLines.push('未命中原因: ' + reasonText);
  bodyLines.push('', '问题描述：');
  const issueUrl =
    'https://github.com/tgfxpfgt/game-recommender/issues/new?title=' +
    encodeURIComponent('自动匹配问题反馈') +
    '&body=' +
    encodeURIComponent(bodyLines.join('\n'));

  // 挂载主模板（共享容器清场纪律——panel 可能残留上一视图的 DOM）
  // Mount the panel template (shared-container discipline via mountView).
  mountView(
    panel,
    h(
      'div',
      { style: 'padding:16px;', role: 'dialog', 'aria-label': '手动选择游戏' },
      h(
        'div',
        { id: 'gr-main-view' },
        h('div', { style: 'font-size:15px;font-weight:bold;color:#fff;margin-bottom:8px;' }, '🎮 手动选择游戏'),
        h(
          'div',
          { style: 'font-size:12px;color:#8f98a0;margin-bottom:12px;' },
          '未能自动匹配 Steam 游戏。请从下方候选列表中选择正确游戏，',
          h('br', null),
          '或输入关键词手动搜索。'
        ),
        reasonText
          ? h(
              'div',
              {
                style:
                  'font-size:11px;color:#e67e22;margin-bottom:10px;padding:6px 8px;background:rgba(230,126,34,0.08);border:1px solid rgba(230,126,34,0.3);border-radius:3px;word-break:break-all;'
              },
              '⚠️ 未命中原因：' + reasonText,
              onRetry ? h('br', null) : null,
              onRetry ? 'Steam 商店接口不可达时请检查网络/加速器；确认游戏在 Steam 后点上方重试。' : null
            )
          : null,
        onRetry
          ? h(
              'div',
              { style: 'margin-bottom:10px;display:flex;gap:8px;' },
              h(
                'button',
                {
                  id: 'gr-manual-retry',
                  class: 'gr-btn',
                  style: 'flex:none;padding:6px 12px;',
                  onClick: async (/** @type {any} */ ev) => {
                    // v10.9.3：重试自动匹配（穿透负缓存；成功 → 整个浮窗切回 Steam 信息视图）
                    if (!retryFn) return;
                    const btn = ev.currentTarget;
                    const statusEl = panel.querySelector('#gr-manual-retry-status');
                    btn.disabled = true;
                    if (statusEl) statusEl.textContent = '⏳ 重试中...';
                    const ok = await retryFn().catch(() => false);
                    if (!ok) {
                      btn.disabled = false;
                      if (statusEl) statusEl.textContent = '❌ 仍未命中';
                    }
                  }
                },
                '🔄 重试自动匹配'
              ),
              h(
                'button',
                {
                  id: 'gr-manual-skip',
                  class: 'gr-btn',
                  style: 'flex:none;padding:6px 12px;',
                  onClick: () => {
                    // v14.7 批次 3/4：跳过（轻路径）——关浮窗 + 页面会话内不再自动弹出；
                    // 负缓存首档 15min 到期后下次访问自动重查（分级退避，非 2h）。
                    dismissedGames.add(String(gameName || ''));
                    if (typeof onClose === 'function') onClose();
                  }
                },
                '⏭ 跳过，稍后自动重试'
              ),
              h('span', { id: 'gr-manual-retry-status', style: 'font-size:11px;color:#8f98a0;align-self:center;' })
            )
          : null,
        h(
          'div',
          { style: 'margin-bottom:10px;' },
          h('input', {
            type: 'text',
            id: 'gr-manual-search-input',
            placeholder: '输入游戏名搜索...',
            style:
              'width:100%;padding:8px 10px;background:#0e141b;border:1px solid #2a475e;border-radius:3px;color:#c7d5e0;font-size:13px;outline:none;font-family:inherit;'
          })
        ),
        h(
          'div',
          { style: 'margin-bottom:10px;display:flex;gap:8px;' },
          h('input', {
            type: 'text',
            id: 'gr-manual-appid',
            placeholder: '或直接绑定 AppID（纯数字 / 商店链接）',
            style:
              'flex:1;min-width:0;padding:6px 10px;background:#0e141b;border:1px solid #2a475e;border-radius:3px;color:#c7d5e0;font-size:12px;outline:none;font-family:inherit;'
          }),
          h('button', { id: 'gr-manual-bind', class: 'gr-btn', style: 'flex:none;padding:6px 12px;' }, '🔗 绑定')
        ),
        h(
          'div',
          { style: 'margin-bottom:10px;display:flex;gap:12px;' },
          h(
            'a',
            {
              href: 'https://store.steampowered.com/search/?term=' + encodeURIComponent(gameName),
              target: '_blank',
              rel: 'noopener',
              style: 'font-size:11px;color:#67c1f5;text-decoration:none;'
            },
            '🔎 在 Steam 网页搜索 ↗'
          ),
          h(
            'a',
            {
              href: issueUrl,
              target: '_blank',
              rel: 'noopener',
              style: 'font-size:11px;color:#8f98a0;text-decoration:none;'
            },
            '💬 反馈问题 ↗'
          )
        ),
        onPickPlatform
          ? // v14.29.2（用户需求：手动选择面板内可直接转主机机型选择）——v14.24.0
            // 曾把主视图入口移除（⚙ 菜单直达），但用户在"手动选择游戏"状态下面板
            // 内无出口（须先关面板再找菜单）。恢复入口按钮（与机型专页同一开关），
            // 切 showPlatformView 与菜单直达同路径。
            // Main-view entry button restored: switch to the platform picker view
            // from inside the manual-select panel (same path as the menu shortcut).
            h(
              'div',
              { style: 'margin-bottom:10px;' },
              h(
                'button',
                { id: 'gr-platform-entry', class: 'gr-btn', style: 'width:100%;padding:7px 0;font-size:12px;' },
                '🎮 这是主机 / 模拟器游戏？选择机型转 Metacritic 评分'
              )
            )
          : null,
        h(
          'div',
          {
            id: 'gr-candidates-list',
            role: 'listbox',
            'aria-label': '候选游戏列表',
            style: 'max-height:300px;overflow-y:auto;'
          },
          h(
            'div',
            { style: LIST_STATUS_STYLE },
            h('div', { style: 'font-size:20px;margin-bottom:6px;' }, '⏳'),
            '正在搜索候选游戏...'
          )
        )
      ),
      onPickPlatform
        ? h(
            'div',
            {
              id: 'gr-platform-view',
              style: 'display:none;padding:16px;',
              role: 'dialog',
              'aria-label': '主机机型选择'
            },
            h(
              'div',
              { style: 'font-size:14px;font-weight:bold;color:#fff;margin-bottom:6px;' },
              '🎮 主机 / 模拟器机型选择'
            ),
            h(
              'div',
              { style: 'font-size:12px;color:#8f98a0;margin-bottom:10px;' },
              '选择机型后转 ',
              h('b', null, 'Metacritic'),
              ' 评分——声明长期生效，列表页评分随之纠正。'
            ),
            platformBrandRows,
            h('div', {
              id: 'gr-platform-status',
              style: 'font-size:11px;color:#8f98a0;margin-top:5px;min-height:14px;'
            }),
            h(
              'button',
              { id: 'gr-platform-back', class: 'gr-btn', style: 'margin-top:8px;width:100%;padding:6px 0;' },
              '← 返回手动搜索'
            )
          )
        : null
    )
  );

  /** @param {string} keyword */
  async function searchAndRender(keyword) {
    const listEl = panel.querySelector('#gr-candidates-list');
    if (!listEl) return;
    render(h('div', { style: LIST_STATUS_STYLE }, '⏳ 搜索中...'), listEl);

    try {
      const resp = await window.__GR_MSG__.sendMessage({
        action: 'SEARCH_STEAM_CANDIDATES',
        gameName: keyword || gameName
      });
      const candidates = (resp && resp.candidates) || [];

      if (candidates.length === 0) {
        renderListStatus(listEl, '未找到候选游戏，请尝试其他关键词');
        return;
      }

      render(
        h(
          Fragment,
          null,
          candidates.map((/** @type {any} */ c) =>
            h(
              'div',
              {
                class: 'gr-candidate-item',
                role: 'option',
                'aria-selected': 'false',
                'data-appid': String(c.appId),
                style: CANDIDATE_ROW_STYLE,
                onMouseEnter: (/** @type {any} */ ev) => {
                  ev.currentTarget.style.background = 'rgba(102,192,244,0.1)';
                  ev.currentTarget.style.borderColor = '#66c0f4';
                },
                onMouseLeave: (/** @type {any} */ ev) => {
                  ev.currentTarget.style.background = 'rgba(0,0,0,0.2)';
                  ev.currentTarget.style.borderColor = '#2a475e';
                },
                onClick: async (/** @type {any} */ ev) => {
                  const selectedAppId = ev.currentTarget.getAttribute('data-appid');
                  render(h('div', { style: LIST_STATUS_STYLE }, '⏳ 正在获取详情...'), listEl);
                  try {
                    const detailResp = await window.__GR_MSG__.sendMessage({
                      action: 'GET_STEAM_BY_APPID',
                      appId: parseInt(selectedAppId),
                      manual: true // v3.3.14：手动选择候选跳过名称相关性校验（用户主动确认）
                    });
                    if (detailResp && detailResp.data) {
                      if (onSelect) onSelect(detailResp.data, parseInt(selectedAppId));
                    } else {
                      // v14.28.12（B2-F4）：失败原因透出（与 SEARCH_STEAM reason 对齐）
                      const failReason =
                        detailResp && detailResp.reason === 'name-mismatch'
                          ? '（AppID 与页面标题不相关，已转标题搜索）'
                          : detailResp && detailResp.reason === 'fetch-failed'
                            ? '（网络/接口失败，请检查网络后重试）'
                            : '';
                      renderListStatus(listEl, '获取详情失败，请重试' + failReason, '#e74c3c');
                    }
                  } catch (e) {
                    renderListStatus(listEl, '获取失败: ' + globalThis.__GR_MSG__.toUserMessage(e), '#e74c3c');
                  }
                }
              },
              c.image
                ? h('img', {
                    src: String(c.image),
                    style: 'width:46px;height:17px;border-radius:2px;flex-shrink:0;',
                    onError: (/** @type {any} */ ev) => {
                      ev.currentTarget.style.display = 'none';
                    }
                  })
                : null,
              h(
                'div',
                { style: 'flex:1;min-width:0;' },
                h(
                  'div',
                  {
                    style:
                      'font-size:12px;color:#c7d5e0;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
                  },
                  c.name
                ),
                h(
                  'div',
                  { style: 'font-size:10px;color:#8f98a0;' },
                  `App ID: ${c.appId}${c.price !== null && c.price !== undefined ? ' · ¥' + c.price : ''}`
                )
              )
            )
          )
        ),
        listEl
      );

      // v12 B5：键盘导航——↑/↓ 移动高亮，Enter 选择，Esc 关闭
      let kbIndex = -1;
      const items = [...listEl.querySelectorAll('.gr-candidate-item')];
      /** @param {number} i */
      const setKbActive = (i) => {
        kbIndex = (i + items.length) % items.length;
        items.forEach((/** @type {any} */ it, /** @type {number} */ idx) => {
          const active = idx === kbIndex;
          it.style.background = active ? 'rgba(102,192,244,0.25)' : '';
          it.style.borderColor = active ? '#66c0f4' : '#2a475e';
        });
      };
      /** @param {KeyboardEvent} ev */
      const kbHandler = (ev) => {
        // v14.13 B6（报告 D P1-9）：listEl 只重渲染不移除节点，自移除
        // 条件永不成立 → 每次搜索累积一个全局监听器（↑/↓ 跳变/Enter 触发陈旧
        // 项）。改为：面板节点脱文档或被替换（dataset 标记变化）即移除；并
        // 在注册前先摘除上一个监听器（searchAndRender 重入防累积）。
        if (!document.body.contains(listEl) || listEl.dataset.kbNav !== '1') {
          document.removeEventListener('keydown', kbHandler);
          if (prevKbHandler === kbHandler) prevKbHandler = null;
          return;
        }
        if (ev.key === 'ArrowDown') {
          ev.preventDefault();
          setKbActive(kbIndex + 1);
        } else if (ev.key === 'ArrowUp') {
          ev.preventDefault();
          setKbActive(kbIndex - 1);
        } else if (ev.key === 'Enter' && kbIndex >= 0) {
          ev.preventDefault();
          items[kbIndex].click();
        } else if (ev.key === 'Escape') {
          document.removeEventListener('keydown', kbHandler);
          if (prevKbHandler === kbHandler) prevKbHandler = null;
        }
      };
      // v14.13 B6：注册前先摘除上一任监听器（模块级持有引用，直摘不波及
      // 宿主页的其他 keydown 监听——Escape 合成事件会误伤页面自身处理器）
      if (prevKbHandler) document.removeEventListener('keydown', prevKbHandler);
      prevKbHandler = kbHandler;
      document.addEventListener('keydown', kbHandler);
      listEl.dataset.kbNav = '1';
    } catch (e) {
      renderListStatus(listEl, '搜索失败: ' + globalThis.__GR_MSG__.toUserMessage(e), '#e74c3c');
    }
  }

  // v14.19.0：主机机型选择——点击 → onPickPlatform（sidebar.js：后台声明
  // 映射 + Metacritic 评分 + 浮窗切 MC 视图）；成功后浮窗被重渲染，失败在
  // 状态行提示（按钮复位可重选）
  // v14.22.2：视图切换——主视图入口按钮 ↔ 机型专页（返回按钮/Esc 双出口）；
  // Esc 监听带自清理（面板重渲染/专页隐藏即失效——v14.13 B6 kbHandler 同款
  // 防泄漏模式），专页激活期间候选列表键盘导航停用（列表仅隐藏未销毁）
  if (onPickPlatform) {
    const pickPlatformFn = onPickPlatform; // 闭包内 TS 收窄失效兜底
    const statusEl = panel.querySelector('#gr-platform-status');
    const mainView = panel.querySelector('#gr-main-view');
    const platformView = panel.querySelector('#gr-platform-view');
    /** @type {((ev: KeyboardEvent) => void) | null} */
    let escBackHandler = null;
    const showPlatformView = () => {
      if (!mainView || !platformView) return;
      mainView.style.display = 'none';
      platformView.style.display = '';
      const listEl = panel.querySelector('#gr-candidates-list');
      if (listEl) listEl.dataset.kbNav = '0'; // 专页下隐藏列表不再吃 ↑/↓/Enter
      if (escBackHandler) document.addEventListener('keydown', escBackHandler);
    };
    const showMainView = () => {
      if (!mainView || !platformView) return;
      platformView.style.display = 'none';
      mainView.style.display = '';
      const listEl = panel.querySelector('#gr-candidates-list');
      if (listEl) listEl.dataset.kbNav = '1'; // 恢复候选列表键盘导航
      if (escBackHandler) {
        document.removeEventListener('keydown', escBackHandler);
        escBackHandler = null;
      }
    };
    const backBtn = panel.querySelector('#gr-platform-back');
    if (backBtn) backBtn.addEventListener('click', showMainView);
    // v14.29.2：主视图入口按钮 → 机型专页（与 ⚙ 菜单直达同一 showPlatformView
    // 路径；专页切换后随 mainView 隐藏）
    const entryBtn = panel.querySelector('#gr-platform-entry');
    if (entryBtn) entryBtn.addEventListener('click', showPlatformView);
    escBackHandler = (ev) => {
      // 面板重渲染（MC 视图/重检索）后 platformView 已脱文档——自摘防泄漏
      if (!panel.contains(platformView)) {
        const h2 = escBackHandler; // 自引用初始化器内 TS 不收窄——局部常量守卫
        if (h2) document.removeEventListener('keydown', h2);
        escBackHandler = null;
        return;
      }
      if (ev.key === 'Escape' && platformView.style.display !== 'none') {
        ev.preventDefault();
        showMainView();
      }
    };
    panel.querySelectorAll('.gr-manual-platform').forEach((/** @type {any} */ btn) => {
      btn.addEventListener('click', async () => {
        const platformId = btn.getAttribute('data-platform');
        const all = [...panel.querySelectorAll('.gr-manual-platform')];
        all.forEach((/** @type {any} */ b) => (b.disabled = true));
        if (statusEl) statusEl.textContent = '⏳ 正在声明平台并查询 Metacritic 评分...';
        try {
          const ok = await pickPlatformFn(platformId);
          if (!ok && statusEl) {
            statusEl.textContent = '❌ Metacritic 查询失败（该条目已记录为主机游戏，评分稍后自动补查）';
            all.forEach((/** @type {any} */ b) => (b.disabled = false));
          }
        } catch (e) {
          if (statusEl) statusEl.textContent = `❌ ${globalThis.__GR_MSG__.toUserMessage(e)}`;
          all.forEach((/** @type {any} */ b) => (b.disabled = false));
        }
      });
    });
    // v14.24.0：⚙ 菜单"选择机型"直达——渲染完成后立即切机型专页（Esc 自清理
    // 监听已先注册，返回/Esc 双出口照常生效）
    if (openPlatformView) showPlatformView();
  }

  // 初始搜索
  searchAndRender(gameName);

  // 搜索框事件（300ms 防抖）
  /** @type {ReturnType<typeof setTimeout>|null} */
  let searchTimer = null;
  const input = panel.querySelector('#gr-manual-search-input');
  if (input) {
    input.addEventListener('input', (/** @type {Event} */ e) => {
      if (searchTimer) clearTimeout(searchTimer);
      const keyword = String(/** @type {HTMLInputElement} */ (e.target)?.value || '').trim();
      if (keyword.length < 2) return;
      searchTimer = setTimeout(() => searchAndRender(keyword), 300);
    });
  }

  // v14.15.0 N3：手动绑定 AppID——storesearch 搜不到已下架游戏（v14.6 调研
  // 实证），用户从 Steam 网页地址栏复制链接/纯数字即可绑定。写入纠正映射
  //（与候选选择同语义：优先于一切索引），绑定前 appdetails 确认条目存在。
  // Manual-bind by AppID: storefront search cannot find delisted games, so the
  // user pastes a bare id / store link; the binding goes through the same
  // correction-mapping semantics (after an appdetails existence check).
  const bindInput = panel.querySelector('#gr-manual-appid');
  const bindBtn = panel.querySelector('#gr-manual-bind');
  if (bindBtn && bindInput) {
    const listEl0 = panel.querySelector('#gr-candidates-list');
    bindBtn.addEventListener('click', async () => {
      const appId = parseManualAppIdInput(bindInput.value);
      if (!appId) {
        bindInput.value = '';
        bindInput.placeholder = '❌ 格式：1-10 位数字或 store.steampowered.com/app/数字 链接';
        return;
      }
      bindBtn.disabled = true;
      if (listEl0) {
        renderListStatus(listEl0, '⏳ 正在确认 AppID ' + appId + ' ...');
      }
      try {
        const resp = await window.__GR_MSG__.sendMessage({
          action: 'GET_STEAM_BY_APPID',
          appId: parseInt(appId, 10),
          manual: true // 手动绑定跳过名称相关性校验（与候选选择同语义）
        });
        if (resp && resp.data) {
          if (onSelect) onSelect(resp.data, parseInt(appId, 10));
          return;
        }
        if (listEl0) {
          renderListStatus(listEl0, '未找到该 AppID 的 Steam 条目，请核对', '#e74c3c');
        }
      } catch (e) {
        if (listEl0) {
          renderListStatus(listEl0, '绑定失败: ' + window.__GR_MSG__.toUserMessage(e), '#e74c3c');
        }
      } finally {
        bindBtn.disabled = false;
      }
    });
  }
}
