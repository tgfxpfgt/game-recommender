# 贡献指南 / Contributing Guide

Game Recommender 是 Chrome MV3 扩展（零运行期框架、零构建注入），单人项目起家，欢迎贡献者。本文档帮助快速上手：架构心智模型、开发/测试/发布流程、代码约定。

## 项目心智模型（先读这个）

- **三套运行时并存**：`background/`（ES module Service Worker，单向分层 `core → storage → 业务层(steam/recommend/sites/freegames) → handlers → 入口`，静态断言拦截回归——见"依赖分层"）；`content/`（经典入口 tracker.js + 11 个 ESM 模块动态 import 注入，`__GR__` 命名空间已退场）；UI 页（options/popup/dashboard/freegames，经典脚本顺序加载，`__OPTS__` 共享）。
- **数据流**：下载站页面 → content 提取游戏名 → 后台按名搜索 Steam（storesearch → appdetails → appreviews）→ 三层缓存（Steam 动态缓存模块化 meta/rating/detail/spy + 游戏注册表 + 名称索引）→ 推送回 content 渲染徽章。
- **缓存优先原则**：名称索引直取 → 模块化缓存命中 → 官方 API 直取 → 搜索；搜索只发中文（v6.2.1 起英文名由 appdetails 直取覆盖）；出站请求统一经 `fetchWithTimeout`（SSRF 校验 + 审计 + 限速）。
- **预取架构（v6.3.0 评估结论）**：详情页预取（CACHE_STEAM_PAGE）、列表批次调度 + 滚动哨兵、推荐本地计算（零网络）已覆盖主要预取场景，**不再新增请求路径**（新增预取需先论证命中率）。
- **权限面（v6.3.0 收窄）**：host_permissions 仅内置功能域名（Steam API/下载站 9 域/限免源/本地 LLM）；自定义站点经 optional_host_permissions 按需请求（options 添加站点时）。

## 环境准备

```bash
npm ci                 # 安装依赖（vitest/eslint/typescript/playwright-core）
npm run install-hooks  # 安装 git 钩子（提交信息格式 + 暂存 JS 语法检查）
npm run check          # lint + vitest 全量
npm run typecheck      # tsc --noEmit（background/** 全层 checkJs）
npm run e2e            # 浏览器冒烟（E2E_FAST=1 跳过真实网络段）
npm run coverage       # vitest 覆盖率
```

## 测试体系

- **单 runner（v6.2.0 起）**：`npm test` = vitest run，15+ 套件全部由 vitest 收集（content-sim 经 `__grImport` 注入兼容 eval 动态 import）。
- **目录**：`tests/unit/`（纯函数单测）+ `tests/integration/`（content-sim 内容脚本模拟 / test-handlers 消息链路 / test-orchestrator Steam 编排 / test-integrity 项目完整性）。
- **新增测试文件必须加入 `vitest.config.js` 的 include 显式列表**（vitest 默认只匹配 `.test.` 后缀）。
- **转换教训（重要）**：check 线性脚本（顶层准备 + 立即断言）转 vitest 时，**凡"顶层状态 + 延迟断言"必须打包进同一 test/beforeAll**——顶层准备在收集阶段全部提前执行，断言运行阶段读到最终状态（v6.1.1 根因）。多 fetch mock 必须按 describe 作用域安装/卸载（顶层多 mock 后装覆盖前者，v6.2.0 教训）。
- **mock 工具**：`tests/helpers/storage-mock.mjs`（chrome.storage，含 `_reset()` 隔离）+ `fetch-mock.mjs`（URL 子串分发）。

## 代码约定

- 中英双语注释；禁止内联事件处理器（MV3 CSP）；动态内容一律 `escapeHtml/escapeAttr`。
- **顶层 const 初始化不得引用后声明的标识符（TDZ）**；`types.js` 注释内不可出现裸 `@typedef`/`@type` 字样。
- JSDoc `/** */` 必须紧贴其描述的函数（中间插入其他函数会错位绑定，v6.3.0 engine.js 教训）。
- 新消息 action 必须加入 `message-contract.js` 的 RULES 表（契约化 100%，v6.3.0 收尾）+ test-contract 同步。
- 新后台模块注意依赖分层（ALLOWED 矩阵在 test-integrity）。

## 版本与发布

- 版本号 X.Y.Z（大=架构级 / 中=功能里程碑 / 小=日常修复）；manifest.json 为唯一权威 + package.json 互比（测试自动校验）。
- **发布触发线**：大版本 / 5 次小版本 / 单次变更 >1000 行 / 累计 >3000 行 → 完整发布（push + tag + GitHub Release + Mimosa 深度扫描）。
- 完整发布流程：全量验证（vitest + lint + typecheck + E2E）→ Mimosa 深度扫描（seal 记录到 release notes）→ push/tag/release → README 更新日志。
- 小版本常规：本地提交（不 push），计入计数。

## 安全基线（不降级）

- 出站请求仅经 `fetchWithTimeout`（SSRF host 校验、重定向逐跳复检、每主机限速、出站审计）。
- 规则/备份导入均过模块白名单校验（`sanitizeImportedModule`）；备份剔除 API 密钥。
- 不引入运行期框架；TypeScript 仅编译期（noEmit）。
- **MV3 Service Worker 不支持动态 import()**（v6.3.0 E2E 验证）——后台模块必须静态 import；内容脚本的动态 import 走 chrome.runtime.getURL。
- 发布前 Mimosa 深度扫描必须 0 findings。
