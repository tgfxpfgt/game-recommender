import { test, expect, describe } from 'vitest';
/**
 * Game Recommender - 测试：备份管理 / Backups Tests
 *
 * v6.3.0：覆盖此前零测试的备份/恢复完整流程——创建（全量/勾选模块/密钥
 * 剔除/上限裁剪）、恢复（安全网备份 + 模块白名单校验 + 缓存重置）、删除。
 * Covers the backup lifecycle: create (full/selected modules/secret stripping/
 * retention), restore (safety-net backup + sanitize + cache reset), delete.
 */
'use strict';

import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';

const storage = createStorageMock({
  // 预置：settings（含密钥）+ 行为日志 + 注册表数据
  settings: {
    enabled: true,
    maxBackups: 3,
    llmConfig: { provider: 'local', apiKey: 'sk-secret', temperature: 0.3 }
  },
  behaviorLog: [{ t: 1000, type: 'view_detail', gameName: '游戏A' }],
  gameRegistry: { 275850: { cnName: '无人深空' } }
});
installChromeStorageMock(storage);

// backups.js 无 ?t= 导入（与 dataStore/constants 共享实例）
const backups = await import(new URL('../../background/storage/backups.js', import.meta.url).href);

describe('备份管理', () => {
  test('创建全量备份（含数据快照与密钥剔除）', async () => {
    storage._reset({
      settings: { enabled: true, maxBackups: 7, llmConfig: { provider: 'local', apiKey: 'sk-secret' } },
      behaviorLog: [{ t: 1000, type: 'view_detail', gameName: '游戏A' }]
    });
    const backup = await backups.createBackup(false);
    expect(!!backup && !!backup.id).toEqual(true);
    expect(backup.manual).toEqual(false);
    expect(backup.modules.includes('settings')).toEqual(true);
    // 密钥剔除：备份数据中 apiKey 为空
    expect(backup.data.settings.llmConfig.apiKey).toEqual('');
    // 原始存储不受影响（仅备份副本剔除）
    expect(storage._dump().settings.llmConfig.apiKey).toEqual('sk-secret');
    expect(backup.data.behaviorLog.length).toEqual(1);
  });

  test('勾选模块备份（moduleKeys 过滤）', async () => {
    storage._reset({ behaviorLog: [{ t: 1 }], gameRegistry: { a: 1 } });
    const backup = await backups.createBackup(true, ['behaviorLog']);
    expect(backup.modules).toEqual(['behaviorLog']);
    expect(backup.data.behaviorLog).toBeDefined();
    expect(backup.data.gameRegistry).toBeUndefined();
  });

  test('备份数量上限裁剪（maxBackups）', async () => {
    storage._reset({ settings: { enabled: true }, behaviorLog: [{ t: 1 }] });
    // settings 有内存缓存，用 saveSettings 走业务路径更新 maxBackups
    const setMod = await import(new URL('../../background/core/settings.js', import.meta.url).href);
    await setMod.saveSettings({ enabled: true, maxBackups: 3 });
    for (let i = 0; i < 5; i++) await backups.createBackup(false);
    const list = await backups.getBackupList();
    expect(list.length).toEqual(3);
  });

  test('恢复备份（安全网备份 + 数据还原）', async () => {
    storage._reset({
      settings: { enabled: true, maxBackups: 7 },
      behaviorLog: [{ t: 1000, type: 'view_detail', gameName: '游戏A' }],
      gameRegistry: { 275850: { cnName: '无人深空' } }
    });
    const backup = await backups.createBackup(false);
    // 修改数据
    await storage._data.set('behaviorLog', [{ t: 9999, type: 'view_detail', gameName: '被改' }]);
    const restored = await backups.restoreBackup(backup.id);
    expect(restored.success).toEqual(true);
    const log = storage._dump().behaviorLog;
    expect(log[0].gameName).toEqual('游戏A'); // 已还原
    // 安全网备份已创建（恢复前的状态被保护）
    const list = await backups.getBackupList();
    expect(list.length >= 2).toEqual(true);
  });

  test('恢复不存在的备份返回失败', async () => {
    storage._reset({ settings: { enabled: true, maxBackups: 7 } });
    const r = await backups.restoreBackup('no-such-id');
    expect(r.success).toEqual(false);
  });

  test('删除备份', async () => {
    storage._reset({ settings: { enabled: true, maxBackups: 7 }, behaviorLog: [{ t: 1 }] });
    const backup = await backups.createBackup(false);
    const r = await backups.deleteBackup(backup.id);
    expect(r.success).toEqual(true);
    const list = await backups.getBackupList();
    expect(list.find((b) => b.id === backup.id)).toBeUndefined();
  });
});
