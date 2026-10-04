/**
 * 游戏雷达 Game Radar - SidePanel tab 游戏快照单测
 *
 * v14.1.0：noteTabGame 记录/LRU 淘汰/无 tabId 忽略 + getTabGame 读取 +
 * 契约对称性（三个新 action 均有 handler 与规则）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';

const storage = createStorageMock();
installChromeStorageMock(storage);

const tabGame = await import(new URL('../../background/core/tab-game.js', import.meta.url).href + '?t=' + Date.now());

beforeAll(async () => {
  await tabGame.warmupTabGames();
});

describe('noteTabGame / getTabGame（SidePanel 当前页联动）', () => {
  it('记录并读取：字段归一化（appId 字符串化、未提供字段置空）', () => {
    tabGame.noteTabGame(42, {
      appId: 12345,
      name: 'Test Game',
      positiveRate: 88,
      headerImage: 'https://img',
      url: 'https://store'
    });
    const g = tabGame.getTabGame(42);
    expect(g).not.toBeNull();
    expect(g.appId).toEqual('12345');
    expect(g.name).toEqual('Test Game');
    expect(g.positiveRate).toEqual(88);
  });

  it('无效 tabId / 无 appId：忽略不记录', () => {
    tabGame.noteTabGame(undefined, { appId: '1' });
    tabGame.noteTabGame(-1, { appId: '2' });
    tabGame.noteTabGame(7, null);
    tabGame.noteTabGame(7, { name: 'no id' });
    expect(tabGame.getTabGame(7)).toBeNull();
  });

  it('容量上限 24：超出时按时间淘汰最旧', () => {
    for (let i = 0; i < 30; i++) {
      tabGame.noteTabGame(1000 + i, { appId: String(9000 + i), name: 'g' + i });
    }
    expect(tabGame.getTabGame(1029)).not.toBeNull(); // 最新保留
    expect(tabGame.getTabGame(1005)).toBeNull(); // 最早被淘汰
    expect(tabGame.getTabGame(1023)).not.toBeNull(); // 较新的保留
  });

  it('GET_TAB_GAME 契约校验：非整数/负数 tabId 拒绝', async () => {
    const contract = await import(
      new URL('../../background/core/message-contract.js', import.meta.url).href + '?t=' + Date.now()
    );
    expect(contract.validateMessage('GET_TAB_GAME', { tabId: 3 }).ok).toEqual(true);
    expect(contract.validateMessage('GET_TAB_GAME', { tabId: -1 }).ok).toEqual(false);
    expect(contract.validateMessage('GET_TAB_GAME', { tabId: 1.5 }).ok).toEqual(false);
    expect(contract.validateMessage('GET_TAB_GAME', {}).ok).toEqual(false);
    expect(contract.validateMessage('GET_FAVORITE_PRICES', {}).ok).toEqual(true);
    expect(contract.validateMessage('GET_DEFAULT_SETTINGS', {}).ok).toEqual(true);
  });
});
