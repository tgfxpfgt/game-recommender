/**
 * 游戏雷达 Game Radar - 下载追踪面板模块 / Download Tracking Panel Module
 *
 * v14 B3：由 detail-page.js 拆分——Steam 页下载站资源浮窗、下载历史浮窗、
 * TRACK_EVENT 行为采集（steam_tags_update 回写）。
 * Split from detail-page.js (B3): the Steam-page download-site panel, the
 * download-history float and TRACK_EVENT collection (steam_tags_update).
 * 入口经 detail-page.js re-export（tracker 调用面不变）。
 * v15 阶段 3 全量迁移：面板渲染 Preact h()（innerHTML 6 处退役——文本插值
 * 天然转义；href 仅接受 http(s) 的协议复核守卫原样保留）。共享容器走
 * core/preact-mount.js mountView（异源 DOM 清场纪律）。
 */
import * as float from '../core/floats.js';
import * as status from '../core/status-bar.js';
import * as debug from '../core/debug.js';
import * as common from '../core/common.js';
import * as builder from '../adapters/builder.js';
import { mountView, h, Fragment } from '../core/preact-mount.js';

const dbg = (/** @type {...any} */ ...a) => debug.dbg(...a);

// 面板状态行统一样式（加载/空态/错误） / panel status line style
const PANEL_STATUS_STYLE = 'padding:14px;text-align:center;color:#8f98a0;';

// href 协议复核（铁律：规则包/外部输入渲染进 href 前只接受 http(s)——
// escapeAttr 不拦 javascript: 伪协议，Preact setAttribute 同样不拦，守卫前置）
// href protocol guard: only http(s) passes (rule-pack data is external input).
/** @param {string} raw @returns {string} 合法绝对 URL 或空串 */
function safeHref(raw) {
  try {
    const u = new URL(raw, location.href);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch {
    /* 非法 URL → 无链接 */
  }
  return '';
}

// ============ 功能3：Steam页面下载站资源浮窗 ============
// 显示下载站搜索结果，提供详情页跳转链接（v1.1 起不再提供网盘直链）。
// v14.22.0：页面标识参数化（opts.appId / opts.gameName / opts.steamJumpUrl）——
// Steam 商品页无参调用行为不变（自取 URL/标题）；steam250 游戏页复用同一
// 面板管线（传 appId/清洗后名称/Steam 商店跳转链接），零复制逻辑。
// v14.22.0: page identity is parameterizable — the Steam store page keeps its
// no-arg behavior; the steam250 game page reuses the same panel pipeline.
/**
 * @param {{appId?: string, gameName?: string, steamJumpUrl?: string}} [opts]
 */
export function injectDownloadSitePanel(opts = {}) {
  const appId = opts.appId || (window.location.pathname.match(/\/app\/(\d+)/) || [])[1] || '';
  let gameName = opts.gameName || '';
  if (!gameName) {
    const gameNameEl = document.querySelector('.apphub_AppName, .page_title');
    // 回退 title 时清理站点前缀/后缀：
    // 中文站 title 为"Steam 上的 X"（需去掉前缀），英文站为"X on Steam"（去后缀）
    // When falling back to the title, strip the site prefix/suffix:
    // CN store titles are "Steam 上的 X", EN store titles are "X on Steam".
    gameName = gameNameEl
      ? gameNameEl.textContent.trim()
      : document.title
          .replace(/^Steam\s*上的\s*/, '')
          .replace(/ on Steam.*$/, '')
          .trim();
  }
  const steamJumpUrl = opts.steamJumpUrl || '';

  if (!gameName) return;
  dbg(`Steam游戏: ${gameName} (appId=${appId})`);
  // 工作状态浮窗：开始搜索 / Work status bar: searching
  status.showStatus('正在搜索下载站资源', 0, 0, `${gameName}`);

  // 浮窗容器经 GR.float 统一管理（左下区域）
  const panel = float.create(float.ZONE.BOTTOM_LEFT, 'gr-download-site-panel', {
    chrome: true,
    width: 320,
    title: '📥 下载站资源'
  });
  mountView(panel, h('div', { style: PANEL_STATUS_STYLE }, '正在读取下载站缓存...'));

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
      const cachedFound = cachedSites.filter((/** @type {any} */ s) => s.found);
      if (cachedFound.length > 0) {
        renderDownloadSitePanel(panel, cachedSites, gameName, steamJumpUrl);
        status.showStats({
          title: '下载站缓存命中',
          summary: `${cachedFound.length}/${cachedSites.length} 个下载站已有收录`,
          rows: cachedFound.map((/** @type {any} */ s) => `${s.name}: ${s.detailUrl}`).slice(0, 3)
        });
      } else {
        mountView(panel, h('div', { style: PANEL_STATUS_STYLE }, '缓存中暂无收录，正在搜索下载站...'));
      }
      // 完整搜索（站内检索 + 缓存兜底）→ 更新面板
      const resp = await window.__GR_MSG__.sendMessage({
        action: 'SEARCH_DOWNLOAD_SITES',
        gameName: gameName,
        appId: appId
      });
      if (resp && Array.isArray(resp.sites)) {
        // v10.9：异型守卫（同 v10.8.1 候选浮窗教训——响应形状假设必须显式）
        renderDownloadSitePanel(panel, resp.sites, gameName, steamJumpUrl);
        // 工作状态浮窗：完成统计 / Completion stats
        const found = resp.sites.filter((/** @type {any} */ s) => s.found).length;
        status.showStats({
          title: '下载站资源检索完成',
          summary: `${found}/${resp.sites.length} 个下载站找到资源`,
          rows: resp.sites
            .filter((/** @type {any} */ s) => s.found)
            .map((/** @type {any} */ s) => `${s.name}: ${s.detailUrl}`)
            .slice(0, 3)
        });
      } else {
        mountView(panel, h('div', { style: PANEL_STATUS_STYLE }, '未找到下载站资源'));
        status.showStats({ title: '下载站资源检索完成', summary: '未找到匹配资源' });
      }
    } catch {
      mountView(panel, h('div', { style: PANEL_STATUS_STYLE + 'color:#e74c3c;' }, '搜索失败'));
    }
  })();
}

// 渲染下载站结果（仅显示详情页链接）
// v14.22.0：steamJumpUrl 非空时头部附 Steam 商店页跳转链接（steam250 页
// 复用入口——页面本身不在 Steam 域，无"打开商店页"原生路径）。
// v14.22.0: optional Steam store jump link in the header (steam250 reuse).
// v15 阶段 3 全量迁移：h() 树渲染（原模板串 + 双重 escape 全部退役；
// name/updateDate/version/size 均外部输入——文本子节点天然转义）。
/**
 * @param {HTMLElement} panel
 * @param {Array<any>} sites
 * @param {string} gameName
 * @param {string} [steamJumpUrl]
 */
function renderDownloadSitePanel(panel, sites, gameName, steamJumpUrl) {
  // v9.3.0：站点显示名读规则 displayName（此前硬编码 3 站——自定义站点显示 key）
  const rules = (builder.getSITE_RULES && builder.getSITE_RULES()) || [];
  /** @type {Record<string, string>} */
  const siteNames = {};
  for (const r of /** @type {any[]} */ (rules)) if (r && r.key && r.displayName) siteNames[r.key] = r.displayName;
  // v14.22.0：Steam 跳转链接仅接受 http(s)
  const steamJumpHref = steamJumpUrl ? safeHref(steamJumpUrl) : '';

  const siteRows = sites.map((/** @type {any} */ site) => {
    const name = siteNames[site.key] || site.key;
    if (site.found && site.detailUrl) {
      // v14.13.1：detailUrl 与 searchUrl 同风险（规则包数据渲染进 href）——
      // protocol 复核兜底，非法降级为无链接
      const detailHref = safeHref(site.detailUrl);
      const detailLink = detailHref
        ? h(
            'a',
            {
              href: detailHref,
              target: '_blank',
              rel: 'noopener noreferrer',
              style:
                'font-size:11px;color:#d2efa9;background:linear-gradient(to right,#75b022,#588a1b);padding:3px 10px;border-radius:2px;text-decoration:none;'
            },
            '跳转详情页 ↗'
          )
        : h('span', { style: 'font-size:11px;color:#666;' }, '（链接不可用）');
      return h(
        'div',
        {
          'data-site-key': String(site.key),
          style:
            'margin:0 14px 10px 14px;padding:10px;background:rgba(0,0,0,0.25);border:1px solid #2a475e;border-radius:3px;'
        },
        h(
          'div',
          { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;' },
          h('span', { style: 'font-size:12px;font-weight:bold;color:#67c1f5;' }, name),
          detailLink
        ),
        h(
          'div',
          { style: 'display:flex;flex-direction:column;gap:3px;font-size:11px;color:#acb2b8;' },
          site.updateDate ? h('div', null, '📅 更新: ' + site.updateDate) : null,
          site.version ? h('div', null, '🏷️ 版本: ' + site.version) : null,
          site.size ? h('div', null, '💾 大小: ' + site.size) : null,
          !site.updateDate && !site.version && !site.size
            ? h('div', { style: 'color:#666;' }, '点击跳转查看详情')
            : null
        )
      );
    }
    // v14.11 B4（报告 B/C P1-04 渲染侧兜底）：href 仅接受 http(s)——存量
    // 已入库恶意规则不受保存侧校验保护，渲染时 protocol 复核；非法则降级为纯文本不渲染链接
    const searchHref = safeHref(site.searchUrl);
    const searchLink = searchHref
      ? h(
          'a',
          {
            href: searchHref,
            target: '_blank',
            rel: 'noopener noreferrer',
            style: 'font-size:11px;color:#67c1f5;text-decoration:none;'
          },
          '去搜索 ↗'
        )
      : h('span', { style: 'font-size:11px;color:#666;' }, '（搜索链接不可用）');
    return h(
      'div',
      {
        style:
          'margin:0 14px 10px 14px;padding:10px;background:rgba(0,0,0,0.15);border:1px solid #222;border-radius:3px;'
      },
      h(
        'div',
        { class: 'gr-detail-flex-between' },
        h('span', { style: 'font-size:12px;color:#666;' }, name),
        searchLink
      ),
      h('div', { style: 'font-size:11px;color:#555;margin-top:3px;' }, '未直接找到该游戏')
    );
  });

  // v12 B7：跨站收录对比（≥2 站命中时显示版本/大小/更新时间对比 + 最优来源标记）
  const foundSites = sites.filter((/** @type {any} */ st) => st.found && st.detailUrl);
  let compareBlock = null;
  if (foundSites.length >= 2) {
    const tsOf = (/** @type {any} */ st) => {
      const t = Date.parse((st.updateDate || '').replace(/[年月]/g, '-').replace(/日$/, ''));
      return isNaN(t) ? 0 : t;
    };
    const best = foundSites.reduce(
      (/** @type {any} */ a, /** @type {any} */ b) => (tsOf(b) > tsOf(a) ? b : a),
      foundSites[0]
    );
    compareBlock = h(
      'div',
      {
        style:
          'margin:0 14px 10px 14px;padding:8px 10px;background:rgba(103,193,245,0.06);border:1px dashed #2a475e;border-radius:3px;'
      },
      h(
        'div',
        { style: 'font-size:11px;color:#8f98a0;margin-bottom:4px;' },
        '📋 跨站对比（按更新时间，⭐ = 最优来源）'
      ),
      foundSites.slice(0, 5).map((/** @type {any} */ st) => {
        const isBest = st === best && tsOf(st) > 0;
        // v13 B6：每行附详情页直达链接（detailUrl 已过同域白名单校验）
        return h(
          'div',
          { style: 'font-size:11px;color:#acb2b8;display:flex;justify-content:space-between;gap:8px;' },
          h(
            'span',
            null,
            isBest ? '⭐ ' : '',
            st.name,
            ' ',
            h(
              'a',
              {
                href: safeHref(st.detailUrl),
                target: '_blank',
                rel: 'noopener',
                style: 'color:#67c1f5;text-decoration:none;'
              },
              '打开 ↗'
            )
          ),
          h(
            'span',
            { style: 'color:#666;' },
            st.version ? 'v' + st.version : '—',
            st.size ? '· ' + st.size : '',
            st.updateDate ? '· ' + st.updateDate : '· 更新—'
          )
        );
      })
    );
  }

  mountView(
    panel,
    h(
      Fragment,
      null,
      h(
        'div',
        { style: 'padding:12px 14px 6px 14px;' },
        h('div', { style: 'font-size:13px;font-weight:bold;color:#fff;margin-bottom:2px;' }, '📥 下载站资源'),
        h(
          'div',
          { style: 'font-size:11px;color:#8f98a0;margin-bottom:8px;' },
          gameName,
          steamJumpHref
            ? h(
                'span',
                null,
                ' · ',
                h(
                  'a',
                  {
                    href: steamJumpHref,
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    style: 'font-size:11px;color:#67c1f5;text-decoration:none;'
                  },
                  '商店页 ↗'
                )
              )
            : null
        )
      ),
      siteRows,
      compareBlock
    )
  );
}

// ============ 下载历史浮窗（详情页显示上次下载记录） ============
/** @param {string} gameName */
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

      // v15 阶段 3 全量迁移：h() 树渲染（原模板串退役）
      panel.style.padding = '12px 14px';
      mountView(
        panel,
        h(
          Fragment,
          null,
          h(
            'div',
            { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;' },
            h('span', { style: 'font-size:16px;' }, '📥'),
            h('span', { style: 'font-weight:bold;color:#66c0f4;font-size:13px;' }, '下载记录')
          ),
          h(
            'div',
            { style: 'color:#8f98a0;margin-bottom:4px;' },
            '上次下载：',
            h('span', { style: 'color:#d2efa9;' }, timeStr)
          ),
          h('div', { style: 'color:#8f98a0;' }, '下载站点：', h('span', { style: 'color:#66c0f4;' }, siteName)),
          record.totalDownloads && record.totalDownloads > 1
            ? h('div', { style: 'color:#666;margin-top:6px;font-size:11px;' }, `共下载 ${record.totalDownloads} 次`)
            : null,
          record.lastDownloadUrl && safeHref(record.lastDownloadUrl)
            ? h(
                'div',
                { style: 'margin-top:8px;' },
                h(
                  'a',
                  {
                    href: safeHref(record.lastDownloadUrl),
                    target: '_blank',
                    style: 'color:#67c1f5;text-decoration:none;font-size:11px;'
                  },
                  '↗ 打开上次下载页'
                )
              )
            : null
        )
      );
    })
    .catch(() => {});
}

// ============ v14.22.0：steam250 游戏页功能入口（复用 Steam 页管线） ============
// steam250.com/app/<id> 404——真实游戏详情页在 club.steam250.com/app/<id>
//（2026-11 实测：top250 行内商店链接同指 club 子域）。本入口自 URL 提取
// appId、页面 <h2>/title 清洗提取游戏名，复用下载站检索面板（附 Steam
// 商店页跳转）与 CACHE_STEAM_PAGE 预热——与 Steam 商品页注入等价，行为
// 追踪不启用（steam250 非追踪站）。
// steam250 game-page entry (v14.22.0): the real game page lives on
// club.steam250.com/app/<id>; reuse the download-site panel + cache warm-up.
const S250_TITLE_SUFFIX_RE = /\s*[–—-]\s*Steam\s*250\s*$/i; // 页面 title 尾缀

/**
 * @param {string} url
 * @returns {string} appId（非 /app/<digits> 页返回空——榜单页零注入）
 */
export function steam250AppIdFromUrl(url) {
  const m = String(url || '').match(/\/app\/(\d{2,7})/);
  return m ? m[1] : '';
}

/**
 * @param {string} title
 * @returns {string} 清洗尾缀后的游戏名
 */
export function steam250NameFromTitle(title) {
  return String(title || '')
    .replace(S250_TITLE_SUFFIX_RE, '')
    .trim();
}

export function injectSteam250Panel() {
  const appId = steam250AppIdFromUrl(window.location.href);
  if (!appId) return; // 榜单/首页：无单一游戏对象，跳过
  const h2 = document.querySelector('h2');
  const rawName = (h2 && h2.textContent ? h2.textContent : document.title).trim();
  const gameName = steam250NameFromTitle(rawName);
  if (!gameName) return;
  dbg(`steam250 游戏页: ${gameName} (appId=${appId})`);
  // Steam 商品页同款预热（回到下载站列表页徽章立即有数据；有效缓存自动跳过）
  // Same cache warm-up as the store page (badges ready when returning).
  chrome.runtime.sendMessage({ action: 'CACHE_STEAM_PAGE', appId, gameName }).catch(() => {});
  injectDownloadSitePanel({
    appId,
    gameName,
    steamJumpUrl: `https://store.steampowered.com/app/${appId}/`
  });
}

// ============ TRACK_EVENT 行为采集 / Behavior Event Collection ============
// 回写 Steam 标签（steam_tags_update——推荐关键词闭环）
// Write back Steam tags (steam_tags_update; closes the keyword loop).
/** @param {Record<string, any>} data @param {string} gameName */
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
