import { test, expect } from 'vitest';
/**
 * 游戏雷达 Game Radar - 测试：下载站详情页元信息提取 / Detail-Meta Extraction
 *
 * v4.2.0：extractDetailMeta（更新日期/版本/大小/百度网盘链接与提取码），
 * 覆盖 sites/search.js 的 HTML 解析纯函数（fixture HTML 驱动）。
 */
'use strict';


const mod = await import(new URL('../../background/sites/search.js', import.meta.url).href + '?t=' + Date.now());
const { extractDetailMeta } = mod;

// 典型下载站详情页 HTML（gamer520 风格：h1 + 更新时间/版本/大小 + 百度网盘）
// 注：h1 不含版本号数字（真实页面 h1 常带版本，但版本区才是权威来源）
const FIXTURE_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>测试游戏|官方中文</title></head>
<body>
<h1 class="entry-title">测试游戏增强版|官方中文|解压即撸</h1>
<div class="info">
  更新时间：2026-08-10
  游戏版本：V1.2.3
  游戏大小：25.4GB
  下载地址：https://pan.baidu.com/s/1AbCdEfGhIjK
  提取码：abcd
</div>
</body></html>`;

console.log('1. 完整元信息提取');
const meta = extractDetailMeta(FIXTURE_HTML, 'gamer520');
test('更新日期', () => { expect(meta.updateDate).toEqual('2026-08-10'); });
test('版本号', () => { expect(meta.version).toEqual('V1.2.3'); });
test('大小', () => { expect(meta.size).toEqual('25.4GB'); });
test('百度网盘链接', () => { expect(meta.panUrl).toEqual('https://pan.baidu.com/s/1AbCdEfGhIjK'); });
test('提取码', () => { expect(meta.panCode).toEqual('abcd'); });

console.log('2. 边界与防御');
test('空 HTML 返回空元信息', () => { expect(JSON.stringify(extractDetailMeta('', 'gamer520'))).toEqual(JSON.stringify({ updateDate: '', version: '', size: '', panUrl: '', panCode: '' })); });
test('null HTML 返回空元信息', () => { expect(extractDetailMeta(null, 'gamer520').updateDate).toEqual(''); });
test('无网盘链接时 panUrl 为空', () => { expect(extractDetailMeta('<html><body>无内容</body></html>', 'gamer520').panUrl).toEqual(''); });
// 日期变体（斜杠分隔 + 全角冒号；版本标签支持"游戏版本/版本号"）
const variantHtml = '<html><body><h1>X</h1>更新时间：2026/08/01 游戏版本：1.0 大小：5.2 GB</body></html>';
const variant = extractDetailMeta(variantHtml, 'xdgame');
test('斜杠日期变体', () => { expect(variant.updateDate).toEqual('2026/08/01'); });
test('全角冒号版本变体', () => { expect(variant.version).toEqual('1.0'); });


// ============ 3. 搜索缓存（v6.4.3） ============
console.log('3. 下载站搜索缓存（24h TTL）');
import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';
import { createFetchMock, installFetchMock } from '../helpers/fetch-mock.mjs';

const sStorage = createStorageMock();
installChromeStorageMock(sStorage);

test('二次搜索命中缓存（无新增站点请求）', async () => {
  sStorage._reset();
  // 注入站点规则（getDownloadSites 回退源）
  globalThis.__GAME_RECOMMENDER_SITES__ = {
    version: 1,
    sites: [{ key: 'xdgame', name: 'XDGame', domains: ['xdgame.com'], base: 'https://xdgame.com', searchUrl: 'https://xdgame.com/so/{q}.html', detailUrlPatterns: ['/game/\d+\.html?$'], listItem: { containers: ['.game-list li'], titleLink: 'a.tit' } }]
  };
  const scMod = await import(new URL('../../background/storage/search-cache.js', import.meta.url).href);
  scMod.resetSearchCache();
  const fetchMock = createFetchMock({
    '/so/': '<html><a class="tit" href="/game/1.html">游戏A</a></html>'
  });
  const restoreFetch = installFetchMock(fetchMock);
  try {
    const first = await mod.searchDownloadSites('游戏A', '1', ['xdgame']);
    const calls1 = fetchMock._calls.length;
    expect(calls1).toBeGreaterThan(0);
    const second = await mod.searchDownloadSites('游戏A', '1', ['xdgame']);
    const calls2 = fetchMock._calls.length;
    expect(calls2 === calls1).toEqual(true); // 命中缓存无新请求
    expect(JSON.stringify(first)).toEqual(JSON.stringify(second));
  } finally {
    restoreFetch();
  }
});
test('siteKeys 变更 → 缓存失效重查', async () => {
  sStorage._reset();
  globalThis.__GAME_RECOMMENDER_SITES__ = {
    version: 1,
    sites: [{ key: 'xdgame', name: 'XDGame', domains: ['xdgame.com'], base: 'https://xdgame.com', searchUrl: 'https://xdgame.com/so/{q}.html', detailUrlPatterns: ['/game/\d+\.html?$'], listItem: { containers: ['.game-list li'], titleLink: 'a.tit' } }]
  };
  const scMod = await import(new URL('../../background/storage/search-cache.js', import.meta.url).href);
  scMod.resetSearchCache();
  const fetchMock = createFetchMock({
    '/so/': '<html><a class="tit" href="/game/1.html">游戏A</a></html>'
  });
  const restoreFetch = installFetchMock(fetchMock);
  try {
    await mod.searchDownloadSites('游戏A', '1', ['xdgame']);
    const calls1 = fetchMock._calls.length;
    await mod.searchDownloadSites('游戏A', '1', ['xdgame', 'gamer520']);
    const calls2 = fetchMock._calls.length;
    expect(calls2 > calls1).toEqual(true); // 站点集合变化 → 重新搜索
  } finally {
    restoreFetch();
  }
});
