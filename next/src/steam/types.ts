/**
 * game-radar v2 — 领域类型（唯一事实源）
 * Domain types: the single definition of every user-visible semantic.
 *
 * 设计原则：结果一律判别联合（discriminated union），三态语义（命中/确认无/
 * 失败未知）由类型系统强制——消费方 switch 穷尽后不可能把失败渲染成"未找到"。
 * Discriminated unions force the three-state semantics at the type level.
 */

/** Steam 数字 AppID */
export type AppId = number;

/** 匹配置信度：confirmed = 标题强匹配；suspected = 弱匹配（UI 必须标注） */
export type MatchConfidence = 'confirmed' | 'suspected';

/** 非 PC 平台种类（主机 = 可试 MC 评分；模拟器 = ROM 包，无评分语义） */
export type PlatformKind = 'console' | 'emulator';

/** 近 30 天评价摘要 */
export interface RecentReviews {
  rate: number; // 0-100
  total: number;
}

/** 命中 Steam 条目 */
export interface SteamHit {
  kind: 'steam';
  appId: AppId;
  name: string; // Steam 官方名
  positiveRate: number | null; // null = 暂无整体评价（低评测/新游）
  totalReviews: number;
  recent: RecentReviews | null;
  confidence: MatchConfidence;
  /** 置信度依据（悬停展示） */
  reason: string;
}

/** 非 PC 平台条目（主机/模拟器——不走 Steam 检索） */
export interface PlatformEntry {
  kind: 'platform';
  platform: PlatformKind;
  /** 徽章标签（Switch/PS5/模拟器…） */
  tag: string;
  /** Metacritic 媒体评分；null = 暂无 */
  metascore: number | null;
}

/** 确认 Steam 无此游戏（负缓存可兜底） */
export interface NotFound {
  kind: 'not-found';
}

/** 失败未知（网络/限流——禁止渲染成"未找到"） */
export interface LookupFailed {
  kind: 'failed';
  error: 'network' | 'ratelimit' | 'timeout';
}

/** 单个标题的解析终态（功能语义 = 旧管线，形态 = 全新判别联合） */
export type TitleResolution = (SteamHit | PlatformEntry | NotFound | LookupFailed) & {
  /** 输入标题原文（键） */
  title: string;
};

/** 评价提供方接口——fixture（确定性）与 Steam 真源同签名 */
export interface RatingProvider {
  readonly id: string;
  /** 按规范标题批量解析（管线内部自行处理并发/缓存/预算） */
  resolve(titles: string[]): Promise<TitleResolution[]>;
}
