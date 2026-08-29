# AGENTS.md — AI 编码助手项目指引（浓缩版）

> 本文件为 AI 编码助手（Claude/GPT/GLM 等）的精简上下文。**改代码前必读**；
> 细节见 CONTRIBUTING.md（工程约定）与 README.md（功能/更新日志）。

## 项目一句话

游戏雷达 Game Radar——Chrome MV3 扩展（零构建、原生 JS + JSDoc 类型），
在下载站页面注入 Steam 好评率徽章、行为学习推荐与限免监控。
当前版本见 manifest.json；版本流水与发布记录见 README「更新日志」。

## 常用命令

```bash
npm run check     # lint + typecheck + vitest（提交前必跑，pre-commit/pre-push 钩子会强制）
npm test          # 仅 vitest
npm run e2e       # E2E 冒烟（CI/离线用 E2E_MOCK=1；本地真实网络模式受外网延迟影响）
npm run visual    # 视觉回归（基线含版本号文本——发版后需 --update）
npm run coverage:gate  # 覆盖率门禁
npm run package   # 打包 release zip
```

## 架构（30 秒版）

- `background/`：MV3 Service Worker。core（常量/设置/规则/契约）→ storage（各数据模块，
  OPFS 分文件持久化经 `data/data-store.js`）→ steam/recommend/sites/freegames 业务 → handlers
  （消息分发，`handlers.js` 聚合 MESSAGE_HANDLERS）。依赖分层单向，`test-integrity` 强制。
- `content/`：内容脚本。`tracker.js` 经典入口 + 动态 `import(getURL('content/...'))`
  加载 ESM 模块（core/list/detail/tracking）。**新内容模块必须同步三处**：
  tracker ensureModules、tests/integration/test-content-sim.mjs 的 MODULE_FILES/MODULE_KEYS、
  （若走 manifest 静态注入）manifest content_scripts + site-scripts SITE_SCRIPT_FILES。
- `shared/`：内容/扩展页共用（escape/msg/patterns）。
- 页面层：popup / options / dashboard / hub（iframe 中心）/ freegames / welcome。
- 存储模块新增套路：constants.js 的 DB_KEYS + DATA_MODULES、data-store.js MODULE_FILES、
  reset.js 重置、backups.js 核心子集（按需）、消息契约 message-contract.js。

## 铁律（违反 = 测试/钩子拦截或线上事故）

1. 动态内容一律 `escapeHtml/escapeAttr`（shared/escape.js）；禁止内联事件处理器（CSP）。
2. **MV3 SW 不支持动态 import()**——后台模块必须静态 import；内容脚本动态 import 走 getURL。
3. **Chrome content_scripts 不支持 type:module**（勿再提议）。
4. 顶层 const 初始化不得引用后声明的标识符（TDZ，test-integrity 扫描）。
5. 双语注释（中英）；eslint 零警告；prettier（2 空格/单引号/120 列）。
6. 存储读写走 dataStore（模块键）；计数类读-改-写必须加锁（见 download-urls/app-stats 模式）；
   flush 写失败必须回滚 dirty 重试；防抖落盘用 createDebouncedStore。
7. 消息契约：新 action 必须在 message-contract.js 加规则；响应形状与内容侧消费方一致。
8. 出站请求只走 `fetchWithTimeout`（SSRF 校验/限速/审计内建）。
9. 修复必须配回归测试；p1 级修复需复现路径说明。
10. 权重/设置新增键：DEFAULT_SETTINGS + options 保存映射 + 渲染绑定 + popup（若入 popup）
    四处同步——漏保存映射会被"全量保存"抹掉用户自定义值。

## 测试约定

- 单测入 vitest.config.js 的 include 显式清单；storage/fetch mock 在 tests/helpers。
- content-sim：FakeEl DOM 模拟 + `__grImport` 注入；模块实例共享依赖"无 ?t= 导入"。
- 已知问题：background/handlers.js 的 coverage 归因伪影（见 CONTRIBUTING 末尾）。

## 发布流程

见 CONTRIBUTING「版本与发布」：版本三处一致（manifest/package/README changelog）→
`npm run check` + E2E + visual → package → commit（中文 conventional）→ tag/push →
gh release（附 zip，含 Mimosa seal）→ 深度扫描。触发线：大版本/5 次小版本/单次>1000 行/累计>3000 行。

## 明确不做（历史决策，勿再提议）

i18n、云同步、跨浏览器、规则市场、MAIN world 注入、全量 TypeScript。
