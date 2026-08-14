/**
 * 游戏雷达 Game Radar - 浏览器端轻量冒烟测试（v3.3.9）
 * Browser smoke test with playwright-core + system Edge (no browser download).
 *
 * 覆盖：1) 扩展可加载（MV3 manifest 合法）；2) popup 打开且无 console error；
 * 3) 本地 fixture 页注入 __GR__ 命名空间并渲染状态浮窗。
 * Run: npm run e2e （需本机已装 Edge/Chrome；首次 npm install）
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = path.resolve(ROOT, '..');
const FIXTURE = path.join(ROOT, 'fixtures/list-page.html');

let pass = 0,
  fail = 0;
function check(name, ok, extra = '') {
  if (ok) {
    pass++;
    console.log('  ✅', name);
  } else {
    fail++;
    console.log('  ❌', name, extra);
  }
}

// 生成 fixture 页（模拟 xianyudanji 列表页/详情页结构）；用本地 http 托管
// （file:// 不被内容脚本 <all_urls> 匹配）。详情页 h1 复刻 16598 标题场景。
// v4.1.0：count 参数支持大列表（滚动批次场景，130 项 > 首屏批 60）
function makeListHtml(count = 3) {
  const items = Array.from(
    { length: count },
    (_, i) => `<li class="game-item"><a class="tit" href="/${100 + i}.html">游戏${i + 1}</a></li>`
  ).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>fixture</title></head>
<body><h2 class="entry-title"><a href="/1.html">游戏A</a></h2>
<ul id="game-list">${items}</ul></body></html>`;
}
const LIST_HTML = makeListHtml();
// 详情页：主内容区（article 内含主图 Steam CDN 1213700）+ 侧边推荐图（2001760）——
// 验证 appId 提取限定主内容区 + 后台名称相关性校验（v3.3.14）
const DETAIL_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>北方之魂增强版/Spirit of the North- Switch520.com</title></head>
<body>
<article class="entry-content">
  <h1 class="entry-title">北方之魂增强版/Spirit of the North- Switch520.com</h1>
  <img src="https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1213700/header.jpg">
</article>
<aside class="sidebar">
  <a href="/119428.html"><img src="https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2001760/header.jpg"></a>轮回之兽|修改器
</aside>
</body></html>`;

fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
fs.writeFileSync(FIXTURE, LIST_HTML);
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.url.includes('16598')) return res.end(DETAIL_HTML);
  if (req.url.includes('scroll=1')) return res.end(makeListHtml(130)); // v4.1.0 滚动批次
  res.end(LIST_HTML);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
// 用 host-resolver-rules 把下载站域名映射到本地 fixture（内容脚本对非追踪
// 站点会早退，域名必须是已追踪的下载站）
const FIXTURE_PORT = server.address().port;
const FIXTURE_URL = `http://www.xianyudanji.gg:${FIXTURE_PORT}/`;

const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf-8'));
console.log(`1. 扩展 ${manifest.name} v${manifest.version}`);

const channel = process.env.E2E_CHANNEL || 'msedge';
const userDataDir = path.join(ROOT, '.e2e-profile');
// 清理上次运行残留的 profile（否则默认设置断言会受旧状态影响）
fs.rmSync(userDataDir, { recursive: true, force: true });
let context = null;
try {
  context = await chromium.launchPersistentContext(userDataDir, {
    channel, // 复用系统 Edge/Chrome，免下载浏览器
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
      `--host-resolver-rules=MAP www.xianyudanji.gg 127.0.0.1`
    ]
  });
} catch (e) {
  console.log('⚠️ 浏览器启动失败（需本机安装 Edge 或设置 E2E_CHANNEL=chrome）:', e.message.split('\n')[0]);
  // v3.4.1：启动失败必须失败退出——此前 exit(0) 使 e2e 在"根本没测"时假绿
  process.exit(1);
}

// 等待扩展加载并获取扩展 id（service worker 就绪）
try {
  await runChecks();
} finally {
  // v3.4.1：中途异常也清理 profile/HTTP server，避免残留
  if (context) await context.close().catch(() => {});
  server.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
console.log(`\n===== E2E 冒烟结果 =====\n${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);

async function runChecks() {
  // v5.1.0：E2E_FAST=1 离线模式——跳过依赖真实 Steam 网络的详情页段（第 4 节），
  // 用于 CI/本地快速冒烟（不验证真实检索链路）
  const FAST = process.env.E2E_FAST === '1';
  let extId = null;
  for (let i = 0; i < 30; i++) {
    const workers = context.serviceWorkers();
    if (workers.length > 0) {
      extId = new URL(workers[0].url()).host;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  check('扩展后台 Service Worker 已启动', !!extId, `(id=${extId || '未获取'})`);

  if (extId) {
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
    check('popup API 状态（v6.4.10 扁平修复后非失效）', ((await page.textContent('#apiStatusInfo')) ?? '').includes('无法获取') === false);
    // v6.4.11：popup 全量设置覆盖 + 集中入口（hub 按钮替代原 设置/分析 独立入口）
    const popupCover = await page.evaluate(() => ({
      hubBtn: !!document.getElementById('hubBtn'),
      optionsBtn: !!document.getElementById('optionsBtn'),
      dashboardBtn: !!document.getElementById('dashboardBtn'),
      recentFilter: !!document.getElementById('ppRecentFilter'),
      filterMode: !!document.getElementById('ppFilterMode'),
      sortByRating: !!document.getElementById('ppSortByRating'),
      vmKeywords: !!document.getElementById('ppVmKeywords'),
      filterMatch: !!document.getElementById('ppFilterMatch'),
      weights: document.querySelectorAll('#ppWeights [data-w]').length,
      badges: ['ppBadgeRecent', 'ppBadgeAll', 'ppBadgeUpdate', 'ppBadgeRec'].every((id) => !!document.getElementById(id)),
      autoBackup: !!document.getElementById('ppAutoBackup'),
      logLevel: !!document.getElementById('ppLogLevel'),
      freeGamesBtn: !!document.getElementById('freeGamesBtn')
    }));
    check('popup 集中入口（设置中心按钮替代独立入口）', popupCover.hubBtn && !popupCover.optionsBtn && !popupCover.dashboardBtn);
    check('popup 全覆盖设置（30天过滤/模式/重排/关键词/徽章/权重/备份/日志）',
      popupCover.recentFilter && popupCover.filterMode && popupCover.sortByRating &&
      popupCover.vmKeywords && popupCover.filterMatch && popupCover.weights === 6 &&
      popupCover.badges && popupCover.autoBackup && popupCover.logLevel && popupCover.freeGamesBtn);
    check('popup 无 console error', errors.length === 0, `(${errors.slice(0, 3).join(' | ')})`);
    await page.close();

    // 2b. options 设置页 + popup↔options 状态一致性（v6.4.1）
    console.log('2b. options 设置页与双向状态一致性');
    const optPage = await context.newPage();
    const optErrors = [];
    optPage.on('console', (msg) => { if (msg.type() === 'error') optErrors.push(msg.text()); });
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
    check('options 设置渲染（启用开关+日志上限+自动备份）', optState.enabled === true && Number(optState.maxLog) > 0 && optState.autoBackup === true && Number(optState.maxRuntimeLog) > 0);
    check('options 标题', optState.title.includes('设置'));
    // options 切 VM 过滤（先切到过滤面板）→ 自动保存（800ms 防抖）→ popup 重开验证一致
    await optPage.evaluate(() => {
      document.querySelector('.nav-item[data-panel="filters"]').click();
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
      document.querySelector('.nav-item[data-panel="filters"]').click();
      return document.getElementById('vmFilterEnabled').checked;
    });
    check('popup→options 状态一致（VM 过滤回切）', optVm2 === false);
    check('options 无 console error', optErrors.length === 0, `(${optErrors.slice(0, 3).join(' | ')})`);
    await opt2.close();
    await popup3.close();
    await optPage.close();

    // 2c. Vista Aero 新菜单（v6.4.6）
    console.log('2c. Vista 新菜单冒烟');
    const vista = await context.newPage();
    const vistaErrors = [];
    vista.on('console', (msg) => { if (msg.type() === 'error') vistaErrors.push(msg.text()); });
    vista.on('pageerror', (e) => vistaErrors.push(String(e)));
    await vista.goto(`chrome-extension://${extId}/menu-vista/index.html`);
    await vista.waitForTimeout(1200);
    const vistaState = await vista.evaluate(() => ({
      title: document.title,
      version: document.getElementById('extVersion').textContent,
      enabled: document.getElementById('vEnabled').checked,
      weights: document.querySelectorAll('[data-w]').length,
      panels: document.querySelectorAll('.aero-panel').length,
      classicBtn: !!document.getElementById('toggleClassic')
    }));
    check('Vista 菜单渲染（标题/版本/启用开关）', vistaState.title.includes('Vista') && vistaState.version.includes('v') && vistaState.enabled === true);
    check('Vista 菜单全功能（8 面板 + 6 权重滑块 + 切换按钮）', vistaState.panels === 8 && vistaState.weights === 6 && vistaState.classicBtn);
    check('Vista 菜单无 console error', vistaErrors.length === 0, `(${vistaErrors.slice(0, 3).join(' | ')})`);
    // v6.4.11：Vista 徽章开关嵌套保存（此前 Object.assign 拍平点号键，
    // badgeVisibility.recent 永远写不进）——切换后经 GET_SETTINGS 验证
    await vista.evaluate(() => document.getElementById('vBadgeRecent').click());
    await vista.waitForTimeout(1200);
    const badgeSaved = await vista.evaluate(async () => {
      const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
      const s = resp.settings;
      return { recent: s.badgeVisibility && s.badgeVisibility.recent, noDotted: !('badgeVisibility.recent' in s) };
    });
    check('Vista 徽章开关已保存（deepSet 修复嵌套键）', badgeSaved.recent === false && badgeSaved.noDotted);
    await vista.evaluate(() => document.getElementById('vBadgeRecent').click());
    await vista.waitForTimeout(1200);
    const badgeRestored = await vista.evaluate(async () => {
      const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
      return resp.settings.badgeVisibility && resp.settings.badgeVisibility.recent;
    });
    check('Vista 徽章开关回切成功', badgeRestored === true);
    // Vista 交互：规则添加 / 站点管理 / ITAD 按钮 / 日志查看（v6.4.9）
    await vista.evaluate(() => {
      document.querySelector('.aero-nav .nav-item[data-panel="filters"]').click();
      document.getElementById('vRuleAdd').click();
    });
    await vista.waitForTimeout(500);
    const ruleRows = await vista.evaluate(() => document.querySelectorAll('#vRuleList .aero-row').length);
    check('Vista 规则添加（编辑器行出现）', ruleRows >= 1);
    await vista.evaluate(() => {
      document.querySelector('.aero-nav .nav-item[data-panel="general"]').click();
      document.querySelector('.aero-nav .nav-item[data-panel="recommend"]').click();
    });
    await vista.waitForTimeout(300);
    const itadBtns = await vista.evaluate(() => ({
      save: !!document.getElementById('vItadSave'),
      test: !!document.getElementById('vItadTest'),
      siteAdd: !!document.getElementById('vAddSite')
    }));
    check('Vista ITAD 保存/测试按钮存在', itadBtns.save && itadBtns.test);
    await vista.evaluate(() => document.querySelector('.aero-nav .nav-item[data-panel="logging"]').click());
    await vista.waitForTimeout(500);
    const logState = await vista.evaluate(() => ({
      refresh: !!document.getElementById('vLogRefresh'),
      list: document.getElementById('vLogList').innerHTML.length > 0
    }));
    check('Vista 日志查看（刷新按钮 + 列表渲染）', logState.refresh && logState.list);
    await vista.close();

    // 2d. 设置中心 hub（v6.4.11：所有页面集中入口 + 一键切换）
    console.log('2d. 设置中心 hub 集中入口');
    const hub = await context.newPage();
    const hubErrors = [];
    hub.on('console', (msg) => { if (msg.type() === 'error') hubErrors.push(msg.text()); });
    hub.on('pageerror', (e) => hubErrors.push(String(e)));
    await hub.goto(`chrome-extension://${extId}/hub/hub.html`);
    await hub.waitForTimeout(1500);
    const hubState = await hub.evaluate(() => ({
      items: document.querySelectorAll('.hub-item').length,
      frameSrc: document.getElementById('hubFrame').src,
      active: document.querySelector('.hub-item.active')?.dataset.page || '',
      version: document.getElementById('hubVersion').textContent
    }));
    check('hub 渲染（4 个页面入口 + 默认加载设置页）',
      hubState.items === 4 && hubState.active === 'options' && hubState.frameSrc.includes('options/options.html') && hubState.version.includes('v'));
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
    check('hub 切换到数据分析（iframe 渲染 dashboard）',
      hubDash.src.includes('dashboard/dashboard.html') && hubDash.title.includes('数据分析') && hubDash.hasStats && hubDash.hasTrend);
    // 切换：限免游戏
    await hub.evaluate(() => document.querySelector('.hub-item[data-page="freegames"]').click());
    await hub.waitForTimeout(1500);
    const hubFree = await hub.evaluate(() => document.getElementById('hubFrame').src);
    check('hub 切换到限免游戏', hubFree.includes('freegames/freegames.html'));
    check('hub 无 console error', hubErrors.length === 0, `(${hubErrors.slice(0, 3).join(' | ')})`);
    await hub.close();

    // 3. 内容脚本注入 fixture 页。v3.3.15：状态/诊断浮窗默认禁用——先验证
    //    默认不渲染，再通过 popup 开启后验证渲染与列表页流程
    console.log('3. 内容脚本注入（默认禁用状态浮窗，v3.3.15）');
    const page2 = await context.newPage();
    const errors2 = [];
    page2.on('console', (msg) => {
      if (msg.type() === 'error') errors2.push(msg.text());
    });
    page2.on('pageerror', (e) => errors2.push(String(e)));
    await page2.goto(FIXTURE_URL);
    await page2.waitForTimeout(1500);
    const domInfo = await page2.evaluate(() => ({
      hasStatusBar: !!document.getElementById('gr-status-bar'),
      badgeCount: document.querySelectorAll('.gr-rating-badge').length
    }));
    check('状态浮窗默认禁用（不渲染）', !domInfo.hasStatusBar);
    check('无 console error', errors2.length === 0, `(${errors2.slice(0, 3).join(' | ')})`);
    await page2.close();

    // 3b. 通过 popup 开启状态浮窗后重新验证
    console.log('3b. 开启状态浮窗后内容脚本注入');
    const popup2 = await context.newPage();
    await popup2.goto(`chrome-extension://${extId}/popup/popup.html`);
    await popup2.waitForTimeout(500);
    await popup2.evaluate(async () => {
      const s = (await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' })).settings;
      s.showStatusBar = true;
      await chrome.runtime.sendMessage({ action: 'SAVE_SETTINGS', settings: s });
    });
    await popup2.close();
    const page2b = await context.newPage();
    const errors2b = [];
    page2b.on('console', (msg) => {
      if (msg.type() === 'error') errors2b.push(msg.text());
    });
    page2b.on('pageerror', (e) => errors2b.push(String(e)));
    await page2b.goto(FIXTURE_URL);
    await page2b.waitForTimeout(1500);
    const domInfo2 = await page2b.evaluate(() => ({
      hasStatusBar: !!document.getElementById('gr-status-bar'),
      badgeCount: document.querySelectorAll('.gr-rating-badge').length
    }));
    check('开启后状态浮窗渲染', domInfo2.hasStatusBar);
    // v3.4.1：原先 `badgeCount >= 0` 恒真属空断言。改轮询等待真实徽章出现：
    // 成功/未找到均渲染徽章，网络失败不阻塞（不依赖 Steam 可用性）
    let badgeCount = domInfo2.badgeCount;
    for (let i = 0; i < 60 && badgeCount === 0; i++) {
      await new Promise((r) => setTimeout(r, 500));
      badgeCount = await page2b.evaluate(() => document.querySelectorAll('.gr-rating-badge').length);
    }
    check('列表页好评率流程已启动（徽章渲染）', badgeCount > 0, `(徽章 ${badgeCount} 个)`);
    check('无 console error', errors2b.length === 0, `(${errors2b.slice(0, 3).join(' | ')})`);
    await page2b.close();

    // 4. 详情页报错按钮（v3.3.11：真实点击 → 清缓存重检索）
    // v5.1.0：E2E_FAST 离线模式跳过本段（依赖真实 Steam 网络）
    console.log(FAST ? '4. 详情页报错按钮（E2E_FAST 离线跳过）' : '4. 详情页报错按钮（真实点击）');
    const page3 = await context.newPage();
    const errors3 = [];
    page3.on('console', (msg) => {
      if (msg.type() === 'error') errors3.push(msg.text());
    });
    page3.on('pageerror', (e) => errors3.push(String(e)));
    if (FAST) {
      check('E2E_FAST 离线模式跳过真实网络段', true);
      await page3.close();
      return;
    }
    await page3.goto(`${FIXTURE_URL}16598.html`);
    // 等浮窗渲染（真实 Steam 搜索 + 完整详情拉取需数秒）
    await page3.waitForSelector('#gr-report-issue-btn', { timeout: 20000 }).catch(() => {});
    const hasReportBtn = await page3.evaluate(() => !!document.querySelector('#gr-report-issue-btn'));
    check('浮窗报错按钮存在', hasReportBtn);
    // v3.3.14：主内容区图（1213700）应优先于侧边推荐图（2001760）
    const shownText = await page3.evaluate(
      () => (document.querySelector('#gr-steam-float') || { textContent: '' }).textContent || ''
    );
    check(
      '浮窗显示主内容区游戏（非侧边推荐）',
      (shownText.includes('1213700') || shownText.includes('Spirit of the North')) && !shownText.includes('2001760'),
      `(${shownText.substring(0, 50).replace(/\n/g, ' ')})`
    );
    if (hasReportBtn) {
      // force: 状态浮窗（右下）可能遮挡按钮区域，强制点击（真实场景两区域不重叠）
      await page3.click('#gr-report-issue-btn', { force: true });
      // 清缓存 + 重新检索：同 appid → 自动手动选择；不同 appid → 渲染纠正结果
      await page3
        .waitForFunction(
          () => {
            const btn = document.querySelector('#gr-report-issue-btn');
            return !btn || !btn.textContent.includes('重新检索中');
          },
          null,
          { timeout: 30000 }
        )
        .catch(() => {});
    }
    const manualShown = await page3.evaluate(() => !!document.querySelector('#gr-manual-search-input'));
    const panelText = await page3.evaluate(
      () => (document.querySelector('#gr-steam-float') || { textContent: '' }).textContent || ''
    );
    // 正确行为二选一：同 appid 自动进入手动选择；或重检索纠正为新结果
    const resorted = panelText.includes('手动选择游戏') || /App ID|好评率|Steam 总体/.test(panelText);
    check(
      '报错重检索流程完成（手动选择或纠正渲染）',
      manualShown || resorted,
      `(手动选择=${manualShown} | 内容=${panelText.substring(0, 40).replace(/\n/g, ' ')})`
    );
    check('报错流程无 console error', errors3.length === 0, `(${errors3.slice(0, 3).join(' | ')})`);
    await page3.close();

    // 5. 滚动批次 + dashboard 趋势图（v4.1.0）
    console.log('5. 滚动批次与 dashboard 趋势图');
    // 5a. 滚动批次：130 项大列表 → 滚动底部触发 IO 哨兵 → 第二批徽章
    const page4 = await context.newPage();
    await page4.goto(`${FIXTURE_URL}?scroll=1`);
    await page4.waitForTimeout(1200); // 首屏批（60 项）发起
    const badgesBefore = await page4.evaluate(() => document.querySelectorAll('.gr-rating-badge').length);
    await page4.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    let badgesAfter = badgesBefore;
    for (let i = 0; i < 40 && badgesAfter <= badgesBefore; i++) {
      await new Promise((r) => setTimeout(r, 500));
      badgesAfter = await page4.evaluate(() => document.querySelectorAll('.gr-rating-badge').length);
    }
    check('滚动触发第二批徽章（按需扫描）', badgesAfter > badgesBefore, `(${badgesBefore} → ${badgesAfter})`);
    await page4.close();

    // 5b. dashboard 趋势图（第 4 节详情页访问已产生当天 view_detail）
    const dash = await context.newPage();
    await dash.goto(`chrome-extension://${extId}/dashboard/dashboard.html`);
    await dash.waitForTimeout(800);
    const trendInfo = await dash.evaluate(() => ({
      svgCount: document.querySelectorAll('#trendChart svg').length,
      stats: (document.getElementById('trendStats') || { textContent: '' }).textContent
    }));
    check('dashboard 趋势图 SVG 渲染', trendInfo.svgCount > 0);
    check('趋势统计显示浏览数据', /浏览/.test(trendInfo.stats), `(${trendInfo.stats})`);
    await dash.close();
  }
}
