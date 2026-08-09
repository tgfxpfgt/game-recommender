/**
 * Game Recommender - 适配规则读取 / Adapter Rules
 *
 * 下载站适配规则与平台规则：用户导入的 storage.adapterRules 优先，
 * 否则使用内置 adapters/ 目录文件（通过副作用 import 挂到 globalThis）。
 * Download-site adapter rules: user-imported storage.adapterRules wins,
 * otherwise the built-in adapters/ files (side-effect imported globals).
 */
import { dataStore } from '../../data/data-store.js';
import { DB_KEYS } from './constants.js';

let siteRulesCache = null;
let downloadSitesCache = null;

// 读取下载站适配规则 / Read download-site adapter rules
export async function getSiteRules() {
  if (siteRulesCache) return siteRulesCache;
  try {
    const imported = await dataStore.readModule(DB_KEYS.ADAPTER_RULES);
    siteRulesCache = (imported && imported.version && Array.isArray(imported.sites) && imported.sites.length > 0)
      ? imported
      : (globalThis.__GAME_RECOMMENDER_SITES__ || { version: 1, sites: [] });
  } catch (e) {
    siteRulesCache = globalThis.__GAME_RECOMMENDER_SITES__ || { version: 1, sites: [] };
  }
  return siteRulesCache;
}

// 读取平台规则（steam/epic/gog） / Read platform rules
export function getPlatformRules() {
  return globalThis.__GAME_RECOMMENDER_PLATFORMS__ || {};
}

// 下载站配置（含站内搜索的站点，从规则构建）/ Download-site config (searchable sites)
export async function getDownloadSites() {
  if (downloadSitesCache) return downloadSitesCache;
  const rules = await getSiteRules();
  downloadSitesCache = (rules.sites || [])
    .filter(s => s.searchUrl)
    .map(s => ({
      key: s.key,
      name: s.name,
      searchUrl: q => s.searchUrl.replace('{q}', encodeURIComponent(q)),
      base: s.base
    }));
  return downloadSitesCache;
}

// 重置规则缓存（导入适配规则后调用）/ Reset rule caches (after importing rules)
export function resetRulesCache() {
  siteRulesCache = null;
  downloadSitesCache = null;
}
