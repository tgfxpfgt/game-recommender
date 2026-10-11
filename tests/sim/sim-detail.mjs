import { expect } from 'vitest';
/**
 * 游戏雷达 Game Radar - 内容脚本模拟：详情页流程 / Sim: detail page flow
 *
 * 覆盖（第五轮 B9 自 test-content-sim.mjs 拆出）：详情页报错按钮（人工纠错
 * 重新检索）、内嵌 Steam 信息区（目标站注入 + 非目标站门控 + 模板降级）、
 * 详情浮窗模板全量渲染与变体分支、未找到路径（手动选择浮窗）、下载追踪
 * 纯函数（原节 10——tracking 模块属详情页域，迁移至本文件尾部）。
 * Covers: report-issue re-search flow, inline steam section gating and
 * template degradation, sidebar template branches, not-found manual-select
 * fallback, and download-tracking pure functions.
 *
 * 每节经 reloadContentScripts/loadModules 引导装载（原文件节 9/9a 即如此，
 * 模拟页面重载）；9b 为同步模板断言，依赖 9a 已装载的实例。
 * Each flow test reloads content scripts (page-reload simulation, as before);
 * the sync template test relies on the instance loaded by the prior test.
 */
('use strict');

import fs from 'fs';
import path from 'path';
import {
  simTest,
  getGR,
  setQueryStubs,
  loadModules,
  reloadContentScripts,
  waitForSignal,
  presets,
  documentMock,
  DEFAULT_SETTINGS,
  FakeEl,
  ROOT
} from './sim-harness.mjs';

simTest('9. 详情页报错按钮（人工纠错重新检索）', async () => {
  await reloadContentScripts();
  presets['GET_SETTINGS'] = () => ({
    settings: { ...DEFAULT_SETTINGS, badgeVisibility: undefined, trackedSites: ['xianyudanji'] }
  });
  // 详情页 URL + 完整 Steam 数据 mock（域名用测试规则中的 xianyudanji）
  globalThis.location = {
    hostname: 'www.xianyudanji.gg',
    pathname: '/16598.html',
    href: 'https://www.xianyudanji.gg/16598.html'
  };
  window.location = globalThis.location;
  const h1El = new FakeEl('h1');
  h1El._text = '北方之魂增强版/Spirit of the North- Switch520.com';
  setQueryStubs(
    () => [],
    (sel) => (sel === 'h1' || sel === '.entry-title' ? h1El : null)
  );
  const wrongData = {
    appId: '2001760',
    name: '轮回之兽',
    englishName: 'Beast of Reincarnation',
    positiveRate: 70,
    ratingDesc: '多半好评',
    totalReviews: 100,
    recentPositiveRate: 65,
    recentTotalReviews: 20,
    url: 'https://store.steampowered.com/app/2001760/',
    headerImage: 'https://cdn/h.jpg',
    genres: ['RPG'],
    userTags: ['RPG'],
    developers: ['Dev'],
    chineseSupported: true,
    releaseDate: '2024-01-01',
    description: 'x',
    steamspy: null,
    steamdb: null,
    type: 'game'
  };
  const correctData = {
    ...wrongData,
    appId: '1213700',
    name: '北方之魂',
    englishName: 'Spirit of the North',
    url: 'https://store.steampowered.com/app/1213700/'
  };
  let searchCalls = 0;
  presets['SEARCH_STEAM'] = (msg) => {
    searchCalls++;
    return { data: searchCalls === 1 ? wrongData : correctData, cachedAt: Date.now() };
  };
  presets['GET_STEAM_BY_APPID'] = () => ({ data: null });
  // v7.2.0：手动驱动（tracker 模块实例无法重执行——直接调用详情页注入）
  const GR = getGR();
  GR.detail.injectSteamButton('北方之魂增强版/Spirit of the North');
  await waitForSignal(() => {
    const root = documentMock.body.children.find((c) => c.id === 'gr-steam-float');
    return root && root.children.length >= 2;
  }, '节9: Steam 浮窗打开');
  // v14 B6：固定 300ms → 侧栏渲染完成信号（报错按钮出现 = renderAndShow 完成）
  await waitForSignal(() => {
    const root = documentMock.body.children.find((c) => c.id === 'gr-steam-float');
    const body = root ? root.children[1] : null;
    return body ? (body._html || '').includes('gr-report-issue-btn') : false;
  }, '节9: Steam 侧栏渲染完成（gr-report-issue-btn）');

  // floats 结构：root(id) → [header, body(内容区)]；渲染 HTML 在 body.innerHTML
  const steamRoot = documentMock.body.children.find((c) => c.id === 'gr-steam-float');
  const steamBody = steamRoot ? steamRoot.children[1] : null;
  const steamHtml = steamBody ? steamBody.innerHTML : '';
  expect(!!steamRoot && steamHtml.length > 50).toEqual(true);
  expect(steamHtml.includes('gr-report-issue-btn') && steamHtml.includes('信息有误')).toEqual(true);
  expect(steamHtml.includes('gr-refresh-cache-btn')).toEqual(true);
  expect(steamHtml.includes('2001760') || steamHtml.includes('轮回之兽')).toEqual(true);
  // v3.4.1：原断言恒真（"由 E2E 验证"），改为源码级守护——报错按钮绑定 +
  // REPORT_WRONG_APPID 消息流 + 手动选择面板兜底路径必须存在
  // v14 B3：detail 拆分为 page/sidebar/candidates/tracking 四文件，聚合读取
  const detailSrc = [
    'content/detail/detail-page.js',
    'content/detail/sidebar.js',
    'content/detail/sidebar-rows.js', // v14.3.0 B1 拆分：detail 模块族随拆分扩展
    'content/detail/inline-card.js',
    'content/detail/candidates.js',
    'content/detail/tracking.js'
  ]
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf-8'))
    .join('\n');
  expect(detailSrc.includes('#gr-report-issue-btn') && detailSrc.includes("action: 'REPORT_WRONG_APPID'")).toEqual(
    true
  );
  expect(detailSrc.includes('renderManualSelectPanel')).toEqual(true);
  expect(searchCalls >= 1).toEqual(true);
  // v3.4.2：demo 判定防误伤（源码级）——浮窗前端正则必须带词边界
  // （\b），避免 Trials/Demons 等合法游戏名子串被误标为 Demo；后台 isDemo
  // 以 appdetails type=demo 为权威信号，名称兜底同样带边界。
  // v5.0.0：api.js 已拆分为 api-*.js 子块，聚合读取全部子块源码
  // v5.1.0：detail 模板已拆至 detail-templates.js，聚合读取
  const steamApiSrc =
    fs.readFileSync(path.join(ROOT, 'background/steam/api.js'), 'utf-8') +
    fs
      .readdirSync(path.join(ROOT, 'background/steam'))
      .filter((f) => /^api-.+\.js$/.test(f))
      .map((f) => fs.readFileSync(path.join(ROOT, 'background/steam', f), 'utf-8'))
      .join('\n');
  const detailAllSrc = detailSrc + fs.readFileSync(path.join(ROOT, 'content/detail/detail-templates.js'), 'utf-8');
  expect(detailAllSrc.includes('\\b(demo|trial)\\b')).toEqual(true);
  expect(steamApiSrc.includes("gameData.type === 'demo'")).toEqual(true);
});

// ============ 9a. 内嵌 Steam 信息区（v10.5.3 任务1：咸鱼单机/gamer520） ============
simTest('9a. 详情页内嵌 Steam 信息区（目标站注入 + 非目标站门控 + 模板降级）', async () => {
  await reloadContentScripts();
  presets['GET_SETTINGS'] = () => ({
    settings: { ...DEFAULT_SETTINGS, badgeVisibility: undefined, trackedSites: ['xianyudanji'] }
  });
  // 构造带父节点的 h1（内嵌区经 parentNode.insertBefore 注入标题之后）
  const h1El = new FakeEl('h1');
  h1El._text = '北方之魂/Spirit of the North';
  const article = new FakeEl('article');
  article.appendChild(h1El);
  setQueryStubs(
    () => [],
    (sel) => {
      if (sel === 'h1, h2.entry-title') return h1El;
      if (sel === '.entry-content, .post-content, .article-content, article, main') return article;
      return null;
    }
  );
  // documentMock.getElementById 恒 null——按 article 子树查找，幂等逻辑才可测
  const origGetById = documentMock.getElementById;
  documentMock.getElementById = (id) => article.children.find((c) => c.id === id) || null;
  const inlineSection = () => article.children.find((c) => c.id === 'gr-steam-inline-section') || null;

  const steamData = {
    appId: '1213700',
    name: '北方之魂',
    positiveRate: 90,
    positiveReviews: 4500,
    negativeReviews: 500,
    ratingDesc: 'Very Positive',
    totalReviews: 5000,
    releaseDate: '2024-01-01',
    url: 'https://store.steampowered.com/app/1213700/',
    userTags: ['冒险'],
    genres: ['RPG'],
    chineseSupported: true,
    steamspy: { owners: '1000000 .. 2000000', ownersLow: 1000000, ownersHigh: 2000000, totalReviews: 3000, ccu: 1200 }
  };
  presets['SEARCH_STEAM'] = () => ({ data: steamData, cachedAt: Date.now() });
  presets['GET_STEAM_BY_APPID'] = () => ({ data: null });

  // 门控：非目标站（无匹配规则 → _default 适配器）→ 浮窗渲染但内嵌区不注入
  globalThis.location = {
    hostname: 'www.xdgame.com',
    pathname: '/game/123.html',
    href: 'https://www.xdgame.com/game/123.html'
  };
  window.location = globalThis.location;
  const GR = getGR();
  GR.detail.injectSteamButton('北方之魂/Spirit of the North');
  await waitForSignal(() => {
    const root = documentMock.body.children.find((c) => c.id === 'gr-steam-float');
    return root && root.children.length >= 2 && (root.children[1]._html || '').includes('北方之魂');
  }, '节9a: 内嵌卡流程浮窗渲染（北方之魂）');
  expect(inlineSection()).toEqual(null); // 非目标站（XDGame 原生已有）不注入

  // 目标站（xianyudanji）→ 标题之后注入内嵌信息区
  globalThis.location = {
    hostname: 'www.xianyudanji.gg',
    pathname: '/16598.html',
    href: 'https://www.xianyudanji.gg/16598.html'
  };
  window.location = globalThis.location;
  GR.detail.injectSteamButton('北方之魂/Spirit of the North');
  await waitForSignal(() => inlineSection() !== null, '节9a: 内嵌信息区出现');
  const section = inlineSection();
  const html = section ? section._html : '';
  // 信息卡与 XDGame 原生区完全一致：结构 + 数据口径（综合评分/好评率/评测数/
  // 结论/口碑进度条/好评差评修正口碑）；评级文本英文 → 中文映射（4500/5000
  // → 好评率 90.0% / 修正口碑 87.0% / 评分 8.7 / 结论 ≥85 档「口碑表现出色」）
  expect(html.includes('steam-review-card') && html.includes('Steam 玩家评价')).toEqual(true);
  expect(html.includes('is-positive') && html.includes('fa-thumbs-up') && html.includes('特别好评')).toEqual(true);
  expect(html.includes('data-steam-score>8.7</strong>') && html.includes('综合评分')).toEqual(true);
  expect(html.includes('90.0%') && html.includes('5,000') && html.includes('条评价')).toEqual(true);
  expect(html.includes('口碑表现出色，推荐下载体验')).toEqual(true);
  expect(html.includes('修正口碑') && html.includes('87.0%') && html.includes('width:87.0%')).toEqual(true);
  expect(html.includes('data-steam-positive>4,500<') && html.includes('data-steam-negative>500<')).toEqual(true);
  expect(html.includes('数据更新于')).toEqual(true);
  // 样式表随卡片注入（XDGame 同款 CSS，作用域挂在容器 id 上）
  expect(documentMock.head.children.some((c) => c.id === 'gr-steam-inline-style')).toEqual(true);
  expect(section.getAttribute('data-gr-appid')).toEqual('1213700');
  // 注入位置：紧随 h1 之后
  expect(article.children.indexOf(section)).toEqual(article.children.indexOf(h1El) + 1);
  // 幂等：同游戏重复渲染不重复注入
  GR.detail.injectSteamButton('北方之魂/Spirit of the North');
  await new Promise((r) => setTimeout(r, 300));
  expect(article.children.filter((c) => c.id === 'gr-steam-inline-section').length).toEqual(1);

  // 模板降级：无评测 → 空串（与 XDGame 无数据隐藏一致，SteamSpy 评测数不再
  // 兜底——XDGame 卡无此口径）；旧缓存无原始计数 → 按整数好评率近似回退；
  // Mixed → is-mixed + fa-adjust + 褒贬不一（50/100 → 修正口碑 50.0 → 尚可档）
  expect(GR.detailTemplates.steamInlineSection({ appId: '1', name: '空数据' })).toEqual('');
  expect(
    GR.detailTemplates.steamInlineSection({ appId: '2', name: '空数据', steamspy: { totalReviews: 321 } })
  ).toEqual('');
  const legacyHtml = GR.detailTemplates.steamInlineSection({
    appId: '3',
    name: '旧缓存',
    positiveRate: 90,
    totalReviews: 5000,
    ratingDesc: '特别好评'
  });
  expect(legacyHtml.includes('data-steam-positive>4,500<') && legacyHtml.includes('90.0%')).toEqual(true);
  const mixedHtml = GR.detailTemplates.steamInlineSection({
    appId: '4',
    name: '褒贬不一',
    positiveRate: 50,
    positiveReviews: 50,
    negativeReviews: 50,
    totalReviews: 100,
    ratingDesc: 'Mixed'
  });
  expect(mixedHtml.includes('is-mixed') && mixedHtml.includes('fa-adjust') && mixedHtml.includes('褒贬不一')).toEqual(
    true
  );
  expect(mixedHtml.includes('口碑尚可，建议结合玩法判断')).toEqual(true);

  // 源码级守护：站点门控走规则 features 声明（v10.7.0 批次4——原硬编码名单
  // INLINE_SECTION_SITES 已删除，XDGame 等原生卡站点默认不声明即不注入；
  // v14 B3 门控代码迁至 sidebar.js，聚合读取 detail 模块族）
  const detailSrc2 = [
    'content/detail/detail-page.js',
    'content/detail/sidebar.js',
    'content/detail/sidebar-rows.js', // v14.3.0 B1 拆分：detail 模块族随拆分扩展
    'content/detail/inline-card.js',
    'content/detail/candidates.js',
    'content/detail/tracking.js'
  ]
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf-8'))
    .join('\n');
  expect(detailSrc2.includes('features || {}).inlineSteamCard')).toEqual(true);
  const xdgameAdapterSrc = fs.readFileSync(path.join(ROOT, 'adapters/sites/xdgame.js'), 'utf-8');
  expect(xdgameAdapterSrc.includes('inlineSteamCard')).toEqual(false); // XDGame 不声明内嵌卡
  const builtinInline = ['adapters/sites/xianyudanji.js', 'adapters/sites/gamer520.js']
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf-8'))
    .map((src) => src.includes('inlineSteamCard: true'));
  expect(builtinInline.every(Boolean)).toEqual(true);

  // 还原 mock（后续节不受影响）
  documentMock.getElementById = origGetById;
  globalThis.location = {
    hostname: 'www.xianyudanji.gg',
    pathname: '/16598.html',
    href: 'https://www.xianyudanji.gg/16598.html'
  };
  window.location = globalThis.location;
});

// ============ 9b. 详情浮窗模板全量渲染（v9.1.0 覆盖率） ============
simTest('9b. 详情浮窗模板全量渲染（detail-templates 分支覆盖）', () => {
  const GR = getGR(); // 节 9a 已装载（本文件顺序执行；-t 单跑不支持——与原文件一致）
  const data = {
    appId: '1213700',
    name: '北方之魂',
    englishName: 'Spirit of the North',
    positiveRate: 90,
    ratingDesc: '特别好评',
    totalReviews: 5000,
    recentPositiveRate: 88,
    recentTotalReviews: 100,
    url: 'https://store.steampowered.com/app/1213700/',
    headerImage: 'https://cdn/h.jpg',
    genres: ['RPG', '冒险'],
    userTags: ['开放世界'],
    developers: ['Dev'],
    chineseSupported: true,
    releaseDate: '2024-01-01',
    lastUpdate: '2024-06-01',
    description: '一段描述文本',
    steamspy: { positiveRate: 92, reviewCount: 300, currentPlayers: 1200, owners: '1000000', averagePlaytime: 5 },
    steamdbUrl: 'https://steamdb.info/app/1213700/',
    type: 'game',
    reviews: [
      { recommended: true, text: '很好玩的游戏' },
      { recommended: false, text: '优化一般' }
    ]
  };
  const html = GR.detailTemplates.steamSidebar(data, Date.now(), true, true);
  expect(html.includes('gr-detail-header-img')).toEqual(true);
  expect(html.includes('gr-detail-title') && html.includes('北方之魂')).toEqual(true);
  expect(html.includes('特别好评')).toEqual(true);
  expect(html.includes('gr-detail-spy') && html.includes('92%')).toEqual(true);
  expect(html.includes('gr-detail-review') && html.includes('很好玩的游戏')).toEqual(true);
  expect(html.includes('gr-detail-btn')).toEqual(true);
  expect(html.includes('gr-refresh-cache-btn')).toEqual(true);
  expect(html.includes('gr-report-issue-btn')).toEqual(true);
});

// ============ 9c. 详情浮窗模板变体分支（v9.1.0 覆盖率） ============
simTest('9c. 详情浮窗模板变体分支（空数据/降级路径）', async () => {
  await loadModules(); // -t 单跑兜底：确保 GR shim 就绪
  const GR = getGR();
  // 变体 1：无 steamspy / 无 reviews / 无中文支持 / demo 类型 / 无头图
  const sparse = {
    appId: '999',
    name: '测试游戏',
    englishName: 'Test',
    positiveRate: 40,
    ratingDesc: '褒贬不一',
    totalReviews: 50,
    url: 'https://store.steampowered.com/app/999/',
    headerImage: '',
    genres: [],
    userTags: [],
    developers: [],
    chineseSupported: false,
    releaseDate: '',
    type: 'demo',
    reviews: [],
    steamspy: null
  };
  const html = GR.detailTemplates.steamSidebar(sparse, Date.now(), false, false);
  expect(html.includes('试玩版') || html.includes('Demo')).toEqual(true);
  expect(html.includes('gr-detail-spy')).toEqual(true); // 面板始终渲染
  expect(html.includes('暂不可用')).toEqual(true); // 无 steamspy → 降级文案
  expect(html.includes('gr-detail-review')).toEqual(false); // 无评测 → 无块
  expect(html.includes('gr-refresh-cache-btn')).toEqual(false); // hasRefresh=false
  expect(html.includes('gr-report-issue-btn')).toEqual(false); // hasReport=false
  expect(html.includes('褒贬不一')).toEqual(true);
});

// ============ 9d. 详情页搜索未找到 → 手动选择（v9.1.0 覆盖率） ============
simTest('9d. 详情页未找到路径（手动选择浮窗）', async () => {
  await loadModules();
  const GR = getGR();
  presets['GET_SETTINGS'] = () => ({
    settings: { ...DEFAULT_SETTINGS, badgeVisibility: undefined, trackedSites: ['xianyudanji'] }
  });
  globalThis.location = {
    hostname: 'www.xianyudanji.gg',
    pathname: '/16598.html',
    href: 'https://www.xianyudanji.gg/16598.html'
  };
  window.location = globalThis.location;
  const h1El = new FakeEl('h1');
  h1El._text = '找不到的游戏XYZ';
  setQueryStubs(
    () => [],
    (sel) => (sel === 'h1' || sel === '.entry-title' ? h1El : null)
  );
  // 搜索全部失败 → 未找到 → 手动选择浮窗
  presets['SEARCH_STEAM'] = () => ({ data: null });
  presets['GET_STEAM_BY_APPID'] = () => ({ data: null });
  GR.detail.injectSteamButton('找不到的游戏XYZ');
  await waitForSignal(() => {
    const root = documentMock.body.children.find((c) => c.id === 'gr-steam-float');
    const body = root && root.children[1];
    return body && (body._html || '').includes('手动选择游戏');
  }, '节9d: 手动选择浮窗（未命中兜底）');
  const manualRoot = documentMock.body.children.find((c) => c.id === 'gr-steam-float');
  const manualBody = manualRoot && manualRoot.children[1];
  expect(((manualBody && manualBody._html) || '').includes('手动选择游戏')).toEqual(true);
  expect(((manualBody && manualBody._html) || '').includes('gr-manual-search-input')).toEqual(true);
});

// ============ 10. 下载追踪（v10.0.0）——tracking 纯函数（实例无关） ============
simTest('10. 下载追踪（网盘识别纯函数）', async () => {
  await loadModules(); // -t 单跑兜底
  const GR = getGR();
  const { isDownloadUrl, isDownloadText } = GR.tracking;
  // 网盘/下载 URL 识别（纯函数）
  expect(isDownloadUrl('https://pan.baidu.com/s/abc')).toEqual(true);
  expect(isDownloadUrl('https://pan.xunlei.com/s/xyz')).toEqual(false);
  expect(isDownloadUrl('magnet:?xt=urn:btih:abc')).toEqual(true);
  expect(isDownloadUrl('https://www.example.com/game.html')).toEqual(false);
  expect(isDownloadUrl(null)).toEqual(false);
  // 下载相关文本识别
  expect(isDownloadText('百度网盘提取码')).toEqual(true);
  expect(isDownloadText('点击下载游戏')).toEqual(true);
  expect(isDownloadText('游戏介绍与截图')).toEqual(false);
  // v10.0.0：window.open 拦截已移除（隔离世界覆盖对站点自身 JS 无效——
  // 死代码）；下载路径由点击委托/copy 捕获覆盖，E2E 真实浏览器验证
});
