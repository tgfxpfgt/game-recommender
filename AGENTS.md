# AGENTS.md — AI 编码助手项目指引（浓缩版）

> 本文件为 AI 编码助手（Claude/GPT/GLM 等）的精简上下文。**改代码前必读**；
> 细节见 CONTRIBUTING.md（工程约定）、README.md（功能）与 CHANGELOG.md（更新日志，
> v14.28.0 起自 README 拆出）。
> **按需求类型直达触点：先查 `docs/playbooks.md`**（浮窗/管线/设置键/action/
> 存储模块/词表/外部资源上线/发版 8 类配方——文件+测试+坑查表，免探索式读码）。

## 项目一句话

游戏雷达 Game Radar——Chrome MV3 扩展（零构建、原生 JS + JSDoc 类型），
在下载站页面注入 Steam 好评率徽章、行为学习推荐与限免监控。
当前版本见 manifest.json；版本流水见 CHANGELOG.md（`npm run bump` 自动同步
manifest/package/CHANGELOG/welcome 四处）。

## 常用命令

```bash
npm run gate        # 全量门禁：vitest 两阶段 + E2E(MOCK) + visual + 打包（发布触发点跑；步骤级墙钟预算 suite-budgets.json）
npm run gate:fast   # 快速门禁：静态门禁群 + lint/typecheck + 受影响测试 + 缺陷回放 + 棘轮 + visual —— 每批提交前必跑
npm run bump        # 版本四处一键 bump：npm run bump patch|minor "标题" "要点1" [要点2...]（manifest/package/CHANGELOG.md/welcome）
npm test            # 仅 vitest；npm run e2e 真实网络模式（可选增强，外网延迟偶发超时，不进门禁）
npm run test:changed -- <改动文件...>  # 按变更面选测（日常批次首选，快于全量）
npm run check:docs  # 文档版本/索引门禁；npm run clean:artifacts 清理本地生成物
npm run check:modules  # 模块索引（docs/modules/INDEX.md）漂移 + 豁免登记校验；重生成 node scripts/gen-module-index.mjs
npm run check:stubs    # 占位实现（TODO/未实现抛错）+ 契约→handler 缺口；唯一豁免 @stub-ok: <原因>
npm run check:ext-refs  # 外部引用锁（scripts/external-refs.json）：登记一致性 + validatedAt 30 天保鲜；--refresh 真实校验上游默认分支（发布前跑）
npm run check:first-run # 首次运行证据（scripts/first-run.json）：外部资源型功能必须有真实成功调用记录
npm run check:corpus    # 匹配语料分母：名称级样本必须有 expectedName（豁免须写原因）
npm run verify:mutations # 缺陷回放（scripts/mutations.json）：历史缺陷放回必须红；--only <id> 单条
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
- `userscript/game-radar.user.js`（@version 14.14.0；与 manifest 已差 14 个 minor，
  release:smoke 告警阈值在案——下次 minor bump 前须先决策移植同步或调阈值）：
  油猴单文件版（扩展核心移植，
  GM_* 适配层直调管线）——**词表/纯函数是扩展快照**，改 shared/retrieval-vocab.js
  或 api-search 纯函数后须同步该文件（test-userscript-pure 的防漂移门禁会红）；
  版本号 = 移植基线（@version 对齐功能口径的扩展版），不随扩展 patch 递增。
- 存储模块新增 = `data/storage-registry.js` 的 STORAGE_MODULES 一行 + 业务文件：
  data-store 的 file/format 映射、DATA_MODULES、备份子集（backup 标记）、清除范围
  （clearOnDataReset 标记）全部由该表派生——**勿再手改 MODULE_FILES / DATA_MODULES /
  BACKUP_CORE_KEYS**。steam 缓存为 4 分文件（meta/rating/detail/spy，steam-cache.js
  dirtyModules 子集写入）——动其持久化须四处同步并保持旧单文件迁移兼容。
- 运行期诊断轨迹（v14.28.9）：`background/storage/diag-trace.js`——环形 500 事件、
  白名单键（仅 hostname + 游戏名 6 位哈希，零完整 URL/标题/appId）经 `GET_DIAG_TRACE`
  或诊断包 `trace/traceVerdict` 导出；卡点判读 `classifyTrace()` =
  `{verdict, stuckStage, stuckDurMs, lastFailKind, cacheLayer, counts}`。录制夹具
  `schemaVersion` ≠ 当前 SCHEMA_VERSION 即红（保鲜门禁）。

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
14. **故障三态语义（v14.28.8 起，sim-list 节 13 真值表门禁）**：面向用户的查询结果
    必须三态可区分——有值 / 确认无值 / 失败未知。后台网络/限流/超时失败一律走
    `networkFailed` 哨兵（`failed:true` + errorType），内容侧渲染
    `gr-badge-network-error`「⚠️ 网络异常·点击重查」——**禁止把失败渲染成「未找到」**
    （与"Steam 无此游戏"同形 = 误导用户去补数据而非修网络）。新增 errorType 分支
    先核对语义映射，再配真值表用例（network/ratelimit/notfound/timeout/empty）。
15. **机制必须绑定可见输出**：超时/看门狗/降级类机制必须驱动一次用户可见变化
    （推送/UI 变更），或在代码与文档显式标注"仅诊断"——只写日志的机制等于不存在
    （停滞边沿心跳 `scheduleStallCheck` 推 progress.stalled；test-ratings-resume
    用例 + 变异 `stall-heartbeat-log-only` 兜底）。
16. **外部引用登记制 + 首次运行证据**：托管 URL 一律走 constants.js ENDPOINTS 单源，
    并入 `scripts/external-refs.json` 登记（check:ext-refs：未登记/与代码漂移/
    validatedAt 超 30 天即红；发布前 `--refresh` 校验上游真实默认分支）。外部资源型
    功能上线前必须有真实成功调用记录入 `scripts/first-run.json`（check:first-run）——
    "机制存在 ≠ 功能生效"（appListIndex 写死 main 分支 404 五个月零运行的教训）；
    404 须区分"对端无资源"（空结果可兜底）与"我方引用写错"（配置错误必须红）。
17. **缺陷回放登记**：修过的结构级缺陷（放回后门禁应红）进 `scripts/mutations.json`，
    `verify:mutations` 在 gate:fast 兜底；修复类批次可用 `--only <id>` 快速复核。
    测试桩必须断言入参 URL——桩只模拟响应内容，不模拟"URL 是否正确"。
18. **列表/详情双管线一致性（v14.31.0 用户指令：防脱节）**：两管线共语义的逻辑
    **禁止各持一份实现**——置信度字段装配走 `match-confidence.attachMatchConfidence`
    单源（新增字段只改一处，列表 matchConflict 强制降级已内聚）；MC 分级色走
    `__GR_PATTERNS__.mcColorFor`（勿再写 ≥75/50 色值字面量副本）；故障三态
    errorType（network/notfound）与列表 networkFailed 哨兵同名同义，详情响应
    未命中必带结构化 errorType（reason 字符串正则仅兼容保留）。平台预检/手动
    映射消费两管线同优先序（映射>模拟器>主机MC>PC）。**有意差异须登记**
    （现两项：MC 视图无「新游/未发售」标签——数据源属 Steam 条目域；
    matchConflict 冲突检测仅列表接线）。门禁：test-match-consensus「双管线
    一致性门禁」组——新增共享语义先入单源再接两侧，改动单源必跑该组。

## 文档同步（默认启用）

技能包 `docs/skills/neat-freak-person/`（源自 lsa03/neat-freak-person，MIT）已安装并
**默认启用**：功能批次合并后，AI 助手按其纪律同步三层知识（AGENTS.md 规则 /
CHANGELOG.md 更新日志 / Agent 记忆），执行"变更影响矩阵"式盘点。要点：

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
- **最小必要测试（用户指令 2026-11-10）**：修复类就近现有套件补 1 个回归用例，不新建套件；
  新 sim 套件仅限新模块/新行为；同一变更不在 unit/sim/E2E 三层重复铺（主选变更所在层，
  其余层留发布触发点补）；E2E section 增项默认随完整发版批次。
- 墙钟预算（v14.28.9 起）：`scripts/suite-budgets.json`（cap = 本机实测×1.5）在
  gate.mjs 逐步骤生效，超 cap 直接判失败——先隔离复跑排机器负载（并行编译/杀毒/争核），
  仍超才调基线；套件实测与口径见 docs/specs/gr-hardening-2026-11-11/spec.md L3。
- 已知噪声：变异 `network-rendered-as-notfound` 在 **gate 上下文**偶发撞 240s 检查
  上界被判「未拦截」（实测 3 次全量中 2 次超时；**隔离运行恒 ~2.7s 红**，5/5 PASS）——
  疑似 spawnSync 超时杀 cmd.exe 后孙进程持管道的楔死级联。处置：`npm run verify:mutations
-- --only=network-rendered-as-notfound` 隔离复跑定性（红=门禁有效），不阻塞批次；
  语义上不会假绿（超时判红）。
- 已知问题：background/handlers.js 的 coverage 归因伪影（见 CONTRIBUTING 末尾）。

## 最小必要变更纪律（用户指令 2026-11-10）

- **工作完整性（用户指令 2026-11-12）**：每批工作尽量一次闭环（实现 + 测试 +
  门禁 + bump + 提交 + 推送），**不留半成品、不堆积挂账**；确需留下未完成项
  （挂账/暂缓/待决策）必须**先向用户确认**并登记（AGENTS/记忆/报告），不得静默遗留。
- **测试开销监控（用户指令 2026-11-12）**：gate 每步骤耗时自动追加
  `scripts/.gate-costs.jsonl`（gitignored 本地历史），收尾对固定口径步骤做滚动
  中位数对比——超 1.5× 中位数打印 ⚠️（拦静态预算 cap 之下的缓慢漂移）。收到
  告警先隔离复跑排环境负载，再查套件膨胀或重测基线；`npm run test:timed` 看
  全量 vitest 长期趋势；`node scripts/test-cost-history.mjs --report` 出执行
  历史战果报告（各步骤次数/失败率/耗时分布——E-3 分母，v14.28.13）。
- **coverage:fast 空集跳过（v14.28.13）**：gate:fast 在相对基线无新增业务文件时
  跳过 coverage:gate 步骤（computeNewFiles() 空集 = 推送后确定性空转 112s；
  行为保持的提速，非削弱断言）。新增文件集计算单源 = scripts/coverage-gate.mjs
  的 computeNewFiles()（导出 + main 守卫，勿在 gate.mjs 复制 git 逻辑）。
- **分层门禁**：日常批次 `npm run gate:fast`——vitest 按变更面选择（单源规则在
  `scripts/test-changed.mjs`：宽爆炸半径单源白名单触碰即升级**定向验证**（related +
  扫描器套件；测试基建例外仍全量）；相关文件 >15 → 全量；sim 不在静态 import 图上
  （__grImport 装载），走文件内显式映射）。**coverage:gate 基线 = git 可推导**
  （merge-base(HEAD, origin/main)..HEAD ∪ 未提交新增，v14.28.4 起不再依赖
  gitignored 标记文件；未推送期间重跑会重门禁同批文件，属确定性代价）。
  **fast 模式 visual 按变更面跳过**（触发面 = popup/options/dashboard/freegames/
  styles/icons/shared/manifest——基线只渲染这四个扩展页+主题+版本号）。
  全量 `npm run gate` 只在发布触发点跑。**sim 多文件连跑必须保 include 顺序**
  （sim-list 前置——CLI 目录参数按字母序打乱会复现节 2/2b 挂起，v14.24.1 实证；
  npm run test:sim 已固化显式顺序）。fast 现含 ext-refs/first-run/corpus/mutations
  四门禁与**夹具→套件映射**（夹具改动映射不到套件即红，不再「空匹配=通过」）；
  仅跑 fast 即可提交的条件清单见 docs/specs/gr-hardening-2026-11-11/spec.md L3
  （跨层契约/存储注册表/词表/测试基建改动必须全量）。
- **版本样板一键化**：`npm run bump patch|minor "标题" "要点1" ...` 一次完成
  manifest/package/CHANGELOG.md/welcome 四处（油猴 @version 不动=移植基线），勿再手改四处。
- **最小 diff**：需求外顺手改动（重构/格式化/依赖微调/无关配置）不并入功能批次，
  单独列出由用户决定；不动需求未触及的文件。

## 并发与写入纪律（B5/B9 单源）

- 锁：withLock 单点串行，**禁止嵌套持有**；flushAllCaches 逐模块串行获取/释放
  （同一时刻至多一把锁——新增落盘目标并入 flush.js 链尾，勿自持多锁）。
- 写合并：高频计数/映射新增一律 createDebouncedStore（2s）——三件套缺一不可：
  写失败回滚 dirty 重试（铁律 6）+ flushAllCaches 强制落盘纳管 + reset 取消挂起
  （防"清空被撤销"）。参考 gameProfiles（B5）。
- 消息推送：内容侧推送类 action（STEAM_RATINGS_UPDATE 等）就绪快路径**同步**
  应用——微任务延迟会让批次收尾抢先终止 job，迟到推送被静默丢弃（B8 实证）。

## 自愈优先纪律（第七轮起）

- 系统能自愈的不留给用户手动操作：未找到徽章点击重试（RETRY_GAME_LOOKUP）、
  详情页网络故障期 30s 自动重查、负缓存分级退避（15min→1h→2h）——但**一切
  自动重试总量有界**（节流 + 单次 + 每游戏至多一次）。
- 窄化 action 原则：列表页就地重试不经 SEARCH_STEAM（其 sender URL 会写入
  URL 索引污染列表页）——RETRY_GAME_LOOKUP 直调 searchSteamGame。
- gate 假红先隔离复跑再定性（FaceFusion 教训）：sim/E2E 间歇红 → 隔离 3 连绿
  即环境抖动；重负载机用 GR_SIM_SIGNAL_TIMEOUT_MS/E2E_SW_WAIT_ROUNDS 提额。

## 发布流程

**版本号纪律（用户指令，2026-10-31 起）**：每次功能/修复批次合并即 bump
manifest+package 版本号（patch/minor）并同步 CHANGELOG.md + welcome
changelog（bump 自动四处）——版本号必须能区分"内容是否更新"；完整发版（tag/release）仍按
下方触发线。**v14.15.0 起四处同步由 `npm run release:smoke` 机器门禁**
（manifest/package/CHANGELOG.md/welcome/油猴 @version ≤ manifest；CI release-smoke
job 同源调用——漂移即红）。

触发线：大版本/5 次小版本/单次>1000 行/累计>3000 行。步骤（顺序固定）：

1. `npm run gate`（全量门禁一条命令——发布触发点必跑；日常批次合并前 `gate:fast` 即可）；
   发布前先 `npm run check:ext-refs -- --refresh` 刷新外部引用锁（30 天保鲜 + 真实默认分支）
2. bump manifest+package+CHANGELOG.md → `npm run package` → `npm run release:smoke`；
   新增外部资源型功能须已回填 first-run.json 真实证据（check:first-run 在 gate 内兜底）
3. commit（中文 conventional）→ tag/push → `gh release create`（附 zip + Mimosa seal）
4. 深度扫描（security_scan，focusFiles=改动文件）→ seal 补入 release notes
5. 油猴脚本更新（v14.15.0 N8）：@updateURL/@downloadURL 指向 raw.githubusercontent
   （Tampermonkey 自动探测，jsDelivr 备源为用户侧手动替换）——发版时油猴 @version
   仅在功能口径同步后递增（≠扩展 patch 联动，语义 = 移植基线版本）
   半自动脚本 scripts/release.mjs 存在但落后于当前流程（visual/双 E2E/zip 附件）——
   以本清单为准，或先更新脚本再用。

## 明确不做（历史决策，勿再提议）

i18n、云同步、跨浏览器、规则市场、MAIN world 注入、全量 TypeScript。

<!-- neat-freak: initialized at 2026-09-12 -->
