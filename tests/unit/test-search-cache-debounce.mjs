/**
 * 游戏雷达 Game Radar - search-cache 防抖写穿单测
 *
 * v10.8 缺口7：v10.7.0 将 searchCache 落盘改为 1s 防抖写穿——本套件钉死
 * "防抖合并写"与"resetSearchCache 取消挂起写"两个行为。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const writeModule = vi.fn().mockResolvedValue(undefined);
vi.mock('../../data/data-store.js', () => ({
  dataStore: { readModule: vi.fn().mockResolvedValue(undefined), writeModule: (...a) => writeModule(...a) }
}));

async function freshSearchCache() {
  vi.resetModules();
  return await import('../../background/storage/search-cache.js');
}

describe('search-cache 防抖写穿（v10.8 缺口7）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('写入 → 1s 防抖后落盘一次（多次写合并）', async () => {
    const mod = await freshSearchCache();
    await mod.setSearchCache('游戏A', null, ['xianyudanji'], [{ url: 'u1' }]);
    await mod.setSearchCache('游戏B', null, ['xianyudanji'], [{ url: 'u2' }]);
    await vi.advanceTimersByTimeAsync(999);
    expect(writeModule).not.toHaveBeenCalled(); // 防抖窗口内不写
    await vi.advanceTimersByTimeAsync(50);
    expect(writeModule).toHaveBeenCalledTimes(1); // 合并为一次全量写
    const payload = writeModule.mock.calls[0][1];
    expect(Object.keys(payload).length).toEqual(2);
  });

  it('resetSearchCache 取消挂起写（不回写脏数据）', async () => {
    const mod = await freshSearchCache();
    await mod.setSearchCache('游戏A', null, ['xianyudanji'], [{ url: 'u1' }]);
    mod.resetSearchCache(); // 取消挂起的防抖写
    await vi.advanceTimersByTimeAsync(3000);
    expect(writeModule).not.toHaveBeenCalled();
  });
});
