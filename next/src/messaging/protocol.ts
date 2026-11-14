/**
 * game-radar v2 — 消息协议（类型化契约）
 * Typed messaging protocol: request/response pairs compile-checked at both ends.
 *
 * 与旧版差异：SCREAMING_CASE 散动作 → 命名空间化动作 + MessageMap 双端类型绑定；
 * 未知 action 默认拒绝（fail-closed）语义保留。
 */
import type { TitleResolution } from '../steam/types.js';

/** 命名空间化动作（domains/action） */
export interface MessageMap {
  /** 内容徽章批量解析（管线唯一入口） */
  'badges/resolve': {
    req: { titles: string[] };
    res: { results: Record<string, TitleResolution> };
  };
  /** 设置读取 */
  'settings/get': {
    req: Record<string, never>;
    res: { settings: Record<string, unknown> };
  };
  /** 运行统计（popup 展示） */
  'stats/get': {
    req: Record<string, never>;
    res: { stats: { resolved: number; cacheHits: number; provider: string } };
  };
}

/** 全部合法动作名（编译期穷尽） */
export type ActionName = keyof MessageMap & string;

/** 类型化请求构造 */
export type Request<A extends ActionName> = { action: A } & MessageMap[A]['req'];

/** 类型化响应提取 */
export type Response<A extends ActionName> = MessageMap[A]['res'];

/** 运行时消息形状（JSON 序列化边界） */
export interface AnyMessage {
  action: string;
  [k: string]: unknown;
}

/** 内容脚本（http 源）可发送的动作白名单——特权动作仅扩展页 */
export const CONTENT_ALLOWED: readonly ActionName[] = ['badges/resolve', 'settings/get'];
