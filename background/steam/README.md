# Steam 域模块地图 / Steam Domain Module Map

> v14.3.0（第五轮 B7）：域内 13 文件 2,700+ 行的职责地图。规则：**handler 薄、
> 业务厚**——handlers/steam.js 只做消息进出与参数规范化，检索/缓存/自愈逻辑
> 全部住在本域。分层：biz 层（可依赖 storage/core，不可被 core 反向依赖）。

## 检索管线（两入口）

| 文件 | 职责 | 消费方 |
|---|---|---|
| `orchestrator.js`（壳 15 行） | re-export 装配，消费面兼容 | handlers/steam.js · ratings-batch.js |
| `orchestrator-detail.js`（177） | **详情页管线** searchSteamGame：名称索引 → 纠错知识库 → 动态缓存（Demo 自愈）→ 兜底搜索（Bing/LLM）→ 完整详情 → 三层缓存写入 | orchestrator.js |
| `orchestrator-list.js`（305） | **列表页管线** getSteamRatingsFromCacheOnly（第一波零网络）+ getSteamPositiveRate（类型校验→评价获取→0 评测重搜→三层缓存写入） | orchestrator.js · ratings-batch.js |
| `orchestrator-shared.js`（61） | Demo 缓存判定 + 统一缓存命中返回（幂等补注册表 + 自愈 + 三段式字段） | detail/list 两管线 |

## API 原子层（api.js barrel 再导出，按职能分文件）

| 文件 | 职责 |
|---|---|
| `api-search.js`（491） | storesearch 检索：标题变体、候选打分（matchCandidateScore）、相关性校验（nameMatchesSearch 系）、Demo/附属识别、扩展组合搜索（噪声词自学习） |
| `api-details.js`（222） | appdetails：完整详情/按需语言详情、本体解析（baseAppIdFromDetails）、商店页 HTML 抓取、中文支持/用户标签解析 |
| `api-reviews.js`(298) | appreviews：好评率（总/近 30 天/简中）、最近更新日期（4s 硬帽）、缓存完整性判定（isCompleteCacheData/needsRatingRefetch） |
| `api-supplement.js` | 补充获取（封面提取 appId、isDemoAppId 等） |
| `api-assemble.js` | 详情装配（fetchSteamFullDetailsByAppId 多源合并） |
| `api-registry-heal.js` | 注册表名称自愈（批量扫描修复，退避缓存） |
| `api.js`（15 行 barrel） | `export *` 装配入口——消费方一律 `from './api.js'` |

## 支撑层

| 文件 | 职责 |
|---|---|
| `ratings-batch.js`（369） | 列表页批量好评率任务（GET_STEAM_RATINGS/PREFETCH）：分批调度、断点续跑（session 检查点）、双波推送 |
| `ai-fallback.js`（237） | 匹配兜底：Bing 检索（ENDPOINTS.bingSearch）→ LLM 结构化匹配（防幻觉：均经官方数据校验） |
| `steam250.js` | Steam250 榜单快照（24h）+ 解析纯函数 |
| `title-parser.js` | 下载站标题解析（parseGameTitle 变体生成/噪声词）、pickRegistryEnName |

## 边界规则

1. **新增检索逻辑先进 api-* 原子层**（可单测），编排决策进 orchestrator-*；禁止把
   fetch 细节写进管线文件
2. handlers/steam.js 出现 >20 行业务逻辑即为下沉信号
3. 本域禁 import `../handlers/`、`../recommend/`、`../freegames/`（integrity 矩阵强制）
