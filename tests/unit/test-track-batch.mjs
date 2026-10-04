/**
 * 游戏雷达 Game Radar - TRACK_EVENT_BATCH 批量追踪管线单测
 *
 * v14.1.0 回归补齐：批量事件逐条走与单发相同的管线（单条失败不丢整批）、
 * applied 计数正确、click_download 的 AppID 维度下载计数站点去重键。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../background/storage/behavior.js', () => ({
  addBehaviorLog: vi.fn(),
  updateGameProfile: vi.fn(),
  maybeUpdatePreferences: vi.fn()
}));
vi.mock('../../background/storage/app-stats.js', () => ({
  recordAppDownload: vi.fn()
}));
vi.mock('../../background/storage/history.js', () => ({
  inferSiteFromDomain: vi.fn(() => ({ key: 'testsite', name: 'TestSite' })),
  recordDownloadHistory: vi.fn()
}));
vi.mock('../../background/storage/logger.js', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import { handleTrackEvent, handleTrackEventBatch } from '../../background/handlers/track-event.js';
import { addBehaviorLog, updateGameProfile } from '../../background/storage/behavior.js';
import { recordAppDownload } from '../../background/storage/app-stats.js';
import { recordDownloadHistory } from '../../background/storage/history.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleTrackEventBatch（批量追踪）', () => {
  it('批量事件逐条应用：applied 计数与单发管线一致', async () => {
    const events = [
      { type: 'view_detail', gameName: 'Game A' },
      { type: 'view_detail', gameName: 'Game B' },
      { type: 'dislike_game', gameName: 'Game C' }
    ];
    const resp = await handleTrackEventBatch({ events });
    expect(resp).toEqual({ success: true, applied: 3 });
    expect(addBehaviorLog).toHaveBeenCalledTimes(3);
    expect(updateGameProfile).toHaveBeenCalledWith({ name: 'Game C', event: 'dislike', keywords: undefined });
  });

  it('单条失败不丢整批：失败项跳过、其余照常应用', async () => {
    vi.mocked(addBehaviorLog)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('storage busy'))
      .mockResolvedValueOnce(undefined);
    const resp = await handleTrackEventBatch({
      events: [
        { type: 'view_detail', gameName: 'A' },
        { type: 'view_detail', gameName: 'B' },
        { type: 'view_detail', gameName: 'C' }
      ]
    });
    expect(resp).toEqual({ success: true, applied: 2 });
  });

  it('events 非数组：applied 0 且成功返回（不抛错）', async () => {
    expect(await handleTrackEventBatch({})).toEqual({ success: true, applied: 0 });
    expect(await handleTrackEventBatch({ events: 'x' })).toEqual({ success: true, applied: 0 });
    expect(await handleTrackEventBatch(null)).toEqual({ success: true, applied: 0 });
  });

  it('click_download 带 appId：按站点去重键计入下载计数并写历史', async () => {
    await handleTrackEvent({
      data: { type: 'click_download', gameName: 'Game X', appId: '123', domain: 'www.test.com', method: 'pan' }
    });
    expect(recordAppDownload).toHaveBeenCalledWith('123', 'testsite');
    expect(recordDownloadHistory).toHaveBeenCalledTimes(1);
    expect(updateGameProfile).toHaveBeenCalledWith(expect.objectContaining({ name: 'Game X', event: 'download' }));
  });

  it('click_download 无 appId：不计入下载计数（无法关联）', async () => {
    await handleTrackEvent({ data: { type: 'click_download', gameName: 'Game Y', domain: 'www.test.com' } });
    expect(recordAppDownload).not.toHaveBeenCalled();
    expect(recordDownloadHistory).toHaveBeenCalledTimes(1);
  });
});
