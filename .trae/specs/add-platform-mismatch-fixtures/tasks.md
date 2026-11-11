# Tasks

- [x] Task 1: 改写夹具驱动方式（名称索引 + fetch mock，替换缓存 seed）
  - [x] SubTask 1.1: 用 `createFetchMock/installFetchMock` 构造 storesearch + appdetails + appreviews + ISteamNews 响应
  - [x] SubTask 1.2: 每条夹具 `recordNameIndex(page, appId)` 模拟"错误 appId 被名称索引钉住"的真实症状
  - [x] SubTask 1.3: 删除已失效的 `seedDetail` 辅助函数
  - [x] SubTask 1.4: `beforeEach` 补 `resetAppDetailsDedupForTest()` + `resetRegistry()`（appdetails 10s 去重表跨用例串味，曾让对照用例读到首个夹具的响应）

- [x] Task 2: 6 条平台误配夹具逐条断言
  - [x] SubTask 2.1: 主机独占同名不同游戏、同系列差 1 代、差 2 代、重制版
  - [x] SubTask 2.2: 云游戏、移动端
  - [x] SubTask 2.3: 每条断言 `matchConfidence= suspected`、`matchNote` 精确文案、`matchPlatform`、`appId`、`name`、`matchName`、`detectOffSteamPlatform().kind`

- [x] Task 3: 保留 2 条对照组（多平台 / 显式 PC 标记 → confirmed）

- [x] Task 4: 删除临时文件 `tests/tmp-probe.mjs`

- [x] Task 5: 验证与汇报
  - [x] SubTask 5.1: `npx vitest run tests/unit/test-match-confidence.mjs` 全绿（25/25）
  - [ ] SubTask 5.2: `npm run gate:fast`
  - [x] SubTask 5.3: 输出「用例 / 判定 / 命中条目 / 是否达预期」表；附带上报观察到的缓存/测试隔离问题

# Task Dependencies
- Task 2 depends on Task 1
- Task 3 depends on Task 1
- Task 5 depends on Task 2、Task 3、Task 4
