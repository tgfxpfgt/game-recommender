# Tasks：gr-hardening-2026-11-11

## L1 三项修复
- [x] T1 `background/steam/ratings-batch.js`：边沿停滞推送（scheduleStallCheck，单次 setTimeout）。
- [x] T2 `background/steam/orchestrator-list.js`：网络失败哨兵 + 返回 `errorType:'network'` + `noRetry`。
- [x] T3 `content/list/list-state.js` / `badges/core.js`：网络异常徽章分支、失败计数与摘要。
- [x] T4 `background/core/constants.js` + `app-list-index.js`：jsDelivr 主源 + raw 备源 + `parseDumpEntries` 纯函数。
- [x] T5 回归用例（就近既有套件）：`tests/unit/test-ratings-resume.mjs`（停滞心跳）、`tests/sim/sim-list.mjs` 节 13（故障语义）、`tests/unit/test-app-list-index.mjs`（解析 + live 用例）。
- [x] T6 首次成功实证：`GR_LIVE_APPLIST=1` 真实拉取 20,247,815B / 199,731 条 / Dota 2 → 570。
- [x] T7 提交 1。

## L2 A–G 门禁
- [ ] T8 `scripts/external-refs.json` + `scripts/check-external-refs.mjs`（离线比对 + `--refresh` + 30 天保鲜）。
- [ ] T9 `scripts/check-match-corpus.mjs`（expectedName 分母强制）。
- [ ] T10 `scripts/mutations.json` + `scripts/mutation-check.mjs`（突变→测试必须红→还原）。
- [ ] T11 package.json 接线 `check:ext-refs`/`check:corpus`/`verify:mutations`（`check:refs` 已被 check-referenced-paths 占用）；gate:fast 纳入。
- [ ] T12 逐条反向验证并记录命令与结果。
- [ ] T13 提交 2。

## L3 测试体系
- [ ] T14 实测套件墙钟、gate/gate:fast 总时长、近期全量 gate 次数。
- [ ] T15 `scripts/suite-budgets.json` + `scripts/check-suite-budget.mjs`。
- [ ] T16 诊断信息增强（失败时输出套件/文件/断言摘要）。
- [ ] T17 分层方案落文档 + 提交 3。

## L4 运行期录制
- [ ] T18 `background/storage/diag-trace.js` + storage-registry 登记 + 采集点接线。
- [ ] T19 `GET_DIAG_TRACE` 契约与 handler。
- [ ] T20 `classifyTrace()` 纯函数 + 回放夹具 + 测试。
- [ ] T21 断网/停滞场景录制证明。
- [ ] T22 提交 4。

## 交付
- [ ] T23 `docs/reports/GameRecommender-修复与制度门禁-2026-11-11.md`：结论、A–G 清单、门禁反向验证、测试成本表、录制数据点与体量估算、交叉说明。
