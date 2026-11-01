/**
 * 游戏雷达 Game Radar - Metacritic 评分源（v14.10.0，用户指令：非 PC 平台条目
 * 评分"优先从 metacritic 获取"）
 *
 * 主机/模拟器条目不走 Steam 检索（见 shared/platform-detect.js）——主机游戏
 * 评分从 Metacritic 取：**规范 slug 由英文名推导**（小写/剥标点/空格转连字符，
 * 实测 the-legend-of-zelda-tears-of-the-kingdom/elden-ring 等全命中），分数
 * 在页面嵌入 JSON 的 "ratingValue":"N"。无 UA 亦可达（实测 200）。
 * 命中缓存 24h / 无分与 404 负缓存 6h（TTL 内不重打）。Metacritic 无官方
 * API——标记页面结构变更敏感点：分数提取依赖 "ratingValue"。
 */
import { fetchWithTimeout } from '../core/utils.js';
import { ENDPOINTS, PERF_CONFIG } from '../core/constants.js';
import { createTtlCache } from '../core/mechanisms.js';
import { Logger } from '../storage/logger.js';

const MC_HIT_TTL_MS = 24 * 3600e3;
const MC_MISS_TTL_MS = 6 * 3600e3;
const mcCache = createTtlCache({ ttlMs: MC_HIT_TTL_MS, max: 300 });
const mcMissCache = createTtlCache({ ttlMs: MC_MISS_TTL_MS, max: 300 });

/**
 * 英文名 → metacritic 规范 slug（纯函数，可单测）。
 * 规则实测：小写；& → and；剥除其余标点；空白折叠为连字符。
 * @param {string} enName @returns {string}
 */
export function deriveMetacriticSlug(enName) {
  return String(enName || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * 查询 Metacritic 媒体评分（Metascore）。无分/404/网络失败 → null（负缓存）。
 * @param {string} enName @returns {Promise<number|null>}
 */
export async function fetchMetacriticScore(enName) {
  const slug = deriveMetacriticSlug(enName);
  if (!slug || slug.length < 3) return null;
  const hit = mcCache.peek(slug);
  if (hit !== undefined) return hit;
  const miss = mcMissCache.peek(slug);
  if (miss !== undefined) return null;
  try {
    const resp = await fetchWithTimeout(
      `${ENDPOINTS.metacritic}/game/${slug}/`,
      {},
      PERF_CONFIG.fetchTimeoutLastUpdateMs
    );
    if (!resp.ok) {
      mcMissCache.set(slug, null);
      return null;
    }
    const html = await resp.text();
    const m = html.match(/"ratingValue"\s*:\s*"?(\d+)"?/);
    if (!m) {
      // 页面存在但无 Metascore（新游戏评测不足——Steam 低评测同语义，负缓存）
      mcMissCache.set(slug, null);
      Logger.info('Steam', `Metacritic 无分: ${slug}`);
      return null;
    }
    const score = Math.min(100, Number(m[1]));
    mcCache.set(slug, score);
    Logger.info('Steam', `Metacritic 命中: ${slug} → ${score}`);
    return score;
  } catch {
    mcMissCache.set(slug, null);
    return null;
  }
}
