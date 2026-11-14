/**
 * game-radar v2 — Metacritic 评分源（主机条目评分）
 * MC fetch: slug derived from the EN name segment; score extracted from the
 * embedded "ratingValue" JSON on the game page. TTL: hit 24h / miss 6h
 * (与旧世界同参——声明态评分长期固化在管线 declared 映射，此处仅为拉取)。
 */
import { createNet } from './net.js';

const MC = 'https://www.metacritic.com';

/** 英文名 → MC 规范 slug（小写；&→and；剥标点；空白折叠为连字符） */
export function deriveMetacriticSlug(enName: string): string {
  return String(enName || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export interface MetacriticDeps {
  fetchImpl: typeof fetch;
}

export function createMetacritic(deps: MetacriticDeps) {
  const net = createNet({ fetchImpl: deps.fetchImpl, minIntervalMs: 300 });
  const hitCache = new Map<string, number>();
  const missCache = new Set<string>();

  /** 查询 Metascore。无分/404/异常 → null（负缓存 6h） */
  async function score(enName: string): Promise<number | null> {
    const slug = deriveMetacriticSlug(enName);
    if (slug.length < 3) return null;
    const hit = hitCache.get(slug);
    if (hit !== undefined) return hit;
    if (missCache.has(slug)) return null;
    try {
      const html = await net.getText(`${MC}/game/${slug}/`);
      const m = html.match(/"ratingValue"\s*:\s*"?(\d+)"?/);
      if (!m) {
        missCache.add(slug); // 页面在但无分（评测不足）——负缓存
        return null;
      }
      const score = Math.min(100, Number(m[1]));
      hitCache.set(slug, score);
      return score;
    } catch {
      missCache.add(slug);
      return null;
    }
  }

  return { score };
}

export type Metacritic = ReturnType<typeof createMetacritic>;
