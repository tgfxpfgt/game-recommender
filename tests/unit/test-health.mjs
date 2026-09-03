import { test, expect, describe } from 'vitest';
/**
 * 游戏雷达 Game Radar - 测试：健康模块（v10.0.0）
 *
 * siteHealth（告警 upsert/上限淘汰/重置）与 flushHealth（写失败计数/重置）。
 * Site-health alerts (upsert/cap-evict/reset) and flush-health counters.
 */
('use strict');

import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';

const storage = createStorageMock();
installChromeStorageMock(storage);

const siteHealth = await import(
  new URL('../../background/storage/site-health.js', import.meta.url).href + '?t=' + Date.now()
);
const flushHealth = await import(
  new URL('../../background/storage/flush-health.js', import.meta.url).href + '?t=' + Date.now()
);

describe('siteHealth 站点适配器健康', () => {
  test('告警 upsert：累计次数 + 更新时间', async () => {
    storage._reset();
    siteHealth.resetSiteHealth();
    await siteHealth.recordSiteAlert('gamersky', 'www.gamersky.com');
    await siteHealth.recordSiteAlert('gamersky', 'www.gamersky.com');
    const health = await siteHealth.getSiteHealth();
    expect(health.total).toEqual(1);
    const s = health.sites.find((x) => x.siteKey === 'gamersky');
    expect(s && s.alertCount).toEqual(2);
    expect(s && s.host).toEqual('www.gamersky.com');
  });

  test('多站点按最近告警排序', async () => {
    storage._reset();
    siteHealth.resetSiteHealth();
    await siteHealth.recordSiteAlert('a1', 'a1.example.com');
    await new Promise((r) => setTimeout(r, 5));
    await siteHealth.recordSiteAlert('b2', 'b2.example.com');
    const health = await siteHealth.getSiteHealth();
    expect(health.sites[0].siteKey).toEqual('b2');
  });

  test('重置清空', async () => {
    siteHealth.resetSiteHealth();
    const health = await siteHealth.getSiteHealth();
    expect(health.total).toEqual(0);
  });
});

describe('flushHealth 存储健康', () => {
  test('写失败计数按模块累计', () => {
    flushHealth.resetFlushHealth();
    flushHealth.recordFlushFailure('steamCacheWriteFails');
    flushHealth.recordFlushFailure('steamCacheWriteFails');
    flushHealth.recordFlushFailure('registryWriteFails');
    const h = flushHealth.getFlushHealth();
    expect(h.steamCacheWriteFails).toEqual(2);
    expect(h.registryWriteFails).toEqual(1);
    expect(h.lastFailModule).toEqual('registryWriteFails');
  });

  test('未知模块键动态建键 + OPFS 态字段存在', () => {
    flushHealth.resetFlushHealth();
    flushHealth.recordFlushFailure('customModuleWriteFails');
    const h = flushHealth.getFlushHealth();
    expect(h.customModuleWriteFails).toEqual(1);
    expect(typeof h.opfsAvailable).toEqual('boolean');
  });

  test('重置归零', () => {
    flushHealth.resetFlushHealth();
    const h = flushHealth.getFlushHealth();
    expect(h.steamCacheWriteFails).toEqual(0);
    expect(h.lastFailModule).toEqual(null);
  });
});
