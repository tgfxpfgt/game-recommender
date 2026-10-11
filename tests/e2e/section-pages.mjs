/**
 * 游戏雷达 Game Radar - E2E 冒烟：扩展页族 / E2E smoke: popup, options, hub
 *
 * 第五轮 B9 自 e2e-smoke.mjs 拆出：popup 冒烟与快速搜索（2/2a）、options
 * 设置与双向状态一致性（2b）、过滤设置全量保存与并发防覆盖（2b2）、皮肤
 * 系统（2c）、设置中心 hub（2d）。
 * state: { context, extId, check } — 由 run.mjs 注入。
 */
('use strict');

export async function runPages(state) {
  const { context, extId, check } = state;

  // 2. popup 打开且无 console error
  console.log('2. popup 冒烟');
  const page = await context.newPage();
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`chrome-extension://${extId}/popup/popup.html`);
  await page.waitForTimeout(800);
  check('popup 标题渲染', (await page.textContent('h1'))?.includes('游戏智能推荐') ?? false);
  check('popup 版本号显示', (await page.textContent('#extVersion'))?.includes('v') ?? false);
  check(
    'popup API 状态（v6.4.10 扁平修复后非失效）',
    ((await page.textContent('#apiStatusInfo')) ?? '').includes('无法获取') === false
  );
  // v6.4.11：popup 全量设置覆盖 + 集中入口（hub 按钮替代原 设置/分析 独立入口）
  const popupCover = await page.evaluate(() => ({
    hubBtn: !!document.getElementById('hubBtn'),
    optionsBtn: !!document.getElementById('optionsBtn'),
    dashboardBtn: !!document.getElementById('dashboardBtn'),
    recentFilter: !!document.getElementById('ppRecentFilter'),
    filterMode: !!document.getElementById('ppFilterMode'),
    sortByRating: !!document.getElementById('ppSortByRating'),
    ruleBtn: !!document.getElementById('ppOpenFilterRules'),
    weights: document.querySelectorAll('#ppWeights [data-w]').length,
    badges: ['ppBadgeRecent', 'ppBadgeAll', 'ppBadgeUpdate', 'ppBadgeRec'].every((id) => !!document.getElementById(id)),
    autoBackup: !!document.getElementById('ppAutoBackup'),
    logLevel: !!document.getElementById('ppLogLevel'),
    freeGamesBtn: !!document.getElementById('freeGamesBtn')
  }));
  check(
    'popup 集中入口（设置中心按钮替代独立入口）',
    popupCover.hubBtn && !popupCover.optionsBtn && !popupCover.dashboardBtn
  );
  check(
    'popup 全覆盖设置（30天过滤/模式/重排/规则入口/徽章/权重/备份/日志）',
    popupCover.recentFilter &&
      popupCover.filterMode &&
      popupCover.sortByRating &&
      popupCover.ruleBtn &&
      popupCover.weights === 10 && // v10.5.3：权重滑块 8→10（sales/reviews 两项）
      popupCover.badges &&
      popupCover.autoBackup &&
      popupCover.logLevel &&
      popupCover.freeGamesBtn
  );
  check('popup 无 console error', errors.length === 0, `(${errors.slice(0, 3).join(' | ')})`);
  await page.close();

  // 2a. popup 快速搜索（v7.4.0：输入 → Steam 候选列表 → 点击打开）
  console.log('2a. popup 快速搜索');
  const searchPage = await context.newPage();
  await searchPage.goto(`chrome-extension://${extId}/popup/popup.html`);
  await searchPage.waitForTimeout(600);
  await searchPage.evaluate(() => {
    const input = document.getElementById('searchInput');
    input.value = '游戏';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  // 候选来自后台 Steam 搜索（真实网络或 E2E_MOCK fixture）
  let searchOk = false;
  for (let i = 0; i < 30 && !searchOk; i++) {
    await new Promise((r) => setTimeout(r, 500));
    searchOk = await searchPage.evaluate(() => {
      const box = document.getElementById('searchResults');
      return !!box && box.querySelectorAll('.search-result-row').length > 0;
    });
  }
  check('搜索候选渲染（Steam 检索）', searchOk);
  await searchPage.close();

  // 2b. options 设置页 + popup↔options 状态一致性（v6.4.1）
  console.log('2b. options 设置页与双向状态一致性');
  const optPage = await context.newPage();
  const optErrors = [];
  optPage.on('console', (msg) => {
    if (msg.type() === 'error') optErrors.push(msg.text());
  });
  optPage.on('pageerror', (e) => optErrors.push(String(e)));
  await optPage.goto(`chrome-extension://${extId}/options/options.html`);
  await optPage.waitForTimeout(1200);
  const optState = await optPage.evaluate(() => ({
    enabled: document.getElementById('enabled').checked,
    maxLog: document.getElementById('maxLog').value,
    autoBackup: document.getElementById('autoBackup').checked,
    maxRuntimeLog: document.getElementById('maxRuntimeLog').value,
    title: document.title
  }));
  check(
    'options 设置渲染（启用开关+日志上限+自动备份）',
    optState.enabled === true &&
      Number(optState.maxLog) > 0 &&
      optState.autoBackup === true &&
      Number(optState.maxRuntimeLog) > 0
  );
  check('options 标题', optState.title.includes('设置'));
  // v10.8：v10.7.0 新设置键保存-回显往返（夜间窗口/批次大小/二维码上限）+ 加密组件加载
  const newKeys = await optPage.evaluate(async () => {
    document.getElementById('uiThemeNightStart').value = 21;
    document.getElementById('uiThemeNightStart').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('uiThemeNightEnd').value = 6;
    document.getElementById('uiThemeNightEnd').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('ratingsBatchSize').value = 80;
    document.getElementById('ratingsBatchSize').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('qrImageMaxKb').value = 1024;
    document.getElementById('qrImageMaxKb').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('saveBtn').click();
    await new Promise((r) => setTimeout(r, 1500));
    const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
    const s = resp.settings;
    return {
      ns: s.uiThemeNightStart,
      ne: s.uiThemeNightEnd,
      batch: s.ratingsBatchSize,
      qrKb: s.qrImageMaxKb,
      crypto: !!window.__GR_CRYPTO__
    };
  });
  check(
    'options 新设置键保存往返（夜间窗口/批次/二维码上限）',
    newKeys.ns === 21 && newKeys.ne === 6 && newKeys.batch === 80 && newKeys.qrKb === 1024,
    `(ns=${newKeys.ns} ne=${newKeys.ne} batch=${newKeys.batch} qrKb=${newKeys.qrKb})`
  );
  check('crypto-utils 加密组件加载（F5）', newKeys.crypto === true);
  // options 切 VM 过滤（先切到过滤面板）→ 自动保存（800ms 防抖）→ popup 重开验证一致
  await optPage.evaluate(() => {
    document.querySelector('.gr-nav-item[data-panel="filters"]').click();
    document.getElementById('vmFilterEnabled').click();
    // v6.4.11：30 天好评过滤（此前保存时漏读 DOM，永远无法持久化）
    document.getElementById('recentFilterEnabled').click();
  });
  await optPage.waitForTimeout(2500);
  const savedFilterState = await optPage.evaluate(async () => {
    const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
    const s = resp.settings;
    return { vm: s.enableVmFilter, recent: s.enableRecentFilter, recentMin: s.minRecentSteamRatingFilter };
  });
  check('options 30 天过滤设置已保存（v6.4.11 修复）', savedFilterState.recent === true);
  const popup3 = await context.newPage();
  await popup3.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popup3.waitForTimeout(800);
  const popupVm = await popup3.evaluate(() => ({
    vm: document.getElementById('ppVmFilter').checked,
    recent: document.getElementById('ppRecentFilter').checked
  }));
  check('options→popup 状态一致（VM 过滤开启）', popupVm.vm === true);
  check('options→popup 状态一致（30 天过滤开启）', popupVm.recent === true);
  // popup 切回 → options 重开验证一致（防快照覆盖：popup 保存前重读）
  await popup3.evaluate(() => document.getElementById('ppVmFilter').click());
  await popup3.waitForTimeout(800);
  const opt2 = await context.newPage();
  await opt2.goto(`chrome-extension://${extId}/options/options.html`);
  await opt2.waitForTimeout(1200);
  const optVm2 = await opt2.evaluate(() => {
    document.querySelector('.gr-nav-item[data-panel="filters"]').click();
    return document.getElementById('vmFilterEnabled').checked;
  });
  check('popup→options 状态一致（VM 过滤回切）', optVm2 === false);
  check('options 无 console error', optErrors.length === 0, `(${optErrors.slice(0, 3).join(' | ')})`);
  await opt2.close();
  await popup3.close();
  await optPage.close();

  // 2b2. 过滤设置全量保存往返 + 快速连续修改（v6.4.12 回归）
  console.log('2b2. 过滤设置全量保存与并发防覆盖');
  const optPage2 = await context.newPage();
  await optPage2.goto(`chrome-extension://${extId}/options/options.html`);
  await optPage2.waitForTimeout(1200);
  await optPage2.evaluate(() => {
    document.querySelector('.gr-nav-item[data-panel="filters"]').click();
    document.getElementById('ratingFilterEnabled').checked = true;
    document.getElementById('ratingFilterEnabled').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('minRating').value = 65;
    document.getElementById('minRating').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('ratingFilterMode').value = 'or';
    document.getElementById('ratingFilterMode').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('ruleAddBtn').click();
    document.getElementById('saveBtn').click();
  });
  await optPage2.waitForTimeout(2000);
  const filterSaved = await optPage2.evaluate(async () => {
    const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
    const s = resp.settings;
    return { enable: s.enableRatingFilter, min: s.minSteamRatingFilter, mode: s.ratingFilterMode };
  });
  check(
    '过滤设置全量保存（好评率开+阈值65/关系or）',
    filterSaved.enable === true && filterSaved.min === 65 && filterSaved.mode === 'or',
    JSON.stringify(filterSaved)
  );
  // 重开设置页回显（好评率过滤开关+阈值）
  await optPage2.close();
  const optPage3 = await context.newPage();
  await optPage3.goto(`chrome-extension://${extId}/options/options.html`);
  await optPage3.waitForTimeout(1200);
  const filterEcho = await optPage3.evaluate(() => {
    document.querySelector('.gr-nav-item[data-panel="filters"]').click();
    return {
      enable: document.getElementById('ratingFilterEnabled').checked,
      min: Number(document.getElementById('minRating').value)
    };
  });
  check(
    '重开设置页回显（好评率过滤 开+65）',
    filterEcho.enable === true && filterEcho.min === 65,
    JSON.stringify(filterEcho)
  );
  // 快速连续修改（串行队列防竞态：并发 savePatch 曾互相覆盖）
  const popup4 = await context.newPage();
  await popup4.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popup4.waitForTimeout(1000);
  await popup4.evaluate(() => {
    document.getElementById('ppMinRecent').value = 40;
    document.getElementById('ppMinRecent').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('ppFilterMode').value = 'and';
    document.getElementById('ppFilterMode').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('ppSortByRating').checked = true;
    document.getElementById('ppSortByRating').dispatchEvent(new Event('change', { bubbles: true }));
  });
  await popup4.waitForTimeout(2500);
  const burstSaved = await popup4.evaluate(async () => {
    const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
    const s = resp.settings;
    return { min: s.minRecentSteamRatingFilter, mode: s.ratingFilterMode, sort: s.enableSortByRating };
  });
  check(
    '快速连续 3 项修改全部保留（阈值40/关系and/重排开）',
    burstSaved.min === 40 && burstSaved.mode === 'and' && burstSaved.sort === true,
    JSON.stringify(burstSaved)
  );
  await popup4.close();

  // 2c. 皮肤系统（v6.4.19：可选主题 + 立即生效 + 保存往返）
  console.log('2c. 皮肤系统（Steam/Vista/Win 历代主题）');
  const skinPage = await context.newPage();
  const skinErrors = [];
  skinPage.on('console', (msg) => {
    if (msg.type() === 'error') skinErrors.push(msg.text());
  });
  skinPage.on('pageerror', (e) => skinErrors.push(String(e)));
  await skinPage.goto(`chrome-extension://${extId}/options/options.html`);
  await skinPage.waitForTimeout(1200);
  const skinState = await skinPage.evaluate(() => ({
    select: document.getElementById('uiTheme').value,
    options: Array.from(document.querySelectorAll('#uiTheme option')).map((o) => o.value),
    theme: document.body.dataset.theme,
    vistaBtnGone: !document.getElementById('openVistaMenu')
  }));
  check(
    '皮肤选择器（默认 steam + 20 主题 + Vista 入口移除）',
    skinState.select === 'steam' && skinState.options.length === 20 && skinState.vistaBtnGone
  );
  // 切换皮肤 → body[data-theme] 立即生效 + 保存往返
  await skinPage.evaluate(() => {
    const sel = document.getElementById('uiTheme');
    sel.value = 'ios17';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('saveBtn').click();
  });
  await skinPage.waitForTimeout(1500);
  const skinApplied = await skinPage.evaluate(() => document.body.dataset.theme);
  check('皮肤切换立即生效（body[data-theme=ios17]）', skinApplied === 'ios17');
  await skinPage.close();
  const skinPage2 = await context.newPage();
  await skinPage2.goto(`chrome-extension://${extId}/options/options.html`);
  await skinPage2.waitForTimeout(1200);
  const skinPersist = await skinPage2.evaluate(async () => {
    const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
    return { theme: resp.settings.uiTheme, applied: document.body.dataset.theme };
  });
  check('皮肤保存并重开生效（uiTheme=ios17）', skinPersist.theme === 'ios17' && skinPersist.applied === 'ios17');
  // 还原默认皮肤（避免影响后续断言）
  await skinPage2.evaluate(() => {
    const sel = document.getElementById('uiTheme');
    sel.value = 'steam';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('saveBtn').click();
  });
  await skinPage2.waitForTimeout(1200);
  check('皮肤系统无 console error', skinErrors.length === 0, `(${skinErrors.slice(0, 3).join(' | ')})`);
  await skinPage2.close();

  // 2d. 设置中心 hub（v6.4.11：所有页面集中入口 + 一键切换）
  console.log('2d. 设置中心 hub 集中入口');
  const hub = await context.newPage();
  const hubErrors = [];
  hub.on('console', (msg) => {
    if (msg.type() === 'error') hubErrors.push(msg.text());
  });
  hub.on('pageerror', (e) => hubErrors.push(String(e)));
  await hub.goto(`chrome-extension://${extId}/hub/hub.html`);
  await hub.waitForTimeout(1500);
  const hubState = await hub.evaluate(() => ({
    items: document.querySelectorAll('.hub-item').length,
    frameSrc: document.getElementById('hubFrame').src,
    active: document.querySelector('.hub-item.active')?.dataset.page || '',
    version: document.getElementById('hubVersion').textContent
  }));
  check(
    'hub 渲染（3 个页面入口 + 默认加载设置页）',
    hubState.items === 3 &&
      hubState.active === 'options' &&
      hubState.frameSrc.includes('options/options.html') &&
      hubState.version.includes('v')
  );
  // 切换：数据分析（iframe 内 dashboard 页面加载；趋势图数据依赖浏览行为，
  // 本段位于第 4 节之前可能为空 → 仅断言页面结构与标题）
  await hub.evaluate(() => document.querySelector('.hub-item[data-page="dashboard"]').click());
  await hub.waitForTimeout(2000);
  const hubDash = await hub.evaluate(async () => {
    const f = document.getElementById('hubFrame');
    const doc = f.contentDocument;
    return {
      src: f.src,
      title: doc ? doc.title : '',
      hasStats: doc ? !!doc.getElementById('statTotal') : false,
      hasTrend: doc ? !!doc.getElementById('trendChart') : false
    };
  });
  check(
    'hub 切换到数据分析（iframe 渲染 dashboard）',
    hubDash.src.includes('dashboard/dashboard.html') &&
      hubDash.title.includes('数据分析') &&
      hubDash.hasStats &&
      hubDash.hasTrend
  );
  // 切换：限免游戏
  await hub.evaluate(() => document.querySelector('.hub-item[data-page="freegames"]').click());
  await hub.waitForTimeout(1500);
  const hubFree = await hub.evaluate(() => document.getElementById('hubFrame').src);
  check('hub 切换到限免游戏', hubFree.includes('freegames/freegames.html'));
  // v9.2.1：限免页筛选按钮回归（平台/领取方式——v8.1.0 组件化误改类名致失效）
  const freeFilterState = await hub.evaluate(() => {
    const doc = document.getElementById('hubFrame').contentDocument;
    const epicBtn = doc.querySelector('.filter-btn[data-platform="epic"]');
    epicBtn.click();
    const epicActive = epicBtn.classList.contains('active');
    const allBtn = doc.querySelector('.filter-btn[data-platform="all"]');
    const allDeactivated = !allBtn.classList.contains('active');
    const claimBtn = doc.querySelector('.claim-btn-filter[data-claim="thirdparty"]');
    claimBtn.click();
    return epicActive && allDeactivated && claimBtn.classList.contains('active');
  });
  check('限免页筛选按钮生效（平台+领取方式）', freeFilterState);
  // v9.3.0：限免卡片渲染（MOCK 回放限免源 fixture——离线可测）
  // 先重置筛选（上一断言停留在 epic+thirdparty——mock 的 epic 游戏是 direct）
  await hub.evaluate(() => {
    const doc = document.getElementById('hubFrame').contentDocument;
    doc.querySelector('.filter-btn[data-platform="all"]').click();
    doc.querySelector('.claim-btn-filter[data-claim="all"]').click();
  });
  await hub.waitForTimeout(600);
  let freeCardCount = 0;
  for (let i = 0; i < 20 && freeCardCount === 0; i++) {
    await new Promise((r) => setTimeout(r, 500));
    freeCardCount = await hub.evaluate(() => {
      const doc = document.getElementById('hubFrame').contentDocument;
      return doc ? doc.querySelectorAll('.game-card').length : 0;
    });
  }
  const freeData = await hub.evaluate(async () => {
    const resp = await chrome.runtime.sendMessage({ action: 'GET_FREE_GAMES', force: false });
    const games = (resp && resp.data && resp.data.games) || [];
    return { count: games.length, names: games.slice(0, 3).map((g) => g.name) };
  });
  void freeData; // 数据已在卡片断言中间接验证（渲染成功）
  check('限免游戏卡片渲染（MOCK 回放限免源）', freeCardCount > 0);
  check('hub 无 console error', hubErrors.length === 0, `(${hubErrors.slice(0, 3).join(' | ')})`);
  await hub.close();
}
