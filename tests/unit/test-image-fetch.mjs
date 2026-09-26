/**
 * 游戏雷达 Game Radar - handlers/image-fetch 单测
 *
 * v10.8 缺口4：二维码跨域代取图（v10.5.4 引入、v10.7.1 修复契约正则后唯一
 * 零覆盖业务模块）。直测 handler：https 校验/大小上限/content-type/异常降级。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchWithTimeout = vi.fn();
vi.mock('../../background/core/utils.js', () => ({ fetchWithTimeout: (...a) => fetchWithTimeout(...a) }));
const getSettings = vi.fn();
vi.mock('../../background/core/settings.js', () => ({ getSettings: (...a) => getSettings(...a) }));

const { handleFetchImageDataUrl } = await import('../../background/handlers/image-fetch.js');

function fakeResp(status, contentType, bytes) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => contentType },
    arrayBuffer: async () => new ArrayBuffer(bytes)
  };
}

describe('image-fetch handler（二维码跨域代取图）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettings.mockResolvedValue({ qrImageMaxKb: 3072 });
  });

  it('https 图片 → 成功返回 dataURL（含路径 URL——P1 修复后的真实形态）', async () => {
    fetchWithTimeout.mockResolvedValue(fakeResp(200, 'image/png', 1024));
    const r = await handleFetchImageDataUrl({ url: 'https://img.example.com/uploads/qr-code.png' });
    expect(r.success).toEqual(true);
    expect(r.dataUrl.startsWith('data:image/png;base64,')).toEqual(true);
  });

  it('http URL 直接拒绝（不出网）', async () => {
    const r = await handleFetchImageDataUrl({ url: 'http://img.example.com/a.png' });
    expect(r.success).toEqual(false);
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('非 https 前缀（javascript: 等）拒绝', async () => {
    const r = await handleFetchImageDataUrl({ url: 'javascript:alert(1)' });
    expect(r.success).toEqual(false);
  });

  it('非 2xx → 携带状态码失败', async () => {
    fetchWithTimeout.mockResolvedValue(fakeResp(404, 'image/png', 10));
    const r = await handleFetchImageDataUrl({ url: 'https://x.com/a.png' });
    expect(r.success).toEqual(false);
    expect(r.error).toEqual('HTTP 404');
  });

  it('非 image/* content-type 拒绝', async () => {
    fetchWithTimeout.mockResolvedValue(fakeResp(200, 'text/html', 100));
    const r = await handleFetchImageDataUrl({ url: 'https://x.com/page' });
    expect(r.success).toEqual(false);
    expect(r.error).toEqual('非图片响应');
  });

  it('超默认上限（3072KB）拒绝', async () => {
    fetchWithTimeout.mockResolvedValue(fakeResp(200, 'image/png', 4 * 1024 * 1024));
    const r = await handleFetchImageDataUrl({ url: 'https://x.com/big.png' });
    expect(r.success).toEqual(false);
    expect(r.error).toEqual('图片超过大小上限');
  });

  it('maxKb 覆盖生效（预留参数纵深）', async () => {
    fetchWithTimeout.mockResolvedValue(fakeResp(200, 'image/png', 2048));
    const ok = await handleFetchImageDataUrl({ url: 'https://x.com/a.png', maxKb: 4 });
    expect(ok.success).toEqual(true);
    const fail = await handleFetchImageDataUrl({ url: 'https://x.com/a.png', maxKb: 1 });
    expect(fail.success).toEqual(false);
  });

  it('网络异常 → success:false 且不抛出', async () => {
    fetchWithTimeout.mockRejectedValue(new Error('timeout'));
    const r = await handleFetchImageDataUrl({ url: 'https://x.com/a.png' });
    expect(r.success).toEqual(false);
    expect(r.error).toContain('timeout');
  });
});
