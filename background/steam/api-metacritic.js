/**
 * 游戏雷达 Game Radar - Metacritic 评分源（v14.10.0，用户指令：非 PC 平台条目
 * 评分"优先从 metacritic 获取"）
 *
 * 主机/模拟器条目不走 Steam 检索（见 shared/platform-detect.js）——主机游戏
 * 评分从 Metacritic 取：**规范 slug 由英文名推导**（小写/剥标点/空格转连字符，
 * 实测 the-legend-of-zelda-tears-of-the-kingdom/elden-ring 等全命中）。
 * 命中缓存 24h / 无分与 404 负缓存 6h（TTL 内不重打）。Metacritic 无官方
 * API——标记页面结构变更敏感点：分数提取依赖 "ratingValue"。
 *
 * v14.42.5（用户指令：MC 双分显示 + steamMissing 详情页 MC 详情）：单次抓取
 * 升级为全量详情解析——媒体分（ld+json aggregateRating.ratingValue，0-100）、
 * 用户分（aria-label="User score X out of 10"，0-10 制一位小数，2026-11 现网
 * 双页取证 elden-ring 8.5/dragoon 8.7）、评论数与结构化详情（name/genre/
 * gamePlatform/datePublished/publisher/description，均出自同一 ld+json）。
 * 锚点敏感点：用户分唯一可靠锚 = aria-label（data-testid="global-score-value"
 * 媒体分块复用同一 testid，不可作用户分锚点）。
 * v14.42.5: single-fetch full parsing — metascore (ld+json) + user score
 * (aria-label anchor; the global-score-value testid is REUSED by the
 * metascore block and must not be used as the user-score anchor) + structured
 * details from the same ld+json blob.
 */
import { fetchWithTimeout } from '../core/utils.js';
import { ENDPOINTS, PERF_CONFIG } from '../core/constants.js';
import { createTtlCache } from '../core/mechanisms.js';
import { Logger } from '../storage/logger.js';

const MC_HIT_TTL_MS = 24 * 3600e3;
const MC_MISS_TTL_MS = 6 * 3600e3;
/** @type {ReturnType<typeof createTtlCache>} 缓存值 = McDetails 对象 */
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

/** @typedef {{metascore: number|null, userScore: number|null, criticCount: number|null, mcName: string, slug: string, genres: string[], platforms: string[], releaseDate: string, publishers: string[], description: string}} McDetails */

// ld+json 块提取（页面首个 application/ld+json = VideoGame schema）
/** @param {string} html @returns {Record<string, any>} */
function parseLdJson(html) {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) return {};
  try {
    return JSON.parse(m[1]);
  } catch {
    return {};
  }
}

// 用户分提取：aria-label 锚（媒体分块复用 global-score-value testid，勿用）
/** @param {string} html @returns {number|null} */
function parseUserScore(html) {
  const m = html.match(/aria-label="User score (\d+(?:\.\d+)?) out of 10"/);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

/**
 * 查询 Metacritic 详情（媒体分 + 用户分 + 结构化信息，单次抓取）。
 * 页面不存在/无 Metascore/网络失败 → null（负缓存）。
 * @param {string} enName @returns {Promise<McDetails|null>}
 */
export async function fetchMetacriticDetails(enName) {
  const slug = deriveMetacriticSlug(enName);
  if (!slug || slug.length < 3) return null;
  const hit = /** @type {McDetails|undefined} */ (mcCache.peek(slug));
  if (hit !== undefined) return hit;
  const miss = mcMissCache.peek(slug);
  if (miss !== undefined) return null;
  try {
    const resp = await fetchWithTimeout(
      `${ENDPOINTS.metacritic}/game/${slug}/`,
      {},
      PERF_CONFIG.fetchTimeoutMetacriticMs
    );
    if (!resp.ok) {
      // v14.29.2（用户报告：主机游戏 MC 评分不显示）：失败必须可诊断——
      // 根因实证：manifest host_permissions 缺 metacritic.com 时 MV3 SW fetch
      // 被 CORS 拦截（TypeError Failed to fetch），旧实现静默进负缓存 =
      // "功能从未生效但零日志"（铁律 15 同类：只吞错不落账的机制等于不存在）。
      mcMissCache.set(slug, null);
      Logger.warn('Steam', `Metacritic 请求失败: ${slug} → HTTP ${resp.status}`);
      return null;
    }
    const html = await resp.text();
    const ld = parseLdJson(html) || {};
    const m =
      ld && ld.aggregateRating && ld.aggregateRating.ratingValue !== undefined
        ? ld.aggregateRating
        : html.match(/"ratingValue"\s*:\s*"?(\d+)"?/);
    if (!ld && !m) {
      // 页面存在但无 Metascore（新游戏评测不足——Steam 低评测同语义，负缓存）
      mcMissCache.set(slug, null);
      Logger.info('Steam', `Metacritic 无分: ${slug}`);
      return null;
    }
    const agg = ld && ld.aggregateRating ? ld.aggregateRating : null;
    /** @type {McDetails} */
    const details = {
      metascore: agg ? Math.min(100, Number(agg.ratingValue)) : Math.min(100, Number(/** @type {any} */ (m)[1])),
      userScore: parseUserScore(html),
      criticCount: agg && agg.reviewCount != null ? Number(agg.reviewCount) : null,
      mcName: String((ld && ld.name) || enName),
      slug,
      genres: Array.isArray(ld && ld.genre) ? ld.genre.map(String) : ld && ld.genre ? [String(ld.genre)] : [],
      platforms: Array.isArray(ld && ld.gamePlatform) ? ld.gamePlatform.map(String) : [],
      releaseDate: String((ld && ld.datePublished) || ''),
      publishers: Array.isArray(ld && ld.publisher)
        ? ld.publisher
            .map((/** @type {any} */ p) => String(p && p.name))
            .filter(Boolean)
            .slice(0, 2)
        : ld && ld.publisher
          ? [String(ld.publisher)]
          : [],
      // 简介截断 300 字（负缓存条目体积有界）
      description: String((ld && ld.description) || '').slice(0, 300)
    };
    mcCache.set(slug, details);
    Logger.info('Steam', `Metacritic 命中: ${slug} → 媒体 ${details.metascore} / 用户 ${details.userScore}`);
    return details;
  } catch (e) {
    // v14.29.2：网络异常落 warn（CORS 拦截/超时/DNS——此前静默吞错，
    // 主机条目 MC 评分功能失效五个月不可见，first-run 门禁即为此类事故设）
    mcMissCache.set(slug, null);
    const msg = e instanceof Error ? e.message : String(e);
    Logger.warn('Steam', `Metacritic 异常: ${slug} → ${msg.slice(0, 120)}`);
    return null;
  }
}

/**
 * 查询 Metacritic 媒体评分（Metascore）。无分/404/网络失败 → null（负缓存）。
 * v14.42.5：退化为 fetchMetacriticDetails 的媒体分快捷视图（单源单次抓取）。
 * @param {string} enName @returns {Promise<number|null>}
 */
export async function fetchMetacriticScore(enName) {
  const details = await fetchMetacriticDetails(enName);
  return details ? details.metascore : null;
}
