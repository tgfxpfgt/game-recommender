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

const esc = (text) => common.escapeHtml(text);

// 手动选择浮窗：自动搜索失败时显示候选游戏列表供用户选择
// v10.9.3：reason（后台诊断：not-found / steam-api-unreachable / error:…）展示 +
// 重试按钮（穿透负缓存重新自动匹配）——此前静默弹候选，用户无从判断失败原因
export function renderManualSelectPanel(panel, gameName, onClose, onSelect, reason, onRetry) {
  const reasonText = String(reason || '').trim();
  const retryBtn = onRetry
    ? `<div style="margin-bottom:10px;display:flex;gap:8px;">
        <button id="gr-manual-retry" class="gr-btn" style="flex:none;padding:6px 12px;">🔄 重试自动匹配</button>
        <span id="gr-manual-retry-status" style="font-size:11px;color:#8f98a0;align-self:center;"></span>
      </div>`
    : '';
  const reasonLine = reasonText
    ? `<div style="font-size:11px;color:#e67e22;margin-bottom:10px;padding:6px 8px;background:rgba(230,126,34,0.08);border:1px solid rgba(230,126,34,0.3);border-radius:3px;word-break:break-all;">⚠️ 未命中原因：${common.escapeHtml(reasonText)}${onRetry ? '<br>Steam 商店接口不可达时请检查网络/加速器；确认游戏在 Steam 后点上方重试。' : ''}</div>`
    : '';
  panel.innerHTML = `
      <div style="padding:16px;" role="dialog" aria-label="手动选择游戏">
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
      const setKbActive = (i) => {
        kbIndex = (i + items.length) % items.length;
        items.forEach((it, idx) => {
          const active = idx === kbIndex;
          it.style.background = active ? 'rgba(102,192,244,0.25)' : '';
          it.style.borderColor = active ? '#66c0f4' : '#2a475e';
        });
      };
      const kbHandler = (ev) => {
        if (!document.body.contains(listEl)) {
          document.removeEventListener('keydown', kbHandler);
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
        }
      };
      document.addEventListener('keydown', kbHandler);
      listEl.dataset.kbNav = '1';

      // 绑定事件（hover 高亮与点击用 addEventListener，规避页面 CSP）
      listEl.querySelectorAll('.gr-candidate-item').forEach((item) => {
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

  // 初始搜索
  searchAndRender(gameName);

  // 搜索框事件（300ms 防抖）
  /** @type {ReturnType<typeof setTimeout>|null} */
  let searchTimer = null;
  const input = panel.querySelector('#gr-manual-search-input');
  if (input) {
    input.addEventListener('input', (e) => {
      if (searchTimer) clearTimeout(/** @type {any} */ (searchTimer));
      const keyword = e.target.value.trim();
      if (keyword.length < 2) return;
      searchTimer = setTimeout(() => searchAndRender(keyword), 300);
    });
  }
}
