# 游戏雷达 Game Radar — 独立技术审计报告

- 审计对象：`F:\data\browser extension\game-recommender`（Chrome MV3 扩展）
- 版本：v10.4.3 ｜ 零构建，原生 JS + JSDoc 类型
- 审计日期：2026-09-03 ｜ 方式：全量只读源码复核（不采信注释/文档自述）
- 规模：源码 ~27,700 行（268 个受版本管理文件），测试 ~7,350 行（22 个 vitest 套件），80+ Steam HTTP 录制夹具

---

## 一、总体结论

这是一个**工程成熟度显著高于同类个人扩展**的项目：完整的分层架构、类型化、多维门禁（lint + typecheck + vitest + 覆盖率 + 性能预算 + E2E + 视觉回归 + npm audit + gitleaks）、双语注释、规范的中文 Conventional 提交与大版本节奏。核心引擎（好评率缓存、可续跑批量、SSRF 出站防护、设置深合并防御）设计扎实。

主要风险集中在三处：**（1）消息分发不做 sender 来源校验**，叠加内容脚本个别未转义落点，构成潜在提权链；**（2）持久化写路径（OPFS）在生产环境未被测试覆盖**，且缺少生命周期兜底 flush；**（3）隐私声明与默认行为存在偏差**（查询默认外发）与**过宽的可选 `*/*` 权限**。此外，**真实覆盖率被高估**（仅统计被加载模块）。

综合评级：**架构 A− / 工程质量 B+ / 安全 B− / 测试可信度 C+**。可发布，但下列 P0 项建议在下个版本前处理。

| 维度 | 评价 |
|---|---|
| 架构与可维护性 | 分层清晰、单向依赖在实践成立，但靠约定而非工具强制；模块注册需 4 处同步是主要演进税 |
| 功能与产品化 | 徽章/推荐/限免/多主题/备份/站点适配器体系完整，用户导入规则零重构成本 |
| 安全性 | CSP 严格、无 eval、SSRF 防护强；短板是消息来源校验与个别转义缺口 |
| 隐私合规 | 本地存储为主，无自有服务器/广告/埋点（属实）；但默认外发查询与 `*/*` 可选权限需修正 |
| 测试与 CI | 门禁齐全且真跑浏览器 E2E；但生产写路径（OPFS）未被测、覆盖率数字有水分 |
| 性能 | 有性能预算门禁；内容脚本存在观察器回环、后置裁剪、主线程 HTML 解析等隐患 |

---

## 二、值得肯定的设计（保留，勿在演进中破坏）

- **SSRF 出站防护扎实**（`background/core/utils.js:95-177`）：http(s) 白名单、IPv4 + 完整 IPv6（ULA/链路本地/6to4/Teredo/CGNAT/v4-mapped）、去尾点、`redirect:'manual'` 逐跳重校验、每主机限速 + 出站审计。
- **MV3 CSP 严格**（`manifest.json:43-45`）`script-src 'self'; object-src 'self'`，全仓 **无 eval / new Function / @ts-ignore / eslint-disable / as any / TODO**。
- **批量续跑设计**：以 alarm + `storage.session` 检查点实现断点续跑（`background/steam/ratings-batch.js`），正确应对 SW 被回收。
- **设置防御**：`DEFAULT_SETTINGS` 深合并（`background/core/settings.js:24-45`）+ `test-settings-sync` 强制设置三层同步，防"全量保存抹掉用户自定义"历史事故复发。
- **可集成测试是真集成**：`tests/integration/test-handlers.mjs` 直接 import 真实 `handlers.js`/storage 模块端到端驱动 `handleMessage`；`test-content-sim.mjs`（1,242 行）按 manifest 顺序加载真实内容脚本跑假 DOM。
- **发布隔离干净**：`scripts/package.mjs` 走显式白名单拷贝，`node_modules/tests/scripts` 不可能泄入 zip。

---

## 三、问题清单（按严重度排序，含证据 path:line 与修复方向）

### 🔴 P0-A｜消息分发无 sender 来源校验（提权主因）
`background/handlers.js:330-336` 与 `background/service-worker.js:44-45` 仅按 `action` 查表分发，**从不校验 `sender`**。对派发器而言"扩展页面"与"内容脚本"不可区分。一旦任一内容脚本被注入执行（见 P0-B），攻击者即可调用 `chrome.runtime.sendMessage` 触发特权动作（`SAVE_ADAPTER_RULES` / `CLEAR_DATA` / `RESET_SETTINGS` / `IMPORT_DATA`）。
**修复**：在 `handleMessage` 入口对特权 action 建立白名单门——要求 `sender.tab === undefined` 或 `sender.url` 属于 `chrome-extension://<self-id>/…`；内容脚本来源仅允许 `TRACK_EVENT`/取数类只读动作。

### 🔴 P0-B｜内容脚本个别 HTML 落点未转义（纵深防御缺口）
`content/detail/detail-templates.js:141-163` 的 `row()` 把 `desc` 直接拼进 `innerHTML`（经 `detail-page.js:616` 落地），`desc` 源为 Steam `reviewSummary.desc`（`api-assemble.js:56`）；`detail-page.js:540/548` 将 `data-appid`、`¥${c.price}` 未转义写入属性/文本。
**客观定级**：Steam 的 `desc` 实为固定枚举串、经 HTTPS，**非直接可被第三方任意控制**，故严重度低于典型存储型 XSS；但它是**全仓唯一偏离 `escapeHtml` 纪律之处**，一旦上游源改为下载站/用户导入规则即成实弹，应视作提权链的前置。
**修复**：`detail-templates.js:73-75,141-163` 与 `detail-page.js:540,548` 统一 `esc()/escapeAttr`。

### 🔴 P0-C｜`*/*` 可选权限 + 规则域名未校验 → 全站注入
`manifest.json:42` 设 `optional_host_permissions: http://*/*, https://*/*`；`options/options.js:617-618` 用用户原样输入拼 `chrome.permissions.request({origins:['http://'+site+'/*',…]})`，因可选集为 `*/*` 等价于无界授予。`background/core/site-scripts.js:61-76` 据规则 `domains` 生成 `*://<d>/*` 并 `chrome.scripting.registerContentScripts`，而 `background/core/rules.js:141-145` 仅校验"字符串且 ≤500"，**不校验主机名合法性**。含 `domains:["*"]` 的导入规则一旦获得宽权限即全站注入。
**修复**：`validateSiteRule` 对每个 domain 正则 `^[a-z0-9.-]+$` 且拒绝 `*`/IP/空；可选权限收窄为按需逐域授予，移除 `*/*`。

### 🟠 P1-A｜生产写路径（OPFS）未被测试覆盖
`tests/helpers/storage-mock.mjs` 是 `chrome.storage.local` 的 Map 替身，**从不模拟 OPFS**——而 OPFS 是主持久层（`data/data-store.js:86-91` 探测 `navigator.storage.getDirectory`）。所有单测/集成测实际跑的是**回退路径**，出厂写路径仅靠 E2E 触达。
**修复**：新增以 `FileSystemHandle`/内存 FS 桩支撑的 OPFS 集成套件，或在 Node ≥18 用真实 OPFS polyfill 跑一遍读写/损坏恢复。

### 🟠 P1-B｜缺少生命周期兜底 flush（去抖窗口内的写入会在 SW 被回收时丢失）
`flushAllCaches()` 在批量/操作完成处被广泛调用（`ratings-batch.js:262/354/360` 等），但**未绑定任何生命周期/周期性触发**；MV3 已无 `onSuspend`。故 2s 去抖窗口（`storage/debounced-store.js:19-27`）内、且后续无操作触发 flush 的写入，会在扩展重载/SW 被杀时丢失。
**修复**：在关键 alarm 周期或 `chrome.storage.session` 心跳里加一次节流 `flushAllCaches`；写失败已有 dirty 回滚（`steam-cache.js:250-267`），补上"最终兜底"即可。

### 🟠 P1-C｜隐私声明与默认行为偏差
`PRIVACY.md:19-20` 主打"数据不离开本机"，但 `constants.js:142/150` 中 `bing`/`spy` 数据源**默认开启**，`background/steam/ai-fallback.js:74` 会把抓取到的**游戏名/查询**发往 `cn.bing.com`。文档虽注明"可选/可关闭"，但默认态与"不离开本机"的表述存在张力。
**修复**：将 `bing` 默认置 `false`（首次触发时按需征求同意），或在 PRIVACY/首启明确"游戏名查询会按请求外发"。

### 🟠 P1-D｜真实覆盖率被高估，门禁形同虚设
`coverage-final.json` 实测 **语句 66.0%（3726/5649）、分支 41.2%、函数 67.1%**，但 `vitest.config.js` **未设 `coverage.all:true`**，只计入被加载的 68 个模块；**93 个源文件中 25 个从未插桩**（`options/` 全部含 `panels/data-manage.js` 备份/恢复 UI、`popup`、`dashboard`、`hub`、`freegames`、`welcome`、所有 `adapters/sites/*`、`service-worker.js`、`content/tracker.js`）。最低者：`handlers.js` 15.7%、`cache-manager.js` 16.8%、`detail-page.js` 22.3%、`data-store.js` 31%。`scripts/coverage-gate.mjs` 仅对"相对 origin/main 的新增文件"卡 50% 行覆盖、无全局下限、无基线时静默 exit 0。
**修复**：开 `coverage.all:true` + 全局下限（如 55% 起步、按季度递增）；优先补 service-worker 启动、备份/恢复、站点适配器三块（均为高影响、当前 0%）。

### 🟡 P2-A｜持久化并发与恢复正确性
- 读路径 `data-store.js:186-210` 不在写队列内，损坏时经 `_resetFile:164-182` **破坏性丢弃该模块**（读撕裂触发不可逆重置）。
- `storage/behavior.js:105-142`：每事件 `doUpdateGameProfile` 全量重写所有 profile 且**无 size cap**（对比 `name-index` 有 `NAME_INDEX_MAX_ENTRIES`）→ 无界增长 + 写放大；且每事件重读整份 NDJSON。
- `storage/backups.js:114-148` `restoreBackup` 逐模块写，**中途失败留半恢复态**。
- `storage/logger.js:89-92` flush 失败重排队但不再调度 → 日志随 SW 消亡。

### 🟡 P2-B｜推荐引擎 NaN 摄入
`recommend/engine.js:400-414` 让非数值 `score` 穿过 `Math.min(1, undefined)` → **NaN 并被缓存 7 天**；`:25-36` 关键词分求和未校验磁盘权重（字符串→拼接/NaN）；`message-contract.js:113-114` 对 `SAVE_SETTINGS` 仅判"是普通对象"，`weights:{clickRate:'0.5'}` 即产 NaN 分。
**修复**：权重/LLM 分数落库前 `Number.isFinite` 校验，非有限值回退中性常量。

### 🟡 P2-C｜内容脚本性能
三处 `MutationObserver`（`content/list/list-batch.js:228`、`list-page.js:95-99`、`content/detail/qr-unlock.js:167`）可并存且完成时不 disconnect；自身徽章插入（`badges.js:200`）回触发发现观察器，每趟重建 `new Set(...)` O(N)（`list-batch.js:211`）→ 长滚动接近平方；裁剪发生在物化全部 anchor 之后（`adapters/builder.js:139,184,237`）；`list-page.js:213-273` 预取下一页 HTML 后在**主线程同步 `DOMParser`**。
**修复**：命中即 `observer.disconnect`/去抖合并；先按可见性粗筛再解析；下一页解析放入空闲回调。

### 🟡 P2-D｜消息契约默认开放 + 响应形状不一
`message-contract.js:238` 未列 action **默认放行**；`TRACK_EVENT:84-95` 白名单了 `type/gameName` 却漏 `appId/domain/keywords` 元素。响应形状 `{success}` 与裸数据（`handlers.js:206-210`）与 `{logs}`（`:295`）不一，契约拒绝以 `{error}` 解析但消费方（`list-batch.js:117,159`）读 `response.ratings/results` → **失败静默降级为"无数据"**。

### 🟡 P2-E｜测试与工具链短板
- 测试文件（`.mjs`）**不在 eslint 规则作用域**（`eslint.config.js:16` 仅匹配 `**/*.js`，`--no-warn-ignored` 掩盖）。
- 三份 `tsconfig` 全 `noImplicitAny:false`、`tsconfig.ui.json` 关 `strictNullChecks`、`tests/` 排除于 typecheck → "strict" 被稀释。
- 视觉基线锁 OS/字体（0.5% 像素容差、版本号强制 `--update`），CI 仅 ubuntu-latest，**开发却在 Windows** → 基线可静默腐坏。
- CI 分片 `test-2` 仍 `needs: test` 串行（无并行收益）；**发布 zip 从不在 CI 里构建/冒烟**。
- `keepAlive`（`ratings-batch.js:219-221`）自 Chrome 110 起无效（manifest 允许 109），真正兜底是 alarm+session 续跑；`background/storage/flush.js` 相关分层约定无 import 边界工具强制。

### ⚪ P3｜其他
- `recommend/engine.js:12,323` 直读 `dataStore`/`KEYWORD_WEIGHTS`（绕过 `storage/behavior.js` 缓存），破坏宣称的单向分层（仅 LLM 路径）。
- `content/core/download-tracking.js:58` 的 `setupDownloadTracking()` 不收 `settings`，而 `tracker.js:221` 传了 → `downloadTrackingEnabled` **死开关**（与已修的 v10.4.2 同类缺陷）。
- `hub/hub.js:56` `onmessage` 无 origin 校验（已受白名单动作缓解）；`shared/settings-utils.js:55` `postMessage(...,'*')`。
- `lib/vendor/qrcode-reader.js` 是唯一随包第三方运行时代码，应固定版本并纳入审计；根目录 `GameRecommender-*.html` 报告与 `coverage/`、`release/` 等已 gitignore（属未跟踪噪声）。

---

## 四、后续演进建议（分阶段路线）

**第 0 阶段（发布前，1 个补丁版本，约 1–2 天）— 收敛安全边界**
1. `handleMessage` 加 sender 来源门（P0-A）+ 统一 `detail-templates/detail-page` 转义（P0-B）。
2. 移除 `optional_host_permissions: */*`，改逐域授予；`validateSiteRule` 域名正则校验（P0-C）。
3. `bing` 默认关闭或改按需同意，令 PRIVACY 表述与默认态一致（P1-C）。
4. 推荐引擎/权重落库前 `Number.isFinite` 校验（P2-B）。
> 以上四项 + 一条集成回归（伪造非扩展页 sender 应被拒），构成最小可发布安全基线。

**第 1 阶段（近期，1 个次版本）— 让测试"可信"**
5. `coverage.all:true` + 全局下限并纳入门禁；补 service-worker 启动、备份/恢复、`adapters/sites/*` 三块 0% 区（P1-D）。
6. 引入 OPFS 写路径集成测试（真实/ polyfill 文件系统），覆盖损坏恢复与并发写（P1-A）。
7. 补生命周期兜底 flush（节流 alarm/心跳触发 `flushAllCaches`，P1-B）。
8. eslint 纳入 `.mjs` 测试、CI 构建并冒烟发布 zip、加 Windows 或字体稳定的视觉策略（P2-E）。

**第 2 阶段（结构性，1–2 个版本）— 偿还演进税**
9. 用工具固化分层：ESLint `no-restricted-imports`/边界规则强制 `core→storage→业务→handlers` 单向（消除 P3 引擎越层）。
10. 合并"模块注册需 4 处同步"为单一登记表（`DB_KEYS`/`DATA_MODULES`/`MODULE_FILES`/`reset`/`backups`），加启动一致性断言，显著降低新增存储模块的心智成本。
11. 消息契约：默认拒绝未知 action + 统一响应信封 `{ok,data|error}`，消费方按契约判定成功/降级（P2-D）。
12. 持久化健壮性：读纳入写队列、`behavior` 加 profile 数量上限与增量写、`restoreBackup` 事务化（P2-A）。

**第 3 阶段（体验/性能，择机）**
13. 内容脚本：命中即 disconnect 观察器 + 去抖合并、先粗筛后解析、下一页解析让出主线程（P2-C）。
14. 清理死开关（`download-tracking`）、`hub.onmessage` 加 origin、固定并审计 `lib/vendor`。

---

## 五、附：量化事实速览

- 分层：源码 27.7k / 测试 7.35k 行；background 9.9k、options 5.6k、content 4.2k、popup 1.4k、dashboard 1.5k 为主量。
- 覆盖（实测 `coverage-final.json`）：语句 66.0% / 分支 41.2% / 函数 67.1%，**仅计 68/93 被加载模块**，25 文件从未插桩。
- 门禁链：`npm run gate` = check(lint+typecheck+vitest) + 覆盖率 + 性能预算(90s) + MOCK E2E(真 Chrome+xvfb) + 视觉回归；CI 另跑 npm audit(high) + gitleaks。
- 代码卫生：0 TODO/FIXME、0 `@ts-ignore`、0 `eslint-disable`、0 `as any`；8 处 `@type {any}` 逃生舱。`typescript@7.0.2` 为真实最新版（非笔误）。生产依赖：0（`lib/vendor` 为唯一随包第三方）。
- 依赖与发布：`scripts/package.mjs` 白名单拷贝，测试/脚本/node_modules 不会泄入 zip。

> 说明：本报告为独立只读复核结论，所有问题均给出证据 `path:line`；建议修复均以现有门禁与回归测试为验收标准（对齐仓库 AGENTS.md 铁律第 9 条"修复必须配回归测试"）。
