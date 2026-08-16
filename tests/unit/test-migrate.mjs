/**
 * 游戏雷达 Game Radar - 测试：存储迁移框架 / Migration Framework Tests
 *
 * v8.2.0：注册表迁移链（幂等/连续校验/失败不阻断）。
 */
import { test, expect, beforeEach } from 'vitest';
import { createStorageMock, installChromeStorageMock } from '../helpers/storage-mock.mjs';

// OPFS 不可用 → dataStore 降级 chrome.storage.local（统一 mock）
installChromeStorageMock(createStorageMock());

const { dataStore } = await import('../../data/data-store.js');
const migrateMod = await import('../../data/migrate.js');
const { registerMigration, migrateModuleIfNeeded, clearMigrations } = migrateMod;

beforeEach(async () => {
  clearMigrations(); // 迁移注册为模块级状态——跨测试残留必须清理
  await dataStore._reset?.().catch(() => {});
});

test('无迁移注册时跳过', async () => {
  await dataStore.writeModule('adapterRules', { version: 1, a: 1 });
  const r = await migrateModuleIfNeeded('adapterRules');
  expect(r.migrated).toEqual(false);
});

test('版本连续校验（跳号拒绝）', () => {
  expect(() => registerMigration('adapterRules', 1, 3, (d) => d)).toThrow(/连续/);
});

test('迁移链执行并写回（1→2→3）', async () => {
  registerMigration('adapterRules', 1, 2, (d) => ({ ...d, b: d.a * 2 }));
  registerMigration('adapterRules', 2, 3, (d) => ({ ...d, c: d.b + 1 }));
  await dataStore.writeModule('adapterRules', { version: 1, a: 5 });
  const r = await migrateModuleIfNeeded('adapterRules');
  expect(r.migrated).toEqual(true);
  expect(r.version).toEqual(3);
  const after = await dataStore.readModule('adapterRules');
  expect(after).toEqual({ version: 3, a: 5, b: 10, c: 11 });
});

test('已是最新版本时幂等跳过', async () => {
  registerMigration('adapterRules', 1, 2, (d) => ({ ...d, b: 1 }));
  await dataStore.writeModule('adapterRules', { version: 2, a: 1 });
  const r = await migrateModuleIfNeeded('adapterRules');
  expect(r.migrated).toEqual(false);
  const after = await dataStore.readModule('adapterRules');
  expect(after.version).toEqual(2);
});

test('迁移抛错不阻断（保留原数据）', async () => {
  registerMigration('adapterRules', 1, 2, () => {
    throw new Error('bad');
  });
  await dataStore.writeModule('adapterRules', { version: 1, a: 1 });
  const r = await migrateModuleIfNeeded('adapterRules');
  expect(r.migrated).toEqual(false);
  const after = await dataStore.readModule('adapterRules');
  expect(after.version).toEqual(1);
});
