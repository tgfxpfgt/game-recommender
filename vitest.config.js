/**
 * Game Recommender - Vitest 配置 / Vitest Config
 *
 * v6.0.0：content 目录模块以原生 Node ESM 加载（inline）——tracker 经典入口
 * 的变量动态 import（import(chrome.runtime.getURL(...))）在 vite-node 转换下
 * 会被拦截（"dynamic import callback not specified"），inline 绕过转换。
 * Content modules load as native Node ESM (inline): the tracker entry's
 * variable dynamic imports bypass vite-node transformation this way.
 *
 * v6.1.0：include 显式列出 `test-` 前缀套件（vitest 默认 include 只匹配
 * `.test.` 后缀）；content-sim 排除（eval 模拟与 vite-node 不兼容，node 直跑）。
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    // v6.1.0：文件级串行 + 关闭隔离——测试依赖顺序执行与模块缓存共享
    //（跨文件共享 TTL 配置/审计缓冲等全局状态，与 node legacy 语义一致）
    fileParallelism: false,
    isolate: false,
    include: [
      // v6.1.0：9 个转换文件（check→test）；4 个线性状态敏感文件
      //（api-pure/outbound/storage/rules-cleanup）+ content-sim 由 node 直跑
      'tests/unit/test-title-parser.mjs',
      'tests/unit/test-engine.mjs',
      'tests/unit/test-contract.mjs',
      'tests/unit/test-trends.mjs',
      'tests/unit/test-freegames.mjs',
      'tests/unit/test-sites.mjs',
      'tests/unit/test-security.mjs',
      'tests/integration/test-orchestrator.mjs',
      'tests/integration/test-integrity.mjs'
    ],
    server: {
      deps: {
        // content/ 与 background/ 原生加载：模块共享单实例
        //（vite-node 转换会与测试的直接 import 分裂，导致全局状态互不可见）
        inline: [/\/content\//, /\/background\//]
      }
    },
    testTimeout: 120000
  }
});
