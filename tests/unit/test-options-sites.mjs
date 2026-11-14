/**
 * 游戏雷达 Game Radar - 测试：自定义站点按域授权 / Per-site Permission (P2-5)
 *
 * v14.27.0（优化方案 P2-5）：自定义站点添加流程改为"只申请用户实填的域"，
 * 拒绝时降级（站点保留但不生效）。本套件用最小 Fake DOM 驱动 panels/sites.js
 * 的点击处理器，断言 permissions.request 的 origins 与降级提示。
 * Drives the add-site click handler with a minimal fake DOM and asserts the
 * requested origins plus the denial degradation path.
 */

import { test, expect } from 'vitest';

const els = {
  addSite: { addEventListener: (_t, fn) => (els.addSite.onClick = fn) },
  newSite: { value: '', addEventListener: () => {} }
};
const alerts = [];
const calls = [];
let grantNext = true;

globalThis.document = { getElementById: (id) => els[id] || null };
globalThis.window = { alert: (msg) => alerts.push(msg) };
globalThis.chrome = {
  permissions: {
    request: (opts) => {
      calls.push(opts);
      return Promise.resolve(grantNext);
    }
  }
};
const OPTS = (globalThis.__OPTS__ = {
  currentSettings: { trackedSites: [] },
  renderSiteManagement: () => {},
  scheduleAutoSave: () => {}
});

await import(new URL('../../options/panels/sites.js', import.meta.url).href + '?t=' + Date.now());
OPTS.bindSiteManagement();

/** 点击"添加站点"并等待权限申请 Promise 链落定 */
async function addSite(value, granted = true) {
  grantNext = granted;
  els.newSite.value = value;
  els.addSite.onClick();
  await new Promise((r) => setTimeout(r, 0));
}

function reset() {
  alerts.length = 0;
  calls.length = 0;
  OPTS.currentSettings.trackedSites = [];
}

test('裸域名：只申请该域的 http/https 两个 origin', async () => {
  reset();
  await addSite('Example.com');
  expect(JSON.stringify(calls)).toEqual(
    JSON.stringify([{ origins: ['http://example.com/*', 'https://example.com/*'] }])
  );
  expect(OPTS.currentSettings.trackedSites).toEqual(['example.com']);
  expect(alerts.length).toEqual(0);
});

test('显式 https：只申请 https 该域', async () => {
  reset();
  await addSite('https://example.com/some/path');
  expect(JSON.stringify(calls)).toEqual(JSON.stringify([{ origins: ['https://example.com/*'] }]));
});

test('拒绝授权：站点保留并提示降级（不抛错）', async () => {
  reset();
  await addSite('example.org', false);
  expect(OPTS.currentSettings.trackedSites).toEqual(['example.org']);
  expect(alerts.length).toEqual(1);
  expect(alerts[0].includes('未授予 example.org')).toEqual(true);
});

test('带端口：拒绝申请（匹配模式覆盖全部端口，避免误解）', async () => {
  reset();
  await addSite('http://example.net:8080');
  expect(calls.length).toEqual(0);
  expect(OPTS.currentSettings.trackedSites).toEqual([]);
  expect(alerts[0].includes('端口')).toEqual(true);
});

test('非法输入（通配/路径）：不发权限申请', async () => {
  reset();
  await addSite('*.example.com');
  expect(calls.length).toEqual(0);
  expect(OPTS.currentSettings.trackedSites).toEqual([]);
  expect(alerts.length).toEqual(1);
});
