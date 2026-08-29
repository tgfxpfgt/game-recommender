/**
 * 游戏雷达 Game Radar - 二维码转链接 / QR-to-Link Unlock
 *
 * v10.2.0（用户需求）：gamer520 等下载站以二维码图片形式提供网盘链接，
 * 手机才能扫——本模块自动解码页面上的二维码并把链接渲染到二维码旁
 * （可点击打开 + 一键复制），桌面端直接可用。
 * 通用设计：对所有已追踪下载站生效；只处理页面里的 img/canvas（≥60px，
 * 每个元素只试解一次）；解码出 http(s) 链接才展示（jsQR 对非二维码图
 * 返回 null，天然过滤）。jsQR 解码器（qrcode-reader，Apache-2.0）按需
 * 懒加载——不含二维码的页面零开销。
 * Auto-decodes QR images on download-site pages and renders the decoded
 * link next to the QR (clickable + copy button). Lazy-loads the decoder.
 */
import * as common from '../core/common.js';
import * as debug from '../core/debug.js';

const dbg = (...a) => debug.dbg(...a);

/** @type {Promise<any>|null} */
let decoderPromise = null;

// 懒加载解码器（首次遇到二维码候选时才拉取）/ lazy-load the decoder
function loadDecoder() {
  if (!decoderPromise) {
    decoderPromise = import(chrome.runtime.getURL('lib/vendor/qrcode-reader.js')).then((m) => m.default);
  }
  return decoderPromise;
}

/** @type {WeakSet} */
const processed = new WeakSet(); // 每个元素只试解一次 / one attempt per element
/** @type {MutationObserver|null} */
let observer = null;
/** @type {any} */
let QrCode = null;
/** @type {boolean} */
let decoderFailed = false;

// 解码一个 img/canvas（返回 http(s) 链接或 null）/ decode one element
async function decodeElement(el) {
  if (processed.has(el)) return null;
  processed.add(el);
  const w = el.naturalWidth || el.width || 0;
  const h = el.naturalHeight || el.height || 0;
  if (w < 60 || h < 60) return null; // 二维码最小尺寸过滤（图标/封面直接跳过）
  // 二维码近似方形——明显非方形（横幅封面/宽图）直接跳过，省解码开销
  const ratio = w / h;
  if (ratio < 0.65 || ratio > 1.55) return null;
  // 先懒加载解码器——加载失败（旧浏览器/资源缺失）才停用整个模块
  if (!QrCode) {
    try {
      QrCode = await loadDecoder();
    } catch (e) {
      dbg('二维码解码器不可用: ' + String(e));
      decoderFailed = true;
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      return null;
    }
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(el, 0, 0);
    const imageData = ctx.getImageData(0, 0, w, h);
    return await new Promise((resolve) => {
      try {
        const qr = new QrCode();
        qr.callback = (err, value) => {
          const text = !err && value && value.result ? String(value.result) : '';
          resolve(text);
        };
        qr.decode(imageData);
      } catch {
        resolve('');
      }
    });
  } catch {
    return null; // cross-origin 画布污染/解码失败 → 仅跳过该元素
  }
}

// 在二维码元素旁插入解码结果（链接可点 + 复制按钮）/ render decoded link row
function insertResult(el, url) {
  const host = el.parentNode;
  if (!host || host.querySelector('.gr-qr-result')) return;
  dbg(`二维码已解码: ${url}`);
  const row = document.createElement('div');
  row.className = 'gr-qr-result';

  const link = document.createElement('a');
  link.className = 'gr-qr-link';
  link.href = common.escapeAttr(url);
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = `🔗 二维码链接: ${url.length > 60 ? url.slice(0, 60) + '…' : url}`;
  link.title = '二维码解码结果（点击打开）';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'gr-qr-copy';
  copyBtn.textContent = '复制';
  copyBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      navigator.clipboard.writeText(url).then(() => {
        copyBtn.textContent = '✓ 已复制';
        setTimeout(() => {
          copyBtn.textContent = '复制';
        }, 1500);
      });
    } catch {
      copyBtn.textContent = '复制失败';
    }
  });

  row.appendChild(link);
  row.appendChild(copyBtn);
  // 二维码常包裹在容器里 → 插到最近的可定位父容器之后
  const anchor = el.closest('div, p, li, td') || el;
  if (anchor && anchor.parentNode) {
    anchor.parentNode.insertBefore(row, anchor.nextSibling);
  } else {
    host.insertBefore(row, el.nextSibling);
  }
}

// 批量处理候选元素里的二维码 / scan candidates for QR codes
let scanScheduled = false;
function scheduleScan(root) {
  if (scanScheduled || decoderFailed) return;
  scanScheduled = true;
  setTimeout(async () => {
    scanScheduled = false;
    const candidates = (root || document).querySelectorAll('img, canvas');
    for (const el of candidates) {
      if (processed.has(el)) continue;
      const text = await decodeElement(el);
      if (text && /^https?:\/\//i.test(text)) {
        insertResult(el, text);
      }
    }
  }, 200);
}

// 初始化（幂等；tracker init 调用；v10.3.0 支持独立开关）/ init (idempotent)
export function init(settings) {
  // v10.3.0：独立开关（settings.qrUnlockEnabled，默认开）——关闭早退，
  // 不注入观察器、不加载解码器，其他内容功能不受影响
  if (settings && settings.qrUnlockEnabled === false) return;
  if (observer || decoderFailed) return;
  try {
    // 初始扫描 + 惰性渲染监听（二维码多为 JS 动态插入）
    scheduleScan(document);
    observer = new MutationObserver((mutations = []) => {
      // v10.3.0：mutations 默认空数组——测试驱动器可能无参调用 cb()
      for (const m of mutations || []) {
        for (const node of m.addedNodes || []) {
          if (node.nodeType !== 1) continue;
          const el = /** @type {Element} */ (node);
          if (el.tagName === 'IMG' || el.tagName === 'CANVAS') scheduleScan(el.parentNode || document);
          else scheduleScan(el);
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    dbg('二维码解锁模块已激活');
  } catch (e) {
    dbg('二维码解锁模块初始化失败: ' + String(e));
    decoderFailed = true;
  }
}
