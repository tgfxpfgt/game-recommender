/**
 * 游戏雷达 Game Radar - ITAD 收藏价格表单测（getFavoritePrices）
 *
 * v14.2.0（复审轮 P1-5 测试缺口）：无 Key 短路（configured:false 零请求）/
 * 价格归一（两位小数、非正值置 null）/ TTL 缓存复用（暖会话零请求）。
 * 注意：itad.js 的两处 TTL 缓存为模块级——各用例使用独立 appId 防缓存串扰。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../background/core/settings.js', () => ({
  getSettings: vi.fn()
}));
vi.mock('../../background/storage/favorites.js', () => ({
  getFavorites: vi.fn()
}));
vi.mock('../../background/core/utils.js', () => ({
  fetchWithTimeout: vi.fn()
}));
vi.mock('../../data/data-store.js', () => ({
  dataStore: { readModule: vi.fn(async () => ({})), writeModule: vi.fn(async () => {}) }
}));
vi.mock('../../background/storage/logger.js', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import { getFavoritePrices } from '../../background/freegames/itad.js';
import { getSettings } from '../../background/core/settings.js';
import { getFavorites } from '../../background/storage/favorites.js';
import { fetchWithTimeout } from '../../background/core/utils.js';

let appId = '100';

beforeEach(() => {
  vi.clearAllMocks();
  appId = String(100 + Math.floor(Math.random() * 1000)); // 每用例独立 appId（模块级 TTL 缓存隔离）
  vi.mocked(fetchWithTimeout).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      ['steam/' + appId]: {
        lowest: { price: 99.456, shop: { name: 'Steam' } },
        prices: [{ price: '59.4' }, { price: 70 }]
      }
    })
  });
  vi.mocked(getSettings).mockResolvedValue({ itadProfiles: [{ id: 'p1', key: 'k1' }], itadActiveProfileId: 'p1' });
  vi.mocked(getFavorites).mockResolvedValue({ [appId]: { name: 'CS2', addedAt: 1 } });
});

describe('getFavoritePrices（收藏价格表）', () => {
  it('无 ITAD Key：configured:false 且零网络请求', async () => {
    vi.mocked(getSettings).mockResolvedValue({ itadProfiles: [] });
    const r = await getFavoritePrices();
    expect(r).toEqual({ configured: false, prices: {} });
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('价格归一：current 取 prices 最小值并保留两位小数；lowest 同源', async () => {
    const r = await getFavoritePrices();
    expect(r.configured).toEqual(true);
    expect(r.prices[appId]).toEqual({ current: 59.4, lowest: 99.46, shop: 'Steam' });
  });

  it('响应异常形态：current/lowest 安全置 null（不抛错）', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ['steam/' + appId]: {} })
    });
    const r = await getFavoritePrices();
    expect(r.prices[appId]).toEqual({ current: null, lowest: null, shop: '' });
  });

  it('非 2xx：价格置 null（错误响应不产出数字）', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const r = await getFavoritePrices();
    expect(r.prices[appId]).toEqual({ current: null, lowest: null, shop: '' });
  });

  it('TTL 缓存复用：第二次调用零网络请求（暖会话语义）', async () => {
    await getFavoritePrices();
    const calls1 = vi.mocked(fetchWithTimeout).mock.calls.length;
    expect(calls1).toBeGreaterThan(0);
    await getFavoritePrices();
    expect(vi.mocked(fetchWithTimeout).mock.calls.length).toEqual(calls1);
  });

  it('收藏超上限 50：只取前 50 个 appId（防无界轮询）', async () => {
    const favs = {};
    for (let i = 0; i < 60; i++) favs[i] = { name: 'g' + i };
    vi.mocked(getFavorites).mockResolvedValue(favs);
    vi.mocked(fetchWithTimeout).mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const r = await getFavoritePrices();
    expect(Object.keys(r.prices).length).toEqual(50);
  });
});
