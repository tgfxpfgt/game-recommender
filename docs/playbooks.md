# Playbooks — 需求类型 → 触点配方 / Task-Type Playbooks

> 目的：把"每类需求的固定触点 + 测试 + 坑"沉淀为查表，AI 助手与维护者
> **按类型直达文件**，不再探索式读码（token/时间收敛，2026-11-10）。
> 结构性事实（架构/铁律）在 AGENTS.md；本文件只存"怎么做某类需求的配方"。
> 新配方入库标准：同一类需求做过 ≥2 次、或单次探索读码 >5 文件。

## 通用前置（所有类型）

```bash
npm run gate:fast     # 提交前唯一门禁（受影响测试自动选择；白名单单源自动升级；
                      #   含 ext-refs/first-run/corpus/mutations 四门禁与步骤级墙钟预算）
npm run verify:mutations -- --only <id>   # 修复类批次快速复核：放回缺陷必须红
npm run bump patch|minor "标题" "要点1" ...   # 版本四处一键（manifest/package/CHANGELOG.md/welcome）
node scripts/test-changed.mjs --base <ref> [--to <ref>]   # 预演受影响测试选择
```

## 模块索引（改任何模块前先查表）

`docs/modules/INDEX.md`（自动生成）给出每个模块的 职责/依赖/导出/**不变式**。
不变式列 = 改动前必须知道、但从代码里看不出来的约束（顺序依赖、并发假设、
幂等要求、单位约定）——**先读那一行，再读代码**，否则最容易被踩坏的就是它。
新增/调整不变式在模块文件头写 `@invariant …`；重生成
`node scripts/gen-module-index.mjs`；漂移由 `npm run check:modules` 在 gate:fast 拦截。
临时未实现处用 `@stub-ok: <原因>` 豁免（无原因文本不算豁免），且必须出现在索引
「豁免登记」表——未登记的豁免视为未实现。

## 0. 使用证据档案（v14.25.0，优化依据的数据入口）

**读**：`GET_USAGE_EVIDENCE_REPORT` action（扩展页）或一键诊断包（`GET_DIAGNOSTIC_BUNDLE`，
usageEvidence 字段同源附带）——报告含 counters（累计）/durations（p50/p90）/recentEvents7d
（近 7 天事件分布）/events（原始事件尾 80 条）。**优化/修问题前先读报告**：
match.urlCacheServe vs match.urlFetch 比例 = 缓存先行有效性；search 耗时 p90 =
"慢"类报告的量化；rating.fallback 层级分布 = 数据源健康；match.miss kind = 检索
未命中形态；reviews.structureDrift = 页面结构漂移预警。

**写（新增记录点）**：`recordUsageCounter(key)`（键须先登记 usage-evidence.js 的
COUNTER_KEYS）/`recordUsageDuration(key, ms)`（DURATION_KEYS）/`recordUsageEvent(cat, k, {kind, appId})`。
边界：只记类别/结果码/appId，**不记页面 URL 与游戏标题**（隐私）；全 fire-and-forget
（flush 自动排空在途 apply——applyChain 队列，勿绕过 enqueueApply）。

**运行期卡点排查（v14.28.9 diagTrace）**：`GET_DIAG_TRACE`（扩展页零参）或一键诊断包
`trace + traceVerdict` 字段——`classifyTrace()` 直接给出 `{verdict, stuckStage,
stuckDurMs, lastFailKind, cacheLayer, counts}`（判据：最后一个有 enter 无 exit 的
stage + 最近失败类别 + 波次进度 + 缓存命中层）。断网场景判定样例 = 录制夹具
`tests/fixtures/diag-trace-network.json`（verdict=network / stuckStage=search，
由 integration 真跑录制非手写；夹具 `schemaVersion` ≠ SCHEMA_VERSION 门禁即红）。
隐私：仅 hostname + 游戏名 6 位哈希，无完整 URL/标题/appId 明文。

---

## 1. Steam 浮窗（详情页）UI / 动作类

**触点**：`content/core/floats.js`（浮窗外壳/⚙ 菜单，menuItems 通用注入）→
`content/detail/sidebar.js`（编排壳：createSteamFloat 装配菜单项 menuState 注册表 + openManualSelect 手动面板单源装配）→
`content/detail/sidebar-actions.js`（回调工厂：makeOnRefresh/makeReportIssue/makePickPlatform）→
`content/detail/render/sidebar-html.js`（模板，纯 HTML 无绑定）→ `content/detail/candidates.js`（手动选择/机型专页）→ `styles/content.css`（如需样式类）。

**测试**：`tests/sim/sim-float-menu.mjs`（菜单机制 F 系列）+ `tests/sim/sim-detail.mjs` 节 9（渲染/未命中路径）+
`tests/unit/test-sidebar-actions.mjs`（回调工厂直调）+ `tests/unit/test-ui-pure.mjs`（模板分支）。

**坑**：

- 回调闭包随渲染重建——菜单等持久 UI 消费 menuState 注册表取最新闭包（v14.24.0 形态）。
- 动作按钮标记用 `data-menu-action`（E2E/测试选择器契约）；底部按钮已删除勿再新增。
- JS 注解可能比无注解更严格（null 初始化字段必须 `@type` 标注可空函数类型，否则 TS2349）。
- UI 交互无法以 FakeEl 行为级驱动（不支持 #id 选择器/innerHTML 不解析）——按源码守卫惯例锁结构要素。
- 模板新增插值若引入受控预构建片段 → XSS 棘轮基线 +1（scripts/lint-baseline.json `_note`）。

## 2. 后台检索管线类

**触点**：`background/steam/orchestrator-detail.js`（详情管线：searchSteamGame 编排 + tryCacheServed 缓存判定）→
`background/handlers/steam.js`（消息入口：SEARCH_STEAM/GET_STEAM_BY_APPID/URL 索引第一候选/缓存先行 v14.24.0）→
`background/steam/api-*.js`（api-search 检索/api-reviews 评测/api-details 详情/api-assemble 装配）→
`background/storage/steam-cache.js`（FIELD_MODULES 字段路由——新字段一行归模块）。

**测试**：`tests/integration/test-handlers.mjs`（链路级）+ `tests/integration/test-orchestrator.mjs` + 纯函数入 test-api-pure。

**坑**：

- **缓存命中判定五重口径必须同步**：isDetailCacheComplete（steam-cache 单源，按字段所属模块判定）+ needsRatingRefetch + hasInvertedReviewCounts + cnReviewsFetchedAt + namesRelated——orchestrator tryCacheServed 与 handlers 两处（URL 缓存先行/直取）三处同口径；未命中按 planDetailRefresh 只补缺失模块，漏一处=污染条目被该路径永久顶住。
- **双管线一致性（铁律 18，v14.31.0）**：列表/详情共语义逻辑禁止两份实现——置信度装配 `attachMatchConfidence` 单源 / MC 色 `__GR_PATTERNS__.mcColorFor` 单源 / errorType 三态同名同义 / 平台预检与映射消费同优先序（映射>模拟器>主机MC>PC）；有意差异须在 test-match-consensus「双管线一致性门禁」组注释登记；改单源后必跑该组。
- **api-details 去重表**（in-flight+10s TTL）跨测试用例残留会吞出站计数断言 → `resetAppDetailsDedupForTest()`。
- 404=空结果非失败 doctrine 逐路径审计；新端点先问"计入哪个熔断域"（不同主机不得连坐）。
- fetchSteamAppDetails mock 形状 = 顶层 `{appid:{success,data}}` 无外层包裹。
- matchAll 正则必须带 g 标志（catch 吞 TypeError → 静默失效）。

## 3. 新设置键全链

**触点**：`background/core/settings.js` DEFAULT_SETTINGS → options 面板（`options/panels/settings-render.js`+`settings-bind.js`）→ popup 必需集 → **保存映射逐键核对**（漏键=全量保存抹掉用户值，历史事故）→ `shared/`（如跨层消费）。

**测试**：`tests/unit/test-settings-sync.mjs`（机器门禁，漏同步直接红）+ `tests/unit/test-reset-defaults.mjs`。

**坑**：有意无 UI 的键入 OPTIONS_ALLOWLIST 并写理由；数值键走 clampNumericSettings 范围钳制。

## 4. 新消息 action

**触点**：`background/core/message-contract.js`（规则三登记：contract 规则 + handlers 表 + CONTENT_ALLOWED_ACTIONS 若内容侧发）→ handler 实现（对应领域文件）→ 消费方。

**测试**：`tests/unit/test-contract.mjs`（形状）+ `tests/integration/test-integrity.mjs`（静态扫描会抓漏登记——实战多次拦截）。

## 5. 新存储模块

**触点**：`data/storage-registry.js` STORAGE_MODULES **一行** + 业务文件；data-store 的 file/format 映射、DATA_MODULES、备份子集、清除范围全部派生——勿手改 MODULE_FILES/DATA_MODULES/BACKUP_CORE_KEYS。

**坑**：高频计数类必须 createDebouncedStore 三件套（回滚重试+flush 纳管+reset 取消挂起）；读-改-写必须 withLock；flush 链尾并入 flush.js 勿自持多锁。

## 6. 检索词表 / 匹配规则类

**触点**：`shared/retrieval-vocab.js`（保序词条单源——勿在业务新增噪声正则副本）→ 消费方读编译产物（getCompiledRetrievalRules）。

**测试**：test-retrieval-vocab（golden 等价）+ `npm run verify:match`（错题库回放）+ test-mismatch-samples。**改词表后油猴 `userscript/game-radar.user.js` 词表快照须同步**（test-userscript-pure 防漂移门禁会红）。

## 7. 发版批次

顺序：`npm run gate`（全量）→ `npm run bump …` → `npm run package` → `npm run release:smoke` → 分步 commit → tag/push → gh release（附 zip+seal）→ 深度扫描。
**坑**：commit/push 分步、不带管道（吞退出码事故×2）；链式命令 commit 失败必须中止；visual 基线含版本号——bump 后 `npm run visual -- --update`；推送 GFW 间歇重置等 2 分钟窗口；发布前 `npm run check:ext-refs -- --refresh` 刷新外部引用锁（30 天保鲜）。

## 8. 外部资源型功能上线（全量目录/dump 类，v14.28.8 A/G 类教训）

**触点**：`background/core/constants.js` ENDPOINTS（主源 jsDelivr + 备源 raw，**分支必须与上游默认分支一致**）→ `scripts/external-refs.json` 登记（url/owner/repo/branch/validatedAt/httpStatus/bytes）→ 真实首拉实测（如 `GR_LIVE_APPLIST=1 npx vitest run tests/unit/test-app-list-index.mjs`）→ `scripts/first-run.json` 回填 firstRun（at/bytes/entries/evidence，required:true）→ `scripts/mutations.json` 登记缺陷回放（如分支写回 main）。

**测试**：`tests/unit/test-app-list-index.mjs`（离线桩 + GR_LIVE 真网用例）+ 三门禁 `check:ext-refs` / `check:first-run` / `check:corpus` + `verify:mutations`。

**坑**：

- 404 分两类：对端资源不存在（空结果可兜底）vs **我方引用写错**（配置错误必须红）——appListIndex 写死 `main` 分支 404 五个月零运行，即后者被"404=空结果非失败"doctrine 吞掉的实例。
- 桩只模拟响应内容，**URL 必须参与断言**（桩记录入参）；单测自建 URL 常量绕过生产常量 = 生产写错测试仍绿（D-4，由 ext-refs 兜底）。
- 外部引用可变部分（分支/域名/路径前缀）零字面量：进 ENDPOINTS 单源 + 锁文件；`validatedAt` 超 30 天门禁红（发布前 `--refresh` 校验真实默认分支，离线模式不查上游）。
- 上线 = "有首次成功运行的证据"，不是"代码合并"——无 firstRun 记录的外部资源型功能一律视同不存在（G 类）。
