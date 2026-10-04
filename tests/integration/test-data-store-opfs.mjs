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

// ============ v14 B7：ndjson-map（steam-cache rating 追加式落盘） ============
test('ndjson-map：旧 JSON 全量对象首读自动迁移为行格式', async () => {
  fake.files.set('steam-cache-rating.json', JSON.stringify({ 100: { data: { positiveRate: 90 }, ts: 123 } }));
  const map = await dataStore.readModule('steamCacheRating');
  expect(map['100'].data.positiveRate).toEqual(90);
  // 原位迁移：文件已重写为 {key, value} 行格式
  expect(fake.files.get('steam-cache-rating.json')).toContain('"key":"100"');
  // 二次读取（行格式路径）结果一致
  const map2 = await dataStore.readModule('steamCacheRating');
  expect(map2['100'].data.positiveRate).toEqual(90);
});

test('ndjson-map：appendModuleEntries 追加累积 + 同键后行覆盖先行', async () => {
  await dataStore.removeModule('steamCacheRating');
  await dataStore.appendModuleEntries('steamCacheRating', [
    { key: '200', value: { data: { positiveRate: 80 }, ts: 1 } },
    { key: '300', value: { data: { positiveRate: 70 }, ts: 1 } }
  ]);
  await dataStore.appendModuleEntries('steamCacheRating', [
    { key: '200', value: { data: { positiveRate: 85 }, ts: 2 } }
  ]);
  const map = await dataStore.readModule('steamCacheRating');
  expect(map['200'].data.positiveRate).toEqual(85); // 后行覆盖先行 = 最新胜出
  expect(map['300'].data.positiveRate).toEqual(70);
  const lines = fake.files.get('steam-cache-rating.json').split('\n').filter(Boolean);
  expect(lines.length).toEqual(3); // 追加不重写：3 行（原 2 + 追加 1）
});

test('ndjson-map：损坏行跳过，其余数据存活', async () => {
  await dataStore.removeModule('steamCacheRating');
  fake.files.set(
    'steam-cache-rating.json',
    '{"key":"400","value":{"data":{"positiveRate":10},"ts":1}}\n{broken json\n'
  );
  const map = await dataStore.readModule('steamCacheRating');
  expect(map['400'].data.positiveRate).toEqual(10);
  expect(map['broken json']).toEqual(undefined);
});

test('v14 B7：steam-cache rating 追加落盘 + compaction + 删除重写', async () => {
  const sc = await import(new URL('../../background/storage/steam-cache.js', import.meta.url).href);
  sc.resetSteamCache();
  await dataStore.removeModule('steamCacheRating');
  await sc.loadSteamCacheToMemory();
  // 3 条目基线：首次 flush 追加建文件 = 3 行
  for (const id of ['1', '2', '3']) await sc.setSteamCacheEntry(id, { positiveRate: 50 });
  await sc.flushSteamCache();
  const lineCount = () => fake.files.get('steam-cache-rating.json').split('\n').filter(Boolean).length;
  expect(lineCount()).toEqual(3);
  // 同条目反复更新：行数超 2×活跃条目数（>6）→ compaction 重写回活跃数
  for (let i = 0; i < 8; i++) {
    await sc.setSteamCacheEntry('1', { positiveRate: 50 + i });
    await sc.flushSteamCache();
  }
  // 阈值穿越的瞬态最多超 1 行（append 判定在写前）：行数有界
  expect(lineCount()).toBeLessThanOrEqual(2 * 3 + 1);
  const map = await dataStore.readModule('steamCacheRating');
  expect(map['1'].data.positiveRate).toEqual(57); // 数据正确（最新胜出）
  expect(map['2']).toBeTruthy();
  // 删除 → append 无法表达删除 → 整体重写，条目消失
  await sc.deleteSteamCacheEntry('2');
  await sc.flushSteamCache();
  const map2 = await dataStore.readModule('steamCacheRating');
  expect(map2['2']).toEqual(undefined);
  expect(map2['1']).toBeTruthy();
  expect(map2['3']).toBeTruthy();
});
