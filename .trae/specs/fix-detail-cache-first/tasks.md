# 任务：修复详情缓存先行失效

## Task 1 单源完整性契约（storage 层）

- [x] 1.1 `background/storage/steam-cache.js`：`moduleOf` 之后新增 `DETAIL_SERVABLE_FIELDS`
      （`Object.freeze`）、`isDetailCacheComplete(entry)`（按 `moduleOf` 取模块；own property +
      `!== undefined`；`string` 非空 / `array` 数组）与 `pickFieldsForModules(data, modules)`
      （按 `moduleOf` 过滤字段，供部分刷新写缓存）。
- [x] 1.2 文件头注释补充：完整性契约与模块归属同源，判定处不另抄字段清单，并写明 TTL/失效语义。

## Task 2 调用点收敛 + 模块级部分刷新（steam / handlers）

- [x] 2.1 `background/steam/api-reviews.js`：删除 `isCompleteCacheData` 及重复注释块。
- [x] 2.2 `background/steam/api-assemble.js`：
      - `fetchSteamFullDetailsByAppId(appId, { refreshModules })` 按 plan 决定出站
        （meta 恒取；商店页/标签/公告仅 detail；appreviews 在 rating 或 detail；spy 仅 spy），
        返回 `pickFieldsForModules(结果, plan)`；无 plan = 全量旧行为；
      - 新增 `planDetailRefresh(entry, merged)`（meta 恒含；rating=无效/需重取/倒挂；
        detail=无效/不完整/缺 `cnReviewsFetchedAt`；spy=无效）；
      - DLC 切本体（appId 变化）时丢弃 plan 按全量拉取。
- [x] 2.3 `background/steam/orchestrator-detail.js`：
      - `tryCacheServed` 改判 `isDetailCacheComplete(cached)`；miss 时返回
        `{refreshModules, cachedMerged}`；补 TTL/失效语义注释；
      - `fetchDetailsResolveDlc(id, refreshModules)` 透传 plan；
      - `searchSteamGame` 用合并视图（`{...cachedMerged, ...picked}`）做相关性校验/UI/注册表，
        写缓存只写 picked；rating 未刷新时不改 `ratingFailCount`/走势。
- [x] 2.4 `background/handlers/steam.js`：
      - URL 索引缓存先行（原 131）改判 `isDetailCacheComplete(cachedEntry)`；
      - 直取路径（原 292-307）补完整性门槛，名称相关性改用合并视图的 `name`
        （原读 `detailData.name`，detail 模块恒无此字段）；
      - 商店页预取（原 509）改判 `isDetailCacheComplete(cached)`；
      - 三处 miss 时按 `planDetailRefresh` 部分刷新、写回 picked、返回合并视图；
      - 导入从 `api.js` 的旧函数切到新契约。

## Task 3 单测更新

- [x] 3.1 `tests/unit/test-api-pure.mjs` §0.10 用 `cacheMod.isDetailCacheComplete(entry)` 重写：
      完整条目 true（回归）、空值合法 true、轻量条目 false、meta 缺 `name` false、缺字段 false、
      `url:''` false、null false。
- [x] 3.2 运行 `npx vitest run tests/unit/test-api-pure.mjs` 全绿。

## Task 4 集成测试（零出站 / 部分刷新 / TTL 反向 / 假绿消除）

- [x] 4.1 `tests/integration/test-handlers.mjs`：describe 级 `beforeEach` 调
      `resetAppDetailsDedupForTest()`（顶层静态导入 `background/steam/api-details.js`）。
- [x] 4.2 既有「缓存先行直返」用例：完整缓存 → appdetails 出站 0；单独跑 + 整文件跑均绿。
- [x] 4.3 新增部分刷新用例：meta/rating/spy 有效、detail 缺 `userTags` → appdetails/商店页/
      评测/公告出站 > 0、**SteamSpy 出站 = 0**；响应字段齐全、meta 名称保留。
      实现退化为全量重拉时该用例必红（实测红后已还原）。
- [x] 4.4 新增 TTL 反向用例：`entry.modules.detail.ts = 0` → appdetails 出站 > 0；
      去掉 TTL 判定时必红（实测红后已还原）。
- [x] 4.5 运行 `npx vitest run tests/integration/test-handlers.mjs` 全绿，且单独 `-t` 复跑一致。

## Task 5 门禁与提交

- [x] 5.1 `node scripts/gen-module-index.mjs` → `npm run check:modules`。
- [x] 5.2 `npm run lint`、`npm run typecheck`、`node scripts/test-changed.mjs`、
      `node scripts/lint-ratchet.mjs`。
- [x] 5.3 独立提交（不 push、不动 adapters、不抬版本号），提交信息说明根因与前后请求数。

# Task Dependencies

- Task 2 依赖 Task 1
- Task 3 / Task 4 依赖 Task 2
- Task 5 依赖 Task 3、Task 4
