# 检查清单：修复详情缓存先行失效

## 判定契约

- [x] `steam-cache.js` 导出 `DETAIL_SERVABLE_FIELDS` / `isDetailCacheComplete` / `pickFieldsForModules`
- [x] 完整性判定经 `moduleOf(field)` 取字段所属模块，未另抄字段清单
- [x] 空值合法（`''`/`0`/`false`/`[]`）不被判为缺失；`undefined`/无 own property 才缺失
- [x] `isCompleteCacheData` 已删除，全仓无残留调用（仅 CHANGELOG/历史报告/规格文字提及）

## 调用点

- [x] `handlers/steam.js` URL 索引缓存先行 / 直取路径 / 商店页预取均用新判定
- [x] 直取路径名称相关性读合并视图 `name`，不再读 detail 模块的 `name`
- [x] `orchestrator-detail.js` `tryCacheServed` 用新判定，miss 返回部分刷新 plan
- [x] 三处 miss 均按 plan 只补缺失模块，写回 picked，返回合并视图

## 失效语义

- [x] detail TTL 过期仍触发重拉（反向用例证明；去掉 TTL 判定实测变红）
- [x] `needsRatingRefetch` / 倒挂 / 缺 `cnReviewsFetchedAt` / 名称不相关等既有失效语义保留
- [x] 部分刷新不会把 `cnReviewsFetchedAt` 写 0（detail 刷新必取评论）

## 测试

- [x] 单测 §0.10 全部通过，含"meta 缺 name → false"回归
- [x] 完整缓存 → appdetails 出站 0
- [x] 残缺缓存 → 只补 detail，SteamSpy 出站 0（全量重拉变异实测变红）
- [x] TTL 反向用例通过（去掉 TTL 判定实测变红）
- [x] 集成用例单独跑与整文件跑结果一致（describe 级 dedup + 熔断域重置）

## 门禁

- [x] `npm run lint` / `npm run typecheck` 通过
- [x] `node scripts/lint-ratchet.mjs` 通过
- [x] `npm run check:modules` 通过（INDEX 已重生成）
- [x] 独立提交（不 push、adapters 未动、版本号未抬）
