/**
 * 游戏雷达 Game Radar - favorites/ratingFilterCfg handler 单测
 *
 * v10.9 补盲区（审计"三层全无"清单）：TOGGLE_FAVORITE/GET_FAVORITES 与
 * SAVE_RATING_FILTER_CFG（xdgrid 过滤滑块窄化持久化）此前无任何一层覆盖。
 */
import { describe, it, expect } from 'vitest';
import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';

const storage = createStorageMock();
installChromeStorageMock(storage);

const TS = Date.now();
const favsMod = await import(new URL('../../background/storage/favorites.js', import.meta.url).href + '?t=' + TS);
const setMod = await import(new URL('../../background/core/settings.js', import.meta.url).href + '?t=' + TS);

describe('favorites handler 语义（v10.9 补盲区）', () => {
  it('toggle 字符串/数字 appId 均规范化为字符串键', async () => {
    storage._reset();
    const r1 = await favsMod.toggleFavorite('12345', '游戏A');
    expect(r1.favorited).toEqual(true);
    const r2 = await favsMod.toggleFavorite(67890, '游戏B'); // 数字入参不崩
    expect(r2.favorited).toEqual(true);
    const all = await favsMod.getFavorites();
    expect(Object.keys(all).sort()).toEqual(['12345', '67890']);
    expect(all['12345'].name).toEqual('游戏A');
    expect(typeof all['12345'].addedAt).toEqual('number');
  });
  it('再 toggle 移除；空 appId 静默 no-op', async () => {
    storage._reset();
    await favsMod.toggleFavorite('111', 'X');
    const r = await favsMod.toggleFavorite('111', 'X');
    expect(r.favorited).toEqual(false);
    expect(await favsMod.getFavorites()).toEqual({});
    const noop = await favsMod.toggleFavorite('', 'Y');
    expect(noop.favorited).toEqual(false);
  });
});

describe('saveRatingFilterCfg（v10.9 窄化持久化）', () => {
  it('只落两个键、钳制越界值、保留其他设置', async () => {
    storage._reset({ settings: { enabled: true, maxScanLinks: 500, uiTheme: 'oled' } });
    const r = await setMod.saveRatingFilterCfg(true, 65);
    expect(r.success).toEqual(true);
    const s = storage._dump().settings;
    expect(s.enableRatingFilter).toEqual(true);
    expect(s.minSteamRatingFilter).toEqual(65);
    expect(s.maxScanLinks).toEqual(500); // 其他设置不丢
    expect(s.uiTheme).toEqual('oled');
    // 越界钳制
    await setMod.saveRatingFilterCfg(false, 250);
    const s2 = storage._dump().settings;
    expect(s2.minSteamRatingFilter).toEqual(100); // 100 上限钳制
    expect(s2.enableRatingFilter).toEqual(false);
  });
});
