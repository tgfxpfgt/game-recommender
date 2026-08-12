/**
 * Game Recommender - 列表页批次调度 / List-Page Batch Scheduling
 *
 * v5.1.0：由 list-page.js 拆分——首屏优先 + 滚动按需的评分/推荐批次调度。
 * 状态（ratingsJob/batchState）存于 GR.list._state（唯一状态容器），
 * 评分状态机函数（applyRatingsResponse/finishRatings）经 GR.list._internal。
 * Batch scheduling split from list-page.js (v5.1.0); scheduler state lives in
 * GR.list._state, rating-application functions via GR.list._internal.
 */
(function (global) {
  'use strict';

  const GR = (global.__GR__ = global.__GR__ || {});
  const dbg = (...a) => GR.debug.dbg(...a);

  const RATINGS_BATCH_SIZE = 60; // 每批请求上限（与后台批处理规模对应）

  function initBatchState(settings) {
    GR.list._state.batchState = {
      settings,
      processItems: [],    // 全部已发现 item（追加式）/ all discovered items
      itemsByName: new Map(), // name → item（同名取首个，按名回填/惰性提取用）
      nameToImage: {},     // name → {appId, cover}（惰性填充）/ lazy cover info
      requested: new Set(),// 已请求过的名字 / names already requested
      queue: [],           // 待请求名字（FIFO）/ names awaiting a batch
      inflight: false,     // 有在途批次（等待 resolve/done）/ batch in flight
      pendingDone: false,  // 后台已推送 done / background done received
      forceTimer: null,    // 强制收尾定时器 / force-finish timer
      observer: null,      // MutationObserver（新增项发现）/ discovery observer
      sentinelObserver: null // IntersectionObserver（滚动调度）/ scroll sentinel
    };
  }

  // 封面 appId/图惰性提取（幂等）——只对批内名字提取，避免全量扫描
  // Lazy per-name cover extraction (idempotent); batch-scoped, no full scan.
  function ensureNameToImage(name) {
    const batchState = GR.list._state.batchState;
    if (batchState.nameToImage[name] !== undefined) return batchState.nameToImage[name];
    const item = batchState.itemsByName.get(name);
    batchState.nameToImage[name] = item
      ? (GR.builder.isImageAppIdEnabled() ? GR.builder.extractSteamImageInfo(item.element) : null)
      : null;
    return batchState.nameToImage[name];
  }

  // 追加 item 入队（url 去重；名字未请求过才入队）/ enqueue new items (url-dedup)
  function enqueueItems(items) {
    const batchState = GR.list._state.batchState;
    const seen = new Set(batchState.processItems.map(i => i.url));
    for (const item of items || []) {
      if (!item || !item.name || item.name.length < 2 || seen.has(item.url)) continue;
      seen.add(item.url);
      batchState.processItems.push(item);
      if (!batchState.itemsByName.has(item.name)) batchState.itemsByName.set(item.name, item);
      if (!batchState.requested.has(item.name)) batchState.queue.push(item.name);
    }
  }

  // 发起下一批（串行调度：同步判定可否发起，实际请求 fire-and-forget）
  // Serial scheduler: sync gate + async request (fire-and-forget) — the sync
  // return value lets callers know whether a batch actually started.
  function maybeFetchNextBatch() {
    const batchState = GR.list._state.batchState;
    if (!batchState || batchState.inflight) return false;
    const names = batchState.queue.filter(n => !batchState.requested.has(n)).slice(0, RATINGS_BATCH_SIZE);
    if (names.length === 0) return false;
    names.forEach(n => batchState.requested.add(n));
    batchState.queue = batchState.queue.filter(n => !batchState.requested.has(n));
    batchState.inflight = true;
    batchState.pendingDone = false;
    fireBatch(names);
    return true;
  }

  // 单个批次的请求与第一波应用（fire-and-forget；done 由 applySteamRatingsUpdate
  // 衔接下一批）/ request one batch and apply wave 1 (done chains the next batch)
  async function fireBatch(names) {
    const batchState = GR.list._state.batchState;
    const total = batchState.processItems.length;
    const doneCount = batchState.requested.size - names.length;
    GR.status.showStatus('正在获取 Steam 好评率', doneCount, total,
      batchState.queue.length > 0 ? `已排队 ${batchState.queue.length} 个，缓存优先检索中...` : '缓存优先检索中...');
    // 惰性提取批内封面（不再全量扫描）；评分与推荐共用同一 imageData
    const imageData = {};
    names.forEach(n => { imageData[n] = ensureNameToImage(n) || null; });
    // 推荐请求并入批次（按名回填，滚动批次自动获得推荐徽章/高亮）
    fetchRecommendationsForBatch(names, imageData);
    try {
      const response = await chrome.runtime.sendMessage({ action: 'GET_STEAM_RATINGS', names, imageData });
      const ratings = (response && response.ratings) || {};
      const pendingCount = (response && response.pending) || 0;
      // 第一波：缓存命中即时显示徽章 / wave 1: cached hits render instantly
      GR.list._internal.applyRatingsResponse(ratings, 'first');
      const job = GR.list._state.ratingsJob;
      if (!job || job.finished) return;
      if (pendingCount > 0) {
        // 后台正在拉取：等推送 done 衔接下一批（45s 兜底随批次重置）
        GR.status.showStatus('正在从 Steam 更新缓存', job.processed.size, total,
          `${pendingCount} 个未命中缓存，后台拉取中...`);
        GR.list._internal.scheduleFallbacks();
      } else {
        // 本批全部命中缓存，无推送会来：立即衔接下一批
        batchState.inflight = false;
        const fired = maybeFetchNextBatch();
        if (!fired && !job.finished) GR.list._internal.finishRatings();
      }
    } catch (e) {
      dbg('Steam好评率检索失败: ' + e.message);
      batchState.inflight = false;
      GR.list._internal.finishRatings();
    }
  }

  // 按批发起推荐请求（fire-and-forget；失败不影响评分流程）
  // Per-batch recommendation request (fire-and-forget; failures don't block ratings)
  async function fetchRecommendationsForBatch(names, imageData) {
    try {
      const games = names.map(n => {
        const img = imageData[n];
        return { name: n, url: '', appId: img && img.appId ? img.appId : null };
      });
      const response = await chrome.runtime.sendMessage({ action: 'GET_RECOMMENDATIONS', games });
      applyRecommendationResults(response && response.results);
    } catch (e) {
      dbg('推荐计算失败: ' + e.message);
    }
  }

  // 按名回填推荐徽章/高亮（results 自带 name，替代 index 对齐——
  // 滚动批次追加后仍正确对应 item）
  // Apply recommendation results by name (results carry `name`; replaces the
  // index-aligned logic that broke when later batches appended items).
  function applyRecommendationResults(results) {
    if (!results || results.length === 0) return;
    const batchState = GR.list._state.batchState;
    const settings = batchState.settings || {};
    const threshold = settings.highlightThreshold || 0.6;
    const bv = (settings && settings.badgeVisibility) || {};
    const recEnabled = bv.rec !== false;
    let highlighted = 0;
    for (const result of results) {
      if (!result || !result.recommendation) continue;
      const item = batchState.itemsByName.get(result.name);
      if (!item) continue;
      // 推荐值徽章（好评率徽章之后，悬停显示各分值组成，分级着色）
      GR.badges.prependRecBadge(item, result.recommendation, settings);
      if (recEnabled && result.recommendation.score >= threshold) {
        GR.badges.highlightItem(item);
        highlighted++;
      }
    }
    if (highlighted > 0) dbg(`高亮 ${highlighted} 个推荐游戏`);
  }

  // 滚动/追加调度：MutationObserver 增量发现 + IntersectionObserver 底部哨兵
  // Scroll/discovery scheduling: MutationObserver finds new items (container-
  // scoped, v4.1.0); an IO sentinel fires the next batch when scrolled near.
  function startListScan() {
    const batchState = GR.list._state.batchState;
    if (!batchState || batchState.observer) return;
    let scanTimer = null;
    let pendingNodes = [];
    batchState.observer = new MutationObserver((mutations) => {
      // 收集新增元素节点（容器级增量提取，不再整页重扫）
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) pendingNodes.push(node);
        }
      }
      if (scanTimer) clearTimeout(scanTimer);
      scanTimer = setTimeout(() => {
        const nodes = pendingNodes;
        pendingNodes = [];
        const known = new Set(batchState.processItems.map(i => i.url));
        const newItems = [];
        for (const node of nodes) {
          const found = GR.builder.findItemsInContainer(node);
          for (const it of found) {
            if (!known.has(it.url)) { known.add(it.url); newItems.push(it); }
          }
        }
        if (newItems.length > 0) {
          enqueueItems(newItems);
          maybeFetchNextBatch();
        }
      }, 200);
    });
    batchState.observer.observe(document.body, { childList: true, subtree: true });
    const sentinel = document.createElement('div');
    sentinel.style.cssText = 'height:1px;width:1px;opacity:0;pointer-events:none;';
    (document.body || document.documentElement).appendChild(sentinel);
    batchState.sentinelObserver = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) maybeFetchNextBatch();
    }, { rootMargin: '400px 0px' });
    batchState.sentinelObserver.observe(sentinel);
  }

  // 列表页：初始化批次调度并发出首批评分请求（入口签名不变，内部改分批调度）
  // List page: initialise the batch scheduler and fire the first batch.
  function requestSteamRatings(items, settings) {
    if (!items || items.length === 0) return;
    initBatchState(settings);
    enqueueItems(items);
    // 名字全集来自 processItems（nameToImage 已惰性化）
    const jobNames = GR.list._state.batchState.processItems.map(i => i.name).filter(n => n && n.length > 1);
    if (jobNames.length === 0) {
      GR.status.hide();
      return;
    }
    GR.status.showStatus('正在获取 Steam 好评率', 0, GR.list._state.batchState.processItems.length, '缓存优先检索中...');
    GR.list._internal.createRatingsJob(GR.list._state.batchState.processItems, settings, jobNames);
    maybeFetchNextBatch();
    startListScan();
  }

  // 推荐并入批次调度（fireBatch 按批发起 + 按名回填）。本函数保留
  // 供 REFRESH_RECOMMENDATIONS 强制刷新：经 batchState 惰性提取兜底 appId
  //（此前 REFRESH 不传 nameToImage → appId 恒 null 的缺陷一并修复）。
  // Recommendations ride the batch scheduler; this entry stays for the
  // REFRESH_RECOMMENDATIONS force-refresh with lazy cover extraction.
  async function requestRecommendations(items, settings, nameToImage) {
    const batchState = GR.list._state.batchState;
    if (!batchState || !items || items.length === 0) return;
    const names = items.map(i => i.name).filter(n => n && n.length > 1);
    if (names.length === 0) return;
    const imageData = {};
    names.forEach(n => { imageData[n] = ensureNameToImage(n) || null; });
    await fetchRecommendationsForBatch(names, imageData);
  }

  GR.listBatch = {
    requestSteamRatings,
    requestRecommendations,
    maybeFetchNextBatch
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
