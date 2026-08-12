/**
 * Game Recommender - chrome API 全局声明 / Chrome API Global Declarations
 *
 * v5.0.0：供 tsc checkJs 编译期检查（core/ 层被 data-store 依赖解析时
 * 需要 chrome 全局）。刻意宽松（any 级别）——扩展 API 形状由
 * chrome.runtime 运行时保证，此处仅满足类型解析。
 * Loose chrome declaration for tsc checkJs (data-store is pulled in through
 * core's imports). Deliberately any-typed; runtime shape is guaranteed by the
 * extension APIs.
 */
declare const chrome: any;
