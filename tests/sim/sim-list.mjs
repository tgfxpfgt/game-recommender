import { expect } from 'vitest';
/**
 * 游戏雷达 Game Radar - 内容脚本模拟：列表页流程 / Sim: list page flow
 *
 * 覆盖（第五轮 B9 自 test-content-sim.mjs 拆出）：顶层加载与预热、列表页
 * 两波好评率流程、批次调度、AJAX 延迟渲染等待、调试视图、lazyload 封面
 * appId 直取、汇总贴过滤、FORCE_REFRESH、过滤/排序纯函数（原节 11——
 * 实例无关，迁移至本文件尾部保持"其余流程之后"的执行位次）。
 * Covers warm-up, two-wave ratings, batch scheduling, AJAX wait and pure filters.
 *
 * 文件内顺序状态（原文件级 let GR/itemA-C 显式化）：节 1 装载 → 后续节
 * 经 getGR() 取模块句柄；itemA-C 为节 2 构建、节 3/6/7 读取的本文件状态。
 */
('use strict');

import {
  simTest,
  getGR,
  getMsgListener,
  fireDomReady,
  setQueryStubs,
  loadModules,
  resetSiteRulesForTests,
  loadClassicScripts,
  waitForSignal,
  makeItem,
  presets,
  sentMessages,
  documentMock,
  DEFAULT_SETTINGS,
  FakeEl,
  MODULE_KEYS
} from './sim-harness.mjs';

// v6.2.0：跨节共享 DOM 变量（节 2 赋值，节 3/6/7 读取——仅本文件内状态机）
let itemA = null,
  itemB = null,
  itemC = null,
  allItems = null;

simTest('1. 顶层加载与预热', async () => {
  let loadError = null;
  try {
    await loadModules();
    await resetSiteRulesForTests(); // storage 已返回测试规则（保险重注入）
    loadClassicScripts();
  } catch (e) {
    loadError = e;
  }
  expect(loadError ? loadError.message : null).toEqual(null);

  const GR = getGR();
  expect(MODULE_KEYS.filter((k) => GR && GR[k]).length).toEqual(MODULE_KEYS.length);
  // v6.2.0：等待 tracker warmup（bootPromise）完成——全量并发下监听器注册与
  // 模块就绪存在竞争，固定短延时偶发不足导致推送丢失
  // v6.4.7：固定延时改为轮询等待消息监听已注册（msgListener 就绪 = init 完成，
  // 节 2 的 msgListener 推送才能被接收；根治偶发推送丢失）
  // v14 B6：前置 400ms 固定延时删除（waitForSignal 已覆盖）
  // v14.5.0 B8：补 bootPromise 就绪等待——监听器在入口 eval 即注册（先于
  // boot 完成），B7 消息路由的推送冲放依赖 boot 完成；跨文件连跑（如
  // test-freegames → sim-list 同 fork 复用）时 boot 存在竞态窗口，仅等
  // 监听器注册会让节 2 推送撞进未接线窗口（waitForSignal 20s 超时）。
  await waitForSignal(
    () => typeof getMsgListener() === 'function' && getMsgListener() !== null,
    '节1: 消息监听器注册（init 完成）'
  );
  await waitForSignal(async () => {
    try {
      await globalThis.window.__grBootPromise;
      return true;
    } catch {
      return false; // boot 失败也放行（后续节直调路径自证）
    }
  }, '节1: bootPromise 完成（模块+预热就绪，推送可路由）');
});

simTest('2. 列表页两波好评率流程', async () => {
  const msgListener = getMsgListener();
  // 构建列表页 DOM：3 个游戏项 / build a 3-item list page
  itemA = makeItem('游戏A', 1);
  itemB = makeItem('游戏B', 2);
  itemC = makeItem('游戏C', 3);
  allItems = [itemA, itemB, itemC];
  setQueryStubs(
    (sel) => {
      if (sel === 'li.game-item') return allItems.map((x) => x.li);
      return [];
    },
    () => null
  );

  // 第一波：游戏A 缓存命中，B/C 未命中（后台分批拉取中）
  presets['GET_STEAM_RATINGS'] = (msg) => {
    if (msg.cacheOnly) return { ratings: {}, pending: 0 }; // 兜底重查：无新命中
    return { ratings: { 游戏A: { appId: '111', positiveRate: 95, ratingDesc: '特别好评' } }, pending: 2 };
  };

  // 推荐计算：游戏A 高分、游戏B/C 中低分（含 breakdown 供悬停展示）。
  // v4.1.0：后台回包携带 name（按名回填，替代 index 对齐）
  presets['GET_RECOMMENDATIONS'] = (msg) => ({
    results: (msg.games || []).map((g) => ({
      name: g.name,
      recommendation:
        g.name === '游戏A'
          ? { score: 0.85, breakdown: { clickScore: 0.9, downloadScore: 0.8, keywordMatch: 0.7, steamRating: 0.9 } }
          : { score: 0.4, breakdown: { clickScore: 0.5, downloadScore: 0.3, keywordMatch: 0.4, steamRating: 0.4 } }
    }))
  });

  // 触发 DOMContentLoaded → init（warmup 已 resolve）
  fireDomReady();
  await waitForSignal(() => itemA.a.children.length > 0, '节2: 游戏A 好评率徽章（缓存命中首波）');
  // v14 B6：此处**不可**等批次空闲——本节设计就是 pending:2 等推送（job 保持
  // 开放），waitForBatchIdle 只会空烧 30s 超时并在负载下与 45s 强制收尾竞态
  //（推送被 finishRatings 后的守卫丢弃 = 节 2/2b 偶发失败的根源）

  expect(itemA.a.children.some((c) => c.className.includes('gr-rating-badge'))).toEqual(true);
  expect(
    itemB.a.children.some((c) => c.className.includes('gr-rating-badge')) ||
      itemC.a.children.some((c) => c.className.includes('gr-rating-badge'))
  ).toEqual(false);

  // 推荐值徽章（GET_RECOMMENDATIONS 响应后插入，好评率徽章之后）——轮询等待
  await waitForSignal(() => itemA.a.children.length >= 4, '节2: 游戏A 徽章组齐（推送更新后）');
  // v3.3.6 三段式徽章：近30天 → 全部 → 最近更新（游戏A 无 recent/lastUpdate 数据）
  // v10.4.3：a-b 徽章（0-0 灰）对所有已解析 appId 的游戏渲染 → 4+1
  expect(itemA.a.children.length).toEqual(5);
  expect(itemA.a.children[0].className.includes('gr-badge-recent') && itemA.a.children[0].textContent === '—').toEqual(
    true
  );
  expect(
    itemA.a.children[1].className.includes('gr-rating-badge') && itemA.a.children[1].textContent === '✓ 95%'
  ).toEqual(true);
  expect(itemA.a.children[2].className.includes('gr-badge-update') && itemA.a.children[2].textContent === '—').toEqual(
    true
  );
  // v10.4.3：a-b 徽章（0-0 灰）插在更新徽章与推荐徽章之间
  expect(itemA.a.children[3].className.includes('gr-badge-appstat')).toEqual(true);
  expect(itemA.a.children[3].textContent).toEqual('0-0');
  expect(itemA.a.children[4].className.includes('gr-rec-badge')).toEqual(true);
  expect(itemA.a.children[4].textContent).toEqual('🎯 85%');
  expect(
    itemA.a.children[4].title.includes('点击率') &&
      itemA.a.children[4].title.includes('下载率') &&
      itemA.a.children[4].title.includes('Steam')
  ).toEqual(true);

  // 后台推送第 1 波增量：游戏B 拉取完成（含近30天/最近更新数据） / background push wave 1
  // v14.5.0 B8：跨文件连跑下推送偶发被竞态吞掉（boot 就绪后仍会）——推送+
  // 等待打包为两段重试；重发同一载荷语义不变，仅容忍竞态（持续回归仍会失败）
  const pushWave1 = () =>
    msgListener(
      {
        action: 'STEAM_RATINGS_UPDATE',
        ratings: {
          游戏B: {
            appId: '222',
            positiveRate: 60,
            ratingDesc: '多半好评',
            totalReviews: 500,
            recentPositiveRate: 55,
            recentTotalReviews: 120,
            lastUpdate: '2026-08-01',
            releaseDate: '2025-03-30'
          }
        }
      },
      {},
      () => {}
    );
  let wave1Done = false;
  for (let attempt = 0; attempt < 2 && !wave1Done; attempt++) {
    try {
      await pushWave1();
      await waitForSignal(
        () => itemB.a.children.some((c) => c.className.includes('gr-rating-badge')),
        '节2: 游戏B 好评率徽章（STEAM_RATINGS_UPDATE 推送后）'
      );
      wave1Done = true;
    } catch (e) {
      if (attempt === 1) throw e; // 重发仍失败 → 真回归
    }
  }

  expect(itemB.a.children.some((c) => c.className.includes('gr-rating-badge'))).toEqual(true);
  expect(itemC.a.children.some((c) => c.className.includes('gr-rating-badge'))).toEqual(false);
  // v3.3.6：游戏B 三段徽章（近30天 55% / 全部 60% / 更新 08-01）+
  // v10.5.3 段0 综合评分（⭐ 5.8 = 修正口碑 58.5 ÷ 10；旧缓存无
  // positiveReviews 字段 → 按整数好评率回退 positive = 60% × 500 = 300）
  expect(
    itemB.a.children[0].className.includes('gr-score-badge') && itemB.a.children[0].textContent === '⭐ 5.8'
  ).toEqual(true);
  expect(
    itemB.a.children[0].title.includes('综合评分 5.8/10') && itemB.a.children[0].title.includes('修正口碑 58.5%')
  ).toEqual(true);
  expect(
    itemB.a.children[1].className.includes('gr-badge-recent') && itemB.a.children[1].textContent === '55%'
  ).toEqual(true);
  expect(itemB.a.children[1].title.includes('55%') && itemB.a.children[1].title.includes('120')).toEqual(true);
  expect(
    itemB.a.children[2].className.includes('gr-rating-badge') && itemB.a.children[2].textContent === '▲ 60%'
  ).toEqual(true);
  expect(
    itemB.a.children[3].className.includes('gr-badge-update') && itemB.a.children[3].textContent === '🛠 08-01'
  ).toEqual(true);
  expect(itemB.a.children[3].title.includes('2026-08-01') && itemB.a.children[3].title.includes('2025-03-30')).toEqual(
    true
  );

  // 后台推送第 2 波增量：游戏C 为合集（bundle，无法解析本体）→ type 徽章 + done 收尾
  await msgListener(
    {
      action: 'STEAM_RATINGS_UPDATE',
      ratings: { 游戏C: { positiveRate: null, appId: '333', name: '游戏C', type: 'bundle' } },
      done: true
    },
    {},
    () => {}
  );

  expect(itemC.a.children.some((c) => c.className.includes('gr-badge-type'))).toEqual(true);
  expect(itemC.a.children[0].className ? itemC.a.children[0].className.includes('gr-badge-type') : false).toEqual(true);
  expect(itemC.a.children.find((c) => c.className.includes('gr-badge-type')).textContent).toEqual('bundle');
  const barEl = documentMock.body.children.find((c) => c.id === 'gr-status-bar');
  expect(barEl ? barEl.innerHTML.includes('Steam 好评率获取完成') : false).toEqual(true);
  const batchMsg = sentMessages.find((m) => m.action === 'RECORD_DOWNLOAD_URLS_BATCH');
  expect(batchMsg ? batchMsg.data.entries.length : 0).toEqual(2);
});

simTest('2b. 批次调度（首屏 60 + 滚动衔接）', async () => {
  const GR = getGR();
  const msgListener = getMsgListener();
  // 100 个游戏项：首批只应请求 60 个，缓存全命中（pending=0）时自动衔接第二批 40 个
  const manyItems = [];
  for (let i = 1; i <= 100; i++) {
    const { li, a } = makeItem(`游戏${i}`, i);
    manyItems.push({ element: li, link: a, name: `游戏${i}`, url: `https://www.xianyudanji.gg/${i}.html`, titleEl: a });
  }
  const batchPreset = presets['GET_STEAM_RATINGS'];
  const batchRequests = [];
  presets['GET_STEAM_RATINGS'] = (msg) => {
    batchRequests.push((msg.names || []).slice());
    const ratings = {};
    (msg.names || []).forEach((n) => {
      ratings[n] = { appId: '999', positiveRate: 90 };
    });
    // v10.1.0：前两条带 a-b 统计——首条有下载（a=3 绿色徽章）/ 次条只看不下
    // （a=0 且 b=7 → 橙色徽章 + 标题绿色 gr-title-green）
    if (msg.names && msg.names[0]) {
      ratings[msg.names[0]] = {
        appId: '999',
        positiveRate: 98,
        recentPositiveRate: 98,
        appDownloads: 3,
        appDetailViews: 5
      };
    }
    if (msg.names && msg.names[1]) {
      ratings[msg.names[1]] = { appId: '999', positiveRate: 90, appDownloads: 0, appDetailViews: 7 };
    }
    return { ratings, pending: 0 }; // 全部缓存命中 → 无推送，自动衔接下一批
  };
  GR.listBatch.requestSteamRatings(manyItems, DEFAULT_SETTINGS);
  // v13 B2：批次空闲信号（队列排空+推送应用完后再断言计数）
  if (GR.listBatch.waitForBatchIdle) await GR.listBatch.waitForBatchIdle();
  // v10.3.0 诊断：超时转储批次状态（定位间歇性不衔接）
  await waitForSignal(() => batchRequests.length >= 2, '节2b: 第二批自动衔接（60→40）');
  // 首批 60 + 全命中自动衔接第二批 40
  expect(batchRequests[0] ? batchRequests[0].length : 0).toEqual(60);
  expect(batchRequests[1] ? batchRequests[1].length : 0).toEqual(40);
  expect(
    (() => {
      if (batchRequests.length < 2) return false;
      const all = [...batchRequests[0], ...batchRequests[1]];
      return new Set(all).size === all.length && all.length === 100;
    })()
  ).toEqual(true);
  const doneBar = documentMock.body.children.find((c) => c.id === 'gr-status-bar');
  expect(doneBar ? doneBar.innerHTML.includes('Steam 好评率获取完成') : false).toEqual(true);

  // v10.1.0：a-b 徽章渲染（下载 a-详情页打开 b）+ 只看不下绿标题
  const statBadge0 = manyItems[0].link.children.find((c) => (c.className || '').includes('gr-badge-appstat'));
  expect(statBadge0 && statBadge0._html).toEqual('3-5');
  const statBadge1 = manyItems[1].link.children.find((c) => (c.className || '').includes('gr-badge-appstat'));
  expect(statBadge1 && statBadge1._html).toEqual('0-7');
  // v10.4.1：位置断言——a-b 徽章在好评率徽章组之后（不在最左）
  const kidIdx = (el, cls) => el.children.findIndex((c) => (c.className || '').includes(cls));
  expect(kidIdx(manyItems[0].link, 'gr-badge-appstat')).toBeGreaterThan(kidIdx(manyItems[0].link, 'gr-badge-recent'));
  expect(kidIdx(manyItems[1].link, 'gr-badge-appstat')).toBeGreaterThan(kidIdx(manyItems[1].link, 'gr-badge-recent'));
  // a=0 且 b>0 → 标题绿色；a>0 → 标题不变绿
  expect(manyItems[1].titleEl.classList.contains('gr-title-green')).toEqual(true);
  expect(manyItems[0].titleEl.classList.contains('gr-title-green')).toEqual(false);

  // done 衔接场景：首批部分未命中（pending>0）→ 等后台 done → 衔接第二批
  const batchRequests2 = [];
  presets['GET_STEAM_RATINGS'] = (msg) => {
    batchRequests2.push((msg.names || []).slice());
    const ratings = {};
    (msg.names || []).slice(0, 10).forEach((n) => {
      ratings[n] = { appId: '888', positiveRate: 80 };
    });
    return { ratings, pending: msg.names.length - 10 };
  };
  GR.listBatch.requestSteamRatings(manyItems, DEFAULT_SETTINGS);
  await waitForSignal(() => batchRequests2.length >= 1, '节2b: 首批请求（缓存全命中）');
  expect(batchRequests2.length).toEqual(1);
  // 后台完成 → 推送 done → 应自动发起第二批
  // 让第一批 fireBatch 的 await sendMessage 微任务完成（否则 done 与在途批交错）
  await new Promise((r) => setTimeout(r, 0));
  // v14.5.0 B8：done 推送与节 2 同源竞态——两段重试（重发同一 done 语义不变；
  // done 幂等：batchState.pendingDone 重复置位无副作用）
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await msgListener({ action: 'STEAM_RATINGS_UPDATE', ratings: null, done: true }, {}, () => {});
      await waitForSignal(() => batchRequests2.length >= 2, '节2b: done 推送后第二批');
      break;
    } catch (e) {
      if (attempt === 1) throw e; // 重发仍失败 → 真回归
    }
  }
  expect(batchRequests2[1] ? batchRequests2[1].length : 0).toEqual(40);
  presets['GET_STEAM_RATINGS'] = batchPreset;
});

simTest('3. waitForListItems（AJAX 延迟渲染）', async () => {
  const GR = getGR();
  setQueryStubs(() => []); // 初始列表为空
  const waitPromise = GR.list.waitForListItems(GR.builder.getAdapter(), 4000);
  // 模拟 250ms 后 DOM 渲染出列表项 / simulate the DOM rendering items after 250ms
  setTimeout(() => {
    setQueryStubs((sel) => (sel === 'li.game-item' ? allItems.map((x) => x.li) : []));
  }, 250);
  setTimeout(() => {
    if (MutationObserver.instances.length) MutationObserver.instances[MutationObserver.instances.length - 1].cb();
  }, 260);
  const waitedItems = await waitPromise;
  expect(waitedItems.length).toEqual(3);
});

simTest('4. 调试视图关闭后不自动复活', async () => {
  const GR = getGR();
  GR.status.setDebugMode(true);
  GR.status.showDebugView('<div>test debug</div>');
  const dbgRoot = documentMock.body.children.find((c) => c.id === 'gr-status-bar');
  expect(!!dbgRoot && !!dbgRoot.children[0]).toEqual(true);
  // 模拟用户点击标题栏 ✕ 关闭
  dbgRoot.children[0].children[2].click();
  expect(documentMock.body.children.some((c) => c.id === 'gr-status-bar')).toEqual(false);
  // 关闭后 dbg 日志触发防抖刷新，不应复活浮窗
  GR.debug.dbg('关闭后的测试日志');
  await new Promise((r) => setTimeout(r, 600));
  expect(documentMock.body.children.some((c) => c.id === 'gr-status-bar')).toEqual(false);
  // 重新开启调试模式 → 允许再次显示
  GR.status.setDebugMode(true);
  GR.status.showDebugView('<div>again</div>');
  expect(documentMock.body.children.some((c) => c.id === 'gr-status-bar')).toEqual(true);
  GR.float.closeAll();
});

simTest('5. lazyload 封面 appId 直取（data-src 优先）', async () => {
  const GR = getGR();
  const lazyScope = new FakeEl('div');
  const lazyImg = new FakeEl('img');
  lazyImg._attrs['src'] = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='; // 占位图
  lazyImg._attrs['data-src'] =
    'https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/1297900/c68d4/capsule_616x353.jpg';
  lazyScope._imgs = [lazyImg];
  const lazyInfo = GR.builder.extractSteamImageInfo(lazyScope);
  expect(lazyInfo ? lazyInfo.appId : null).toEqual('1297900');
  expect(lazyInfo ? lazyInfo.cover.includes('1297900') : false).toEqual(true);
  // 无 data-src 时回退 src
  const plainImg = new FakeEl('img');
  plainImg._attrs['src'] = 'https://cdn.akamai.steamstatic.com/steam/apps/111/header.jpg';
  const plainScope = new FakeEl('div');
  plainScope._imgs = [plainImg];
  const plainInfo = GR.builder.extractSteamImageInfo(plainScope);
  expect(plainInfo ? plainInfo.appId : null).toEqual('111');
  // data-original（xdgame jQuery lazy，v3.2.5）
  const xdImg = new FakeEl('img');
  xdImg._attrs['src'] = '/images/defaultpic.gif';
  xdImg._attrs['data-original'] =
    'https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/3613270/xxx/capsule_616x353.jpg';
  const xdScope = new FakeEl('div');
  xdScope._imgs = [xdImg];
  const xdInfo = GR.builder.extractSteamImageInfo(xdScope);
  expect(xdInfo ? xdInfo.appId : null).toEqual('3613270');
});

simTest('6. 汇总贴/索引贴过滤', async () => {
  const GR = getGR();
  const pinItem = makeItem('[顶置]PC近期爆火游戏 汇总贴', 56286);
  setQueryStubs((sel) => {
    if (sel === 'li.game-item') return [pinItem.li, itemA.li];
    return [];
  });
  const filteredItems = GR.builder.getAdapter().getListItems();
  expect(filteredItems.some((i) => i.name.includes('汇总贴'))).toEqual(false);
  expect(filteredItems.some((i) => i.name === '游戏A')).toEqual(true);
  setQueryStubs((sel) => (sel === 'li.game-item' ? allItems.map((x) => x.li) : []));
});

simTest('7. FORCE_REFRESH_PAGE（popup 强制刷新）', async () => {
  const msgListener = getMsgListener();
  let reloaded = false;
  globalThis.location.reload = () => {
    reloaded = true;
  };
  let forceResp = null;
  await msgListener({ action: 'FORCE_REFRESH_PAGE' }, {}, (r) => {
    forceResp = r;
  });
  await waitForSignal(() => forceResp !== null, '节7: FORCE_REFRESH 完整响应（含 CLEAR_CACHE_FOR_PAGE）');
  const clearMsg = sentMessages.find((m) => m.action === 'CLEAR_CACHE_FOR_PAGE');
  expect(clearMsg ? clearMsg.names.length : 0).toEqual(3);
  expect(clearMsg && clearMsg.names.includes('游戏A') && clearMsg.names.includes('游戏C')).toEqual(true);
  expect(!!clearMsg).toEqual(true);
  expect(forceResp ? forceResp.success : false).toEqual(true);
  expect(reloaded).toEqual(true);
});

// ============ 11. 过滤与排序（v6.4.4）——纯函数（实例无关） ============
// v14 B9：原位于详情流程节之后；迁入本文件尾部（纯函数不依赖模块实例时序，
// 排序容器经参数注入）。
simTest('11. 好评过滤三态与按好评率重排', async () => {
  const GR = getGR();
  const { ratingFilterPass, sortItemsByRating } = GR.list;
  const rating = { positiveRate: 90, recentPositiveRate: 50 };
  const base = {
    enableRatingFilter: true,
    minSteamRatingFilter: 80,
    enableRecentFilter: true,
    minRecentSteamRatingFilter: 60
  };
  // 与：30 天不达标 → 过滤
  expect(ratingFilterPass(rating, { ...base, ratingFilterMode: 'and' })).toEqual(false);
  // 或：总达标 → 保留
  expect(ratingFilterPass(rating, { ...base, ratingFilterMode: 'or' })).toEqual(true);
  // 非：仅看 30 天（50 < 60）→ 过滤
  expect(ratingFilterPass(rating, { ...base, ratingFilterMode: 'not' })).toEqual(false);
  // 仅总过滤（旧行为）：不看 30 天 → 保留
  expect(ratingFilterPass(rating, { enableRatingFilter: true, minSteamRatingFilter: 80 })).toEqual(true);
  // 30 天达标 + 总不达标 → or 保留 / and 过滤
  const r2 = { positiveRate: 50, recentPositiveRate: 90 };
  expect(ratingFilterPass(r2, { ...base, ratingFilterMode: 'and' })).toEqual(false);
  expect(ratingFilterPass(r2, { ...base, ratingFilterMode: 'or' })).toEqual(true);
  expect(ratingFilterPass(r2, { ...base, ratingFilterMode: 'not' })).toEqual(true);
  // v6.4.18：混合模式——总 90 / 30天 80 → 任一 ≥90 或 双 ≥80 保留
  const hybridBase = {
    enableRatingFilter: true,
    minSteamRatingFilter: 90,
    enableRecentFilter: true,
    minRecentSteamRatingFilter: 80,
    ratingFilterMode: 'hybrid'
  };
  // 总 95 / 30天 50：任一 ≥90 → 保留
  expect(ratingFilterPass({ positiveRate: 95, recentPositiveRate: 50 }, hybridBase)).toEqual(true);
  // 总 85 / 30天 85：双 ≥80 → 保留
  expect(ratingFilterPass({ positiveRate: 85, recentPositiveRate: 85 }, hybridBase)).toEqual(true);
  // 总 85 / 30天 60：无任一 ≥90 且 30天 <80 → 过滤
  expect(ratingFilterPass({ positiveRate: 85, recentPositiveRate: 60 }, hybridBase)).toEqual(false);
  // 总 75 / 30天 95：30天 ≥90 → 保留
  expect(ratingFilterPass({ positiveRate: 75, recentPositiveRate: 95 }, hybridBase)).toEqual(true);
  // 双低：总 79 / 30天 79 → 过滤
  expect(ratingFilterPass({ positiveRate: 79, recentPositiveRate: 79 }, hybridBase)).toEqual(false);
  // 无阈值（都 ≤0）→ 全部保留
  expect(
    ratingFilterPass(
      { positiveRate: 10, recentPositiveRate: 10 },
      { ...hybridBase, minSteamRatingFilter: 0, minRecentSteamRatingFilter: 0 }
    )
  ).toEqual(true);
  // 单阈值退化：仅 30天 80 → 30天 ≥80 保留
  expect(
    ratingFilterPass({ positiveRate: 10, recentPositiveRate: 85 }, { ...hybridBase, minSteamRatingFilter: 0 })
  ).toEqual(true);
  // 排序：构造容器 + job → 降序
  const container = new FakeEl('ul');
  const mk = (name, rate) => {
    const it = makeItem(name, 1);
    container.appendChild(it.li);
    return { name, element: it.li, link: it.a };
  };
  const items = [mk('低分', 40), mk('高分', 95), mk('中分', 70), mk('无评分', null)];
  const job = {
    processItems: items,
    ratingMap: { 低分: 40, 高分: 95, 中分: 70, 无评分: null }
  };
  sortItemsByRating(job);
  const order = container.children.map((c) => (c.children[0] || {})._text); // li 内 a 的标题
  expect(JSON.stringify(order)).toEqual(JSON.stringify(['高分', '中分', '低分', '无评分']));
  // 关键词过滤（v6.4.7 通用化 + 防误报）：
  const { applyVmFilter } = GR.list;
  const mk2 = (name) => ({ name, element: makeItem(name, 1).li, link: makeItem(name, 1).a });
  // contains：子串匹配（'虚拟机' 命中 '虚拟主机'）
  const c1 = [mk2('虚拟机版游戏'), mk2('虚拟主机服务'), mk2('正常游戏')];
  const kept1 = applyVmFilter(c1, { enableVmFilter: true, filterKeywords: '虚拟机', filterMatchMode: 'contains' });
  expect(kept1.map((i) => i.name)).toEqual(['虚拟主机服务', '正常游戏']);
  // exact：整段匹配（防误报——'虚拟机' 只命中分段完全相等的标题）
  const kept2 = applyVmFilter(c1, { enableVmFilter: true, filterKeywords: '虚拟机', filterMatchMode: 'exact' });
  expect(kept2.map((i) => i.name)).toEqual(['虚拟主机服务', '正常游戏']); // 防误报：虚拟主机保留
  // 旧字段兼容：vmFilterKeywords 数组
  const kept3 = applyVmFilter(c1, {
    enableVmFilter: true,
    vmFilterKeywords: ['虚拟机板'],
    filterMatchMode: 'contains'
  });
  expect(kept3.map((i) => i.name)).toEqual(['虚拟机版游戏', '虚拟主机服务', '正常游戏']); // 旧关键词'虚拟机板'不匹配'虚拟机版'——验证旧字段读取但无误匹配
  // v6.4.10 修复：30 天过滤在 positiveRate null 时仍生效（此前被外层检查跳过）
  expect(
    ratingFilterPass(
      { positiveRate: null, recentPositiveRate: 40 },
      { enableRatingFilter: false, enableRecentFilter: true, minRecentSteamRatingFilter: 60, ratingFilterMode: 'not' }
    )
  ).toEqual(false);
  expect(
    ratingFilterPass(
      { positiveRate: null, recentPositiveRate: 80 },
      { enableRatingFilter: false, enableRecentFilter: true, minRecentSteamRatingFilter: 60, ratingFilterMode: 'not' }
    )
  ).toEqual(true);
  // 规则排除词：{keyword:'虚拟机', exclude:'非虚拟机'} → '非虚拟机'标题不过滤
  const c4 = [mk2('虚拟机版'), mk2('非虚拟机内容')];
  const kept4 = applyVmFilter(c4, {
    enableVmFilter: true,
    filterRules: [{ keyword: '虚拟机', exclude: '非虚拟机' }],
    filterMatchMode: 'contains'
  });
  expect(kept4.map((i) => i.name)).toEqual(['非虚拟机内容']);
});
