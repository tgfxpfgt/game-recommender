/**
 * 游戏雷达 Game Radar - 详情页模块 / Detail Page Module
 *
 * 游戏名提取（去徽章/噪声分段）、Steam 信息浮窗（仿 Steam 右侧信息栏）、
 * 手动选择浮窗、下载历史浮窗、Steam 页下载站资源浮窗。
 * Name extraction, the Steam info panel, manual-select panel, download-history
 * panel and the Steam-page download-site resource panel.
 */
import * as detailTemplates from './detail-templates.js';
import * as float from '../core/floats.js';
import * as status from '../core/status-bar.js';
import * as debug from '../core/debug.js';
import * as common from '../core/common.js';
import * as builder from '../adapters/builder.js';

const dbg = (...a) => debug.dbg(...a);
const esc = (text) => common.escapeHtml(text);

// 从 Steam 图片的 alt 属性提取英文游戏名（"XXX on Steam" 模式）
// Extract the EN name from a Steam image alt ("XXX on Steam")
function extractEnglishFromSteamImage() {
  const imgs = document.querySelectorAll('img');
  for (const img of imgs) {
    const alt = (img.getAttribute('alt') || '').trim();
    const match = alt.match(/^(.+?)\s+on\s+Steam$/i);
    if (match) {
      const name = match[1].trim();
      if (name.length > 3 && name.length < 200 && /^[A-Za-z0-9][A-Za-z0-9\s'':&.!\-×x]*$/i.test(name)) {
        return name;
      }
    }
  }
  return null;
}

// 从页面提取游戏名称（不依赖适配器）
// 先移除 h1 徽章元素，再按分隔符分段移除纯噪声段（中英文名段都保留）
// 汇总贴/索引页（顶置汇总、索引）不是单个游戏，直接返回空（跳过详情处理）
export function detectGameName() {
  const h1 = document.querySelector('h1');
  const pageTitle = (document.title || '') + ' ' + (h1 ? h1.textContent : '');
  if (/顶置|置顶|汇总贴|汇总|索引/.test(pageTitle)) return '';

  if (h1) {
    // 移除徽章/角标元素（如咸鱼单机的"新游发布" span）
    h1.querySelectorAll('.post-badge, .badge, [class*="badge"]').forEach((b) => b.remove());

    // 策略1：优先从 h1 子元素中提取纯英文标题
    const enChild = h1.querySelector('span, div, p, em, strong, small');
    if (enChild) {
      const enText = (enChild.textContent || '').trim();
      if (enText.length > 3 && enText.length < 200 && /^[A-Za-z0-9][A-Za-z0-9\s'':&.!\-×x]*$/i.test(enText)) {
        return enText;
      }
    }

    // 策略2：按分隔符分段，移除纯噪声段（保留中英文名段）。
    // 噪声词表来自共享权威源 shared/patterns.js（v3.3.9 单源化，v6.2.0
    // 移除内联降级副本——权威源由 manifest 保证在内容脚本加载时已注入，
    // 与 content-sim 的注入顺序一致）
    const noisePattern = new RegExp(globalThis.__GR_PATTERNS__.noisePatternSource, 'gi');
    let text = h1.textContent.trim();
    const parts = text
      .split(/[|]+|\s+[-–—]\s+|[×•·]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1);
    const keptParts = parts.filter((p) => {
      const stripped = p.replace(noisePattern, '').replace(/[\s\|\-:：、]+/g, '');
      return stripped.length > 0;
    });
    if (keptParts.length > 0) text = keptParts.join('|');

    text = text.replace(/[\|\-–—:：\s]+$/, '').trim();
    if (text.length > 1 && text.length < 200) {
      // 策略2a：若清理后是纯中文标题，尝试从 Steam 图片 alt 提取英文标题
      if (/[\u4e00-\u9fff]/.test(text) && !/[A-Za-z]{3,}/.test(text)) {
        const enFromImg = extractEnglishFromSteamImage();
        if (enFromImg) return enFromImg;
      }
      return text;
    }

    // 策略3：清理后为空，回退到 textContent 中提取英文子串
    const enMatch = h1.textContent.match(/[A-Za-z][A-Za-z0-9\s'':&.!\-×x]{5,}/);
    if (enMatch && enMatch[0].length > 3 && enMatch[0].length < 200) return enMatch[0].trim();
  }
  // 从 title 获取
  const title = document.title || '';
  if (title) {
    // v5.0.0：清洗链收敛至 common.cleanPageTitle
    const cleaned = common.cleanPageTitle(title);
    return cleaned || document.title;
  }
  return '';
}

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
      const cachedSites = (cacheResp && cacheResp.sites) || [];
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
      if (resp && resp.sites) {
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

// ============ Steam详情浮窗（v6.4.4 起左侧信息栏） ============
// 容器经 GR.float 统一管理（左上区域，chrome 标题栏含折叠/关闭）
// v10.4.0：接收 settings——浮窗位置（detailFloatSide 左/右）与默认展开
// （detailFloatExpanded）可配置
export function injectSteamButton(gameName, settings) {
  dbg('注入Steam浮窗...');

  const panel = float.create(
    settings && settings.detailFloatSide === 'right' ? float.ZONE.TOP_RIGHT : float.ZONE.TOP_LEFT,
    'gr-steam-float',
    {
      chrome: true,
      width: 320,
      title: '🎮 Steam 信息',
      folded: settings ? settings.detailFloatExpanded === false : false
    }
  );
  // 初始隐藏，数据就绪后滑入显示（保留原动画语义）
  panel.style.cssText +=
    'opacity:0;transform:translateX(20px);pointer-events:none;transition:opacity 0.3s,transform 0.3s;';
  panel.innerHTML = `
      <div style="padding:16px;text-align:center;color:#8f98a0;">
        <div style="font-size:24px;margin-bottom:8px;">🎮</div>
        正在查询 Steam 信息...
      </div>
    `;

  /** @type {any} */
  let steamData = null;

  function showPanel() {
    panel.style.opacity = '1';
    panel.style.transform = 'translateX(0)';
    panel.style.pointerEvents = 'auto';
  }

  function hidePanel() {
    // 折叠内容区（chrome 标题栏保留）/ fold the body (header stays)
    panel.style.display = 'none';
  }

  // 人工报错重检索回调（v3.3.11）：清除错误 appid 缓存 → 重新检索 →
  // 更新浮窗；**重检索结果仍是同一 appid（未纠正）或失败时，自动进入
  // 手动选择面板**（v3.3.12）。reportIssue 在 renderAndShow 时创建
  // 并随渲染传递（makeOnRefresh 重渲染时复用同一回调）
  /** @type {(() => Promise<void>)|null} */
  let reportIssue = null;
  function makeReportIssue(name) {
    return async () => {
      const wrongAppId =
        steamData && steamData.appId ? String(steamData.appId) : builder.extractSteamAppIdFromImages() || '';
      dbg(`⚠️ 人工报错: 清除 appId ${wrongAppId} 缓存并重新检索 ${name}`);
      try {
        await window.__GR_MSG__.sendMessage({ action: 'REPORT_WRONG_APPID', appId: wrongAppId, gameName: name });
      } catch {
        /* 后台不可达不阻断重检索 */
      }
      // 重新检索：有封面 appId 直取，否则名称搜索
      const imgAppId = builder.extractSteamAppIdFromImages();
      /** @type {any} */
      let resp = null;
      if (imgAppId) {
        resp = await window.__GR_MSG__.sendMessage({ action: 'GET_STEAM_BY_APPID', appId: imgAppId, gameName: name });
      }
      if (!resp || !resp.data) {
        resp = await window.__GR_MSG__.sendMessage({ action: 'SEARCH_STEAM', gameName: name });
      }
      // v3.3.12：重检索成功但结果仍是同一 appid（自动纠正失败）→ 手动选择
      const sameAppId = resp && resp.data && wrongAppId && String(resp.data.appId) === wrongAppId;
      if (resp && resp.data && !sameAppId) {
        steamData = resp.data;
        const newCachedAt = resp.cachedAt || Date.now();
        dbg(`✅ 报错重检索成功: ${steamData.name} (appId ${steamData.appId})`);
        renderSteamSidebar(panel, steamData, hidePanel, newCachedAt, makeOnRefresh(name), reportIssue);
        showPanel();
      } else {
        dbg(
          sameAppId ? `⚠️ 报错重检索仍是同一 appId ${wrongAppId}，进入手动选择` : '⚠️ 报错重检索未找到，进入手动选择'
        );
        renderManualSelectPanel(panel, name, hidePanel, (selData, selAppId) => {
          renderAndShow(selData, Date.now(), name);
          chrome.runtime
            .sendMessage({ action: 'SAVE_MANUAL_MAPPING', gameName: name, appId: selAppId })
            .catch(() => {});
        });
      }
    };
  }

  // 手动更新缓存回调（成功获取数据后复用渲染逻辑）
  function makeOnRefresh(name) {
    return async () => {
      const appId = builder.extractSteamAppIdFromImages();
      let refreshResp;
      if (appId) {
        refreshResp = await window.__GR_MSG__.sendMessage({ action: 'GET_STEAM_BY_APPID', appId, gameName: name });
      } else {
        refreshResp = await window.__GR_MSG__.sendMessage({ action: 'REFRESH_STEAM_CACHE', gameName: name });
      }
      if (refreshResp && refreshResp.data) {
        steamData = refreshResp.data;
        const newCachedAt = refreshResp.cachedAt || Date.now();
        dbg(`🔄 手动刷新缓存成功: ${steamData.name}`);
        renderSteamSidebar(panel, steamData, hidePanel, newCachedAt, makeOnRefresh(name), reportIssue);
      } else {
        throw new Error('刷新后未获取到数据');
      }
    };
  }

  // 渲染数据并显示浮窗的通用函数
  function renderAndShow(data, cachedAt, name) {
    steamData = data;
    reportIssue = makeReportIssue(name);
    debug.DEBUG.steamStatus = `✅ ${data.ratingDesc || ''} ${data.positiveRate || ''}%`;
    dbg(`Steam: ${data.name} - ${data.ratingDesc} ${data.positiveRate}%`);
    renderSteamSidebar(panel, data, hidePanel, cachedAt, makeOnRefresh(name), reportIssue);
    showPanel();

    // v10.1.0：AppID 写 DOM 数据桥接——download-tracking 的点击委托（隔离世界
    // 同全局可读）随 click_download 事件带上 appId，后台据此累计下载计数 a
    try {
      if (data.appId) document.documentElement.dataset.grAppId = String(data.appId);
    } catch {
      /* ignore */
    }

    // 记录下载站详情页访问（Steam 匹配成功后补充记录；后台同时累计详情页打开计数 b）
    common.trackDownloadSiteVisit(data.appId, name);

    // 回写Steam标签
    if (data.genres && data.genres.length > 0) {
      chrome.runtime
        .sendMessage({
          action: 'TRACK_EVENT',
          data: {
            type: 'steam_tags_update',
            gameName: name,
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

  // 自动加载Steam数据：优先 appId 直取，回退名称搜索，都失败显示手动选择浮窗
  (async () => {
    debug.DEBUG.steamStatus = '查询中...';
    debug.scheduleDebugUpdate();
    status.showStatus('正在查询 Steam 信息', null, null, gameName); // 工作状态浮窗
    try {
      // v3.3.14：appId 提取限定主内容区——gamer520 侧边推荐图是 Steam CDN
      // 封面，全页提取会误取推荐游戏的 appId（如 16598 页右侧推荐 2001760）；
      // 主内容区无图时回退全页（后台另有 namesRelated 校验兜底）
      const mainEl = document.querySelector(
        'article, .entry-content, .post-content, .main-content, #main-content, main, .single-content'
      );
      const appId = builder.extractSteamAppIdFromImages(mainEl || document);
      /** @type {any} */
      let response = null;
      if (appId) {
        dbg(`从图片URL提取到 appId: ${appId}，直接获取 Steam 详情`);
        response = await window.__GR_MSG__.sendMessage({ action: 'GET_STEAM_BY_APPID', appId, gameName });
      }

      if (!response || !response.data) {
        response = await window.__GR_MSG__.sendMessage({ action: 'SEARCH_STEAM', gameName });
      }

      if (response && response.data) {
        renderAndShow(response.data, response.cachedAt || null, gameName);
        // 工作状态浮窗：完成统计 / Completion stats
        status.showStats({
          title: 'Steam 信息获取完成',
          summary: `${response.data.ratingDesc || '暂无评价'} ${response.data.positiveRate != null ? response.data.positiveRate + '%' : ''}`,
          rows: [
            `AppID ${response.data.appId} · ${response.data.name}`,
            response.data.chineseSupported ? '✓ 支持中文' : '✗ 暂不支持中文'
          ]
        });
      } else {
        debug.DEBUG.steamStatus = '❌ 未找到';
        dbg('Steam: 自动搜索未找到，显示手动选择浮窗');
        renderManualSelectPanel(panel, gameName, hidePanel, (selectedData, selectedAppId) => {
          renderAndShow(selectedData, Date.now(), gameName);
          chrome.runtime
            .sendMessage({
              action: 'SAVE_MANUAL_MAPPING',
              // v9.7.0：gameName 为契约必填字段——漏发会被消息契约层直接拒绝，
              // 手动纠错映射永不保存（报错重检索路径一直带着，此处是遗漏）
              gameName,
              appId: selectedAppId
            })
            .catch(() => {});
        });
        showPanel();
      }
    } catch (e) {
      debug.DEBUG.steamStatus = '❌ ' + String(e);
      dbg('Steam查询错误: ' + String(e));
      panel.innerHTML = `<div style="padding:16px;text-align:center;color:#e74c3c;">查询失败: ${esc(String(e))}</div>`;
      showPanel();
      status.showStats({ title: 'Steam 信息查询失败', summary: String(e) });
    }
    debug.scheduleDebugUpdate();
  })();
}

// 手动选择浮窗：自动搜索失败时显示候选游戏列表供用户选择
function renderManualSelectPanel(panel, gameName, onClose, onSelect) {
  panel.innerHTML = `
      <div style="padding:16px;">
        <div style="font-size:15px;font-weight:bold;color:#fff;margin-bottom:8px;">🎮 手动选择游戏</div>
        <div style="font-size:12px;color:#8f98a0;margin-bottom:12px;">
          未能自动匹配 Steam 游戏。请从下方候选列表中选择正确游戏，<br>或输入关键词手动搜索。
        </div>
        <div style="margin-bottom:10px;">
          <input type="text" id="gr-manual-search-input" placeholder="输入游戏名搜索..."
            style="width:100%;padding:8px 10px;background:#0e141b;border:1px solid #2a475e;border-radius:3px;color:#c7d5e0;font-size:13px;outline:none;font-family:inherit;">
        </div>
        <div id="gr-candidates-list" style="max-height:300px;overflow-y:auto;">
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
          <div class="gr-candidate-item" data-appid="${c.appId}" style="
            display:flex;align-items:center;gap:10px;padding:8px;margin:4px 0;
            background:rgba(0,0,0,0.2);border:1px solid #2a475e;border-radius:3px;
            cursor:pointer;transition:background 0.2s,border-color 0.2s;
          ">
            ${c.image ? `<img src="${common.escapeAttr(c.image)}" style="width:46px;height:17px;border-radius:2px;flex-shrink:0;">` : ''}
            <div style="flex:1;min-width:0;">
              <div style="font-size:12px;color:#c7d5e0;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.name)}</div>
              <div style="font-size:10px;color:#8f98a0;">App ID: ${c.appId}${c.price !== null && c.price !== undefined ? ` · ¥${c.price}` : ''}</div>
            </div>
          </div>
        `
        )
        .join('');

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
            listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#e74c3c;font-size:12px;">获取失败: ${esc(String(e))}</div>`;
          }
        });
      });
    } catch (e) {
      listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#e74c3c;font-size:12px;">搜索失败: ${esc(String(e))}</div>`;
    }
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

// 仿Steam右侧信息栏渲染（v5.1.0：模板拆至 detailTemplates.steamSidebar，
// 本函数保留 DOM 绑定；模板按元素 id 约定输出）
// Steam-style info sidebar (template in GR.detailTemplates since v5.1.0;
// this function keeps the DOM bindings).
function renderSteamSidebar(panel, data, onClose, cachedAt, onRefresh, onReport) {
  panel.innerHTML = detailTemplates.steamSidebar(data, cachedAt, !!onRefresh, !!onReport);

  // 绑定手动更新按钮事件
  if (onRefresh) {
    const refreshBtn = panel.querySelector('#gr-refresh-cache-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        const originalText = refreshBtn.textContent;
        refreshBtn.textContent = '⏳ 更新中...';
        refreshBtn.disabled = true;
        try {
          await onRefresh();
        } catch {
          refreshBtn.textContent = '❌ 更新失败';
          setTimeout(() => {
            refreshBtn.textContent = originalText;
            refreshBtn.disabled = false;
          }, 1500);
        }
      });
    }
  }

  // 绑定报错按钮事件（v3.3.11：人工纠错 → 清缓存重检索）
  if (onReport) {
    const reportBtn = panel.querySelector('#gr-report-issue-btn');
    if (reportBtn) {
      reportBtn.addEventListener('click', async () => {
        const originalText = reportBtn.textContent;
        reportBtn.textContent = '⏳ 重新检索中...';
        reportBtn.disabled = true;
        try {
          await onReport();
        } catch {
          reportBtn.textContent = '❌ 重检索失败';
          setTimeout(() => {
            reportBtn.textContent = originalText;
            reportBtn.disabled = false;
          }, 1500);
        }
      });
    }
  }

  // 头部图片加载失败时隐藏（addEventListener 替代内联 onerror）
  const headerImg = panel.querySelector('#gr-header-image');
  if (headerImg)
    headerImg.addEventListener('error', () => {
      headerImg.style.display = 'none';
    });
}
