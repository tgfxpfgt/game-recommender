/**
 * Game Recommender - Vitest 配置 / Vitest Config
 *
 * v6.0.0：content 目录模块以原生 Node ESM 加载（inline）——tracker 经典入口
 * 的变量动态 import（import(chrome.runtime.getURL(...))）在 vite-node 转换下
 * 会被拦截（"dynamic import callback not specified"），inline 绕过转换。
 * Content modules load as native Node ESM (inline): the tracker entry's
 * variable dynamic imports bypass vite-node transformation this way.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    server: {
      deps: {
        inline: [/\/content\//]
      }
    },
    testTimeout: 120000
  }
});
