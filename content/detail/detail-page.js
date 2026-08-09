/**
 * Game Recommender - 详情页模块 / Detail Page Module
 *
 * 游戏名提取（去徽章/噪声分段）、Steam 信息浮窗（仿 Steam 右侧信息栏）、
 * 手动选择浮窗、下载历史浮窗、Steam 页下载站资源浮窗。
 * Name extraction, the Steam info panel, manual-select panel, download-history
 * panel and the Steam-page download-site resource panel.
 */
(function (global) {
  'use strict';

  const GR = (global.__GR__ = global.__GR__ || {});
  const dbg = (...a) => GR.debug.dbg(...a);
  const esc = (...a) => GR.common.escapeHtml(...a);

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
  function detectGameName() {
    const h1 = document.querySelector('h1');
    if (h1) {
      // 移除徽章/角标元素（如咸鱼单机的"新游发布" span）
      h1.querySelectorAll('.post-badge, .badge, [class*="badge"]').forEach(b => b.remove());

      // 策略1：优先从 h1 子元素中提取纯英文标题
      const enChild = h1.querySelector('span, div, p, em, strong, small');
      if (enChild) {
        const enText = (enChild.textContent || '').trim();
        if (enText.length > 3 && enText.length < 200 && /^[A-Za-z0-9][A-Za-z0-9\s'':&.!\-×x]*$/i.test(enText)) {
          return enText;
        }
      }

      // 策略2：按分隔符分段，移除纯噪声段（保留中英文名段）
      const noisePattern = /(中文|汉化|破解|免安装|绿色|学习|未加密|完整版|豪华版|豪华|终极|数字|典藏|年度|重制|复刻|增强|正式|官方|简繁|简体|繁体|中英|多语言|特别版|标准版|解压即撸|预购特典|预购|特典|版|v[\d.]+|V[\d.]+|\d+\.\d+[\d.]*|Build[.\s]*\d+|update\s*\d+|DLC.*|全DLC|整合|硬盘|免DVD|下载|游戏下载|免费下载|支持手柄|手柄|支持|新游发布|免安装绿色版)/gi;
      let text = h1.textContent.trim();
      const parts = text.split(/[|]+|\s+[-–—]\s+|[×•·]/).map(s => s.trim()).filter(s => s.length > 1);
      const keptParts = parts.filter(p => {
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
    let title = document.title || '';
    if (title) {
      title = title
        .replace(/[\|\-–—_]\s*[^\|\-–—_]*$/, '')
        .replace(/(下载|游戏下载|免费下载|破解版|汉化版|中文版|绿色版|免安装).*$/i, '')
        .trim();
      return title || document.title;
    }
    return '';
  }

  // ============ 功能3：Steam页面下载站资源浮窗 ============
  // 显示下载站搜索结果，提供详情页跳转链接（v1.1 起不再提供网盘直链）。
  function injectDownloadSitePanel() {
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
    GR.status.showStatus('正在搜索下载站资源', null, null, `${gameName}`);

    const panel = document.createElement('div');
    panel.id = 'gr-download-site-panel';
    panel.style.cssText = `
      position:fixed;bottom:80px;left:16px;z-index:2147483647;
      width:320px;max-height:calc(100vh - 120px);overflow-y:auto;
      background:#1b2838;border:1px solid #2a475e;border-radius:4px;
      font-family:Arial,Helvetica,sans-serif;
      color:#c7d5e0;font-size:13px;line-height:1.5;
      box-shadow:0 0 12px rgba(0,0,0,0.6);
    `;
    panel.innerHTML = `<div style="padding:14px;text-align:center;color:#8f98a0;">正在搜索下载站资源...</div>`;
    document.body.appendChild(panel);

    const closeBtn = createCloseBtn(panel);
    panel.appendChild(closeBtn);

    (async () => {
      try {
        const resp = await chrome.runtime.sendMessage({
          action: 'SEARCH_DOWNLOAD_SITES',
          gameName: gameName,
          appId: appId
        });
        if (resp && resp.sites) {
          renderDownloadSitePanel(panel, resp.sites, gameName);
          // 工作状态浮窗：完成统计 / Completion stats
          const found = resp.sites.filter(s => s.found).length;
          GR.status.showStats({
            title: '下载站资源检索完成',
            summary: `${found}/${resp.sites.length} 个下载站找到资源`,
            rows: resp.sites.filter(s => s.found).map(s => `${s.name}: ${s.detailUrl}`).slice(0, 3)
          });
        } else {
          panel.innerHTML = `<div style="padding:14px;text-align:center;color:#8f98a0;">未找到下载站资源</div>`;
          panel.appendChild(createCloseBtn(panel));
          GR.status.showStats({ title: '下载站资源检索完成', summary: '未找到匹配资源' });
        }
      } catch (e) {
        panel.innerHTML = `<div style="padding:14px;text-align:center;color:#e74c3c;">搜索失败</div>`;
        panel.appendChild(createCloseBtn(panel));
      }
    })();
  }

  // 渲染下载站结果（仅显示详情页链接）
  function renderDownloadSitePanel(panel, sites, gameName) {
    const siteNames = { xdgame: 'XDGame', xianyudanji: '咸鱼单机', gamer520: 'Gamer520' };
    let html = `
      <div style="padding:12px 14px 6px 14px;">
        <div style="font-size:13px;font-weight:bold;color:#fff;margin-bottom:2px;">📥 下载站资源</div>
        <div style="font-size:11px;color:#8f98a0;margin-bottom:8px;">${esc(gameName)}</div>
      </div>
    `;

    for (const site of sites) {
      const name = siteNames[site.key] || site.key;
      if (site.found && site.detailUrl) {
        html += `
          <div data-site-key="${site.key}" style="margin:0 14px 10px 14px;padding:10px;background:rgba(0,0,0,0.25);border:1px solid #2a475e;border-radius:3px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:12px;font-weight:bold;color:#67c1f5;">${name}</span>
              <a href="${GR.common.escapeAttr(site.detailUrl)}" target="_blank" style="font-size:11px;color:#d2efa9;background:linear-gradient(to right,#75b022,#588a1b);padding:3px 10px;border-radius:2px;text-decoration:none;">跳转详情页 ↗</a>
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
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:12px;color:#666;">${name}</span>
              <a href="${GR.common.escapeAttr(site.searchUrl)}" target="_blank" style="font-size:11px;color:#67c1f5;text-decoration:none;">去搜索 ↗</a>
            </div>
            <div style="font-size:11px;color:#555;margin-top:3px;">未直接找到该游戏</div>
          </div>
        `;
      }
    }

    panel.innerHTML = html;
    panel.appendChild(createCloseBtn(panel));
  }

  function createCloseBtn(panel) {
    const btn = document.createElement('div');
    btn.textContent = '✕';
    btn.style.cssText = 'position:absolute;top:6px;right:10px;cursor:pointer;color:#666;font-size:14px;';
    btn.onclick = () => { panel.style.display = 'none'; };
    return btn;
  }

  // ============ 下载历史浮窗（详情页显示上次下载记录） ============
  function injectDownloadHistoryPanel(gameName) {
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

    chrome.runtime.sendMessage({
      action: 'GET_DOWNLOAD_HISTORY',
      gameName: gameName
    }).then(resp => {
      if (!resp || !resp.record) return; // 没有历史记录就不显示

      const record = resp.record;
      dbg(`下载历史: ${record.lastDownloadSiteName}, ${new Date(record.lastDownloadTime).toLocaleString()}`);

      // 格式化相对时间
      function formatTime(timestamp) {
        if (!timestamp) return '未知';
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        if (days === 0) {
          const hours = Math.floor(diff / (1000 * 60 * 60));
          if (hours === 0) {
            const mins = Math.floor(diff / (1000 * 60));
            return mins <= 1 ? '刚刚' : `${mins}分钟前`;
          }
          return `${hours}小时前`;
        }
        if (days === 1) return '昨天';
        if (days < 7) return `${days}天前`;
        return date.toLocaleDateString('zh-CN');
      }

      const panel = document.createElement('div');
      panel.id = 'gr-download-history-float';
      panel.style.cssText = `
        position:fixed;bottom:20px;left:16px;z-index:2147483647;
        width:280px;
        background:linear-gradient(135deg,#2a475e,#1b2838);
        border:1px solid #3a6a8e;
        border-radius:6px;
        font-family:Arial,Helvetica,sans-serif;
        color:#c7d5e0;font-size:12px;line-height:1.5;
        box-shadow:0 4px 16px rgba(0,0,0,0.5);
        padding:12px 14px;
        animation:gr-slide-in-left 0.3s ease-out;
      `;

      const timeStr = formatTime(record.lastDownloadTime);
      const siteName = record.lastDownloadSiteName || '未知站点';

      panel.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="font-size:16px;">📥</span>
          <span style="font-weight:bold;color:#66c0f4;font-size:13px;">下载记录</span>
          <span style="margin-left:auto;cursor:pointer;color:#666;font-size:14px;line-height:1;" id="gr-dl-history-close">✕</span>
        </div>
        <div style="color:#8f98a0;margin-bottom:4px;">
          上次下载：<span style="color:#d2efa9;">${timeStr}</span>
        </div>
        <div style="color:#8f98a0;">
          下载站点：<span style="color:#66c0f4;">${esc(siteName)}</span>
        </div>
        ${record.totalDownloads && record.totalDownloads > 1 ? `<div style="color:#666;margin-top:6px;font-size:11px;">共下载 ${record.totalDownloads} 次</div>` : ''}
        ${record.lastDownloadUrl ? `<div style="margin-top:8px;"><a href="${esc(record.lastDownloadUrl)}" target="_blank" style="color:#67c1f5;text-decoration:none;font-size:11px;">↗ 打开上次下载页</a></div>` : ''}
      `;

      document.body.appendChild(panel);

      const closeBtn = panel.querySelector('#gr-dl-history-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          panel.style.transition = 'opacity 0.2s, transform 0.2s';
          panel.style.opacity = '0';
          panel.style.transform = 'translateX(-20px)';
          setTimeout(() => panel.remove(), 200);
        });
      }
    }).catch(() => {});
  }

  // ============ Steam详情浮窗（仿Steam右侧信息栏） ============
  function injectSteamButton(gameName) {
    dbg('注入Steam浮窗...');

    const panel = document.createElement('div');
    panel.id = 'gr-steam-float';
    panel.style.cssText = `
      position:fixed;top:80px;right:16px;z-index:2147483647;
      width:320px;max-height:calc(100vh - 120px);overflow-y:auto;
      background:#1b2838;border-radius:4px;
      font-family:"Motiva Sans",Arial,Helvetica,sans-serif;
      color:#c7d5e0;font-size:13px;line-height:1.5;
      box-shadow:0 0 12px rgba(0,0,0,0.6);
      transition:opacity 0.3s,transform 0.3s;
      opacity:0;transform:translateX(20px);pointer-events:none;
    `;
    panel.innerHTML = `
      <div style="padding:16px;text-align:center;color:#8f98a0;">
        <div style="font-size:24px;margin-bottom:8px;">🎮</div>
        正在查询 Steam 信息...
      </div>
    `;
    document.body.appendChild(panel);

    // 关闭/展开按钮
    const toggleBtn = document.createElement('div');
    toggleBtn.style.cssText = `
      position:fixed;top:80px;right:16px;z-index:2147483647;
      width:28px;height:28px;line-height:28px;text-align:center;
      background:#2a475e;border-radius:4px 0 0 4px;cursor:pointer;
      color:#66c0f4;font-size:14px;display:none;
      box-shadow:0 2px 8px rgba(0,0,0,0.4);
    `;
    toggleBtn.textContent = '✕';
    toggleBtn.title = '关闭Steam信息';
    document.body.appendChild(toggleBtn);

    let panelVisible = false;
    let steamData = null;

    function showPanel() {
      panel.style.opacity = '1';
      panel.style.transform = 'translateX(0)';
      panel.style.pointerEvents = 'auto';
      toggleBtn.style.display = 'block';
      panelVisible = true;
    }

    function hidePanel() {
      panel.style.opacity = '0';
      panel.style.transform = 'translateX(20px)';
      panel.style.pointerEvents = 'none';
      toggleBtn.style.display = 'none';
      panelVisible = false;
    }

    toggleBtn.addEventListener('click', hidePanel);

    // 手动更新缓存回调（成功获取数据后复用渲染逻辑）
    function makeOnRefresh(name) {
      return async () => {
        const appId = GR.builder.extractSteamAppIdFromImages();
        let refreshResp;
        if (appId) {
          refreshResp = await chrome.runtime.sendMessage({ action: 'GET_STEAM_BY_APPID', appId, gameName: name });
        } else {
          refreshResp = await chrome.runtime.sendMessage({ action: 'REFRESH_STEAM_CACHE', gameName: name });
        }
        if (refreshResp && refreshResp.data) {
          steamData = refreshResp.data;
          const newCachedAt = refreshResp.cachedAt || Date.now();
          dbg(`🔄 手动刷新缓存成功: ${steamData.name}`);
          renderSteamSidebar(panel, steamData, hidePanel, newCachedAt, makeOnRefresh(name));
        } else {
          throw new Error('刷新后未获取到数据');
        }
      };
    }

    // 渲染数据并显示浮窗的通用函数
    function renderAndShow(data, cachedAt, name) {
      steamData = data;
      GR.debug.DEBUG.steamStatus = `✅ ${data.ratingDesc || ''} ${data.positiveRate || ''}%`;
      dbg(`Steam: ${data.name} - ${data.ratingDesc} ${data.positiveRate}%`);
      renderSteamSidebar(panel, data, hidePanel, cachedAt, makeOnRefresh(name));
      showPanel();

      // 记录下载站详情页访问（Steam 匹配成功后补充记录）
      GR.common.trackDownloadSiteVisit(data.appId, name);

      // 回写Steam标签
      if (data.genres && data.genres.length > 0) {
        chrome.runtime.sendMessage({
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
        }).catch(() => {});
      }
    }

    // 自动加载Steam数据：优先 appId 直取，回退名称搜索，都失败显示手动选择浮窗
    (async () => {
      GR.debug.DEBUG.steamStatus = '查询中...';
      GR.debug.scheduleDebugUpdate();
      GR.status.showStatus('正在查询 Steam 信息', null, null, gameName); // 工作状态浮窗
      try {
        const appId = GR.builder.extractSteamAppIdFromImages();
        let response = null;
        if (appId) {
          dbg(`从图片URL提取到 appId: ${appId}，直接获取 Steam 详情`);
          response = await chrome.runtime.sendMessage({ action: 'GET_STEAM_BY_APPID', appId, gameName });
        }

        if (!response || !response.data) {
          response = await chrome.runtime.sendMessage({ action: 'SEARCH_STEAM', gameName });
        }

        if (response && response.data) {
          renderAndShow(response.data, response.cachedAt || null, gameName);
          // 工作状态浮窗：完成统计 / Completion stats
          GR.status.showStats({
            title: 'Steam 信息获取完成',
            summary: `${response.data.ratingDesc || '暂无评价'} ${response.data.positiveRate != null ? response.data.positiveRate + '%' : ''}`,
            rows: [`AppID ${response.data.appId} · ${response.data.name}`, response.data.chineseSupported ? '✓ 支持中文' : '✗ 暂不支持中文']
          });
        } else {
          GR.debug.DEBUG.steamStatus = '❌ 未找到';
          dbg('Steam: 自动搜索未找到，显示手动选择浮窗');
          renderManualSelectPanel(panel, gameName, hidePanel, (selectedData, selectedAppId) => {
            renderAndShow(selectedData, Date.now(), gameName);
            chrome.runtime.sendMessage({
              action: 'SAVE_MANUAL_MAPPING',
              gameName,
              appId: selectedAppId
            }).catch(() => {});
          });
          showPanel();
        }
      } catch (e) {
        GR.debug.DEBUG.steamStatus = '❌ ' + e.message;
        dbg('Steam查询错误: ' + e.message);
        panel.innerHTML = `<div style="padding:16px;text-align:center;color:#e74c3c;">查询失败: ${esc(e.message)}</div>`;
        showPanel();
        GR.status.showStats({ title: 'Steam 信息查询失败', summary: e.message });
      }
      GR.debug.scheduleDebugUpdate();
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
        const resp = await chrome.runtime.sendMessage({
          action: 'SEARCH_STEAM_CANDIDATES',
          gameName: keyword || gameName
        });
        const candidates = (resp && resp.candidates) || [];

        if (candidates.length === 0) {
          listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#8f98a0;font-size:12px;">未找到候选游戏，请尝试其他关键词</div>`;
          return;
        }

        listEl.innerHTML = candidates.map(c => `
          <div class="gr-candidate-item" data-appid="${c.appId}" style="
            display:flex;align-items:center;gap:10px;padding:8px;margin:4px 0;
            background:rgba(0,0,0,0.2);border:1px solid #2a475e;border-radius:3px;
            cursor:pointer;transition:background 0.2s,border-color 0.2s;
          ">
            ${c.image ? `<img src="${GR.common.escapeAttr(c.image)}" style="width:46px;height:17px;border-radius:2px;flex-shrink:0;">` : ''}
            <div style="flex:1;min-width:0;">
              <div style="font-size:12px;color:#c7d5e0;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.name)}</div>
              <div style="font-size:10px;color:#8f98a0;">App ID: ${c.appId}${c.price !== null && c.price !== undefined ? ` · ¥${c.price}` : ''}</div>
            </div>
          </div>
        `).join('');

        // 绑定事件（hover 高亮与点击用 addEventListener，规避页面 CSP）
        listEl.querySelectorAll('.gr-candidate-item').forEach(item => {
          item.addEventListener('mouseenter', () => {
            item.style.background = 'rgba(102,192,244,0.1)';
            item.style.borderColor = '#66c0f4';
          });
          item.addEventListener('mouseleave', () => {
            item.style.background = 'rgba(0,0,0,0.2)';
            item.style.borderColor = '#2a475e';
          });
          const img = item.querySelector('img');
          if (img) img.addEventListener('error', () => { img.style.display = 'none'; });
          item.addEventListener('click', async () => {
            const selectedAppId = item.getAttribute('data-appid');
            listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#8f98a0;font-size:12px;">⏳ 正在获取详情...</div>`;
            try {
              const detailResp = await chrome.runtime.sendMessage({
                action: 'GET_STEAM_BY_APPID',
                appId: parseInt(selectedAppId),
                gameName
              });
              if (detailResp && detailResp.data) {
                onSelect(detailResp.data, parseInt(selectedAppId));
              } else {
                listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#e74c3c;font-size:12px;">获取详情失败，请重试</div>`;
              }
            } catch (e) {
              listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#e74c3c;font-size:12px;">获取失败: ${esc(e.message)}</div>`;
            }
          });
        });
      } catch (e) {
        listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#e74c3c;font-size:12px;">搜索失败: ${esc(e.message)}</div>`;
      }
    }

    // 初始搜索
    searchAndRender(gameName);

    // 搜索框事件（300ms 防抖）
    let searchTimer = null;
    const input = panel.querySelector('#gr-manual-search-input');
    if (input) {
      input.addEventListener('input', (e) => {
        if (searchTimer) clearTimeout(searchTimer);
        const keyword = e.target.value.trim();
        if (keyword.length < 2) return;
        searchTimer = setTimeout(() => searchAndRender(keyword), 300);
      });
    }
  }

  // 仿Steam右侧信息栏渲染
  // 参数：panel, data, onClose, cachedAt（缓存时间戳 ms）, onRefresh（手动更新回调）
  function renderSteamSidebar(panel, data, onClose, cachedAt, onRefresh) {
    const ratingColor = (data.positiveRate || 0) >= 80 ? '#66c0f4' : (data.positiveRate || 0) >= 60 ? '#a3cf06' : '#ff7b00';
    const ratingBg = (data.positiveRate || 0) >= 80 ? 'rgba(102,192,244,0.1)' : (data.positiveRate || 0) >= 60 ? 'rgba(163,207,6,0.1)' : 'rgba(255,123,0,0.1)';

    // 格式化缓存时间
    function formatCacheAge(ts) {
      if (!ts) return '未知';
      const diff = Date.now() - ts;
      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
      if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
      return Math.floor(diff / 86400000) + ' 天前';
    }
    const cacheAgeText = formatCacheAge(cachedAt);

    // 中文评测
    let reviewsHtml = '';
    if (data.reviews && data.reviews.length > 0) {
      reviewsHtml = `
        <div style="margin-top:12px;padding-top:10px;border-top:1px solid #2a475e;">
          <div style="font-size:12px;color:#8f98a0;margin-bottom:6px;">🇨🇳 简体中文评测</div>
          ${data.reviews.slice(0, 3).map(r => `
            <div style="padding:6px 8px;margin:4px 0;background:rgba(0,0,0,0.2);border-radius:3px;font-size:12px;border-left:2px solid ${r.recommended ? '#66c0f4' : '#a34c25'}">
              <span style="color:${r.recommended ? '#66c0f4' : '#a34c25'}">${r.recommended ? '👍 推荐' : '👎 不推荐'}</span>
              <div style="color:#acb2b8;margin-top:3px;word-break:break-all;">${esc(r.text.substring(0, 120))}${r.text.length > 120 ? '...' : ''}</div>
            </div>
          `).join('')}
        </div>
      `;
    }

    // SteamDB 信息区块（被拦截时显示SteamSpy补充数据）
    let steamdbHtml = '';
    if (data.steamdbUrl) {
      const sdb = data.steamdb;
      const spy = data.steamspy;
      const hasSdbData = sdb && sdb.available && (sdb.rating || sdb.currentPlayers || sdb.lowestPrice);
      const isBlocked = sdb && sdb.blocked;

      let bodyHtml = '';
      if (hasSdbData) {
        bodyHtml = `
          <div style="display:flex;flex-direction:column;gap:4px;font-size:12px;">
            ${sdb.rating ? `<div style="color:#acb2b8;">SteamDB 评分: <span style="color:#66c0f4;font-weight:bold;">${sdb.rating}%</span></div>` : ''}
            ${sdb.reviewCount ? `<div style="color:#acb2b8;">评测数: <span style="color:#c7d5e0;font-weight:bold;">${sdb.reviewCount}</span></div>` : ''}
            ${sdb.currentPlayers ? `<div style="color:#acb2b8;">当前在线: <span style="color:#a3cf06;font-weight:bold;">${sdb.currentPlayers}</span> 人</div>` : ''}
            ${sdb.lowestPrice ? `<div style="color:#acb2b8;">历史最低价: <span style="color:#ff7b00;font-weight:bold;">${sdb.lowestPrice}</span></div>` : ''}
          </div>
        `;
      } else if (spy && (spy.positiveRate !== null || spy.players2weeks)) {
        bodyHtml = `
          <div style="font-size:10px;color:#666;margin-bottom:4px;">SteamDB需人机验证，以下为SteamSpy数据</div>
          <div style="display:flex;flex-direction:column;gap:4px;font-size:12px;">
            ${spy.positiveRate !== null && spy.positiveRate !== undefined ? `<div style="color:#acb2b8;">好评率: <span style="color:#66c0f4;font-weight:bold;">${spy.positiveRate}%</span>${spy.reviewCount ? ` · ${spy.reviewCount} 条` : ''}</div>` : ''}
            ${spy.players2weeks ? `<div style="color:#acb2b8;">近两周玩家: <span style="color:#a3cf06;font-weight:bold;">${spy.players2weeks}</span> 人</div>` : ''}
            ${spy.averagePlaytime ? `<div style="color:#acb2b8;">平均时长: <span style="color:#c7d5e0;font-weight:bold;">${spy.averagePlaytime}</span></div>` : ''}
          </div>
        `;
      } else if (isBlocked) {
        bodyHtml = `<div style="font-size:11px;color:#8f98a0;">SteamDB 启用了人机验证，请点上方链接查看</div>`;
      } else {
        bodyHtml = `<div style="font-size:11px;color:#8f98a0;">点击链接查看SteamDB详细数据</div>`;
      }

      steamdbHtml = `
        <div style="margin-top:12px;padding:10px;background:rgba(0,0,0,0.25);border-radius:3px;border:1px solid #2a475e;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <span style="font-size:12px;font-weight:bold;color:#fff;">📊 SteamDB</span>
            <a href="${GR.common.escapeAttr(data.steamdbUrl)}" target="_blank" style="font-size:11px;color:#67c1f5;text-decoration:none;">查看 ↗</a>
          </div>
          ${bodyHtml}
        </div>
      `;
    }

    panel.innerHTML = `
      <!-- 头部图片 -->
      ${data.headerImage ? `
        <div style="position:relative;">
          <img id="gr-header-image" src="${GR.common.escapeAttr(data.headerImage)}" style="width:100%;display:block;border-radius:4px 4px 0 0;"/>
        </div>
      ` : ''}

      <div style="padding:14px;">
        <!-- 游戏名 + Demo/试玩版标识 -->
        <div style="font-size:17px;font-weight:bold;color:#fff;margin-bottom:8px;">
          ${(data.isDemo || /demo|试玩|trial/i.test((data.name || '') + ' ' + (data.englishName || '')))
            ? `<span style="display:inline-block;padding:2px 8px;margin-right:6px;font-size:11px;font-weight:bold;color:#ff7b00;background:rgba(255,123,0,0.15);border:1px solid #ff7b00;border-radius:3px;vertical-align:middle;">试玩版 / Demo</span>`
            : ''}
          ${esc(data.name)}
        </div>

        <!-- 中文支持 + 发行信息 -->
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;font-size:11px;">
          <span style="padding:2px 8px;border-radius:2px;background:${data.chineseSupported ? 'rgba(163,207,6,0.15)' : 'rgba(255,255,255,0.05)'};color:${data.chineseSupported ? '#a3cf06' : '#666'};">
            ${data.chineseSupported ? (data.simplifiedChinese ? '✓ 简体中文' : '✓ 支持中文') : '✗ 暂不支持中文'}
            ${data.chineseSupported && data.chineseHasAudio ? ' · 音频' : ''}
            ${data.chineseSupported && data.chineseHasSubtitles ? ' · 字幕' : ''}
          </span>
          ${data.releaseDate ? `<span style="padding:2px 8px;border-radius:2px;background:rgba(255,255,255,0.05);color:#8f98a0;">📅 ${esc(data.releaseDate)}</span>` : ''}
        </div>

        <!-- 跳转Steam按钮 -->
        ${data.url ? `<a href="${esc(data.url)}" target="_blank" style="
          display:block;margin-bottom:12px;padding:9px 0;text-align:center;
          background:linear-gradient(to right,#75b022,#588a1b);
          color:#d2efa9;border-radius:3px;text-decoration:none;
          font-size:13px;font-weight:bold;
          text-shadow:1px 1px 0 rgba(0,0,0,0.3);
        ">在 Steam 上查看</a>` : ''}

        <!-- 评分区域 - 三重评价（Steam总体/简体中文/SteamDB） -->
        <div style="background:${ratingBg};border-radius:3px;padding:10px;margin-bottom:12px;">
          <div style="padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:11px;color:#8f98a0;">Steam 总体</span>
              <span style="font-size:13px;font-weight:bold;color:${ratingColor};">${data.ratingDesc || '暂无'}</span>
            </div>
            <div style="font-size:11px;color:#8f98a0;margin-top:2px;text-align:right;">
              ${data.positiveRate !== null && data.positiveRate !== undefined ? `${data.positiveRate}% 好评` : ''}
              ${data.totalReviews ? ` · ${data.totalReviews.toLocaleString()} 条` : ''}
            </div>
          </div>
          <div style="padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:11px;color:#8f98a0;">🇨🇳 简体中文</span>
              <span style="font-size:13px;font-weight:bold;color:${(data.cnPositiveRate || 0) >= 80 ? '#66c0f4' : (data.cnPositiveRate || 0) >= 60 ? '#a3cf06' : '#ff7b00'};">${data.cnRatingDesc || (data.cnPositiveRate !== null && data.cnPositiveRate !== undefined ? data.cnPositiveRate + '% 好评' : '暂无')}</span>
            </div>
            <div style="font-size:11px;color:#8f98a0;margin-top:2px;text-align:right;">
              ${data.cnPositiveRate !== null && data.cnPositiveRate !== undefined ? `${data.cnPositiveRate}% 好评` : ''}
              ${data.cnTotalReviews ? ` · ${data.cnTotalReviews.toLocaleString()} 条` : ''}
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:11px;color:#8f98a0;">📊 SteamDB</span>
            <span style="font-size:13px;font-weight:bold;color:#67c1f5;">
              ${data.steamdb && data.steamdb.rating ? data.steamdb.rating + '%' : '—'}
            </span>
          </div>
          ${data.steamdb && data.steamdb.reviewCount ? `
            <div style="font-size:11px;color:#8f98a0;margin-top:2px;text-align:right;">${data.steamdb.reviewCount} 条评测</div>
          ` : ''}
        </div>

        <!-- 热门用户自定义标签 -->
        ${data.userTags && data.userTags.length > 0 ? `
          <div style="margin-bottom:12px;">
            <div style="font-size:12px;color:#8f98a0;margin-bottom:5px;">🔥 热门用户标签</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;">
              ${data.userTags.map(t => `<span style="padding:3px 8px;font-size:11px;background:rgba(103,193,245,0.12);color:#67c1f5;border-radius:2px;cursor:default;">${esc(t)}</span>`).join('')}
            </div>
          </div>
        ` : ''}

        <!-- 官方类型标签 -->
        ${data.genres && data.genres.length > 0 ? `
          <div style="margin-bottom:12px;">
            <div style="font-size:12px;color:#8f98a0;margin-bottom:5px;">类型</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;">
              ${data.genres.map(g => `<span style="padding:3px 8px;font-size:11px;background:rgba(255,255,255,0.06);color:#c7d5e0;border-radius:2px;cursor:default;">${esc(g)}</span>`).join('')}
            </div>
          </div>
        ` : ''}

        <!-- 开发商 -->
        ${data.developers && data.developers.length > 0 ? `
          <div style="font-size:12px;color:#8f98a0;margin-bottom:10px;">开发商: <span style="color:#67c1f5;">${esc(data.developers.join(', '))}</span></div>
        ` : ''}

        <!-- 简介 -->
        ${data.description ? `
          <div style="font-size:12px;color:#acb2b8;margin-bottom:12px;line-height:1.6;max-height:80px;overflow:hidden;">
            ${esc(data.description.substring(0, 200))}${data.description.length > 200 ? '...' : ''}
          </div>
        ` : ''}

        <!-- SteamDB 信息 -->
        ${steamdbHtml}

        <!-- 中文评测 -->
        ${reviewsHtml}

        <!-- 底部信息栏：App ID + 缓存时间 + 手动更新按钮 -->
        <div style="margin-top:12px;padding-top:10px;border-top:1px solid #2a475e;font-size:11px;color:#8f98a0;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            ${data.appId ? `<span>App ID: <a href="https://store.steampowered.com/app/${data.appId}" target="_blank" style="color:#67c1f5;text-decoration:none;">${data.appId}</a></span>` : '<span>App ID: —</span>'}
            <span title="${cachedAt ? new Date(cachedAt).toLocaleString() : ''}">缓存于 ${cacheAgeText}</span>
          </div>
          ${onRefresh ? `
            <button id="gr-refresh-cache-btn" style="
              margin-top:8px;width:100%;padding:7px 0;
              background:linear-gradient(to right,#3a6c8e,#2a475e);
              color:#c7d5e0;border:1px solid #3a6c8e;border-radius:3px;
              cursor:pointer;font-size:12px;font-family:inherit;
              transition:background 0.2s;
            ">🔄 手动更新 Steam 缓存</button>
          ` : ''}
        </div>
      </div>
    `;

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
          } catch (e) {
            refreshBtn.textContent = '❌ 更新失败';
            setTimeout(() => { refreshBtn.textContent = originalText; refreshBtn.disabled = false; }, 1500);
          }
        });
      }
    }

    // 头部图片加载失败时隐藏（addEventListener 替代内联 onerror）
    const headerImg = panel.querySelector('#gr-header-image');
    if (headerImg) headerImg.addEventListener('error', () => { headerImg.style.display = 'none'; });
  }

  GR.detail = {
    detectGameName,
    injectSteamButton,
    injectDownloadSitePanel,
    injectDownloadHistoryPanel
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
