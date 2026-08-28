/**
 * 游戏雷达 Game Radar - 存储模块迁移框架 / Storage Migration Framework
 *
 * v8.2.0：数据模块 schema 升级的注册表机制——模块 version 与迁移函数
 * 解耦注册，读时自动执行迁移链（幂等：version 已是最新则跳过）。
 * 使用方式（存储模块加载时）：调用 migrateModuleIfNeeded(DB_KEYS.XXX)；
 * 注册迁移（schema 升级时，随版本提交）：
 * registerMigration(DB_KEYS.XXX, 1, 2, (data) => ({ ...data, newField: [] }))。
 *
 * 历史说明：adapterRules/downloadUrls 的既有兼容逻辑内嵌在各自模块
 * （loadSiteRules 等），不重复迁移——本框架服务**未来** schema 升级，
 * 与现有逻辑互不干扰。
 */
import { dataStore } from './data-store.js';

/** @type {Map<string, Array<{ from: number, to: number, migrate: Function }>>} */
const MIGRATIONS = new Map();

/**
 * 注册一次迁移（from → to，链式自动串联）
 * @param {string} key 存储模块键（DB_KEYS.*）
 * @param {number} from 源版本
 * @param {number} to 目标版本（必须 from+1）
 * @param {(data: any) => any} migrate 迁移函数（旧数据 → 新数据）
 */
export function registerMigration(key, from, to, migrate) {
  if (to !== from + 1) {
    throw new Error(`迁移版本必须连续（${key}: ${from} → ${to}，要求 ${from + 1}）`);
  }
  const chain = MIGRATIONS.get(key) || [];
  chain.push({ from, to, migrate });
  chain.sort((a, b) => a.from - b.from);
  MIGRATIONS.set(key, chain);
}

/**
 * 清空迁移注册表（测试辅助——注册为模块级状态，跨测试残留需显式清理）
 */
export function clearMigrations() {
  MIGRATIONS.clear();
}

/**
 * 读取时自动迁移（幂等）：模块 version 落后则执行迁移链并写回
 * @param {string} key 存储模块键
 * @returns {Promise<{ migrated: boolean, version: number|null }>}
 */
export async function migrateModuleIfNeeded(key) {
  const chain = MIGRATIONS.get(key) || [];
  if (chain.length === 0) return { migrated: false, version: null };
  try {
    const data = await dataStore.readModule(key);
    if (!data || typeof data !== 'object') return { migrated: false, version: null };
    const current = Number(data.version) || 0;
    const target = chain[chain.length - 1].to;
    if (current >= target) return { migrated: false, version: current };
    let next = data;
    let ver = current;
    let applied = false;
    for (const step of chain) {
      if (ver >= step.to) continue;
      // v9.7.0：链断开防护——ver < step.from 说明缺 ver→ver+1 的迁移步
      //（注册不连续），拿后面的迁移函数处理前面版本的数据形状会破坏数据；
      // 停止迁移，保留已完成的步（ver 随迁移步推进，不能用原始 current）
      if (ver < step.from) break;
      const migrated = step.migrate(next);
      // v9.7.0：迁移函数返回非对象（含 undefined）时保留迁移前数据——
      // 此前 {...undefined} 只剩 {version}，整模块数据被静默清空落盘
      if (!migrated || typeof migrated !== 'object') {
        console.warn(`【游戏雷达】 模块 ${key} 迁移步 ${step.from}→${step.to} 返回非法数据（保留迁移前数据）`);
        break;
      }
      next = { ...migrated, version: step.to };
      ver = step.to;
      applied = true;
    }
    if (!applied) return { migrated: false, version: current };
    await dataStore.writeModule(key, next);
    return { migrated: true, version: next.version };
  } catch (e) {
    // 迁移失败不阻断主流程（保留原数据，日志可见）
    console.warn(`【游戏雷达】 模块 ${key} 迁移失败（保留原数据）:`, String(e));
    return { migrated: false, version: null };
  }
}
