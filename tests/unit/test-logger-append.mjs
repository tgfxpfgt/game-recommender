/**
 * 游戏雷达 Game Radar - logger runtimeLog 追加路径单测
 *
 * v10.8 缺口2 回归：v10.7.0 将 OPFS 文件模式改为真追加（persistedLogCount
 * 探底/追加/截断/失败复位分支）——此前全量重写，写放大热点 top1。
 * v14.28.3：flush 改为**批量追加**（appendModuleBatch）——此前逐条
 * appendModule，N 条日志 = N 次 OPFS 句柄打开/关闭。
 * mocks：dataStore（read/append/appendBatch/write）与 getSettings。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const readModule = vi.fn();
const appendModule = vi.fn();
const appendModuleBatch = vi.fn();
const writeModule = vi.fn();
vi.mock('../../data/data-store.js', () => ({
  dataStore: {
    readModule: (...a) => readModule(...a),
    appendModule: (...a) => appendModule(...a),
    appendModuleBatch: (...a) => appendModuleBatch(...a),
    writeModule: (...a) => writeModule(...a),
    removeModule: vi.fn()
  }
}));
const getSettings = vi.fn();
vi.mock('../../background/core/settings.js', () => ({ getSettings: (...a) => getSettings(...a) }));

// 每用例拿全新模块实例（logger 有 logBuffer/persistedLogCount/logConfig 模块级状态）
async function freshLogger() {
  vi.resetModules();
  return await import('../../background/storage/logger.js');
}

const NDJSON_SETTINGS = { enableLog: true, logStorage: 'ndjson', logRetentionDays: 0, maxRuntimeLog: 300 };

describe('logger 追加路径（v10.8 缺口2 回归）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettings.mockResolvedValue({ ...NDJSON_SETTINGS });
  });

  it('首次 flush 探底后走批量真追加（不整文件重写）', async () => {
    readModule.mockResolvedValue([{ timestamp: 1 }]); // 磁盘已有 1 条
    const { Logger, flushLogBuffer } = await freshLogger();
    await Logger.info('Test', 'hello-1');
    await Logger.info('Test', 'hello-2');
    await flushLogBuffer();
    // 探底 1 次 + 批量追加 1 次（2 条一次写）；writeModule（全量重写）不得调用
    expect(readModule).toHaveBeenCalledTimes(1);
    expect(appendModuleBatch).toHaveBeenCalledTimes(1);
    expect(appendModule).not.toHaveBeenCalled();
    expect(writeModule).not.toHaveBeenCalled();
  });

  it('v14.28.3 回归：10 条日志 = 1 次批量追加，顺序与入缓冲一致', async () => {
    readModule.mockResolvedValue([]);
    const { Logger, flushLogBuffer } = await freshLogger();
    for (let i = 0; i < 10; i++) await Logger.warn('Test', 'w' + i);
    await flushLogBuffer();
    expect(appendModuleBatch).toHaveBeenCalledTimes(1);
    const [, entries] = appendModuleBatch.mock.calls[0];
    expect(entries.length).toEqual(10);
    expect(entries.map((e) => e.message)).toEqual(Array.from({ length: 10 }, (_, i) => 'w' + i));
    expect(appendModule).not.toHaveBeenCalled();
  });

  it('v14.28.3 回归：warn 本身不触发同步 OPFS 写（仅入内存缓冲）', async () => {
    const { Logger } = await freshLogger();
    await Logger.warn('Test', 'no-sync-write');
    // 防抖窗口内：读/追加/重写三类 OPFS 操作都必须为 0
    expect(readModule).not.toHaveBeenCalled();
    expect(appendModule).not.toHaveBeenCalled();
    expect(appendModuleBatch).not.toHaveBeenCalled();
    expect(writeModule).not.toHaveBeenCalled();
  });

  it('第二次 flush 不再探底（内存计数权威）', async () => {
    readModule.mockResolvedValue([]);
    const { Logger, flushLogBuffer } = await freshLogger();
    await Logger.info('Test', 'a');
    await flushLogBuffer();
    await Logger.info('Test', 'b');
    await flushLogBuffer();
    expect(readModule).toHaveBeenCalledTimes(1); // 仅首条 flush 探底
    expect(appendModuleBatch).toHaveBeenCalledTimes(2);
  });

  it('超上限触发全量重写并截断到 max', async () => {
    getSettings.mockResolvedValue({ ...NDJSON_SETTINGS, maxRuntimeLog: 12 });
    readModule.mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ timestamp: i }))); // 磁盘 10 条
    const { Logger, flushLogBuffer } = await freshLogger();
    for (let i = 0; i < 5; i++) await Logger.info('Test', 'm' + i); // +5 = 15 > 12
    await flushLogBuffer();
    expect(appendModuleBatch).not.toHaveBeenCalled(); // 走重写路径
    expect(writeModule).toHaveBeenCalledTimes(1);
    const persisted = writeModule.mock.calls[0][1];
    expect(persisted.length).toEqual(12); // 截断保最后 12 条
  });

  it('追加失败 → 计数失真复位（下次 flush 重新探底）+ 缓冲回滚', async () => {
    readModule.mockResolvedValue([]);
    appendModuleBatch.mockRejectedValueOnce(new Error('disk-blow'));
    const { Logger, flushLogBuffer } = await freshLogger();
    await Logger.info('Test', 'x');
    await flushLogBuffer(); // 追加失败（内部吞错回滚）
    expect(appendModuleBatch).toHaveBeenCalledTimes(1);
    await Logger.info('Test', 'y');
    await flushLogBuffer(); // 恢复后重试：必须重新探底（readModule 第 2 次）
    expect(readModule).toHaveBeenCalledTimes(2);
    // 失败的 x 未丢：重试批次含 x + y
    expect(appendModuleBatch).toHaveBeenCalledTimes(2);
    const retryEntries = appendModuleBatch.mock.calls[1][1];
    expect(retryEntries.map((e) => e.message)).toEqual(['x', 'y']);
  });

  it('开关关闭 → 缓冲直接丢弃（不写盘）', async () => {
    getSettings.mockResolvedValue({ ...NDJSON_SETTINGS, enableLog: false });
    const { Logger, flushLogBuffer } = await freshLogger();
    await Logger.info('Test', 'z');
    await flushLogBuffer();
    expect(appendModule).not.toHaveBeenCalled();
    expect(appendModuleBatch).not.toHaveBeenCalled();
    expect(writeModule).not.toHaveBeenCalled();
  });
});
