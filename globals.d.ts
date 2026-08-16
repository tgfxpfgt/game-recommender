/**
 * Game Recommender - UI/内容层全局声明 / UI & Content Global Declarations
 *
 * v6.3.2（B1）：供 tsconfig.ui.json 的 checkJs 编译期检查——chrome API 与
 * 各命名空间全局（经典脚本注入的共享对象）。刻意宽松（any 级别）——
 * 形状由注入顺序与运行时保证，此处仅满足类型解析。
 * Loose declarations for UI/content checkJs: chrome API and namespace globals
 * injected by classic scripts. Deliberately any-typed.
 */

// 全局命名空间（globalThis.X 访问需 declare global）/ namespace globals
declare global {
  var __GR__: any; // 内容脚本命名空间（v6.0.0 起退场，兼容旧引用）
  var GR: any;
  var __GAME_RECOMMENDER_SITES__: any; // 适配规则（adapters 经典注入）
  var __GR_PATTERNS__: any; // 共享模式（shared/patterns.js 经典注入）
  var __OPTS__: any; // 设置页命名空间（options 经典脚本共享）
  var __gameRecommenderTracker: boolean; // tracker 防重入守卫
  var __grBootPromise: Promise<any>; // v8.2.0：tracker boot 就绪信号（测试等待用）
  var __GR_MSG__: { sendMessage: (action: any, payload?: any, opts?: { timeout?: number }) => Promise<any> }; // v8.2.0：统一消息层
  interface Element {
    href?: any;
  } // 下载站链接元素（锚点属性宽松）
  var escapeHtml: (text: string) => string; // shared/escape.js 经典注入
  var __GR_SETTINGS_UTILS__: any; // shared/settings-utils.js（补丁保存/主题/跳转）
  var escapeAttr: (text: string) => string;
  // UI 层 DOM 访问宽松化（v6.3.2 决策）：UI 脚本风格代码中元素存在性/具体
  // 类型由浏览器运行时保证，此处降级 any 消除噪音——类型化价值聚焦业务
  // 字段与消息形状（DOM 语义检查放弃，注释记录决策）
  interface Document {
    querySelector(selectors: string): any;
    querySelectorAll(selectors: string): any;
    getElementById(elementId: string): any;
  }
  interface Node {
    querySelector(selectors: string): any;
    querySelectorAll(selectors: string): any;
    appendChild<T extends Node>(node: T): T;
    removeChild<T extends Node>(child: T): T;
  }
}

export {};
