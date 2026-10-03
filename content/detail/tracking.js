/**
 * 游戏雷达 Game Radar - 下载追踪面板模块 / Download Tracking Panel Module
 *
 * v14 B3：由 detail-page.js 拆分——Steam 页下载站资源浮窗、下载历史浮窗、
 * TRACK_EVENT 行为采集（steam_tags_update 回写）。
 * Split from detail-page.js (B3): the Steam-page download-site panel, the
 * download-history float and TRACK_EVENT collection (steam_tags_update).
 * 入口经 detail-page.js re-export（tracker 调用面不变）。
 */
import * as float from '../core/floats.js';
import * as status from '../core/status-bar.js';
import * as debug from '../core/debug.js';
import * as common from '../core/common.js';
import * as builder from '../adapters/builder.js';

const dbg = (...a) => debug.dbg(...a);
const esc = (text) => common.escapeHtml(text);

// ============ 功能3：Steam页面下载站资源浮窗 ============
// 显示下载站搜索结果，提供详情页跳转链接（v1.1 起不再提供网盘直链）。
export function injectDownloadSitePanel() {
  const appIdMatch = window.location.pathname.match(/\/app\/(\d+)/);
  const appId = appIdMatch ? appIdMatch[1] : '';
  const gameNameEl = document.querySelector('.apphub_AppName, .page_title');
  // 回退 title 时清理站点前缀/后缀：
  // 中文站 title 为"Steam 上的 X"（需去掉前缀），英文站为"X on Steam"（去后缀）
  // When falling back to the title, strip the site prefix/suffix:
  // CN store titles are "Steam 上的 X", EN store titles are "X on Steam".
  const gameName = gameNameEl
    ? gameNameEl.textContent.trim()
    : document.title
        .replace(/^Steam\s*上的\s*/, '')
        .replace(/ on Steam.*$/, '')
        .trim();

  if (!gameName) return;
  dbg(`Steam游戏: ${gameName} (appId=${appId})`);
  // 工作状态浮窗：开始搜索 / Work status bar: searching
  status.showStatus('正在搜索下载站资源', null, null, `${gameName}`);

  // 浮窗容器经 GR.float 统一管理（左下区域）
  const panel = float.create(float.ZONE.BOTTOM_LEFT, 'gr-download-site-panel', {
    chrome: true,
    width: 320,
    title: '📥 下载站资源'
  });
  panel.innerHTML = `<div style="padding:14px;text-align:center;color:#8f98a0;">正在读取下载站缓存...</div>`;

  (async () => {
    try {
      // v7.0.3：先展示缓存（即时，按 appId 查各下载站已收录网址）——
      // 一个 appId 对应多个下载站不同网址；缓存无结果再发起站内搜索
      const cacheResp = await window.__GR_MSG__.sendMessage({
        action: 'SEARCH_DOWNLOAD_SITES',
        gameName: gameName,
        appId: appId,
        cacheOnly: true
      });
      const cachedSites = cacheResp && Array.isArray(cacheResp.sites) ? cacheResp.sites : []; // v10.9
      const cachedFound = cachedSites.filter((s) => s.found);
      if (cachedFound.length > 0) {
        renderDownloadSitePanel(panel, cachedSites, gameName);
        status.showStats({
          title: '下载站缓存命中',
          summary: `${cachedFound.length}/${cachedSites.length} 个下载站已有收录`,
          rows: cachedFound.map((s) => `${s.name}: ${s.detailUrl}`).slice(0, 3)
        });
      } else {
        panel.innerHTML = `<div style="padding:14px;text-align:center;color:#8f98a0;">缓存中暂无收录，正在搜索下载站...</div>`;
      }
      // 完整搜索（站内检索 + 缓存兜底）→ 更新面板
      const resp = await window.__GR_MSG__.sendMessage({
        action: 'SEARCH_DOWNLOAD_SITES',
        gameName: gameName,
        appId: appId
      });
      if (resp && Array.isArray(resp.sites)) {
        // v10.9：异型守卫（同 v10.8.1 候选浮窗教训——响应形状假设必须显式）
        renderDownloadSitePanel(panel, resp.sites, gameName);
        // 工作状态浮窗：完成统计 / Completion stats
        const found = resp.sites.filter((s) => s.found).length;
        status.showStats({
          title: '下载站资源检索完成',
          summary: `${found}/${resp.sites.length} 个下载站找到资源`,
          rows: resp.sites
            .filter((s) => s.found)
            .map((s) => `${s.name}: ${s.detailUrl}`)
            .slice(0, 3)
        });
      } else {
        panel.innerHTML = `<div style="padding:14px;text-align:center;color:#8f98a0;">未找到下载站资源</div>`;
        status.showStats({ title: '下载站资源检索完成', summary: '未找到匹配资源' });
      }
    } catch {
      panel.innerHTML = `<div style="padding:14px;text-align:center;color:#e74c3c;">搜索失败</div>`;
    }
  })();
}

// 渲染下载站结果（仅显示详情页链接）
function renderDownloadSitePanel(panel, sites, gameName) {
  // v9.3.0：站点显示名读规则 displayName（此前硬编码 3 站——自定义站点显示 key）
  const rules = (builder.getSITE_RULES && builder.getSITE_RULES()) || [];
  const siteNames = {};
  for (const r of rules) if (r && r.key && r.displayName) siteNames[r.key] = r.displayName;
  let html = `
      <div style="padding:12px 14px 6px 14px;">
        <div style="font-size:13px;font-weight:bold;color:#fff;margin-bottom:2px;">📥 下载站资源</div>
        <div style="font-size:11px;color:#8f98a0;margin-bottom:8px;">${esc(gameName)}</div>
      </div>
    `;

  for (const site of sites) {
    // v9.7.0：站点名（规则的 displayName）/key 均为外部输入，必须转义——
    // 恶意规则包可借未转义 name 注入 HTML（同函数其余字段早已全部转义）
    const name = esc(siteNames[site.key] || site.key);
    const siteKeyAttr = common.escapeAttr(site.key);
    if (site.found && site.detailUrl) {
      html += `
          <div data-site-key="${siteKeyAttr}" style="margin:0 14px 10px 14px;padding:10px;background:rgba(0,0,0,0.25);border:1px solid #2a475e;border-radius:3px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:12px;font-weight:bold;color:#67c1f5;">${name}</span>
              <a href="${common.escapeAttr(site.detailUrl)}" target="_blank" style="font-size:11px;color:#d2efa9;background:linear-gradient(to right,#75b022,#588a1b);padding:3px 10px;border-radius:2px;text-decoration:none;">跳转详情页 ↗</a>
            </div>
            <div style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#acb2b8;">
              ${site.updateDate ? `<div>📅 更新: ${esc(site.updateDate)}</div>` : ''}
              ${site.version ? `<div>🏷️ 版本: ${esc(site.version)}</div>` : ''}
              ${site.size ? `<div>💾 大小: ${esc(site.size)}</div>` : ''}
              ${!site.updateDate && !site.version && !site.size ? '<div style="color:#666;">点击跳转查看详情</div>' : ''}
            </div>
          </div>
        `;
    } else {
      html += `
          <div style="margin:0 14px 10px 14px;padding:10px;background:rgba(0,0,0,0.15);border:1px solid #222;border-radius:3px;">
            <div class="gr-detail-flex-between">
              <span style="font-size:12px;color:#666;">${name}</span>
              <a href="${common.escapeAttr(site.searchUrl)}" target="_blank" style="font-size:11px;color:#67c1f5;text-decoration:none;">去搜索 ↗</a>
            </div>
            <div style="font-size:11px;color:#555;margin-top:3px;">未直接找到该游戏</div>
          </div>
        `;
    }
  }

  // v12 B7：跨站收录对比（≥2 站命中时显示版本/大小/更新时间对比 + 最优来源标记）
  const foundSites = sites.filter((st) => st.found && st.detailUrl);
  if (foundSites.length >= 2) {
    const tsOf = (st) => {
      const t = Date.parse((st.updateDate || '').replace(/[年月]/g, '-').replace(/日$/, ''));
      return isNaN(t) ? 0 : t;
    };
    const best = foundSites.reduce((a, b) => (tsOf(b) > tsOf(a) ? b : a), foundSites[0]);
    let cmp = `<div style="margin:0 14px 10px 14px;padding:8px 10px;background:rgba(103,193,245,0.06);border:1px dashed #2a475e;border-radius:3px;">
        <div style="font-size:11px;color:#8f98a0;margin-bottom:4px;">📋 跨站对比（按更新时间，⭐ = 最优来源）</div>`;
    for (const st of foundSites.slice(0, 5)) {
      const isBest = st === best && tsOf(st) > 0;
      // v13 B6：每行附详情页直达链接（detailUrl 已过同域白名单校验）
      cmp += `<div style="font-size:11px;color:#acb2b8;display:flex;justify-content:space-between;gap:8px;">
          <span>${isBest ? '⭐ ' : ''}${escapeHtml(st.name)} <a href="${common.escapeAttr(st.detailUrl)}" target="_blank" rel="noopener" style="color:#67c1f5;text-decoration:none;">打开 ↗</a></span>
          <span style="color:#666;">${st.version ? 'v' + escapeHtml(st.version) : '—'} ${st.size ? '· ' + escapeHtml(st.size) : ''} ${st.updateDate ? '· ' + escapeHtml(st.updateDate) : '· 更新—'}</span>
        </div>`;
    }
    cmp += '</div>';
    html += cmp;
  }

  panel.innerHTML = html;
}

// ============ 下载历史浮窗（详情页显示上次下载记录） ============
export function injectDownloadHistoryPanel(gameName) {
  if (!gameName) return;

  // 注入CSS动画（仅一次）
  if (!document.getElementById('gr-dl-history-style')) {
    const style = document.createElement('style');
    style.id = 'gr-dl-history-style';
    style.textContent = `
        @keyframes gr-slide-in-left {
          from { opacity: 0; transform: translateX(-20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes gr-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `;
    document.head.appendChild(style);
  }

  chrome.runtime
    .sendMessage({
      action: 'GET_DOWNLOAD_HISTORY',
      gameName: gameName
    })
    .then((resp) => {
      if (!resp || !resp.record) return; // 没有历史记录就不显示

      const record = resp.record;
      dbg(`下载历史: ${record.lastDownloadSiteName}, ${new Date(record.lastDownloadTime).toLocaleString()}`);

      // 浮窗容器经 GR.float 统一管理（左下区域）
      const panel = float.create(float.ZONE.BOTTOM_LEFT, 'gr-download-history-float', {
        chrome: true,
        width: 280,
        title: '📥 下载记录'
      });

      const timeStr = common.formatRelativeTime(record.lastDownloadTime);
      const siteName = record.lastDownloadSiteName || '未知站点';

      panel.style.padding = '12px 14px';
      panel.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="font-size:16px;">📥</span>
          <span style="font-weight:bold;color:#66c0f4;font-size:13px;">下载记录</span>
        </div>
        <div style="color:#8f98a0;margin-bottom:4px;">
          上次下载：<span style="color:#d2efa9;">${timeStr}</span>
        </div>
        <div style="color:#8f98a0;">
          下载站点：<span style="color:#66c0f4;">${esc(siteName)}</span>
        </div>
        ${record.totalDownloads && record.totalDownloads > 1 ? `<div style="color:#666;margin-top:6px;font-size:11px;">共下载 ${record.totalDownloads} 次</div>` : ''}
        ${record.lastDownloadUrl ? `<div style="margin-top:8px;"><a href="${common.escapeAttr(record.lastDownloadUrl)}" target="_blank" style="color:#67c1f5;text-decoration:none;font-size:11px;">↗ 打开上次下载页</a></div>` : ''}
      `;
    })
    .catch(() => {});
}

// ============ TRACK_EVENT 行为采集 / Behavior Event Collection ============
// 回写 Steam 标签（steam_tags_update——推荐关键词闭环）
// Write back Steam tags (steam_tags_update; closes the keyword loop).
export function trackSteamTagsUpdate(data, gameName) {
  if (data.genres && data.genres.length > 0) {
    chrome.runtime
      .sendMessage({
        action: 'TRACK_EVENT',
        data: {
          type: 'steam_tags_update',
          gameName: gameName,
          keywords: data.genres,
          steamAppId: data.appId,
          steamRating: data.rating,
          url: window.location.href,
          domain: window.location.hostname
        }
      })
      .catch(() => {});
  }
}
