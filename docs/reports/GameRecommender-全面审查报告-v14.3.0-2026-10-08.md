# 游戏雷达 Game Radar — 全面审查与优化建议报告（v14.3.0）

- **审查对象**：`F:/data/browser extension/game-recommender`（Chrome MV3，零构建，原生 JS + JSDoc）
- **审查时点**：2026-10-08 00:47（GMT+8）
- **版本**：manifest / package `14.3.0`（第五轮 10 批次：9/10 落地，B9 延后）
- **审查方式**：门禁实跑（lint / typecheck / test 全量）+ 四域并行深读（后台 / 内容脚本 / 页面层 / 测试护栏）+ **逐条人工核验**（所有 P0/P1 均给出可复核的 `文件:行号`）
- **代码规模**：核心生产目录约 **24,526 行**（TOP 文件 491 行，无文件超 500 行纪律达成）；测试约 11.5k 行

---

## 摘要（TL;DR）

| 维度 | 结论 |
|---|---|
| 门禁现状 | lint 0 错 0 警 · typecheck 三配置零错误 · **894 用例 / 42 套件全绿（47s）** |
| 代码质量 | 出站收敛、契约零缺口、单源派生不变量质量高，属同类项目上游水平 |
| 本次发现 | **P0 × 5** · **P1 × 10** · P2 × 15+ |
| 最严重问题 | ①设置保存映射漏 3 键（**历史同类事故重犯**，用户改设置被静默丢弃）；②类型债棘轮只数 1 种错误码且**不在 CI**；③悬空 API `applyPageTheme` 使 3 个页面主题静默失效；④覆盖率门禁三处结构性漏网 |
| 总体判断 | **架构与纪律已达成熟期，短板集中在"护栏的真实性"与"映射/命名的静默失效"两类**——这类问题不会让 `npm run check` 变红，却会真实丢用户数据或让功能失效 |

> **核心判断**：v14.3.0 已经"拆干净了"，下一步的收益不在继续拆文件，而在**把护栏从"形式存在"提升到"真实生效"**，并把"键映射/命名"这类不可测的一致性做成机器断言。

---

# 一、审查

## 1.1 基线核查（实测）

```
$ npm run lint      → 0 error / 0 warning（--max-warnings 0 生效）
$ npm run typecheck → 三份 tsconfig 全部通过（strict + noImplicitAny:false）
$ npm test          → Test Files 42 passed / Tests 894 passed（47.10s）
```

- 类型债基线（`scripts/lint-baseline.json`）：main 510 / ui 251 / content 272
- XSS 棘轮基线：72（白名单制口径）
- 覆盖率阈值：lines 47 / statements 46 / functions 43 / branches 42
- 文件行数纪律：TOP1 `background/steam/api-search.js` 491 行，**第五轮"TOP10 ≤500"目标达成**

**结论**：项目自述指标与实测一致，无"数据造假"。第五轮拆分（B1–B8、B10）确已落地。

---

## 1.2 P0 级发现（5 项）

### P0-1　设置保存映射漏 3 个键 —— 历史同类事故重犯
**位置**：`options/options.js:177`（仅有事件绑定）vs `options/options.js:226-357`（`saveSettings` 全量收集段）

**证据链**：
- `options.js:177` 只做绑定：`['detailFloatExpanded', 'detailFloatSide', 'redTitleRating'].forEach(id => addEventListener('change', () => scheduleAutoSave()))`
- `saveSettings()`（226–357）**从未读取这三个 DOM 值**——全文件仅第 177 行出现过这三个名字
- 渲染侧确有回显（`options/panels/settings-render.js:110/111/120`），恢复默认侧有锚点（`options/panels/reset-defaults.js:54-56`）→ 表面完整，唯保存断链

**后果**：用户修改「详情浮窗默认形态 / 浮窗位置 / 红标题阈值」后，防抖保存会把 `OPTS.currentSettings` 中**加载时的旧值**写回后台，用户的修改被静默丢弃。三个键分别被 `content/core/floats.js`、`content/list/badges.js`、`content/detail/sidebar.js` 消费，属功能可见的失效。

**铁证**：同文件 `235-236` 行注释明确记录了 **v6.4.11 的完全同类事故**——

> `v6.4.11：修复 30 天好评过滤/关系模式/重排序无法保存（此前仅在事件绑定中 scheduleAutoSave，收集阶段漏读这 4 个 DOM 字段，保存时被旧值覆盖）`

本次是同一根因的复发，说明"靠人工核对保存映射"的纪律已经失效。

**为什么测试没拦**：`tests/unit/test-settings-sync.mjs:57` 只断言"键名在 options 层某处出现"，渲染 / reset 锚点即可满足，**无法识别"缺保存映射"**。

**修法**：
1. 三个键加入 `saveSettings` 收集段（`detailFloatExpanded = …checked`；`detailFloatSide = …value`；`redTitleRating = Number(...)`）
2. **升级护栏**：`test-settings-sync` 增加"每个 `DEFAULT_SETTINGS` 键必须出现在 `saveSettings`/`collect*` 写路径"的强断言（区分读路径与写路径，见 §2.1）
3. 补回归测试：三键改值 → SAVE → 断言持久化值

---

### P0-2　类型债棘轮只数 TS7006，且不在 CI 中
**位置**：`scripts/lint-ratchet.mjs:38`

```js
const n = (output.match(/error TS7006/g) || []).length;   // 只数"参数隐式 any"
```

**两重绕过**：
1. **形态绕过**：隐式 any 家族还有 TS7053（元素隐式 any，main 约 121 处）、TS7005、TS7034、TS7031、TS7022/7023、TS7017… 全仓约 **333 处未计入**（main ~173 / ui ~83 / content ~77）。把 `function f(x)` 写成 `function f(x: any)` 会让 TS7006 消失、**计数下降但债务未还**。
2. **CI 绕过**：`.github/workflows/ci.yml` 的 job 清单为 test / coverage-gate / release-smoke / perf / e2e / visual / security —— **没有 `lint-ratchet`**。该棘轮只在 `scripts/gate.mjs:38` 本地门禁里跑；任何不跑本地 gate 的 PR 或直接 push，都能把 noImplicitAny 顶到基线之上而 CI 全绿。

**后果**：这是项目最典型的"承诺已生效、实际可绕过"——`lint-baseline.json` 自述"机器约束、禁止上调"，但约束力只覆盖自觉跑本地 gate 的人。

**修法**：① 计数改为隐式 any **全家族之和**（TS7005/7006/7011/7015/7017/7018/7019/7022/7023/7031/7034/7053）；② CI 增独立 `lint-ratchet` job；③ `package.json` 的 `typescript` 由 `^7.0.2` 改锁精确版本（caret 漂移会改变错误计数，实测本机 main=509 / content=266 与基线已有浮动）。

---

### P0-3　覆盖率门禁三处结构性漏网
**位置**：`scripts/coverage-gate.mjs`

| 编号 | 位置 | 问题 |
|---|---|---|
| a | `:38-48` | **豁免清单混入纯逻辑文件**：`options/panels/cache-formatters.js`（137 行纯函数：TTL 文案/徽章分级/时间格式化 4 段阈值，零 DOM 依赖）、`popup/popup-weights.js`（权重求和计算）、`popup/popup-status.js`（异常/采样/熔断三分支）——**违反脚本自身注释承诺**（`:36-37`「仅豁免纯胶水，含逻辑的页面层文件不入清单」） |
| b | `:67` | **只扫新增文件**（`git diff --diff-filter=A`）：向既有文件（如 `background/steam/api.js` 700+ 行）新增数百行无测试逻辑 → diff 中无 A 文件 → 直接放行 |
| c | `:93-95` | **静默放行通道**：无法确定基线时 `console.log('跳过覆盖率门禁'); process.exit(0)`。浅克隆 / 单提交仓库直接绿灯，且 `catch {}` 吞掉真实 git 错误 |
| d | `:18-31` + `vitest.config.js:88-101` | **`lib/` 整体逃逸**：`COVERED_DIRS` 与 coverage `include` 都不含 `lib/`，但 `lib/ndjson.js` 是出厂运行时持久层解码器（被 `data/data-store.js:19` 静态 import，负责 NDJSON 解析/损坏行恢复） |

**修法**：a) 把 `cache-formatters.js` 移出豁免并补纯函数单测；给豁免清单加机器校验（函数体分支数为 0 才可豁免）。b) 改为对"相对基线新增行覆盖率"设门槛。c) 无法定基线时**失败**（CI 显式传入基线 SHA）。d) `lib/**`（排除 vendor）补进两处 include。

---

### P0-4　悬空 API `applyPageTheme` —— 3 个页面主题静默失效
**位置**：`shared/settings-utils.js:155-166`（导出对象）

导出集合为 `VALID_THEMES / deepSet / getByPath / applyPatch / goHub / applyTheme / applyThemeAuto / resolveTheme / applyCustomTheme / createSaveQueue` —— **没有 `applyPageTheme`**。

**但全仓 5 处调用它**：

| 调用点 | 是否有兜底 | 实际结果 |
|---|---|---|
| `popup/popup.js:45-50` | ✅ else 走 `applyThemeAuto + applyCustomTheme` | 正常 |
| `dashboard/dashboard.js:26-32` | ✅ else 兜底完整 | 正常 |
| `freegames/freegames.js:31-32` | ⚠️ 兜底**只走 `applyThemeAuto`，漏 `applyCustomTheme`** | 不应用自定义主题 CSS |
| `hub/hub.js:22` | ❌ 无守卫、被 try/catch 吞 | **永不应用任何主题** |
| `sidepanel/sidepanel.js:20-21` | ❌ `&& …applyPageTheme` 门禁直接跳过 | **永不应用任何主题** |

同时 `README.md:999` 仍宣称「页面层统一：applyPageTheme 统一入口（popup/dashboard/hub/freegames 主题探测）」——**文档与实现脱节**。

**修法**：二选一——① 在 `settings-utils.js` 真正实现并导出 `applyPageTheme(settings)`（= `resolveTheme` + `applyTheme` + `applyCustomTheme`）；② 删除该 API，各页统一 `applyThemeAuto + applyCustomTheme` 并补齐 hub / sidepanel / freegames 兜底。**并加护栏**：对 `__GR_SETTINGS_UTILS__` 做"导出集合 vs 全仓调用点"一致性断言（见 §2.1）。

---

### P0-5　收藏切换无锁 → 并发丢收藏
**位置**：`background/storage/favorites.js:31-48`

```js
export async function toggleFavorite(appId, name, releaseDate) {
  const favorites = await getFavorites();        // 读
  if (favorites[key]) { delete favorites[key]; await writeModule(...); return; }  // 改-写
  favorites[key] = { ... };
  await dataStore.writeModule(DB_KEYS.FAVORITES, favorites);   // 改-写
}
```

**对照**：同域其它模块 `download-urls.js:21`、`history.js:39`、`app-stats.js:81`、`behavior.js:102` **都用了 `withLock()`**，唯独 favorites 没有。

**触发面**：`TOGGLE_FAVORITE` 在 `message-contract.js:373` 的 `CONTENT_ALLOWED_ACTIONS` 白名单内，内容脚本可直发。多标签页 / 双击快速收藏两个不同游戏 → 两次 RMW 都以同一旧基线覆盖写，**后写者吞掉前者的新增/删除**。

**修法**：引入 `const withFavLock = withLock()`，把 `toggleFavorite` 主体包进锁（与既有模式一致），并补并发回归测试。

---

## 1.3 P1 级发现（10 项）

### P1-1　下载站首页空指针 —— 关闭二维码功能即崩
`content/tracker.js:209`
```js
if (list.isHomePageUrl()) { … M.qrUnlock.init(settings); return; }   // ← 无 ?.
```
`qrUnlock` 是可选模块（`content/module-manifest.js:36`，`setting: 'qrUnlockEnabled'`）。用户关闭「二维码转链接」后 `M.qrUnlock = null`，此时访问任一已追踪下载站**首页** → `TypeError: Cannot read properties of null`，`init` 由 `void init()` 调用无人 catch → 未处理 rejection。
**同文件 277 行对同一模块用了可选链** `M.qrUnlock?.init?.(settings)` —— 属实现不一致的遗漏。
**修法**：209 行改 `M.qrUnlock?.init?.(settings);`

---

### P1-2　`ruleList` / `settingsSearch` 重复 id —— 规则管理面板永远空白
`options/options.html:741` 与 `:1247` 同 `id="ruleList"`；`:26` 与 `:60` 同 `id="settingsSearch"`。
`getElementById` 恒返回文档中第一个。两个模块都用 `getElementById('ruleList')`：`options/panels/search.js:35`（关键词规则）与 `options/panels/rules.js:63`（适配规则）→ 打开「规则管理」时把适配规则渲染进**过滤面板**的容器，`#panel-rules` 的真容器永远空白；`settingsSearch` 同理使面板头部搜索框失效。
**修法**：分配唯一 id（`filterRuleList` / `adapterRuleList`、`panelSearch`），并加"页面内重复 id"静态护栏测试（HTML 层目前零护栏）。

---

### P1-3　`flushSteamCache` 快照 + `clear()` 存在脏标记丢失窗口
`background/storage/steam-cache.js:318-365`：入口 `steamCacheDirty = false`（):322`）→ 逐模块构造 subset 快照（`:326-330`）→ `await writeModule` → 结束 `dirtyModules.clear()`（`:355`）。
在 `await` 期间，并发 `setSteamCacheEntry` 更新**已在 `dirtyModules` 中的同一模块**（`add` 为 no-op，新数据不进已构造的 subset），随后 `clear()` 抹掉并发者置的脏标记 → `steamCacheDirty` 为 true 但 `dirtyModules.size === 0`，下次 flush 在 `:321` 提前返回 → **该更新永不落盘，SW 重启即丢**。
**对照**：`logger.js:51` 的 `withFlushLock` 是全量快照 + 锁，steam-cache 没有。
**修法**：flush 全程持 `withLock`，或写完后基于"期间是否新增脏模块"决定是否保留标记。

---

### P1-4　Steam 全局限速读-改-写非原子，可突破最小间隔
`background/core/utils.js:135-143`
```js
let lastSteamCallAt = 0;
async function steamRateLimit() {
  const wait = lastSteamCallAt + STEAM_MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastSteamCallAt = Date.now();      // 非原子
}
```
并发调用在第一个 `await` 前读同一 `lastSteamCallAt`：当 `wait <= 0` 时两条都不 sleep、同步各写 `now` → 同时出网，最小间隔保护失效。`ratings-batch.js` 每批 `Promise.all` 并发 6 条 Steam 请求，正是高发场景。
**修法**：用 `withLock()` 包住"读取-等待-更新"，或改用令牌桶/单飞行队列。

---

### P1-5　图片代取先整包下载后判大小，可撑爆 SW 内存
`background/handlers/image-fetch.js:22-32`：`fetchWithTimeout` → 判 `ok` → 判 `content-type` → **`await resp.arrayBuffer()`（先读完整 body）** → 再比对 `maxKb`。
`maxKb` 由消息方控制且契约允许到 30720（30MB，`message-contract.js:261`），服务端返回体亦不受 content-length 约束。
**修法**：先读 `content-length` 预判，或用 `resp.body.getReader()` 边读边计数、超限立即 `cancel()`。

---

### P1-6　`claimFreeGame` 与限免刷新竞态，`claimed` 标志丢失
`background/freegames/notify.js:133-142`（无锁 RMW）+ `background/freegames/manager.js:65-90`（先 `readModule(FREE_GAMES)` 再整体覆盖写）。`refreshInFlight`（`manager.js:40-51`）只串行化了"刷新 vs 刷新"，未与 claim 互斥。用户点领取的同时 alarm / 启动刷新在途 → 刷新用旧基线覆盖，`claimed=true` 丢失。
**修法**：`claimFreeGame` 走与刷新同一把锁，或刷新只做增删 merge（保留已 claim 的 id 集合）。

---

### P1-7　`parentNode` 判"是否在 DOM"与移除粒度不匹配 → 过滤恢复失效
`content/list/list-state.js:324/257/334` 用 `item.element.parentNode` 判断项是否在文档中；但 `content/list/badges.js:16-21` 的 `removeItemFromDom` 优先移除的是**祖先栅格容器**（`closest('[class*="col-"]') || closest('li, article, .item, .post')`，非自身时）。此时 `item.element` 仍挂于脱离文档的祖先容器上，`parentNode` 为真 → `inDom` 误判 → 调低阈值本应恢复却**不重挂**（`shown` 计数却增加）；`restoreFilteredGames` 同样不恢复。
**修法**：改用 `item.element.isConnected`；并统一"移除/恢复"的粒度。

---

### P1-8　属性上下文误用 `escapeHtml`（应 `escapeAttr`）
`shared/escape.js:13-17` 的 `escapeHtml` 经 `textContent → innerHTML`，**只转 `& < >`，不转双引号**；`escapeAttr`（`:23-29`）才转引号。
- `dashboard/dash-insights.js:33`：`data-tag="${escapeHtml(kw.keyword)}"` —— `kw.keyword` 来自学习到的网页标题关键词（网页可控），含 `"` 即突破属性边界注入标记
- `options/panels/rules.js:75`：`data-site="${escapeHtml(s.key)}"` —— 当前被上游正则强校验兜住，但依赖"上游恰好校验"本就脆弱

扩展页 CSP（`script-src 'self'`）会拦内联事件处理器，故**实际执行受限**，但 HTML/伪元素注入成立，且这是"用错函数"。
**修法**：属性上下文一律 `escapeAttr`；可在 XSS 棘轮里增加"`${escapeHtml(...)}` 出现在属性位置"的形态识别。

---

### P1-9　面板内键盘监听器重复累积
`content/detail/candidates.js:133`：`document.addEventListener('keydown', kbHandler)` 位于 `searchAndRender()` 内，而该方法在初始调用 + **每次输入防抖（`:203`，300ms）** 都执行；`kbHandler` 自移除条件 `!document.body.contains(listEl)`（`:116`）因 `listEl` 是同一节点（只改 `innerHTML`）**永不成立** → 每搜一次累加一个全局监听器，↑/↓ 高亮跳变、Enter 可能触发陈旧项。
**修法**：`searchAndRender` 开头 `removeEventListener`，或把 `kbHandler` 提升到面板作用域只注册一次。

---

### P1-10　storage mock 返回内部引用，掩盖"忘记持久化"类缺陷
`tests/helpers/storage-mock.mjs:17-31`：`get` 直接返回内部对象引用（`out[k] = data.get(k)`），而真实 `chrome.storage` 是**结构化克隆**。测试可就地改值而不 `set` 便"通过"，掩盖真实环境下的持久化缺失。`:55` 的 `sendMessage: async () => ({ success: true })` 使所有消息错误分支在 mock 下不可达。
**修法**：`get` 返回深拷贝（`structuredClone`）；提供可注入错误的 `sendMessage` 工厂。

---

## 1.4 P2 级发现（摘要，15 项）

**并发 / 生命周期**
- `background/steam/steam250.js:62-106`：`loading` 仅在在线抓取分支 `finally` 复位；快照命中分支 `:72` 直接 return → SW 存活跨 24h 后 `:64 if (loading) return loading` 永返陈旧 `true`，**永久停止刷新**
- `background/steam/ratings-batch.js:151-187`：`jobQueues` 按 `tabId` 只增不删（跑完不移除），会话内随开标签数无界堆积
- `background/storage/logger.js:171-180`：`clearRuntimeLogs` 未纳入 `withFlushLock` → 与在途 flush 交叠时"清空日志"被撤销
- `background/core/outbound-audit.js:26` / `api-registry-heal.js:11`：纯内存 Map 无窗口/时间清理，自定义站点多时缓慢累积

**边界 / 负缓存**
- `background/freegames/itad.js:61-83` + `fetch.js:310`：`!resp.ok` 不落负缓存 → ITAD 5xx 时 48h alarm 与 dashboard 逐收藏反复出站
- `background/steam/api-search.js:83-126`：`fetchSteamTagRecommendations` 无 `resp.ok` 前置、无 per-tag try/catch（一个标签失败中断整个函数）、未 `recordSteamCall`
- `background/steam/api-reviews.js:252-287`：`fetchChineseReviews` 先 `json()` 后判 ok、成功路径不记监控、`r.review.substring` 缺 `|| ''` 兜底
- `background/storage/behavior.js:40-58`：`addBehaviorLog` 每条事件全量读回日志文件（`TRACK_EVENT_BATCH` 最多 100 条 → 100 次全量 parse，写放大 O(n²)）
- `background/storage/app-stats.js:192` / `url-index.js:122` / `reset.js:33-51`：清除类操作的磁盘删除未 await，SW 终止可残留；`urlAppIdIndex` 未打 `clearOnDataReset` 标记
- `background/core/settings.js:30,63-69`：`deepMergeSettings` 浅拷贝默认数组（存储缺失时 `trackedSites` 与 `DEFAULT_SETTINGS` 同引用）、`getSettings` 返回内部缓存本体 → 调用方可原地污染默认常量

**内容脚本性能 / 健壮性**
- `content/tracker.js:40-74`：`Promise.all(CORE_MODULES.map(import))` 无 `allSettled` 降级，单模块加载失败即整页功能静默失效
- `content/`：全仓 `pushState|popstate|hashchange` **零命中** —— 无 SPA 路由变化处理，站内前端路由跳转后浮窗/徽章不刷新
- `content/detail/qr-unlock.js:217`：`observer.observe(document.documentElement, { childList, subtree })` 全页子树 + **从不解绑**
- `content/list/list-batch.js:107-119`：每批对全部待办项（≤2000）调 `getBoundingClientRect()` 强制重排
- `content/list/list-batch.js:93`：入队即对每个 item 插入占位徽章（大列表首屏写放大，无虚拟化）
- `content/list/list-batch.js:42-47`：清理的是恒为 `null` 的 `batchState.forceTimer`（死代码，真正的定时器在 `_state.ratingsJob.forceTimer`）
- `content/list/list-batch.js:277`：发现观察器 `observe(document.body, subtree)`，注释称 container-scoped 但实为全页；断开时未 `clearTimeout(scanTimer)`；哨兵节点重入未移除
- `content/detail/sidebar-rows.js:95` / `detail-templates.js:83`：Steam250 `rank/score`、`spy.positiveRate` 未转义（同块其余字段已转义）
- `content/list/list-page.js:337`：`r.domains.some(...)` 缺 `Array.isArray` 守卫（`builder.js:318/55` 有）
- `content/core/common.js:63,71` 等：扩展上下文失效（重载/更新）时 `chrome.runtime.sendMessage` **同步抛**，`.catch` 无法捕获

**页面层 / 工具**
- `dashboard/dash-stats.js:224,229`：标签云筛选把结果写入 `cachedGames`，但渲染用 `paginate('games', games)`（原始未过滤参数）→ **首屏筛选不生效**，需点分页才"突然"生效
- `options/options.js:76,128`：`bindSettingsSearch()` 被绑定两次（无幂等守卫）
- `options/panels/sites.js:154-158`：多域名规则（`gamer520` 含 `gamer520.com` + `gamers520.com`）首次自动保存后**永久丢失第二域名**
- `shared/msg.js:35-40`：`Promise.race` 超时定时器成功路径不 `clearTimeout`
- `shared/crypto-utils.js:104`：`decryptJson` 的 `iterations` 无上界（导入备份可致 PBKDF2 长时间阻塞，本地 DoS）；`:71` 直接用 `global.crypto` 未经守卫
- `shared/settings-utils.js:144-166`：`createSaveQueue` 导出后**零消费**，popup / options 各写一份串行队列（"单源"实为三份）
- `data/data-store.js:210-233`：`_parseMapText` 对含 `key`/`value` 顶层键的旧全量对象有误判歧义
- `popup/popup-*.js`：裸经典脚本无 IIFE，顶层 `const` 进全局词法作用域（跨文件重名即 SyntaxError，当前靠运气无冲突）
- CI 缺 `prettier --check`（pre-commit 可 `--no-verify` 绕过）；`package.mjs` 无产物完整性/体积阈值；`scripts/release.mjs` 落后于流程且 `:122` 存在 shell 拼接面；`scripts/ui-refactor.py` 非幂等（重跑 `gr-btn` → `gr-gr-btn`）

---

## 1.5 审查方法学与覆盖边界（诚实声明）

- **实跑验证**：lint / typecheck / test 三项在审查环境完整执行，结果如上。
- **人工核验**：本报告所有 **P0（5 项）与 P1（10 项）** 均已由我直接读取源码逐条确认（`文件:行号` 可复核）。
- **代码阅读推断（未构造复现）**：P1-3 / P1-4 / P1-5 / P1-6 属"竞态 / 边界"类，结论由代码路径分析得出，**建议修复时先写失败用例复现**再改。P2 清单中标注行号者同理。
- **未能覆盖**：E2E / visual regression / coverage 因沙箱禁 spawn 子进程无法本地运行（环境限制，非项目缺陷）；`background/handlers.js` 的覆盖率归因伪影（已知）不影响本次结论。

---

# 二、编码工程方向优化建议

## 2.1 判断：项目已过"拆分期"，进入"护栏真实化期"

v14.3.0 的文件行数纪律、单源表、依赖分层都是硬资产。本次审查暴露的问题**几乎全部不是"代码写得差"，而是"护栏看起来有、实际绕得过"或"键映射断了没人发现"**。因此工程投入应从"继续重构"转向以下四个方向。

## 2.2 方向一：把"映射/命名一致性"做成机器断言（收益最高）

这类问题（P0-1 / P0-4 / P0-5 的重复 id / P2 的多域名丢失）共同特征：**不会让 `npm run check` 变红，但会静默丢数据或让功能失效**。

| 建议 | 针对 |
|---|---|
| `test-settings-sync` 升级为**双向断言**：每个 `DEFAULT_SETTINGS` 键（含嵌套组）必须在 `saveSettings`/`collect*` 的**写路径**出现，而非"文件里出现过" | P0-1 复发根因 |
| 新增 **HTML 重复 id 静态检查**（解析 `*.html` 收集 id，重复即红） | P1-2 |
| 新增 **`__GR_SETTINGS_UTILS__` 导出集合 vs 全仓调用点** 一致性断言（调用不存在的导出、或导出无消费方均报警） | P0-4、`createSaveQueue` 死代码 |
| 新增 **`DB_KEYS ⊆ STORAGE_MODULES 键集合`** 断言（`constants.js:17-45` 目前仍是手维护的第二份键名清单） | 存储单源残留 |
| 新增 **多域名站点规则**往返测试（规则 → 渲染 → 收集 → 断言 domains 不变） | P2 多域名丢失 |

> 实现抓手：项目无构建体系，但可离线使用 `eslint` 的自定义规则或一个轻量 `scripts/consistency-check.mjs`（正则/AST 皆可，纳入 gate）。

## 2.3 方向二：门禁去假象（本次 P0-2 / P0-3 的直接修复）

1. **CI 接入 `lint-ratchet`**，并把计数扩到隐式 any 全家族；`typescript` 锁精确版本。
2. **coverage-gate 四补**：豁免清单机器校验（纯分支为 0 才可豁免）→ 新增行覆盖率门槛 → 无法定基线改失败 → `lib/` 纳入分母。
3. **XSS 棘轮扩 sink**：目前只扫"含 `innerHTML` 的行里的 `${}`"，漏 `insertAdjacentHTML` / `outerHTML` / "变量赋值 HTML" / 字符串拼接整类 sink（`options.js:53`、`content/core/status-bar.js:130`、`detail/inline-card.js:196` 等大量存在）。建议补 sink 类型 + 对"属性位置用 escapeHtml"做形态识别。
4. **每个"堡垒"护栏配一条自检**：确保"护栏自己不会静默失效"（`lint-ratchet` 已有 `spawn` 哨兵的先例，可推广）。

## 2.4 方向三：并发一致性统一（P0-5 / P1-3 / P1-4 / P1-6）

项目已有 `core/mechanisms.js` 的 `withLock`，但覆盖是"多数模块"而非"全部 RMW/flush 路径"。建议：

- **全量盘点 RMW / flush 点**，逐一确认是否有锁；把 `favorites` / `claimFreeGame` / `steam-cache flush` / `steamRateLimit` 补齐。
- 落一条**书面纪律进 AGENTS.md**（铁律 #6 的强化）："任何 读-改-写 / 先快照后清理 的持久化路径必须持锁；flush 结束时 `clear()` 前须确认期间无新增脏标记"。
- 补**并发回归测试**（同时发起 N 个 toggle / flush + 写入，断言最终态）。

## 2.5 方向四：类型化"增量推进"（务实版）

历史决策"不做全量 TS"应继续遵守，但当前 `noImplicitAny` 全关 + 棘轮形同虚设，等于类型资产为零。建议改为**增量策略**：

1. **不追求清零**，只要求"新增/修改的代码不增加计数"（棘轮已具备，只差全家族计数 + CI）。
2. **UI 层最弱**（`tsconfig.ui.json` 连 `strictNullChecks` 都关）→ 先量化 `strictNullChecks` 错误数并锁基线，再逐步降。
3. **公共边界优先**：`storage-registry` / `constants` / `message-contract` / `mechanisms` 这些高耦合枢纽先补 JSDoc `@type`（消费方最多，收益最大）。

## 2.6 方向五：测试体系维护（B9 收尾 + mock 保真）

- **完成第五轮 B9**：三个测试巨文件重组。优先级排序（含风险评估）：
  - `test-integrity.mjs`（579）→ **风险最低、收益最高**，内部已按 1..14 编号分节、无共享可变状态，可机械按节拆。
  - `e2e-smoke.mjs`（895）→ **不建议物理拆**（单浏览器会话含"重启后复用 profile/extId"语义），建议按节抽函数降行数。
  - `test-content-sim.mjs`（1455）→ **风险最高**（FakeEl + `__grImport` + 模块单实例纪律），先抽 `tests/helpers/fake-dom.mjs`，再按场景拆。
- **提高 mock 保真度**：storage mock 深拷贝返回、fetch mock 补 `headers.get`/`clone`/AbortSignal；补 `fetchWithTimeout` 的**重定向逐跳复检**与 **AbortError 超时**两条安全路径用例（当前全仓 `redirect|AbortError` 零命中）。
- **fast-check 属性去水**：`test-properties.mjs` 多处以 `constantFrom` 固定样例冒充属性（`:183-201`），且注释宣称的不变量（"不应以噪声词结尾"）未落真断言（`:164-179`）。

## 2.7 优先级矩阵（建议执行序）

| 序 | 事项 | 收益 | 成本 | 风险 |
|---|---|---|---|---|
| 1 | P0-1 三键保存映射 + settings-sync 双向断言 | 高 | 低 | 低 |
| 2 | P1-1 tracker 可选链（一行） | 高 | 极低 | 极低 |
| 3 | P0-4 实现/删除 applyPageTheme + 兜底补齐 | 高 | 低 | 低 |
| 4 | P1-2 重复 id 唯一化 + HTML id 护栏 | 高 | 低 | 低 |
| 5 | P0-2 CI 接入 lint-ratchet + 全家族计数 | 高 | 低 | 低 |
| 6 | P0-3 / P0-5 / P1-3 / P1-4 并发与门禁补强 | 高 | 中 | 中 |
| 7 | B9 测试重组（integrity 先行） | 中 | 中 | 中 |
| 8 | 2.3 XSS sink 扩展 / 2.5 类型增量 | 中 | 中 | 低 |

---

# 三、后续功能开发路线图建议

> 前提：遵守项目「明确不做」清单（i18n / 云同步 / 跨浏览器 / 规则市场 / MAIN world 注入 / 全量 TS）。以下按「地基 → 体验 → 增值」三梯队，每项标注价值/成本/依赖。

## 3.1 梯队一：夯实地基（建议先于任何新功能）

| 功能 | 说明 | 价值 | 成本 |
|---|---|---|---|
| **SPA 路由支持** | 全仓无 `pushState/popstate` 处理；Steam 商店与部分下载站的站内路由跳转后浮窗/徽章不刷新。补 `popstate` + 包裹 `history.pushState/replaceState`，URL 变化时重走 `init` 并清理旧观察器 | 高（影响现有功能在部分站点的可用性） | 中 |
| **模块加载降级** | `ensureModules` 改 `Promise.allSettled`，缺失能力走可选链降级 + 上报 | 中高（防单模块故障整页失效） | 低 |
| **主题体系统一** | 落实 `applyPageTheme`（含 hub/sidepanel/freegames），并抽 `applyPageTheme` 为单源 | 中（连带修 P0-4） | 低 |
| **大列表性能** | 占位徽章按视口插入（复用现有 IntersectionObserver）、批次 rect 采样收敛、`ratingsJob` 收尾后延迟释放 | 中（长列表体验） | 中 |

## 3.2 梯队二：体验增值（现有功能的纵深）

| 功能 | 说明 | 价值 | 成本 |
|---|---|---|---|
| **推荐可解释性** | 推荐值徽章/浮窗已展示分数，但用户不知道"为什么推荐"。增加"信号拆解"（Steam 好评 / 关键词 / 下载热度 / 同类行为各贡献多少，`engine-signals.js` 已是纯函数，天然可展开） | 高（差异化、提升信任） | 中 |
| **偏好画像可视化** | 已收集 `behavior` 关键词权重与趋势——在 dashboard 增加"我的口味雷达"（关键词云已有，可升级为画像卡：偏好类型/反感类型/时间线） | 中高 | 中 |
| **价格能力深耕** | 已有 ITAD 比价 + 收藏折扣监控。可加"历史最低价提醒 / 目标价订阅"（复用 `watchFavoritePrices` alarm 通道与负缓存机制） | 中高 | 中 |
| **适配器生态** | 自定义站点已支持，可做"规则编辑器 2.0"（可视化选择器拾取 + 即时预览 + 导入导出）——**注意不做规则市场**（历史决策） | 中 | 中高 |
| **无障碍与键盘** | 补表单 `for`/`aria-labelledby`、浮窗焦点管理、快捷键（已有 `gr-force-refresh` 命令可扩） | 中 | 低 |

## 3.3 梯队三：增值探索（需评估成本）

| 功能 | 说明 | 前置评估 |
|---|---|---|
| **LLM 推荐增强** | `useLLM` + `llmConfig` 已是挂点，但当前是"可选增强"。可做本地优先（用户自填 endpoint，支持 Ollama / 兼容 OpenAI 协议）、推荐理由生成、自然语言查询（"找类似空洞骑士的"） | 成本/隐私/误用风险；需明确"用户自付 token" |
| **限免/折扣聚合扩展** | 当前 ITAD + GamerPower + 各商店。可扩更多来源（需评估 `host_permissions` 膨胀与维护成本） | host 权限与合规 |
| **性能与可观测增强** | `core/metrics.js` 已有运行指标；可做"性能基准快照"护栏（CI 记录 dashboard metrics 基线，回归即报警） | 中 |
| **导出/报告** | 已有 CSV/JSON 导出。可做"年度游戏报告"（本地生成，纯前端） | 低 |

## 3.4 路线图节奏建议

- **v14.4（维护版）**：P0 全清 + 梯队一的 SPA 路由 / 模块降级 / 主题统一 → 强化护栏（2.1–2.3）。
- **v15.0（体验版）**：推荐可解释性 + 偏好画像可视化 + 价格提醒（三个都是"现有数据的新呈现"，风险低）。
- **v15.x（探索版）**：LLM 推荐增强 + 适配器编辑器 2.0。

> 触发线照旧：大版本 / 5 小版本 / 单次 >1000 行 / 累计 >3000 行。

---

# 附录

## A. 本次审查与历史报告的关系

历史 4 轮审查（`docs/reports/`）已修复 30+ 项，含 XSS 扫描口径、覆盖率门禁假象、lint-ratchet 建立、WAR 加载序。本报告**不重复已修项**，聚焦：

- **残留**：P0-2（lint-ratchet 未进 CI）是历史"护栏假象专项"的**未竟项**——棘轮建了但没接 CI。
- **重犯**：P0-1（保存映射漏键）与 v6.4.11 同一根因。
- **新增**：P0-4（悬空 API）、P1-1（可选链遗漏）、P1-2（重复 id）、P1-3/4/5/6（并发与边界）、P1-7/8/9/10。

## B. 核验命令（可复现）

```bash
npm run lint && npm run typecheck && npm test
# 关键证据点
grep -n "detailFloatExpanded\|detailFloatSide\|redTitleRating" options/options.js
grep -n 'id="ruleList"\|id="settingsSearch"' options/options.html
grep -n "applyPageTheme" shared/settings-utils.js   # → 无输出（悬空）
grep -rn "applyPageTheme" --include="*.js" .         # → 5 处调用
grep -n "lint-ratchet" .github/workflows/ci.yml      # → 无输出
```

## C. 一句话结论

> **这个项目不缺工程能力，缺的是"护栏的真实性"。** 把 v14.3.0 已有的护栏逐条验证为"真的能拦住"，比再拆十个文件、再加十个功能更有价值。

---

*报告生成：2026-10-08 · 审查基线 v14.3.0 · 所有 P0/P1 结论均经源码人工核验*
