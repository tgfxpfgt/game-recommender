/**
 * Game Recommender - ESLint 配置（v3.3.9）
 *
 * 浏览器扩展无构建体系：经典内容脚本（IIFE + 全局命名空间）与后台 ES module
 * 并存，故关闭未使用变量/全局命名空间相关规则，聚焦语法错误与常见隐患。
 * Run: npm run lint
 */
export default [
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // 浏览器环境 / browser globals
        window: 'readonly', document: 'readonly', navigator: 'readonly',
        location: 'readonly', globalThis: 'readonly', console: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly',
        clearInterval: 'readonly', fetch: 'readonly', URL: 'readonly',
        DOMParser: 'readonly', MutationObserver: 'readonly', NodeFilter: 'readonly',
        ResizeObserver: 'readonly', IntersectionObserver: 'readonly',
        AbortController: 'readonly', Element: 'readonly',
        alert: 'readonly', confirm: 'readonly',
        Blob: 'readonly', FileReader: 'readonly', TextEncoder: 'readonly',
        crypto: 'readonly',
        // 扩展 API / extension APIs
        chrome: 'readonly',
        // 内容脚本全局命名空间 / content-script namespaces
        __GR__: 'readonly', __OPTS__: 'readonly',
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
        escapeHtml: 'readonly', escapeAttr: 'readonly',
        // Node 测试环境 / Node test env
        process: 'readonly', module: 'readonly', require: 'readonly', __dirname: 'readonly'
      }
    },
    rules: {
      // 常见错误 / common errors
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-func-assign': 'error',
      'no-cond-assign': ['error', 'except-parens'],
      // 风格（宽松）/ style (lenient)
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', argsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['tests/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly', console: 'readonly', setTimeout: 'readonly',
        fetch: 'readonly', URL: 'readonly', globalThis: 'readonly',
        navigator: 'readonly', document: 'readonly', window: 'readonly',
        MutationObserver: 'readonly', NodeFilter: 'readonly', location: 'readonly'
      }
    }
  }
];
