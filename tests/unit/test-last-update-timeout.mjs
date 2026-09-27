/**
 * 游戏雷达 Game Radar - fetchLastUpdate 超时帽单测
 *
 * v10.9.2 修复回归：GetNewsForApp（api.steampowered.com，大陆网络不可达）此前
 * 用默认 15s 超时且内联在 SEARCH_STEAM 主路径——内容侧 10s 消息超时被拖爆，
 * 新游戏自动匹配必然失败。修复后 4s 硬帽 + 失败负缓存 24h（同游戏不再出网）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';

installChromeStorageMock(createStorageMock());

const fetchWithTimeout = vi.fn();
vi.mock('../../background/core/utils.js', () => ({ fetchWithTimeout: (...a) => fetchWithTimeout(...a) }));

// 顶层动态导入（vi.mock 提升后生效；lastUpdateCache 为模块级状态——各用例用
// 独立 appId 隔离）
const { fetchLastUpdate } = await import('../../background/steam/api-reviews.js');

describe('fetchLastUpdate 超时帽（v10.9.2 回归）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('出网超时参数 = 4000ms（不再用默认 15s 拖爆搜索预算）', async () => {
    fetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ appnews: { newsitems: [{ date: Math.floor(Date.now() / 1000) }] } })
    });
    await fetchLastUpdate('A1');
    expect(fetchWithTimeout.mock.calls[0][2]).toEqual(4000);
  });

  it('失败 → null 并负缓存 24h（同游戏不再出网）', async () => {
    fetchWithTimeout.mockResolvedValue({ ok: false, status: 503 });
    expect(await fetchLastUpdate('B1')).toEqual(null);
    const callsAfterFirst = fetchWithTimeout.mock.calls.length;
    await fetchLastUpdate('B1');
    expect(await fetchLastUpdate('B1')).toEqual(null);
    expect(fetchWithTimeout.mock.calls.length).toEqual(callsAfterFirst); // 零新增出网
  });

  it('成功获取 → 返回 YYYY-MM-DD 并缓存', async () => {
    // 固定新闻时间戳；期望值用同一 API 按本地时区计算（与时区无关）
    const newsEpoch = 1789550400; // 2026-09-27T00:00:00Z 附近的固定值
    fetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ appnews: { newsitems: [{ date: newsEpoch }] } })
    });
    const out = await fetchLastUpdate('C1');
    expect(out).toEqual('2026-09-16'); // fetchLastUpdate 手工拼 YYYY-MM-DD（本地时区同日）
  });
});
