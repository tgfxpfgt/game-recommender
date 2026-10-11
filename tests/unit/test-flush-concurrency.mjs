/**
 * 游戏雷达 Game Radar - B5 落盘并发/写合并测试 / Flush Concurrency & Write Coalescing
 *
 * v14.5.0 B5：贯穿纪律 3——并发改动必须附隔离压力测试。
 *   1. 多标签并发场景（模拟 3 tab 并发 flushAllCaches + 并发画像/日志写入）
 *      无死锁（5s canary 快速失败，不依赖 120s 超时）
 *   2. 画像写合并：TRACK_EVENT_BATCH 批内 10 事件 → 防抖窗口内磁盘写 ≤1 次
 *      （改前逐事件全量重写 = 10 次），合并后状态与逐事件语义一致
 *   3. flush 强制落盘语义不变：flushAllCaches 后磁盘立即可见合并结果
 * v14.5.0 B5: isolation stress test for concurrent flushes (3 tabs), profile
 * write coalescing (10 events → ≤1 disk write) and unchanged flush semantics.
 */
import { describe, test, expect } from 'vitest';
import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';
import { DB_KEYS } from '../../background/core/constants.js';

const storage = createStorageMock();
installChromeStorageMock(storage);

const flushMod = await import(new URL('../../background/storage/flush.js', import.meta.url).href);
const behMod = await import(new URL('../../background/storage/behavior.js', import.meta.url).href);

// 死锁 canary：并发 Promise 与 5s 计时赛跑——挂起即失败（不等 120s 用例超时）
function withDeadlockCanary(promise, ms = 5000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('deadlock canary: 落盘并发挂起')), ms))
  ]);
}

function profileWriteCount() {
  return storage._writes.filter((k) => k === DB_KEYS.GAME_PROFILES).length;
}

describe('B5 落盘并发与写合并', () => {
  test('模拟 3 tab × flushAllCaches + 并发写入：无死锁、状态一致', async () => {
    storage._reset();
    behMod.resetBehaviorMemory();
    behMod.resetBehaviorState();

    const writers = [];
    for (let tab = 0; tab < 3; tab++) {
      // 每个"标签页"：并发画像更新 + 行为日志 + 自己的 flush
      writers.push(
        (async () => {
          for (let i = 0; i < 5; i++) {
            await behMod.updateGameProfile({ name: `游戏${tab}-${i}`, event: 'view' });
            await behMod.addBehaviorLog({ type: 'view_detail', gameName: `游戏${tab}-${i}` });
          }
          await flushMod.flushAllCaches();
        })()
      );
      writers.push(flushMod.flushAllCaches()); // 标签页各自触发兜底 flush
    }
    writers.push(flushMod.flushAllCaches());
    writers.push(flushMod.flushAllCaches());

    await withDeadlockCanary(Promise.all(writers));

    // 终态一致：15 个画像全部在内存缓存（读路径），磁盘 ≥1 次合并写且包含全部
    const profiles = await behMod.readProfiles();
    expect(Object.keys(profiles).length).toEqual(15);
    const flushed = await flushMod.flushAllCaches(); // 收尾强制落盘
    expect(flushed).toEqual(undefined); // 正常完成（无异常即通过）
    const onDisk = storage._dump()[DB_KEYS.GAME_PROFILES];
    expect(Object.keys(onDisk || {}).length).toEqual(15);
  });

  test('画像写合并：10 事件 → 防抖窗口内磁盘写 ≤1 次（改前 10 次全量重写）', async () => {
    storage._reset();
    behMod.resetBehaviorMemory();
    behMod.resetBehaviorState();

    const before = profileWriteCount();
    for (let i = 0; i < 10; i++) {
      await behMod.updateGameProfile({ name: '合并游戏', event: 'view' });
    }
    // 防抖窗口内：磁盘写 0 次（全在内存合并）；强制落盘后恰 1 次
    expect(profileWriteCount() - before).toEqual(0);
    const profiles = await behMod.readProfiles();
    expect(profiles['合并游戏'].views).toEqual(10); // 合并语义与逐事件一致
    await flushMod.flushAllCaches();
    expect(profileWriteCount() - before).toEqual(1);
    expect(storage._dump()[DB_KEYS.GAME_PROFILES]['合并游戏'].views).toEqual(10);
  });

  test('flush 强制落盘语义不变：update → flushAllCaches → 磁盘立即可见', async () => {
    storage._reset();
    behMod.resetBehaviorMemory();
    behMod.resetBehaviorState();

    await behMod.updateGameProfile({ name: '落盘游戏', event: 'download', steamAppId: '730' });
    await flushMod.flushAllCaches();
    const onDisk = storage._dump()[DB_KEYS.GAME_PROFILES];
    expect(onDisk['落盘游戏'].downloads).toEqual(1);
    expect(onDisk['落盘游戏'].steamAppId).toEqual('730');
  });

  test('写失败回滚：writeModule 抛错后 dirty 保留，恢复后重试落盘', async () => {
    storage._reset();
    behMod.resetBehaviorMemory();
    behMod.resetBehaviorState();

    await behMod.updateGameProfile({ name: '回滚游戏', event: 'view' });
    // 模拟一次磁盘故障：临时替换 local.set 抛错（其他模块 flush 可能同样失败——
    // 各模块均有内部 catch，flushAllCaches 不因此拒绝；画像侧断言 dirty 回滚）
    const origSet = storage.set;
    storage.set = async () => {
      throw new Error('模拟磁盘故障');
    };
    await flushMod.flushAllCaches().catch(() => {}); // 写失败 → dirty 回滚
    storage.set = origSet;
    // 恢复后下一窗口重试：再次强制落盘可见数据
    await flushMod.flushAllCaches();
    expect(storage._dump()[DB_KEYS.GAME_PROFILES]['回滚游戏'].views).toEqual(1);
  });
});
