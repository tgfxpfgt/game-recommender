/**
 * 游戏雷达 Game Radar - shared/crypto-utils 单测
 *
 * v10.6.0 F5：离线备份加密（AES-GCM + PBKDF2）——往返/错误口令/篡改检测/
 * 信封识别。Node ≥18 自带 webcrypto 与 btoa/atob，IIFE 直接挂 globalThis。
 * Tests backup encryption: roundtrip, wrong passphrase, tamper detection,
 * envelope detection.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let C = null;

beforeAll(async () => {
  await import(path.join(ROOT, 'shared', 'crypto-utils.js').replace(/\\/g, '/'));
  C = globalThis.__GR_CRYPTO__;
});

describe('crypto-utils（F5 备份加密）', () => {
  it('信封格式：format/cipher/kdf/iterations 齐全', async () => {
    const env = await C.encryptJson({ hello: 'world' }, 'pass-123456');
    expect(env.format).toEqual('game-recommender-backup-encrypted');
    expect(env.cipher).toEqual('AES-GCM');
    expect(env.kdf).toEqual('PBKDF2');
    expect(env.hash).toEqual('SHA-256');
    expect(env.iterations).toBeGreaterThan(0);
    expect(env.salt.length).toBeGreaterThan(0);
    expect(env.iv.length).toBeGreaterThan(0);
    expect(env.data.length).toBeGreaterThan(0);
  });

  it('往返：加密→解密还原原对象（含中文/嵌套）', async () => {
    const payload = {
      format: 'game-recommender-backup',
      settings: { weights: { steam: 0.3, sales: 0.1 } },
      modules: { 游戏画像: [{ name: '赛博朋克 2077', tags: ['RPG', '开放世界'] }] }
    };
    const round = await C.decryptJson(await C.encryptJson(payload, '口令-password'), '口令-password');
    expect(round).toEqual(payload);
  });

  it('错误口令 → reject（GCM 校验失败）', async () => {
    const env = await C.encryptJson({ a: 1 }, 'right-password');
    await expect(C.decryptJson(env, 'wrong-password')).rejects.toThrow();
  });

  it('密文篡改 → reject（防篡改）', async () => {
    const env = await C.encryptJson({ a: 1 }, 'pass-123456');
    const tampered = { ...env, data: env.data.slice(0, -4) + (env.data.endsWith('AAAA') ? 'BBBB' : 'AAAA') };
    await expect(C.decryptJson(tampered, 'pass-123456')).rejects.toThrow();
  });

  it('isEnvelope 识别 + 非信封对象不误判', () => {
    expect(C.isEnvelope({ format: 'game-recommender-backup-encrypted' })).toEqual(true);
    expect(C.isEnvelope({ format: 'game-recommender-backup' })).toEqual(false);
    expect(C.isEnvelope(null)).toEqual(false);
  });

  it('空口令 encrypt → reject', async () => {
    await expect(C.encryptJson({ a: 1 }, '')).rejects.toThrow('口令');
  });
});
