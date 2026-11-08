/**
 * 游戏雷达 Game Radar - Steam250 排名数据 / Steam250 Ranking Data
 *
 * v10.4.4（用户需求）：引入 steam250.com 排名信息到 Steam/下载站详情页。
 * 数据源：steam250.com/top250（服务端渲染榜单快照，每 24h 由站点重建），
 * 每行含排名/评分(10 分制)/评价数/商店链接——从商店链接提取 appId 建立
 * appId → {rank, score, votes} 映射。整表一次抓取覆盖全部 250 个游戏，
 * 快照持久化（OPFS 模块）+ 24h 刷新；抓取失败时静默用旧快照/无数据。
 * 注意：steam250 为第三方站点，页面结构变更会使解析失效——解析结果有
 * 数量下限校验（≥100），不足则弃用本次解析（保留旧快照）。
 * Steam250 top-250 snapshot: fetched once per 24h, parsed to an
 * appId → {rank, score, votes} map, persisted via the data store.
 */
import { fetchWithTimeout } from '../core/utils.js';
import { dataStore } from '../../data/data-store.js';
import { DB_KEYS, ENDPOINTS, PERF_CONFIG } from '../core/constants.js';
import { Logger } from '../storage/logger.js';

const TOP250_URL = ENDPOINTS.steam250Top250; // v10.7.0：端点单源
const REFRESH_MS = 24 * 3600 * 1000;
const MIN_ENTRIES = 100; // 解析数量下限（结构变更哨兵）

/** @type {Map<string, {rank: number, score: number, votes: number}>|null} */
let rankMap = null;
let mapUpdatedAt = 0;
/** @type {Promise<boolean>|null} */
let loading = null;

// 解析 top250 HTML（纯函数，可单测）——v14.21.0：steam250 重建页面后行结构
// 变更为行容器锚定制（旧锚点 "#N" 文本与 "N reviews" 关键词已双双消失，旧
// 解析器仅能凑出 10 条垃圾数据被哨兵拒绝 → 功能静默失效）。现行结构（2026-11
// 实测快照）每行为：
//   <div id=N><div class=rank>N</div>…<div class="score stat"><span>9.94</span>…
//   <span class=votes>1,050,323</span>…<div class="actions stat">
//   <a class=store href="https://store.steampowered.com/app/ID/?curator_clanid=…">
// 以 `<div id=N><div class=rank>` 行容器切分行段（站点渲染 250 行,属性引号
// 可选；约 1/10 行在排名数字前嵌排名变化指示 `<span class=+><span>+1</span>
// </span>`，一并兼容），行段内提取：排名（rank 容器文本）/评分（score stat
// 首个 span）/评价数（votes span，无则 0）/appId（行段内唯一商店链接）。结构
// 变更时条目数不足 MIN_ENTRIES 由调用方弃用。
export function parseSteam250Html(html) {
  const games = {};
  if (typeof html !== 'string' || html.length < 200) return games;
  const ROW_RE =
    /<div id="?(\d{1,4})"?><div class="?rank"?>\s*(?:<span[^>]*>\s*<span[^>]*>[+\-]?\d{1,4}<\/span>\s*<\/span>\s*)?(\d{1,4})\s*<\/div>/g;
  const rows = [...html.matchAll(ROW_RE)];
  for (let i = 0; i < rows.length; i++) {
    const rank = parseInt(rows[i][2], 10);
    const segEnd = i + 1 < rows.length ? rows[i + 1].index : html.length;
    const seg = html.slice(rows[i].index, segEnd);
    const idM = seg.match(/store\.steampowered\.com\/app\/(\d{2,7})/);
    // 评分锚定 score stat 容器首 span（免受价格 $9.99 干扰）；评价数锚定 votes span
    const scoreM = seg.match(/class="?score stat"?><span>([\d.]+)<\/span>/);
    const votesM = seg.match(/class="?votes"?>([\d,]+)</);
    if (!idM || !scoreM) continue;
    const score = parseFloat(scoreM[1]);
    const votes = votesM ? parseInt(votesM[1].replace(/,/g, ''), 10) || 0 : 0;
    if (rank > 0 && rank <= 1000 && score > 0 && score <= 10) games[idM[1]] = { rank, score, votes };
  }
  // 数量下限哨兵在调用方 ensureLoaded（≥MIN_ENTRIES 才采用；解析器保持纯函数）
  return games;
}

function buildMap(games) {
  rankMap = new Map();
  for (const [id, info] of Object.entries(games || {})) rankMap.set(String(id), info);
  mapUpdatedAt = Date.now();
}

async function ensureLoaded() {
  if (rankMap && Date.now() - mapUpdatedAt < REFRESH_MS) return true;
  if (loading) return loading;
  loading = (async () => {
    // 1. 快照缓存（24h 内直接用）
    try {
      const stored = await dataStore.readModule(DB_KEYS.STEAM250_RANK);
      if (stored && stored.games && Date.now() - (stored.updatedAt || 0) < REFRESH_MS) {
        buildMap(stored.games);
        mapUpdatedAt = stored.updatedAt || Date.now();
        return true;
      }
    } catch {
      /* 快照读取失败继续在线抓取 */
    }
    // 2. 在线抓取 top250（服务端渲染快照，无反爬；礼貌起见 24h 至多一次）
    try {
      const resp = await fetchWithTimeout(
        TOP250_URL,
        { headers: { Accept: 'text/html' } },
        PERF_CONFIG.fetchTimeoutSteam250Ms
      );
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const games = parseSteam250Html(await resp.text());
      // 数量下限哨兵（v10.4.4）：解析与校验分离——解析器保持纯函数可单测
      if (Object.keys(games).length < MIN_ENTRIES) {
        Logger.warn('Steam250', 'top250 解析条目不足（页面结构可能已变更），跳过本轮');
        return false;
      }
      buildMap(games);
      try {
        await dataStore.writeModule(DB_KEYS.STEAM250_RANK, {
          updatedAt: Date.now(),
          games // plain object（非 Map，JSON 可序列化）
        });
      } catch {
        /* 持久化失败不影响本次会话使用 */
      }
      Logger.info('Steam250', `top250 榜单已加载（${Object.keys(games).length} 个游戏）`);
      return true;
    } catch (e) {
      Logger.warn('Steam250', 'top250 抓取失败（功能静默降级）:', String(e));
      return false;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/**
 * 查询游戏的 Steam250 排名信息（带加载状态，v14.21.0）：loaded=false = 快照
 * 不可用（抓取/解析失败，UI 整行隐藏）；loaded=true 且 info=null = 已加载但
 * 该游戏未入前 250（UI 显示"未入榜"提示行，功能存在感可辨识）。
 * @param {string|number} appId
 * @returns {Promise<{loaded: boolean, info: {rank: number, score: number, votes: number}|null}>}
 */
export async function getSteam250Status(appId) {
  const key = String(appId || '');
  if (!key) return { loaded: false, info: null };
  const ok = await ensureLoaded();
  if (!ok || !rankMap) return { loaded: false, info: null };
  return { loaded: true, info: rankMap.get(key) || null };
}

/**
 * 查询游戏的 Steam250 排名信息（无记录/未加载返回 null）
 * @param {string|number} appId
 * @returns {Promise<{rank: number, score: number, votes: number}|null>}
 */
export async function getSteam250Info(appId) {
  const st = await getSteam250Status(appId);
  return st.info;
}

// 重置（测试/清除数据用）/ reset
export function resetSteam250() {
  rankMap = null;
  mapUpdatedAt = 0;
  loading = null;
}
