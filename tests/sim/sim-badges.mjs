import { expect } from 'vitest';
/**
 * 游戏雷达 Game Radar - 内容脚本模拟：徽章开关与过滤联动 / Sim: badge visibility gates
 *
 * 覆盖（第五轮 B9 自 test-content-sim.mjs 拆出）：徽章开关与过滤/高亮联动、
 * 关全部好评率徽章 → 过滤停用、关推荐度徽章 → 推荐徽章不渲染（v10.4.2 回归）、
 * 综合评分徽章渲染（XDGame 同口径，v10.5.3）。原节 8/8b/8c/8d。
 * Covers badge visibility toggles, rating-filter fallback when the "all"
 * badge is off, rec-badge gating and the composite score badge.
 *
 * 引导装载：原文件依赖节 1 的文件级 GR——拆分后由本文件首节显式
 * loadModules + resetSiteRulesForTests（适配器构建），后续节共享实例。
 * Bootstraps its own module registry (first test) instead of inheriting
 * section 1's file-level GR.
 */

import {
  simTest,
  getGR,
  setQueryStubs,
  reloadContentScripts,
  waitForSignal,
  makeItem,
  presets,
  sentMessages,
  documentMock,
  DEFAULT_SETTINGS
} from './sim-harness.mjs';

// v14.43.0：徽章行迁移——徽章挂在标题上方 .gr-badge-row 内（badge-base
// ensureBadgeRow），不再直接挂在标题/link 直子。条目徽章断言统一经本助手
// 取行内子元素（旧直子断言在行迁移后恒空 → 信号超时假红）。
// Badge-row migration: item badge assertions go through the row's children.
function badgeKids(/** @type {any} */ anchor) {
  if (!anchor) return [];
  const row = anchor.querySelector ? anchor.querySelector('.gr-badge-row') : null;
  if (row) return Array.from(row.children || []);
  const sib = anchor.previousElementSibling; // 档①：行是标题前一兄弟
  if (sib && sib.classList && sib.classList.contains('gr-badge-row')) return Array.from(sib.children || []);
  return Array.from(anchor.children || []);
}

// 全部好评率徽章识别（v10.4.3/v10.5.3：a-b/综合评分同基类，需排除）
// "all-time rating" badge classifier (excludes same-base-family badges)
function isAllBadge(c) {
  return (
    c.className.includes('gr-rating-badge') &&
    !c.className.includes('gr-badge-recent') &&
    !c.className.includes('gr-badge-update') &&
    !c.className.includes('gr-badge-appstat') && // v10.4.3：a-b 徽章同基类，需排除
    !c.className.includes('gr-score-badge') // v10.5.3：综合评分徽章同基类，需排除
  );
}

simTest('8. 徽章开关与过滤/高亮联动', async () => {
  await reloadContentScripts(); // 本文件引导装载（模块 + 经典脚本全局 + 规则；原依赖节 1）
  const GR = getGR();
  const badgeSettings = {
    ...DEFAULT_SETTINGS,
    enableRatingFilter: true,
    minSteamRatingFilter: 70,
    badgeVisibility: { recent: false, all: true, update: true, rec: false }
  };
  // v7.2.0：tracker 为模块实例（reload 无法重执行）——手动驱动模式（与节 2 一致）
  presets['GET_SETTINGS'] = () => ({ settings: badgeSettings });
  const itemE = makeItem('游戏E', 5);
  setQueryStubs((sel) => (sel === 'li.game-item' ? [itemE.li] : []));
  presets['GET_STEAM_RATINGS'] = (msg) => ({
    ratings: {
      游戏E: {
        appId: '555',
        positiveRate: 88,
        ratingDesc: '特别好评',
        totalReviews: 100,
        recentPositiveRate: 85,
        recentTotalReviews: 20,
        lastUpdate: '2026-08-01'
      }
    },
    pending: 0
  });
  presets['GET_RECOMMENDATIONS'] = (msg) => ({
    results: [
      {
        recommendation: {
          score: 0.85,
          breakdown: { clickScore: 0.9, downloadScore: 0.8, keywordMatch: 0.7, steamRating: 0.9 }
        }
      }
    ]
  });
  // 手动驱动渲染（trackListView 触发批次 → GET_STEAM_RATINGS/GET_RECOMMENDATIONS）
  const adapterE = GR.builder.getAdapter();
  const itemsE = GR.list.getListItemsSmart(adapterE);
  GR.list.trackListView(adapterE, itemsE, badgeSettings);
  await waitForSignal(() => badgeKids(itemE.a).length > 0, '节8: 游戏E 评分徽章');
  if (GR.listBatch.waitForBatchIdle) await GR.listBatch.waitForBatchIdle(); // v14 B6：信号替代固定 300ms
  expect(badgeKids(itemE.a).some((c) => c.className.includes('gr-badge-recent'))).toEqual(false);
  expect(badgeKids(itemE.a).some(isAllBadge)).toEqual(true);
  expect(badgeKids(itemE.a).some((c) => c.className.includes('gr-badge-update'))).toEqual(true);
  expect(badgeKids(itemE.a).some((c) => c.className.includes('gr-rec-badge'))).toEqual(false);
  expect(itemE.li.classList.contains('gr-highlighted')).toEqual(false);
  expect(badgeKids(itemE.a).some(isAllBadge)).toEqual(true);

  // 8b：关闭"全部好评率"→ 好评率过滤停用（低好评率游戏不再被移除）
});

simTest('8b. 关全部好评率徽章 → 过滤停用', async () => {
  const GR = getGR();
  const badgeSettings2 = {
    ...DEFAULT_SETTINGS,
    enableRatingFilter: true,
    minSteamRatingFilter: 70,
    badgeVisibility: { recent: true, all: false, update: true, rec: true }
  };
  // v7.2.0：手动驱动模式（tracker 模块实例无法重执行——与节 8 一致）
  presets['GET_SETTINGS'] = () => ({ settings: badgeSettings2 });
  const itemF = makeItem('游戏F', 6);
  documentMock.body.appendChild(itemF.li); // 模拟挂载（过滤会从 DOM 移除）
  setQueryStubs((sel) => (sel === 'li.game-item' ? [itemF.li] : []));
  presets['GET_STEAM_RATINGS'] = (msg) => ({
    ratings: {
      游戏F: {
        appId: '666',
        positiveRate: 50,
        ratingDesc: '褒贬不一',
        totalReviews: 100,
        recentPositiveRate: 40,
        recentTotalReviews: 10,
        lastUpdate: '2026-07-15'
      }
    },
    pending: 0
  });
  presets['GET_RECOMMENDATIONS'] = (msg) => ({
    results: [
      {
        name: '游戏F',
        recommendation: {
          score: 0.3,
          breakdown: { clickScore: 0.2, downloadScore: 0.1, keywordMatch: 0.3, steamRating: 0.4 }
        }
      }
    ]
  });
  // 手动驱动渲染
  const adapterF = GR.builder.getAdapter();
  const itemsF = GR.list.getListItemsSmart(adapterF);
  GR.list.trackListView(adapterF, itemsF, badgeSettings2);
  await waitForSignal(() => badgeKids(itemF.a).length > 0, '节8b: 游戏F 评分徽章');
  if (GR.listBatch.waitForBatchIdle) await GR.listBatch.waitForBatchIdle(); // v14 B6：信号替代固定 300ms
  await waitForSignal(() => badgeKids(itemF.a).some((c) => c.className.includes('gr-rec-badge')), '节8b: 推荐徽章渲染');

  expect(badgeKids(itemF.a).some(isAllBadge)).toEqual(false);
  expect(badgeKids(itemF.a).some((c) => c.className.includes('gr-badge-recent'))).toEqual(true);
  expect(documentMock.body.children.includes(itemF.li)).toEqual(true);
  expect(badgeKids(itemF.a).some((c) => c.className.includes('gr-rec-badge'))).toEqual(true);
  expect(
    (() => {
      const kids = badgeKids(itemF.a);
      const recIdx = kids.findIndex((c) => c.className.includes('gr-rec-badge'));
      const badgeIdx = kids.findIndex(
        (c) =>
          c.className.includes('gr-rating-badge') ||
          c.className.includes('gr-badge-update') ||
          c.className.includes('gr-badge-recent')
      );
      return recIdx > badgeIdx;
    })()
  ).toEqual(true);

  // 8c：关推荐度徽章 → 推荐徽章不渲染（v10.4.2 回归）
});

simTest('8c. 关推荐度徽章 → 推荐徽章不渲染', async () => {
  const GR = getGR();
  const recOffSettings = {
    ...DEFAULT_SETTINGS,
    badgeVisibility: { recent: true, all: true, update: true, rec: false, appstat: true }
  };
  presets['GET_SETTINGS'] = () => ({ settings: recOffSettings });
  // 全新 item——沿用旧 item 会命中防重复守卫（旧徽章残留导致假失败）
  const recItems = ['游戏R1', '游戏R2', '游戏R3'].map((n, i) => makeItem(n, 20 + i));
  recItems.forEach((it) => documentMock.body.appendChild(it.li));
  setQueryStubs((sel) => (sel === 'li.game-item' ? recItems.map((x) => x.li) : []));
  presets['GET_STEAM_RATINGS'] = (msg) => {
    const ratings = {};
    (msg.names || []).forEach((n) => {
      ratings[n] = { appId: '999', positiveRate: 90 };
    });
    return { ratings, pending: 0 };
  };
  presets['GET_RECOMMENDATIONS'] = (msg) => ({
    results: (msg.games || []).map((g) => ({
      name: g.name,
      recommendation: { score: 0.85, breakdown: { clickScore: 0.9 } }
    }))
  });
  // v14 B6：改走 trackListView 真实链路——原直调 requestSteamRatings 传入的
  // makeItem 裸对象（{li, a}）缺 name/url，批次恒空转、徽章永不渲染，断言在
  // 20s 超时后对空 DOM 恒真（retry 时代的假阳性测试，B6 根治）
  const adapterR = GR.builder.getAdapter();
  const itemsR = GR.list.getListItemsSmart(adapterR);
  GR.list.trackListView(adapterR, itemsR, recOffSettings);
  // 评分徽章正常渲染；推荐徽章被 badgeVisibility.rec 门控拦截不渲染
  //（v10.4.2 回归：batchState 未存 settings，门控拿空对象恒放行）
  await waitForSignal(
    () => badgeKids(recItems[0].a).some((c) => (c.className || '').includes('gr-rating-badge')),
    '节8c: 推荐列表评分徽章'
  );
  expect(badgeKids(recItems[0].a).some((c) => (c.className || '').includes('gr-rec-badge'))).toEqual(false);
  presets['GET_SETTINGS'] = () => ({ settings: DEFAULT_SETTINGS });
});

simTest('8d. 综合评分徽章渲染（XDGame 同口径，v10.5.3）', async () => {
  const GR = getGR();
  const scoreSettings = {
    ...DEFAULT_SETTINGS,
    badgeVisibility: { score: true, recent: true, all: true, update: true, rec: false }
  };
  presets['GET_SETTINGS'] = () => ({ settings: scoreSettings });
  const scoreItem = makeItem('评分测试游戏', 99);
  setQueryStubs((sel) => (sel === 'li.game-item' ? [scoreItem.li] : []));
  presets['GET_STEAM_RATINGS'] = (msg) => ({
    ratings: {
      评分测试游戏: {
        appId: '777',
        positiveRate: 88,
        ratingDesc: '特别好评',
        totalReviews: 1000,
        positiveReviews: 880,
        negativeReviews: 120,
        recentPositiveRate: 85,
        recentTotalReviews: 200,
        lastUpdate: '2026-08-01'
      }
    },
    pending: 0
  });
  presets['GET_RECOMMENDATIONS'] = () => ({ results: [] });
  const adapter = GR.builder.getAdapter();
  const items = GR.list.getListItemsSmart(adapter);
  GR.list.trackListView(adapter, items, scoreSettings);
  await waitForSignal(
    () => badgeKids(scoreItem.a).some((c) => c.className.includes('gr-score-badge')),
    '节8d: 综合评分徽章'
  );
  // 段0 渲染在最前：⭐ 8.3 = 修正口碑 83.3 ÷ 10（好评 880 / 总评 1000，
  // 走缓存显式 positiveReviews/negativeReviews 字段路径）
  const scoreBadge = badgeKids(scoreItem.a).find((c) => c.className.includes('gr-score-badge'));
  expect(badgeKids(scoreItem.a)[0]).toEqual(scoreBadge);
  expect(scoreBadge.textContent).toEqual('⭐ 8.3');
  expect(scoreBadge.title.includes('Steam 玩家评价：特别好评')).toEqual(true);
  expect(scoreBadge.title.includes('综合评分 8.3/10')).toEqual(true);
  expect(scoreBadge.title.includes('修正口碑 83.3%')).toEqual(true);
  expect(scoreBadge.title.includes('好评 880 · 差评 120')).toEqual(true);
  expect(scoreBadge.title.includes('1,000 条评价')).toEqual(true);
  expect(scoreBadge.title.includes('整体口碑很好，值得下载体验')).toEqual(true);
  // 特别好评 → positive 三档配色（XDGame 绿 #2e8660）
  expect(scoreBadge.style.cssText.includes('#2e8660')).toEqual(true);
  presets['GET_SETTINGS'] = () => ({ settings: DEFAULT_SETTINGS });
});

// ============ v14.7 批次 3：未找到徽章点击 = 穿透负缓存就地重查 ============
simTest('8e. 未找到徽章点击重试（RETRY_GAME_LOOKUP → 就地重渲染）', async () => {
  const GR = getGR();
  const retrySettings = {
    ...DEFAULT_SETTINGS,
    badgeVisibility: { recent: true, all: true, update: true, rec: false }
  };
  presets['GET_SETTINGS'] = () => ({ settings: retrySettings });
  const itemH = makeItem('游戏H', 8);
  setQueryStubs((sel) => (sel === 'li.game-item' ? [itemH.li] : []));
  presets['GET_STEAM_RATINGS'] = () => ({ ratings: {}, pending: 0 }); // 全未命中 → 走推送
  presets['GET_RECOMMENDATIONS'] = () => ({ results: [] });
  presets['RETRY_GAME_LOOKUP'] = () => ({
    appId: '555',
    positiveRate: 88,
    ratingDesc: '特别好评',
    totalReviews: 100,
    recentPositiveRate: 85,
    recentTotalReviews: 20,
    type: 'game',
    lastUpdate: '2026-08-01'
  });
  const adapterH = GR.builder.getAdapter();
  const itemsH = GR.list.getListItemsSmart(adapterH);
  GR.list.trackListView(adapterH, itemsH, retrySettings);
  await waitForSignal(() => badgeKids(itemH.a).length > 0, '8e: 占位徽章');
  if (GR.listBatch.waitForBatchIdle) await GR.listBatch.waitForBatchIdle();
  // 批次收尾（pending 0 → 立即 finishRatings）后再推 notfound 波——
  // 推送早于 createRatingsJob 会被 applySteamRatingsUpdate 的空守卫丢弃
  await waitForSignal(() => !!(GR.list._state.ratingsJob && GR.list._state.ratingsJob.finished), '8e: 批次收尾');
  // 后台推送：游戏H 未找到 → notfound 徽章
  GR.list.applySteamRatingsUpdate({ 游戏H: null }, false, null);
  await waitForSignal(
    () => badgeKids(itemH.a).some((c) => c.className.includes('gr-badge-notfound')),
    '8e: 未找到徽章'
  );
  // 点击 → RETRY_GAME_LOOKUP → 就地重渲染为评分徽章（批次 5 的进度推送
  // 波次不会重渲染它——processed 守卫，重查路径必须自渲染）
  const nf = badgeKids(itemH.a).find((c) => c.className.includes('gr-badge-notfound'));
  nf.click();
  await waitForSignal(
    () =>
      !badgeKids(itemH.a).some((c) => c.className.includes('gr-badge-notfound')) && badgeKids(itemH.a).some(isAllBadge),
    '8e: 重查后评分徽章'
  );
  expect(sentMessages.some((m) => m.action === 'RETRY_GAME_LOOKUP' && m.gameName === '游戏H')).toEqual(true);
  const allBadge = badgeKids(itemH.a).find(isAllBadge);
  expect(allBadge.textContent).toEqual('✓ 88%'); // v7.4.0：色盲友好 ✓ 前缀（≥80）
});

// ============ v14.43.0：徽章独立行 + 格子缩放（用户指令 2026-11-23） ============
// 徽章占标题上方独立一行（.gr-badge-row），标题文本节点保持原版不被拆混；
// 格子 zoom=150%，文字块反向补偿使有效缩放=100%。
simTest('8f. 徽章独立行 + 标题行原样 + 格子缩放/文字补偿', async () => {
  const GR = getGR();
  presets['GET_SETTINGS'] = () => ({ settings: DEFAULT_SETTINGS });
  const itemS = makeItem('缩放游戏', 77);
  documentMock.body.appendChild(itemS.li);
  setQueryStubs((sel) => (sel === 'li.game-item' ? [itemS.li] : []));
  presets['GET_STEAM_RATINGS'] = () => ({
    ratings: { 缩放游戏: { appId: '444', positiveRate: 90, ratingDesc: '特别好评' } },
    pending: 0
  });
  presets['GET_RECOMMENDATIONS'] = () => ({ results: [] });
  const adapterS = GR.builder.getAdapter();
  const itemsS = GR.list.getListItemsSmart(adapterS);
  GR.list.trackListView(adapterS, itemsS, DEFAULT_SETTINGS);
  await waitForSignal(() => badgeKids(itemS.a).some(isAllBadge), '8f: 评分徽章');
  // 徽章全部在独立行内，标题 link 的直接子元素里没有任何徽章
  const row = itemS.a.querySelector('.gr-badge-row');
  expect(!!row).toEqual(true);
  expect(badgeKids(itemS.a).length).toBeGreaterThan(0);
  expect(Array.from(itemS.a.children)).toEqual([row]); // 标题 link 直接子元素 = 仅徽章行
  // 标题文本节点原样保留（未被拆散/改写），行在其前方
  const texts = Array.from(itemS.a.childNodes)
    .filter((n) => n.nodeType === 3)
    .map((n) => n.textContent);
  expect(texts).toEqual(['缩放游戏']);
  expect(itemS.a.firstChild).toBe(row); // 行在标题文本之前（标题仍在原位）
  // 格子 150%、文字块补偿 1/1.5（有效 = 100%）
  expect(parseFloat(itemS.li.style.zoom)).toBeCloseTo(1.5, 3);
  expect(parseFloat(itemS.a.style.zoom)).toBeCloseTo(1 / 1.5, 3);
  expect(parseFloat(itemS.li.style.zoom) * parseFloat(itemS.a.style.zoom)).toBeCloseTo(1, 3);
});
