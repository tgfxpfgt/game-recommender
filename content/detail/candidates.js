/**
 * 游戏雷达 Game Radar - 候选手动选择模块 / Manual Select Candidates Module
 *
 * v14 B3：由 detail-page.js 拆分——手动选择浮窗（候选列表/关键词搜索/
 * 键盘导航 ↑↓→Enter/Esc，v12 B5）。
 * Split from detail-page.js (B3): the manual-select float (candidate list,
 * keyword search, keyboard navigation since v12 B5).
 * 由 sidebar.js 的装载/纠错路径调用（自动匹配失败 → 手动选择兜底）。
 */
import * as common from '../core/common.js';
import { MANUAL_PLATFORM_OPTIONS, MANUAL_PLATFORM_BRANDS } from '../../shared/platform-detect.js'; // v14.19.0：机型选项单源；v14.20.0：厂商分组

const esc = (text) => common.escapeHtml(text);

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
  panel,
  gameName,
  onClose,
  onSelect,
  reason,
  onRetry,
  onPickPlatform,
  openPlatformView = false
) {
  const reasonText = String(reason || '').trim();
  const retryBtn = onRetry
    ? `<div style="margin-bottom:10px;display:flex;gap:8px;">
        <button id="gr-manual-retry" class="gr-btn" style="flex:none;padding:6px 12px;">🔄 重试自动匹配</button>
        <button id="gr-manual-skip" class="gr-btn" style="flex:none;padding:6px 12px;">⏭ 跳过，稍后自动重试</button>
        <span id="gr-manual-retry-status" style="font-size:11px;color:#8f98a0;align-self:center;"></span>
      </div>`
    : '';
  // v14.19.0：主机/模拟器机型选择（onPickPlatform 在场才渲染——回调由
  // sidebar.js/sidebar-actions.js 提供：SET_MANUAL_PLATFORM → MC 评分 → MC 视图）
  // v14.20.0（用户需求：全主机类型）：按厂商分组渲染（任天堂/索尼/微软/世嘉/
  // 通用——MANUAL_PLATFORM_BRANDS 单源），flex-wrap 自适应换行
  // v14.22.2：35 个机型按钮平铺不显眼——收敛为**机型选择专页**（厂商分组 +
  // 状态行 + 返回按钮 + Esc）。v14.24.0（用户需求：选择机型迁入 ⚙ 菜单）：
  // 主视图入口按钮移除——菜单"🎮 选择主机机型"直达专页（openPlatformView），
  // 候选搜索视图保持紧凑
  /** 机型选择专页（默认隐藏；onPickPlatform 在场才构建） */
  const platformViewHtml = onPickPlatform
    ? `<div id="gr-platform-view" style="display:none;padding:16px;" role="dialog" aria-label="主机机型选择">
        <div style="font-size:14px;font-weight:bold;color:#fff;margin-bottom:6px;">🎮 主机 / 模拟器机型选择</div>
        <div style="font-size:12px;color:#8f98a0;margin-bottom:10px;">选择机型后转 <b>Metacritic</b> 评分——声明长期生效，列表页评分随之纠正。</div>
        ${MANUAL_PLATFORM_BRANDS.map((b) => {
          const opts = MANUAL_PLATFORM_OPTIONS.filter((o) => o.brand === b.id);
          if (opts.length === 0) return '';
          return `<div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:6px;">
            <span style="flex:none;width:46px;padding-top:5px;font-size:11px;color:#8f98a0;">${esc(b.label)}</span>
            <div style="display:flex;gap:5px;flex-wrap:wrap;">
              ${opts
                .map(
                  (o) =>
                    `<button class="gr-btn gr-manual-platform" data-platform="${common.escapeAttr(o.id)}" title="声明为 ${common.escapeAttr(o.label)} 并查询 Metacritic" style="padding:4px 9px;font-size:11px;">${esc(o.label)}</button>`
                )
                .join('')}
            </div>
          </div>`;
        }).join('')}
        <div id="gr-platform-status" style="font-size:11px;color:#8f98a0;margin-top:5px;min-height:14px;"></div>
        <button id="gr-platform-back" class="gr-btn" style="margin-top:8px;width:100%;padding:6px 0;">← 返回手动搜索</button>
      </div>`
    : '';
  const reasonLine = reasonText
    ? `<div style="font-size:11px;color:#e67e22;margin-bottom:10px;padding:6px 8px;background:rgba(230,126,34,0.08);border:1px solid rgba(230,126,34,0.3);border-radius:3px;word-break:break-all;">⚠️ 未命中原因：${common.escapeHtml(reasonText)}${onRetry ? '<br>Steam 商店接口不可达时请检查网络/加速器；确认游戏在 Steam 后点上方重试。' : ''}</div>`
    : '';
  panel.innerHTML = `
      <div style="padding:16px;" role="dialog" aria-label="手动选择游戏">
        <div id="gr-main-view">
        <div style="font-size:15px;font-weight:bold;color:#fff;margin-bottom:8px;">🎮 手动选择游戏</div>
        <div style="font-size:12px;color:#8f98a0;margin-bottom:12px;">
          未能自动匹配 Steam 游戏。请从下方候选列表中选择正确游戏，<br>或输入关键词手动搜索。
        </div>
        ${reasonLine}
        ${retryBtn}
        <div style="margin-bottom:10px;">
          <input type="text" id="gr-manual-search-input" placeholder="输入游戏名搜索..."
            style="width:100%;padding:8px 10px;background:#0e141b;border:1px solid #2a475e;border-radius:3px;color:#c7d5e0;font-size:13px;outline:none;font-family:inherit;">
        </div>
        <div style="margin-bottom:10px;display:flex;gap:8px;">
          <input type="text" id="gr-manual-appid" placeholder="或直接绑定 AppID（纯数字 / 商店链接）"
            style="flex:1;min-width:0;padding:6px 10px;background:#0e141b;border:1px solid #2a475e;border-radius:3px;color:#c7d5e0;font-size:12px;outline:none;font-family:inherit;">
          <button id="gr-manual-bind" class="gr-btn" style="flex:none;padding:6px 12px;">🔗 绑定</button>
        </div>
        <div style="margin-bottom:10px;display:flex;gap:12px;">
          <a href="${common.escapeAttr('https://store.steampowered.com/search/?term=' + encodeURIComponent(gameName))}" target="_blank" rel="noopener" style="font-size:11px;color:#67c1f5;text-decoration:none;">🔎 在 Steam 网页搜索 ↗</a>
          ${(() => {
            // v13 B10：预填未命中原因（诊断信息直接进 issue）
            const bodyLines = [
              '游戏名: ' + gameName,
              '页面: ' + location.href,
              '版本: ' + (chrome.runtime.getManifest ? chrome.runtime.getManifest().version : '')
            ];
            if (reasonText) bodyLines.push('未命中原因: ' + reasonText);
            bodyLines.push('', '问题描述：');
            const issueBody = bodyLines.join('\n');
            const issueUrl =
              'https://github.com/tgfxpfgt/game-recommender/issues/new?title=' +
              encodeURIComponent('自动匹配问题反馈') +
              '&body=' +
              encodeURIComponent(issueBody);
            return `<a href="${common.escapeAttr(issueUrl)}" target="_blank" rel="noopener" style="font-size:11px;color:#8f98a0;text-decoration:none;">💬 反馈问题 ↗</a>`;
          })()}
        </div>
        <div id="gr-candidates-list" role="listbox" aria-label="候选游戏列表" style="max-height:300px;overflow-y:auto;">
          <div style="padding:20px;text-align:center;color:#8f98a0;font-size:12px;">
            <div style="font-size:20px;margin-bottom:6px;">⏳</div>
            正在搜索候选游戏...
          </div>
        </div>
        </div>
        ${platformViewHtml}
      </div>
    `;

  async function searchAndRender(keyword) {
    const listEl = panel.querySelector('#gr-candidates-list');
    if (!listEl) return;
    listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#8f98a0;font-size:12px;">⏳ 搜索中...</div>`;

    try {
      const resp = await window.__GR_MSG__.sendMessage({
        action: 'SEARCH_STEAM_CANDIDATES',
        gameName: keyword || gameName
      });
      const candidates = (resp && resp.candidates) || [];

      if (candidates.length === 0) {
        listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#8f98a0;font-size:12px;">未找到候选游戏，请尝试其他关键词</div>`;
        return;
      }

      listEl.innerHTML = candidates
        .map(
          (c) => `
          <div class="gr-candidate-item" role="option" aria-selected="false" data-appid="${common.escapeAttr(c.appId)}" style="
            display:flex;align-items:center;gap:10px;padding:8px;margin:4px 0;
            background:rgba(0,0,0,0.2);border:1px solid #2a475e;border-radius:3px;
            cursor:pointer;transition:background 0.2s,border-color 0.2s;
          ">
            ${c.image ? `<img src="${common.escapeAttr(c.image)}" style="width:46px;height:17px;border-radius:2px;flex-shrink:0;">` : ''}
            <div style="flex:1;min-width:0;">
              <div style="font-size:12px;color:#c7d5e0;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.name)}</div>
              <div style="font-size:10px;color:#8f98a0;">App ID: ${esc(c.appId)}${c.price !== null && c.price !== undefined ? ` · ¥${esc(c.price)}` : ''}</div>
            </div>
          </div>
        `
        )
        .join('');

      // v12 B5：键盘导航——↑/↓ 移动高亮，Enter 选择，Esc 关闭
      let kbIndex = -1;
      const items = [...listEl.querySelectorAll('.gr-candidate-item')];
      /** @param {number} i */
      const setKbActive = (i) => {
        kbIndex = (i + items.length) % items.length;
        items.forEach((it, idx) => {
          const active = idx === kbIndex;
          it.style.background = active ? 'rgba(102,192,244,0.25)' : '';
          it.style.borderColor = active ? '#66c0f4' : '#2a475e';
        });
      };
      /** @param {KeyboardEvent} ev */
      const kbHandler = (ev) => {
        // v14.13 B6（报告 D P1-9）：listEl 只改 innerHTML 不移除节点，自移除
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

      // 绑定事件（hover 高亮与点击用 addEventListener，规避页面 CSP）
      listEl.querySelectorAll('.gr-candidate-item').forEach((/** @type {any} */ item) => {
        item.addEventListener('mouseenter', () => {
          item.style.background = 'rgba(102,192,244,0.1)';
          item.style.borderColor = '#66c0f4';
        });
        item.addEventListener('mouseleave', () => {
          item.style.background = 'rgba(0,0,0,0.2)';
          item.style.borderColor = '#2a475e';
        });
        const img = item.querySelector('img');
        if (img)
          img.addEventListener('error', () => {
            img.style.display = 'none';
          });
        item.addEventListener('click', async () => {
          const selectedAppId = item.getAttribute('data-appid');
          listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#8f98a0;font-size:12px;">⏳ 正在获取详情...</div>`;
          try {
            const detailResp = await window.__GR_MSG__.sendMessage({
              action: 'GET_STEAM_BY_APPID',
              appId: parseInt(selectedAppId),
              manual: true // v3.3.14：手动选择候选跳过名称相关性校验（用户主动确认）
            });
            if (detailResp && detailResp.data) {
              onSelect(detailResp.data, parseInt(selectedAppId));
            } else {
              listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#e74c3c;font-size:12px;">获取详情失败，请重试</div>`;
            }
          } catch (e) {
            listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#e74c3c;font-size:12px;">获取失败: ${esc(globalThis.__GR_MSG__.toUserMessage(e))}</div>`;
          }
        });
      });
    } catch (e) {
      listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#e74c3c;font-size:12px;">搜索失败: ${esc(globalThis.__GR_MSG__.toUserMessage(e))}</div>`;
    }
  }

  // v10.9.3：重试自动匹配（穿透负缓存；成功 → 整个浮窗切回 Steam 信息视图）
  const retryBtnEl = panel.querySelector('#gr-manual-retry');
  if (retryBtnEl && onRetry) {
    retryBtnEl.addEventListener('click', async () => {
      const statusEl = panel.querySelector('#gr-manual-retry-status');
      retryBtnEl.disabled = true;
      if (statusEl) statusEl.textContent = '⏳ 重试中...';
      const ok = await onRetry().catch(() => false);
      if (!ok) {
        retryBtnEl.disabled = false;
        if (statusEl) statusEl.textContent = '❌ 仍未命中';
      }
    });
  }
  // v14.7 批次 3/4：跳过（轻路径）——关浮窗 + 页面会话内不再自动弹出；
  // 负缓存首档 15min 到期后下次访问自动重查（分级退避，非 2h）。
  const skipBtnEl = panel.querySelector('#gr-manual-skip');
  if (skipBtnEl) {
    skipBtnEl.addEventListener('click', () => {
      dismissedGames.add(String(gameName || ''));
      if (typeof onClose === 'function') onClose();
    });
  }

  // v14.19.0：主机机型选择——点击 → onPickPlatform（sidebar.js：后台声明
  // 映射 + Metacritic 评分 + 浮窗切 MC 视图）；成功后浮窗被重渲染，失败在
  // 状态行提示（按钮复位可重选）
  // v14.22.2：视图切换——主视图入口按钮 ↔ 机型专页（返回按钮/Esc 双出口）；
  // Esc 监听带自清理（面板重渲染/专页隐藏即失效——v14.13 B6 kbHandler 同款
  // 防泄漏模式），专页激活期间候选列表键盘导航停用（列表仅隐藏未销毁）
  if (onPickPlatform) {
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
    escBackHandler = (ev) => {
      // 面板重渲染（MC 视图/重检索）后 platformView 已脱文档——自摘防泄漏
      if (!panel.contains(platformView)) {
        const h = escBackHandler; // 自引用初始化器内 TS 不收窄——局部常量守卫
        if (h) document.removeEventListener('keydown', h);
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
        all.forEach((b) => (b.disabled = true));
        if (statusEl) statusEl.textContent = '⏳ 正在声明平台并查询 Metacritic 评分...';
        try {
          const ok = await onPickPlatform(platformId);
          if (!ok && statusEl) {
            statusEl.textContent = '❌ Metacritic 查询失败（该条目已记录为主机游戏，评分稍后自动补查）';
            all.forEach((b) => (b.disabled = false));
          }
        } catch (e) {
          if (statusEl) statusEl.textContent = `❌ ${esc(globalThis.__GR_MSG__.toUserMessage(e))}`;
          all.forEach((b) => (b.disabled = false));
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
        listEl0.innerHTML =
          '<div style="padding:20px;text-align:center;color:#8f98a0;font-size:12px;">⏳ 正在确认 AppID ' +
          esc(appId) +
          ' ...</div>';
      }
      try {
        const resp = await window.__GR_MSG__.sendMessage({
          action: 'GET_STEAM_BY_APPID',
          appId: parseInt(appId, 10),
          manual: true // 手动绑定跳过名称相关性校验（与候选选择同语义）
        });
        if (resp && resp.data) {
          onSelect(resp.data, parseInt(appId, 10));
          return;
        }
        if (listEl0) {
          listEl0.innerHTML =
            '<div style="padding:20px;text-align:center;color:#e74c3c;font-size:12px;">未找到该 AppID 的 Steam 条目，请核对</div>';
        }
      } catch (e) {
        if (listEl0) {
          listEl0.innerHTML =
            '<div style="padding:20px;text-align:center;color:#e74c3c;font-size:12px;">绑定失败: ' +
            esc(window.__GR_MSG__.toUserMessage(e)) +
            '</div>';
        }
      } finally {
        bindBtn.disabled = false;
      }
    });
  }
}
