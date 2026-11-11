import { test, expect, describe, beforeEach } from 'vitest';
/**
 * 游戏雷达 Game Radar - 测试：运行期诊断轨迹（v14.28.9 L4）
 *
 * 覆盖：环形缓冲（>500 丢最旧）/ 白名单键守卫（url/name/appId 必须被拒或剔除）/
 * classifyTrace 四类场景（stall/network/notfound/ok）/ 录制夹具回放 +
 * 夹具保鲜（schemaVersion 必须等于当前 SCHEMA_VERSION，否则红）。
 * Runtime diagnostic trace: ring rotation, whitelist key guard, classification
 * scenarios, recorded-fixture replay gated by schemaVersion freshness.
 */
('use strict');

import fs from 'node:fs';
import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';

const storage = createStorageMock();
installChromeStorageMock(storage);

const diag = await import(new URL('../../background/storage/diag-trace.js', import.meta.url).href + '?t=' + Date.now());
const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/diag-trace-network.json', import.meta.url), 'utf8'));

beforeEach(() => {
  storage._reset();
  diag.resetDiagTrace();
});

describe('环形缓冲与白名单', () => {
  test('>500 条丢最旧（保留 seq 6..505）', async () => {
    for (let i = 0; i < 505; i++) diag.recordTrace({ stage: 'cache', event: 'miss', cacheLayer: 'miss' });
    await diag.flushDiagTrace();
    const trace = await diag.getTrace();
    expect(trace.events.length).toEqual(diag.MAX_EVENTS);
    expect(trace.events[0].seq).toEqual(6);
    expect(trace.events[trace.events.length - 1].seq).toEqual(505);
  });

  test('白名单键守卫：url/name/appId 等非白名单字段被 assert 拒绝', () => {
    expect(() => diag.assertAllowedKeys({ stage: 'search', event: 'enter', url: 'https://x/y?q=1' })).toThrow();
    expect(() => diag.assertAllowedKeys({ stage: 'search', event: 'enter', name: '游戏名' })).toThrow();
    expect(() => diag.assertAllowedKeys({ stage: 'search', event: 'enter', appId: '570' })).toThrow();
    expect(diag.assertAllowedKeys({ stage: 'search', event: 'enter', gameKey: 'abc123' })).toEqual(true);
  });

  test('运行时写入剔除未知键（url/name/appId 不落盘）', async () => {
    diag.recordTrace({
      stage: 'search',
      event: 'enter',
      url: 'https://store.steampowered.com/app/570/?l=schinese',
      name: 'Dota 2',
      appId: '570',
      host: 'store.steampowered.com/path?q=1',
      gameKey: diag.gameKeyOf('Dota 2')
    });
    await diag.flushDiagTrace();
    const ev = (await diag.getTrace()).events[0];
    expect(ev.url).toBeUndefined();
    expect(ev.name).toBeUndefined();
    expect(ev.appId).toBeUndefined();
    expect(ev.host).toEqual('store.steampowered.com'); // 仅 hostname
    expect(ev.gameKey.length).toEqual(6);
    expect(typeof ev.swWakeId).toEqual('number');
  });

  test('落盘往返 + clearTrace 清空', async () => {
    diag.recordTrace({ stage: 'boot', event: 'exit', durMs: 42 });
    await diag.flushDiagTrace();
    diag.resetDiagTrace(); // 丢内存态，验证从存储读回
    const loaded = await diag.getTrace();
    expect(loaded.schemaVersion).toEqual(diag.SCHEMA_VERSION);
    expect(loaded.events.length).toEqual(1);
    await diag.clearTrace();
    expect((await diag.getTrace()).events.length).toEqual(0);
  });
});

describe('classifyTrace 四类场景', () => {
  test('stall：有 enter 无 exit 且无故障类别 → stalled', () => {
    const v = diag.classifyTrace(
      [
        { seq: 1, t: 1000, stage: 'ratings', event: 'enter' },
        { seq: 2, t: 5000, stage: 'ratings', event: 'stall', durMs: 4000 }
      ],
      6000
    );
    expect(v.verdict).toEqual('stalled');
    expect(v.stuckStage).toEqual('ratings');
    expect(v.stuckDurMs).toEqual(5000);
  });

  test('network：网络失败未关闭 search → verdict=network，卡点 search', () => {
    const v = diag.classifyTrace([
      { seq: 1, t: 1000, stage: 'search', event: 'enter' },
      { seq: 2, t: 1400, stage: 'search', event: 'fail', failKind: 'network', durMs: 400 }
    ]);
    expect(v.verdict).toEqual('network');
    expect(v.stuckStage).toEqual('search');
    expect(v.lastFailKind).toEqual('network');
    expect(v.stuckDurMs).toEqual(400);
  });

  test('notfound：确定性未找到已 exit → verdict=notfound，无卡点', () => {
    const v = diag.classifyTrace([
      { seq: 1, t: 1000, stage: 'search', event: 'enter' },
      { seq: 2, t: 1200, stage: 'search', event: 'fail', failKind: 'notfound' },
      { seq: 3, t: 1200, stage: 'search', event: 'exit' }
    ]);
    expect(v.verdict).toEqual('notfound');
    expect(v.stuckStage).toEqual(null);
    expect(v.lastFailKind).toEqual('notfound');
  });

  test('ok：全部 enter 均 exit，缓存层与波次 counts 可读', () => {
    const v = diag.classifyTrace([
      { seq: 1, t: 1000, stage: 'cache', event: 'hit', cacheLayer: 'memory' },
      { seq: 2, t: 1000, stage: 'ratings', event: 'enter', counts: { total: 10, done: 0, failed: 0 } },
      { seq: 3, t: 1300, stage: 'ratings', event: 'push', counts: { total: 10, done: 10, failed: 0 } },
      { seq: 4, t: 1400, stage: 'ratings', event: 'exit', counts: { total: 10, done: 10, failed: 0 } }
    ]);
    expect(v.verdict).toEqual('ok');
    expect(v.stuckStage).toEqual(null);
    expect(v.cacheLayer).toEqual('memory');
    expect(v.counts).toEqual({ total: 10, done: 10, failed: 0 });
    expect(v.summary).toContain('verdict=ok');
  });
});

describe('录制夹具回放（保鲜）', () => {
  test('夹具 schemaVersion 等于当前 SCHEMA_VERSION（否则录制过期即红）', () => {
    expect(fixture.schemaVersion).toEqual(diag.SCHEMA_VERSION);
  });

  test('夹具非空且含 failKind=network', () => {
    expect(Array.isArray(fixture.events) && fixture.events.length > 0).toEqual(true);
    expect(fixture.events.some((e) => e.failKind === 'network')).toEqual(true);
  });

  test('回放：判定 verdict=network 且卡点 stage=search', () => {
    const v = diag.classifyTrace(fixture.events);
    expect(v.verdict).toEqual('network');
    expect(v.stuckStage).toEqual('search');
    expect(v.lastFailKind).toEqual('network');
  });
});
