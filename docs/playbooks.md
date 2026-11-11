# Playbooks — 需求类型 → 触点配方 / Task-Type Playbooks

> 目的：把"每类需求的固定触点 + 测试 + 坑"沉淀为查表，AI 助手与维护者
> **按类型直达文件**，不再探索式读码（token/时间收敛，2026-11-10）。
> 结构性事实（架构/铁律）在 AGENTS.md；本文件只存"怎么做某类需求的配方"。
> 新配方入库标准：同一类需求做过 ≥2 次、或单次探索读码 >5 文件。

## 通用前置（所有类型）

```bash
npm run gate:fast     # 提交前唯一门禁（受影响测试自动选择；白名单单源自动升级）
npm run bump patch|minor "标题" "要点1" ...   # 版本四处一键
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
**坑**：commit/push 分步、不带管道（吞退出码事故×2）；链式命令 commit 失败必须中止；visual 基线含版本号——bump 后 `npm run visual -- --update`；推送 GFW 间歇重置等 2 分钟窗口。
