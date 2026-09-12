import { hasChineseChars, hasLatinLetters } from '../core/utils.js';
import { Logger } from '../storage/logger.js';
import { getGameRegistry, getGameRegistryEntry, recordGameInRegistry, flushRegistry } from '../storage/registry.js';
import { fetchSteamAppDetails } from './api-details.js';
import { DEMO_NAME_PATTERN } from './api-search.js';

// v10.5.2：自愈退避窗口与上限（防 Map 无界增长）/ heal backoff window & cap
const HEAL_BACKOFF_MS = 10 * 60 * 1000; // 10 分钟 / 10 minutes
const HEAL_BACKOFF_MAX = 500;
/** @type {Map<string, number>} */
const healAttemptedAt = new Map();

/**
 * 游戏雷达 Game Radar - Steam API 子模块：api-registry-heal.js
 *
 * v5.0.0：由 steam/api.js 按职能拆分。
 * v10.5.2：healRegistryNames 新增按 appId 的 10 分钟退避——上次尝试无改进
 * （Steam 不可达或官方确无对应语言名）时窗口内跳过重试，成功自愈即清除
 * 退避。缓存命中每次都会触发自愈检查，无退避则持续空耗 Steam 配额。
 * v10.5.2: per-appId heal backoff (10 min) — skip doomed retries after an
 * unimproved attempt; cache hits fire heal checks on every hit.
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
  // v10.5.2：自愈尝试退避——名称不健康且上次尝试未产生改进（Steam 不可达或
  // 官方确无对应语言名）时，窗口内不再重复发起 doomed 请求（缓存命中每次
  // 都会触发自愈，无退避则持续消耗 Steam API 配额并推高限流风险）。
  // Backoff per appId: a previous attempt that produced no improvement makes
  // retries pointless within the window (heal fires on every cache hit).
  const backoffKey = String(appId);
  const lastAttempt = healAttemptedAt.get(backoffKey);
  if (lastAttempt && Date.now() - lastAttempt < HEAL_BACKOFF_MS) return false;
  healAttemptedAt.set(backoffKey, Date.now());
  if (healAttemptedAt.size > HEAL_BACKOFF_MAX) {
    const oldest = healAttemptedAt.keys().next().value;
    if (oldest !== undefined) healAttemptedAt.delete(oldest);
  }
  try {
    const [cnData, enData] = await Promise.all([
      fetchSteamAppDetails(appId, 'schinese').catch(() => null),
      fetchSteamAppDetails(appId, 'english').catch(() => null)
    ]);
    const officialCn = (cnData && cnData.name) || '';
    const officialEn = (enData && enData.name) || '';
    const newCn = !cnOk && officialCn && /[\u4e00-\u9fff]/.test(officialCn) ? officialCn : cnName;
    const newEn = !enOk && officialEn && /[A-Za-z]{2,}/.test(officialEn) ? officialEn : enName || cnName;
    if (newCn !== cnName || newEn !== enName) {
      await recordGameInRegistry(appId, {
        cnName: newCn || '',
        enName: newEn || '',
        gameName: gameName || ''
      });
      healAttemptedAt.delete(backoffKey); // 成功自愈 → 清除退避 / healed: clear backoff
      Logger.warn(
        'Steam',
        `名称异常自愈: appId ${appId} cn "${cnName || '空'}"→"${newCn || '空'}" en "${enName || '空'}"→"${newEn || '空'}"`
      );
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
    await Promise.all(
      batch.map(async ([appId, e]) => {
        try {
          if (await healRegistryNames(appId, { cnName: e.cnName, enName: e.enName, gameName: '' })) healed++;
        } catch {
          /* 单条失败不阻断 */
        }
      })
    );
  }
  if (healed > 0) await flushRegistry();
  return { scanned: targets.length, healed, remaining: abnormal.length - targets.length };
}

// 选择注册表英文名：优先下载站标题中的英文段，回退 Steam 官方英文名
// （实现在 title-parser.js，此处不重复定义）
// (EN-name picking lives in title-parser.js; not duplicated here)
