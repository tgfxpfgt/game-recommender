# Spec：三项修复 + 制度性门禁 + 测试体系改造 + 运行期录制

> 状态：用户已批准全量开工（2026-11-11）。本文件为执行基线，逐层独立提交。
> 边界：不 push、不 reset/amend、不删文件、不改生产调优值、不上传任何运行数据。

## 0. 已确证事实（本轮实测）

| 事实                                     | 证据                                                                                                        |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 仓库默认分支 = `master`                  | `api.github.com/repos/jsnli/steamappidlist` 200，`default_branch=master`                                    |
| dump 在 `master` 分支存在且 20,247,815 B | `cdn.jsdelivr.net/gh/jsnli/steamappidlist@master/data/games_appid.json` HEAD 200，`Content-Length=20247815` |
| `raw.githubusercontent.com` 本机不可达   | HEAD 超时（master 与 main 均超时，无法区分 404）                                                            |
| 进度只在成波时推送                       | `background/steam/ratings-batch.js` `flushWave` → `push({ratings: wave, ...progressPayload()})`             |
| 20s 软阈值只写日志                       | 同上 `onSoftWarn` 仅 `Logger.warn` + 指标                                                                   |
| 断网时无 appId 的结果为 `null`           | `orchestrator-list.js` `phaseSearch` → `return null`（网络失败与确认未找到同形）                            |
| 内容侧 `null` → 「未找到」               | `list-state.js` `applyRatingsResponse` 末支 → `prependBadge(item, null)`                                    |
| 测试从未校验真实 URL                     | `tests/unit/test-app-list-index.mjs` 全部 `fetch` mock，URL 不参与断言                                      |

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

| 类别                 | 自动化门禁                                                                                           | 反向验证（放回缺陷）                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| A 外部引用写死       | `scripts/check-external-refs.mjs`（锁文件比对 + 30 天保鲜）                                          | 把 `master` 改回 `main` → 红                                           |
| B 故障语义映射       | `tests/unit/test-failure-semantics.mjs`（真值表：network/ratelimit/notfound/timeout/empty 各自渲染） | 删除 `failed && !appId` 分支 → 红                                      |
| C 只写日志的机制     | `tests/unit/test-stall-heartbeat.mjs`（假定时器：20s 必须产生推送）                                  | 删除 `scheduleStallCheck` 调用 → 红                                    |
| D 测试假绿           | `scripts/mutation-check.mjs` + `scripts/mutations.json`（对源码做最小突变→跑映射测试→必须失败→还原） | 突变本身即反向验证                                                     |
| E 验收无分母         | `scripts/check-match-corpus.mjs`（每条样本必须有 expectedName，否则红；输出分母）                    | 删一条 expectedName → 红                                               |
| F 声明与实现不符     | 扩展现有 `check-stubs`：新增"外部引用"检查项；文档说明其只管占位与契约缺口的盲区                     | 删除 `matchAppListExact` 调用 → 红（现有 stubs 不管，由 A/回归测试兜） |
| G 上线无首次运行证据 | `scripts/check-external-refs.mjs` 的 `validatedAt` 保鲜 + `appListIndex.refresh.ok` 指标断言         | 把 validatedAt 改成 60 天前 → 红                                       |

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

## L3 分层与最小门禁集合（落地）

> 实测环境：Windows 10 / PowerShell 5.1，本机串行执行（无并行编译/浏览器负载），2026-11-11。
> 数值落盘 `scripts/suite-budgets.json`（`capMs = ceil(实测×1.5/5000)×5000`），
> 报告入口 `node scripts/check-suite-budget.mjs --report`，断言入口
> `--assert-step <id> --ms <n>`（超 cap → exit 1；未知 id → exit 2）。

### a) 实测墙钟（命令 → 秒）

| 命令                                                               | 实测                                                                          | 预算 cap | 备注                                                        |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------- | -------- | ----------------------------------------------------------- |
| `npx vitest run tests/unit`                                        | 81.2s                                                                         | 125s     | unit 全量，全绿                                             |
| `npm run test:sim`                                                 | 29.3s                                                                         | 45s      | 4 sim + 5 integration（9 文件）                             |
| `E2E_MOCK=1 npm run e2e`                                           | 66.5s                                                                         | 100s     | 51 通过 / 0 失败（离线）                                    |
| `npm run visual`                                                   | 12.5s                                                                         | 20s      | 11 张基线                                                   |
| `npm run coverage:gate`                                            | 112.3s                                                                        | 170s     | 新增文件行覆盖（跑全量测试 + 覆盖率）                       |
| `node scripts/test-changed.mjs`（L1 批次 content/background 修复） | 102.5s                                                                        | —        | fast 的「受影响测试」步，5 related + 扫描器套件             |
| `npm run gate:fast`                                                | 136.5 / 136.7s（两次；当次仅 docs/scripts 变更 → vitest 步跳过、visual 跳过） | 360s     | 组合口径 ≈ 136.7 + 102.5 ≈ 238.9s（含受影响测试的普通批次） |
| `npm run gate`                                                     | 409.6s                                                                        | 615s     | 全量：vitest 两阶段 + 覆盖率快照 + E2E + visual + 打包      |

**结论（实测，不是估算）**：`gate:fast` 的 136s 里有 112s（82%）是 `coverage:gate`，
它是日常门禁的唯一成本大头；含受影响测试的普通批次约 4 分钟。
若要压到 30s 级，唯一有效改造点是把新增文件覆盖率改为增量/按模块切片——本轮不动
（那会削弱断言，不属于"最小必要"）。

预算在 `scripts/gate.mjs` 内按步骤生效：`coverage:gate` / `E2E 冒烟` / `visual`
逐步骤比对 cap（超预算该步骤直接判失败，打印
「墙钟超预算：xxx ms > yyy ms，先排除环境负载再重跑」），整条门禁再按
`gateFast` / `gateFull` 兜底总时长。

### b) 三个已知缺陷 → 快速门抓取命令与实测结果

三者都挂在 `gate:fast` 的 `verify:mutations` 步（本次实测 15.2s，4/4 PASS）。

| 缺陷（L1 修复）               | 复核命令                                                              | 实测结果                                                           |
| ----------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| appListIndex 写死 `main` 分支 | `node scripts/mutation-check.mjs --only=applist-branch-main`          | 红 exit 1（96ms，`check:ext-refs` 报「登记的引用在代码中不存在」） |
| 断网渲染成「未找到」          | `node scripts/mutation-check.mjs --only=network-rendered-as-notfound` | 红 exit 1（2.7s，`sim-list` 节 13 失败：`1 failed \| 10 passed`）  |
| 看门狗只写日志、UI 不动       | `node scripts/mutation-check.mjs --only=stall-heartbeat-log-only`     | 红 exit 1（12.0s，`test-ratings-resume` 停滞心跳断言失败）         |
| （附）语料无分母              | `node scripts/mutation-check.mjs --only=corpus-without-denominator`   | 红 exit 1（69ms）                                                  |

手工复现断网变异（把 `content/list/badges/core.js` 的分支改成 `if (false && ...)`）
后单跑 `npx vitest run tests/sim/sim-list.mjs`：2.7s 内 `FAIL ... 13. 断网故障渲染为
「网络异常」而非「未找到」`——缺陷确实被断言拦住，不是"门禁通过但没人测"。

已知噪音：该变异用例偶发在 240s 检查超时上界被判「门禁超时 → 判为未拦截」
（本次复跑出现 1 次，同批 `verify:mutations` 步内 4/4 通过；单独复现正常 2.7s）。
语义上仍是红（不会假绿），但排障时应先按环境抖动隔离复跑。

### c) 什么情况下可以只跑 `gate:fast` 就提交

**可信条件（须同时满足）**

1. 变更面不含跨层契约：没改 `background/core/message-contract.js`、`handlers.js`、
   响应形状、`data/storage-registry.js`、持久化格式、`shared/retrieval-vocab.js`、
   `content/module-manifest.js`。
2. 没新增 action、没新增/调整 `DEFAULT_SETTINGS` 键、没新增存储模块——
   这几类即使只跑 fast，也会被 `check:stubs` / 设置同步扫描器套件覆盖，
   但结论必须**逐条读**而不是只看 exit 0。
3. 改动面在 `scripts/test-changed.mjs` 的静态图内（content/background/shared 单文件级改动），
   且相关文件 ≤15 个、未触碰宽爆炸半径单源白名单
   （`core/constants|settings|rules`、`mechanisms.js`、`service-worker.js`、`data-store.js`、
   `tracker.js`、`sim-harness.mjs`、`vitest.config.js`、`shared/`、`tests/helpers/`、`data/`）——
   触碰白名单会自动升级为「related + 扫描器套件」定向验证，>15 文件自动升全量，
   这两种升级是可信的（选择器已实测覆盖 L1 批次：5 套件 / 102.5s）。
4. 仅改 docs/scripts/styles 时 fast 会跳过 vitest 与 visual（实测 136.7s），
   这类批次可只跑 fast。

**不适用（必须 `npm run gate` 全量）**

- 跨层契约/存储注册表/持久化格式/词表/内容模块清单改动——一次改动同时波及
  内容侧、后台、油猴快照三方（`test-userscript-pure` 只保证词表快照不漂移）。
- 发布触发点（大版本 / 5 次小版本 / 单次 >1000 行 / 累计 >3000 行）。
- 扩展页/样式/图标/manifest 变更——fast 的 visual 只按变更面渲染四页，
  发布前需整体渲染一次。
- sim/E2E 间歇红时：先隔离 3 连绿定性，再用全量确认，不要以「重跑绿了」结案。

**推断（无 CI 日志可查）**：`git log --oneline -20` 的 20 次提交中 4 次是
`chore(release)` 类发版提交（触发全量门禁），其余 16 次为功能/修复/文档批次。
按提交粒度推断「每完成一次改动平均跑全量门禁约 0.25 次、跑 gate:fast 约 1–2 次」——
**这是从提交序列推断，仓库内无 CI 日志/无门禁运行记录可查，非实测**。
