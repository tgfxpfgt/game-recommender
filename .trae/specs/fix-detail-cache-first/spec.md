# 修复详情缓存先行失效（`isCompleteCacheData` 恒假）

## 结论（先行）

- **根因**：`isCompleteCacheData(data)` 的入参是 **detail 模块数据**，却要求 `data.name` 与
  `data.headerImage`。这两个字段按 `FIELD_MODULES` 归属 **meta 模块**，detail 模块永远不会有
  → 判定**恒假** → 缓存先行路径从不命中 → 每次打开详情/浮窗全量出站（约 6 个请求），
  v14.24.0 宣称的「零出站」实际未生效。
- **修法**：把「一份可服务的详情缓存由哪些字段构成」做成 **单源契约**，放在
  `background/storage/steam-cache.js`（`FIELD_MODULES` 的同一归属地），判定按 `moduleOf(field)`
  读取字段实际所属模块；`api-reviews.js` 的旧函数删除，所有调用点改用新判定。
- **语义**：字段「存在即可」——`name: ''`、`chineseSupported: false`、`releaseDate: ''`、
  `description: ''`、`genres: []` 等都是合法值；缺失（无 own property / `undefined`）才不完整。
  仅 `url` / `headerImage` 要求非空字符串（无链接/无封面无法渲染）。
- **失效语义保留**：detail 模块 TTL（默认 72h）、rating 重取、倒挂污染、缺
  `cnReviewsFetchedAt`、名称不相关、Demo 无评分——缓存先行 ≠ 永久缓存。
- **假绿消除**：集成套件在 describe 级 `beforeEach` 调 `resetAppDetailsDedupForTest()`，
  appdetails 的 10s 去重表不再跨用例串味；单独跑与整文件跑结果一致。

## 根因证据（改前）

- `tests/integration/test-handlers.mjs` 的「URL 命中 + 完整缓存 → 缓存先行直返」用例：
  单独运行 **红**（`after === before` 为 false），整文件运行 **绿**（前序用例已把
  `appids=3764200&l=schinese` 的 resolved promise 写进去重表，全量拉取被去重吞掉，未产生新请求）。
- 判定位置：`background/steam/api-reviews.js` 第 77 行 `isCompleteCacheData`，调用点 4 处：
  `handlers/steam.js:131`、`handlers/steam.js:509`、`orchestrator-detail.js:403`
  （`handlers/steam.js:292` 的直取路径未做完整性判定）。

## 修复设计

### 1) 单源完整性契约（`background/storage/steam-cache.js`）

在 `moduleOf` 之后新增：

```js
/**
 * 详情页可服务缓存的字段契约（单源）：字段 → 值规则。
 * 模块来源一律由 moduleOf/FIELD_MODULES 决定，判定处不再另抄模块归属。
 * 'present' = 字段存在即可（空串/0/false/[] 都是合法值）；
 * 'string'  = 存在且为非空字符串；'array' = 存在且为数组（空数组合法）。
 */
export const DETAIL_SERVABLE_FIELDS = Object.freeze({
  url: 'string',
  name: 'present',
  headerImage: 'string',
  genres: 'array',
  userTags: 'array',
  developers: 'array',
  chineseSupported: 'present',
  releaseDate: 'present',
  description: 'present'
});

export function isDetailCacheComplete(entry) { ... }
```

`isDetailCacheComplete(entry)` 逻辑：

1. `entry.modules` 不存在 → false；
2. 遍历契约：`const mod = entry.modules[moduleOf(field)]`，`mod.data` 必须是对象；
3. `Object.prototype.hasOwnProperty.call(mod.data, field)` 且值 `!== undefined`（区分缺失/为空）；
4. `string` 规则要求 `typeof value === 'string' && value !== ''`；
5. `array` 规则要求 `Array.isArray(value)`（空数组通过）。

### 2) 调用点收敛

| 文件 | 改动 |
| --- | --- |
| `background/steam/api-reviews.js` | 删除 `isCompleteCacheData` 及其注释块（被单源判定取代）；`api.js` 的 `export *` 自动不再导出 |
| `background/steam/orchestrator-detail.js` | 从 `api.js` 导入列表移除 `isCompleteCacheData`；从 `../storage/steam-cache.js` 导入 `isDetailCacheComplete`；`tryCacheServed` 改判 `isDetailCacheComplete(cached)`（入参由 detail 数据改为完整 entry） |
| `background/handlers/steam.js` | 三处改用 `isDetailCacheComplete`：URL 索引缓存先行（131）、直取路径补完整性门槛（292-307）、商店页预取（509）；从 steam-cache 导入 |
| `docs/modules/INDEX.md` | `node scripts/gen-module-index.mjs` 重生成（导出面变化） |

### 3) 部分刷新（模块级增量拉取，用户硬要求）

缓存残缺时**只补缺失模块**，不是全量重拉：

- `steam-cache.js` 提供 `pickFieldsForModules(data, modules)`（按 `moduleOf` 过滤字段）与
  `isDetailCacheComplete(entry)`；`api-assemble.js` 提供 `planDetailRefresh(entry, merged)`：
  - `meta` 恒含（appId 校验 / DLC 解析 / 中英文名必需）；
  - `rating`：模块无效、`needsRatingRefetch` 或 `hasInvertedReviewCounts`；
  - `detail`：模块无效、完整性判定失败、或缺 `cnReviewsFetchedAt`；
  - `spy`：模块无效。
- `fetchSteamFullDetailsByAppId(appId, { refreshModules })`：按 plan 决定出站——商店页 /
  标签 / 公告仅 `detail`；`appreviews` 在 `rating` 或 `detail` 时取（评论正文属 detail，
  且回填标记必须随之写入，避免"刷新 detail 却把标记写 0"的死循环）；SteamSpy 仅 `spy`。
  返回 `pickFieldsForModules(结果, plan)`；无 plan = 全量（旧行为）。
- 调用方：写缓存只写 picked（未涉及模块的字段与 ts 不动）；返回 UI 用
  `{...cachedMerged, ...picked}` 合并视图；注册表/名称索引读合并视图。
- DLC 解析切到本体（appId 变化）时 plan 失效 → 本体按全量拉取。

### 4) TTL / 失效语义（保留并在注释中写明）

命中缓存后仍会重拉的情形：

- `detail` 模块超过 `detailSteamCacheTtlMs()`（默认 72h）→ `isModuleValid` 失败；
- `needsRatingRefetch`（0 评测冷却 / 失败固化）；
- `hasInvertedReviewCounts`（好评数倒挂自愈）；
- 缺 `cnReviewsFetchedAt`（一次评论回填）；
- `!namesRelated(gameName, name)`（名称不相关）；
- Demo 缓存无评分 / appId 本身为 Demo → 重搜完整版。

### 5) 测试

**单测** `tests/unit/test-api-pure.mjs` §0.10（替换原 `icd` 用例）：

- 完整模块化条目（`name`/`headerImage` 在 meta，detail 字段齐全）→ **true**（回归：旧判定恒假）；
- 空值合法：`name:''`、`chineseSupported:false`、`releaseDate:''`、`description:''`、`genres:[]`、
  `userTags:[]`、`developers:[]` → **true**；
- 轻量列表条目（仅 meta+rating，无 detail）→ false；
- meta 缺 `name` → false（回归：证明字段确实从 meta 读，而非 detail）；
- 缺 `userTags` → false；`url:''` → false；`null` → false。

**集成** `tests/integration/test-handlers.mjs`：

- describe 级 `beforeEach`：`resetAppDetailsDedupForTest()`（导入自 `background/steam/api-details.js`），
  消除 appdetails 10s 去重表跨用例掩盖；
- 完整缓存 → appdetails 出站数 **0**（既有用例，修复后真绿，单独跑/整文件跑一致）；
- 残缺缓存（meta/rating/spy 有效，detail 缺 `userTags`）→ **只补 detail**：appdetails / 商店页 /
  评测 / 公告出站 > 0，**SteamSpy 出站 = 0**；响应字段齐全且 meta 名称保留。该断言在实现退化为
  全量重拉时必红（spy 会被调用）；
- 反向 TTL：把 `entry.modules.detail.ts` 置 0 → appdetails 出站 > 0（证明 TTL 仍生效、不是永久缓存；
  去掉 TTL 判定时该用例必红）。

## 验证命令

```bash
npx vitest run tests/unit/test-api-pure.mjs tests/integration/test-handlers.mjs
npx vitest run tests/integration/test-handlers.mjs -t "缓存先行直返"   # 单独跑
npm run lint && npm run typecheck
node scripts/test-changed.mjs background/storage/steam-cache.js background/steam/api-reviews.js background/steam/orchestrator-detail.js background/handlers/steam.js tests/unit/test-api-pure.mjs tests/integration/test-handlers.mjs
node scripts/lint-ratchet.mjs
node scripts/gen-module-index.mjs && npm run check:modules
```

## 边界

- 独立提交，不 push；`adapters/` 8 个文件不动；不为凑门禁抬 minor。
- 本次包含模块级部分刷新（见 3），不做"字段级单独请求"的进一步拆分。
