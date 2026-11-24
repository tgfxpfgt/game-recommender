# 游戏雷达 Game Radar 全面审计报告 v14.42.16

> 审计日期：2026-11-23 ｜ 审计对象：`game-recommender`（Chrome MV3 扩展）
> 审计口径：编码 / 工程构建 / 功能与业务逻辑 / 资源调用与安全 / 组件与上游技术 / UI / 测试 全环节覆盖
> 实证环境：Windows 11，Node v22.23.2，npm 10.9.8，依赖已安装（node_modules 在位）

---

## 0. 摘要（TL;DR）

**总体结论：工程成熟度高，质量护栏体系完备，未发现 P0 阻断级缺陷。**

项目历经 14 个大版本演进，分层单向、注册表单源派生、防抖/锁/缓存/重试机制单源化、
出站 SSRF 防护、消息契约 + sender 双门禁、诊断轨迹与开销历史等制度均已落地并有
对应门禁兜底。本次审计实证：**ESLint 零警告、TypeScript 三配置全绿、6 项快静态
门禁全绿、抽样 129 个单元测试全部通过**；最近一次 fast 门禁记录 165.6s 全绿。

问题分级概览：

| 级别 | 数量 | 性质 | 处置建议 |
|---|---|---|---|
| P0 阻断 | 0 | — | — |
| P1 应尽快处理 | 3 | 依赖 major 落后 / 设置写入纵深防御 / 构建清单双源 | 1–2 个批次内闭环 |
| P2 计划处理 | 6 | 死代码残留 / 链接前缀重复 / 供应链浮动 tag / 忽略文件缺口 / 文档归档 / audit 受限 | 排期到常规批次 |
| P3 观察项 | 6 | 大文件热点 / 覆盖率棘轮 / 可信 HTML 守卫 / 已知测试噪声 / 油猴版本口径 / 监控建议 | 随迭代渐进 |

**最值得优先做的三件事**：① 专项升级 vitest 4→5、eslint 9→10、pixelmatch 7→8；
② 给 `SAVE_SETTINGS` 补顶层键白名单裁剪；③ 构建器内容模块清单改为从
`content/module-manifest.js` 派生，消除第二份手工清单。

---

## 1. 审计范围、方法与实证记录

### 1.1 覆盖环节

| 环节 | 审计面 |
|---|---|
| 编码 | 分层依赖方向、规范遵守、错误处理、TDZ/未用变量、注释双语、安全反模式（eval/动态 import/内联事件/localStorage） |
| 工程 | 构建双策略、模块注册、存储注册表派生、门禁编排、版本四处同步、产物打包、hook/CI |
| 功能逻辑 | 列表/详情双管线一致性、三态故障语义、推荐信号装配、缓存分级、限免监控、续跑/自愈、限流退避 |
| 资源调用 | 出站端点单源、SSRF/重定向校验、限速与超时、外部引用登记、首跑证据、LLM 端点分级 |
| 组件/上游 | 依赖版本新鲜度、vendor 库、Preact 引入方式、上游 API 健康度 |
| UI | 渲染方式（Preact 迁移进度）、转义链、危险 HTML 边界、主题/token 单源、徽章组标记 |
| 测试 | 套件分层、夹具映射、覆盖率棘轮、缺陷回放、语料分母、视觉回归、E2E 编排、开销预算 |

### 1.2 实证命令与结果

| 检查 | 命令 | 结果 |
|---|---|---|
| ESLint | `npm run lint`（`--max-warnings 0`） | ✅ 零警告退出 0 |
| 类型检查 | `npm run typecheck`（tsconfig / ui / content 三配置） | ✅ 全绿退出 0 |
| 文档版本门禁 | `npm run check:docs` | ✅ manifest v14.42.16，6 份根目录 md 一致 |
| 占位/契约缺口 | `npm run check:stubs` | ✅ 无未豁免占位；契约 action 全部有实现 |
| 外部引用锁 | `npm run check:ext-refs` | ✅ 3 条登记一致，保鲜期内（2026-11-21 校验） |
| 首跑证据 | `npm run check:first-run` | ✅ 3 条 required:true 均有真实成功调用记录 |
| 匹配语料分母 | `npm run check:corpus` | ✅ 42 条样本标注完整 |
| DOM sink 基线 | `npm run check:dom-sinks` | ✅ 1/1 基线锁通过（生产 innerHTML sink 仅剩 1 处 vendor 全局垫片） |
| 死代码扫描 | `npx knip` | ⚠️ 4 文件 + 4 未用导出（详见 §4 B1） |
| 抽样单测 | `vitest run` 4 个核心套件 | ✅ 129/129 通过（10.83s） |
| 门禁历史 | `scripts/.gate-costs.jsonl` 末条 | ✅ fast 模式整条 165.6s，code 0 |

### 1.3 规模度量（源码行数，不含 node_modules/dist/docs）

| 目录 | 文件数 | 行数 | 说明 |
|---|---|---|---|
| background | 93 | 18,542 | SW 业务主体（core/storage/steam/recommend/sites/freegames/handlers） |
| content | 40 | 9,111 | 内容脚本（list/detail/core/tracking） |
| shared | 16 | 2,455 | 跨层共用（词表/转义/模式/平台/token/文案） |
| data | 3 | 721 | OPFS 存储底座 + 模块注册表 |
| adapters | 8 | 327 | 下载站适配规则 |
| options | 16 | 6,827 | 设置面板（最大 UI 面） |
| dashboard | 11 | 2,684 | 诊断/统计/备份/导出 |
| popup | 7 | 1,684 | 弹窗 |
| welcome | 5 | 1,531 | 导览 + 更新日志 |
| freegames / hub / sidepanel | 9 | 1,330 | 限免页 / iframe 中心 / 侧栏 |
| scripts | 39 | 5,510 | 构建/门禁/工具链 |
| tests | 105 | 21,491 | 75 unit + 5 sim + 6 integration + 3 e2e-pw，用例约 1,315 |
| styles | 22 | 2,666 | 内容样式 + 19 主题 + tokens |

---

## 2. 现状画像

- **产物形态**：MV3 Service Worker（ESM 静态图）+ 内容脚本（classic 注入序列 +
  动态 `getURL` ESM 装载桥）+ 7 类扩展页（popup/options/dashboard/hub/freegames/
  welcome/sidepanel）。构建器双策略：页面 = 顺序 concat + esbuild transform（保真
  classic 全局作用域）；content/background = 真 ESM 图 esbuild bundle。
- **存储**：OPFS 分文件持久化（突破 5MB `storage.local` 配额），不可用时自动降级
  `storage.local`；33 个模块在 `data/storage-registry.js` 单源登记，文件/格式/备份子集/
  清除范围全部派生；Steam 缓存 4 分文件（meta/rating/detail/spy）。
- **核心链路**：列表批量好评率 → 编排器（缓存优先 / 波次 / 并发 3 / 预约制限速 /
  两级看门狗 / 任务硬截止）；详情页独立编排器；双管线共享置信度装配与平台预检单源。
- **外部依赖**：Steam 商店/appdetails/appreviews/社区搜索/社区评论、SteamSpy、
  Steam250、Metacritic、ITAD、Epic/GOG/GamerPower 限免源、Bing 兜底、可选 LLM
  （Ollama 本地 / OpenAI 兼容远程）。

---

## 3. 分环节审计结论

### 3.1 编码规范 ✅ 良好

**实证良好的面**：

- 分层单向：`data/` 底座不 import `background/*`（经 metrics hook 注入打破反向依赖）；
  content 不反向 import background；`test-integrity` 强制依赖方向。
- 无 `eval` / `new Function`；background 内无运行时动态 `import()`（命中项均为 JSDoc
  类型引用 `import(...)`，铁律 2 落地）；无 HTML 字符串内联事件处理器；无 `localStorage`。
- 未用变量 `no-unused-vars` error 级；`eqeqeq smart`、`prefer-const`、`no-var` 全开；
  类型 strict 三配置通过。
- 机制单源：锁/防抖/Map+TTL/重试在 `core/mechanisms.js`；延时与出站超时入
  `PERF_CONFIG`；扫描确认生产代码 **≥1000ms 延时字面量 0 处**。
- 存储读写走 dataStore；计数类读-改-写加锁；写失败回滚 dirty 重试；防抖落盘纳管
  `flushAllCaches` 链与 reset 取消挂起。

**观察**：

- 注释整体中英双语、版本溯源清晰（v14.x 批次标注密集）；`welcome/changelog.js`
  884 行为更新日志数据集合，非逻辑巨石，可接受。
- 单行语句花括号风格混合（eslint 配置注释已登记：约 196 处，未启用 `curly`，属
  有意现状）。

### 3.2 工程与构建 ✅ 完备，存在 1 处双源偏差

**实证良好的面**：

- 门禁统一：`gate.mjs` 全量 / `--fast` 受影响面选择；步骤级墙钟预算
  （`suite-budgets.json`）+ 开销历史中位数告警 + 失败诊断（末 25 行 + 首个错误行）。
- 静态门禁群覆盖：docs 版本、模块索引、占位实现、外部引用、首跑证据、语料分母、
  DOM sink、ast-grep 结构化规则、stubs、漫游路径。
- 版本四处同步由 `npm run bump` 机器完成，`release:smoke` 门禁兜底；油猴词表快照
  由 `build-userscript.mjs` 从 `retrieval-vocab.js` 生成，`test-userscript-pure` 兜底。
- 存储注册表/内容清单/适配规则/词表/UI token/主题数据均为单源派生。

**发现（详见 P1-3）**：`scripts/build.mjs:38` 的 `MANIFEST_MODULES` 16 项与
`content/module-manifest.js` 的 CORE/OPTIONAL 清单内容一致，但是**第二份手工数组**。
新增内容模块若只改 manifest 而漏改构建器清单，bundle 装载桥会漂移。应改为构建期从
manifest 导入派生。

### 3.3 功能与业务逻辑 ✅ 语义严谨

**实证良好的面**：

- **三态故障语义**：network/ratelimit/notfound/timeout/empty 可区分；后台失败走
  `networkFailed` 哨兵（`failed:true` + errorType），内容侧渲染网络异常徽章并支持
  点击重查，未把失败渲染成"未找到"。后台 3 文件、内容侧 2 文件有接线。
- **双管线一致性**：置信度字段装配走 `match-confidence.attachMatchConfidence` 单源；
  MC 分级色走 `__GR_PATTERNS__.mcColorFor`；平台预检/手动映射两管线同优先序；
  `test-match-consensus` 门禁守一致性。
- **缓存分级**：Steam 缓存 4 分文件 + 条目级 TTL + 负缓存分级退避（15min→1h→2h）；
  搜索缓存/LLM 缓存/推荐值缓存均有界 LRU。
- **批量韧性**：异常降速有任务级总额帽（90s）；重试轮退避 6s、并发 1；任务硬截止
  300s；单条目软阈值告警 20s / 硬阈值放弃 120s；SW 保活心跳；续跑经 alarm 静态调用。
- **自愈**：未找到徽章点击就地重试（窄化 action，不经 SEARCH_STEAM 污染 URL 索引）；
  详情页故障期自动重查；温层模块惰性加载兜底；scope 误判由按需补加载自愈。
- **设置防御**：深合并回填默认值、null/undefined 跳过、类型不一致回退默认、数值键
  服务端二次钳制（`NUMERIC_RANGES`）。

**观察**：

- `SAVE_SETTINGS` 契约（`message-contract.js:233`）只校验"纯对象 + weights 有限数值"，
  **未做顶层键白名单裁剪**（详见 P1-2）。当前靠 sender 门禁把 web 源挡在特权 action
  外，纵深防御可再补一层。
- 大文件热点集中在编排与批量链（详见 P3-1），属复杂度自然堆积，暂无正确性风险。

### 3.4 资源调用与安全 ✅ 护栏扎实

**实证良好的面**：

- **出站统一走 `fetchWithTimeout`**：裸 `fetch` 仅出现在 `utils.js` 封装内部；
  SSRF 校验覆盖 IPv4 私有/保留段、IPv6、localhost、`.localhost`、FQDN 尾点绕过；
  重定向 `redirect:'manual'` 逐跳重新校验，最多 5 跳。
- **限速**：Steam 域预约制 slot（同步段读-改-写原子）+ 突发视界钳制（令牌桶债务帽）；
  另有 per-host 滑动窗口兜底；每次出站（含拦截/失败/限流）写审计。
- **超时单源**：13 档出站超时全部入 `PERF_CONFIG`；AbortController + `clearTimeout`
  finally 清理；LLM 远程超时 25s 预留 SW 30s 终止阈值余量。
- **消息安全**：契约校验入参必填/类型/长度；sender 门禁区分扩展页可信源与 web 内容
  脚本源，特权 action（SAVE_SETTINGS/CLEAR_DATA/IMPORT_DATA/规则保存等）不对 web
  源开放。
- **LLM 端点分级**：local（Ollama）允许私有地址；远程 OpenAI 兼容强制 https +
  非私有地址（`assertRemoteLlmEndpoint`），防 Bearer 密钥发往内网。
- **外部引用登记制**：3 条托管 URL 在 `external-refs.json` 锁分支/保鲜期；外部资源型
  功能有首跑真实证据；404 区分"对端无资源"与"我方引用写错"。
- **数据脱敏**：诊断轨迹环形 500 条、白名单字段（仅 hostname + 游戏名 6 位哈希，
  零完整 URL/标题/appId）；导出前 URL 带密钥参数经 sanitize 剥离。

**观察**：

- `npm audit` 在当前 npmmirror 镜像下不可用（安全审计端点返回 NOT_IMPLEMENTED/404），
  本次未能产出依赖漏洞报告（详见 P2-6）。
- 历史 Semgrep 报告（v14.39.0）6 处 `dangerouslySetInnerHTML` 已逐条定性为 trusted
  助手输出；现存 10+ 处信任边界依赖 formatXxx 内部转义，建议补静态守卫（详见 P3-4）。

### 3.5 组件与上游技术 ⚠️ 部分 major 落后

依赖版本对照（lock 实际 vs registry latest，2026-11-23 查询）：

| 包 | 范围 | lock 实际 | latest | 状态 |
|---|---|---|---|---|
| esbuild | ^0.28.2 | 0.28.2 | 0.28.2 | ✅ 最新 |
| typescript | ^7.0.2 | 7.0.2 | 7.0.2 | ✅ 最新 |
| preact | ^11.2.0 | 11.2.0 | 11.2.0 | ✅ 最新 |
| happy-dom | ^21.0.4 | 21.0.4 | 21.0.4 | ✅ 最新 |
| eslint-plugin-security | ^4.2.1 | 4.2.1 | 4.2.1 | ✅ 最新 |
| @ast-grep/cli | ^0.51.3 | 0.51.3 | 0.51.3 | ✅ 最新 |
| pngjs | ^7.0.0 | 7.0.0 | 7.0.0 | ✅ 最新 |
| **eslint** | ^9.0.0 | 9.39.5 | **10.15.0** | ⚠️ major 落后（patch 已到 9.x 最新） |
| **vitest** | ^4.1.10 | 4.1.10 | **5.1.1** | ⚠️ major 落后（含 @vitest/coverage-v8） |
| **pixelmatch** | ^7.2.0 | 7.2.0 | **8.0.0** | ⚠️ major 落后 |
| @playwright/test | ^1.63.0 | 1.63.0 | 1.65.1 | 🟡 minor 落后（playwright-core 同） |
| knip | ^6.46.0 | 6.46.0 | 6.48.0 | 🟡 小落后 |
| fast-check | ^4.9.0 | 4.9.0 | 4.11.0 | 🟡 minor 落后 |
| @types/chrome | ^0.2.6 | 0.2.6 | 0.3.7 | 🟡 minor 落后 |
| prettier | ^3.9.6 | 3.9.6 | 3.10.1 | 🟡 patch 落后 |

**上游 API 面**：Steam 多端点（storesearch/appdetails/appreviews/社区搜索/社区评论）、
SteamSpy、Steam250、Metacritic、ITAD、Epic/GOG/GamerPower、Bing。社区评论浏览页
是 approviews 端点 302 死亡后的 keyless 中文评论替代源；Metacritic 曾因
host_permissions 缺失被 CORS 静默全灭（已修复并留证）。建议继续在
`api-monitor` 熔断器与站点健康聚合里跟踪各源成功率。

**vendor**：`lib/vendor/qrcode-reader.js` 为压缩第三方库，lint 豁免；`lib/ndjson.js`
为自研 ND-JSON 编解码。Preact 经 `scripts/vendor-preact.mjs` 入口打包。

### 3.6 UI 与主题 ✅ 迁移进行中，边界清晰

**实证良好的面**：

- Preact 组件已落地 7 个：popup-status / cache-status / rules-status / dash-stats /
  freegames-status / welcome-status（+ content 侧 preact-mount 桥）；新 UI 面优先
  Preact 文本插值（天然转义）。
- 转义：动态内容一律 `escapeHtml/escapeAttr`；DOM sink 基线锁只减不增，生产
  `.innerHTML=` 赋值仅剩 `shared/preact-globals.js`（vendor 垫片）1 处。
- 主题/token 单源：`ui-tokens.js`（16 语义色 + 20 主题名）→ 构建生成
  `styles/tokens.css`；`themes-data.js`（19 主题变量）→ 生成主题 CSS；新色值不得
  在业务里写字面量。
- 徽章组标记契约：`gr-rating-badge` 组标记三重身份（防重复守卫/插入锚点/测试选择器），
  组外徽章传 `base:'gr-badge'`，防污染守卫。

**观察**：

- content/detail/render 与若干面板仍保留 HTML 模板助手（渐进迁移中，AGENTS 已登记
  "既有大数据行渐进迁移"）；`dangerouslySetInnerHTML` 现存于 status-bar / inline-card /
  sidebar / dash-radar / dash-stats / cache.js（5 处），入参均为内部 formatXxx 助手
  输出。建议把"入参必须来自可信助手"固化为静态守卫（P3-4）。
- 跳转链接前缀（Steam app 页等）在 10+ 文件重复字面量，未在 shared 层单源（P2-2）。

### 3.7 测试体系 ✅ 分层严密，覆盖率棘轮受控

**实证良好的面**：

- 两阶段运行：unit 先行 → sim/integration 全新进程（规避跨文件 fork 模块注册表
  残留竞态）；sim 套件 include 顺序固化（list 前置）。
- sim 换 happy-dom 真实 DOM；FakeEl 保留为兼容垫片；harness 镜像 `__GR_*` 全局、
  冻结 readyState、location 兼容层。
- 缺陷回放：`mutations.json` 历史缺陷放回必须红；语料分母门禁；夹具→套件映射门禁；
  覆盖率棘轮（全局含 UI 阈值 lines 47 / stmts 46 / funcs 43 / branches 42；
  unit-only 快照基线 39.86% 行）。
- E2E：Playwright runner 串行编排，节函数零重写复用；软断言继续跑完 + 终态红；
  trace 失败保留；视觉回归 pixelmatch 基线。
- 开销治理：gate 每步骤耗时落 `.gate-costs.jsonl`，滚动中位数对比告警；套件墙钟
  预算超 cap 判失败；基线可 `calibrate:budgets` 实测校准。
- 测试卫生：无 `.only`/`.fail` 残留；仅 1 处 `test.skip`（前序节断链语义，有意）。

**观察**：

- 已知噪声：变异 `network-rendered-as-notfound` 在 gate 上下文偶发撞 240s 上界
  被判"未拦截"，隔离运行恒 ~2.7s 红（AGENTS 已登记，疑似 spawnSync 管道楔死级联）。
- UI 层 DOM 代码单测覆盖天然偏低，阈值已按实测下调留 4pt 余量；随 Preact 迁移可
  逐步上调棘轮。
- 旧 `tests/e2e/` 目录的 helpers 与 section 函数仍被 e2e-pw 管线复用（非死代码），
  但其中 3 个导出已无消费方（P2-1）。

---

## 4. 问题清单（分级）

> 工作量估计：S ≈ 0.5 批次内；M ≈ 1 批次；L ≈ 跨批次专项。

### P1 — 应尽快处理

#### P1-1 依赖三个 major 版本落后，需专项升级评估
- **位置**：`package.json` / `package-lock.json`
- **现象**：eslint 9.39.5 → 10.15.0；vitest 4.1.10 → 5.1.1（含 coverage-v8）；
  pixelmatch 7.2.0 → 8.0.0。
- **影响**：major 跨版本通常含 breaking（vitest 5 配置/API 调整、eslint 10 规则与
  环境要求、pixelmatch 8 接口/默认值变化）；长期不升会拉大升级成本，且错过安全与
  性能修复。当前 `^` 范围不会自动跨 major。
- **建议**：
  1. 单独开升级批次，按 pixelmatch（视觉回归面最小）→ eslint（规则面）→ vitest
     （测试运行时面）顺序推进；
  2. 每步升级后跑 `gate:fast` + 视觉回归 + 受影响套件；
  3. 在 CHANGELOG 记录 breaking 适配点。
- **工作量**：L（三个 major 分开做，单次 M）。

#### P1-2 `SAVE_SETTINGS` 缺顶层键白名单裁剪（纵深防御）
- **位置**：`background/core/message-contract.js:233`；`background/handlers/settings.js:17`
- **现象**：契约仅校验 settings 为纯对象、weights 值为有限数值；未知顶层键可随
  `saveSettings` 入库。`deepMergeSettings` 做类型回退，但不剔除未登记键。
- **影响**：当前 web 源已被 sender 门禁挡在特权 action 外，实际风险低；但若未来新增
  一个可信扩展页写入路径或契约放宽，未登记键会静默落盘并占用设置缓存。属纵深防御
  缺口，非线上漏洞。
- **建议**：在契约或 `saveSettings` 入口按 `DEFAULT_SETTINGS` 顶层键做白名单裁剪
  （嵌套组按既有 deepMerge 语义保留）；补一条回归用例：传入伪造 `evilKey` 不落库。
- **工作量**：S–M。

#### P1-3 构建器内容模块清单与 module-manifest 双份手工同步
- **位置**：`scripts/build.mjs:38` `MANIFEST_MODULES`；`content/module-manifest.js`
- **现象**：两份清单当前一致，但新增内容模块需同时改两处；漏改构建器数组会导致
  bundle 装载桥与运行时装载集漂移。
- **影响**：违反单源优先铁律（铁律 13），是历史漂移风险点。
- **建议**：构建器在构建期 `import` manifest 的 CORE/OPTIONAL 数组派生装载桥清单，
  删除硬编码数组；`test-integrity` 或新增一条断言守"构建清单 ⊆ manifest"。
- **工作量**：S–M。

### P2 — 计划处理

#### P2-1 测试死代码与未用导出清理
- **位置**：
  - `tests/helpers/fake-dom.mjs`：已被 `page-dom.mjs` 替代，全仓无 import 引用（仅
    注释提及），可删除；
  - `tests/e2e/helpers.mjs`：`USER_DATA_DIR` / `FAST` / `createChecks` 三个导出无
    消费方；
  - `tests/sim/sim-harness.mjs:499`：`setSimStateSnapshot` 未用导出。
- **建议**：删除 `fake-dom.mjs`；清理死导出；knip 配置把 tests/e2e 复用关系补登后
  复跑确认。
- **工作量**：S。

#### P2-2 跳转链接前缀字面量散落，未在 shared 层单源
- **位置**：`content/detail/render/sidebar-html.js`、`content/detail/sidebar-rows.js`、
  `content/detail/candidates.js`、`content/detail/tracking.js`、
  `content/list/badges/badge-base.js`、`popup/popup-search.js`、
  `options/panels/cache.js`、`dashboard/dash-insights.js`、
  `background/service-worker.js:192` 等。
- **现象**：`https://store.steampowered.com/app/`、`/search/?term=` 等前缀在 10+ 文件
  重复；`ENDPOINTS.steamStoreApp` 在 background 已有，但 content/页面层不能 import
  background，故未复用。
- **建议**：在 `shared/` 增设链接前缀常量（content/页面/后台均可引用），各文件拼接
  处改为引用；后台 `ENDPOINTS` 再 re-export 该 shared 常量，消除第三份。
- **工作量**：M。

#### P2-3 PR Agent 工作流动作使用浮动 tag
- **位置**：`.github/workflows/pr-agent.yml:36`（`The-PR-Agent/pr-agent@v0.50.0`）
- **现象**：ci.yml / codeql.yml 的动作均已 pin 40 位 SHA，唯独 pr-agent 用浮动 tag；
  历史 Semgrep 报告已标记为供应链警告（CWE-1357 / CWE-353）。
- **建议**：pin 到对应 commit SHA（与其他 workflow 同口径）；定期随版本升级复核。
- **工作量**：S。

#### P2-4 `.trae/` 未纳入 .gitignore，工具目录忽略口径不一致
- **位置**：`.gitignore`
- **现象**：`.workbuddy/`、`.mimosa/`、`.zcode/`、`.extension-js`、`.qoder/` 已忽略，
  `.trae/` 未列（目录现存 6 个 spec 文件）。
- **建议**：补 `.trae/` 到忽略段；确认其中是否有需要入库的规格文档，若有则单独保留
  对应文件而非整目录提交。
- **工作量**：S。

#### P2-5 docs/reports 历史报告堆积，未完全归档
- **位置**：`docs/reports/` 顶层 31 份 md + 8 目录；`archive/` 仅收部分早期批次。
- **现象**：2026-09 至 2026-11 的多轮审查/扫描/调研报告平铺顶层，新报告检索成本高；
  部分 HTML 报告含历史快照，体积与解析噪声大。
- **建议**：按月份/批次把已闭环的历史报告移入 `archive/`；保留近两轮与现行安全
  扫描目录在顶层；在 `docs/INDEX.md` 补报告索引。
- **工作量**：S–M。

#### P2-6 `npm audit` 当前不可执行，依赖漏洞面未留证
- **位置**：本地 npmmirror 镜像（`/-/npm/v1/security/*` 返回 NOT_IMPLEMENTED/404）
- **现象**：`npm run audit` 无法产出高危漏洞清单；本次安全审计缺少依赖 CVE 维度证据。
- **建议**：临时切官方 registry 跑一次 `npm audit --audit-level=high` 留证入
  docs/reports；或在 CI 加一步官方源 audit；后续发布前重复。
- **工作量**：S。

### P3 — 观察项（随迭代渐进）

#### P3-1 大文件热点，长期按域拆分
- **位置（行数降序）**：`background/steam/ratings-batch.js` 947、
  `welcome/changelog.js` 884（数据集合，例外）、`orchestrator-list.js` 843、
  `handlers/steam.js` 685、`dashboard/dash-diagnostics.js` 658、
  `content/detail/candidates.js` 632、`orchestrator-detail.js` 630、
  `content/list/xdgrid-panel.js` 622、`storage/steam-cache.js` 600。
- **建议**：不强行拆；在触达这些文件时按"纯函数下沉 / 编排壳保留"的既有模式
  （参考 engine → engine-signals）渐进拆分；changelog 数据文件除外。
- **工作量**：持续。

#### P3-2 覆盖率棘轮随 Preact 迁移逐步上调
- **现状**：unit-only 行覆盖 39.86%；全局含 UI 阈值 47 行。UI DOM 代码覆盖偏低是
  主因。
- **建议**：每完成一批 Preact 组件迁移，跑 `coverage:snapshot` 复核并按需上调棘轮；
  避免为凑指标写无效断言。

#### P3-3 可信 HTML 边界补静态守卫
- **位置**：`dangerouslySetInnerHTML` 现存 10+ 处（见 §3.6）。
- **建议**：在 `check-dom-sinks` 或 ast-grep 规则里补一条：`dangerouslySetInnerHTML`
  的 `__html` 入参必须调用 `trustedHtml`/formatXxx 助手或来自常量 SVG；直接拼接
  外部字符串即红。把现有信任边界从"人工定性"升级为"机器守门"。

#### P3-4 已知测试噪声登记与根治跟踪
- **现象**：`network-rendered-as-notfound` 变异在 gate 上下文偶发超时楔死（隔离
  运行恒红）；sim 多文件连跑顺序敏感。
- **建议**：保留现有隔离复跑口径；若再次出现，优先排查 spawnSync 管道与孙进程
  持有句柄问题（AGENTS 已记录嫌疑方向），必要时把该变异改为独立 spawn 调用。

#### P3-5 油猴脚本版本口径与功能滞后说明
- **位置**：`userscript/game-radar.user.js` `@version 14.29.0`（移植基线，有意不随
  扩展 patch 递增）；扩展当前 14.42.16。
- **建议**：在 README/STORE 显式说明油猴版为核心移植基线、词表快照同源生成、功能
  滞后口径；定期核对移植覆盖面，避免用户误以为两版功能同步。

#### P3-6 上游源健康度主动监控
- **建议**：利用既有 `api-monitor` 熔断器与 `site-health` 聚合，在 dashboard 暴露
  各出站源近 7 天成功率/平均时延/熔断态；对连续失败源在设置页给出可见提示，把
  "机制存在 ≠ 功能生效"的首跑证据纪律延伸到运行期健康观测。

---

## 5. 后续迭代优化方案

### 5.1 短期（1–2 个批次，低风险闭环）

1. **P2-1 死代码清理**：删 `fake-dom.mjs`、清 4 个未用导出，复跑 knip 与 gate:fast。
2. **P2-3 工作流 pin SHA**、**P2-4 补 .trae 忽略**、**P2-6 补一次官方源 audit 留证**。
3. **P1-2 设置键白名单裁剪** + 回归用例。
4. **P1-3 构建清单从 manifest 派生** + 一致性断言。
5. 归档 P2-5 历史报告，补 docs 索引。

### 5.2 中期（一个发布周期内）

1. **P1-1 依赖专项升级**：pixelmatch 8 → eslint 10 → vitest 5 分批推进，每步门禁
   全绿；记录 breaking 适配点到 CHANGELOG。
2. **P2-2 shared 链接前缀单源**，消除 10+ 处重复字面量。
3. **P3-3 可信 HTML 静态守卫**落地，dangerouslySetInnerHTML 入参机器守门。
4. 抽样补 UI 层 Preact 组件迁移（优先 options 大数据行与 content/detail/render 残留
   模板），迁移一批上调一次覆盖棘轮。

### 5.3 长期（架构演进方向，需先与用户确认再立项）

1. **编排层拆分**：ratings-batch / orchestrator-list / orchestrator-detail 三大
   编排器按"缓存决策 / 并发调度 / 信号装配 / 推送收尾"分域，纯函数下沉可测层。
2. **类型体系加深**：当前 JSDoc 渐进类型 + 三 tsconfig 分离；可评估把 core/types.js
   的契约类型向 `.d.ts` 收敛，减少 content/页面层的 `any` 回退。
3. **上游源抽象**：把 Steam/SteamSpy/Metacritic/ITAD 等数据源抽象为统一适配器
   接口（抓取/归一化/健康度），新增源只加适配器；与现有 adapter 规则体系对齐。
4. **运行期健康看板**：落地 P3-6 上游源成功率/时延/熔断可见性，配合诊断轨迹形成
   "异常可发现、定位有轨迹、自愈有边界"的闭环。

### 5.4 优先级排序（建议执行顺序）

```
P2-1 死代码 ─┐
P2-3 pin SHA ─┼─► 第一批（S 工作量，纯卫生）
P2-4 忽略缺口┘
P1-2 设置白名单 ──► 第一批尾（带回归用例）
P1-3 清单派生 ──► 第二批（带一致性断言）
P2-2 链接单源 ──► 第二批
P1-1 依赖升级 ──► 第三批起，按 pixelmatch→eslint→vitest 分批
P3-3 HTML 守卫 ──► 中期，随 Preact 迁移配套
P3-1 大文件拆分 / 长期架构演进 ──► 触达即拆，不单独立项
```

---

## 6. 附录

### 6.1 审计限制与未覆盖项

- **git 历史不可用**：当前环境未安装 git，未能审查提交历史、分支策略与变更节奏；
  版本流水以 CHANGELOG.md 为准。
- **npm audit 受限**：镜像安全端点未实现，依赖 CVE 清单待切官方源补跑（P2-6）。
- **未跑全量门禁**：本次实证 lint/typecheck/6 快静态门禁 + 4 个核心套件 129 用例；
  全量 vitest、E2E(MOCK)、视觉回归、打包冒烟以最近一次 fast 门禁记录（165.6s 全绿）
  为参考，未重复执行。
- **真机/外网链路未探测**：出站 API 实际可达性与响应结构以首跑证据与历史监控为准，
  本次未发真实网络请求。
- **历史报告**：项目 docs/reports 留有 v14.3.0 起多轮审查、安全扫描与专项审计；
  本报告结论与既有报告互补，不重复归档其已定性条目。

### 6.2 关键证据路径索引

| 主题 | 路径 |
|---|---|
| 设置默认值/数值钳制 | `background/core/constants.js:204`、`background/core/settings.js:76` |
| 消息契约/sender 门禁 | `background/core/message-contract.js`、`background/handlers.js:62` |
| 出站安全封装 | `background/core/utils.js:102,178` |
| LLM 端点分级 | `background/core/llm-client.js:26,50` |
| 存储注册表单源 | `data/storage-registry.js` |
| 内容模块清单 | `content/module-manifest.js` |
| 构建双策略 | `scripts/build.mjs` |
| 门禁编排 | `scripts/gate.mjs` |
| 外部引用/首跑证据 | `scripts/external-refs.json`、`scripts/first-run.json` |
| 覆盖率基线 | `scripts/coverage-baseline.json`、`vitest.config.js:139` |
| 历史安全扫描 | `docs/reports/security-scan-v14.39.0/` |
