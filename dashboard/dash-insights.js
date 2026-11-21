/* global cachedGameList renderGameTable */
/* eslint-disable no-unused-vars */
/**
 * 游戏雷达 Game Radar - Dashboard 洞察模块 / Dashboard Insights Module
 *
 * v14 B1：由 dashboard.js 拆分——标签偏好云、推荐反馈信号、收藏清单、
 * Steam 标签推荐、跨缓存游戏搜索。
 * Split from dashboard.js (B1): tag cloud, feedback signals, favorites,
 * Steam tag recommendations, cross-cache game search.
 *
 * 依赖：dash-stats.js 的 cachedGameList / renderGameTable（标签点击 → 过滤游戏表，
 * 经典脚本跨文件全局作用域，事件期调用——脚本全部加载后）。
 * 共享状态：activeTagFilter（本文件写，dash-stats.js renderGameTable 读）。
 * CSV/JSON 导出函数在 dash-export.js（本文件不含）。
 *
 * v15 阶段 3 全量迁移：渲染面 Preact h()（innerHTML 13 处退役——文本插值
 * 天然转义；点击/图片错误经 props 直连）。classic 页面脚本 → shared/
 * preact-globals.js 的 window.__GR_PREACT__（本文件加载序在其前——惰性
 * 访问器 P() 于事件期求值，同 options/panels/sites.js 模式）。
 */

// 标签偏好云：按权重分级着色与字号 / Tag cloud: color/size graded by weight
/** @type {string|null} - 跨文件全局（tsc 全程序共享作用域，dash-stats 消费） */
let activeTagFilter = null; // v11.0 B7：tag 聚合过滤（点击标签云 → 过滤游戏表）

/** @returns {{h: Function, render: Function, Fragment: any}} */
function P() {
  return /** @type {any} */ (globalThis).__GR_PREACT__;
}

/** @param {any[]} keywords */
function renderTagCloud(keywords) {
  const container = document.getElementById('tagCloud');
  if (!container) return;
  const PP = P();
  if (!keywords || keywords.length === 0) {
    PP.render(PP.h('span', { class: 'no-data' }, '暂无数据，请先浏览游戏网站让插件学习您的偏好'), container);
    return;
  }

  // v11.0 B7：标签可点击 → 聚合过滤游戏表（与游戏表标签闭环）——再点取消
  // v15 阶段 3：onClick prop 直连（原 querySelectorAll 接线块退役）
  const tags = keywords.map((/** @type {any} */ kw, /** @type {number} */ i) => {
    const weight = Number(kw.weight) || 0; // v10.9：异型权重防 NaN 字号
    const level = weight >= 0.6 ? 'high' : weight >= 0.3 ? 'medium' : 'low';
    const size = Math.max(12, Math.min(20, 12 + weight * 10));
    return PP.h(
      'span',
      {
        class: 'tag-item ' + level,
        'data-tag': String(kw.keyword),
        key: String(kw.keyword) + i,
        style:
          'font-size:' +
          size +
          'px;cursor:pointer;' +
          (activeTagFilter === kw.keyword ? 'outline:2px solid #67c1f5;' : ''),
        title: '匹配度: ' + Math.round(weight * 100) + '% — 点击筛选该类游戏',
        onClick: () => {
          activeTagFilter = activeTagFilter === kw.keyword ? null : kw.keyword; // 再点取消
          renderGameTable(cachedGameList);
          renderTagCloud(keywords);
        }
      },
      kw.keyword + ' ',
      PP.h('small', null, Math.round(weight * 100) + '%')
    );
  });
  PP.render(PP.h(PP.Fragment, null, tags), container);
}

// v10.0.0：推荐反馈信号渲染（dislike 闭环 / top 下载）
// v15 阶段 3：h() 渲染（pills 文本插值天然转义）
/** @param {any} feedback */
function renderFeedback(feedback) {
  const summaryEl = document.getElementById('feedbackSummary');
  const listEl = document.getElementById('feedbackLists');
  if (!summaryEl || !listEl) return;
  const PP = P();
  const fb = feedback || {};
  const hasData = (fb.gameCount || 0) > 0 || (fb.dislikeTotal || 0) > 0;
  if (!hasData) {
    summaryEl.textContent = '暂无数据';
    listEl.textContent = '';
    return;
  }
  summaryEl.textContent = `负反馈（不感兴趣）${fb.dislikeTotal || 0} 次 · 覆盖 ${fb.gameCount || 0} 款游戏`;
  /** @param {string} title @param {any[]} items @param {string} key */
  const renderList = (title, items, key) =>
    items && items.length > 0
      ? PP.h(
          'div',
          { style: 'margin-top:4px;' },
          PP.h('b', null, title),
          items.map((/** @type {any} */ g) =>
            PP.h('span', { class: 'gr-pill', style: 'margin-left:6px;' }, `${g.name} · ${g[key]}`)
          )
        )
      : null;
  PP.render(
    PP.h(
      PP.Fragment,
      null,
      renderList('👎 负反馈最多：', fb.topDisliked, 'dislikes'),
      renderList('⬇️ 下载最多：', fb.topDownloaded, 'downloads')
    ),
    listEl
  );
}

// v10.6.0 F2：收藏清单渲染（移除按钮 + Steam 外链）
// v15 阶段 3：h() 渲染（移除按钮 onClick prop 直连——原 querySelectorAll
// 接线块退役）；价格列为渲染后命令式填充（第二次异步消息到达后插入，
// 与原两阶段结构一致）
async function loadFavorites() {
  const el = document.getElementById('favList');
  if (!el) return;
  const PP = P();
  try {
    const resp = await window.__GR_MSG__.sendMessage({ action: 'GET_FAVORITES' });
    const favs = (resp && resp.favorites) || {};
    const entries = Object.entries(favs).sort(
      (/** @type {any} */ a, /** @type {any} */ b) => ((b[1] && b[1].addedAt) || 0) - ((a[1] && a[1].addedAt) || 0) // v10.9：null 值守卫
    );
    if (entries.length === 0) {
      el.textContent = '暂无收藏（在游戏详情浮窗点 ☆ 收藏）';
      return;
    }
    // v13 B5：发售状态三分组——排序按组优先级（即将发售 > 已公布 > 已发售 > 未公布），
    // 渲染时组切换处插组头
    const groupPrio = (/** @type {any} */ info) => {
      const rd = Date.parse((info && info.releaseDate) || '');
      if (isNaN(rd)) return 3;
      if (rd <= Date.now()) return 2;
      return rd - Date.now() <= 30 * 86400000 ? 0 : 1;
    };
    const groupLabel = ['🚀 即将发售（30 天内）', '📅 已公布发售日', '✅ 已发售', '❓ 未公布/未识别'];
    entries.sort(
      (/** @type {any} */ a, /** @type {any} */ b) =>
        groupPrio(a[1]) - groupPrio(b[1]) || ((b[1] && b[1].addedAt) || 0) - ((a[1] && a[1].addedAt) || 0)
    );
    let lastGroupPrio = -1;
    const rows = entries.map(([appId, f]) => {
      const prio = groupPrio(f);
      const groupHead =
        prio !== lastGroupPrio
          ? PP.h('div', { style: 'font-size:11px;color:#8f98a0;margin-top:6px;' }, groupLabel[prio])
          : null;
      lastGroupPrio = prio;
      return PP.h(
        PP.Fragment,
        { key: String(appId) },
        groupHead,
        PP.h(
          'div',
          {
            class: 'fav-row',
            'data-appid': String(appId),
            style: 'display:flex;align-items:center;gap:8px;margin-top:3px;'
          },
          PP.h(
            'span',
            { style: 'flex:1;' },
            '⭐ ' + f.name + ' ',
            PP.h('small', { style: 'color:#8f98a0;' }, '(' + String(appId) + ')')
          ),
          PP.h(
            'a',
            {
              href: 'https://store.steampowered.com/app/' + String(appId) + '/',
              target: '_blank',
              rel: 'noopener',
              style: 'color:#67c1f5;text-decoration:none;font-size:11px;'
            },
            'Steam ↗'
          ),
          PP.h(
            'button',
            {
              class: 'gr-btn gr-btn-sm fav-remove',
              style: 'padding:1px 8px;',
              onClick: async () => {
                await window.__GR_MSG__.sendMessage({ action: 'TOGGLE_FAVORITE', appId: String(appId), name: '' });
                loadFavorites().catch(() => {});
              }
            },
            '移除'
          )
        )
      );
    });
    PP.render(PP.h(PP.Fragment, null, rows), el);
    // v14.1.0（第一轮 B3 补完）：收藏价格列——现价/历史最低/折扣率。
    // GET_FAVORITE_PRICES 复用 ITAD 两处 TTL 缓存（暖会话零请求）；未配置
    // ITAD Key 时显示引导文案（后台 configured:false，不发任何请求）。
    try {
      const pr = await window.__GR_MSG__.sendMessage({ action: 'GET_FAVORITE_PRICES' });
      if (!pr || pr.configured === false) {
        const note = document.createElement('div');
        note.style.cssText = 'font-size:11px;color:#8f98a0;margin-top:6px;';
        note.textContent = '💰 在设置中配置 ITAD API Key 后，此处显示现价/历史最低/折扣率';
        el.appendChild(note);
      } else {
        const prices = pr.prices || {};
        el.querySelectorAll('.fav-row').forEach((/** @type {any} */ row) => {
          const p = prices[row.dataset.appid];
          if (!p) return;
          const span = document.createElement('span');
          span.style.cssText = 'font-size:11px;color:#8f98a0;white-space:nowrap;';
          if (p.current != null && p.lowest != null && p.lowest > 0) {
            const off = Math.round((1 - p.current / p.lowest) * 100);
            // v14.8 修复：史低徽章 DOM API（textContent）——XSS 棘轮护栏实战首功
            const isAllTimeLow = p.current <= p.lowest;
            if (isAllTimeLow) {
              const lowBadge = document.createElement('span');
              lowBadge.style.cssText = 'color:#ff7b00;font-weight:bold;margin-left:4px;';
              lowBadge.textContent = '💥 史低';
              span.appendChild(lowBadge);
            }
            span.title = isAllTimeLow
              ? `当前价即历史最低${p.shop ? '（' + String(p.shop) + '）' : ''}`
              : p.shop
                ? `历史最低商店：${String(p.shop)}`
                : '';
            span.textContent = `💰 历史最低 ${Number(p.lowest).toFixed(2)}`;
          } else {
            span.textContent = '💰 暂无价格数据';
          }
          row.insertBefore(span, row.querySelector('.fav-remove'));
        });
      }
    } catch {
      /* 价格获取失败静默——收藏列表本身不受影响 */
    }
  } catch {
    el.textContent = '加载失败';
  }
}

// 基于用户偏好标签向 Steam 搜索推荐游戏
// Recommend games on Steam based on the user's preferred tags
// v15 阶段 3：h() 渲染（图片错误 onError prop 直连——原 querySelectorAll
// 接线块退役）
async function loadSteamRecommendations() {
  const section = document.getElementById('steamRecSection');
  const listEl = document.getElementById('steamRecList');
  const basedOnEl = document.getElementById('recBasedOn');
  if (!section || !listEl) return;
  const PP = P();

  section.style.display = 'block';
  PP.render(PP.h('span', { class: 'no-data' }, '正在获取Steam推荐...'), listEl);
  if (basedOnEl) basedOnEl.textContent = '';

  try {
    const response = await window.__GR_MSG__.sendMessage({ action: 'GET_STEAM_RECOMMENDATIONS' });

    if (response && response.error) {
      PP.render(PP.h('span', { class: 'no-data' }, String(response.error)), listEl);
      return;
    }

    if (response.basedOnTags && basedOnEl) {
      basedOnEl.textContent = `基于您偏好的Steam标签: ${response.basedOnTags.join('、')}`;
    }

    if (!response.games || response.games.length === 0) {
      PP.render(PP.h('span', { class: 'no-data' }, '未找到匹配的Steam游戏'), listEl);
      return;
    }

    PP.render(
      PP.h(
        PP.Fragment,
        null,
        response.games.map((/** @type {any} */ game) =>
          PP.h(
            'div',
            { class: 'rec-card', key: String(game.appId || game.name) },
            game.image
              ? PP.h('img', {
                  class: 'rec-card-img',
                  src: String(game.image),
                  alt: String(game.name),
                  onError: (/** @type {any} */ ev) => {
                    ev.currentTarget.style.display = 'none';
                  }
                })
              : null,
            PP.h(
              'div',
              { class: 'rec-card-body' },
              PP.h('div', { class: 'rec-card-title' }, game.name),
              PP.h(
                'div',
                { class: 'rec-card-meta' },
                game.price ? '💰 ' + game.price : '',
                game.reviewSummary ? ' | ' + game.reviewSummary : ''
              ),
              PP.h(
                'div',
                { class: 'rec-card-tags' },
                (game.matchTags || []).map((/** @type {string} */ t, /** @type {number} */ i) =>
                  PP.h('span', { key: i }, t)
                )
              ),
              PP.h('a', { href: String(game.url), target: '_blank' }, '🔗 在Steam查看')
            )
          )
        )
      ),
      listEl
    );

    // 滚动到推荐区域
    section.scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    PP.render(PP.h('span', { class: 'no-data' }, '获取推荐失败: ' + window.__GR_MSG__.toUserMessage(e)), listEl);
  }
}

// v10.6.0 F3：跨缓存游戏搜索
// v15 阶段 3：h() 渲染
async function runGameSearch() {
  const input = document.getElementById('gameSearchInput');
  const out = document.getElementById('gameSearchResults');
  if (!input || !out) return;
  const PP = P();
  const q = input.value.trim().slice(0, 100); // v10.9：契约上限 100 字符（超长不再误导"无匹配"）
  if (q.length < 2) {
    out.textContent = '请输入至少 2 个字符';
    return;
  }
  out.textContent = '搜索中...';
  try {
    const resp = await window.__GR_MSG__.sendMessage({ action: 'SEARCH_CACHED_GAMES', query: q });
    const results = (resp && resp.results) || [];
    if (results.length === 0) {
      out.textContent = '无匹配游戏（仅搜索已缓存的游戏）';
      return;
    }
    PP.render(
      PP.h(
        PP.Fragment,
        null,
        results.map((/** @type {any} */ g) => {
          const s250 = g.steam250 ? ` · Steam250 #${g.steam250.rank ?? '-'}（${g.steam250.score ?? '-'} 分）` : ''; // v10.9.1
          const rate = g.positiveRate != null ? ` · 好评率 ${g.positiveRate}%` : '';
          const fav = g.favorited ? ' ⭐' : '';
          return PP.h(
            'div',
            { style: 'margin-top:3px;', key: String(g.appId) },
            PP.h(
              'a',
              {
                href: 'https://store.steampowered.com/app/' + String(g.appId) + '/',
                target: '_blank',
                rel: 'noopener',
                style: 'color:#67c1f5;text-decoration:none;'
              },
              g.name
            ),
            fav + rate + s250
          );
        })
      ),
      out
    );
  } catch (e) {
    out.textContent = '搜索失败: ' + window.__GR_MSG__.toUserMessage(e);
  }
}

// v10.6.0 F3：游戏搜索框绑定（幂等）
function bindGameSearch() {
  const btn = document.getElementById('gameSearchBtn');
  const input = document.getElementById('gameSearchInput');
  if (!btn || !input || btn.dataset.grBound) return;
  btn.dataset.grBound = '1';
  btn.addEventListener('click', runGameSearch);
  input.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
    if (e.key === 'Enter') runGameSearch();
  });
}
