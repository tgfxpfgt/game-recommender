/**
 * 游戏雷达 Game Radar - ESLint 配置（v3.3.9 起；v4.1.2 增强）
 *
 * 浏览器扩展无构建体系：经典内容脚本（IIFE + 全局命名空间）与后台 ES module
 * 并存，故关闭未使用变量/全局命名空间相关规则，聚焦语法错误与常见隐患。
 * v4.1.2：no-unused-vars 升 error（当前代码 0 警告）；补零风险风格规则。
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
        performance: 'readonly'
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
      // v4.1.2 增强：未使用变量升 error（代码已 0 警告，防新污染）
      'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      // v4.1.2：零风险风格规则 / zero-risk style rules
      eqeqeq: ['error', 'smart'], // 强制 ===（== null 除外）
      'no-var': 'error', // 禁止 var（全库已是 let/const）
      'prefer-const': 'error', // 未再赋值变量用 const
      'no-extra-semi': 'error' // 禁止多余分号
      // 注：curly 未启用——项目单行语句花括号风格混合（约 196 处），
      // 强制规则需大规模自动修复制造 diff 噪音，暂以现状为准
    }
  },
  // v7.0.5：测试文件专用块——globals 与主块已去重（主块全覆盖），
  // 本块仅用于让测试文件豁免主块风格规则（测试惯用法如未用变量/临时 mock）
  {
    files: ['tests/**/*.mjs'],
    languageOptions: {
      globals: {}
    }
  }
];
