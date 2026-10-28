# 游戏雷达 Game Radar — 工作逻辑知识库

> 本文档是扩展的**功能层知识库**——描述各子系统的工作逻辑、数据流向、
> 关键决策点。与 AGENTS.md（编码规则）互补：AGENTS.md 管"怎么写代码"，
> 本文管"扩展是怎么工作的"。
> 更新：功能批次合并后同步（neat-freak 纪律）。

---

## 1. 匹配管线（下载站游戏 → Steam AppID）

```
页面标题 (document.title)
  │ cleanPageTitle() 剥离 "|汉化中文|支持手柄|" 等噪声段
  ▼
gameName (清洗后中文标题)
  │
  ├─[详情页]─→ extractSteamAppIdFromImages(mainEl) ← 封面图 URL 里的 appId
  │              │ 命中 → GET_STEAM_BY_APPID (直接获取，跳过搜索)
  │              │ 未命中 ↓
  ├─[列表页]─→ SEARCH_STEAM / GET_STEAM_RATINGS
  │              │
  ▼              ▼
orchestrator-detail.js searchSteamGame()     ← 详情页全流程
orchestrator-list.js getSteamPositiveRate()  ← 列表页轻量查询
  │
  ├─ 1. lookupAppIdByName(gameName)          ← 名称索引（本地字典，零网络）
  ├─ 2. lookupWrongReportCorrection(gameName) ← 人工纠错知识库优先
  ├─ 2.5 matchAppListExact(gameName)          ← ★ 全量目录离线索引（v14.6，调研
  │     建议 1）：归一化精确命中直接作为检索结果——下架游戏 storesearch 搜不到
  │     （结构性盲区）由目录覆盖 + 命中免网络往返；数据源 jsnli 每日镜像（免
  │     key）→ IStoreService+steamApiKey（备源），双失败熔断式降级回在线
  ├─ 3. Steam 动态缓存命中检查（detail/rating 模块 TTL + namesRelated 校验）
  │     └─ Demo 版无评测 → 自愈重搜
  ├─ 4. searchSteamAppId(parseGameTitle(gameName), gameName, excludeAppId)
  │     ├─ searchSteamAppIdOnce(): storesearch?l=schinese 逐词检索
  │     │   ├─ nameMatchesSearch() 相关性校验（防噪声/删词变体/续作误配）
  │     │   └─ matchCandidateScore() 多候选打分排序
  │     ├─ 扩展搜索：删词变体 + 噪声词自学习（generateSearchVariants）
  │     └─ ★ v14.3.1：rawTitle 透传 → 中文空时英文兜底（l=english）
  │     └─ ★ v14.6：英文未命中 → searchCommunityApps（steamcommunity
  │        SearchApps 免 key 仅英文，同一相关性校验 + store 域熔断）
  ├─ 5. webSearchFallback(gameName)            ← Bing 检索兜底
  ├─ 6. llmMatchGame(gameName)                 ← LLM 兜底（用户配置时）
  └─ 7. 三层缓存写入：Steam 动态缓存 + 游戏注册表 + 名称索引
```

### 关键决策点

| 决策           | 逻辑                                                          | 位置                           |
| -------------- | ------------------------------------------------------------- | ------------------------------ |
| Demo 自愈      | 缓存命中 Demo 且无评测 → 忽略缓存重搜                         | orchestrator-shared.js         |
| appId 类型校验 | DLC → 解析 fullgame 本体；bundle → 返回 type 标记             | orchestrator-list.js           |
| 0 评测验证     | positiveRate=null → 重试计数 +1（上限 3）→ 冷却期不重复请求   | orchestrator-list.js           |
| 负缓存         | 搜索未命中 → name-index 记 null；网络故障期跳过（防固化）     | orchestrator-detail.js         |
| 熔断           | 连续 5 次网络失败 → 60s 熔断；半开探测通过后闭合              | api-monitor.js                 |
| 交叉验证       | 中文命中名 EN 词交集与 raw 英文段 = 0 → 英文重搜 l=english    | orchestrator-detail.js v14.3.1 |
| 目录层降级     | dump/IStoreService 双失败 → 本 SW 生命周期回退纯在线管线      | app-list-index.js v14.6        |
| 目录刷新节流   | miss/过期触发后台刷新，每 SW 生命周期至多一次（防 miss 风暴） | app-list-index.js v14.6        |

---

## 1.5 检索规则词表（R1/R2，v14.6.3/v14.7）

- **单源**：`shared/retrieval-vocab.js`——保序词条数据（`w`=字面词转义 /
  `re`=正则片段 / `b`= 边界）+ validateRetrievalVocab + 惰性编译单例。
  消费端全部"用时取用"（title-parser noisePatternOf()/api-search 活绑定
  ADDON_NAME_PATTERN）——词表热更经 invalidateRetrievalRulesCache 立即生效。
- **保序语义**：重叠词先长后短决定删除范围（Switch520.com 先于 Switch520），
  golden 测试（test-retrieval-vocab）逐字节钉死编译源与 R1 前字面量等价；
  错题库（mismatch-samples 回放）是词表变更的验收门。
- **R2 通道**：`retrievalVocabOverride`（STORAGE_MODULES，clearOnDataReset）
  → 启动装载（steam/retrieval-override.js）→ applyVocabOverride 键级合并
  （内置在前追加不重排）→ 校验失败保持内置（回退）。**显式非法整包拒绝**
  （静默 no-op 会以 applied=true 掩盖损坏规则包）。内容侧滞后至下次扩展
  更新（不拉取）。

## 2. 双波好评率推送（列表页）

```
页面加载 → tracker.js 顶层装载
  │ 模块清单 module-manifest.js → 动态 import(getURL(...))
  ▼
list-page.js → startRatingJob()
  │ 提取列表项 → 生成 uniqueNames
  ├─ 第一波：GET_STEAM_RATINGS → ratings-batch.js
  │            → getSteamRatingsFromCacheOnly()  ← 零网络（纯缓存命中）
  │            → 立即推送 STEAM_RATINGS_UPDATE（缓存命中的徽章即时显示）
  ├─ 第二波：getSteamPositiveRate()              ← 缓存未命中项
  │            → 逐批调度（ratingsBatchSize，默认 60）
  │            → 完成后推送 STEAM_RATINGS_UPDATE（徽章延迟显示）
  ▼
list-batch.js applyRatingsResponse()
  │ prependBadge(item, rating, settings) → DOM 注入
  │ ratingFilterPass() → 好评率过滤（总/30天/与或非/hybrid）
  │ sortItemsByRating() → 好评率降序重排
  ▼
finishRatings() → 统计汇总 → 状态浮窗
```

---

## 3. 详情页浮窗生命周期

```
tracker.js injectSteamButton()
  │ 检测详情页 → sidebar.createSteamFloat(gameName, settings)
  ▼
sidebar.js（编排壳）
  │ float.create(ZONE.TOP_LEFT, 'gr-steam-float', {...})
  │ 自动加载：图片 appId 直取 → SEARCH_STEAM → 候选面板兜底
  │ renderAndShow(data, cachedAt, name)
  │   ├─ renderSteamSidebar() → detail-templates.steamSidebar()
  │   │   ├─ 浮窗模块顺序 fm-keys.js 单源
  │   │   ├─ 按钮绑定（刷新/报错）
  │   │   └─ renderInlineSteamSection() ← inline-card.js（XDGame 同款内嵌卡）
  │   ├─ sidebar-rows.js fillSteam250Info() + fillItadAndFavorites()
  │   └─ tracking.trackSteamTagsUpdate()
  ▼
candidates.js renderManualSelectPanel()  ← 搜索未命中时的手动选择兜底
tracking.js 下载面板 + 行为采集
```

---

## 4. 存储模型

```
chrome.storage.local
  ├── settings          ← DEFAULT_SETTINGS (constants.js) + deepMerge 用户覆盖
  ├── xdgridSettings    ← 列表布局定制（按站点）
  ├── grListSort:<host> ← 排序模式
  ├── grFilterPresets:<host> ← 过滤命名预设
  └── grFloatPos:<id>   ← 浮窗拖拽位置

OPFS (data/data-store.js 经 STORAGE_MODULES 注册表)
  ├── behaviorLog       ← 行为日志（NDJSON 追加）
  ├── gameProfiles      ← 游戏画像（关键词权重）
  ├── steamCache/       ← Steam 动态缓存 4 分文件（meta/rating/detail/spy）
  │                        rating 模块 NDJSON 追加 + compaction
  ├── gameRegistry      ← 游戏注册表（中英文名/标签/封面，永久）
  ├── nameIndex         ← 名称索引（gameName → appId，含负缓存）
  ├── urlIndex          ← 下载站网址 → appId 映射
  ├── downloadUrls      ← 下载站详情页地址缓存
  ├── favorites         ← 收藏清单
  ├── freeGames         ← 限免数据
  └── learnedNoise      ← 自学习噪声词

chrome.storage.session
  ├── grApiMonitor      ← API 限流统计滑动窗口
  ├── grApiCounters     ← 会话累计计数器
  ├── grTabGames        ← SidePanel per-tab 游戏快照
  └── grLastNotifyGames ← 最近限免通知内容
```

---

## 5. 消息契约（background ↔ 页面）

- 所有 action 在 `message-contract.js` RULES 表登记（fail-closed：未登记即拒绝）
- 内容侧 action 白名单 `CONTENT_ALLOWED_ACTIONS`（sender 门禁）
- 特权写（SAVE_SETTINGS/RESET_SETTINGS/CLEAR_DATA/IMPORT_DATA）不对 web 源开放
- 领域 handler 文件：`handlers/steam.js` / `handlers/stats.js` / ... 经 `handlers.js` 聚合

---

## 6. 单源表（改一处生效全局）

| 表                | 位置                            | 派生                                               |
| ----------------- | ------------------------------- | -------------------------------------------------- |
| STORAGE_MODULES   | data/storage-registry.js        | MODULE_FILES / DATA_MODULES / 备份子集 / 清除范围  |
| module-manifest   | content/module-manifest.js      | tracker 装载 / content-sim 文件表 / integrity 校验 |
| fm-keys           | shared/fm-keys.js               | 浮窗模块键序（5 消费方派生）                       |
| spy-scales        | shared/spy-scales.js            | SteamSpy 信号刻度（engine + content 共用）         |
| SITE_SCRIPT_FILES | background/core/site-scripts.js | manifest js 清单（integrity 深度相等断言）         |
| STORAGE_CAPS      | background/core/constants.js    | 各容量上限（favorites/tabGames/itadPriceCache 等） |
| ENDPOINTS         | background/core/constants.js    | 出站端点 URL                                       |
| TTL_FIELDS        | options 壳                      | 缓存有效期控件映射                                 |

---

## 7. 主题系统（v14.3.2 拆分后）

```
settings.uiTheme
  │ shared/settings-utils.js
  ├─ applyPageTheme(settings)   ← 统一入口（v10.7.0 计划、v14.3.2 落地）：
  │    applyThemeAuto(settings)   定时窗口解析 + applyTheme + 自定义 CSS
  ├─ applyTheme(name)
  │    ├─ body.dataset.theme = name
  │    └─ <link id="gr-theme-file"> 按需注入 styles/themes/<name>.css
  │       （重复切换复用同一元素换 href；'steam' = ui-theme.css :root 默认，
  │        移除 link 即回默认）
  └─ 内容侧独立：content.css 自带 .gr-float[data-theme] 浅色覆盖块，
     不依赖 styles/themes/（web 页无法加载扩展 CSS，无 WAR 诉求）
```

- 文件布局：`styles/themes/<name>.css` ×19（每文件 = 变量块 + 组件级覆盖）；
  steam 默认在 ui-theme.css :root，无独立文件。
- 实时跟随：后台 `saveSettings`（core/settings.js 单点写入）广播
  `GR_SETTINGS_CHANGED`（runtime 消息只达扩展页、不达内容脚本）；
  sidepanel.js 监听后重拉设置并 applyPageTheme——设置中心切主题，
  已打开的 SidePanel 即时变色。
- 完整性守护：test-integrity-security 节 14 四重断言——①文件集合 ↔
  settings-utils VALID_THEMES 全等；②每主题变量块 ⊇ 核心键（:root 减
  可选键）；③仅部分主题定义的键必须在可选白名单（--gr-control-h 紧凑
  终端系 / --gr-font 等宽衬线主题，有意按主题覆盖）；④文件内 data-theme
  选择器与文件名一致（拆分归属漂移防御）。
- 历史：v14.3.0 的旧断言因 `([, body])` 解构笔误取到主题名而非块体，
  从未实际生效（空转通过）；另发现 dashboard/freegames/hub/sidepanel
  四页调用 applyPageTheme 而工具文件从未实现（守卫静默降级），均 v14.3.2
  修复。

---

## 8. 并发模型与锁策略（v14.5.0 B5/B8 盘点）

```
锁面（withLock 工厂单点串行，core/mechanisms.js）：
  download-urls / history / app-stats / behavior-profiles / logger-flush
数据层写队列：dataStore._serialize（按模块键串行——并发写同一文件不互覆）

flushAllCaches（storage/flush.js 聚合落盘）：
  steam-cache → name-index → registry → url-index → wrong-reports
  → learned-noise → app-stats → profiles(B5) → logBuffer
  逐模块 await 串行获取/释放——同一时刻至多持有一把锁，无嵌套持有
  → 无死锁面（B5 压力测试锁住：3 tab × flushAllCaches + 并发写入，
  5s 死锁 canary，tests/unit/test-flush-concurrency.mjs）

写合并（createDebouncedStore 2s 防抖单点，B5 前已有四模块、B5 补画像）：
  registry / name-index / url-index / app-stats / gameProfiles(B5)
  纪律：写失败回滚 dirty 重试（铁律 6）；flushAllCaches 强制落盘纳管；
  reset 必须取消挂起写（防"清空被撤销"）
```

---

## 9. 性能基线（v14.5.0 第六轮实测）

| 维度      | 现状                                                                                                                      | 度量位置                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| SW 冷启动 | 静态图 77 文件 / ~11.5k 行（MV3 SW 禁动态 import，无懒加载手段）                                                          | Perf 日志 `SW 模块图就绪 Xms`（timeOrigin→入口顶层 ≈ 消息可用时刻） |
| OPFS 写   | 计数器模式（metricInc + session-persist 防抖）+ 5 模块 2s 防抖合并                                                        | dashboard 运行指标卡（opfs.writeCount/writeBytes）                  |
| 消息管道  | TRACK_EVENT_BATCH（500ms/10 条，10→1）+ GET_STEAM_RATINGS 批量（settings.ratingsBatchSize，B9 接线）+ click_download 即时 | metrics 消息计数器                                                  |
| 状态渲染  | showStats 100ms 合并（B9，列表流程 ×N→×1）                                                                                | —                                                                   |
| 内容装载  | 12 核心 + 2 可选（setting 键门控）+ 详情页专属 sidebar-rows/inline-card 按需（B3，列表页 -2 请求）                        | e2e-probe 模块网络加载                                              |

**JS 特性基线（minimum_chrome_version 109 决定白名单，v14.5.1 审计）**：
✓ 可用——`structuredClone`(98)/`Object.hasOwn`(93)/`Array.prototype.at`(92)/
`includes`(53)/`AbortSignal.timeout`(103)/`:has()` CSS(105)/`Promise.allSettled`(76)；
✗ 排除——`Object.groupBy`(117)/`toSorted`(110)/`scheduler.yield`(129)/
`Promise.withResolvers`(119)/`Array.fromAsync`(121)。
**有意保留的"旧"写法**：fetchWithTimeout 手工 AbortController+clearTimeout
（clearTimeout 保证响应体读取不受超时影响——AbortSignal.timeout 会在超时后
中断慢速体读取，语义必需）；SW 内 setTimeout（分层预热按"SW 短命即跳过"
设计，alarm 不适用）；列表徽章同步插入（波次分批已界定每帧工作量，rAF
批处理会破坏 sim/E2E 的同步渲染契约）。

---

## 10. 消息路由（v14.5.0 B7）

```
tracker.js（装载器：boot + 薄监听排队）
  │ boot 完成 → M.messages.createMessageRouter 接线 + 冲放排队消息
  ▼
core/messages.js（四类入站：REFRESH_RECOMMENDATIONS / SHOW_LAST_STATS /
  STEAM_RATINGS_UPDATE / FORCE_REFRESH_PAGE）
  推送类就绪快路径同步应用（B8 修复：微任务延迟会让批次收尾抢先终止
  job，迟到推送被 ratingsJob 空值守卫静默丢弃）
core/page-init.js（页面类型检测 + 各域功能分派，B7 自 tracker init 迁出）
```

纪律：新增入站消息 = core/messages.js 路由分支 + message-contract RULES +
background handler 三处同步；推送类必须走就绪快路径（同步应用）。
