/**
 * game-radar v2 — 统一解析管线
 * The ONE pipeline for list badges, detail float and platform declarations.
 *
 * 优先序：用户声明（declared，长期终态）→ 平台识别（零网络短路）→ 缓存 →
 * 评分提供方 → 三态终态。
 */
import { normalizeTitleKey } from './titles.js';
import { detectPlatform, resolvePlatformOption } from './platforms.js';
import { extractEnSegment } from './titles.js';
import type { DetailData, PlatformKind, RatingProvider, TitleResolution } from './types.js';

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

  drop(key: string): void {
    this.map.delete(key);
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

/** 用户声明的平台终态（内存映射；持久化在存储批次接入） */
interface DeclaredPlatform {
  kind: PlatformKind;
  tag: string;
  metascore: number | null;
  mcName: string | null;
}

export interface McSource {
  /** 按英文名查 Metascore（null = 无分） */
  score(enName: string): Promise<number | null>;
}

export class Pipeline {
  private readonly cache = new TtlCache<TitleResolution>(24 * 3600e3);
  private readonly stats: PipelineStats;
  /** 用户声明的平台映射——优先于一切识别与缓存（旧世界 manual-platforms 语义） */
  private readonly declared = new Map<string, DeclaredPlatform>();

  constructor(
    private readonly provider: RatingProvider,
    private readonly mc: McSource | null = null
  ) {
    this.stats = { resolved: 0, cacheHits: 0, provider: provider.id };
  }

  getStats(): PipelineStats {
    return { ...this.stats };
  }

  /**
   * 用户声明机型（手动机型声明——长期终态）：存映射 + 拉一次 MC 评分
   *（EN 段取标题英文名；无 EN 段/无分 → metascore null 不阻断声明）。
   */
  async declarePlatform(
    title: string,
    platformId: string
  ): Promise<{ kind: PlatformKind; tag: string; metascore: number | null }> {
    const option = resolvePlatformOption(platformId);
    if (!option) throw new Error(`非法机型: ${platformId}`);
    const key = normalizeTitleKey(title);
    const enSeg = extractEnSegment(title);
    const metascore =
      option.kind === 'console' && this.mc && enSeg ? await this.mc.score(enSeg).catch(() => null) : null;
    const declared: DeclaredPlatform = {
      kind: option.kind,
      tag: option.label,
      metascore,
      mcName: enSeg || null
    };
    this.declared.set(key, declared);
    this.cache.drop(title); // 声明终态覆盖任何缓存态
    return { kind: declared.kind, tag: declared.tag, metascore: declared.metascore };
  }

  /** 批量解析（去重 + 声明优先 + 平台识别 + 缓存优先 + 未命中批量交提供方） */
  async resolve(titles: string[]): Promise<Record<string, TitleResolution>> {
    const results: Record<string, TitleResolution> = {};
    const pending: string[] = [];
    const seen = new Set<string>();

    for (const raw of titles) {
      const title = raw.trim();
      if (!title || seen.has(title)) continue;
      seen.add(title);
      // 用户声明优先于一切识别与缓存（旧世界 manual-platforms 同语义）
      const declared = this.declared.get(normalizeTitleKey(title));
      if (declared) {
        results[title] = {
          kind: 'platform',
          title,
          platform: declared.kind,
          tag: declared.tag,
          metascore: declared.metascore
        };
        continue;
      }
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

  /**
   * 详情浮窗数据：声明态 → 平台自动识别（console 自动试 MC；emulator 零网络）
   * → 提供方 detail（有实现时）→ resolve 降级构造。
   */
  async detail(title: string): Promise<DetailData> {
    const declared = this.declared.get(normalizeTitleKey(title));
    if (declared) {
      return {
        kind: 'platform',
        title,
        platform: declared.kind,
        tag: declared.tag,
        metascore: declared.metascore,
        mcName: declared.mcName,
        source: 'declared'
      };
    }
    const platform = detectPlatform(title);
    if (platform?.platform === 'console' && this.mc) {
      // 自动识别的主机条目：MC 补查（标题 EN 段推导 slug；失败 → null 非阻断）
      const enSeg = extractEnSegment(title);
      const metascore = enSeg ? await this.mc.score(enSeg).catch(() => null) : null;
      return {
        kind: 'platform',
        title,
        platform: 'console',
        tag: platform.tag,
        metascore,
        mcName: metascore !== null ? enSeg : null,
        source: 'detected'
      };
    }
    if (platform?.platform === 'emulator') {
      return {
        kind: 'platform',
        title,
        platform: 'emulator',
        tag: platform.tag,
        metascore: null,
        mcName: null,
        source: 'detected'
      };
    }
    if (this.provider.detail) return this.provider.detail(title);
    // 提供方无 detail 实现 → resolve 降级构造（图/简介留空，alpha 形态）
    const r = (await this.resolve([title]))[title] ?? ({ kind: 'not-found', title } as TitleResolution);
    if (r.kind === 'steam') {
      return {
        kind: 'steam',
        title,
        appId: r.appId,
        name: r.name,
        headerImage: '',
        positiveRate: r.positiveRate,
        totalReviews: r.totalReviews,
        recent: r.recent,
        confidence: r.confidence,
        reason: r.reason,
        description: '',
        releaseDate: '',
        reviews: []
      };
    }
    if (r.kind === 'platform') {
      // resolve 侧平台终态（识别自标题）→ 详情形态补 detail 专属字段
      return {
        kind: 'platform',
        title,
        platform: r.platform,
        tag: r.tag,
        metascore: r.metascore,
        mcName: null,
        source: 'detected'
      };
    }
    const fallback: DetailData = { ...r };
    return fallback;
  }
}
