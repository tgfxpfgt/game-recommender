/**
 * 游戏雷达 Game Radar - Vitest 配置 / Vitest Config
 *
 * v6.0.0：content 目录模块以原生 Node ESM 加载（inline）——tracker 经典入口
 * 的变量动态 import（import(chrome.runtime.getURL(...))）在 vite-node 转换下
 * 会被拦截（"dynamic import callback not specified"），inline 绕过转换。
 * Content modules load as native Node ESM (inline): the tracker entry's
 * variable dynamic imports bypass vite-node transformation this way.
 *
 * v6.1.0：include 显式列出 `test-` 前缀套件（vitest 默认 include 只匹配
 * `.test.` 后缀）；content-sim 排除（eval 模拟与 vite-node 不兼容，node 直跑）。
 * v6.1.1：13 套件全部纳入 vitest（4 个线性状态敏感套件结构化重写后
 * 兼容）；run-tests.js 仅剩 content-sim。
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    // v6.2.0：默认隔离 + 文件级并行——v6.1.1 结构化重写后各套件已自包含
    //（chrome/storage mock 各自安装还原、模块实例按文件独立），无需串行共享；
    // 隔离开启后跨文件状态竞态（防抖延迟写落点依赖执行时序）一并消除
    // v6.4.10：content-sim 高负载与并行文件 CPU 竞争致节 2/2b 偶发超时——串行。
    // v8.2.0：P0-1 根治后恢复并行；v9.1.0：测试集增长（615 项）后并行负载再次
    // 吃满 20s 余量（节 2/2b 偶发超时回归）——回退串行，稳定性优先（~15s 可接受）
    fileParallelism: false,
    isolate: true,
    include: [
      // v6.2.0：14 个套件全部由 vitest 收集（content-sim 经 __grImport
      // 注入兼容 eval 动态 import，单 runner 全量统一）
      'tests/unit/test-title-parser.mjs',
      'tests/unit/test-engine.mjs',
      'tests/unit/test-contract.mjs',
      'tests/unit/test-trends.mjs',
      'tests/unit/test-freegames.mjs',
      'tests/unit/test-sites.mjs',
      'tests/unit/test-security.mjs',
      'tests/unit/test-api-pure.mjs',
      'tests/unit/test-rules-cleanup.mjs',
      'tests/unit/test-storage.mjs',
      'tests/unit/test-outbound.mjs',
      'tests/unit/test-properties.mjs',
      'tests/unit/test-migrate.mjs',
      'tests/unit/test-ui-pure.mjs',
      'tests/unit/test-ratings-resume.mjs',
      'tests/unit/test-health.mjs',
      'tests/unit/test-wiring.mjs',
      'tests/unit/test-settings-sync.mjs',
      'tests/integration/test-content-sim.mjs',
      'tests/integration/test-orchestrator.mjs',
      'tests/integration/test-handlers.mjs',
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
