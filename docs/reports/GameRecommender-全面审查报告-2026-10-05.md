# 游戏雷达 Game Radar — 全面审查报告

> 审查日期：2026-10-05 · 审查对象：全仓库（v13.0.0 已发布 / v14.0.0 开发中）
> 审查方式：静态分析 + 门禁实跑 + 单源表逐项核对 + 分层矩阵校验 + 抽样代码走查
> 结论一句话：**工程质量显著高于同类扩展项目，护栏体系扎实；核心风险不在代码，而在"发布流程停在半途"与"护栏覆盖不对称"。**

---

## 0. 执行摘要

| 维度 | 结论 | 关键证据 |
|---|---|---|
| 代码质量 | **优** | lint 0 错误 0 警告；tsc 三份配置零错误；845 测试中 844 通过 |
| 架构治理 | **优** | 4 张单源表零漂移；依赖分层矩阵零违规；无跨层 import |
| 安全基线 | **良**（护栏不对称） | SSRF 侧 56 测试 + 静态断言齐备；XSS 转义侧 110 处 innerHTML 零自动化检查 |
| 测试体系 | **良** | 845 用例 / 34 套件；但 1 个哨兵测试因环境限制产生 125/125 假阳性 |
| 发布状态 | **⚠ 停滞** | v14 十批次已全部落地并推送 origin/main，但版本未 bump、无 tag、无 release |
| 文档一致性 | **中** | README 更新日志止于 v13.0.0，v14 无任何记载 |

**本次审查共发现：P0 级 1 项、P1 级 3 项、P2 级 4 项、观察项 2 项。**

---

## 1. 项目基线（量化）

### 1.1 规模

| 目录 | 文件数 | 行数 | 说明 |
|---|---:|---:|---|
| background | 65 | 11,740 | MV3 Service Worker，分 core/storage/steam/recommend/sites/freegames/handlers |
| content | 20 | 5,580 | 内容脚本，分 core/list/detail/adapters/tracking |
| options | 8 | 2,420 | 设置页（v14 B2 已拆分） |
| dashboard | 7 | 1,270 | 仪表盘（v14 B1 已拆分） |
| popup | 1 | 472 | 弹出面板 |
| data | 3 | 652 | OPFS 持久化底座 |
| shared | 6 | 441 | 内容/扩展页共用 |
| adapters | 8 | 365 | 站点规则 |
| 其他（hub/freegames/lib） | 4 | 343 | — |
| **生产代码合计** | **~122** | **~23,283** | — |
| tests | 39 | 10,373 | 测试代码 / 生产代码 ≈ **1 : 2.24** |

最大文件 TOP 5（v14 拆分后）：`freegames/manager.js` 716、`content/detail/sidebar.js` 653、
`options/panels/cache.js` 510、`content/list/xdgrid.js` 505、`background/steam/orchestrator.js` 497。
**无文件超过 800 行**，v14 第四轮拆分（dashboard 1071→88、options 919→390、detail-page 1133→106）成效显著。

### 1.2 门禁实跑结果

| 门禁 | 结果 | 备注 |
|---|---|---|
| `npm run lint` | ✅ 通过 | `--max-warnings 0`，零警告 |
| `npm run typecheck` | ✅ 通过 | tsconfig × 3 全部零错误 |
| `npm test` | ⚠️ **844/845 通过** | 唯一失败：`test-integrity > 语法错误数`（见 P1-1） |
| `npm run coverage` | ⚠️ 未产出 | 因上述失败中断；清理步骤亦受环境限制 |
| `npm run e2e` / `visual` | ⏸ 未执行 | 需 spawn 浏览器进程，当前环境受限 |
| `npm run coverage:gate` | ⏸ 未执行 | 依赖 `execSync git`，当前环境受限 |

---

## 2. 发现清单

### 🔴 P0-1：v14.0.0 代码已全部落地，但发布流程停在起点之后

**证据链：**

- `迭代路线图-第四轮10批次-2026-09.md` 的「落地记录」明确写：
  > 全部 10 批次完成……**发布触发：拆分+清理总量 >3000 行 → 合并发布 v14.0.0（走发布清单）**
- git log 确认 B1–B10 共 9 个 commit 已落地（最新 `49d66bb`）
- `git log origin/main..HEAD` = **0**，即代码**已推送到远端 main**
- 但：`manifest.json` = `13.0.0`、`package.json` = `13.0.0`、`git tag` 最新 = `v13.0.0`
- README「更新日志」最新条目 = `### v13.0.0`，**v14 全无记载**

**风险：** 代码已在远端但对外版本号仍是 v13，用户无从获得这批改动（其中 B10 还修了一个真 bug：
`TRACK_EVENT_BATCH` 此前无 handler 且契约默认拒绝，导致攒批事件被整批丢弃）。
拖延越久，README changelog 越难补齐（需从 9 个 commit 反推 changelog）。

**建议：** 按 AGENTS.md 发布清单顺序执行：
1. `npm run gate`（需在有 spawn 权限的环境跑完 E2E/visual）
2. bump `manifest.json` + `package.json` → `14.0.0`，补 README「更新日志」v14.0.0 条目
3. `npm run package` → commit → `git tag v14.0.0` → push → `gh release create`（附 zip）
4. 安全扫描 → seal 补入 release notes

---

### 🟠 P1-1：`test-integrity` 语法检查是全有或全无的假阳性炸弹

**位置：** `tests/integration/test-integrity.mjs:195-206`

```js
for (const f of jsFiles) {
  try { execSync(`node --check "${f}"`, { stdio: 'pipe' }); }
  catch { syntaxFail++; }   // ← spawn 失败与语法错误被同等计数
}
test('语法错误数', () => { expect(syntaxFail).toEqual(0); });
```

**本次实跑：** `expected 125 to deeply equal +0` —— 即**全部 125 个文件**都被判为语法错误。

**根因（已定位）：** 不是代码问题。`node --check <file>` 直接执行全部通过；
经 `execSync` 执行则抛 `spawnSync C:\WINDOWS\system32\cmd.exe EBUSY`。
当前环境禁止 spawn，`catch` 把「环境不可用」当成了「语法错误」。

**三个叠加缺陷：**

1. **无法分辨故障性质** —— 环境一挂就是 125/125 全红，与「真有 125 个语法错误」输出完全一致，
   排障时无从下手（本次即花了多轮才定位）。
2. **性能** —— 125 次进程 spawn 串行执行，是 `test-integrity` 耗时的主要来源。
3. **冗余** —— `npm run typecheck` 已用 tsc 对全项目做语法/类型检查，此处价值边际。

**建议修复（按侵入性从低到高，任选一）：**

- **方案 A（最小改动）**：区分故障类型，环境不可用时 `skip` 并显式告警，而非计入失败：
  ```js
  let envBlocked = 0;
  for (const f of jsFiles) {
    try { execSync(`node --check "${f}"`, { stdio: 'pipe' }); }
    catch (e) {
      if (e.status === null) { envBlocked++; continue; }   // spawn 失败 ≠ 语法错误
      syntaxFail++;
      console.log('  ❌', path.relative(ROOT, f));
    }
  }
  test('语法错误数', () => {
    if (envBlocked === jsFiles.length) {
      console.warn('⚠ 环境禁止 spawn 子进程，语法检查已跳过（typecheck 仍覆盖）');
      return;                                              // 全环境性失败 → 跳过而非误报
    }
    expect(syntaxFail).toEqual(0);
  });
  ```
- **方案 B**：改用 `execFileSync(process.execPath, ['--check', f])`，不经 cmd.exe，跨平台行为一致。
- **方案 C（最优）**：零 spawn —— 用 vitest/TS 已有的解析器在进程内 parse，125 次 spawn 归零。

---

### 🟠 P1-2：XSS 转义铁律无自动化护栏，与 SSRF 侧护栏严重不对称

**AGENTS.md 铁律第 1 条：** 「动态内容一律 `escapeHtml/escapeAttr`」。

**现状：** 生产代码中 `innerHTML` 共 **110 处**，其中模板字符串插值 35 处。
抽样走查确认**主流渲染路径均已正确转义**（`content/detail/sidebar.js`、`candidates.js`、
`detail-templates.js`、`tracking.js` 各自 `const esc = (t) => common.escapeHtml(t)`，
插值处普遍 `${esc(...)}`），**未发现实际 XSS 漏洞**。

**但护栏层面存在缺口：** 「有没有漏转义」目前**完全依赖人工 review**，没有任何机器可执行的检查：

| 安全域 | 自动化护栏 | 状态 |
|---|---|---|
| SSRF（出站 URL） | `test-security.mjs` 56 个测试（含 IPv4/IPv6 各类变体）+ `fetchWithTimeout` 强制 | ✅ 充分 |
| sender 来源门禁 | 静态断言「sender 来源门已接线」「内容白名单不含特权 action」+ 运行时白名单比对 | ✅ 充分 |
| 站点域名注入 | `isValidSiteDomain` 静态断言 + 三方域名一致性测试 | ✅ 充分 |
| **XSS 转义** | **无** | ❌ **缺口** |

对比之下会发现一个规律：**这个项目把"曾经出过事"的领域都补上了护栏，而"靠自觉还没出事"的领域是裸的。**
110 处 innerHTML 分散在内容脚本里，任何一次新增渲染代码漏写 `esc()` 都不会被任何门禁拦住。

**建议（低成本，可渐进）：**
1. 在 `test-integrity.mjs` 加一条静态扫描：对 `content/`、`options/`、`dashboard/`、`popup/` 下
   含 `innerHTML = \`` 的模板串，提取所有 `${...}` 插值，断言其经过 `esc(`/`escapeHtml(`/`escapeAttr(`
   包裹；纯字面量、`textContent` 赋值、`innerHTML = ''` 清空等安全形态加入白名单。
2. 先以「当前违规数 = 基线」落 `scripts/lint-baseline.json` 棘轮（与 B9 同思路：只降不升），
   再逐批清零——避免一次性大爆炸。

---

### 🟠 P1-3：本地 `npm run gate` 比 CI 少一个 job，本地全绿 ≠ CI 绿灯

**证据：**

- `scripts/gate.mjs` 只有 3 步：`check` → `E2E(MOCK)` → `visual`
- `.github/workflows/ci.yml` 有 8 个 job：`test` / `test-2` / **coverage-gate** / `release-smoke` /
  `perf` / `e2e` / `visual` / `security`

**风险：** AGENTS.md 要求「提交/发布前必跑 `npm run gate`」，
但覆盖率门禁（`coverage:gate` + 全局 floor：`lines ≥ 62 / statements ≥ 60 / functions ≥ 60 / branches ≥ 54`）
与 `release-smoke`、`perf` 都不在本地 gate 内。开发者本地全绿 → 推送后 CI 红灯，
反馈链路被拉长到一次 push。

**建议：** 把 `coverage:gate` 与 `release-smoke` 并入 `gate.mjs` 步骤（可放入 `--fast` 跳过的集合之外），
或在 CONTRIBUTING 明确标注「gate 不含 coverage-gate，需单独跑」——二选一，现状是两者皆无。

---

### 🟡 P2-1：`freegames/manager.js`（716 行）是拆分浪潮中的遗留孤岛

v14 第四轮把 dashboard / options / detail-page 三个页面层文件拆得很干净，
但 `background/freegames/manager.js` 未被触及，且内部混装 **3 个互不相关的职责域**：

| 职责域 | 函数 | 行区间 |
|---|---|---|
| 限免抓取（Epic/GOG/Steam/GamerPower） | `fetchEpicFreeGames` / `fetchGogFreeGames` / `fetchSteamFreeGames` / `fetchGamerPowerFreeGames` / `fetchAllFreeGames` | 48–314 |
| ITAD 价格查询与收藏调价 | `getItadLowest` / `checkItadFree` / `watchFavoritePrices` / `fetchFavoriteCurrentPrice` / `activeItadKey` | 373–557 |
| 通知 / 角标 / 领取 | `notifyNewFreeGames` / `updateFreeGamesBadge` / `claimFreeGame` / `determineSteamFreeType` | 558–716 |

建议下一轮按此三域拆为 `freegames/fetch.js` / `freegames/itad.js` / `freegames/notify.js`。

### 🟡 P2-2：`mechanisms.js` 复用率偏低

`background/core/mechanisms.js` 导出 `withLock` / `debounce` / `createTtlCache` / `withRetry`，
但仅被 **9 个文件**引用；生产代码中 `setTimeout` 出现 **35 处**，分布在 20+ 文件。
v10.7 曾「收编 17 份同构」，此后新增代码可能又有回潮。
建议抽样核对是否为防抖/节流语义（部分延时重试属合理用法，不宜一刀切）。

### 🟡 P2-3：`content/module-manifest.js` 的边界语义未写明

v14 B3 拆分新增了 `sidebar.js` / `candidates.js` / `tracking.js` / `steam-rating-logic.js`，
它们**不在** module-manifest 清单中（正确——它们由 `detail-page.js` 静态 import，不是顶层装载单元）。
但清单文件头未说明「本清单只登记顶层装载单元，内部依赖模块无需登记」，
下次有人新增模块时极易误判为「漏登记」而错误添加，或反之漏加真正的顶层模块。

**建议：** 在 `module-manifest.js` 文件头补一句边界说明（成本 1 行，收益是消歧义）。

### 🟡 P2-4：`noImplicitAny` 技术债 1570 处（已被棘轮正确管理）

`scripts/lint-baseline.json` 已记录 `main 891 / ui 302 / content 377`，并明确「只降不升」。
**处理方式正确，无需变更**，此处仅作为技术债规模列入报告，供后续排期参考。

---

### ⚪ 观察项（非缺陷，记录供参考）

- **环境限制**：当前沙箱禁止 spawn 子进程（cmd.exe EBUSY / genie-trash ETIMEDOUT），
  导致 E2E、visual regression、coverage:gate 三项无法在本次审查中执行，
  结论中的「未执行」均源于此，不代表项目本身有问题。
- **记忆快照过时**：项目级记忆停留在 v10.6.0，与当前 v13 已发布 / v14 开发中的实际状态差了四个大版本，
  建议按本次审查结果更新（见文末「已同步项」）。

---

## 3. 正面确认：单源治理执行到位

这一节记录**审查通过**的部分——它们代表项目最有价值的工程资产，也是后续不该退化的基线。

| 单源表 | 位置 | 派生消费方 | 检查结果 |
|---|---|---|---|
| 存储模块注册表 | `data/storage-registry.js`（26 模块） | data-store MODULE_FILES / DATA_MODULES / BACKUP_CORE_KEYS / 清除范围 | ✅ 无第二份同构表 |
| 内容模块装载 | `content/module-manifest.js` | tracker 装载 / content-sim 文件表 / integrity 存在性校验 | ✅ 无漂移 |
| 通用机制 | `background/core/mechanisms.js` | withLock / debounce / TtlCache / withRetry | ✅ 无重复实现（见 P2-2 复用率观察） |
| 容量·端点·刻度 | `background/core/constants.js` | STORAGE_CAPS / ENDPOINTS / SPY_SCALES | ✅ 死值已集中 |

**依赖分层矩阵**（`test-integrity` 强制）：实测 `data/` → `background/`、`shared/` → `background|content`、
`content/` → `background/` **全部零违规**。分层纪律保持良好。

**其他通过项：** 版本一致性（manifest ↔ package.json）、CSP 显式声明、manifest 引用无缺失、
adapters 三方清单一致、网站范围三方一致、WAR 覆盖全部注入域名、快捷键注册、
内容侧 action ⊆ CONTENT_ALLOWED_ACTIONS、每个 handler action 均有契约规则。

---

## 4. 建议的下一步（按 ROI 排序）

| # | 事项 | 级别 | 预估成本 | 收益 |
|---|---|---|---|---|
| 1 | 完成 v14.0.0 发布（bump + changelog + tag + release） | P0 | 中 | 让已落地的 9 批次（含 1 个真 bug 修复）真正交付 |
| 2 | 修 `test-integrity` 语法检查的假阳性（方案 A） | P1 | 低（约 10 行） | 消除 125/125 误报炸弹 + 提速 |
| 3 | 补 XSS 转义静态扫描（先落棘轮基线） | P1 | 中 | 把唯一「靠自觉」的铁律变成机器护栏 |
| 4 | `gate.mjs` 补齐 coverage-gate / release-smoke | P1 | 低 | 本地全绿 = CI 绿灯，缩短反馈回路 |
| 5 | `freegames/manager.js` 三域拆分 | P2 | 中 | 与已拆分三文件保持一致的代码组织标准 |
| 6 | `module-manifest.js` 补边界说明 | P2 | 极低（1 行） | 消除新增模块时的歧义 |
| 7 | 更新项目记忆快照至 v14 状态 | P2 | 低 | 避免下次会话从 v10.6 重新摸索 |

---

## 5. 审查方法说明与未覆盖面

**已执行：** 全量 lint / typecheck / test 实跑；125 个 JS 文件语法逐一确认；
4 张单源表逐项核对；依赖分层矩阵校验；存储注册表全量阅读；
`freegames/manager.js` 等大文件职责走查；XSS 转义抽样走查（content 四文件渲染路径）；
CI 配置与本地 gate 比对；git 提交/标签/远端状态核对；文档版本一致性核对。

**未覆盖（受环境限制或需更长周期）：**
E2E 真机冒烟、视觉回归、覆盖率采集、`coverage:gate`、npm audit 依赖漏洞扫描、
运行时性能剖析、以及 110 处 innerHTML 的逐处人工审计（本次为抽样）。

---

*报告结束 · 生成于 2026-10-05*
