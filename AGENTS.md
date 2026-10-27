# AGENTS.md — AI 编码助手项目指引（浓缩版）

> 本文件为 AI 编码助手（Claude/GPT/GLM 等）的精简上下文。**改代码前必读**；
> 细节见 CONTRIBUTING.md（工程约定）与 README.md（功能/更新日志）。

## 项目一句话

游戏雷达 Game Radar——Chrome MV3 扩展（零构建、原生 JS + JSDoc 类型），
在下载站页面注入 Steam 好评率徽章、行为学习推荐与限免监控。
当前版本见 manifest.json；版本流水与发布记录见 README「更新日志」。

## 常用命令

```bash
npm run gate        # 全量门禁：check + E2E(MOCK) + visual（提交/发布前必跑）
npm run gate:fast   # 快速门禁：跳过 E2E
npm test            # 仅 vitest；npm run e2e 真实网络模式（可选增强，外网延迟偶发超时）
npm run coverage:gate  # 覆盖率门禁；npm run package 打包 zip
```

## 架构（30 秒版）

- `background/`：MV3 Service Worker。core（常量/设置/规则/契约）→ storage（各数据模块，
  OPFS 分文件持久化经 `data/data-store.js`）→ steam/recommend/sites/freegames 业务 → handlers
  （消息分发，`handlers.js` 聚合 MESSAGE_HANDLERS）。依赖分层单向，`test-integrity` 强制。
- `content/`：内容脚本。`tracker.js` 经典入口 + 动态 `import(getURL('content/...'))`，
  装载清单单源 = `content/module-manifest.js`（CORE_MODULES 并行加载；OPTIONAL_MODULES
  按 setting 键条件加载，禁用 = 代码零加载）。**新内容模块只改该清单一行**——tracker
  装载、tests/sim/sim-harness 文件表、test-integrity 存在性校验均由其派生。站点静态注入脚本
  另走 `background/core/site-scripts.js` 的 SITE_SCRIPT_FILES（manifest content_scripts）。
- 站点专属功能（内嵌 Steam 卡/布局默认/详情解析）走 adapter 规则 `features` 字段声明，
  **勿在业务里写 siteKey/host 判断**（v10.7.0 收编三处；xdgrid.js 的 host 兜底判断是
  有意保留的规则加载失败保底，勿删）。运行指标用 core/metrics.js。
- `shared/`：内容/扩展页共用（escape/msg/patterns/settings-utils/crypto-utils/retrieval-vocab 等 7 个）。
  retrieval-vocab.js = 检索规则词表单源（v14.6.3 R1：噪声序列/尾段词/版本对照/
  附属词/版本词保序词条数据 + 编译 + 校验；**保序语义**——重叠词先长后短决定删除
  范围；等价性由 golden 测试 + 错题库回放双重门禁）。
- 页面层：popup / options / dashboard / hub（iframe 中心）/ freegames / welcome。
- 存储模块新增 = `data/storage-registry.js` 的 STORAGE_MODULES 一行 + 业务文件：
  data-store 的 file/format 映射、DATA_MODULES、备份子集（backup 标记）、清除范围
  （clearOnDataReset 标记）全部由该表派生——**勿再手改 MODULE_FILES / DATA_MODULES /
  BACKUP_CORE_KEYS**。steam 缓存为 4 分文件（meta/rating/detail/spy，steam-cache.js
  dirtyModules 子集写入）——动其持久化须四处同步并保持旧单文件迁移兼容。

## 铁律（违反 = 测试/钩子拦截或线上事故）

1. 动态内容一律 `escapeHtml/escapeAttr`（shared/escape.js）；禁止内联事件处理器（CSP）。
2. **MV3 SW 禁止动态 import()**（HTML 规范：import() disallowed on
   ServiceWorkerGlobalScope——运行时 TypeError "import() is disallowed…"，
   v6.3.0 E2E 验证、v14.5.0 B2 复证并修复 4 处曾静默失效的动态导入）——
   后台模块必须静态 import；延迟需求一律"静态加载 + 延迟调用"（setTimeout/
   alarm 触发函数调用，见 service-worker.js 分层预热）。内容脚本/扩展页的
   动态 import 走 getURL（页面上下文允许）。
3. **Chrome content_scripts 不支持 type:module**（勿再提议）。
4. 顶层 const 初始化不得引用后声明的标识符（TDZ，test-integrity 扫描）。
5. 双语注释（中英）；eslint 零警告；prettier（2 空格/单引号/120 列）。
6. 存储读写走 dataStore（模块键）；计数类读-改-写必须加锁（见 download-urls/app-stats 模式）；
   flush 写失败必须回滚 dirty 重试；防抖落盘用 createDebouncedStore。
7. 消息契约：新 action 必须在 message-contract.js 加规则；响应形状与内容侧消费方一致。
8. 出站请求只走 `fetchWithTimeout`（SSRF 校验/限速/审计内建）。
9. 修复必须配回归测试；p1 级修复需复现路径说明。
10. **设置同步规则（test-settings-sync 强制）**：DEFAULT_SETTINGS 新增/调整/删除
    任何键（含嵌套组 badgeVisibility/weights/cacheTtls/dataSources/steamApiModules）
    必须同步设置层（options.js/panels 或 HTML）与 popup 必需集——漏同步 `npm run check`
    直接失败；有意无 UI 的键加入测试内 OPTIONS_ALLOWLIST 并写明理由。
    （v10.7.0 新增样例：uiThemeNightStart/End、ratingsBatchSize、qrImageMaxKb——保存映射
    以 DEFAULT_SETTINGS 键名为对照，越界回默认）
11. 权重/设置新增键漏保存映射会被"全量保存"抹掉用户自定义值（历史事故）——保存映射
    以 DEFAULT_SETTINGS 键名为对照逐项核对。
12. **徽章组标记契约**：`gr-rating-badge` 是好评率徽章**组标记**（prependBadge 防重复
    守卫/推荐徽章插入锚点/测试选择器三重身份）——经 createBadge 创建的组外徽章
    （推荐值等）必须传 `base:'gr-badge'`，否则污染守卫导致好评率徽章缺失（v10.6.0 事故）。
13. **单源优先**：写互斥锁/防抖/Map+TTL 缓存/重试前先查 `core/mechanisms.js`（withLock /
    debounce / TtlCache / withRetry）；写死值入 `constants.js` 单源组（STORAGE_CAPS /
    ENDPOINTS / SPY_SCALES / PERF_CONFIG）；检索规则词（噪声/版本/附属/尾段）入
    `shared/retrieval-vocab.js`（v14.6.3 R1——勿在业务代码新增噪声正则字面量副本）；
    新增注册表条目走 STORAGE_MODULES / module-manifest。
    **长延时/出站超时零字面量（v14.6.2 起 test-integrity 自动拦截）**：≥1000ms 的
    setTimeout/setInterval 与 fetchWithTimeout 的超时参必须走单源——background 入
    PERF_CONFIG（超时组 fetchTimeout*Ms）；内容侧/页面层不可 import background
    （分层），在文件顶提具名大写常量。发现"改一处要同步 N 个文件"= 该做单源化，
    不要照抄第 N 份。

## 文档同步（默认启用）

技能包 `docs/skills/neat-freak-person/`（源自 lsa03/neat-freak-person，MIT）已安装并
**默认启用**：功能批次合并后，AI 助手按其纪律同步三层知识（AGENTS.md 规则 /
README 更新日志 / Agent 记忆），执行"变更影响矩阵"式盘点。要点：

- 同步触发：功能新增/调整/删除合并后（说"同步一下"或自动执行）
- 尺寸红线：AGENTS.md ~300 行软上限；记忆毕业机制（稳定教训迁入本文件/CONTRIBUTING，
  记忆瘦身防膨胀）——v10.3.1 的记忆精简即该实践
- 完整流程与自检清单见 `docs/skills/neat-freak-person/SKILL.md`

## 测试约定

- 单测入 vitest.config.js 的 include 显式清单；storage/fetch mock 在 tests/helpers。
- **npm test 两阶段（B8）**：unit 先行 + sim/integration 全新进程——跨文件 fork
  复用的模块注册表残留会引发竞态（test-freegames→sim-list 同进程连跑时推送
  丢失 ~20-50%）；新套件入 include 时勿把重载荷 unit 套件排到 sim 之前。
- sim 套件（v14 B9 拆分）：FakeEl DOM 模拟 + `__grImport` 注入；共享 harness 在
  `tests/sim/sim-harness.mjs`（getGR/setQueryStubs/fireDomReady 显式状态访问，勿再
  引入文件级顺序状态机）；模块实例共享依赖"无 ?t= 导入"——reloadContentScripts
  **不得** vi.resetModules()（shared/ 未列 deps.inline，reset 致 content/shared 实例分裂）。
  推送前置等待：节 1 等 bootPromise（B7 后监听器注册先于 boot）；推送断言
  用 waitForSignal（B9 showStats 100ms 合并后状态栏渲染非同步）。
- e2e 冒烟：入口 `tests/e2e-smoke.mjs`（re-export 壳）→ `tests/e2e/run.mjs` 节管线；
  新增检查项写入对应 `section-*.mjs`（E2E_MOCK 双模式语义不动）。
- 真机诊断：`node tests/e2e-probe.mjs [--url <URL>] [--settings <JSON>] [--dump-logs]`——
  真实 Chromium 加载扩展，收集页面信号/扩展模块网络加载/后台日志（boot 在隔离世界，
  主世界 evaluate 读不到，模块加载以网络请求为准）；不进门禁。
- 已知问题：background/handlers.js 的 coverage 归因伪影（见 CONTRIBUTING 末尾）。

## 并发与写入纪律（B5/B9 单源）

- 锁：withLock 单点串行，**禁止嵌套持有**；flushAllCaches 逐模块串行获取/释放
  （同一时刻至多一把锁——新增落盘目标并入 flush.js 链尾，勿自持多锁）。
- 写合并：高频计数/映射新增一律 createDebouncedStore（2s）——三件套缺一不可：
  写失败回滚 dirty 重试（铁律 6）+ flushAllCaches 强制落盘纳管 + reset 取消挂起
  （防"清空被撤销"）。参考 gameProfiles（B5）。
- 消息推送：内容侧推送类 action（STEAM_RATINGS_UPDATE 等）就绪快路径**同步**
  应用——微任务延迟会让批次收尾抢先终止 job，迟到推送被静默丢弃（B8 实证）。

## 发布流程

触发线：大版本/5 次小版本/单次>1000 行/累计>3000 行。步骤（顺序固定）：

1. `npm run gate`（全量门禁一条命令）
2. bump manifest+package+README changelog → `npm run package`
3. commit（中文 conventional）→ tag/push → `gh release create`（附 zip + Mimosa seal）
4. 深度扫描（security_scan，focusFiles=改动文件）→ seal 补入 release notes
   半自动脚本 scripts/release.mjs 存在但落后于当前流程（visual/双 E2E/zip 附件）——
   以本清单为准，或先更新脚本再用。

## 明确不做（历史决策，勿再提议）

i18n、云同步、跨浏览器、规则市场、MAIN world 注入、全量 TypeScript。

<!-- neat-freak: initialized at 2026-09-12 -->
