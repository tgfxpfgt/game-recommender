# 模块索引 / Module Index

> **自动生成，勿手改**——`node scripts/gen-module-index.mjs` 重写，
> `npm run check:modules` 校验漂移（门禁内）。
> 五列：模块 / 职责 / 依赖 / 导出 / **不变式**。不变式 = 改动前必须知道、
> 但从代码里看不出来的约束（顺序依赖、并发假设、幂等要求、单位约定）；
> 无则 `—`。新增不变式在模块文件头写 `@invariant …`。
> 模块数 180，其中声明不变式 4。

## adapters/default.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `adapters/default.js` | 基础共用适配规则 | — | — | — |

## adapters/index.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `adapters/index.js` | 适配规则聚合入口 | — | — | — |

## adapters/sites

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `adapters/sites/3dmgame.js` | 3DM 下载站规则 | — | — | — |
| `adapters/sites/ali213.js` | 游侠网 下载站规则 | — | — | — |
| `adapters/sites/gamer520.js` | Gamer520 下载站规则 | — | — | — |
| `adapters/sites/gamersky.js` | 游民星空 下载站规则 | — | — | — |
| `adapters/sites/xdgame.js` | XDGame 下载站规则 | — | — | — |
| `adapters/sites/xianyudanji.js` | 咸鱼单机 下载站规则 | — | — | — |

## background/core

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `background/core/api-monitor.js` | Steam API 状态监测 | `background/core/session-persist` | warmupApiMonitor<br>recordSteamCall<br>getSteamApiStatus<br>isCircuitOpen<br>circuitState<br>recordDomainCall<br>…+3 | — |
| `background/core/constants.js` | 常量与配置 | `data/storage-registry`<br>`shared/fm-keys`<br>`shared/spy-scales` | DB_KEYS<br>PERF_CONFIG<br>STORAGE_CAPS<br>ENDPOINTS<br>DEFAULT_SETTINGS<br>LOG_LEVELS<br>…+21 | — |
| `background/core/early-message-router.js` | 早期消息路由 | — | attachEarlyMessageRouter | — |
| `background/core/llm-client.js` | LLM 调用单源（v14.12 B6，报告 B P2-08） | `background/core/utils` | assertRemoteLlmEndpoint<br>callLlm | — |
| `background/core/mechanisms.js` | 通用机制工厂 | — | withLock<br>withWatchdog<br>debounce<br>createTtlCache<br>withRetry<br>evictOldestByTs | withLock 返回的锁禁止嵌套持有（同一锁链内再取锁 = 自死锁）；同一时刻至多持有一把锁<br>时钟可注入（纯工厂）——模块不得直接 import Logger/Date.now 之外的运行环境依赖，告警出口由调用方注入 |
| `background/core/message-contract.js` | 消息契约校验 | `background/core/utils` | getRules<br>validateMessage<br>CONTENT_ALLOWED_ACTIONS<br>isTrustedSender | — |
| `background/core/metrics.js` | 运行指标 | `background/core/session-persist` | warmupMetrics<br>metricInc<br>metricObserve<br>metricsSnapshot<br>trackOpfsWrite<br>resetMetrics | — |
| `background/core/outbound-audit.js` | 出站请求审计与限速 | `background/core/session-persist` | AUDIT_MAX<br>RATE_WINDOW_MS<br>RATE_MAX<br>warmupOutboundAudit<br>recordOutbound<br>getOutboundAudit<br>…+2 | — |
| `background/core/rules.js` | 适配规则读取 | `background/core/constants`<br>`background/core/utils`<br>`data/data-store` | getSiteRules<br>getDownloadSites<br>resetRulesCache<br>isValidSiteDomain<br>hasReDoSRisk<br>validateAdapterRules<br>…+9 | — |
| `background/core/sanitize.js` | 设置密钥净化（v14.11 B3，报告 B/C P1-03） | — | stripSecrets<br>sanitizeUrlText<br>sanitizeLogData | — |
| `background/core/session-persist.js` | storage.session 持久化辅助 | `background/core/mechanisms` | createSessionPersist | — |
| `background/core/settings.js` | 设置管理 | `background/core/constants`<br>`background/core/utils`<br>`data/data-store` | deepMergeSettings<br>initStorage<br>getSettings<br>clampNumericSettings<br>saveSettings<br>saveRatingFilterCfg<br>…+1 | — |
| `background/core/site-scripts.js` | 自定义站点内容脚本动态注册 | `background/core/rules` | BUILTIN_DOMAINS<br>SITE_SCRIPT_FILES<br>syncSiteScripts | — |
| `background/core/tab-game.js` | 当前标签页游戏快照 | `background/core/constants`<br>`background/core/session-persist` | warmupTabGames<br>noteTabGame<br>getTabGame | — |
| `background/core/title-parser.js` | 游戏标题解析 | `shared/retrieval-vocab` | parseGameTitle<br>cleanGameName<br>pickRegistryEnName<br>generateSearchVariants<br>extractNoiseCandidates | — |
| `background/core/trends.js` | 行为趋势聚合 | — | aggregateDailyTrends<br>aggregateTrends<br>aggregateFeedback | — |
| `background/core/types.js` | 核心类型定义 | — | — | — |
| `background/core/utils.js` | 通用工具 | `background/core/constants`<br>`background/core/outbound-audit` | isPlainObject<br>hasChineseChars<br>hasLatinLetters<br>isSafeFetchUrl<br>fetchWithTimeout<br>regexMatch<br>…+1 | — |

## background/freegames

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `background/freegames/fetch.js` | 限免抓取域 | `background/core/constants`<br>`background/core/mechanisms`<br>`background/core/utils`<br>`background/storage/logger` | ONE_DAY<br>classifyGamerPowerGiveaway<br>classifyFreeType<br>extractThirdPartySource<br>fetchAllFreeGames<br>determineSteamFreeType | — |
| `background/freegames/itad.js` | ITAD 价格域 | `background/core/constants`<br>`background/core/mechanisms`<br>`background/core/settings`<br>`background/core/utils`<br>`background/freegames/notify`<br>`background/storage/favorites`<br>`background/storage/logger` | buildItadRequest<br>itadFetch<br>checkItadFree<br>getItadLowest<br>watchFavoritePrices<br>getFavoritePrices | — |
| `background/freegames/manager.js` | 限免游戏管理（编排壳）/ Free Games Manager (orchestrator) | `background/core/constants`<br>`background/core/settings`<br>`background/freegames/fetch`<br>`background/freegames/itad`<br>`background/freegames/notify`<br>`background/storage/logger`<br>`data/data-store` | refreshFreeGames<br>getFreeGameMissStats<br>getFreeGamesData<br>getLastNotifyGames<br>claimFreeGame<br>getItadLowest<br>…+6 | — |
| `background/freegames/notify.js` | 限免通知域 | `background/core/constants`<br>`background/core/settings`<br>`background/freegames/fetch`<br>`background/freegames/itad`<br>`background/storage/favorites`<br>`background/storage/logger`<br>`background/storage/notifications`<br>`data/data-store` | getLastNotifyGames<br>notifyBase<br>notifyNewFreeGames<br>updateFreeGamesBadge<br>claimFreeGame | — |

## background/handlers

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `background/handlers/adapter-rules.js` | 消息处理：适配器规则 | `background/core/constants`<br>`background/core/rules`<br>`background/core/site-scripts`<br>`background/core/title-parser`<br>`background/steam/api-search`<br>`background/storage/logger`<br>`data/data-store`<br>`shared/retrieval-vocab` | adapterRulesHandlers | — |
| `background/handlers/cache-manager.js` | @type {any} | `background/core/constants`<br>`background/core/mechanisms`<br>`background/core/rules`<br>`background/core/settings`<br>`background/recommend/engine`<br>`background/sites/search`<br>`background/steam/api`<br>`background/steam/orchestrator-shared`<br>…+12 | handleCleanExpiredCache<br>handleGetGameCacheList<br>handleDeleteGameCacheEntry<br>handleClearGameCache<br>handleRefreshGameCacheEntry<br>cacheManagerHandlers | — |
| `background/handlers/data-modules.js` | @type {any} | `background/core/constants`<br>`background/core/rules`<br>`background/core/sanitize`<br>`background/steam/steam250`<br>`background/storage/backups`<br>`background/storage/logger`<br>`background/storage/reset`<br>`data/data-store`<br>…+1 | handleClearData<br>countModuleItems<br>handleGetDataModules<br>handleExportData<br>handleImportData<br>handleCreateBackup<br>…+4 | — |
| `background/handlers/diag-status.js` | 消息处理：诊断与状态 | `background/core/api-monitor`<br>`background/core/metrics`<br>`background/core/outbound-audit`<br>`background/core/session-persist`<br>`background/steam/mismatch-samples`<br>`background/steam/series`<br>`background/steam/steam250`<br>`background/storage/flush-health`<br>…+3 | handleGetApiStatus<br>handleGetSteam250Rank<br>warmupSiteAlertPersist<br>handleSiteAdapterAlert<br>handleGetSiteHealth<br>handleGetStorageHealth<br>…+6 | — |
| `background/handlers/download-sites.js` | 消息处理：下载站 | `background/core/rules`<br>`background/core/settings`<br>`background/core/utils`<br>`background/sites/search`<br>`background/storage/app-stats`<br>`background/storage/download-urls`<br>`background/storage/history`<br>`background/storage/logger`<br>…+2 | handleSearchDownloadSites<br>handleGetDownloadHistory<br>handleTrackDownloadSiteVisit<br>handleRecordDownloadUrlsBatch<br>downloadSitesHandlers | — |
| `background/handlers/favorites.js` | 消息处理：收藏 | `background/freegames/itad`<br>`background/freegames/manager`<br>`background/storage/favorites` | favoritesHandlers | — |
| `background/handlers/freegames.js` | 消息处理：限免与 ITAD | `background/freegames/manager` | freegamesHandlers | — |
| `background/handlers/image-fetch.js` | 消息处理：图片代取 | `background/core/constants`<br>`background/core/settings`<br>`background/core/utils`<br>`shared/msg` | handleFetchImageDataUrl<br>imageFetchHandlers | — |
| `background/handlers/logs.js` | 消息处理：运行日志 | `background/core/api-monitor`<br>`background/core/metrics`<br>`background/core/outbound-audit`<br>`background/core/sanitize`<br>`background/core/settings`<br>`background/storage/flush-health`<br>`background/storage/logger`<br>`background/storage/notifications`<br>…+1 | logsHandlers | — |
| `background/handlers/recommend.js` | 消息处理：内置推荐 | `background/core/settings`<br>`background/recommend/engine`<br>`background/storage/app-stats`<br>`background/storage/behavior`<br>`background/storage/logger` | recommendHandlers | — |
| `background/handlers/settings.js` | 消息处理：设置 | `background/core/constants`<br>`background/core/settings` | settingsHandlers | — |
| `background/handlers/stats.js` | @type {any} | `background/core/constants`<br>`background/core/trends`<br>`background/steam/api-search`<br>`background/steam/steam250`<br>`background/storage/behavior`<br>`background/storage/favorites`<br>`background/storage/logger`<br>`background/storage/name-index`<br>…+4 | handleGetStats<br>handleGetTrends<br>handleGetSteamRecommendations<br>searchCachedGames<br>statsHandlers | — |
| `background/handlers/steam.js` | 消息处理：Steam 查询 | `background/core/api-monitor`<br>`background/core/constants`<br>`background/core/tab-game`<br>`background/core/title-parser`<br>`background/steam/api`<br>`background/steam/api-metacritic`<br>`background/steam/mismatch-samples`<br>`background/steam/orchestrator`<br>…+13 | handleSearchSteam<br>handleRefreshSteamCache<br>handleGetSteamByAppId<br>handleSaveManualMapping<br>handleSetManualPlatform<br>handleSearchSteamCandidates<br>…+6 | — |
| `background/handlers/track-event.js` | 消息处理：行为追踪 | `background/storage/app-stats`<br>`background/storage/behavior`<br>`background/storage/history`<br>`background/storage/logger` | handleTrackEvent<br>handleTrackEventBatch<br>trackEventHandlers | — |

## background/handlers.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `background/handlers.js` | 消息入口与分发聚合 | `background/core/message-contract`<br>`background/core/metrics`<br>`background/handlers/adapter-rules`<br>`background/handlers/cache-manager`<br>`background/handlers/data-modules`<br>`background/handlers/diag-status`<br>`background/handlers/download-sites`<br>`background/handlers/favorites`<br>…+9 | MESSAGE_HANDLERS<br>handleMessage | — |

## background/recommend

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `background/recommend/engine-signals.js` | 推荐信号纯函数 | `background/core/constants`<br>`background/core/title-parser` | calculateKeywordScore<br>findProfile<br>steamspyScores<br>appStatScores<br>computeGameScore | — |
| `background/recommend/engine.js` | 推荐算法引擎（编排壳）/ Recommendation Engine (shell) | `background/core/constants`<br>`background/core/llm-client`<br>`background/core/settings`<br>`background/recommend/engine-signals`<br>`background/storage/app-stats`<br>`background/storage/behavior`<br>`background/storage/llm-cache`<br>`background/storage/name-index`<br>…+2 | calculateRecommendation<br>calculateKeywordScore<br>findProfile<br>steamspyScores<br>appStatScores<br>computeGameScore | — |

## background/service-worker.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `background/service-worker.js` | Service Worker 入口 | `background/core/constants`<br>`background/core/early-message-router`<br>`background/core/metrics`<br>`background/core/settings`<br>`background/core/site-scripts`<br>`background/freegames/manager`<br>`background/handlers`<br>`background/handlers/stats`<br>…+6 | — | — |

## background/sites

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `background/sites/search.js` | 下载站搜索 | `background/core/rules`<br>`background/core/title-parser`<br>`background/core/utils`<br>`background/storage/download-urls`<br>`background/storage/logger`<br>`background/storage/search-cache` | calcLinkMatchScore<br>extractDetailMeta<br>searchDownloadSites | — |

## background/steam

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `background/steam/ai-fallback.js` | AI/LLM 匹配兜底 | `background/core/constants`<br>`background/core/llm-client`<br>`background/core/settings`<br>`background/core/utils`<br>`background/steam/api-details`<br>`background/steam/api-search`<br>`background/storage/llm-cache`<br>`background/storage/logger` | parseBingSearchAppIds<br>webSearchFallback<br>llmMatchGame<br>parseLlmMatchResponse | — |
| `background/steam/api-assemble.js` | Steam API 子模块：api-assemble.js | `background/core/constants`<br>`background/core/settings`<br>`background/steam/api-details`<br>`background/steam/api-reviews`<br>`background/steam/api-search`<br>`background/steam/api-supplement`<br>`background/storage/logger` | buildSteamResult<br>fetchSteamFullDetailsByAppId | — |
| `background/steam/api-community-reviews.js` | Steam 社区评论浏览页解析 | `background/core/api-monitor`<br>`background/core/constants`<br>`background/core/utils`<br>`background/storage/logger`<br>`background/storage/usage-evidence` | parseCommunityReviewsHtml<br>fetchCommunityChineseReviews<br>resetCommunityReviewsState | — |
| `background/steam/api-details.js` | Steam API 子模块：api-details.js | `background/core/api-monitor`<br>`background/core/constants`<br>`background/core/utils`<br>`background/steam/api-search`<br>`background/storage/logger` | validateSteamNames<br>baseAppIdFromDetails<br>coverImageFor<br>resetAppDetailsDedupForTest<br>fetchSteamAppDetails<br>fetchStorePageHtml<br>…+2 | — |
| `background/steam/api-metacritic.js` | Metacritic 评分源（v14.10.0，用户指令：非 PC 平台条目 | `background/core/constants`<br>`background/core/mechanisms`<br>`background/core/utils`<br>`background/storage/logger` | deriveMetacriticSlug<br>fetchMetacriticScore | — |
| `background/steam/api-registry-heal.js` | @type {Map<string, number>} | `background/core/utils`<br>`background/steam/api-details`<br>`background/steam/api-search`<br>`background/storage/logger`<br>`background/storage/registry` | isDemoAppId<br>ensureRegistryEntry<br>healRegistryNames<br>ensureValidRegistryNames<br>scanAndHealRegistry | — |
| `background/steam/api-reviews.js` | Steam API 子模块：api-reviews.js | `background/core/api-monitor`<br>`background/core/constants`<br>`background/core/mechanisms`<br>`background/core/utils`<br>`background/steam/api-community-reviews`<br>`background/storage/logger`<br>`background/storage/usage-evidence` | isFailedRatingEntry<br>hasInvertedReviewCounts<br>isCompleteCacheData<br>needsRatingRefetch<br>RECENT_REVIEW_WINDOW_SEC<br>summarizeRecentReviews<br>…+3 | — |
| `background/steam/api-search.js` | Steam API 子模块：api-search.js | `background/core/api-monitor`<br>`background/core/constants`<br>`background/core/utils`<br>`background/steam/api-details`<br>`background/steam/search-candidates`<br>`background/steam/search-fallback` | fetchSteamTagRecommendations<br>searchSteamAppId<br>findVersionVariant<br>ADDON_NAME_PATTERN<br>DEMO_NAME_PATTERN<br>reloadRetrievalRules<br>…+11 | — |
| `background/steam/api-supplement.js` | Steam API 子模块：api-supplement.js | `background/core/constants`<br>`background/core/utils`<br>`background/storage/logger` | fetchSteamSpyInfo | — |
| `background/steam/api.js` | Steam API 聚合入口 | `background/steam/api-assemble`<br>`background/steam/api-details`<br>`background/steam/api-registry-heal`<br>`background/steam/api-reviews`<br>`background/steam/api-search`<br>`background/steam/api-supplement` | — | — |
| `background/steam/app-list-index.js` | Steam 全量目录离线索引 | `background/core/constants`<br>`background/core/metrics`<br>`background/core/settings`<br>`background/core/utils`<br>`background/steam/api-search`<br>`background/storage/logger`<br>`data/data-store` | normalizeTitle<br>ensureAppListIndex<br>matchAppListExact<br>refreshAppListIndex | — |
| `background/steam/match-confidence.js` | 匹配置信度三态 | `background/steam/api-search`<br>`shared/platform-detect` | MATCH_CONFIRMED<br>MATCH_SUSPECTED<br>TITLE_SIMILARITY_THRESHOLD<br>MATCH_SOURCE_LABELS<br>yearOfDateString<br>extractTitleYear<br>…+5 | — |
| `background/steam/mismatch-samples.js` | 错题样本采集 | `background/core/constants`<br>`background/core/title-parser`<br>`background/core/utils`<br>`background/storage/logger`<br>`background/storage/usage-evidence`<br>`data/data-store` | getWrongReportSamples<br>clearWrongReportSamples<br>captureMismatchSample | — |
| `background/steam/orchestrator-detail.js` | 详情页搜索管线 | `background/core/api-monitor`<br>`background/core/constants`<br>`background/core/title-parser`<br>`background/steam/ai-fallback`<br>`background/steam/api`<br>`background/steam/app-list-index`<br>`background/steam/match-confidence`<br>`background/steam/mismatch-samples`<br>…+9 | searchSteamGame | — |
| `background/steam/orchestrator-list.js` | 列表页好评率管线 | `background/core/api-monitor`<br>`background/core/title-parser`<br>`background/core/utils`<br>`background/steam/api`<br>`background/steam/api-metacritic`<br>`background/steam/api-search`<br>`background/steam/app-list-index`<br>`background/steam/match-confidence`<br>…+8 | getSteamRatingsFromCacheOnly<br>getSteamPositiveRate | 第一波 getSteamRatingsFromCacheOnly 零网络，且返回非 null 即终态（第二波不会纠错）——故平台预检必须发生在第一波内部<br>console 条目第一波一律返回 null 交第二波 phasePlatform（Metacritic）；emulator 返回 platformOnly 终态<br>缓存写入以 appId 为键、可重复覆盖（幂等）——看门狗放弃后迟到的结果允许覆盖旧值 |
| `background/steam/orchestrator-shared.js` | Steam 编排共享件 | `background/steam/api`<br>`background/storage/logger` | isDemoCacheWithoutRating<br>NEW_RELEASE_WINDOW_DAYS<br>isNewReleaseDate<br>applyCacheHit<br>resolveDlcToBase<br>extractSteamAppIdSignals<br>…+2 | — |
| `background/steam/orchestrator.js` | Steam API 编排器（装配壳）/ Steam API Orchestrator (shell) | `background/steam/orchestrator-detail`<br>`background/steam/orchestrator-list`<br>`background/steam/orchestrator-shared` | searchSteamGame<br>getSteamRatingsFromCacheOnly<br>getSteamPositiveRate<br>isDemoCacheWithoutRating<br>applyCacheHit | — |
| `background/steam/ratings-batch.js` | 列表页批量好评率 | `background/core/api-monitor`<br>`background/core/constants`<br>`background/core/mechanisms`<br>`background/core/metrics`<br>`background/core/settings`<br>`background/steam/api`<br>`background/steam/orchestrator`<br>`background/storage/app-stats`<br>…+5 | handleGetSteamRatings<br>getRatingsQueueStatus<br>startRatingJob<br>resumeRatingsBatch<br>handlePrefetchSteamRatings | 全局 FIFO 单任务链：任一时刻至多一个评分任务在跑，新任务只入队不并行（并行会让限速窗口失败率翻倍）<br>STEAM_RATINGS_UPDATE 必须按任务创建时的 tabId 定向推送；tab 无接收端（关闭/导航）任务在开跑时即跳过<br>单条目硬阈值放弃后结果仍可能迟到——缓存写入必须幂等（按 appId 覆盖），任务收尾以 done 标记为唯一终态 |
| `background/steam/retrieval-override.js` | 检索词表覆盖装载 | `background/core/constants`<br>`background/steam/api-search`<br>`background/storage/logger`<br>`data/data-store`<br>`shared/retrieval-vocab` | ensureRetrievalVocabOverride<br>rollbackRetrievalVocab | — |
| `background/steam/search-candidates.js` | Steam 搜索候选生成 | `background/core/api-monitor`<br>`background/core/constants`<br>`background/core/utils`<br>`background/steam/search-consensus`<br>`shared/retrieval-vocab` | ADDON_NAME_PATTERN<br>DEMO_NAME_PATTERN<br>versionSuffixesOf<br>reloadRetrievalRules<br>namesRelated<br>digitSetsOverlap<br>…+9 | — |
| `background/steam/search-consensus.js` | Steam 搜索共识裁决 | — | CONSENSUS_BONUS_PER_TERM<br>CONSENSUS_MAX_TERMS<br>pickConsensusWinner | — |
| `background/steam/search-fallback.js` | Steam 搜索兜底链 | `background/core/api-monitor`<br>`background/core/constants`<br>`background/core/title-parser`<br>`background/core/utils`<br>`background/steam/search-candidates`<br>`background/storage/learned-noise`<br>`background/storage/logger` | searchExtendedFallback<br>searchCommunityApps | — |
| `background/steam/series.js` | 系列作品聚合 | `background/steam/api-search`<br>`background/storage/name-index` | getSeriesEntries | — |
| `background/steam/steam250.js` | Steam250 排名数据 | `background/core/constants`<br>`background/core/utils`<br>`background/storage/logger`<br>`data/data-store` | parseSteam250Html<br>getSteam250Status<br>getSteam250Info<br>resetSteam250 | — |

## background/storage

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `background/storage/app-stats.js` | AppID 维度行为统计 | `background/core/constants`<br>`background/core/mechanisms`<br>`background/core/settings`<br>`background/storage/behavior`<br>`background/storage/debounced-store`<br>`data/data-store` | flushAppStats<br>recordAppDownload<br>recordAppDetailView<br>getAppStats<br>resetAppStats | — |
| `background/storage/backups.js` | 备份管理 | `background/core/constants`<br>`background/core/rules`<br>`background/core/sanitize`<br>`background/core/settings`<br>`background/storage/logger`<br>`background/storage/reset`<br>`data/data-store`<br>`data/storage-registry` | createBackup<br>getBackupList<br>restoreBackup<br>restoreLatestIfFresh<br>deleteBackup | — |
| `background/storage/behavior.js` | 行为日志 | `background/core/constants`<br>`background/core/mechanisms`<br>`background/core/settings`<br>`background/storage/debounced-store`<br>`data/data-store` | getDataVersion<br>bumpDataVersion<br>addBehaviorLog<br>getBehaviorLog<br>readProfiles<br>readKeywordWeights<br>…+6 | — |
| `background/storage/cleanup.js` | 缓存过期清理 | `background/core/constants`<br>`background/storage/steam-cache` | collectExpiredSteamCache<br>collectExpiredNegativeNames<br>collectExpiredDownloadUrls | — |
| `background/storage/debounced-store.js` | 防抖写入工厂 | `background/core/mechanisms` | createDebouncedStore | — |
| `background/storage/download-urls.js` | 下载站网址缓存 | `background/core/constants`<br>`background/core/mechanisms`<br>`background/core/utils`<br>`data/data-store` | readDownloadUrlsStore<br>warmupDownloadUrls<br>resetDownloadUrlsMemory<br>getDownloadUrls<br>recordDownloadUrl<br>recordDownloadUrlsBatch | — |
| `background/storage/favorites.js` | 收藏/关注清单 | `background/core/constants`<br>`background/core/mechanisms`<br>`data/data-store` | getFavorites<br>toggleFavorite | — |
| `background/storage/flush-health.js` | 存储健康指标 | `background/core/session-persist`<br>`data/data-store` | recordFlushFailure<br>getFlushHealth<br>resetFlushHealth | — |
| `background/storage/flush.js` | 存储聚合落盘 | `background/storage/app-stats`<br>`background/storage/behavior`<br>`background/storage/learned-noise`<br>`background/storage/logger`<br>`background/storage/manual-platforms`<br>`background/storage/name-index`<br>`background/storage/registry`<br>`background/storage/steam-cache`<br>…+3 | flushAllCaches | — |
| `background/storage/history.js` | 下载历史 | `background/core/constants`<br>`background/core/mechanisms`<br>`data/data-store` | inferSiteFromDomain<br>getDownloadHistory<br>recordDownloadHistory | — |
| `background/storage/learned-noise.js` | 动态噪声词学习 | `background/core/constants`<br>`background/storage/debounced-store`<br>`data/data-store` | flushLearnedNoise<br>warmupLearnedNoise<br>getActiveNoiseWords<br>recordNoiseCandidates<br>resetLearnedNoise | — |
| `background/storage/llm-cache.js` | LLM 推荐评分缓存 | `background/core/constants`<br>`background/core/mechanisms`<br>`data/data-store` | getLlmScore<br>setLlmScore<br>resetLlmCache<br>getLlmMatch<br>setLlmMatch<br>getWebMatch<br>…+1 | — |
| `background/storage/logger.js` | 运行日志 | `background/core/constants`<br>`background/core/mechanisms`<br>`background/core/sanitize`<br>`background/core/settings`<br>`background/storage/debounced-store`<br>`data/data-store` | flushLogBuffer<br>Logger<br>getRuntimeLogs<br>clearRuntimeLogs<br>resetLogBuffer | — |
| `background/storage/manual-platforms.js` | 手动平台映射 | `background/core/constants`<br>`background/storage/debounced-store`<br>`background/storage/logger`<br>`data/data-store` | flushManualPlatforms<br>resetManualPlatforms<br>warmupManualPlatforms<br>getManualPlatform<br>setManualPlatform<br>getManualPlatformsMemory | — |
| `background/storage/name-index.js` | 名称索引 | `background/core/constants`<br>`background/core/title-parser`<br>`background/storage/debounced-store`<br>`background/storage/flush-health`<br>`data/data-store` | warmupNameIndex<br>lookupAppIdByName<br>isRecentlySearchedNotFound<br>negativeCacheRemainingMs<br>getNegativeCacheCount<br>getNameIndexSnapshot<br>…+5 | — |
| `background/storage/notifications.js` | 站内通知中心存储 | `background/core/session-persist` | recordNotification<br>getNotifications<br>markNotificationsRead | — |
| `background/storage/registry.js` | 游戏注册表 | `background/core/constants`<br>`background/storage/debounced-store`<br>`background/storage/flush-health`<br>`data/data-store` | warmupRegistry<br>getGameRegistry<br>getGameRegistryEntry<br>recordGameInRegistry<br>flushRegistry<br>deleteGameRegistryEntry<br>…+1 | — |
| `background/storage/reset.js` | 内存缓存重置 | `background/core/outbound-audit`<br>`background/core/rules`<br>`background/core/settings`<br>`background/storage/app-stats`<br>`background/storage/behavior`<br>`background/storage/download-urls`<br>`background/storage/learned-noise`<br>`background/storage/llm-cache`<br>…+10 | resetInMemoryCaches | — |
| `background/storage/search-cache.js` | 下载站搜索缓存 | `background/core/constants`<br>`background/core/mechanisms`<br>`data/data-store` | getSearchCache<br>setSearchCache<br>resetSearchCache | — |
| `background/storage/site-health.js` | 站点适配器健康 | `background/core/constants`<br>`background/storage/debounced-store`<br>`data/data-store` | recordSiteAlert<br>getSiteHealth<br>resetSiteHealth | — |
| `background/storage/steam-cache.js` | Steam 动态缓存（模块化）/ Steam Dynamic Cache (modular) | `background/core/constants`<br>`background/storage/debounced-store`<br>`background/storage/flush-health`<br>`data/data-store` | isModuleValid<br>getModuleData<br>getMergedData<br>latestModuleTs<br>isSteamCacheValid<br>loadSteamCacheToMemory<br>…+10 | — |
| `background/storage/url-index.js` | 详情页网址索引 | `background/core/constants`<br>`background/storage/debounced-store`<br>`background/storage/flush-health`<br>`data/data-store` | flushUrlIndex<br>warmupUrlIndex<br>getAppIdByUrl<br>setUrlAppId<br>deleteUrlAppId<br>getUrlIndexSize<br>…+1 | — |
| `background/storage/usage-evidence.js` | 使用证据档案 | `background/core/constants`<br>`background/storage/debounced-store`<br>`data/data-store` | flushUsageEvidence<br>resetUsageEvidence<br>recordUsageCounter<br>recordUsageDuration<br>recordUsageEvent<br>durationStats<br>…+3 | — |
| `background/storage/wrong-reports.js` | 报错纠正记录 | `background/core/constants`<br>`background/storage/debounced-store`<br>`data/data-store` | recordWrongReport<br>warmupWrongReports<br>lookupWrongReportCorrection<br>flushWrongReports<br>resetWrongReports<br>getWrongReportsMemory<br>…+2 | — |

## background/warmup-coordinator.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `background/warmup-coordinator.js` | 分层预热协调器（v14.13 B2，报告 A W2） | `background/core/api-monitor`<br>`background/core/metrics`<br>`background/core/outbound-audit`<br>`background/core/session-persist`<br>`background/core/tab-game`<br>`background/steam/app-list-index`<br>`background/steam/ratings-batch`<br>`background/steam/retrieval-override`<br>…+9 | runHotTier<br>runWarmTier | — |

## content/adapters

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `content/adapters/builder.js` | 站点适配器构建 | `content/core/common`<br>`content/core/timeouts` | loadSiteRules<br>isImageAppIdEnabled<br>setScanLimit<br>getScanLimit<br>buildSiteAdapters<br>getAdapter<br>…+7 | — |

## content/core

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `content/core/common.js` | 内容脚本公共工具 | `shared/retrieval-vocab` | setTitleCleaningOverride<br>applyTitleCleaningOverride<br>getCurrentDomain<br>escapeHtml<br>escapeAttr<br>formatRelativeTime<br>…+5 | — |
| `content/core/debug.js` | 调试模块 | `content/core/common`<br>`content/core/status-bar` | DEBUG<br>scheduleDebugUpdate<br>dbg | — |
| `content/core/floats.js` | 统一浮窗管理器 | — | ZONE<br>applyFloatTheme<br>create<br>remove<br>closeAll | — |
| `content/core/messages.js` | 内容侧消息路由 | `content/core/page-url` | createMessageRouter | — |
| `content/core/page-init.js` | 页面检测与功能分发 | `content/core/page-url`<br>`content/core/timeouts` | initPage | — |
| `content/core/page-url.js` | 页面类型 URL 判定（零依赖纯函数）/ URL-based page kind | — | isDetailPageByUrl<br>isListPageByUrl<br>isHomePageUrl<br>detectPageScope | — |
| `content/core/status-bar.js` | 工作状态/诊断统一浮窗 | `content/core/common`<br>`content/core/floats` | showStatus<br>showStats<br>showDebugView<br>setEnabled<br>setDebugMode<br>hide<br>…+1 | — |
| `content/core/steam-rating-logic.js` | Steam 评分口径单源 | `shared/spy-scales` | heatLabelFor<br>ratingTextInfo<br>adjustedReputation<br>verdictFor | — |
| `content/core/timeouts.js` | 内容侧消息超时常量（单源）/ Content-side message timeouts | — | MSG_TIMEOUT_SHORT_MS<br>MSG_TIMEOUT_NORMAL_MS<br>MSG_TIMEOUT_LONG_MS<br>RATINGS_TIMEOUT_MS | — |

## content/detail

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `content/detail/candidates.js` | 候选手动选择模块 | `content/core/common`<br>`shared/platform-detect` | parseManualAppIdInput<br>isGameDismissed<br>renderManualSelectPanel | — |
| `content/detail/detail-page.js` | 详情页模块入口 | `content/detail/detect-name`<br>`content/detail/sidebar`<br>`content/detail/tracking` | injectSteamButton<br>detectGameName<br>injectDownloadSitePanel<br>injectDownloadHistoryPanel<br>injectSteam250Panel<br>steam250AppIdFromUrl<br>…+1 | — |
| `content/detail/detail-templates.js` | 详情页浮窗模板入口 | `content/core/steam-rating-logic`<br>`content/detail/render/inline-html`<br>`content/detail/render/sidebar-html` | steamSidebar<br>steamInlineSection<br>heatLabelFor<br>ratingTextInfo<br>adjustedReputation<br>verdictFor | — |
| `content/detail/detect-name.js` | 详情页游戏名提取（轻量单点）/ Page game-name detection | `content/core/common`<br>`shared/retrieval-vocab` | detectGameName | — |
| `content/detail/inline-card.js` | 内嵌 Steam 信息卡 | `content/adapters/builder`<br>`content/core/debug`<br>`content/detail/detail-templates` | renderInlineSteamSection | — |
| `content/detail/qr-unlock.js` | 二维码转链接 | `content/core/debug`<br>`content/core/timeouts` | init | — |
| `content/detail/render/inline-html.js` | 内嵌 Steam 信息卡模板 | `content/core/common`<br>`content/core/steam-rating-logic`<br>`content/detail/render/match-confidence-row` | steamInlineSection | — |
| `content/detail/render/match-confidence-row.js` | 匹配置信度行 | `content/core/common` | renderMatchConfidenceRow | — |
| `content/detail/render/rating-rows.js` | 评分区块渲染器 | `content/core/common` | renderRatingRows<br>buildSparklineSvg<br>renderVerdictRow | — |
| `content/detail/render/sidebar-html.js` | Steam 信息栏模板 | `content/core/common`<br>`content/core/steam-rating-logic`<br>`content/detail/render/match-confidence-row`<br>`content/detail/render/rating-rows`<br>`shared/fm-keys` | steamSidebar | — |
| `content/detail/sidebar-actions.js` | 浮窗回调工厂 | `content/adapters/builder`<br>`content/core/debug`<br>`content/core/timeouts`<br>`content/detail/candidates` | createSteamActions | — |
| `content/detail/sidebar-rows.js` | 浮窗数据行填充 | `content/core/timeouts` | fillItadAndFavorites<br>fillSteam250Info<br>fillSeriesInfo | — |
| `content/detail/sidebar.js` | Steam 信息浮窗模块（编排壳）/ Steam Info Float (orchestrator) | `content/adapters/builder`<br>`content/core/common`<br>`content/core/debug`<br>`content/core/floats`<br>`content/core/status-bar`<br>`content/core/timeouts`<br>`content/detail/candidates`<br>`content/detail/detail-templates`<br>…+2 | createSteamFloat | — |
| `content/detail/tracking.js` | 下载追踪面板模块 | `content/adapters/builder`<br>`content/core/common`<br>`content/core/debug`<br>`content/core/floats`<br>`content/core/status-bar` | injectDownloadSitePanel<br>injectDownloadHistoryPanel<br>steam250AppIdFromUrl<br>steam250NameFromTitle<br>injectSteam250Panel<br>trackSteamTagsUpdate | — |

## content/list

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `content/list/badges/badge-base.js` | 徽章 DOM 基元 | — | createBadge<br>setBadgeRetryHandler<br>getBadgeRetryHandler<br>removeRatingBadges<br>insertBadges | createBadge 默认 base 含 gr-rating-badge；组外徽章（推荐值等）必须显式传 base:'gr-badge'（铁律 12，v10.6.0 事故）<br>徽章文本由调用方拼好传入（本模块不做转义）——动态内容在调用方经 escapeHtml/escapeAttr 处理 |
| `content/list/badges/core.js` | 列表页徽章域入口 | `content/core/steam-rating-logic`<br>`content/list/badges/badge-base`<br>`content/list/badges/rec`<br>`content/list/badges/working` | prependBadge<br>removeItemFromDom<br>showWorkingBadge<br>removeWorkingBadge<br>updateWorkingBadgesInfo<br>// v14.8.1：等待徽章可见队列信息
  showErrorBadge<br>…+5 | — |
| `content/list/badges/rec.js` | 徽章：推荐值域 | `content/list/badges/badge-base` | prependRecBadge | — |
| `content/list/badges/working.js` | 徽章：工作状态域 | `content/list/badges/badge-base` | removeItemFromDom<br>showWorkingBadge<br>removeWorkingBadge<br>updateWorkingBadgesInfo<br>showErrorBadge<br>highlightItem<br>…+1 | — |
| `content/list/filter-presets.js` | 过滤预设纯逻辑 | — | PRESET_CAP<br>PRESET_NAME_MAX<br>clampPct<br>upsertPreset | — |
| `content/list/list-batch.js` | 列表页批次调度 | `content/adapters/builder`<br>`content/core/debug`<br>`content/core/status-bar`<br>`content/core/timeouts`<br>`content/list/badges/core`<br>`content/list/list-state` | resolveBatchCapacity<br>maybeFetchNextBatch<br>requestSteamRatings<br>requestRecommendations<br>waitForBatchIdle | — |
| `content/list/list-page.js` | 列表页模块 | `content/adapters/builder`<br>`content/core/common`<br>`content/core/debug`<br>`content/core/page-url`<br>`content/core/timeouts`<br>`content/list/badges/core`<br>`content/list/list-batch`<br>`content/list/list-state` | requestRecommendations<br>isDetailPageByUrl<br>isHomePageUrl<br>isListPageByUrl<br>_state<br>_internal<br>…+10 | — |
| `content/list/list-state.js` | 列表页共享状态容器 | `content/adapters/builder`<br>`content/core/debug`<br>`content/core/status-bar`<br>`content/list/badges/core` | formatQueueStatusText<br>_state<br>ratingFilterPass<br>applyRatingsResponse<br>finishRatings<br>sortItemsByRating<br>…+4 | — |
| `content/list/xdgrid-layout.js` | 列表布局引擎 | `content/adapters/builder`<br>`content/core/common`<br>`content/core/debug` | STORE_KEY<br>DEFAULTS<br>MIN_ITEMS<br>clampInt<br>computeContainerStyle<br>migrateLegacy<br>…+7 | — |
| `content/list/xdgrid-panel.js` | 列表工具面板 | `content/adapters/builder`<br>`content/core/debug`<br>`content/list/filter-presets`<br>`content/list/list-state`<br>`content/list/xdgrid-layout` | buildUI | — |
| `content/list/xdgrid.js` | 下载站列表布局定制（装配壳）/ Grid Customizer (shell) | `content/adapters/builder`<br>`content/core/common`<br>`content/core/debug`<br>`content/list/xdgrid-layout`<br>`content/list/xdgrid-panel` | init<br>computeContainerStyle<br>migrateLegacy<br>commonAncestor<br>isXdgameFallback | — |

## content/module-manifest.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `content/module-manifest.js` | 内容模块清单（单源）/ Content Module Manifest | — | CORE_MODULES<br>OPTIONAL_MODULES | — |

## content/tracker.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `content/tracker.js` | 内容脚本入口（装载器）/ Content Script Entry (Loader) | — | — | — |

## content/tracking

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `content/tracking/download-tracking.js` | 下载追踪模块 | `content/core/common`<br>`content/core/debug`<br>`content/detail/detect-name` | isDownloadUrl<br>isDownloadText<br>setupDownloadTracking | — |

## dashboard/dash-backups.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `dashboard/dash-backups.js` | Dashboard 备份模块 | — | — | — |

## dashboard/dash-diagnostics.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `dashboard/dash-diagnostics.js` | Dashboard 诊断模块 | — | — | — |

## dashboard/dash-export.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `dashboard/dash-export.js` | Dashboard 导出模块 | — | — | — |

## dashboard/dash-insights.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `dashboard/dash-insights.js` | Dashboard 洞察模块 | — | — | — |

## dashboard/dash-logs.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `dashboard/dash-logs.js` | Dashboard 运行日志与分页模块 | — | — | — |

## dashboard/dash-radar.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `dashboard/dash-radar.js` | Dashboard 画像雷达（第九轮 B3）/ Profile Radar | — | — | — |

## dashboard/dash-stats.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `dashboard/dash-stats.js` | Dashboard 统计模块 | — | — | — |

## dashboard/dashboard.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `dashboard/dashboard.js` | Dashboard 壳 | — | — | — |

## data/data-store.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `data/data-store.js` | 数据存储层 | `data/storage-registry`<br>`lib/ndjson` | setWriteMetricsHook<br>dataStore | — |

## data/migrate.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `data/migrate.js` | 存储模块迁移框架 | `data/data-store` | registerMigration<br>clearMigrations<br>migrateModuleIfNeeded | — |

## data/storage-registry.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `data/storage-registry.js` | 存储模块注册表（单源）/ Storage Module Registry | — | STORAGE_MODULES<br>LEGACY_BACKUP_KEYS | — |

## freegames/freegames.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `freegames/freegames.js` | Free Games Script | — | — | — |

## hub/hub.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `hub/hub.js` | 设置中心逻辑 | — | — | — |

## lib/ndjson.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `lib/ndjson.js` | ND-JSON (JSON Lines) 编解码 | — | NDJSON | — |

## options/options.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `options/options.js` | 设置页入口 | — | — | — |

## options/panels

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `options/panels/cache-formatters.js` | 缓存面板格式化器 | — | — | — |
| `options/panels/cache.js` | 游戏缓存面板模块 | — | — | — |
| `options/panels/data-manage.js` | 数据管理面板模块 | — | — | — |
| `options/panels/favorites.js` | 收藏折扣与周报面板模块 | — | — | — |
| `options/panels/reset-defaults.js` | 设置页每项"恢复默认"微按钮 | — | — | — |
| `options/panels/rules.js` | 规则管理面板模块 | — | — | — |
| `options/panels/search.js` | 搜索与过滤面板模块 | — | — | — |
| `options/panels/settings-bind.js` | 设置面板事件绑定 | — | — | — |
| `options/panels/settings-render.js` | 设置面板渲染器 | — | — | — |
| `options/panels/settings.js` | 设置面板（浮窗模块顺序）/ Settings Panel (FM Order) | — | — | — |
| `options/panels/sites.js` | 站点管理与数据源面板模块 | — | — | — |

## popup/popup-search.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `popup/popup-search.js` | Popup 快速搜索 | — | — | — |

## popup/popup-status.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `popup/popup-status.js` | Popup 状态区渲染 | — | — | — |

## popup/popup-weights.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `popup/popup-weights.js` | Popup 权重滑块 | — | — | — |

## popup/popup.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `popup/popup.js` | Popup Script（装配壳）/ Popup (shell) | — | — | — |

## shared/crypto-utils.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `shared/crypto-utils.js` | WebCrypto 加密工具 | — | — | — |

## shared/escape.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `shared/escape.js` | 共享 HTML 转义工具 | — | — | — |

## shared/fm-keys.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `shared/fm-keys.js` | 浮窗模块键单源 | — | FM_KEYS<br>FM_LABELS<br>FM_DEFAULT_ORDER | — |

## shared/freegames-filter.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `shared/freegames-filter.js` | 限免列表过滤纯函数 | — | — | — |

## shared/ical.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `shared/ical.js` | iCalendar 生成器 | — | — | — |

## shared/mismatch-anchors.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `shared/mismatch-anchors.js` | 错题库运行时锚点 | — | — | — |

## shared/msg.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `shared/msg.js` | 统一消息层 | — | — | — |

## shared/patterns.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `shared/patterns.js` | 共享模式/常量（经典脚本）/ Shared Patterns (classic script) | — | — | — |

## shared/platform-detect.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `shared/platform-detect.js` | 非 PC 平台识别（v14.10.0，用户需求：主机/模拟器条目） | — | detectPlatform<br>detectOffSteamPlatform<br>trimPlatformTokens<br>MANUAL_PLATFORM_OPTIONS<br>MANUAL_PLATFORM_BRANDS<br>resolveManualPlatformOption<br>…+1 | — |

## shared/retrieval-vocab.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `shared/retrieval-vocab.js` | 检索规则词表（单源数据 + 校验 + 编译）/ Retrieval Vocab | — | RETRIEVAL_VOCAB<br>validateRetrievalVocab<br>getCompiledRetrievalRules<br>invalidateRetrievalRulesCache<br>PROTECTIVE_TITLES<br>applyVocabOverride<br>…+1 | — |

## shared/settings-utils.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `shared/settings-utils.js` | 设置深路径工具 | — | — | — |

## shared/spy-scales.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `shared/spy-scales.js` | SteamSpy 信号归一化刻度单源 | — | SPY_SCALES | — |

## welcome/changelog.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `welcome/changelog.js` | 版本更新记录数据 | — | — | — |

## welcome/welcome.js

| 模块 | 职责 | 依赖 | 导出 | 不变式 |
| --- | --- | --- | --- | --- |
| `welcome/welcome.js` | 欢迎页 | — | — | — |

## 豁免登记 / Stub Exemptions

> `@stub-ok: <原因文本>` 是唯一豁免关键词；**无原因文本不算豁免**，
> 且必须出现在本表（索引未覆盖目录里的豁免视为未实现，`check:modules` 直接红）。

当前无豁免。
