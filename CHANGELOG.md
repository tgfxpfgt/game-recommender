# 更新日志 / Changelog

> v14.28.0 起从 README 拆出（README ≤ 400 行纪律，方案 P2-2）。最新条目在最上方。

### v14.42.8（自检卡白名单覆盖度检查 + 一键补全 + 复制诊断包（用户反馈：一键修复后仍无徽章），2026-11-22）

- 跟踪站点白名单×内置站点域名覆盖度检查：存量名单若是老域名时代所存（站点换过域），名单外站点内容脚本在 page-init 直接早退（零徽章且 SW 无报错）——缺域名 ⚠ + 一键补全（并入全部内置域名，匹配语义与 page-init 同款子串判定）
- 自检卡新增「复制诊断包」：版本/开关态/白名单/数据源/导入规则/最近 WARN+ERROR 日志一键复制剪贴板（SW 不可达时原样内联展示）——剩余未知面的取证闭环

### v14.42.7（设置键审计机器化 + 运行自检一键修复（用户指令三条），2026-11-22）

- scripts/audit-settings.mjs：DEFAULT_SETTINGS 键 × 代码消费 × 面板 UI 三面交叉审计（--strict 可门禁）——实测 122 键 0 死键 0 假开关，报告落 docs/reports/settings-audit.md（4 个 NO_UI 复核均有合理解释：steamApiKey 历史遗留登记键；关键词过滤三键为 filterRules 回退默认值，语义已被规则列表 UI 覆盖）
- 🩺运行自检卡一键修复：总开关一键开启 / 徽章可见性一键全开 / 导入规则包一键删除恢复内置（现成 action，修复后自刷新）

### v14.42.6（dashboard 运行自检卡——徽章不显示一键定位（开关态/规则源/后台存活），2026-11-22）

- 诊断页新增🩺运行自检卡：扩展版本 / 总开关 enabled / 徽章可见性 / 跟踪站点名单 / 数据源态 / 导入规则包覆盖提示（含生效 xdgame titleLink 快照）/ SW 存活——任一 ⚠ 即三站无徽章的直接原因（现成消息组装零新契约）

### v14.42.5（MC 双分显示 + steamMissing 全新 MC 详情卡 + 双失败如实反馈（用户指令三条），2026-11-22）

- MC 双分：api-metacritic 升级 fetchMetacriticDetails 单次抓取（媒体分 ld+json + 用户分 aria-label 锚——global-score-value testid 被媒体分块复用不可用作锚，双页现网取证）；列表徽章双块（MC 媒体分级色 + 用户分蓝紫 mcUserBadge 入 ui-tokens 单源）；主机/模拟器/steamMissing 三路径全透出用户分
- steamMissing 详情页全新 MC 详情卡：双分徽章 + 评论数 + 类型/平台/发行日期/发行商/简介（ld+json 结构化）+ MC 链接；负缓存 notFoundMeta 扩展详情字段（截断有界），两管线直返零重复请求
- 双失败如实（议题③）：MC 兜底未命中落 attempted 标记 → notfound 文案升级「Steam 与 Metacritic 均无收录记录」——绝不虚挂分数（用户指令：不凑数）
- 回归：test-handlers fixture 升级真实 MC 形态 + 双失败新用例 + consensus ④ 详情字段守卫 + 四套件 165 绿

### v14.42.4（模拟器条目 MC 兜底（用户裁决：精确/有界/失败如实）+ steam250/ITAD 入数据源组设置开关，2026-11-22）

- 两管线模拟器条目接 MC 兜底：与主机共用路径（精确 slug、mcBudget 有界、miss 如实落「MC —」平台标签，不做模糊凑数）；零网络早退退役
- dataSources 加 steam250/itad 两键 + 设置页数据源分类两开关（types/面板/浮窗行填充/ITAD 收藏价监控四处同步）——关闭即不抓取不显示
- 测试基建假绿修复：test-ratings-resume platformHint 用例裸奔真网穿透（PLA 真实 MC 83 改写形状致红）——补用例级 mock 锁「miss 如实」语义；fetch-mock 字符串 payload 语义修正（HTML 端点按原文返回）

### v14.42.3（模拟器条目 MC 兜底（用户裁决）+ steam250/ITAD 入数据源组设置开关，2026-11-22）

- 两管线模拟器条目接 MC 兜底：与主机共用路径（deriveMetacriticSlug 精确 slug、mcBudget 有界、miss 如实落「MC —」平台标签，不做模糊凑数）——零网络早退退役
- dataSources 加 steam250/itad 两键 + 设置页数据源分类两开关：关闭即不填充浮窗排名/最低价行；ITAD 关闭同时停收藏价监控（与 epic/gog 同语义）
- 回归：test-settings-sync 键面一次过 + 受影响 5 套件 162 绿

### v14.42.2（游戏三分类管线 + 规则合并语义升级——非Steam PC 游戏标 MC·Steam 未发售；导入规则包不再冻结内置演进，2026-11-22）

- 规则合并（议题治理）：getAllRules 整包覆盖退役——同 key 站点字段级合并（导入覆盖保留意图，内置新字段穿透），自定义站追加/内置独有站保留；修复'导入过规则包后新站点适配永久失效'（用户环境徽章消失的头号嫌疑）
- steamMissing 双管线（用户需求三分类②）：详情确认 Steam 无值→单次 Metacritic 兜底（EN 段推 slug）→MC 分+「Steam 未发售」标签；元数据落负缓存 notFoundMeta，列表管线直返零新增请求；构造单源 orchestrator-shared（铁律 18）
- steamMissing 详情 MC 视图文案分支（区别手动声明语气）；列表徽章零改动复用 gr-mc-badge
- 回归：test-rules-cleanup 合并语义 2 例 + test-handlers steamMissing 组 2 例 + test-match-consensus ④单源/接线守卫 + fetch-mock 字符串 payload 语义修正
- playbooks §6c 规则与机制三级分类表（L1 通用/L2 共用机制·站点规则/L3 站点专属）+ 游戏三分类管线语义登记

### v14.42.1（e2e-probe 装载对象改 dist 产物——v15 后源码树直跑必撞 Preact 裸 specifier，2026-11-22）

- 探针 EXTENSION_DIR 默认 dist（与 e2e:dist 验收对象同纪律），--ext 保留源码树装载诊断口；修复 argv TDZ
- 真机复验三用户报告页（xdgame/list1=25 徽章、xianyudanji/pcdj=50、gamer520/pcplay=20）——v14.42.0 产物全绿，用户侧无徽章=装载陈旧产物/源码树所致

### v14.42.0（非PC专列页识别——XDGAME 移植分类家族 + gamer520 移植P + 详情页平台标注链，2026-11-22）

- XDGAME 改版取证修复：新增 /list/2/ 移植聚合专列与 /game/118~122/ 细分分类（pl-card 新列表结构 a.pl-title，平台标注在标题外）——listPlatformHints 补 6 条 + listItem 双选择器，修复列表页/详情页不工作（此前名称被平台标签污染/整页误走 PC 检索）
- gamer520 /yzb-2「移植P」分类 hint + 详情 meta-category 标注选择器
- 详情页平台识别补链：SEARCH_STEAM 契约新增 platformHint（candidates 提取器：站点徽章/面包屑逐段语义校验去噪），URL 先行守卫与 phaseDetailPlatform 同拼接语义——专列页详情不再误挂 Steam 错误徽章
- 词表扩充（现网取证）：裸 ps 段/移植P/任天堂段；Windows移植分类刻意不注入（实抓为 PC 复刻，Steam 有数据）
- perf-budget 重锁（并账 v14.41.0 usage 埋点遗留 +4.3KB/109 文件）+ 模块索引重生成 + playbooks §6b 站点适配配方

### v14.41.0（模块分级自动统计：usage 埋点 + 分级建议生成器，2026-11-21）

- background/core/feature-usage.js 单源（USAGE_KEYS 20 键）+ track-event 管线全 type 埋点 + 页面 boot 幂等上报（applyPageTheme 公共入口）+ 备份/导入导出/xdgrid/Steam页浮窗动作埋点
- scripts/gen-module-tiers.mjs：读 GET_RUNTIME_METRICS usage.* 快照与 docs/module-tiers.md 现表对比，输出调级建议（只建议不自动改表——T 级投入变化须人工裁决+CHANGELOG 可追溯）

### v14.40.0（运维纪律四指令：模块分级/测试最小化/多主题基线收缩/省token工作流，2026-11-21）

- 模块分级台账 docs/module-tiers.md（T0核心/T1活跃/T2低频默认不管/T3冻结）——测试面与审查深度按级分配
- visual 基线 11→5 张（只留默认主题 steam——主题变量块属构建单源产物，非默认主题回归手动抽查兜底）
- 工作流纪律（记忆持久化）：简单改动免全量门禁/能不测就不测交给用户验证/时间参数10倍加速

### v14.39.0（CI visual 适配 + sim 诊断快照 + freegames h() 化 + 文案字典首域，2026-11-21）

- CI visual 永久 advisory（Linux 字体恒差非瞬时噪声，E4 升级阻断退役——CI 恒红 8+ 连根治）+ 基线去版本号（bump 不再重钉）+ ios17 终判阈值 bug 修复
- sim harness waitForSignal 等待期 30s 周期状态快照（vitest timeout kill 也留现场——双流竞态诊断性）
- freegames 月历/游戏卡 h() 组件化（trusted 串注入退役）+ StatusLine 双重转义修复 + 重复接线块清理
- 文案集中层首域：shared/ui-text.js 字典单源（t() 点路径+{var} 替换）+ badges/queue/status/finish 四域迁移 + 完整性门禁测试
- **完整发版**（触发线：v14.38.0 批 2143 行 > 1000 行）：gate 全量等效验收（vitest 全量绿/mutations 隔离 PASS/visual 11/11/E2E 12/12/package+smoke 绿）+ ext-refs --refresh 3 条真实校验 + 深度扫描 seal `sha256:0a68679a3c63167e7678afb26d8da885fbd7c244e6a0665eb4a23366f37730ad`（Semgrep OSS + eslint-plugin-security 双工具链，6 findings 全数定性——5 处 dangerouslySetInnerHTML 逐条核对 trusted 转义链，报告 docs/reports/security-scan-v14.39.0/）

### v14.38.0（Preact 全量迁移收官——innerHTML 生产面清零 + sim-list 竞态定性，2026-11-21）

- 内容域+页面域全量 Preact 化（30 文件 84 sink 退役，基线 85→1 唯一残留=preact-globals vendor 产物）
- content/core/preact-mount.js 单源助手（mountView 共享容器清场纪律）
- sim-list 竞态：探针 20 连绿未捕获，retry:2 绷带恢复 + 证据登记（复现率约1/15 隔离运行，根因待后续专项）
- 测试基建：test-sidebar-rows/test-sidepanel/test-options-render 手写 DOM 桩退役换 happy-dom 真实 DOM

### v14.37.4（CI Actions pin-to-SHA 迁移（发版 seal 挂账清偿），2026-11-21）

- 23 处 uses 引用从可变 tag pin 到 commit SHA（checkout/setup-node/codeql/cache/upload-artifact/gitleaks——供应链纵深防御，Scorecard 同款检查项；@v4 注释保留版本可读）
- pr-agent.yml（另一会话进行中工作）不在本批；semgrep p/secrets 复扫可变 tag 0 findings

### v14.37.3（旧 E2E 编排层退役删除——runner 单源化清理批，2026-11-20）

- 删 tests/e2e/run.mjs + tests/e2e-smoke.mjs + scripts/e2e-dist.mjs（编排层退役——@playwright/test runner v14.36.0 全面接管且双跑验证绿，回退面过稳定期）；节函数 section-*.mjs 与 helpers.mjs 保留（runner 复用单源），e2e-probe 真机诊断不受影响
- 引用面同步：calibrate-budgets e2eMock 校准命令 e2e:dist → e2e:pw（否则下次校准跑已删脚本）、coverage-gate 注释、gate.mjs/AGENTS 回退面表述、npm 脚本 e2e:dist 删除


**完整发版（2026-11-21，tag+release，zip 上线）**：触发线（v14.31.0 后累计 +12,000 行）→ gate 全量绿（E2E:pw runner 首次完整跑；worktree 干净检出隔离验收）→ **安全深度扫描 seal `sha256:c0c3303486e7788bd009d5db2ffd0968c56c76b6907a37484b753dc7f3079a94`**（Semgrep OSS 含自定义规则：98 findings 0 新增逃逸——74 JS 类全在基线锁管理面 + 24 Actions pin-to-SHA 挂账；报告 docs/reports/security-scan-v14.37.3/）

### v14.37.2（文档对齐——E2E 验收入口 e2e:dist → e2e:pw（活规则保鲜），2026-11-20）

- AGENTS 测试约定节 + 常用命令、CONTRIBUTING 环境准备三处 E2E 入口描述随 v14.36.0 gate 切换对齐（文档腐烂=AI 读错上下文的首要来源——check:agents-docs 引用校验之外的语义面补齐）；新增检查项仍写 section-*.mjs（runner 桥接自动获得）；旧入口保留运行能力回退面登记

### v14.37.1（dashboard 数据渲染面 Preact 化（渐进迁移续批），2026-11-20）

- dash-stats 四处数据渲染 innerHTML 退役：下载方式/站点 Top5/游戏明细表/行为日志表（含组件化+插值天然转义）
- DOWNLOAD_METHODS/SITES_TOP/LOG_TYPE_NAMES 展示映射迁入组件模块

### v14.37.0（B5 构建层评估入库——WXT 迁移暂缓（评估即交付），2026-11-20）

- docs/reports/B5-WXT构建层评估-2026-11-20.md：WXT 非模块入口 IIFE 输出可行，但无「多文件 classic concat 保真」原生语义（Vite HTML classic script 不进依赖图）——迁移=架构范式重写（50+ 页面脚本 ESM 化+三单源派生面重建）非构建器替换
- 结论：暂缓迁移，v15 构建器继续演进；WXT 转观察项——页面脚本 ESM 化（全量 TS 化后续自然阶段）完成后迁移成本大降再评估；与清单原始判断的差异已在报告登记

### v14.36.0（Playwright 节管线全面接管 E2E 验收（B4 阶段 2+3），2026-11-20）

- 阶段 2 薄适配层移植：节函数零重写（runInstall…runCustomSite 原样复用语义零漂移），每节一个 serial test；state.check 桥接 expect.soft（软断言=失败继续跑完+终态红，精确对应旧 check 汇总语义）；12/12 全绿 1.3 分钟（4 boot + 8 节管线：评分波次/滚动批次/持久化重启/自定义站点全跑通）
- 阶段 3 gate 切换：gate E2E 冒烟步骤 e2e:dist → e2e:pw（内聚 build——验收对象 dist 产物语义保持）；@playwright/test 获得逐节 trace 失败保留/软断言/分节报告/超时即红留 trace
- 旧管线 tests/e2e/run.mjs 保留运行能力作回退面（npm run e2e:dist），退役删除留后续清理批；suite-budgets e2eMock label 更新（cap 105s 覆盖新口径 78s 实测）

### v14.35.1（欢迎页状态区块 Preact 化（渐进迁移续批），2026-11-20）

- welcome-status.preact.mjs：ChangelogBox/SiteStatus/Dots 组件——六处 innerHTML 退役
- 主题选择按钮（guideState 状态交互）保留原实现另批

### v14.35.0（Playwright Test runner 落地（B4 阶段 1）——boot 冒烟 + harness 代理缺陷修复，2026-11-20）

- @playwright/test runner 基建：playwright.config.mjs + tests/e2e-pw 扩展 fixtures（复用 helpers 单源语义零复制）+ boot.spec 4 用例 4.9s 全绿（SW 装载/popup 冒烟/options 零 console error/fixture 页环境）
- trace 失败保留（trace viewer 回放替代单次跑数排障）；GR_EXTENSION_DIR 默认 dist、E2E_MOCK 默认 1（离线确定性）
- harness 缺陷修复：launchOpts 补 --no-proxy-server——系统代理下 host-resolver-rules 对代理连接不生效（fixture 导航撞真实站点 4xx），同机开关对照实证
- @playwright/test 与 playwright-core 锁 1.63.0（chromium-1243 缓存内，免下载）
- 补登 b220d93 freegames 限免页状态区块 Preact 化批次（该提交未走 bump，本条目为其补记）

### v14.34.5（TS strict 三域收口——noImplicitAny 与 strictNullChecks 全开零豁免，2026-11-19）

- 三域 tsconfig 删除 noImplicitAny:false / ui 域 strictNullChecks:false 显式豁免——strict 开关组全开，JSDoc 形态下完整 strict 覆盖达成
-  fallout 32 处一次修净：ui 域隐式 any 家族 12 处（dash-stats 参数注解/rules.js/__GR_TOKENS__ globals.d.ts 单源声明）+ strictNullChecks 20 处（files 可选链/preact 装载器返回类型收口/tabId·at(-1)·customThemeCss 断言与守卫）——行为等价由既有测试背书
- 类型债棘轮基线三域降至 0（只降不升，隐式 any 回流直接红）

### v14.34.4（hyperfine 基线校准落地——多轮统计口径 + 校准脚本入库，2026-11-19）

- calibrate-budgets.mjs：hyperfine ≥3 轮 mean 口径回写 suite-budgets.json（单次采样定基线的抖动固化风险消除——sim 实证旧基线偏低 13%，cap 45000→50000）
- Windows 执行三坑入库：hyperfine 位置参数=逐条命令须整串引号成单 argv / npm·npx .cmd shim 裸名 CreateProcess 不解析须包 cmd /c / 2.x export-json 为逐轮 measurements[].time_wall_clock 原始值无预聚合字段
- CONTRIBUTING 增 PR 流与独立评审位节（评审位文件随 v14.34.3 入库，首启清单+批次流）

### v14.34.3（阶段 3 收尾：19 主题数据化（主题即数据），2026-11-19）

- shared/themes-data.js 主题变量数据单源（19 套变量块/标题/设计注记提取入库）
- build.mjs generateThemeCss：锚点区变量块构建再生（幂等；主题专属手写规则区保留）
- 新增主题 = 数据加对象 + VALID_THEMES/THEME_LABELS 各一行后跑 build

### v14.34.2（ast-grep 结构化门禁落地——四规则试点 + 正则盲区修复，2026-11-19）

- ast-grep 0.51.3 devDep + sgconfig/rules 四规则：后台动态 import 禁令（铁律2）、长延时与 fetchWithTimeout 超时零字面量（铁律13）、JS 侧内联事件处理器静态护栏（铁律1）
- 精度升级实证：老正则对首参含逗号的 setTimeout 漏检，AST 模式当场抓到 list-page.js 真实违例（2000ms 箭头函数首参）→ PRELOAD_NEXT_PAGE_DELAY_MS 具名常量
- gate:fast 新步骤 check:ast（872ms）；渐进迁移期原正则扫描双跑保留
- perf-budget SW 基线纠偏 +10B（v14.34.1 锁值低于 HEAD 终态实测，stash 纯净复测实证非本批增长）

### v14.34.1（knip 死代码盘点落地，2026-11-19）

- knip 6.46.0 devDep + knip.json 入口配置（适配 esbuild concat 全局语义/getURL 动态装载面豁免——32 unused files 误报全定性豁免）
- 清理 5 处真死代码：baseline-crawl.mjs 死文件 + warmupSiteAlertPersist/rollbackRetrievalVocab/happyWindow 死导出 + ONE_DAY 重复副本单源化（manager 改 import fetch）
- 常态化 = npm run knip 手动盘点（不入 gate:fast——全仓扫描耗时，渐进迁移期豁免面大）；回归 93 用例全绿

### v14.34.0（AI 协作与安全审计调研落地（A3/C2/C3），2026-11-19）

- check:agents-docs 活规则保鲜门禁（AGENTS/CONTRIBUTING/playbooks 引用命令与路径存在性 53 处——规则腐烂=AI 带失效指令工作）
- check:dom-sinks DOM sink 基线锁（29 文件/121 点只减不增——铁律 1 机器化常态防线）+ .semgrep/gr-dom-sinks.yml 自定义规则入发版扫描（非字面量 sink 80 findings 人工定性）
- Chrome 官方安全清单对照审计报告（10 项达标 + http 注入域/全域 optional_host 两项功能性权衡登记 + B4 dependency-review 不采纳判定——无 PR 流程属装饰性 job）

### v14.33.1（AI 协作调研落地：AGENTS 收敛 + E2E dist 验收 + Preact 组件三缺陷修复，2026-11-18）

- AGENTS.md 发布流程细节指针化到 playbooks §7（去双源重复）+ 新增「先问再做」边界档（GitHub 2500 仓三级边界经验）
- E2E 验收入口切 e2e:dist（源码树直跑撞 Preact 裸 specifier——阶段 3 遗留）；SW 等待改 Playwright 官方 waitForEvent 事件模式（轮询兜底）
- 构建器修复：.mjs 组件不再并入 classic bundle（require 泄漏防线入 verifyDist）；dash-stats 三连修（h 漏导出/mountAt 参数错位/实参快照陷阱——dashboard 空态真实生产缺陷）

### v14.33.0（提交与版本规范治理，2026-11-17）

- 提交信息升级 Conventional Commits 1.0.0 全量校验（commit-lint.mjs：类型白名单/scope 单词字符集/subject≤72/结尾禁句号/body 空行/! 与 BREAKING CHANGE 一致性）
- bump 支持 auto 级别推导（区间提交类型 semver 推导）+ major + 显式低于推导拦截（--force 兜底）+ CHANGELOG 条目日期化 + 每版一 tag 纪律
- CHANGELOG.md 近 10 版日期回填；补打 v14.31.1~v14.32.3 七个 tag（manifest 变更提交锚定）；CONTRIBUTING 提交规范节 + AGENTS 指针

### v14.32.3（阶段 5 收官：仓库卫生 + AGENTS v15 形态重写，2026-11-17）

- CHANGELOG 拆档（近 10 版主文件 + archive 归档）+ 陈旧脚本清理
- APP_NAME 显示名单源 + background 域 console 前缀接引（数据兼容面标识符冻结）
- AGENTS.md 按 v15 新形态重写（构建形态/happy-dom 测试约定/铁律 19 名字提取防复发）

### v14.32.2（油猴词表同源构建器落地，2026-11-16）

- scripts/build-userscript.mjs：retrieval-vocab 单源→油猴 VOCAB 快照生成（GR-GENERATED 锚点幂等刷新）
- 词表防漂移从手工对齐升级为构建期生成+门禁双保险

### v14.32.1（阶段 3 Preact 化首批落地，2026-11-16）

- UI 设计 token 单源（ui-tokens + tokens.css 构建生成）
- popup API 状态区/dashboard 状态区块 Preact 组件化（innerHTML 8 处退役）
- build 链支持 type=module 页面脚本（esbuild ESM bundle）

### v14.32.0（绿地重构阶段 0：esbuild 构建器落地——dist 产物管线（行为零变化），2026-11-14）

- scripts/build.mjs 双策略构建器：页面顺序 concat（classic 全局语义 100% 保真）+ content ESM 模块图 esbuild bundle（module-loaders 装载桥 19 条相对 import）+ background ESM 单文件；构建 277ms
- dist 镜像：manifest 模板化（WAR 43→1、content_scripts 7×7 文件→7×1）+ HTML script 折叠单 tag + 静态资产镜像；e2e:dist 51/51 全绿（GR_EXTENSION_DIR 参数化 helpers/visual）
- tracker 装载桥单点收敛（5 处 getURL import→loadOne）；sidebar 两处按需 getURL 改静态 import；site-scripts 双模式清单（banner 注入）
- 门禁适配：gen-war 派生含装载桥单源、coverage 豁免生成桥、perf-budget 四处实测重锁、visual 基线重钉、eslint/globals.d.ts 补 banner 全局声明

### v14.31.3（CodeQL 106 条告警全清零：43 处测试桩清理 + 52 处误报 dismiss + 11 处实修，2026-11-14）

- 43 个测试文件删除 ('use strict') 无用表达式（ESM 惰性指令）；orchestrator-detail 删重搜路径无用 appIdTrusted 赋值；search-candidates 去冗余恒真条件；detect-name/search 字符类双单引号 ×4
- test-changed.mjs git() execSync 拼接改 execFileSync 数组参数 + git ref 白名单校验（CLI 注入面消除）；coverage-snapshot TOCTOU 改 try/catch 直读；test-cost-history 临时文件名加随机段
- 52 处误报 dismiss 带理由归档（dashboard 经典脚本跨文件全局 ×19/URL 子串防御检查 ×15/油猴 textContent 边界 ×3/实体单遍解码等）——Security 面板 open 告警清零

### v14.31.2（安全基建增强：CodeQL workflow + ReDoS 实证复核 + gate 信号提额，2026-11-14）

- CodeQL 深度分析（javascript-typescript security-and-quality）随 push/PR/每周自动跑——结果进 GitHub Security 面板，与本地双工具链互补
- detect-unsafe-regex 13 处实证复核：对抗输入实测 11/11 全 SAFE（最坏 0.3ms/446KB，有界量词线性形态）——redos-review.md 入库，规则维持 off 证据在案
- gate GATE_VITEST_ENV 信号超时 20000→30000（满载竞态绷带加固，仍低于 harness 默认 60s）

### v14.31.1（安全扫描链路替代：Semgrep+ESLint security 双工具链（Mimosa 断连期 seal 证据源），2026-11-14）

- eslint-plugin-security 4.2.1 常态入 lint 门禁（精选 10 条 error 规则；object-injection/non-literal-regexp/unsafe-regex 三条 off 理由登记）
- Semgrep OSS 1.185.0 出具 v14.31.0 发版深度扫描报告（焦点 31 文件 0 findings/全库 3 findings 全数定性误报）——seal sha256:e0a98c4d…fab11 补入 release notes 与 CHANGELOG
- AGENTS.md 发布流程第 4 步改写：扫描链路主源改双工具链（Mimosa MCP 可用时保留）；detect-unsafe-regex 13 处有界量词误报挂账择批 ReDoS 复核

### v14.31.0（列表/详情双管线一致性统一：单源化共享层 + 三态结构化 + 防脱节门禁，2026-11-14）

- 置信度字段装配单源 attachMatchConfidence（match-confidence.js——列表 matchConflict 强制降级内聚，两管线同函数装配，新增字段只改一处）
- MC 分级色单源 **GR_PATTERNS**.mcColorFor（列表 gr-mc-badge 与详情 MC 视图同一把尺，两处字面量副本退场）
- 详情 SEARCH_STEAM 未命中响应补结构化 errorType（network/notfound，与列表 networkFailed 哨兵同名同义）——内容侧优先消费结构化字段，reason 正则兼容保留
- 防脱节规则：铁律 18 登记 + playbooks 配方 + test-match-consensus 一致性门禁组（5 用例：同输出/冲突降级/纠正强制确认/色带等价+无双副本/三态源码守卫）；有意差异登记（MC 视图无新游标签、matchConflict 仅列表接线）
- **完整发版（2026-11-14，tag+release，zip 上线）**：触发线（v14.28.10 后插入 +3255 行）→ gate 全量等效全绿（sim-list 满载竞态隔离 3 连绿定性）→ ext-refs --refresh 3 条真实校验。**安全深度扫描 seal `sha256:e0a98c4d5b45c066b80718a8a89a0bd4e408427e3b74c881bab23263168fab11`**（Semgrep OSS 1.185.0 + eslint-plugin-security 4.2.1 双工具链出具——Mimosa 钩子禁用与 MCP 断连后经用户裁决改链；焦点集 31 文件 0 findings / 全库 3 findings 全数定性误报，报告 docs/reports/security-scan-v14.31.0/）

### v14.30.0（主机游戏检索三连修复：MC 域权限根治/详情页平台预检/手动面板机型入口，2026-11-14）

- MC 评分根治：manifest 补 metacritic.com host_permissions（缺失致 MV3 SW fetch 被 CORS 静默拦截，v14.10.0 起功能从未生效）+ 失败 Logger.warn 可诊断 + 超时单源新键 fetchTimeoutMetacriticMs + first-run 真实证据回填
- 详情页平台预检：searchSteamGame 接入 phaseDetailPlatform（与列表 phasePlatform 同优先序：映射>模拟器>主机MC>PC），主机整合/模拟器/移植版条目不再先发整套 Steam 检索；URL 索引先行加平台守卫
- 词表补「移植版/移植」裸段（PC guard 优先不变）；手动选择面板恢复「主机/模拟器」入口按钮（面板内直达机型专页，与 ⚙ 菜单同路径）

---

更早版本（v14.29.0 及前）已迁档：[docs/changelog/archive.md](docs/changelog/archive.md)。
