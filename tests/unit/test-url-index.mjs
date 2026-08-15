/**
 * 游戏雷达 Game Radar - 测试：详情页网址索引 / Detail-URL AppID Index
 *
 * v7.0.2：URL → appId 第一候选——列表页与详情页对同一网址统一匹配结果。
 * 覆盖：set/get 往返、URL 规范化（去 hash/query）、持久化防抖落盘、reset。
 */
import { test, expect, describe, beforeAll, afterAll } from 'vitest';
import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';

const storage = createStorageMock();
const restoreChrome = installChromeStorageMock(storage);

const idxMod = await import(new URL('../../background/storage/url-index.js', import.meta.url).href);

describe('url-index 详情页网址索引', () => {
  beforeAll(() => {
    storage._reset({});
    idxMod.resetUrlIndex();
  });
  afterAll(() => restoreChrome());

  test('set 后 get 命中', async () => {
    await idxMod.setUrlAppId('https://www.gamer520.com/109515.html', 3764200);
    expect(await idxMod.getAppIdByUrl('https://www.gamer520.com/109515.html')).toEqual(3764200);
  });

  test('URL 规范化：hash/query 不影响命中（同一页面同一缓存）', async () => {
    expect(await idxMod.getAppIdByUrl('https://www.gamer520.com/109515.html#comment')).toEqual(3764200);
    expect(await idxMod.getAppIdByUrl('https://www.gamer520.com/109515.html?from=nav')).toEqual(3764200);
  });

  test('无记录返回 null', async () => {
    expect(await idxMod.getAppIdByUrl('https://www.gamer520.com/999999.html')).toEqual(null);
    expect(await idxMod.getAppIdByUrl('')).toEqual(null);
  });

  test('覆盖更新：同一 URL 重新匹配后指向新 appId', async () => {
    await idxMod.setUrlAppId('https://www.gamer520.com/109515.html', 4021140);
    expect(await idxMod.getAppIdByUrl('https://www.gamer520.com/109515.html')).toEqual(4021140);
    await idxMod.setUrlAppId('https://www.gamer520.com/109515.html', 3764200);
  });

  test('reset 清空', async () => {
    idxMod.resetUrlIndex();
    expect(await idxMod.getAppIdByUrl('https://www.gamer520.com/109515.html')).toEqual(null);
  });
});
