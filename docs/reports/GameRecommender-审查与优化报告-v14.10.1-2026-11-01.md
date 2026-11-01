# Game Radar（game-recommender）· 审查与优化报告 v14.10.1

> 审查对象：`F:\data\browser extension\game-recommender` @ `954bee4`（manifest/package **14.10.1**）
> 审查日期：2026-11-01 · 审查方式：**运行验证优先**（实际执行 lint / typecheck / 1041 用例 / 覆盖率 / 门禁 / E2E 两轮）+ 两路并行静态专项
> 配套精排版：同目录 `GameRecommender-审查与优化报告-v14.10.1-2026-11-01.html`
> 工具与模型标注：见 **第七节**（含逐项命令清单）

---

## 一、执行摘要

**总体判断：工程质量中上，但"门禁健康度"存在一处 P0 级破口——E2E 冒烟已确定性红 7 项，且连续 3 个版本无人发现。**

上一轮（v14.9.1，2026-11-01）外部审查是**纯静态**的：其环境 exec 被拒，无法运行任何门禁，全部结论为代码阅读推断。本轮的差异化价值在于**把门禁真正跑了一遍**，因此发现了静态审查不可能发现的问题：项目自称「E2E MOCK 全绿收口」（commit `acf0aaa`），但当前 HEAD 上 E2E **39 通过 / 7 失败**，两次独立重跑失败项完全一致（非环境抖动）。

### 门禁实测结果（本轮核心数据）

| 门禁步骤 | 命令 | 实测结果 |
|---|---|---|
| lint | `npx eslint . --max-warnings 0` | ✅ **0 错误 0 警告** |
| typecheck ×3 | `npx tsc --noEmit`（main/ui/content） | ✅ **全绿** |
| 单测 | `vitest run tests/unit` | ✅ **50 套件 / 892 用例** |
| sim + integration | `vitest run tests/sim tests/integration` | ✅ **8 套件 / 149 用例** |
| 棘轮 | `node scripts/lint-ratchet.mjs` | ✅ 通过（510/248/272，持平基线） |
| 覆盖率门禁 | `node scripts/coverage-gate.mjs` | ⚠️ 通过但**空转**（无新增文件） |
| 全局覆盖率 | `npx vitest run --coverage` | ❌ **失败**（sim-list 节 2/2b 超时） |
| **E2E 冒烟** | `E2E_MOCK=1 node tests/e2e-smoke.mjs` | ❌ **39 通过 / 7 失败（确定性）** |

**结论：`npm run gate` 在 E2E 步骤必然红。** 而最近一次全量 gate 记录停留在 `gate-v14.8.0-2.log`（10-31 14:59），之后 6 个 commit（v14.9.0 → v14.10.1）**无 gate 执行记录**。

### 分级汇总

| 级别 | 数量 | 代表问题 |
|---|---|---|
| **P0** | 1 | E2E 确定性红 7 项，三版本未跑门禁 |
| **P1** | 5 | 覆盖率阈值形同虚设 / ITAD 密钥未剔除 / searchUrl 伪协议 / HTML 重复 id（2 处） |
| **P2** | 9 | 单源绕过（ENDPOINTS·TTL·PERF_CONFIG）/ LRU 三份拷贝 / recCache 无 TTL |
| **P3** | 6 | 长函数 / 多余导出 / 无界 Map |
| 信息 | 3 | WAR 范围偏宽 / 日志携带 URL / 属性转义不完整 |

---

## 二、P0 · 门禁破口（最优先）

### P0-01　E2E MOCK 确定性红 7 项，连续 3 个版本未跑门禁

**实测过程**（两次独立运行，间隔约 10 分钟，期间无代码改动）：

```
第 1 次（有 coverage 后台负载）：39 通过, 7 失败
第 2 次（隔离、无其他负载）  ：39 通过, 7 失败   ← 失败项逐项一致
```

按项目自身纪律（`AGENTS.md`「gate 假红先隔离复跑再定性」），两次一致即定性为**真红，非抖动**。

**失败项清单**：

| # | 节 | 失败项 |
|---|---|---|
| 1 | 1 | 欢迎页更新模式（What's new 渲染 + 安装区隐藏） |
| 2 | 2d | 限免游戏卡片渲染（MOCK 回放限免源） |
| 3 | 4 | 浮窗报错按钮存在 |
| 4 | 4 | 浮窗显示主内容区游戏 —— `查询失败: 操作超时（SEARCH_STEAM ms）` |
| 5 | 4 | 报错重检索流程完成 |
| 6 | 5a | 节 scroll（超时防护）—— `超时(120000ms)` |
| 7 | 5a | 滚动触发第二批徽章（按需扫描）—— `0 → 0` |

**根因证据链**：`git diff --stat acf0aaa HEAD`（E2E 收口点 → 当前 HEAD）显示新增了多个**新的出站请求路径**，而 MOCK fixture 未同步：

```
background/steam/api-metacritic.js      |  75 +++   ← v14.10.0 新增 Metacritic 评分源
shared/platform-detect.js               | 132 +++   ← v14.10.0 新增非 PC 平台识别
background/steam/api-search.js          | 107 +-
background/steam/orchestrator-list.js   | 117 +-
background/steam/api-reviews.js         | 111 +-
welcome/changelog.js                    |  31 +     ← "What's new" 渲染变更
content/list/badges/working.js          |  33 +
```

E2E 日志中的 fixture 未命中直接印证（`l=english` 为新增的英文版请求）：

```
⚠️ fixture 未命中: https://store.steampowered.com/api/appdetails?appids=1746540&l=schinese
⚠️ fixture 未命中: https://store.steampowered.com/api/appdetails?appids=1746540&l=english
⚠️ fixture 未命中: https://raw.githubusercontent.com/jsnli/steamappidlist/main/data/games_appid.json
```

**为什么没被发现**：`gate` 是人工触发的。时间线：

| 时间 | 事件 |
|---|---|
| 10-31 14:59 | `gate-v14.8.0-2.log` —— 最后一次全量门禁记录 |
| 10-31 ~ | `acf0aaa` E2E MOCK 全绿收口 |
| 10-31 ~ 11-01 | 6 个 commit（v14.9.0 / v14.10.0 / v14.10.1）**无 gate 记录** |

**修复方案**（约 2–3h）：
1. 补齐 MOCK fixture：为 Metacritic、`l=english` appdetails、steamappidlist 三个新端点录制回放（沿用 `acf0aaa` 的 58 个 fixture 补齐手法）
2. 校验 `welcome/changelog.js` 新增条目对「What's new」渲染断言的影响（节 1）
3. 修复后**连跑 3 次 E2E** 确认稳定
4. 补一个 `test-integrity` 断言：新増 `ENDPOINTS` 条目必须有对应 fixture（防复发）

---

## 三、P1 · 应尽快修复

### P1-01　全局覆盖率阈值从未在 gate 中生效（装饰性门禁）

`vitest.config.js:136` 定义了全局硬下限：

```js
thresholds: { lines: 47, statements: 46, functions: 43, branches: 42 }
```

但它**只在 `npm run coverage`（即 `vitest run --coverage`）时生效**，而 `scripts/gate.mjs` 的覆盖率步骤调用的是 `npm run coverage:gate`，该脚本 `scripts/coverage-gate.mjs:103-104` **显式关闭了全局阈值**：

```js
const noThresh =
  '--coverage.thresholds.lines=0 --coverage.thresholds.statements=0 --coverage.thresholds.functions=0 --coverage.thresholds.branches=0';
```

它只检查「相对 `origin/main` 的新增文件」（`--diff-filter=A`）。本轮实测输出：

```
✅ 无新增业务文件，覆盖率门禁通过
```

**后果**：本地 commit 且**已 push 到 main** 后，`merge-base HEAD origin/main` 到 HEAD 之间新增文件为空 → 门禁恒绿。即：**对存量文件的改动完全无覆盖率约束**（改 500 行不加测试，门禁绿）。

**修复**（约 20min）：在 `gate.mjs` 的 `coverage:gate` 之后补一步「全局覆盖率快照」——跑 `vitest run tests/unit --coverage`（排除 sim）并断言不低于阈值，或以棘轮方式记录 `coverage-summary.json` 的 total 行覆盖，只降不升。

### P1-02　`npm run coverage` 跑不通 → 全局阈值唯一执行路径不可达

实测 `npx vitest run --coverage` 退出码 **1**，失败点：

```
FAIL tests/sim/sim-list.mjs > 2. 列表页两波好评率流程
  Error: waitForSignal 超时(20000ms): 节2: 游戏B 好评率徽章（STEAM_RATINGS_UPDATE 推送后）
FAIL tests/sim/sim-list.mjs > 2b. 批次调度（首屏 60 + 滚动衔接）
  Error: waitForSignal 超时(20000ms)
```

**定向诊断**（本轮关键区分）：

```
npx vitest run tests/sim/sim-list.mjs   →  9 passed, 耗时 1.81s    ✅
```

单独跑 1.81s 全绿，说明**不是功能 bug，是覆盖率插桩后 20s 信号预算不足**（`sim-harness.mjs:420` `GR_SIM_SIGNAL_TIMEOUT_MS` 默认 20000）。

**修复**（约 15min，二选一）：
- 覆盖率运行路径单独提额：`--coverage` 时 `GR_SIM_SIGNAL_TIMEOUT_MS=60000`
- 或覆盖率采集排除 `tests/sim`（DOM 模拟套件对插桩后的覆盖率贡献低，却承担全部超时风险）

> 注：项目记忆中记录此 flake「v14 B6 已信号化改造、连跑 5 次零 retry」。本轮证明修复不彻底——它在常规路径下被压住，在覆盖率路径下仍复发。

### P1-03　导出/备份未剔除 ITAD API Key（**高危·虚假安全声明**）

> 上一轮（v14.9.1）已报，**本轮复核确认仍未修**。

导出侧 `background/handlers/data-modules.js:68-73`、备份侧 `background/storage/backups.js:53-59` 均只剔除 2 个字段：

```js
if (s.llmConfig) s.llmConfig = { ...s.llmConfig, apiKey: '' };
if (s.steamApiKey) s.steamApiKey = '';
```

而 `background/core/constants.js:160,163` 存在 ITAD 密钥字段：

```js
itadApiKey: '',            // 旧单键
itadProfiles: [],          // 多套配置 [{id, name, key, ...}]  ← key 即 API Key
```

**三处明文承诺与实际行为矛盾**：
- `options/options.html:1062` → `🔒 密钥仅存储于本机；导出 / 备份 / 导入均会自动剔除`
- `options/options.html:1132` → 同上（ITAD 区块）
- `background/handlers/data-modules.js:78` → `Logger.info('导出数据模块: ...（API 密钥已剔除）')`

**佐证是遗漏而非有意**：导入侧已剔除 `itadProfiles`（`core/rules.js:385-389`），但 `itadApiKey` 因类型判等通过仍可写入。

**修复**（约 30min）：抽 `stripSecrets(settings)` 供两处共用；置空 `llmConfig.apiKey` / `steamApiKey` / `itadApiKey`，并将 `itadProfiles` 映射为 `key:''`（保留 name/id）。修正或兑现文案。

### P1-04　规则包 `searchUrl` 无协议校验 → `javascript:` 注入

> 上一轮已报，**本轮复核确认仍未修**。

- `background/core/rules.js:67` 仅声明 `searchUrl: 'string'`；`:197-201` 只校验类型与长度，**无协议白名单**（对比同文件 `:402` 对 LLM endpoint 已有 `/^https?:\/\//i` 校验）
- 渲染侧 `content/detail/tracking.js:138` → `<a href="${common.escapeAttr(site.searchUrl)}">`，而 `shared/escape.js:23-29` 的 `escapeAttr` 只替换 `& " < >`，**不拦伪协议**
- `rules.js:44` 的 `{q}` 替换对不含 `{q}` 的字符串是 no-op → `javascript:alert(...)` 原样落地

**修复**（约 45min）：保存/导入侧加 `/^https?:\/\//i`（对齐 `rules.js:402`）；渲染侧加 `URL` 解析 + protocol 白名单兜底（存量已入库规则不受保存侧保护）。

### P1-05　`options.html` 重复 id × 2 → 两个死控件

本轮全仓 HTML 扫描（`id="..."` 去重）结果：

```
[./options/options.html]
id="ruleList"          ← 740 与 1246 各一处
id="settingsSearch"    ← 25 与 59 各一处
```

| id | 位置 | 消费方 | 后果 |
|---|---|---|---|
| `ruleList` | 740（过滤面板）/ 1246（规则管理） | `panels/rules.js:63`、`panels/search.js:35` | `getElementById` 恒返回第一个 → **规则管理面板恒空** |
| `settingsSearch` | 25 / 59 | — | **面板头搜索框死控件** |

**为什么 1041 个测试 + lint + typecheck 全绿却漏掉**：项目对 JS 侧建了极密的门禁（契约、单源、棘轮），但 **2941 行 HTML 层零自动化校验**——没有任何测试或脚本检查 id 唯一性。

**修复**（约 30min）：过滤面板改 `keywordRuleList` 并同步 JS；`settingsSearch` 去重或双绑；**并新增一条 `test-integrity` 断言**：扫描所有扩展页 HTML，重复 id 数 > 0 即失败（约 25 行代码，一劳永逸）。

---

## 四、P2 · 单源纪律与结构

| ID | 位置 | 问题 | 修复 |
|---|---|---|---|
| P2-01 | `constants.js:115` `ENDPOINTS.steamStoreApp` | 全库仅 **2** 处引用，而 `store.steampowered.com/app/` 字面量 **16** 处（`service-worker.js:151`、`api-assemble.js:51`、`api-details.js:116`、`api-reviews.js:216`、`api-search.js:139`、`badge-base.js:37` 等）→ 端点表形同虚设 | background 侧 5 处改 `ENDPOINTS`；content 侧按铁律 13 提具名常量 |
| P2-02 | `constants.js:296` vs `:316` | 同一文件内 TTL 双份：`DEFAULT_SETTINGS.cacheTtls` 与 `let TTL_CONFIG = {...}` 字面量初始化，未派生 → 新增一类 TTL 必须改两处 | `let TTL_CONFIG = structuredClone(DEFAULT_SETTINGS.cacheTtls)`（1 行） |
| P2-03 | `recommend/engine.js:131` | `const LLM_FETCH_TIMEOUT = 30000` 死值，绕过 `PERF_CONFIG.fetchTimeoutLlmMs`（`constants.js:82`）；同项目 `steam/ai-fallback.js:27` 用的是正确单源 → 改 `PERF_CONFIG` 只对一半生效 | 改引用 `PERF_CONFIG`（1 行 + import） |
| P2-04 | `storage/llm-cache.js:58-64`、`:121-127`、`storage/search-cache.js:64-70` | **LRU 裁剪块 3 份拷贝**（首行完全相同）。且手写版是 O(n log n) 全量排序，`createTtlCache` 是 O(1) 队首删 | 至少抽 `evictOldestByTs(map, max)` 单源；理想是 `mechanisms.js` 增 `createPersistentTtlCache({ttlMs, max, load, persist})` |
| P2-05 | `handlers/cache-manager.js:44`、`:192` | `recCache = new Map()` **无 TTL**，失效仅依赖 key 内含 `getDataVersion()`；容量 `2000` 硬编码未入 `STORAGE_CAPS`；超限 `clear()` 粗暴全清 | 改 `createTtlCache` + `STORAGE_CAPS.recCache` |
| P2-06 | `content/list/xdgrid-layout.js:158` | `host.includes('xdgame.com')` 兜底与 `xdgrid.js:29` **重复**。前者 AGENTS.md 明确「有意保留」，后者是第二次粘贴 | 两处合一 |
| P2-07 | `storage/reset.js:33-51`、`storage/flush.js:26-36` | 两张手工维护的函数清单（17 个 reset / 9 个 flush），与 `STORAGE_MODULES` 描述同一事实集。MV3 禁动态 import 导致技术上难完全派生 | 低成本方案：`test-integrity` 断言每个 `STORAGE_MODULES` 条目在两表有对应调用名 |
| P2-08 | `recommend/engine.js:131-160` vs `steam/ai-fallback.js:176-205` | LLM 出站调用块（Ollama/OpenAI 双分支）同构 | 抽 `shared/llm-client.js` 的 `callLlm(cfg, prompt, {jsonMode})` |
| P2-09 | 内容/页面层手写防抖 ×6（`list-page.js:145`、`list-batch.js:46/292`、`candidates.js:223`、`sidebar.js:129`、`options.js:199`、`panels/cache.js:17`） | 因「内容侧不可 import background」而合规，但 6 份拷贝 | 在 `shared/` 增 `debounce.js`（同签名），不破分层且消灭拷贝 |

---

## 五、P3 · 择机优化

| ID | 位置 | 问题 |
|---|---|---|
| P3-01 | `content/list/xdgrid-panel.js:24` `buildUI()` **391 行** | UI 构建 + 事件绑定 + 预设管理混杂 → 拆 `buildPanel/buildFilterRow/bindEvents` |
| P3-02 | `steam/orchestrator-list.js:120` `getSteamPositiveRate()` **334 行** | 已含 5 条路径（平台预检/名称索引/缓存/搜索/Metacritic），按 Phase 拆独立 async 步骤 |
| P3-03 | `steam/orchestrator-detail.js:53` `searchSteamGame()` **272 行**；`content/detail/sidebar.js:81` **263 行**；`content/list/badges/core.js:32` `prependBadge()` **248 行** | 均有天然阶段边界，按边界拆 |
| P3-04 | `content/list/list-page.js:27` | `retryThrottle = new Map()` 只 set 无 delete/cap → 慢泄漏。对照 `api-registry-heal.js:11`（有 `HEAL_BACKOFF_MAX=500`）说明项目已有纪律，仅此一处遗漏 |
| P3-05 | `constants.js:371,378`、`orchestrator-shared.js:32`、`xdgrid-layout.js:17/25/31`、`filter-presets.js:13`、`fm-keys.js:15` | 多余导出（仅本文件内消费），缩小公共面 |
| P3-06 | 类型债棘轮 510/248/272 | 自 2026-10-05 起**完全持平**（近 1 个月、5 个版本）。棘轮只防升不促降 → 债务固化。建议每个迭代轮次强制下调 N 处 |

---

## 六、通过项（正面确认，可直接用于 Chrome 商店审核材料）

本轮**实测**确认：

1. **lint 零容忍达成**：`eslint . --max-warnings 0` → 0 错误 0 警告（162 生产文件）
2. **三套 typecheck 全绿**：main / ui / content 三个 tsconfig 均无错
3. **1041 用例全绿**：unit 892 + sim·integration 149，单次全量无 flake
4. **零死函数**：596 个函数声明中，全库仅出现 1 次（定义从未调用）的为 **0** —— 28785 行规模项目中罕见
5. **分层矩阵严格成立**：`content/` 与 `shared/` 对 `background/` 引用 **0 处**；`background/` 动态 `import()` **0 处**（12 处命中全为 JSDoc 类型导入）；`shared/` 10 个文件出向 import 数 = 0（真叶子层）；`adapters/` 6 个站点文件出向 import 数 = 0（纯数据）
6. **硬编码延时 0 处**：`setTimeout/setInterval` ≥1000ms 与 `fetchWithTimeout` 字面超时扫描全仓 **0 命中** —— 铁律 13 的单源纪律真实生效
7. **技术债标记极少**：TODO/FIXME/HACK 全仓仅 **4 处**
8. **消息面 fail-closed**：`message-contract.js:363-368` 未登记 action 默认拒绝；`handlers.js:70-73` 非扩展页 sender 限白名单；`onMessage` 全局仅一处（`early-message-router.js:55`），无旁路
9. **无远程代码**：CSP `script-src 'self'; object-src 'self'`；全仓无 `eval` / `new Function`；所有扩展页脚本均为本地相对路径
10. **SSRF 防护完整**：`utils.js:96-117` 拦私有/环回/IPv6 + `:191-202` 逐跳 `redirect:'manual'` 重校验（≤5 跳）+ 每主机限速
11. **权限最小化**：6 项权限逐一有实际使用点，`host_permissions` 全部对应真实请求域，无冗余
12. **XSS 面干净**：32 文件 121 处 innerHTML sink 逐一核验，**无未转义拼接真阳性**
13. **互斥锁完全单源**：`withLock()` 5 个消费者，业务侧无手写锁（唯一例外 `data-store.js:55` 因分层限制，已论证可接受）

---

## 七、工具与模型标注

### 运行环境

| 项 | 值 |
|---|---|
| 宿主 | WorkBuddy（CodeBuddy IDE）· Agent 模式 |
| 操作系统 | Windows win32 · 终端 Git Bash (POSIX sh) |
| 工作区 | `F:\data\browser extension\game-recommender` |
| 运行时 | Node.js ≥18（package.json engines）· npm |
| 审查基线 | `954bee4` · manifest/package 版本 `14.10.1` · 上次 tag `v14.8.0-6-g954bee4` |

### 模型

| 环节 | 模型 |
|---|---|
| 主会话（编排、综合、报告撰写） | **Hy4 preview** |
| 专项子代理 A（安全审查） | Explore 子代理，继承主会话模型（Hy4 preview） |
| 专项子代理 B（架构与重复实现） | Explore 子代理，继承主会话模型（Hy4 preview） |

### 工具与逐项命令清单

本轮**实际执行**的命令（非静态推断）：

| 目的 | 工具 | 命令 |
|---|---|---|
| 规模统计 | Bash (find/wc) | 生产 162 文件 / 28785 行；测试 75 文件 / 14653 行；HTML 2941 行 |
| git 基线 | Bash (git) | `git log --oneline -15` / `git status` / `git describe --tags` / `git diff --stat acf0aaa HEAD` |
| 代码检查 | Bash | `npx eslint . --no-warn-ignored --max-warnings 0` |
| 类型检查 ×3 | Bash | `npx tsc --noEmit -p tsconfig.{json,ui.json,content.json}` |
| 单测 | Bash | `npx vitest run tests/unit`（50 套件/892） |
| 集成与模拟 | Bash | `npx vitest run tests/sim tests/integration`（8 套件/149） |
| 全局覆盖率 | Bash | `npx vitest run --coverage` |
| 定向 flake 诊断 | Bash | `npx vitest run tests/sim/sim-list.mjs` |
| 棘轮门禁 | Bash | `node scripts/lint-ratchet.mjs` |
| 覆盖率门禁 | Bash | `node scripts/coverage-gate.mjs` |
| **E2E 冒烟 ×2** | Bash | `E2E_MOCK=1 node tests/e2e-smoke.mjs`（两轮隔离复跑定性） |
| 静态扫描 | Grep / Glob / Read | 重复 id、硬编码延时、console 分布、长文件、TODO、ENDPOINTS 引用计数 |

辅助工具：`TaskCreate/TaskUpdate`（任务跟踪）、`Agent`（2 路并行只读专项）、`Read`（源码行号级复核）、`Write`（报告产出）。

### 方法说明与局限

- **方法**：运行验证优先——先跑完 8 项门禁取得客观数据，再由两路子代理做行号级静态专项，**所有静态结论均要求文件:行号证据**，最后主会话复核关键项（如 P1-05 亲自复扫全部 HTML）。
- **与上一轮的互补**：上一轮（v14.9.1）环境 exec 被拒，为纯静态推断，其两个 P1（ITAD 密钥、searchUrl）本轮复核确认成立；本轮新增 P0（E2E 确定性红）是运行才能发现的问题。
- **局限**：
  - `visual`（视觉回归）与 `perf-bench` 本轮未单独执行（gate 的后置步骤，不影响前 4 步结论）
  - E2E 根因定位到「新端点 fixture 未覆盖」这一层，**具体到每个 fixture 应录制什么内容**需在修复时按录制回放机制补齐
  - 子代理的架构扫描为词频 + 结构相似度判断，死代码结论已排除「字符串键分发」假阳性 39 个
- **未做的事**：本轮为**只读审查**，未修改任何生产代码、未提交、未发布。

---

## 八、优化路线图（每阶段独立 commit，验收不过即 revert）

| 阶段 | 内容 | 工作量 | 验收标准 |
|---|---|---|---|
| **S1 门禁止血** | P0-01（补 fixture + 连跑 3 次）+ P1-01（gate 补全局覆盖快照）+ P1-02（覆盖率路径提额） | 0.5–1 天 | `npm run gate` 全绿；`vitest run --coverage` 退出码 0 |
| **S2 安全收口** | P1-03（stripSecrets）+ P1-04（协议白名单）+ 低危 S-01/S-02/S-03 | 2h | 导出 JSON 检索不到任何密钥；`javascript:` searchUrl 被拒 |
| **S3 功能修复** | P1-05（HTML 重复 id 去重 + **新增 id 唯一性门禁断言**） | 1h | 规则管理面板出现列表；`test-integrity` 拦截新增重复 id |
| **S4 单源加固** | P2-01/02/03/05（1 行级修复）+ P2-04（LRU 单源）+ P2-07（断言派生） | 0.5–1 天 | 新增 TTL 只改 1 处；`ENDPOINTS` 引用数 ≥ 字面量数 |
| **S5 结构优化** | P2-06/08/09 + P3-01…03（长函数拆分） | 1 天 | 无函数超 200 行；无第三份 LLM 调用块 |
| **S6 债务清减** | P3-04/05 + P3-06（类型债每轮强制下调） | 持续 | 每个迭代轮类型债环比下降 |

**建议立即执行**：S1（门禁止血）——因为当前 HEAD 的 `npm run gate` 必然失败，任何新批次都建立在未知的红门禁之上。

---

*报告结束 · 生成于 2026-11-01 · 工具：WorkBuddy Agent 模式 · 模型：Hy4 preview*
