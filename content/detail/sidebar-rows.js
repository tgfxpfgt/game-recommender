/**
 * 游戏雷达 Game Radar - 浮窗数据行填充 / Sidebar Row Fills
 *
 * v14.3.0（第五轮 B1）：由 sidebar.js 拆分——浮窗内异步数据行的填充逻辑：
 * ITAD 历史最低价行 + 收藏按钮（F1/F2，v12 B6 发售追踪）、Steam250 排名行
 * （浮窗 + 内嵌卡双挂点）。行锚点 id 由 detail-templates.steamSidebar 模板
 * 输出（gr-itad-row / gr-steam250-row / gr-steam250-inline）。
 * Async row fills inside the Steam float: ITAD lowest + favorite button,
 * Steam250 rank (float + inline-card mounts). Anchor ids come from the
 * steamSidebar template.
 */
// v14.26.0 P1-6：消息超时单源
import { MSG_TIMEOUT_LONG_MS, MSG_TIMEOUT_NORMAL_MS } from '../core/timeouts.js';

// v14.6.2 修复（审查 B5）：回退分支曾是恒等函数（shared/escape.js 未注入的
// 异常场景下本文件所有注入点裸奔）——回退复刻 common.escapeHtmlLocal 的
// 纯字符串转义实现（与注入版同语义）
/** @param {string} text */
const esc = (text) =>
  typeof globalThis.escapeHtml === 'function'
    ? globalThis.escapeHtml(text)
    : String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

// v10.6.0：ITAD 最低价行 + 收藏按钮（F1/F2）
// ITAD：Key 未配置或查询失败 → 行隐藏；收藏：按钮切换 + 状态持久化
/**
 * @param {string} appId
 * @param {string} name
 * @param {string} releaseDate
 */
export async function fillItadAndFavorites(appId, name, releaseDate) {
  // v12 B6
  const itadEl = document.getElementById('gr-itad-row');
  // —— 收藏按钮（状态经 GET_FAVORITES 查询；点击 TOGGLE_FAVORITE）——
  // v12 B6：releaseDate 由调用方（renderAndShow → fillItadAndFavorites）传入
  if (itadEl) {
    const favRow = document.createElement('div');
    favRow.id = 'gr-fav-row-inner';
    favRow.style.marginTop = '4px';
    itadEl.parentNode.insertBefore(favRow, itadEl);
    const renderFav = (favorited) => {
      favRow.innerHTML = '';
      const btn = document.createElement('button');
      btn.textContent = favorited ? '★ 已收藏' : '☆ 收藏';
      btn.style.cssText = `padding:2px 10px;font-size:11px;cursor:pointer;border-radius:3px;border:1px solid ${favorited ? '#f1c40f' : '#666'};background:transparent;color:${favorited ? '#f1c40f' : '#aaa'}`;
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        try {
          const resp = await window.__GR_MSG__.sendMessage(
            {
              action: 'TOGGLE_FAVORITE',
              appId,
              name: name || '',
              releaseDate: releaseDate || '' // v12 B6：发售追踪
            },
            null,
            { timeout: MSG_TIMEOUT_NORMAL_MS }
          );
          if (resp && resp.favorited !== undefined) renderFav(resp.favorited);
        } catch {
          /* 后台不可达静默 */
        }
      });
      favRow.appendChild(btn);
    };
    try {
      const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_FAVORITES' }, null, {
        timeout: MSG_TIMEOUT_NORMAL_MS
      });
      const favs = (resp && resp.favorites) || {};
      renderFav(!!favs[appId]);
    } catch {
      favRow.style.display = 'none';
    }
  }
  // —— ITAD 最低价行（v14.28.12 B2-F3：reason 三态化——未配置/失效/暂不可用/
  // 无记录各自有灰行文案，不再四态同形为整行消失；仿 Steam250 保底行）——
  if (!itadEl) return;
  const REASON_TEXT = {
    'no-key': '未配置 API Key（设置页可配置）',
    auth: 'API Key 已失效（请检查设置页）',
    http: '服务暂不可用',
    network: '网络暂不可用',
    empty: '暂无价格记录'
  };
  try {
    const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_ITAD_LOWEST', appId }, null, {
      timeout: MSG_TIMEOUT_LONG_MS
    });
    const info = resp && resp.info;
    const reason = resp && resp.reason;
    if (!info || info.price === undefined || info.price === null) {
      if (reason && REASON_TEXT[reason]) {
        itadEl.innerHTML = `💰 ITAD 历史最低: <span style="color:#8f98a0;">${esc(REASON_TEXT[reason])}</span> <a href="https://isthereanydeal.com" target="_blank" rel="noopener" style="color:#67c1f5;text-decoration:none;">ITAD ↗</a>`;
        itadEl.style.display = '';
        return;
      }
      itadEl.style.display = 'none';
      return;
    }
    const shop = info.shop ? ` @ ${esc(info.shop)}` : ''; // v10.9.1：shop 一并转义
    const price = Number(info.price); // v10.9.1：异型防 "NaN"
    if (!isFinite(price)) throw new Error('bad-price');
    itadEl.innerHTML = `💰 ITAD 历史最低: <b style="color:#67c1f5;">${price.toFixed(2)}</b>${shop} <a href="https://isthereanydeal.com" target="_blank" rel="noopener" style="color:#67c1f5;text-decoration:none;">ITAD ↗</a>`;
    itadEl.style.display = '';
  } catch {
    itadEl.style.display = 'none';
  }
}

// v10.4.4：Steam250 排名行填充（查询后台快照）
// v14.21.0：区分"未入榜"与"快照不可用"——快照已加载（resp.loaded）而游戏不
// 在前 250 时显示灰色提示行（功能存在感可辨识）；快照不可用/查询失败整行隐藏
// v14.22.1：跳转链接升级为该游戏的 steam250 专属页深链——top250 通用榜单页
// 不含未入榜游戏；club.steam250.com/app/<appId> 实测对未入前 250 的游戏同样
// 提供（含 250 名外扩展排名），入榜游戏页面头部即其排名锚点。
// v14.22.2（用户需求"点击跳转 steam250"）：整行并入深链——命中区从尾部小
// 链接扩到整行；快照不可用（抓取失败/解析哨兵拒绝）不再整行静默——保底显示
// 可点榜单链接行（持续不可达环境下功能入口仍可辨识可触达）。
// v14.22.2: the whole row becomes the deep link (larger hit area); when the
// snapshot is unavailable, fall back to a link-only row instead of hiding.
/** @param {string} appId */
export async function fillSteam250Info(appId) {
  if (!appId) return;
  try {
    const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_STEAM250_RANK', appId }, null, {
      timeout: MSG_TIMEOUT_LONG_MS
    });
    const info = resp && resp.info;
    const loaded = !!(resp && resp.loaded);
    const href = `https://club.steam250.com/app/${encodeURIComponent(String(appId))}`;
    const linkAttr = `href="${href}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;cursor:pointer;"`;
    const linkHtml = `<a ${linkAttr}>`;
    const html = info
      ? // v10.9.1；v14.6.2：rank/score 补 esc（审查 B4）
        `${linkHtml}🏆 Steam250 排名 <b style="color:#67c1f5;">#${esc(String(info.rank ?? '-'))}</b> · ${esc(String(info.score ?? '-'))} 分 · ${Number(info.votes || 0).toLocaleString()} 条评价 <span style="color:#67c1f5;">Steam250 ↗</span></a>`
      : loaded
        ? `${linkHtml}<span style="color:#666;">🏆 未入 Steam250 前 250 名</span> <span style="color:#67c1f5;">Steam250 ↗</span></a>`
        : `<a href="${href}" target="_blank" rel="noopener" style="color:#666;text-decoration:none;cursor:pointer;">🏆 Steam250 榜单 ↗</a>`;
    for (const id of ['gr-steam250-row', 'gr-steam250-inline']) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.innerHTML = html;
      el.style.display = '';
    }
  } catch {
    // v14.28.12（B-2 审计 B2-F6）：消息级 catch 不再整行静默——渲染与
    // 快照不可用同款的保底链接行（入口可辨识可触达）。
    // Message-level catch renders the same fallback link row (not silent).
    const href = `https://club.steam250.com/app/${encodeURIComponent(String(appId))}`;
    for (const id of ['gr-steam250-row', 'gr-steam250-inline']) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.innerHTML = `<a href="${href}" target="_blank" rel="noopener" style="color:#666;text-decoration:none;cursor:pointer;">🏆 Steam250 榜单 ↗</a>`;
      el.style.display = '';
    }
  }
}

// v14.16.0 N10：系列作品行填充（名称索引本地聚合，零网络）——前作/续作/
// 衍生条目直达 Steam 页；无命中整行隐藏。GET_SERIES_ENTRIES（读侧白名单）。
/** @param {string} appId @param {string} name */
export async function fillSeriesInfo(appId, name) {
  if (!name) return;
  try {
    const resp = await window.__GR_MSG__.sendMessage(
      { action: 'GET_SERIES_ENTRIES', gameName: name, excludeAppId: appId },
      null,
      { timeout: MSG_TIMEOUT_NORMAL_MS }
    );
    const entries = (resp && resp.entries) || [];
    const html =
      entries.length > 0
        ? '🎮 系列作品：' +
          entries
            .map(
              (e) =>
                `<a href="https://store.steampowered.com/app/${esc(String(e.appId))}/" target="_blank" rel="noopener" style="color:#67c1f5;text-decoration:none;">${esc(e.name)}</a>`
            )
            .join(' · ')
        : '';
    const el = document.getElementById('gr-series-row');
    if (!el) return;
    if (html) {
      el.innerHTML = html;
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  } catch {
    /* 查询失败静默（行保持隐藏） */
  }
}
