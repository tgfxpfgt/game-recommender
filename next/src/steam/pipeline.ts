/**
 * game-radar v2 — 统一解析管线
 * The ONE pipeline for list badges and detail float (old world had two
 * orchestrators with drifting shared semantics; new world has one).
 *
 * 顺序：平台识别（零网络短路）→ 评分提供方（缓存 → 提供方）→ 三态终态。
 */
import type { RatingProvider, TitleResolution } from './types.js';
import { detectPlatform } from './platforms.js';

/** TTL 缓存（内存级；SW 生命周期即缓存生命周期——可接受，正缓存 24h 意义在跨访问） */
class TtlCache<V> {
  private readonly map = new Map<string, { value: V; expireAt: number }>();
  constructor(
    private readonly ttlMs: number,
    private readonly max = 500
  ) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expireAt) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expireAt: Date.now() + this.ttlMs });
  }

  get size(): number {
    return this.map.size;
  }
}

export interface PipelineStats {
  resolved: number;
  cacheHits: number;
  provider: string;
}

export class Pipeline {
  private readonly cache = new TtlCache<TitleResolution>(24 * 3600e3);
  private readonly stats: PipelineStats;

  constructor(private readonly provider: RatingProvider) {
    this.stats = { resolved: 0, cacheHits: 0, provider: provider.id };
  }

  getStats(): PipelineStats {
    return { ...this.stats };
  }

  /** 批量解析（去重 + 缓存优先 + 未命中批量交提供方） */
  async resolve(titles: string[]): Promise<Record<string, TitleResolution>> {
    const results: Record<string, TitleResolution> = {};
    const pending: string[] = [];
    const seen = new Set<string>();

    for (const raw of titles) {
      const title = raw.trim();
      if (!title || seen.has(title)) continue;
      seen.add(title);
      // 平台识别：零网络短路（模拟器 ROM 必错配；主机独占 Steam 无数据）
      const platform = detectPlatform(title);
      if (platform) {
        const terminal: TitleResolution =
          platform.platform === 'emulator'
            ? { kind: 'platform', title, platform: 'emulator', tag: platform.tag, metascore: null }
            : { kind: 'platform', title, platform: 'console', tag: platform.tag, metascore: null };
        results[title] = terminal;
        continue;
      }
      const cached = this.cache.get(title);
      if (cached) {
        this.stats.cacheHits++;
        results[title] = cached;
        continue;
      }
      pending.push(title);
    }

    if (pending.length > 0) {
      let resolved: TitleResolution[];
      try {
        resolved = await this.provider.resolve(pending);
      } catch {
        resolved = pending.map((t): TitleResolution => ({ kind: 'failed', title: t, error: 'network' }));
      }
      for (const r of resolved) {
        results[r.title] = r;
        // 仅正缓存命中态（not-found/failed 不缓存——失败未知语义，重试由下次访问自然发生）
        if (r.kind === 'steam' || r.kind === 'platform') this.cache.set(r.title, r);
      }
    }

    this.stats.resolved += Object.keys(results).length;
    return results;
  }
}
