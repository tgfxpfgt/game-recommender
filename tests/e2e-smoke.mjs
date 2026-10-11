/**
 * 游戏雷达 Game Radar - E2E 冒烟入口（re-export 壳）
 *
 * 第五轮 B9 拆分：实现迁至 tests/e2e/（helpers + section-* + run 聚合），
 * 本壳保持 `npm run e2e` 的脚本路径不变（消费面兼容纪律）。
 * Thin shell keeping `npm run e2e` stable; implementation lives in tests/e2e/.
 */
import './e2e/run.mjs';
