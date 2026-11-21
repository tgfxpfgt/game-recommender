# 模块分级台账 / Module Tiers

> v14.40.0 用户指令：项目已非常冗杂，各模块按用户使用频率分级——核心重视 /
> 活跃少管 / 低频默认不管 / 冻结不再投入。本台账是**投入分配的依据**：
> 测试面、审查深度、改动优先级都按级别走（详见 AGENTS「最小必要测试」）。
> 判级口径：真实用户使用频率（telemetry/appStats 可查的用得多）+ 故障面
> （坏了影响主功能）。
>
> **冻结 ≠ 删除**：冻结模块保持可用、不再主动投入（不新增功能/不重构/
> 测试面最小化——回归靠既有门禁兜底，改动仅限修真 bug）。

## T0 核心（重视：门禁全覆盖 + 变更必测 + 审查最严）

用户天天用、坏了等于插件不可用的主链路。

| 域 | 模块 |
|---|---|
| 内容管线 | tracker / module-manifest / module-loaders / core/messages / core/page-init / adapters/builder |
| 列表评分 | list-batch / list-state / badges/*（三态徽章是主价值） |
| 详情浮窗 | detail/sidebar / detail-templates / candidates |
| 存储 | data/data-store / storage-registry / steam-cache（4 分文件） |
| 后台管线 | steam/orchestrator-* / api-search / api-reviews / handlers / message-contract |
| 词表 | shared/retrieval-vocab（golden+错题库双门禁） |
| 检索词编译链 | title-parser / steam-rating-logic |

## T1 活跃（少管：改动就近测，不主动巡检）

常用但故障面窄、或自愈机制完善。

| 域 | 模块 |
|---|---|
| 浮窗/状态 | core/floats / core/status-bar / core/debug / core/common |
| 次级详情 | sidebar-rows / inline-card / sidebar-actions / tracking |
| 列表辅面 | list-page / xdgrid / xdgrid-panel / xdgrid-layout / filter-presets |
| 页面 | popup* / options* / dashboard* / freegames* / sidepanel |
| 后台辅面 | steam/cache-* / steam/api-detail / steam/api-metacritic / steam/api-spy / sites/* / freegames 后台 / recommend |
| 共享 | escape / msg / patterns / settings-utils / ui-tokens / ui-text / themes-data / platform-detect / freegames-filter |
| 门禁脚本 | scripts/*（gates/build/bump/视觉） |

## T2 低频（默认不管：没造成负面影响不投入）

偶尔用、无报障。**不主动改、不主动测**；被 T0/T1 改动波及时按波及面最小测。

| 域 | 模块 |
|---|---|
| 引导/欢迎 | welcome / hub |
| 次级功能 | qr-unlock / download-tracking 面板 / ical 导出 |
| 设置深水区 | ITAD 多配置 / 周报 digest / LLM fallback / 站内搜索索引 |
| 诊断 | diag-trace / runtimeLog / e2e-probe |

## T3 冻结（不投入：保持可用，仅修真 bug）

用户几乎不用或已被决策冻结。

| 域 | 模块 | 冻结理由 |
|---|---|---|
| 油猴 | userscript/* | 用户裁决：@version 维持移植基线不随扩展递增（gap 盘点零功能缺口，2026-11-21 关账） |
| 旧形态 | data/migrate.js | 运行期零消费（迁移已完成，兼容面保留） |
| 深度追踪 | 行为学习详情（app-stats 高级面） | 使用频率极低，无报障 |
| i18n/云同步/跨浏览器/规则市场/MAIN world | — | 用户裁决"明确不做"（AGENTS 历史决策） |

## 投入规则（如何按级别行事）

1. **新需求落在 T3** → 先问用户是否真的要做（多半是重新启用冻结面）
2. **T2 改动** → 就近一个回归用例，不铺测试面；bug 修复带 1 用例即可
3. **T1 改动** → 受影响套件定向跑（test:changed），不发全量
4. **T0 改动** → 现行纪律不变（门禁全套 + 变异回放面）
5. **判级调整** → 改本表须在 CHANGELOG 记一行（透明度：投入变化可追溯）
