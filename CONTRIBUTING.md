# 贡献指南 / Contributing Guide

游戏雷达 Game Radar 是 Chrome MV3 扩展（零运行期框架、零构建注入），单人项目起家，欢迎贡献者。本文档帮助快速上手：架构心智模型、开发/测试/发布流程、代码约定。

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
- **新增业务文件覆盖率门槛（v7.0.7）**：`npm run coverage:gate`——相对 origin/main（浅克隆回退 HEAD~1）的**新增业务文件**行覆盖 <50% 拒绝；已接入 CI。

## 工程护栏（v7.0.7）

- **git 钩子**（`sh scripts/install-hooks.sh` 安装，core.hooksPath=.githooks）：
  - `pre-commit`：暂存 .js/.mjs 语法（node --check）+ eslint + prettier --check 三层快速校验
  - `commit-msg`：提交信息 conventional 格式（feat|fix|refactor|docs|chore|test|style|perf|build|ci(scope)?: 描述）
  - `pre-push`：push 前跑 `npm run check`（lint + typecheck + vitest）——坏提交本地拦截
- **依赖与密钥防线**：`npm run audit`（devDeps 漏洞）；CI security job 跑 npm audit + gitleaks（Secret 扫描）
- **CI**：test job（lint + typecheck + vitest + coverage:gate）；e2e job 用 **E2E_FAST 离线模式**（真实 Steam 网络段不可控，本地全量覆盖）
- **发布**：`node scripts/release.mjs [版本号]` 半自动（门禁 → bump → changelog 草稿 → commit/tag/push → release 草稿）——**Mimosa seal 仍人工补入**

## 代码约定

- 中英双语注释；禁止内联事件处理器（MV3 CSP）；动态内容一律 `escapeHtml/escapeAttr`。
- **顶层 const 初始化不得引用后声明的标识符（TDZ）**；`types.js` 注释内不可出现裸 `@typedef`/`@type` 字样。
- JSDoc `/** */` 必须紧贴其描述的函数（中间插入其他函数会错位绑定，v6.3.0 engine.js 教训）。
- 新消息 action 必须加入 `message-contract.js` 的 RULES 表（契约化 100%，v6.3.0 收尾）+ test-contract 同步。
- 新后台模块注意依赖分层（ALLOWED 矩阵在 test-integrity）。

## 已决策不做的路线（v6.3.3 正式关闭，勿再提议）

- **i18n 国际化**：中文单语种定位（_locales 仅扩展名/描述两键）
- **跨设备云同步**：数据全本地（OPFS），无云端
- **跨端适配**（Firefox/移动端）：仅 Chrome/Edge 系
- **规则市场**：无社区生态假设

## 版本与发布

- 版本号 X.Y.Z（大=架构级 / 中=功能里程碑 / 小=日常修复）；manifest.json 为唯一权威 + package.json 互比（测试自动校验）。
- **发布触发线**：大版本 / 5 次小版本 / 单次变更 >1000 行 / 累计 >3000 行 → 完整发布（push + tag + GitHub Release + Mimosa 深度扫描）。
- 完整发布流程：全量验证（vitest + lint + typecheck + E2E）→ Mimosa 深度扫描（seal 记录到 release notes）→ push/tag/release → README 更新日志。
- 小版本常规：本地提交（不 push），计入计数。

## 性能基线（v7.1.0 文档化）

- **设计原则（用户方向）**：本地不涉网络的路径，用内存换延迟——存储预热、内存缓存、聚合缓存、推荐值缓存（v7.0.4）。
- **关键基线**：①首个列表/详情查询零磁盘等待（SW 启动 8 路并行预热）；②列表页批次 ≤30s（6 并发自适应，限流降 2）；③缓存管理列表推荐值缓存（2000 上限，key 含版本）。
- **测试基线**：全量 vitest ~14s（import 占 60%+，瓶颈为 content-sim 模块加载——分片实测无收益，勿再尝试；日常用 `npm run test:changed`）；`npm run test:timed` 记录趋势（tests/.timing.jsonl）。
- **分片验证结论（v7.1.0）**：unit 并行 0.64s + integration 串行 13.2s ≈ 全量串行 14.3s——收益为零，不落地；提速方向是模块加载优化而非并行。
- **限免源核验结论（v7.1.0）**：Amazon Prime Gaming / Ubisoft Connect 均需登录（302），**无公开 API**——不实施（Epic/GOG/Steam 有公开端点才接入；接入新源前必须先核验数据可得性）。

## 安全基线（不降级）

- 出站请求仅经 `fetchWithTimeout`（SSRF host 校验、重定向逐跳复检、每主机限速、出站审计）。
- 规则/备份导入均过模块白名单校验（`sanitizeImportedModule`）；备份剔除 API 密钥。
- 不引入运行期框架；TypeScript 仅编译期（noEmit）。
- **MV3 Service Worker 不支持动态 import()**（v6.3.0 E2E 验证）——后台模块必须静态 import；内容脚本的动态 import 走 chrome.runtime.getURL。
- **content-sim 用自研 FakeEl**（v6.3.2 评估：jsdom 迁移收益有限——测试聚焦流程逻辑，FakeEl 已工作正常；若未来需标准 DOM 语义（选择器/事件冒泡）再评估 jsdom）
- **UI 层 DOM 类型宽松化**（globals.d.ts）：document 返回 any（元素存在性由浏览器保证），类型化聚焦业务字段与消息形状
- 发布前 Mimosa 深度扫描必须 0 findings。
- **content-sim 节 2/2b 间歇性 flake（v6.4.10 起已知，负载敏感）**：itemB 徽章超时/第二批未衔接，~10-30% 频率出现于系统高负载时（测试内置 [DIA] 诊断块可定位）。与具体功能改动无关（v10.3.0 stash 对照实验曾误判，后证实样本不足）；重跑即可，CI 偶发红同因。
- **覆盖率归因伪影（v10.0.0 定位，待专项修复）**：background/handlers.js 在 coverage 报告中恒为 ~15%（各次独立运行数值完全相同、新增 handleMessage 测试不改变读数；单文件探针则完全不出现条目）——根因是该文件经动态 import 加载时脱离 vite 转换管线（server.deps.inline 原生加载设计），V8 覆盖键与报告路径不匹配。真实覆盖率远高于此（40+ 集成测试贯穿 handleMessage）。修复前总覆盖率读数约被压低 3-4 点；专项方向：调整 tests 的导入方式使 handlers.js 进入插桩管线且不破坏同实例语义。
- **发布频率规则**（见 memory：大版本/5 次小版本/单次>1000 行/累计>3000 行任一触发完整发布）：v9.2.2-v9.6.0 曾积压 7 版未发布——按节奏触发，勿积压。
