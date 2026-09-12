/**
 * 游戏雷达 Game Radar - WebCrypto 加密工具 / WebCrypto Crypto Utilities
 *
 * v10.6.0 F5：离线备份加密——导出文件 AES-GCM 对称加密 + PBKDF2 口令派生。
 * 纯前端实现（零构建、无依赖），信封格式自描述（含算法参数），导入侧按
 * format 字段自动识别加密文件。口令不落盘、不传输，仅驻留内存。
 * Offline backup encryption (F5): AES-GCM payload + PBKDF2 passphrase
 * derivation, zero-dependency. Self-describing envelope (algorithm params
 * inline); import detects encrypted files by `format`. Passphrase never
 * persists — memory only.
 *
 * 信封格式 / Envelope:
 * {
 *   format: 'game-recommender-backup-encrypted',
 *   v: 1, cipher: 'AES-GCM', kdf: 'PBKDF2', hash: 'SHA-256',
 *   iterations, salt: b64, iv: b64, data: b64(ciphertext)
 * }
 */
(function (global) {
  'use strict';

  const ENVELOPE_FORMAT = 'game-recommender-backup-encrypted';
  const ITERATIONS = 150000; // OWASP 2023 建议 SHA-256 ≥ 60 万，取 15 万兼顾扩展页主线程耗时
  // OWASP 2023 suggests ≥600k for SHA-256; 150k keeps the options page snappy.

  /** @param {Uint8Array} bytes */
  function bytesToB64(bytes) {
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, /** @type {any} */ (Array.from(bytes.subarray(i, i + CHUNK))));
    }
    return btoa(bin);
  }

  /** @param {string} b64 */
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function subtle() {
    const c = global.crypto || global.msCrypto || null;
    if (!c || !c.subtle) throw new Error('当前环境不支持 WebCrypto（无法加密/解密）');
    return c.subtle;
  }

  // 口令 → AES-GCM 密钥（PBKDF2，随机盐）/ passphrase → AES-GCM key (PBKDF2, random salt)
  async function deriveKey(password, saltBytes, iterations) {
    const enc = new TextEncoder();
    const base = await subtle().importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey(
      { name: 'PBKDF2', salt: /** @type {any} */ (saltBytes), iterations, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * 加密任意可 JSON 序列化对象 → 加密信封 / Encrypt a JSON-serializable object.
   * @param {any} payload
   * @param {string} password
   * @returns {Promise<object>} 加密信封（含随机盐/IV）
   */
  async function encryptJson(payload, password) {
    if (!password || typeof password !== 'string') throw new Error('加密需要非空口令');
    const salt = global.crypto.getRandomValues(new Uint8Array(16));
    const iv = global.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, ITERATIONS);
    const plain = new TextEncoder().encode(JSON.stringify(payload));
    const cipher = await subtle().encrypt({ name: 'AES-GCM', iv: /** @type {any} */ (iv) }, key, plain);
    return {
      format: ENVELOPE_FORMAT,
      v: 1,
      cipher: 'AES-GCM',
      kdf: 'PBKDF2',
      hash: 'SHA-256',
      iterations: ITERATIONS,
      salt: bytesToB64(salt),
      iv: bytesToB64(iv),
      data: bytesToB64(new Uint8Array(cipher))
    };
  }

  /**
   * 解密加密信封 → 原对象 / Decrypt an envelope back to the original object.
   * 口令错误或数据被篡改（GCM 校验失败）都会 reject。
   * @param {any} envelope
   * @param {string} password
   * @returns {Promise<any>}
   */
  async function decryptJson(envelope, password) {
    if (!envelope || envelope.format !== ENVELOPE_FORMAT) throw new Error('不是有效的加密备份文件');
    if (envelope.cipher !== 'AES-GCM' || envelope.kdf !== 'PBKDF2') {
      throw new Error('不支持的加密参数（文件版本过新或已损坏）');
    }
    const salt = b64ToBytes(String(envelope.salt || ''));
    const iv = b64ToBytes(String(envelope.iv || ''));
    const data = b64ToBytes(String(envelope.data || ''));
    const key = await deriveKey(password, salt, Number(envelope.iterations) || ITERATIONS);
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: /** @type {any} */ (iv) }, key, data);
    return JSON.parse(new TextDecoder().decode(plain));
  }

  function isEnvelope(obj) {
    return !!obj && obj.format === ENVELOPE_FORMAT;
  }

  global.__GR_CRYPTO__ = { encryptJson, decryptJson, isEnvelope, ENVELOPE_FORMAT };
})(typeof globalThis !== 'undefined' ? globalThis : this);
