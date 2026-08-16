/**
 * 游戏雷达 Game Radar - 列表页模块 / List Page Module
 *
 * 页面类型检测、列表项提取、好评率徽章与过滤、推荐高亮、下一页预载。
 * Page-type detection, list-item extraction, rating badges & filtering,
 * recommendation highlighting and next-page prefetch.
 */
import * as listBatch from './list-batch.js';
import { _state, applyRatingsResponse, finishRatings } from './list-state.js';
import * as builder from '../adapters/builder.js';
import * as badges from './badges.js';
import * as common from '../core/common.js';
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
    /** @type {ReturnType<typeof setTimeout>|null} */
    let timer = null;
    /** @type {MutationObserver|null} */
    let observer = null;
    /** @type {ReturnType<typeof setTimeout>|null} */
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

  // 关键词过滤（v6.4.7 通用化）：请求推荐/好评率之前移除标题命中关键词的游戏
  let filteredItems = items;
  if (settings.enableVmFilter) {
    filteredItems = applyVmFilter(items, settings);
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

// v6.4.7：通用关键词过滤（旧虚拟机版过滤扩展）——从 items 移除标题命中
// 关键词的游戏项并从 DOM 删除。防误报：exact 模式要求关键词与标题的某个
// 分段完全相等（按分隔符拆分），避免虚拟机误伤虚拟主机类子串。
// Generic title-keyword filter (exact mode avoids false positives).
function applyVmFilter(items, settings) {
  const raw =
    settings.filterKeywords ||
    (Array.isArray(settings.vmFilterKeywords) ? settings.vmFilterKeywords.join(',') : '') ||
    '虚拟机板,虚拟机';
  const kws = String(raw)
    .split(/[,，、;；\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  const mode = settings.filterMatchMode || 'contains';
  // v6.4.8：规则列表优先——每条 {keyword, exclude}：命中关键词且不命中
  // 排除词才过滤（如 {keyword:'虚拟机', exclude:'非虚拟机'}）
  const rules = Array.isArray(settings.filterRules)
    ? settings.filterRules
        .map((r) => ({
          k: String(r.keyword || '')
            .trim()
            .toLowerCase(),
          x: String(r.exclude || '')
            .trim()
            .toLowerCase()
        }))
        .filter((r) => r.k)
    : [];
  const kept = [];
  let removed = 0;
  for (const item of items) {
    const name = (item.name || '').toLowerCase();
    const kwHit = (k) =>
      mode === 'exact'
        ? name.split(/[|｜×•·\-\s]+/).some((seg) => seg === k) || name.startsWith(k) || name.endsWith(k)
        : name.includes(k);
    // 规则命中（含排除词防误报）；无规则时回退简单关键词列表
    const hit =
      rules.length > 0
        ? rules.some(({ k, x }) => kwHit(k) && !(x && (name.includes(x) || name.startsWith(x) || name.endsWith(x))))
        : kws.some(kwHit);
    if (hit) {
      // 从 DOM 移除（优先移除栅格列容器以避免留空，与好评率过滤共用逻辑）
      badges.removeItemFromDom(item);
      removed++;
    } else {
      kept.push(item);
    }
  }
  if (removed > 0) {
    dbg(`🚫 关键词过滤：移除 ${removed} 个游戏项，保留 ${kept.length} 个`);
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
  const job = _state.ratingsJob;
  if (job && !job.finished && job.processItems.every((i) => job.processed.has(i.name))) {
    if (!batchState || batchState.queue.length === 0) {
      finishRatings();
    }
  }
  return true;
}

// v7.3.0：状态容器与评分状态机移至 list-state.js（打破 list-page ↔ list-batch
// 循环依赖）——重新导出保持外部 API 兼容（GR.list._state/_internal 等）
export { _state, _internal, ratingFilterPass, sortItemsByRating } from './list-state.js';

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
