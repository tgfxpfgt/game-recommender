/**
 * 游戏雷达 Game Radar - logger runtimeLog 追加路径单测
 *
 * v10.8 缺口2 回归：v10.7.0 将 OPFS 文件模式改为真追加（persistedLogCount
 * 探底/追加/截断/失败复位分支）——此前全量重写，写放大热点 top1。
 * mocks：dataStore（read/append/write）与 getSettings。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const readModule = vi.fn();
const appendModule = vi.fn();
const writeModule = vi.fn();
vi.mock('../../data/data-store.js', () => ({
  dataStore: {
    readModule: (...a) => readModule(...a),
    appendModule: (...a) => appendModule(...a),
    writeModule: (...a) => writeModule(...a),
    removeModule: vi.fn()
  }
}));
const getSettings = vi.fn();
vi.mock('../../background/core/settings.js', () => ({ getSettings: (...a) => getSettings(...a) }));

// 每用例拿全新模块实例（logger 有 logBuffer/persistedLogCount 模块级状态）
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

  it('首次 flush 探底后走 appendModule 真追加（不整文件重写）', async () => {
    readModule.mockResolvedValue([{ timestamp: 1 }]); // 磁盘已有 1 条
    const { Logger, flushLogBuffer } = await freshLogger();
    await Logger.info('Test', 'hello-1');
    await Logger.info('Test', 'hello-2');
    await flushLogBuffer();
    // 探底 1 次 + 逐条追加 2 次；writeModule（全量重写）不得调用
    expect(readModule).toHaveBeenCalledTimes(1);
    expect(appendModule).toHaveBeenCalledTimes(2);
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
    expect(appendModule).toHaveBeenCalledTimes(2);
  });

  it('超上限触发全量重写并截断到 max', async () => {
    getSettings.mockResolvedValue({ ...NDJSON_SETTINGS, maxRuntimeLog: 12 });
    readModule.mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ timestamp: i }))); // 磁盘 10 条
    const { Logger, flushLogBuffer } = await freshLogger();
    for (let i = 0; i < 5; i++) await Logger.info('Test', 'm' + i); // +5 = 15 > 12
    await flushLogBuffer();
    expect(appendModule).not.toHaveBeenCalled(); // 走重写路径
    expect(writeModule).toHaveBeenCalledTimes(1);
    const persisted = writeModule.mock.calls[0][1];
    expect(persisted.length).toEqual(12); // 截断保最后 12 条
  });

  it('追加失败 → 计数失真复位（下次 flush 重新探底）+ 缓冲回滚', async () => {
    readModule.mockResolvedValue([]);
    appendModule.mockRejectedValueOnce(new Error('disk-blow'));
    const { Logger, flushLogBuffer } = await freshLogger();
    await Logger.info('Test', 'x');
    await flushLogBuffer(); // 追加失败（内部吞错回滚）
    expect(appendModule).toHaveBeenCalledTimes(1);
    await Logger.info('Test', 'y');
    await flushLogBuffer(); // 恢复后重试：必须重新探底（readModule 第 2 次）
    expect(readModule).toHaveBeenCalledTimes(2);
    // 失败的 x 未丢：重试路径里 pending 含 x + y
    expect(appendModule).toHaveBeenCalledTimes(3); // x、y 重试共 3 次追加（x 失败 1 + 重试轮 2）
  });

  it('开关关闭 → 缓冲直接丢弃（不写盘）', async () => {
    getSettings.mockResolvedValue({ ...NDJSON_SETTINGS, enableLog: false });
    const { Logger, flushLogBuffer } = await freshLogger();
    await Logger.info('Test', 'z');
    await flushLogBuffer();
    expect(appendModule).not.toHaveBeenCalled();
    expect(writeModule).not.toHaveBeenCalled();
  });
});
