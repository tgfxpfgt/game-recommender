/**
 * 游戏雷达 Game Radar - 详情页模块 / Detail Page Module
 *
 * 游戏名提取（去徽章/噪声分段）、Steam 信息浮窗（仿 Steam 右侧信息栏）、
 * 手动选择浮窗、下载历史浮窗、Steam 页下载站资源浮窗。
 * v10.5.3：新增内嵌 Steam 信息区——咸鱼单机/gamer520 详情页标题下方注入
 * 与 XDGame 原生「Steam 玩家评价」区 1:1 复刻的信息卡（结构/样式/数据
 * 口径完全一致，样式随卡片注入），数据与浮窗同步（renderSteamSidebar
 * 单点挂载）。
 * Name extraction, the Steam info panel, manual-select panel, download-history
 * panel and the Steam-page download-site resource panel.
 * v10.5.3: a pixel-faithful replica of XDGame's native Steam review card
 * (markup + stylesheet + data semantics) injected under the detail-page
 * title on xianyudanji/gamer520, synced with the float via one hook.
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

// v10.4.4：Steam250 排名行填充（查询后台快照；游戏不在前 250 时隐藏）
async function fillSteam250Info(appId) {
  if (!appId) return;
  try {
    const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_STEAM250_RANK', appId }, null, { timeout: 25000 });
    const info = resp && resp.info;
    const html = info
      ? `🏆 Steam250 排名 <b style="color:#67c1f5;">#${info.rank}</b> · ${info.score} 分 · ${Number(info.votes || 0).toLocaleString()} 条评价 ` +
        `<a href="https://steam250.com/top250" target="_blank" rel="noopener" style="color:#67c1f5;text-decoration:none;">Steam250 ↗</a>`
      : '';
    for (const id of ['gr-steam250-row', 'gr-steam250-inline']) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (html) {
        el.innerHTML = html;
        el.style.display = '';
      } else {
        el.style.display = 'none';
      }
    }
  } catch {
    /* 查询失败静默（行保持隐藏） */
  }
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

    // v10.4.4：Steam250 排名行（浮窗 + 内嵌卡双挂点；异步填充，无数据隐藏）
    fillSteam250Info(String(data.appId));

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

// ============ v10.5.3 任务1：内嵌 Steam 信息区（咸鱼单机/gamer520） ============
// XDGame 站点原生详情页自带「Steam 玩家评价」信息区，咸鱼单机/gamer520 没有。
// 在这两站详情页标题下方注入与 XDGame 完全一致的信息卡（模板见
// detailTemplates.steamInlineSection，样式为 XDGame article_steam_rating_
// 20260905.css 的 1:1 译本，见下方 INLINE_SECTION_CSS）。与浮窗互补：信息卡
// 纯展示随页面排版，浮窗保留交互（刷新缓存/人工纠错/手动选择）。站点按适配
// 器 key 门控，避免与 XDGame 原生信息区重复。
// Inline Steam review card for xianyudanji/gamer520 (XDGame has a native
// one): a pixel-faithful replica — template in detailTemplates, stylesheet
// below translated 1:1 from XDGame's own CSS. Display-only companion to the
// interactive float, gated by adapter key.
const INLINE_SECTION_ID = 'gr-steam-inline-section';
const INLINE_SECTION_SITES = ['xianyudanji', 'gamer520'];
const INLINE_SECTION_STYLE_ID = 'gr-steam-inline-style';

// XDGame article_steam_rating_20260905.css 1:1 译本：
//  · `.soft-detail .steam-review-*` → `#gr-steam-inline-section .steam-review-*`
//    （作用域挂到注入容器 id，不泄漏到宿主页、不影响 XDGame 原生卡片）
//  · `body.night .soft-detail *` → `#gr-steam-inline-section.gr-night *`
//    （XDGame 夜间为整站 body.night；宿主页以背景亮度判定后加 .gr-night 类）
//  · 字体/盒模型基线取自 XDGame 页面（layui body：14px Helvetica Neue 栈）
// 1:1 translation of XDGame's card CSS, scoped under the injected wrapper.
const INLINE_SECTION_CSS = `
#gr-steam-inline-section{font-family:'Helvetica Neue',Helvetica,'PingFang SC',Tahoma,Arial,sans-serif;font-size:14px;line-height:24px}
#gr-steam-inline-section,#gr-steam-inline-section *{box-sizing:border-box}
#gr-steam-inline-section p{margin:0}
#gr-steam-inline-section .steam-review-card{display:grid;grid-template-columns:230px minmax(0,1fr);gap:22px;box-sizing:border-box;margin:16px 0 20px;padding:17px 18px;border:1px solid #dce6f1;border-radius:14px;background:linear-gradient(145deg,#fbfdff 0%,#f5f8fc 100%);box-shadow:0 14px 30px -27px rgba(29,56,96,.5);color:#354052}
#gr-steam-inline-section .steam-review-overview{display:flex;flex-direction:column;justify-content:center;min-width:0;padding-right:20px;border-right:1px solid #e3e9f1}
#gr-steam-inline-section .steam-review-heading{display:flex;align-items:center;min-width:0}
#gr-steam-inline-section .steam-review-icon{display:inline-flex;flex:0 0 40px;align-items:center;justify-content:center;width:40px;height:40px;margin-right:11px;border:1px solid #d5e1ee;border-radius:11px;background:#eaf2fa;color:#4f779f;font-size:21px}
#gr-steam-inline-section .steam-review-heading strong{display:block;color:#2d394a;font-size:16px;font-weight:700;line-height:22px;white-space:nowrap}
#gr-steam-inline-section .steam-review-heading small{display:block;color:#8a96a5;font-size:13px;line-height:20px}
#gr-steam-inline-section .steam-review-level{display:inline-flex;align-items:center;align-self:flex-start;gap:6px;min-height:27px;margin:10px 0 0 51px;padding:0 10px;border-radius:999px;font-size:14px;font-weight:700;line-height:27px}
#gr-steam-inline-section .steam-review-level.is-positive{background:#e3f4ec;color:#2e8660}
#gr-steam-inline-section .steam-review-level.is-mixed{background:#fff1d8;color:#a26c17}
#gr-steam-inline-section .steam-review-level.is-negative{background:#f9e7e9;color:#bd545d}
#gr-steam-inline-section .steam-review-detail{display:grid;grid-template-columns:minmax(225px,.9fr) minmax(260px,1.2fr);gap:18px;min-width:0}
#gr-steam-inline-section .steam-review-primary{display:flex;flex-direction:column;justify-content:center;min-width:0;padding-right:18px;border-right:1px solid #e3e9f1}
#gr-steam-inline-section .steam-review-judgment{display:flex;flex-direction:column;justify-content:center;min-width:0}
#gr-steam-inline-section .steam-review-final-score{display:flex;align-items:baseline;gap:7px;min-width:0;white-space:nowrap}
#gr-steam-inline-section .steam-review-final-score>strong{color:#356da8;font-size:31px;font-weight:800;line-height:34px;letter-spacing:-.04em}
#gr-steam-inline-section .steam-review-final-score>span{display:flex;align-items:baseline;gap:8px;color:#536174}
#gr-steam-inline-section .steam-review-final-score b{color:#788595;font-size:13px;font-weight:600}
#gr-steam-inline-section .steam-review-final-score small{font-size:15px;font-weight:700}
#gr-steam-inline-section .steam-review-rate{display:flex;align-items:baseline;gap:8px;margin:1px 0 0;min-width:0;color:#748192;font-size:14px;line-height:21px;white-space:nowrap}
#gr-steam-inline-section .steam-review-rate b{color:#536174;font-size:14px;font-weight:700}
#gr-steam-inline-section .steam-review-primary>small{margin-top:3px;color:#98a3b0;font-size:12px;line-height:19px;white-space:nowrap}
#gr-steam-inline-section .steam-review-verdict{margin:0 0 10px;color:#3d4a5c;font-size:15px;font-weight:700;line-height:22px}
#gr-steam-inline-section .steam-review-meter{position:relative;height:8px;overflow:hidden;border-radius:999px;background:#e9cfd2}
#gr-steam-inline-section .steam-review-meter span{display:block;width:0;height:100%;border-radius:999px;background:linear-gradient(90deg,#55b58b,#72c99f);transition:width .5s ease}
#gr-steam-inline-section .steam-review-meta{display:flex;flex-wrap:wrap;gap:4px 16px;margin:8px 0 0;color:#7c8999;font-size:13px;line-height:20px}
#gr-steam-inline-section .steam-review-meta b{color:#5c697a;font-size:14px;font-weight:700}
#gr-steam-inline-section .steam-review-meta b.is-positive{color:#2f8a63}
#gr-steam-inline-section .steam-review-meta b.is-negative{color:#c66068}
#gr-steam-inline-section.gr-night .steam-review-card{border-color:#3b4655;background:linear-gradient(145deg,#292d33 0%,#262a30 100%);box-shadow:none;color:#cbd3de}
#gr-steam-inline-section.gr-night .steam-review-overview{border-color:#3e4855}
#gr-steam-inline-section.gr-night .steam-review-icon{border-color:#44566b;background:#303d4c;color:#91b6da}
#gr-steam-inline-section.gr-night .steam-review-heading strong{color:#e0e6ee}
#gr-steam-inline-section.gr-night .steam-review-heading small,#gr-steam-inline-section.gr-night .steam-review-primary>small,#gr-steam-inline-section.gr-night .steam-review-meta{color:#939fad}
#gr-steam-inline-section.gr-night .steam-review-level.is-positive{background:#30473f;color:#83c9aa}
#gr-steam-inline-section.gr-night .steam-review-level.is-mixed{background:#50452e;color:#e5bd72}
#gr-steam-inline-section.gr-night .steam-review-level.is-negative{background:#50363a;color:#e18b92}
#gr-steam-inline-section.gr-night .steam-review-primary{border-color:#3e4855}
#gr-steam-inline-section.gr-night .steam-review-final-score>strong{color:#92bce7}
#gr-steam-inline-section.gr-night .steam-review-final-score>span,#gr-steam-inline-section.gr-night .steam-review-final-score b{color:#aeb9c6}
#gr-steam-inline-section.gr-night .steam-review-rate{color:#aeb8c4}
#gr-steam-inline-section.gr-night .steam-review-rate b,#gr-steam-inline-section.gr-night .steam-review-meta b{color:#c8d0da}
#gr-steam-inline-section.gr-night .steam-review-verdict{color:#d3dae4}
#gr-steam-inline-section.gr-night .steam-review-meter{background:#563b40}
#gr-steam-inline-section.gr-night .steam-review-meta b.is-positive{color:#75c9a3}
#gr-steam-inline-section.gr-night .steam-review-meta b.is-negative{color:#e18b92}
@media screen and (max-width:640px){
#gr-steam-inline-section .steam-review-card{grid-template-columns:1fr;gap:13px;margin:14px 0 18px;padding:15px;border-radius:12px}
#gr-steam-inline-section .steam-review-overview{flex-direction:row;align-items:center;justify-content:space-between;gap:10px;padding:0 0 13px;border-right:0;border-bottom:1px solid #e3e9f1}
#gr-steam-inline-section .steam-review-icon{width:38px;height:38px;flex-basis:38px;margin-right:9px;font-size:20px}
#gr-steam-inline-section .steam-review-heading strong{font-size:16px}
#gr-steam-inline-section .steam-review-heading small{font-size:13px}
#gr-steam-inline-section .steam-review-level{flex:0 0 auto;align-self:auto;min-height:27px;margin:0;padding:0 9px;font-size:13px}
#gr-steam-inline-section .steam-review-detail{grid-template-columns:1fr;gap:10px}
#gr-steam-inline-section .steam-review-primary{position:relative;padding:0;border-right:0}
#gr-steam-inline-section .steam-review-final-score>strong{font-size:34px;line-height:37px}
#gr-steam-inline-section .steam-review-final-score>span{display:flex;align-items:baseline;gap:7px}
#gr-steam-inline-section .steam-review-final-score b,#gr-steam-inline-section .steam-review-final-score small{display:inline;line-height:20px}
#gr-steam-inline-section .steam-review-final-score small{font-size:14px}
#gr-steam-inline-section .steam-review-rate{flex-wrap:wrap;gap:1px 7px;margin-top:3px;font-size:14px;white-space:normal}
#gr-steam-inline-section .steam-review-primary>small{position:absolute;top:5px;right:0;margin:0;font-size:11px}
#gr-steam-inline-section .steam-review-verdict{margin:0 0 9px;font-size:15px;line-height:22px}
#gr-steam-inline-section .steam-review-meta{gap:4px 12px;font-size:13px}
#gr-steam-inline-section .steam-review-meta b{font-size:14px}
#gr-steam-inline-section.gr-night .steam-review-overview{border-bottom-color:#3e4855}
}
`;

// 样式随首张卡片注入一次（模块级幂等标记 + DOM id 双保险）
// The stylesheet ships with the first card (idempotent module flag + DOM id).
let inlineStyleInjected = false;
function ensureInlineSectionStyle() {
  if (inlineStyleInjected) return;
  try {
    if (document.getElementById(INLINE_SECTION_STYLE_ID)) {
      inlineStyleInjected = true;
      return;
    }
    const style = document.createElement('style');
    style.id = INLINE_SECTION_STYLE_ID;
    style.textContent = INLINE_SECTION_CSS;
    (document.head || document.documentElement).appendChild(style);
    inlineStyleInjected = true;
  } catch (e) {
    dbg('内嵌信息区样式注入失败: ' + String(e));
  }
}

// 宿主页是否为深色主题（XDGame 夜间配色启用判定）：
// body 计算背景亮度 < 128 → 深色；背景透明不可判定 → 回退系统偏好。
// Dark-host detection for the night palette (XDGame uses body.night).
function hostIsDarkMode() {
  try {
    if (typeof window.getComputedStyle === 'function' && document.body) {
      const bg = window.getComputedStyle(document.body).backgroundColor || '';
      const m = bg.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i);
      if (m) {
        const alpha = m[4] === undefined ? 1 : parseFloat(m[4]);
        if (alpha > 0) {
          const [r, g, b] = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
          return 0.299 * r + 0.587 * g + 0.114 * b < 128;
        }
      }
    }
  } catch {
    /* 计算样式不可用 → 回退系统偏好 / fall back to the media query */
  }
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  } catch {
    return false;
  }
}

function renderInlineSteamSection(data, cachedAt) {
  try {
    if (!data) return;
    // 站点门控：仅目标站注入（含 XDGame 在内的其他站不注入，防重复）
    let siteKey = '';
    try {
      siteKey = (builder.getAdapter() || {}).key || '';
    } catch {
      /* 适配器不可用时跳过 / skip when the adapter is unavailable */
    }
    if (!INLINE_SECTION_SITES.includes(siteKey)) return;

    const html = detailTemplates.steamInlineSection(data, cachedAt);
    const existing = document.getElementById(INLINE_SECTION_ID);
    if (!html) {
      // 新数据无评测（纠错换游戏等）→ 移除旧卡，与 XDGame 无数据隐藏一致
      if (existing) existing.remove();
      return;
    }

    ensureInlineSectionStyle();

    // 幂等：同游戏已注入 → 跳过；换游戏（纠错重检索）→ 移除旧卡重建
    if (existing) {
      if (existing.getAttribute('data-gr-appid') === String(data.appId || '')) return;
      existing.remove();
    }

    // 插入点：标题（h1 / h2.entry-title，WordPress 主题）之后；无标题时回退
    // 正文容器顶部；两者皆无 → 放弃（极端页面结构，不强行注入）
    const title = document.querySelector('h1, h2.entry-title');
    const content = document.querySelector('.entry-content, .post-content, .article-content, article, main');
    const section = document.createElement('div');
    section.id = INLINE_SECTION_ID;
    section.setAttribute('data-gr-appid', String(data.appId || ''));
    if (hostIsDarkMode()) section.className = 'gr-night'; // 夜间配色（XDGame body.night 等价）
    section.innerHTML = html;
    if (title && title.parentNode) {
      title.parentNode.insertBefore(section, title.nextSibling);
    } else if (content) {
      content.insertBefore(section, content.firstChild);
    } else {
      return;
    }
    dbg('✅ 已注入内嵌 Steam 信息区（详情页标题下方，XDGame 同款）');
  } catch (e) {
    dbg('内嵌 Steam 信息区注入失败: ' + String(e));
  }
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
          <div class="gr-candidate-item" data-appid="${common.escapeAttr(c.appId)}" style="
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

  // v10.5.3 任务1：同步渲染内嵌 Steam 信息区（咸鱼单机/gamer520 详情页）——
  // 所有数据就绪路径（首次加载/手动选择/纠错重检索/手动刷新）都经过本函数，
  // 单一挂点保证浮窗与内嵌信息区始终同步
  // Keep the inline Steam info card in sync here: every ready-data path goes
  // through this function, so the float and the inline card never diverge.
  renderInlineSteamSection(data, cachedAt);
}
