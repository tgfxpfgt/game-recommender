import { hasChineseChars, hasLatinLetters } from '../core/utils.js';
import { Logger } from '../storage/logger.js';
import { getGameRegistry, getGameRegistryEntry, recordGameInRegistry, flushRegistry } from '../storage/registry.js';
import { fetchSteamAppDetails } from './api-details.js';
import { DEMO_NAME_PATTERN } from './api-search.js';

/**
 * Game Recommender - Steam API 子模块：api-registry-heal.js
 *
 * v5.0.0：由 steam/api.js 按职能拆分。
 */


// 通过注册表判断 appId 是否为 Demo/试玩版（缓存缺失时的自愈依据）
// Determine from the registry whether an appId is a Demo/trial edition
export async function isDemoAppId(appId) {
  if (!appId) return false;
  const entry = await getGameRegistryEntry(appId);
  if (!entry) return false;
  const text = [entry.cnName, entry.enName, ...(entry.names || [])].filter(Boolean).join(' ');
  return DEMO_NAME_PATTERN.test(text);
}

// 幂等补写注册表：缓存命中返回时确保注册表存在该条目的正确中英文名（含封面/type）
// Idempotent registry fill when serving from cache (cover + type included)


// 幂等补写注册表：缓存命中返回时确保注册表存在该条目的正确中英文名（含封面/type）
// Idempotent registry fill when serving from cache (cover + type included)
export async function ensureRegistryEntry(appId, cnName, enName, gameName, coverImage, type) {
  if (!appId) return;
  const existing = await getGameRegistryEntry(appId);
  if (existing && (existing.cnName || existing.enName)) {
    // 条目已存在：仅补缺失的封面与 type / fill missing cover & type only
    if (coverImage && !existing.coverImage && /^https?:\/\//i.test(coverImage)) {
      await recordGameInRegistry(appId, { coverImage });
    }
    if (type && !existing.type) {
      await recordGameInRegistry(appId, { type });
    }
    return;
  }
  await recordGameInRegistry(appId, {
    cnName: cnName || '',
    enName: enName || cnName || '',
    gameName: gameName || '',
    coverImage: coverImage || '',
    type: type || ''
  });
}

// 按 appId 修复注册表中异常的中英文名（并行获取官方名，一次修复两个字段）。
// 中文名异常时仅当 Steam 官方确实有中文名才覆盖（Steam 无中文名的游戏保持原值）。
// Self-heal abnormal CN/EN names by appId (parallel fetch, one pass). The CN
// name is overwritten only when Steam itself provides a Chinese name.


// 按 appId 修复注册表中异常的中英文名（并行获取官方名，一次修复两个字段）。
// 中文名异常时仅当 Steam 官方确实有中文名才覆盖（Steam 无中文名的游戏保持原值）。
// Self-heal abnormal CN/EN names by appId (parallel fetch, one pass). The CN
// name is overwritten only when Steam itself provides a Chinese name.
export async function healRegistryNames(appId, { cnName, enName, gameName }) {
  if (!appId) return false;
  const cnOk = cnName && /[\u4e00-\u9fff]/.test(cnName);
  const enOk = enName && /[A-Za-z]{2,}/.test(enName);
  if (cnOk && enOk) return false; // 正常，无需修复 / healthy
  try {
    const [cnData, enData] = await Promise.all([
      fetchSteamAppDetails(appId, 'schinese').catch(() => null),
      fetchSteamAppDetails(appId, 'english').catch(() => null)
    ]);
    const officialCn = (cnData && cnData.name) || '';
    const officialEn = (enData && enData.name) || '';
    const newCn = (!cnOk && officialCn && /[\u4e00-\u9fff]/.test(officialCn)) ? officialCn : cnName;
    const newEn = (!enOk && officialEn && /[A-Za-z]{2,}/.test(officialEn)) ? officialEn : (enName || cnName);
    if (newCn !== cnName || newEn !== enName) {
      await recordGameInRegistry(appId, {
        cnName: newCn || '',
        enName: newEn || '',
        gameName: gameName || ''
      });
      Logger.warn('Steam', `名称异常自愈: appId ${appId} cn "${cnName || '空'}"→"${newCn || '空'}" en "${enName || '空'}"→"${newEn || '空'}"`);
      return true;
    }
  } catch {
    // 获取失败，下次访问时重试 / retry on the next visit
  }
  return false;
}

// 缓存命中路径的名称自愈入口（兼容旧调用语义）
// Self-heal entry for cache-hit paths (keeps the old call shape)


// 缓存命中路径的名称自愈入口（兼容旧调用语义）
// Self-heal entry for cache-hit paths (keeps the old call shape)
export async function ensureValidRegistryNames(appId, cnName, enName, gameName) {
  await healRegistryNames(appId, { cnName, enName, gameName });
}

// 批量自愈：扫描注册表中名称异常（中文名无中文/英文名无英文）的条目，分批修复
// Batch self-heal: scan the registry for abnormal names and fix them in batches


// 批量自愈：扫描注册表中名称异常（中文名无中文/英文名无英文）的条目，分批修复
// Batch self-heal: scan the registry for abnormal names and fix them in batches
export async function scanAndHealRegistry(limit = 20) {
  const registry = await getGameRegistry();
  const abnormal = Object.entries(registry).filter(([, e]) => {
    const cnBad = !hasChineseChars(e.cnName);
    const enBad = !hasLatinLetters(e.enName);
    return cnBad || enBad;
  });
  const targets = abnormal.slice(0, limit);
  let healed = 0;
  for (let i = 0; i < targets.length; i += 3) {
    const batch = targets.slice(i, i + 3);
    await Promise.all(batch.map(async ([appId, e]) => {
      try {
        if (await healRegistryNames(appId, { cnName: e.cnName, enName: e.enName, gameName: '' })) healed++;
      } catch { /* 单条失败不阻断 */ }
    }));
  }
  if (healed > 0) await flushRegistry();
  return { scanned: targets.length, healed, remaining: abnormal.length - targets.length };
}

// 选择注册表英文名：优先下载站标题中的英文段，回退 Steam 官方英文名
// （实现在 title-parser.js，此处不重复定义）
// (EN-name picking lives in title-parser.js; not duplicated here)

