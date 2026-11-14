/**
 * game-radar v2 — Steam 真源供配商
 * Steam provider: storesearch → candidate pick (similarity) → appreviews
 * (all-time + recent JSON, no HTML scraping). Negative cache 15min flat
 * (graded backoff is a later upgrade slot). Sequential per title; all HTTP
 * via injected net layer (throttle/breaker).
 *
 * 与旧世界对照：storesearch/appreviews 端点与三态语义等价；HTML 回退链
 * （商店页三形态）由 appreviews JSON 一条路径替代（更稳、更准）。
 */
import { parseTitleCandidates, titleSimilarity } from '../titles.js';
import { createNet, NetError } from '../net.js';
import type { RatingProvider, TitleResolution } from '../types.js';

const STORE = 'https://store.steampowered.com';
const NEGATIVE_TTL_MS = 15 * 60e3; // 旧负缓存首档（分级退避后续批次升级）
const MAX_SEARCH_TERMS = 3;
const CONFIRM_THRESHOLD = 0.6;

export interface SteamDeps {
  fetchImpl?: typeof fetch;
  breakerThreshold?: number;
  breakerOpenMs?: number;
  now?: () => number;
  minIntervalMs?: number;
}

interface SearchItem {
  type: string;
  name: string;
  id: number;
}

interface SearchResp {
  items?: SearchItem[];
}

interface QuerySummary {
  num_reviews?: number;
  total_positive?: number;
  total_negative?: number;
  total_reviews?: number;
}

interface AppReviewsResp {
  query_summary?: QuerySummary;
}

export function createSteamProvider(deps: SteamDeps = {}): RatingProvider {
  const net = createNet({
    fetchImpl: deps.fetchImpl ?? ((...a) => fetch(...a)),
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.minIntervalMs !== undefined ? { minIntervalMs: deps.minIntervalMs } : {}),
    ...(deps.breakerThreshold !== undefined ? { breakerThreshold: deps.breakerThreshold } : {}),
    ...(deps.breakerOpenMs !== undefined ? { breakerOpenMs: deps.breakerOpenMs } : {})
  });
  const now = deps.now ?? (() => Date.now());
  /** 标题 → 负缓存到期时刻（确认无值才入；失败未知不入） */
  const negative = new Map<string, number>();

  async function search(term: string): Promise<SearchItem[]> {
    const url = `${STORE}/api/storesearch/?term=${encodeURIComponent(term)}&l=schinese&cc=CN`;
    const data = await net.getJson<SearchResp>(url);
    return data.items ?? [];
  }

  async function reviewSummary(appId: number, filter: 'all' | 'recent'): Promise<QuerySummary | null> {
    const url =
      `${STORE}/appreviews/${appId}?json=1&num_per_page=0&language=all&purchase_type=all` +
      (filter === 'recent' ? '&filter=recent' : '');
    const data = await net.getJson<AppReviewsResp>(url);
    return data.query_summary ?? null;
  }

  async function resolveOne(title: string): Promise<TitleResolution> {
    if (now() < (negative.get(title) ?? 0)) {
      return { kind: 'not-found', title };
    }
    const candidates = parseTitleCandidates(title).slice(0, MAX_SEARCH_TERMS);
    if (candidates.length === 0) {
      negative.set(title, now() + NEGATIVE_TTL_MS);
      return { kind: 'not-found', title };
    }

    // 逐候选检索，合并去重（appId 键），择相似度最高者
    const byId = new Map<number, SearchItem>();
    let searchFailed = false;
    for (const term of candidates) {
      try {
        for (const item of await search(term)) {
          if (!byId.has(item.id)) byId.set(item.id, item);
        }
      } catch (e) {
        if (e instanceof NetError && e.code === 'circuit-open') throw e; // 熔断即终止本批
        searchFailed = true; // 单词网络失败 → 记录；仍有候选可继续
      }
    }

    const items = [...byId.values()].filter((it) => it.type === 'app' || it.type === 'game' || !it.type);
    let best: { item: SearchItem; sim: number } | null = null;
    for (const item of items) {
      const sim = titleSimilarity(item.name, title);
      if (!best || sim > best.sim) best = { item, sim };
    }
    if (!best || best.sim <= 0) {
      // 全候选零相关 → 确认无（负缓存）；但若检索本身网络失败，语义=失败未知
      if (searchFailed) return { kind: 'failed', title, error: 'network' };
      negative.set(title, now() + NEGATIVE_TTL_MS);
      return { kind: 'not-found', title };
    }

    const appId = best.item.id;
    const all = await reviewSummary(appId, 'all');
    const qs = all ?? null;
    if (!qs || !qs.total_reviews) {
      // 低评测/新游形态：positiveRate = null（与旧世界"暂无整体评价"语义一致）
      return {
        kind: 'steam',
        title,
        appId,
        name: best.item.name,
        positiveRate: null,
        totalReviews: 0,
        recent: null,
        confidence: best.sim >= CONFIRM_THRESHOLD ? 'confirmed' : 'suspected',
        reason: best.sim >= CONFIRM_THRESHOLD ? '标题强匹配' : `弱匹配（相似度 ${best.sim.toFixed(2)}）`
      };
    }
    let recent: { rate: number; total: number } | null = null;
    try {
      const rs = await reviewSummary(appId, 'recent');
      if (rs && rs.total_reviews) {
        recent = {
          rate: Math.round(((rs.total_positive ?? 0) / rs.total_reviews) * 100),
          total: rs.total_reviews
        };
      }
    } catch {
      /* 近期摘要失败不阻断主态（非用户关键数据） */
    }
    return {
      kind: 'steam',
      title,
      appId,
      name: best.item.name,
      positiveRate: Math.round(((qs.total_positive ?? 0) / qs.total_reviews) * 100),
      totalReviews: qs.total_reviews,
      recent,
      confidence: best.sim >= CONFIRM_THRESHOLD ? 'confirmed' : 'suspected',
      reason: best.sim >= CONFIRM_THRESHOLD ? '标题强匹配' : `弱匹配（相似度 ${best.sim.toFixed(2)}）`
    };
  }

  return {
    id: 'steam',
    async resolve(titles: string[]): Promise<TitleResolution[]> {
      const out: TitleResolution[] = [];
      for (const title of titles) {
        try {
          out.push(await resolveOne(title));
        } catch (e) {
          // 熔断开启/网络层异常：本批全部按失败未知语义（不缓存）
          const code = e instanceof NetError && e.code === 'circuit-open' ? 'ratelimit' : 'network';
          out.push({ kind: 'failed', title, error: code });
        }
      }
      return out;
    }
  };
}
