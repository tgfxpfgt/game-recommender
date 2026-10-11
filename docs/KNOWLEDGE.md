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
  ├─ 3. Steam 动态缓存命中检查（detail/rating 模块 TTL + namesRelated 校验）
  │     └─ Demo 版无评测 → 自愈重搜
  ├─ 4. searchSteamAppId(parseGameTitle(gameName), gameName, excludeAppId)
  │     ├─ searchSteamAppIdOnce(): storesearch?l=schinese 逐词检索
  │     │   ├─ nameMatchesSearch() 相关性校验（防噪声/删词变体/续作误配）
  │     │   └─ matchCandidateScore() 多候选打分排序
  │     ├─ 扩展搜索：删词变体 + 噪声词自学习（generateSearchVariants）
  │     └─ ★ v14.3.1：rawTitle 透传 → 中文空时英文兜底（l=english）
  ├─ 5. webSearchFallback(gameName)            ← Bing 检索兜底
  ├─ 6. llmMatchGame(gameName)                 ← LLM 兜底（用户配置时）
  └─ 7. 三层缓存写入：Steam 动态缓存 + 游戏注册表 + 名称索引
```

### 关键决策点

| 决策 | 逻辑 | 位置 |
|---|---|---|
| Demo 自愈 | 缓存命中 Demo 且无评测 → 忽略缓存重搜 | orchestrator-shared.js |
| appId 类型校验 | DLC → 解析 fullgame 本体；bundle → 返回 type 标记 | orchestrator-list.js |
| 0 评测验证 | positiveRate=null → 重试计数 +1（上限 3）→ 冷却期不重复请求 | orchestrator-list.js |
| 负缓存 | 搜索未命中 → name-index 记 null；网络故障期跳过（防固化） | orchestrator-detail.js |
| 熔断 | 连续 5 次网络失败 → 60s 熔断；半开探测通过后闭合 | api-monitor.js |
| 交叉验证 | 中文命中名 EN 词交集与 raw 英文段 = 0 → 英文重搜 l=english | orchestrator-detail.js v14.3.1 |

---

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

| 表 | 位置 | 派生 |
|---|---|---|
| STORAGE_MODULES | data/storage-registry.js | MODULE_FILES / DATA_MODULES / 备份子集 / 清除范围 |
| module-manifest | content/module-manifest.js | tracker 装载 / content-sim 文件表 / integrity 校验 |
| fm-keys | shared/fm-keys.js | 浮窗模块键序（5 消费方派生） |
| spy-scales | shared/spy-scales.js | SteamSpy 信号刻度（engine + content 共用） |
| SITE_SCRIPT_FILES | background/core/site-scripts.js | manifest js 清单（integrity 深度相等断言） |
| STORAGE_CAPS | background/core/constants.js | 各容量上限（favorites/tabGames/itadPriceCache 等） |
| ENDPOINTS | background/core/constants.js | 出站端点 URL |
| TTL_FIELDS | options 壳 | 缓存有效期控件映射 |
