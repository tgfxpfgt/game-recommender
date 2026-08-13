/**
 * 游戏雷达 Game Radar - 列表页模块 / List Page Module
 *
 * 页面类型检测、列表项提取、好评率徽章与过滤、推荐高亮、下一页预载。
 * Page-type detection, list-item extraction, rating badges & filtering,
 * recommendation highlighting and next-page prefetch.
 */
import * as listBatch from './list-batch.js';
import * as builder from '../adapters/builder.js';
import * as badges from './badges.js';
import * as common from '../core/common.js';
import * as status from '../core/status-bar.js';
import * as debug from '../core/debug.js';

const dbg = (...a) => debug.dbg(...a);

// ============ 页面类型检测（URL优先，最可靠） ============
// 详情页URL特征：以 数字.html 结尾，或 /game/数字.html 形式
// 注意：/game/数字/ 是分类页，不是详情页
function isDetailPageByUrl() {
    const path = window.location.pathname;
    return /\/\d+\.html?$/.test(path) || /\/game\/\d+\.html?$/i.test(path) || /\/\d+\.s?html?$/i.test(path);
}

// 列表页URL特征：首页、分类页、list页
function isListPageByUrl() {
    if (isDetailPageByUrl()) return false;
    const path = window.location.pathname;
    return (
      path === '/' ||
      path === '' ||
      /^\/[a-z0-9_-]+\/?$/i.test(path) ||
      /\/list\//i.test(path) ||
      /\/page\/\d+/i.test(path)
    );
}

// 智能获取列表项：优先适配器，回退通用链接提取（v3.3.9：回退扫描受
// maxScanLinks 上限保护，防止极端大列表页提取数千项并发请求）
function getListItemsSmart(adapter) {
    const items = adapter.getListItems ? adapter.getListItems() : [];
    if (items.length === 0) {
      const seen = new Set();
      const links = Array.from(document.querySelectorAll('a')).slice(
        0,
        builder.getScanLimit ? builder.getScanLimit() : 500
      );
      links.forEach((a) => {
        const href = a.href || '';
        let p;
        try {
          p = new URL(href, window.location.href).pathname;
        } catch {
          return; // 畸形 href 跳过，不中断整页提取 / skip malformed hrefs
        }
        if (/\/\d+\.html?$/.test(p) || /\/game\/\d+\.html?$/i.test(p)) {
          const text = a.textContent.trim().replace(/\s+/g, ' ');
          if (text.length > 2 && text.length < 200 && !seen.has(href)) {
            seen.add(href);
            items.push({ element: a.closest('li, div, article') || a, link: a, name: text, url: href, titleEl: a });
          }
        }
      });
    }
    return items;
}

// 等待列表项出现（AJAX 延迟渲染页面）：容器一出现即提取，超时返回当前结果
// Wait for list items on AJAX-rendered pages; resolve on the first non-empty
// extraction (with debounce) or after the timeout.
function waitForListItems(adapter, timeoutMs) {
    const limit = timeoutMs || 4000;
    return new Promise((resolve) => {
      let timer = null;
      let observer = null;
      let debounceTimer = null;
      let lastItems = [];
      const finish = (its) => {
        if (observer) observer.disconnect();
        if (timer) clearTimeout(timer);
        if (debounceTimer) clearTimeout(debounceTimer);
        resolve(its);
      };
      const check = () => {
        const its = getListItemsSmart(adapter);
        if (its.length > 0) {
          finish(its);
          return;
        }
        lastItems = its;
      };
      observer = new MutationObserver(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(check, 200);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      timer = setTimeout(() => finish(lastItems), limit);
      check(); // 立即先查一次（列表可能已渲染完）
    });
}

// ============ 列表页功能 ============
function trackListView(adapter, items, settings) {
    common.trackEvent('view_list', { itemCount: items.length, page: window.location.href });

    // 虚拟机版过滤：在请求推荐/好评率之前移除标题命中关键词的游戏项
    let filteredItems = items;
    if (settings.enableVmFilter) {
      filteredItems = applyVmFilter(items, settings.vmFilterKeywords);
    }

    filteredItems.forEach((item) => {
      item.link.addEventListener('click', () => {
        common.trackEvent('click_detail', { gameName: item.name, gameUrl: item.url });
      });
    });

    // v4.1.0：封面 appId 提取延迟化（fireBatch 内对批内名字惰性提取，不再
    // 全量扫描）；推荐请求并入批次调度（fireBatch 并发，滚动批次自动获得
    // 推荐徽章）。首屏提取成本从 O(全部 item) 降至 O(批大小)。
    listBatch.requestSteamRatings(filteredItems, settings);

    // 预载下一页：提前预热下一页的 Steam 缓存
    preloadNextPage();
}

// 虚拟机版过滤：从 items 中移除标题命中关键词的游戏项，并从 DOM 删除对应元素
function applyVmFilter(items, keywords) {
    const kws = keywords && keywords.length > 0 ? keywords : ['虚拟机板', '虚拟机'];
    const kept = [];
    let removed = 0;
    for (const item of items) {
      const name = (item.name || '').toLowerCase();
      const hit = kws.some((kw) => kw && name.includes(kw.toLowerCase()));
      if (hit) {
        // 从 DOM 移除（优先移除栅格列容器以避免留空，与好评率过滤共用逻辑）
        badges.removeItemFromDom(item);
        removed++;
      } else {
        kept.push(item);
      }
    }
    if (removed > 0) {
      dbg(`🚫 虚拟机过滤：移除 ${removed} 个游戏项，保留 ${kept.length} 个`);
    }
    return kept;
}

// ============ 预载下一页 / Preload Next Page ============
let preloadedNextPage = false;

function preloadNextPage() {
    if (preloadedNextPage) return; // 每页仅预载一次
    preloadedNextPage = true;

    // 延迟 2 秒执行，确保当前页渲染和 API 请求优先完成
    setTimeout(async () => {
      try {
        const nextUrl = findNextPageUrl();
        if (!nextUrl) {
          dbg('预载：未找到下一页链接');
          return;
        }

        dbg(`预载下一页: ${nextUrl}`);

        // v3.4.0：安全加固——仅同源请求（分页链接来自页面 DOM，恶意页面可
        // 指向内网地址）+ 15s 超时（防挂起拖垮页面）；响应受 CORS 限制只读
        // 解析，但请求本身不应代发到任意目标
        const next = new URL(nextUrl, window.location.href);
        if (next.origin !== window.location.origin) {
          dbg('预载下一页: 跨源链接已跳过');
          return;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        let response;
        try {
          response = await fetch(nextUrl, { credentials: 'omit', signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
        if (!response.ok) {
          dbg(`预载：HTTP ${response.status}`);
          return;
        }
        const html = await response.text();

        const doc = new DOMParser().parseFromString(html, 'text/html');
        const { names: gameNames, appIds, covers } = extractGameNamesFromDoc(doc);
        if (gameNames.length === 0) {
          dbg('预载：未提取到游戏名');
          return;
        }

        dbg(`预载：提取到 ${gameNames.length} 个游戏名，开始预热 Steam 缓存`);

        chrome.runtime
          .sendMessage({
            action: 'PREFETCH_STEAM_RATINGS',
            names: gameNames,
            appIds,
            covers
          })
          .then(() => {
            dbg(`✅ 预载完成：已预热 ${gameNames.length} 个游戏的 Steam 缓存`);
          })
          .catch(() => {});
      } catch (e) {
        dbg('预载下一页失败: ' + String(e));
      }
    }, 2000);
}

// 查找下一页 URL：按优先级匹配常见分页模式
function findNextPageUrl() {
    const selectors = [
      'a[rel="next"]',
      'a.next',
      'a.next-page',
      'a.nextpost',
      '.pagination .next a',
      '.pager .next a',
      '.page-nav .next a',
      '.wp-pagenavi .next a',
      'a[aria-label*="next" i]'
    ];
    for (const sel of selectors) {
      const link = document.querySelector(sel);
      if (link && link.href) return link.href;
    }

    const pageLinks = document.querySelectorAll(
      '.pagination a, .pager a, .page-nav a, .wp-pagenavi a, nav.pagination a, .pages a'
    );
    for (const link of pageLinks) {
      const text = (link.textContent || '').trim();
      if (/下一页|»|›|Next/i.test(text) && link.href) return link.href;
    }

    return null;
}

// 从解析后的文档中提取游戏名与封面 appId（选择器来自规则文件）
function extractGameNamesFromDoc(doc) {
    const names = new Set();
    const appIds = {};
    const covers = {};
    const domain = window.location.hostname;

    const rule = (builder.getSITE_RULES() || []).find((r) => r.domains.some((d) => domain.includes(d)));
    if (rule) {
      const cfg = rule.listItem || {};
      const containers = cfg.containers || [];
      const titleLink = cfg.titleLink;
      const titleEls = cfg.titleEls || ['h2', 'h3', '.title', '.entry-title'];
      const minLen = cfg.minLen ?? 2;
      const maxLen = cfg.maxLen ?? 200;
      for (const sel of containers) {
        doc.querySelectorAll(sel).forEach((el) => {
          const t = titleLink ? el.querySelector(titleLink) : el.querySelector(titleEls.join(','));
          if (t) {
            const text = (t.textContent || '').trim().replace(/\s+/g, ' ');
            if (text.length > minLen && text.length < maxLen) {
              names.add(text);
              if (!appIds[text]) {
                // 复用 builder 的封面 appId 提取（统一正则实现）
                const info = builder.extractSteamImageInfo(el);
                if (info) {
                  appIds[text] = info.appId;
                  covers[text] = info.cover;
                }
              }
            }
          }
        });
        if (names.size > 0) break;
      }
    }

    // 通用回退：指向详情页且有文本的链接
    if (names.size === 0) {
      const baseUrl = window.location.href;
      doc.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href') || '';
        if (!href) return;
        try {
          const p = new URL(href, baseUrl).pathname;
          if (/\/\d+\.html?$/.test(p) || /\/game\/\d+\.html?$/i.test(p)) {
            const text = (a.textContent || '').trim().replace(/\s+/g, ' ');
            if (text.length > 2 && text.length < 200) names.add(text);
          }
        } catch {}
      });
    }

    return { names: [...names], appIds, covers };
}

// ============ 列表页 Steam 好评率（两波：缓存命中即时显示 + 后台推送更新） ============
// Two-wave rating flow: cached hits render instantly; misses are fetched in
// the background and pushed back via STEAM_RATINGS_UPDATE.
// v5.1.0：状态容器（list-page 与 list-batch 共享）/ shared state container
export const _state = { ratingsJob: null, batchState: null };

function createRatingsJob(processItems, settings, uniqueNames) {
    _state.ratingsJob = {
      processItems,
      settings,
      uniqueNames,
      processed: new Set(), // 已出结果的游戏名（徽章已显示）/ names already resolved
      shown: 0,
      filtered: 0,
      notFoundNames: [],
      urlEntries: [], // appId → 下载页地址批量写入 / download-URL batch entries
      finished: false,
      forceTimer: null // 强制收尾定时器 / force-finish timer
    };
}

// 应用一波查询结果。mode='first'：未命中的跳过（等待推送），不插"未找到"徽章；
// mode='final'：波内仍未命中的按"未找到"处理。
// 收尾后到达的迟到推送仍会应用徽章（只补徽章，不重复统计）。
// Apply one wave of results. 'first': misses wait for the push; 'final':
// misses in this wave resolve as "not found". Late pushes still apply badges.
function applyRatingsResponse(ratings, mode) {
    if (!_state.ratingsJob) return false;
    const job = _state.ratingsJob;
    // v3.3.8：关闭"全部好评率"徽章 → 好评率过滤停用（数据获取不受影响）
    const bv = (job.settings && job.settings.badgeVisibility) || {};
    const filterEnabled = job.settings?.enableRatingFilter && bv.all !== false;
    const minRating = filterEnabled ? job.settings.minSteamRatingFilter || 0 : 0;
    let changed = false;
    job.processItems.forEach((item) => {
      if (job.processed.has(item.name)) return;
      const rating = ratings[item.name];
      if (rating && rating.appId) {
        job.processed.add(item.name);
        changed = true;
        // 合集等 type 徽章：appId 非本体，不写入下载站网址缓存
        const isTypeBadge = rating.type && rating.type !== 'game' && rating.type !== 'demo';
        if (item.url && !isTypeBadge) job.urlEntries.push({ appId: rating.appId, url: item.url });
        // 好评率过滤：低于阈值的从 DOM 移除（剩余元素自动重排）
        if (rating.positiveRate !== null && rating.positiveRate !== undefined) {
          if (minRating > 0 && rating.positiveRate < minRating) {
            badges.removeItemFromDom(item);
            job.filtered++;
            return;
          }
        }
        badges.prependBadge(item, rating, job.settings);
        job.shown++;
      } else if (mode !== 'first' && Object.prototype.hasOwnProperty.call(ratings, item.name)) {
        // 最终波：仅对**波内包含**的名字判定"未找到"（波外名字继续等待后续波）
        // 'final': only names present in this wave resolve as "not found"
        job.processed.add(item.name);
        job.notFoundNames.push(item.name);
        changed = true;
        badges.prependBadge(item, null, job.settings);
      }
    });
    return changed;
}

// 完成统计：批量写下载站网址缓存 + 统一浮窗显示统计。
// 收尾后保留 ratingsJob（迟到推送仍可补徽章），不再置 null。
function finishRatings() {
    if (!_state.ratingsJob || _state.ratingsJob.finished) return;
    _state.ratingsJob.finished = true;
    clearTimeout(_state.ratingsJob.forceTimer);
    const job = _state.ratingsJob;
    const unresolved = job.processItems.filter((i) => !job.processed.has(i.name)).length;
    // 批量写入下载站网址缓存（fire-and-forget）
    const siteKey = builder.getAdapterKey();
    if (siteKey && job.urlEntries.length > 0) {
      chrome.runtime
        .sendMessage({
          action: 'RECORD_DOWNLOAD_URLS_BATCH',
          data: {
            siteKey,
            siteName: builder.getAdapter().name,
            domain: window.location.hostname,
            entries: job.urlEntries
          }
        })
        .catch(() => {});
    }
    dbg(
      `列表页: 显示 ${job.shown} 个好评率, 过滤 ${job.filtered} 个, 未找到 ${job.notFoundNames.length} 个` +
        (job.notFoundNames.length > 0 ? ` [${job.notFoundNames.slice(0, 5).join('、')}]` : '') +
        (unresolved > 0 ? `, 未返回 ${unresolved} 个` : '')
    );
    status.showStats({
      title: 'Steam 好评率获取完成',
      summary: `${job.shown} 个好评率${job.filtered > 0 ? ` · ${job.filtered} 个已过滤` : ''}${job.notFoundNames.length > 0 ? ` · ${job.notFoundNames.length} 个未找到` : ''}${unresolved > 0 ? ` · ${unresolved} 个暂未返回（刷新页面可重试）` : ''}`,
      rows: [
        `查询 ${job.uniqueNames.length} 个游戏 · 提取 ${job.processItems.length} 个`,
        job.notFoundNames.length > 0
          ? `未找到: ${job.notFoundNames.slice(0, 3).join('、')}${job.notFoundNames.length > 3 ? '...' : ''}`
          : ''
      ].filter(Boolean)
    });
}

// 兜底：45 秒强制收尾。未返回的游戏保持空白（后台已逐批落盘缓存，
// 刷新页面第一波即命中），**不误标"未找到"**；收尾后迟到的推送仍会应用徽章。
// v4.0.0：批次多次调度，forceTimer 逐批重置（最后一批发起 +45s 起算）。
function scheduleFallbacks() {
    const job = _state.ratingsJob;
    if (!job) return;
    clearTimeout(job.forceTimer);
    job.forceTimer = setTimeout(() => {
      if (!_state.ratingsJob || _state.ratingsJob.finished) return;
      finishRatings();
    }, 45000);
}

// 后台推送的结果（STEAM_RATINGS_UPDATE）：多波增量，波内 null 判定"未找到"；
// done 标记或全部处理后收尾。
// v5.1.0：批次状态与调度经 _state / listBatch
function applySteamRatingsUpdate(ratings, done) {
    const batchState = _state.batchState;
    if (!_state.ratingsJob) return false;
    // 后台全部批次完成标记 / background completion marker
    if (ratings === null && done) {
      if (!batchState) {
        if (!_state.ratingsJob.finished) finishRatings();
        return true;
      }
      batchState.pendingDone = true;
      if (batchState.inflight) batchState.inflight = false; // 当前批结束
      const fired = listBatch.maybeFetchNextBatch(); // 队列非空 → 衔接下一批（串行）
      if (!fired && !_state.ratingsJob.finished) finishRatings();
      return true;
    }
    applyRatingsResponse(ratings || {}, 'final');
    // 所有已发现游戏已出结果 → 收尾（队列非空时 every 检查天然不通过，
    // 未请求名字对应 item 必未 processed，等 done 衔接下一批）
    // all discovered games resolved → finish (queued names' items are never
    // processed yet, so the check only passes when nothing is left queued)
    if (
      !_state.ratingsJob.finished &&
      _state.ratingsJob.processItems.every((i) => _state.ratingsJob.processed.has(i.name))
    ) {
      if (!batchState || batchState.queue.length === 0) {
        finishRatings();
      }
    }
    return true;
}

export const _internal = {
  createRatingsJob,
  applyRatingsResponse,
  finishRatings,
  scheduleFallbacks,
  applySteamRatingsUpdate
};
export {
  isDetailPageByUrl,
  isListPageByUrl,
  getListItemsSmart,
  trackListView,
  applyVmFilter,
  waitForListItems,
  applySteamRatingsUpdate
};
export function requestRecommendations(items, settings, nameToImage) {
  return listBatch.requestRecommendations(items, settings, nameToImage);
}
