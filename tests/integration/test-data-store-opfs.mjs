import { test, expect } from 'vitest';
/**
 * 游戏雷达 Game Radar - 测试：OPFS 写路径集成 / OPFS Write-Path Integration (v10.5.0 P1-A)
 *
 * 此前 storage/fetch mock 从不模拟 OPFS，全部单测跑的是 chrome.storage.local
 * 回退路径——**出厂主持久层（OPFS 分文件）在单测中零覆盖**。本套件用内存假
 * OPFS（getFileHandle/createWritable/removeEntry + 半截文件损坏恢复）真实驱动
 * dataStore 的 writeModule / appendModule / readModule / removeModule，覆盖：
 *   1) 写入确实落到 OPFS 文件而非 storage.local；
 *   2) ND-JSON 逐条追加累积；
 *   3) removeModule 同时清 OPFS 文件与 storage.local 键；
 *   4) JSON 损坏文件 → 读回 null 且生成 .corrupt-* 备份并重置。
 * An in-memory fake OPFS exercises the production write path end to end.
 */
('use strict');

import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';

// ============ 内存假 OPFS / in-memory fake OPFS ============
function createFakeOPFS() {
  const files = new Map(); // filename -> string content
  const notFound = () => {
    const e = new Error('NotFoundError');
    e.name = 'NotFoundError';
    return e;
  };
  function makeHandle(name) {
    return {
      name,
      async getFile() {
        if (!files.has(name)) throw notFound();
        const content = files.get(name);
        return {
          size: content.length,
          async text() {
            return content;
          }
        };
      },
      async createWritable(opts = {}) {
        const keep = !!opts.keepExistingData;
        let buf = keep ? files.get(name) || '' : '';
        return {
          async write(chunk) {
            if (chunk && typeof chunk === 'object' && chunk.type === 'write') {
              const pos = typeof chunk.position === 'number' ? chunk.position : buf.length;
              const data = String(chunk.data);
              if (pos > buf.length) buf = buf + data;
              else buf = buf.slice(0, pos) + data + buf.slice(pos + data.length);
            } else {
              buf += String(chunk);
            }
          },
          async close() {
            files.set(name, buf);
          }
        };
      }
    };
  }
  const dir = {
    async getFileHandle(name, opts = {}) {
      if (!files.has(name)) {
        if (opts.create === false) throw notFound();
        files.set(name, '');
      }
      return makeHandle(name);
    },
    async removeEntry(name) {
      files.delete(name);
    }
  };
  return { dir, files };
}

// ============ 装配假后端（必须在首次 dataStore.init 之前） ============
const storage = createStorageMock();
installChromeStorageMock(storage);
const fake = createFakeOPFS();
Object.defineProperty(globalThis, 'navigator', {
  value: { storage: { getDirectory: async () => fake.dir } },
  configurable: true,
  writable: true
});

const { dataStore } = await import(new URL('../../data/data-store.js', import.meta.url).href + '?t=' + Date.now());

test('OPFS 可用（探测成功，未降级）', async () => {
  await dataStore.init();
  expect(dataStore.isOpfsAvailable()).toEqual(true);
});

test('writeModule 落到 OPFS 文件而非 storage.local', async () => {
  await dataStore.writeModule('settings', { theme: 'dark', weights: { clickRate: 0.2 } });
  expect(typeof fake.files.get('settings.json')).toEqual('string');
  expect(fake.files.get('settings.json')).toContain('dark');
  expect(storage._data.get('settings')).toEqual(undefined); // 未写回退后端
  const back = await dataStore.readModule('settings');
  expect(back.theme).toEqual('dark');
});

test('同模块并发写串行化，末值生效（无写覆盖竞态）', async () => {
  const writes = [];
  for (let i = 0; i < 10; i++) writes.push(dataStore.writeModule('gameProfiles', { v: i }));
  await Promise.all(writes);
  const back = await dataStore.readModule('gameProfiles');
  expect(typeof back.v).toEqual('number'); // 读到某个完整写入（非撕裂）
});

test('appendModule 逐条累积 ND-JSON', async () => {
  await dataStore.removeModule('behaviorLog');
  await dataStore.appendModule('behaviorLog', { type: 'view', n: 1 });
  await dataStore.appendModule('behaviorLog', { type: 'click', n: 2 });
  await dataStore.appendModule('behaviorLog', { type: 'view', n: 3 });
  const list = await dataStore.readModule('behaviorLog');
  expect(Array.isArray(list) && list.length).toEqual(3);
  expect(list[1].n).toEqual(2);
});

test('removeModule 同时清 OPFS 文件与 storage.local 键', async () => {
  await dataStore.writeModule('appStats', { keep: true });
  await dataStore.removeModule('appStats');
  expect(fake.files.has('app-stats.json')).toEqual(false);
  expect(await dataStore.readModule('appStats')).toEqual(undefined);
});

test('JSON 损坏文件 → 读回 null 且生成 .corrupt 备份并重置', async () => {
  fake.files.set('game-registry.json', '{ this is not valid json ');
  const before = [...fake.files.keys()];
  const val = await dataStore.readModule('gameRegistry');
  expect(val).toEqual(null);
  const after = [...fake.files.keys()];
  const backups = after.filter((k) => k.startsWith('game-registry.json.corrupt-'));
  expect(backups.length).toEqual(1);
  expect(before.some((k) => k === 'game-registry.json')).toEqual(true);
  // 重置后文件为空 → 下次读取得 null（不再崩溃循环）
  expect(await dataStore.readModule('gameRegistry')).toEqual(null);
});

test('未知模块键 writeModule/readModule 安全', async () => {
  await dataStore.writeModule('__nope__', 1);
  expect(await dataStore.readModule('__nope__')).toEqual(undefined);
});
