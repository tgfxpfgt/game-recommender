/**
 * 游戏雷达 Game Radar - core/session-persist 单测（审计 R2-07 补覆盖）
 *
 * 覆盖：initial 深拷贝隔离 / session 读回 / 防抖落盘 / flush 立即落盘 /
 * reset 取消挂起写入 / session 不可用静默降级。
 * Covers the session-persist contract (memory-first, debounced write-back).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSessionPersist } from '../../background/core/session-persist.js';
import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('session-persist（诊断状态跨 SW 冷启动持久化）', () => {
  /** @type {() => void} */
  let restore = () => {};

  beforeEach(() => {
    restore = installChromeStorageMock(createStorageMock());
  });
  afterEach(() => restore());

  it('initial 深拷贝隔离：改内存不污染初始值，reset 回到初始', () => {
    const p = createSessionPersist('diagKey', { initial: { n: 1 }, debounceMs: 5 });
    p.peek().n = 99;
    p.reset();
    expect(p.peek()).toEqual({ n: 1 }); // initial 未被首个状态变更污染
  });

  it('load 从 session 读回且幂等', async () => {
    globalThis.chrome.storage.session._data.set('diagKey', { n: 7 });
    const p = createSessionPersist('diagKey', { initial: { n: 0 }, debounceMs: 5 });
    expect(await p.load()).toEqual({ n: 7 });
    globalThis.chrome.storage.session._data.set('diagKey', { n: 8 }); // 已 loaded 不再读回
    expect(await p.load()).toEqual({ n: 7 });
  });

  it('scheduleSave 防抖落盘；flush 立即落盘', async () => {
    const p = createSessionPersist('diagKey', { initial: { n: 0 }, debounceMs: 20 });
    p.peek().n = 3;
    p.scheduleSave();
    p.scheduleSave(); // 防抖合并
    expect(globalThis.chrome.storage.session._data.has('diagKey')).toBe(false);
    await sleep(60);
    expect(globalThis.chrome.storage.session._data.get('diagKey')).toEqual({ n: 3 });

    p.peek().n = 4;
    await p.flush(); // 不走防抖
    expect(globalThis.chrome.storage.session._data.get('diagKey')).toEqual({ n: 4 });
  });

  it('reset 取消挂起的防抖写入（清空不被撤销）', async () => {
    const p = createSessionPersist('diagKey', { initial: { n: 0 }, debounceMs: 20 });
    p.peek().n = 5;
    p.scheduleSave();
    p.reset();
    await sleep(60);
    expect(globalThis.chrome.storage.session._data.has('diagKey')).toBe(false);
  });

  it('session 不可用时静默降级纯内存', async () => {
    globalThis.chrome.storage.session.get = async () => {
      throw new Error('session unavailable');
    };
    globalThis.chrome.storage.session.set = async () => {
      throw new Error('session unavailable');
    };
    const p = createSessionPersist('diagKey', { initial: { n: 1 }, debounceMs: 5 });
    expect(await p.load()).toEqual({ n: 1 });
    await p.flush(); // 不抛错
  });
});
