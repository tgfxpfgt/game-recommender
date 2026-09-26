/**
 * 游戏雷达 Game Radar - 消息处理：图片代取 / Image Fetch Handlers
 *
 * v10.7.0 批次5：由 handlers.js 迁出（内联业务归位 handlers/ 子目录）——
 * 二维码跨域取图（内容脚本 canvas 被跨域图片污染无法解码，后台代取并转
 * dataURL 回传）。仅接受 https 图片 URL，大小上限可配置，content-type 必须
 * image/*；fetchWithTimeout 内建 SSRF 校验。
 * Proxy image fetch for QR decoding (moved from handlers.js): https-only,
 * configurable size cap, image/* content-type enforced.
 */
import { fetchWithTimeout } from '../core/utils.js';
import { getSettings } from '../core/settings.js';

export async function handleFetchImageDataUrl(message) {
  const url = String((message && message.url) || '');
  if (!/^https:\/\//i.test(url)) return { success: false, error: '仅接受 https 图片 URL' };
  try {
    const resp = await fetchWithTimeout(url, {}, 15000);
    if (!resp.ok) return { success: false, error: 'HTTP ' + resp.status };
    const type = (resp.headers && resp.headers.get('content-type')) || 'image/png';
    if (!type.startsWith('image/')) return { success: false, error: '非图片响应' };
    const buf = await resp.arrayBuffer();
    // v10.7.0 批次5：上限可配置（settings.qrImageMaxKb，默认 3MB）
    const maxBytes =
      (typeof message.maxKb === 'number' && message.maxKb > 0
        ? message.maxKb
        : (await getSettings()).qrImageMaxKb || 3072) * 1024;
    if (buf.byteLength > maxBytes) return { success: false, error: '图片超过大小上限' };
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
    }
    return { success: true, dataUrl: 'data:' + type + ';base64,' + btoa(binary) };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
