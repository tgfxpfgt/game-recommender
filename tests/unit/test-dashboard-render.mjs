/**
 * 游戏雷达 Game Radar - Dashboard 渲染/导出 DOM 单测 / Dashboard render & export test
 *
 * v14.27.0（P2-4）：dashboard 为经典脚本（跨文件全局作用域），用 node:vm 共享
 * 沙箱装载 dash-logs.js + dash-export.js，覆盖日志渲染/级别统计/分页与 CSV、
 * JSON 导出路径。Classic scripts are loaded into one vm sandbox to exercise the
 * log renderer, pagination and the export helpers.
 */
import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { installFakeDom } from '../helpers/fake-dom.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dom = installFakeDom();

const messages = [];
const alerts = [];
/** @type {any[]} */
const blobs = [];
const renderCalls = [];
let failNext = false;
let confirmAnswer = true;
let revoked = 0;
/** @type {(msg: any) => any} */
let responder = () => ({});
/** @type {string} */
let clipboardText = '';
let clipboardFail = false;

const sandbox = {
  document: dom.document,
  escapeHtml: (t) =>
    String(t ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;'),
  safeDateText: () => 'TIME',
  /** @param {any[]} games */
  renderGameTable: (games) => renderCalls.push(['games', games]),
  cachedGames: [],
  cachedTrends: [],
  cachedGameList: [],
  navigator: {
    clipboard: {
      /** @param {string} text */
      writeText: async (text) => {
        clipboardText = text;
        if (clipboardFail) throw new Error('no-clipboard');
      }
    }
  },
  alert: (m) => alerts.push(m),
  confirm: () => confirmAnswer,
  setTimeout,
  clearTimeout,
  Blob: class FakeBlob {
    /** @param {any[]} parts @param {any} opts */
    constructor(parts, opts) {
      this.parts = parts;
      this.opts = opts;
      blobs.push(this);
    }
  },
  URL: {
    createObjectURL: () => 'blob:fake',
    revokeObjectURL: () => revoked++
  }
};
sandbox.window = {
  __GR_MSG__: {
    /** @param {any} msg */
    sendMessage: async (msg) => {
      messages.push(msg);
      if (failNext) throw new Error('boom');
      return responder(msg);
    },
    /** @param {any} e */
    toUserMessage: (e) => 'E:' + e.message
  }
};

const ctx = vm.createContext(sandbox);
/** @param {string} rel */
function load(rel) {
  const file = path.join(ROOT, rel);
  vm.runInContext(fs.readFileSync(file, 'utf-8'), ctx, { filename: file });
}
load('dashboard/dash-logs.js');
load('dashboard/dash-export.js');
load('dashboard/dash-diagnostics.js');

/** @param {any[]} logs */
const setLogs = (logs) => vm.runInContext(`cachedLogs = ${JSON.stringify(logs)}`, ctx);
const el = (id) => dom.getElementById(id);

test('renderRuntimeLogs：级别统计 + 转义 + 最新在前', () => {
  setLogs([
    { level: 'info', module: 'm1', message: 'ok', timestamp: 1 },
    { level: 'warn', module: 'm<i>', message: '<script>x</script>', timestamp: 2, data: 'd&d' },
    { level: 'error', module: 'm3', message: 'bad', timestamp: 3 }
  ]);
  el('logLevelFilter').value = 'all';
  ctx.renderRuntimeLogs();

  const html = el('runtimeLogList').innerHTML;
  expect(html).toContain('log-error');
  expect(html).toContain('[m&lt;i&gt;]');
  expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
  expect(html).not.toContain('<script>x</script>');
  expect(html).toContain('d&amp;d');
  expect(el('logLevelStats').textContent).toBe('info 1 · warn 1 · error 1 · debug 0');
  expect(html.indexOf('bad')).toBeLessThan(html.indexOf('ok'));
});

test('renderRuntimeLogs：级别筛选与空列表', () => {
  el('logLevelFilter').value = 'error';
  ctx.renderRuntimeLogs();
  const filtered = el('runtimeLogList').innerHTML;
  expect(filtered).toContain('bad');
  expect(filtered).not.toContain('ok');

  setLogs([]);
  el('logLevelFilter').value = 'all';
  ctx.renderRuntimeLogs();
  expect(el('runtimeLogList').innerHTML).toContain('暂无日志');
  expect(el('logPager').innerHTML).toBe('');
});

test('paginate：页大小/越界回夹/边界值', () => {
  const items = Array.from({ length: 120 }, (_, i) => i);
  vm.runInContext('PAGERS.logs.page = 1', ctx);
  let r = ctx.paginate('logs', items);
  expect(r.pages).toBe(3);
  expect(r.slice.length).toBe(50);
  expect([r.start, r.end]).toEqual([1, 50]);

  vm.runInContext('PAGERS.logs.page = 9', ctx);
  r = ctx.paginate('logs', items);
  expect(r.page).toBe(3); // 越界回夹到末页
  expect([r.start, r.end]).toEqual([101, 120]);

  vm.runInContext('PAGERS.logs.page = 1', ctx);
  expect(ctx.paginate('logs', []).pages).toBe(1);
});

test('renderPager：单页清空 / 多页含当前页与翻页按钮', () => {
  ctx.renderPager('logs', 'logPager', 0);
  expect(el('logPager').innerHTML).toBe('');

  ctx.renderPager('logs', 'logPager', 120);
  const html = el('logPager').innerHTML;
  expect(html).toContain('1-50 / 120 条');
  expect(html).toContain('class="gr-btn sm pager-btn active" data-key="logs" data-page="1"');
  expect(html).toContain('data-page="2"');
  expect(html).toContain('disabled');
});

test('分页事件委托：非法/禁用按钮忽略，合法按钮切换页并重渲染', () => {
  const click = dom.listeners.filter((l) => l.type === 'click').at(-1);
  expect(click).toBeTruthy();
  const evt = (btn) => ({ target: { closest: () => btn } });

  click.fn(evt({ disabled: true, dataset: { key: 'logs', page: '2' } }));
  click.fn(evt({ dataset: {} }));
  expect(vm.runInContext('PAGERS.logs.page', ctx)).toBe(1);

  setLogs(Array.from({ length: 120 }, (_, i) => ({ level: 'info', module: 'm', message: `m${i}` })));
  click.fn(evt({ dataset: { key: 'logs', page: '2' } }));
  expect(vm.runInContext('PAGERS.logs.page', ctx)).toBe(2);
  expect(el('logPager').innerHTML).toContain('51-100 / 120 条');

  renderCalls.length = 0;
  click.fn(evt({ dataset: { key: 'games', page: '1' } }));
  expect(renderCalls.map((c) => c[0])).toEqual(['games']);
  // audit 分支调用 dash-diagnostics 的真实渲染（同沙箱全局）
  click.fn(evt({ dataset: { key: 'audit', page: '1' } }));
  expect(el('auditList').innerHTML).toContain('暂无请求记录');
});

test('loadRuntimeLogs / exportLogs / clearLogs：成功与失败路径', async () => {
  responder = (msg) =>
    msg.action === 'GET_RUNTIME_LOGS' ? { logs: [{ level: 'info', module: 'm', message: 'hello' }] } : {};
  await ctx.loadRuntimeLogs();
  expect(el('runtimeLogList').innerHTML).toContain('hello');

  failNext = true;
  await ctx.loadRuntimeLogs();
  failNext = false;
  expect(el('runtimeLogList').innerHTML).toContain('加载日志失败: E:boom');

  responder = () => ({ logs: [{ a: 1 }] });
  const before = blobs.length;
  await ctx.exportLogs();
  expect(blobs.length).toBe(before + 1);
  const anchor = dom.created.at(-1);
  expect(String(anchor.download)).toContain('game-recommender-logs-');
  expect(anchor.href).toBe('blob:fake');
  expect(revoked).toBeGreaterThan(0);

  failNext = true;
  const alertBefore = alerts.length;
  await ctx.exportLogs();
  failNext = false;
  expect(alerts.at(-1)).toBe('导出失败: E:boom');
  expect(alerts.length).toBe(alertBefore + 1);

  confirmAnswer = false;
  const sentBefore = messages.length;
  await ctx.clearLogs();
  expect(messages.length).toBe(sentBefore);

  confirmAnswer = true;
  responder = () => ({ logs: [] });
  await ctx.clearLogs();
  expect(messages.at(-2).action).toBe('CLEAR_RUNTIME_LOGS');
  expect(messages.at(-1).action).toBe('GET_RUNTIME_LOGS');
});

test('toCsv：逗号/引号/换行/空值转义', () => {
  expect(
    ctx.toCsv(
      ['a', 'b'],
      [
        ['x,1', 'y"z'],
        [null, 'line\nbreak']
      ]
    )
  ).toBe('a,b\r\n"x,1","y""z"\r\n,"line\nbreak"');
});

test('exportTrendsCsv / exportGamesCsv：空数据提示与 CSV 内容', () => {
  sandbox.cachedTrends = [];
  ctx.exportTrendsCsv();
  expect(alerts.at(-1)).toBe('暂无趋势数据');

  sandbox.cachedTrends = [{ date: '2026-11-11', views: 3, downloads: 1, rate: 33 }];
  const before = blobs.length;
  ctx.exportTrendsCsv();
  expect(blobs.length).toBe(before + 1);
  const csv = String(blobs.at(-1).parts[0]);
  expect(csv.startsWith('\ufeff')).toBe(true);
  expect(csv).toContain('日期,浏览,下载,转化率%');
  expect(csv).toContain('2026-11-11,3,1,33');
  expect(String(dom.created.at(-1).download)).toContain('game-recommender-trends-');

  sandbox.cachedGameList = [];
  ctx.exportGamesCsv();
  expect(alerts.at(-1)).toBe('暂无游戏数据');

  sandbox.cachedGameList = [
    {
      name: 'Game, One',
      views: 2,
      downloads: 1,
      keywords: ['a', 'b'],
      steamAppId: 10,
      steamRating: 90,
      lastSeen: '2026'
    }
  ];
  ctx.exportGamesCsv();
  const gamesCsv = String(blobs.at(-1).parts[0]);
  expect(gamesCsv).toContain('"Game, One"');
  expect(gamesCsv).toContain('a; b');
});

test('exportLogsCsv：空日志提示 / 正常导出 / 失败提示', async () => {
  responder = () => ({ data: { modules: { behaviorLog: [] } } });
  await ctx.exportLogsCsv();
  expect(alerts.at(-1)).toBe('暂无行为日志');

  responder = () => ({
    data: {
      modules: {
        behaviorLog: [
          { timestamp: 1700000000000, type: 'click', gameName: 'G', method: 'badge', domain: 'd.com', url: 'u' }
        ]
      }
    }
  });
  const before = blobs.length;
  await ctx.exportLogsCsv();
  expect(blobs.length).toBe(before + 1);
  expect(String(blobs.at(-1).parts[0])).toContain('click,G,badge,d.com,u');

  failNext = true;
  await ctx.exportLogsCsv();
  failNext = false;
  expect(alerts.at(-1)).toBe('导出失败: E:boom');
});

test('exportInsightsJson：结构化 JSON 载荷与失败提示', async () => {
  responder = (msg) => {
    if (msg.action === 'GET_STATS') return { gameList: [{ name: 'G' }], topKeywords: ['k'] };
    if (msg.action === 'GET_FAVORITES') return { favorites: { 10: true } };
    return { daily: [{ date: '2026-11-11' }] };
  };
  const before = blobs.length;
  await ctx.exportInsightsJson();
  expect(blobs.length).toBe(before + 1);
  const blob = blobs.at(-1);
  expect(blob.opts.type).toBe('application/json');
  const payload = JSON.parse(String(blob.parts[0]));
  expect(payload.format).toBe('game-recommender-insights');
  expect(payload.gameList).toEqual([{ name: 'G' }]);
  expect(payload.favorites).toEqual({ 10: true });
  expect(payload.trends).toEqual([{ date: '2026-11-11' }]);

  failNext = true;
  await ctx.exportInsightsJson();
  failNext = false;
  expect(alerts.at(-1)).toBe('导出失败: E:boom');
});

// ============ 诊断模块 / Diagnostics (dash-diagnostics.js) ============
/** @param {any} audit */
const setAudit = (audit) => vm.runInContext(`cachedAudit = ${JSON.stringify(audit)}`, ctx);

test('renderOutboundAudit：统计/成功失败高亮/主机筛选/分页', () => {
  setAudit({
    stats: { total: 3, failed: 1, failRate: 33 },
    entries: [
      { t: 1, host: 'a.com', ok: true, status: 200, ms: 12 },
      { t: 2, host: 'b.com', ok: false, ms: 9 }
    ]
  });
  el('auditHostFilter').value = '';
  ctx.renderOutboundAudit();
  expect(el('auditStats').textContent).toBe('共 3 次 · 失败 1（33%）');
  const html = el('auditList').innerHTML;
  expect(html).toContain('[a.com]');
  expect(html).toContain('HTTP 200');
  expect(html).toContain('异常');
  expect(html).toContain('log-error');

  el('auditHostFilter').value = ' B.COM ';
  ctx.renderOutboundAudit();
  expect(el('auditList').innerHTML).not.toContain('a.com');
  expect(el('auditList').innerHTML).toContain('b.com');

  setAudit({ entries: [] });
  el('auditHostFilter').value = '';
  ctx.renderOutboundAudit();
  expect(el('auditList').innerHTML).toContain('暂无请求记录');
  el('auditHostFilter').value = 'x';
  ctx.renderOutboundAudit();
  expect(el('auditList').innerHTML).toContain('无匹配主机记录');
});

test('exportAuditCsv / loadOutboundAudit / clearAudit', async () => {
  setAudit({ entries: [] });
  el('auditHostFilter').value = '';
  ctx.exportAuditCsv();
  expect(alerts.at(-1)).toBe('暂无审计记录');

  setAudit({ entries: [{ t: 1700000000000, host: 'h.com', ok: false, ms: 7 }] });
  const before = blobs.length;
  ctx.exportAuditCsv();
  expect(blobs.length).toBe(before + 1);
  const csv = String(blobs.at(-1).parts[0]);
  expect(csv).toContain('时间,主机,成功,状态,耗时ms');
  expect(csv).toContain('h.com,否');

  responder = () => ({
    audit: {
      stats: { total: 1, failed: 0, failRate: 0 },
      entries: [{ t: 1, host: 'ok.com', ok: true, status: 200, ms: 3 }]
    }
  });
  await ctx.loadOutboundAudit();
  expect(el('auditList').innerHTML).toContain('ok.com');

  failNext = true;
  await ctx.loadOutboundAudit();
  failNext = false;
  expect(el('auditList').innerHTML).toContain('加载审计失败: E:boom');

  confirmAnswer = false;
  const sentBefore = messages.length;
  await ctx.clearAudit();
  expect(messages.length).toBe(sentBefore);

  confirmAnswer = true;
  responder = () => ({ audit: { entries: [] } });
  await ctx.clearAudit();
  expect(messages.at(-2).action).toBe('CLEAR_OUTBOUND_AUDIT');
  expect(messages.at(-1).action).toBe('GET_OUTBOUND_AUDIT');
});

test('loadHealthCards：OPFS 降级/写失败聚合/站点告警明细', async () => {
  responder = (msg) => {
    if (msg.action === 'GET_STORAGE_HEALTH') {
      return { opfsAvailable: true, steamCacheWriteFails: 1, registryWriteFails: 2, lastFailModule: 'steamCache' };
    }
    return {
      sites: [{ siteKey: '<s>', host: 'h.com', alertCount: 2, lastAlertAt: 1700000000000 }]
    };
  };
  await ctx.loadHealthCards();
  expect(el('diagOpfsMode').textContent).toBe('OPFS');
  expect(el('diagOpfsMode').title).toContain('每模块独立文件');
  expect(el('diagFlushFails').textContent).toBe('3');
  expect(el('diagFlushFails').title).toContain('steamCache');
  expect(el('diagSiteAlerts').textContent).toBe('2');
  expect(el('siteHealthList').style.display).toBe('block');
  expect(el('siteHealthList').innerHTML).toContain('&lt;s&gt;');

  responder = (msg) => (msg.action === 'GET_STORAGE_HEALTH' ? { opfsAvailable: false } : { sites: [] });
  await ctx.loadHealthCards();
  expect(el('diagOpfsMode').textContent).toBe('降级 local');
  expect(el('diagFlushFails').textContent).toBe('0');
  expect(el('siteHealthList').style.display).toBe('none');

  failNext = true;
  await ctx.loadHealthCards(); // 两个 catch 均静默
  failNext = false;
});

test('loadApiDiagnostics：正常/采样中/异常/缺响应/失败', async () => {
  responder = () => null;
  await ctx.loadApiDiagnostics();
  expect(el('diagApiStatus').textContent).toBe('—');

  responder = () => ({
    domains: { store: 'ok', api: 'down', circuit: 'open' },
    anomaly: true,
    total: 10,
    failed: 5,
    failRate: 50,
    windowSec: 600
  });
  await ctx.loadApiDiagnostics();
  expect(el('diagDomainStatus').textContent).toBe('商店 🟢 / API 🔴');
  expect(el('diagDomainStatus').title).toContain('熔断中');
  expect(el('diagApiStatus').textContent).toBe('⚠️ 异常（50%）');
  expect(el('diagApiStatus').style.color).toBe('#e5534b');

  responder = () => ({ domains: { store: 'unknown' }, total: 3, failed: 0, failRate: 0, windowSec: 60 });
  await ctx.loadApiDiagnostics();
  expect(el('diagApiStatus').textContent).toBe('采样中（3）');
  expect(el('diagDomainStatus').textContent).toBe('商店 ⚪ / API ⚪');

  responder = () => ({ total: 20, failed: 1, failRate: 5, windowSec: 60 });
  await ctx.loadApiDiagnostics();
  expect(el('diagApiStatus').textContent).toBe('✅ 正常（5%）');

  failNext = true;
  await ctx.loadApiDiagnostics();
  failNext = false;
  expect(el('diagApiStatus').textContent).toBe('—');
});

test('loadBootTime：Perf 条目解析/无样本/失败', async () => {
  responder = () => ({ logs: [{ module: 'Perf', message: 'boot 321ms', timestamp: 1 }] });
  await ctx.loadBootTime();
  expect(el('diagBootTime').textContent).toBe('321ms');

  responder = () => ({ logs: [{ module: 'Other', message: 'x' }] });
  await ctx.loadBootTime();
  expect(el('diagBootTime').textContent).toBe('—');

  failNext = true;
  await ctx.loadBootTime();
  failNext = false;
  expect(el('diagBootTime').textContent).toBe('—');
});

test('loadRuntimeMetrics：批次 P95/OPFS/消息/目录命中/启动失败高亮', async () => {
  responder = () => ({
    metrics: {
      hist: { 'batch.ms': { p95: 88, count: 10, avg: 40 } },
      counters: {
        'opfs.writeCount.a': 2,
        'opfs.writeCount.b': '3',
        'opfs.writeBytes.a': 1048576,
        'msg.SEARCH_STEAM': 5,
        'appListIndex.hit': 4,
        'appListIndex.fuzzy.hit': 1,
        'appListIndex.miss': 2,
        'boot.restore.fail': 1
      }
    }
  });
  await ctx.loadRuntimeMetrics();
  expect(el('diagBatchMs').textContent).toBe('88');
  expect(el('diagBatchMs').title).toContain('样本 10');
  expect(el('diagOpfsWrites').textContent).toBe('5');
  expect(el('diagOpfsWrites').title).toContain('1.00 MB');
  expect(el('diagMsgTotal').textContent).toBe('5');
  expect(el('diagAppListIndex').textContent).toBe('4/1/2');
  expect(el('diagBootFail').textContent).toBe('1/0/0');
  expect(el('diagBootFail').style.color).toBe('#e05c5c');

  responder = () => ({});
  await ctx.loadRuntimeMetrics();
  expect(el('diagBatchMs').textContent).toBe('—');
  expect(el('diagMsgTotal').textContent).toBe('—');

  failNext = true;
  await ctx.loadRuntimeMetrics();
  failNext = false;
  expect(el('diagBatchMs').textContent).toBe('—');
});

test('renderFreeGameMiss：计数/近期明细/缺响应', async () => {
  responder = () => null;
  await ctx.renderFreeGameMiss();
  expect(el('diagFreeGameMiss').textContent).toBe('—');

  responder = () => ({
    missedCount: 2,
    monitoredTotal: 5,
    missed: [{ name: 'G', platform: 'epic', originalPrice: '$9' }]
  });
  await ctx.renderFreeGameMiss();
  expect(el('diagFreeGameMiss').textContent).toBe('2/5');
  expect(el('diagFreeGameMiss').title).toContain('G（epic，$9）');

  responder = () => ({ missedCount: 0, monitoredTotal: 0, missed: [] });
  await ctx.renderFreeGameMiss();
  expect(el('diagFreeGameMiss').title).toBe('暂无错过记录');

  failNext = true;
  await ctx.renderFreeGameMiss();
  failNext = false;
  expect(el('diagFreeGameMiss').textContent).toBe('—');
});

test('renderMismatchSamples：样本计数/标题摘要/复制按钮（成功与失败）', async () => {
  const copyBtn = el('copyMismatchBtn');
  responder = () => ({ samples: [{ rawTitle: 'A' }, { rawTitle: 'B' }] });
  await ctx.renderMismatchSamples();
  expect(el('diagMismatchSamples').textContent).toBe('2');
  expect(el('diagMismatchSamples').title).toBe('A\nB');
  expect(copyBtn.dataset.bound).toBe('1');

  copyBtn.click(); // 绑定 1 次后不再重复绑定
  await new Promise((r) => setTimeout(r, 10));
  expect(clipboardText).toContain('"rawTitle": "A"');
  expect(copyBtn.textContent).toBe('✅ 已复制');

  clipboardFail = true;
  copyBtn.click();
  await new Promise((r) => setTimeout(r, 10));
  expect(copyBtn.textContent).toBe('❌ 复制失败');
  clipboardFail = false;

  responder = () => ({ samples: [] });
  await ctx.renderMismatchSamples();
  expect(el('diagMismatchSamples').title).toBe('暂无采集样本');

  failNext = true;
  await ctx.renderMismatchSamples();
  failNext = false;
  expect(el('diagMismatchSamples').textContent).toBe('—');
});
