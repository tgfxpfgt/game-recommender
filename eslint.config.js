/**
 * 游戏雷达 Game Radar - ESLint 配置（v3.3.9 起；v4.1.2 增强）
 *
 * 浏览器扩展无构建体系：经典内容脚本（IIFE + 全局命名空间）与后台 ES module
 * 并存，故关闭未使用变量/全局命名空间相关规则，聚焦语法错误与常见隐患。
 * v4.1.2：no-unused-vars 升 error（当前代码 0 警告）；补零风险风格规则。
 * v10.5.0 P1-E：抽出共享 globals/rules，让 tests 目录下的 .mjs 测试文件也纳入
 * 错误级正确性规则（此前测试匹配不到规则块 = 完全不被 lint）。
 * Run: npm run lint
 */

// 浏览器 + 扩展 + Node 测试环境共享全局 / shared globals (browser + ext + node test)
const baseGlobals = {
  // 浏览器环境 / browser globals
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  globalThis: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  DOMParser: 'readonly',
  MutationObserver: 'readonly',
  Event: 'readonly',
  NodeFilter: 'readonly',
  ResizeObserver: 'readonly',
  IntersectionObserver: 'readonly',
  AbortController: 'readonly',
  Element: 'readonly',
  KeyboardEvent: 'readonly', // v10.5.0 P1-E：e2e-smoke.mjs 使用
  alert: 'readonly',
  confirm: 'readonly',
  Blob: 'readonly',
  FileReader: 'readonly',
  TextEncoder: 'readonly',
  crypto: 'readonly',
  history: 'readonly', // v7.0.5：hub.js 使用（浏览器全局，此前漏声明致误报）
  // 扩展 API / extension APIs
  chrome: 'readonly',
  // 内容脚本全局命名空间 / content-script namespaces
  __GR__: 'readonly',
  __OPTS__: 'readonly',
  __GAME_RECOMMENDER_SITES__: 'readonly',
  __GAME_RECOMMENDER_PLATFORMS__: 'readonly',
  __GAME_RECOMMENDER_SITE_XDGAME__: 'readonly',
  __GAME_RECOMMENDER_SITE_XIANYUDANJI__: 'readonly',
  __GAME_RECOMMENDER_SITE_GAMER520__: 'readonly',
  __GAME_RECOMMENDER_SITE_3DMGAME__: 'readonly',
  __GAME_RECOMMENDER_SITE_ALI213__: 'readonly',
  __GAME_RECOMMENDER_SITE_GAMERSKY__: 'readonly',
  __GAME_RECOMMENDER_PLATFORM_STEAM__: 'readonly',
  __GR_PATTERNS__: 'readonly',
  escapeHtml: 'readonly',
  escapeAttr: 'readonly',
  // Node 测试环境 / Node test env
  process: 'readonly',
  module: 'readonly',
  require: 'readonly',
  __dirname: 'readonly',
  vi: 'readonly', // v10.5.0 P1-E：test-content-sim.mjs 引用 vitest 的 vi
  performance: 'readonly'
};

// 错误级正确性规则（源码 + 测试共用）/ shared correctness rules
const baseRules = {
  'no-undef': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-duplicate-case': 'error',
  'no-unreachable': 'error',
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-func-assign': 'error',
  'no-cond-assign': ['error', 'except-parens'],
  eqeqeq: ['error', 'smart'],
  'no-var': 'error',
  'prefer-const': 'error',
  'no-extra-semi': 'error'
};

export default [
  {
    // v10.2.0：第三方 vendored 库（lib/vendor/**）豁免 lint——压缩产物不适用
    // 源码风格规则（no-var/eqeqeq 等）
    ignores: ['lib/vendor/**']
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: baseGlobals
    },
    rules: {
      ...baseRules,
      // v4.1.2 增强：未使用变量升 error（代码已 0 警告，防新污染）
      'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_', argsIgnorePattern: '^_' }]
      // 注：curly 未启用——项目单行语句花括号风格混合（约 196 处），
      // 强制规则需大规模自动修复制造 diff 噪音，暂以现状为准
    }
  },
  // v10.5.0 P1-E：测试文件（.mjs）纳入错误级正确性规则——此前 `**/*.js` 不匹配
  // .mjs、旧测试块无 rules，导致测试完全不被 lint。正确性规则全开；
  // 仅 no-unused-vars 降 warn（测试惯用临时 mock/未用断言变量较多，容忍之）。
  // Lint test files with correctness rules; relax unused-vars to warn only.
  {
    files: ['tests/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: baseGlobals
    },
    rules: {
      ...baseRules,
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', argsIgnorePattern: '^_' }]
    }
  }
];
