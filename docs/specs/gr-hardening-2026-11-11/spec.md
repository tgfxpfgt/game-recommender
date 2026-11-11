# Spec：三项修复 + 制度性门禁 + 测试体系改造 + 运行期录制

> 状态：用户已批准全量开工（2026-11-11）。本文件为执行基线，逐层独立提交。
> 边界：不 push、不 reset/amend、不删文件、不改生产调优值、不上传任何运行数据。

## 0. 已确证事实（本轮实测）

| 事实 | 证据 |
|------|------|
| 仓库默认分支 = `master` | `api.github.com/repos/jsnli/steamappidlist` 200，`default_branch=master` |
| dump 在 `master` 分支存在且 20,247,815 B | `cdn.jsdelivr.net/gh/jsnli/steamappidlist@master/data/games_appid.json` HEAD 200，`Content-Length=20247815` |
| `raw.githubusercontent.com` 本机不可达 | HEAD 超时（master 与 main 均超时，无法区分 404） |
| 进度只在成波时推送 | `background/steam/ratings-batch.js` `flushWave` → `push({ratings: wave, ...progressPayload()})` |
| 20s 软阈值只写日志 | 同上 `onSoftWarn` 仅 `Logger.warn` + 指标 |
| 断网时无 appId 的结果为 `null` | `orchestrator-list.js` `phaseSearch` → `return null`（网络失败与确认未找到同形） |
| 内容侧 `null` → 「未找到」 | `list-state.js` `applyRatingsResponse` 末支 → `prependBadge(item, null)` |
| 测试从未校验真实 URL | `tests/unit/test-app-list-index.mjs` 全部 `fetch` mock，URL 不参与断言 |

## 1. 第一层：三项修复

### F1 停滞期边沿心跳（目标 40.3s → 20–21s）

- 文件：`background/steam/ratings-batch.js`
- 新增模块级 `scheduleStallCheck()`：单次 `setTimeout`，触发时刻 = 最早在途条目
  `startedAt + itemSoftMs`；触发时若 `stalledInfo()` 非空且 `签名(name|phase|elapsed/5000)`
  变化 → `push({ratings: null, ...progressPayload()})` 并重排下一个 5s 桶；无停滞则停。
- 在 `inFlight.set(...)` 后调用；`finally` 与任务收尾清理定时器。
- 不新增高频轮询：路径仅"条目开始/停滞桶变化"两条边沿。
- 验收：20s 软阈值到达后 ≤1s 出现一次推送，内容侧 `formatQueueStatusText` 渲染
  「⏳ 检索中 x/y · 卡在取评价 20s」。

### F2 网络故障与「未找到」分离

- `background/steam/orchestrator-list.js`：
  - `phaseSearch` 未命中且 `getSteamApiStatus().failed > 0` → 返回哨兵
    `{networkFailed: true}`（仅确认未找到才 `return null`）。
  - `getSteamPositiveRate` 收到哨兵 → `{positiveRate:null, appId:null, name:gameName,
    failed:true, errorType:'network'}`。
- `content/list/list-state.js`：`applyRatingsResponse` 新增 `rating.failed && !rating.appId`
  分支 → `job.failedNames.push` + `prependBadge(item, rating, settings)`（不再走未找到）；
  `finishRatings` 摘要加「网络异常 N 个」；`RatingsJob` 增加 `failedNames`。
- `content/list/badges/core.js`：`prependBadge` 首分支增加
  `rating && rating.failed && !rating.appId` → 「⚠️ 网络异常·点击重查」（琥珀色、
  虚线、点击复用 `getBadgeRetryHandler`），tooltip 明确「网络/限流故障，非 Steam 无此游戏」。
- 验收：模拟网络失败（`failed:true` 无 appId）时徽章文本含「网络异常」，不含「未找到」。

### F3 appListIndex 源修正 + 首次成功实证

- `background/core/constants.js`：
  - `steamAppListDump`（主源）= `https://cdn.jsdelivr.net/gh/jsnli/steamappidlist@master/data/games_appid.json`
  - `steamAppListDumpFallback`（备源）= `https://raw.githubusercontent.com/jsnli/steamappidlist/master/data/games_appid.json`
- `background/steam/app-list-index.js`：`fetchDumpPayload` 依次尝试主源/备源；
  解析函数抽为纯函数 `parseDumpEntries(raw, yieldEvery)` 供离线夹具复用。
- `scripts/external-refs.json`：外部引用锁文件（url / owner / repo / branch / path /
  validatedAt / httpStatus / bytes）。
- `scripts/check-external-refs.mjs`：
  - 默认离线：解析 constants 中全部外部 URL，与锁文件比对；URL 变更/未登记 → 红；
    `validatedAt` 超过 30 天 → 红（要求 `--refresh`）。
  - `--refresh`：用 `api.github.com` 校验 owner/repo 默认分支与文件存在，
    并 HEAD 主源拿状态码与字节数，写回锁文件。
- 新增 `npm run check:refs`，并接入 `gate:fast`。
- 首次成功实证：`tests/unit/test-app-list-index.mjs` 增加 `GR_LIVE_APPLIST=1` 才跑的
  真实网络用例（真实拉 dump → 解析 → 匹配 `The Culling`）；本轮手动跑一次并记录
  下载字节数/条目数/匹配结果。日常门禁不跑该用例（避免 20MB）。

## 2. 第二层：A–G 排查与门禁

| 类别 | 自动化门禁 | 反向验证（放回缺陷） |
|------|-----------|---------------------|
| A 外部引用写死 | `scripts/check-external-refs.mjs`（锁文件比对 + 30 天保鲜） | 把 `master` 改回 `main` → 红 |
| B 故障语义映射 | `tests/unit/test-failure-semantics.mjs`（真值表：network/ratelimit/notfound/timeout/empty 各自渲染） | 删除 `failed && !appId` 分支 → 红 |
| C 只写日志的机制 | `tests/unit/test-stall-heartbeat.mjs`（假定时器：20s 必须产生推送） | 删除 `scheduleStallCheck` 调用 → 红 |
| D 测试假绿 | `scripts/mutation-check.mjs` + `scripts/mutations.json`（对源码做最小突变→跑映射测试→必须失败→还原） | 突变本身即反向验证 |
| E 验收无分母 | `scripts/check-match-corpus.mjs`（每条样本必须有 expectedName，否则红；输出分母） | 删一条 expectedName → 红 |
| F 声明与实现不符 | 扩展现有 `check-stubs`：新增"外部引用"检查项；文档说明其只管占位与契约缺口的盲区 | 删除 `matchAppListExact` 调用 → 红（现有 stubs 不管，由 A/回归测试兜） |
| G 上线无首次运行证据 | `scripts/check-external-refs.mjs` 的 `validatedAt` 保鲜 + `appListIndex.refresh.ok` 指标断言 | 把 validatedAt 改成 60 天前 → 红 |

## 3. 第三层：测试体系改造

- 实测各套件墙钟与 gate/gate:fast 时长，落盘 `docs/reports/…`。
- `package.json`：新增 `verify:mutations`（`--only` 支持）与 `check:refs`；
  `check:corpus`。
- 分层：`gate:fast` = lint/typecheck + 变更面测试 + `check:refs` + `check:corpus` +
  变更面突变检查；`gate` = 全量 + 全量突变。
- 时长预算：`scripts/check-suite-budget.mjs` 读 `scripts/suite-budgets.json`，
  超出预算 1.5× → 红。
- 失败诊断：`test:changed` 失败时打印套件名/文件/断言摘要（vitest verbose），
  避免为拿线索重跑全量。
- 不放宽任何现有断言。

## 4. 第四层：运行期录制与回放

- 新增存储模块 `diagTrace`（`data/storage-registry.js` 一行 + 业务文件
  `background/storage/diag-trace.js`）：环形 500 事件，字段：
  `t, kind, stage, phase, itemId(游戏名 hash+短名), durMs, outcome,
   failCategory(network|timeout|ratelimit|empty|notfound|parse), source, confidence,
   cacheLayer, wave{done,total}, queueDepth`。
  查询串仅存 hostname；不存页面正文/完整 URL/用户标识。
- 采集点：SW boot 耗时、批量任务开始/波次/收尾、条目 phase 进出耗时、失败分类、
  匹配 source/confidence、缓存命中层。
- 导出：`GET_DIAG_TRACE` action（message-contract 加规则），返回 JSON（人可读，
  可作夹具）。
- 回放：`tests/replay/*.mjs` 读取 `tests/fixtures/traces/*.json`，断言
  `classifyTrace()` 能给出 `{stalledStage, failCategory}`。
- 证明：断网场景录制一份 trace，`classifyTrace` 输出 `reviews` + `network`。
- 体量：500 × ~220B ≈ 110KB 上限；每事件 O(1) 写入 + 2s 防抖落盘。

## 5. 验收与提交

- 每层一个提交（中文 conventional）：
  1. `fix(steam,content): 停滞心跳/故障语义/目录源三修复`
  2. `feat(guards): 外部引用锁与 A–G 门禁`
  3. `chore(test): 分层、时长预算与突变检查`
  4. `feat(diag): 运行期轨迹录制与回放`
- 每层完成后发简报（落地内容 / 证据 / 下一步）。
