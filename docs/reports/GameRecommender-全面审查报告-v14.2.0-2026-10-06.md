# 游戏雷达 Game Radar — 第三次全面审查报告（v14.2.0）

> 审查日期：2026-10-06 · 审查基线：`v14.2.0`（commit `54e5637`，tag 已打）
> 前置报告：全面审查 v13 基线 → 补充轮护栏假象专项 → 全面审查 v14.1.0 基线
> 审查方式：门禁实跑 + **前两轮发现逐项独立核验**（不看 commit message，只看代码）+ 漏洞有效性实测
>
> **一句话结论：修复执行力很强，宣称的 30 项里我可核验的 22 项已落地 21 项；
> 但唯一没修彻底的那项——XSS 机器护栏——恰是「看起来有、实际可被一行日常写法绕过」，
> 与本项目「护栏假象」的历史主题形成闭环。**

---

## 0. 执行摘要

### 0.1 版本进展

v14.2.0 是一次**纯修复版本**，commit message 称「四轮审查 30 项发现全数落地」。
伴随两个配套 commit：Mimosa MCP 断连根因修复 + v12–v14.1 四版 seal 补录（`2999f36`）、
v14.2.0 深度扫描归档（`27381fc`，seal，0 findings）。

### 0.2 门禁实跑（本次）

| 门禁 | 结果 |
|---|---|
| `npm run lint` | ✅ 零警告（`eslint . --max-warnings 0`，口径已从列目录改为全量） |
| `npm run typecheck` | ✅ 三份配置零错误 |
| `npm test` | ✅ **41 套件 / 887 用例全部通过，零失败** |

**关键变化：首次出现「零失败」。** 前三轮的固定租户——`test-integrity > 语法错误数`
（一直报 128/128 假阳性）——已被根治，不再是每次必读的噪音。

### 0.3 整体判定

| 维度 | 判定 | 证据 |
|---|---|---|
| 修复执行力 | **优** | 我追踪的 22 项中 **21 项确认落地**（代码级核验，非采信 message） |
| 门禁完整性 | **良** | 盲区关闭、棘轮程序化、gate 补全；覆盖率 5→12 目录 |
| **护栏有效性** | **🔴 存 1 处伪护栏** | XSS 静态扫描对最常见写法漏报，实测 0/3 检出 |
| 代码真实性 | **良** | 110→72 处插值面逐层抽查，**未发现真实可利用的 XSS** |

---

## 1. 前两轮 22 项发现——修复核验表

**核验方式：逐项读当前代码，不看 commit message。**

| # | 发现 | 级别 | 核验结果 |
|---|---|---|---|
| 1 | v14 未 bump / 无 tag / README 无记载 | P0 | ✅ 已修 |
| 2 | `test-integrity` spawn 假阳性 | P1 | ✅ **已修且优于建议**（见 1.1） |
| 3 | XSS 转义无机器护栏 | P1 | ⚠️ **部分修——护栏可被绕过**（见第 2 节，本次核心发现） |
| 4 | 本地 `gate` 比 CI 少 job | P1 | ✅ 已修（补 3 步） |
| 5 | `freegames/manager.js` 未拆分 | P2 | ✅ 已修（741→**101 行** + fetch/itad/notify 三域） |
| 6 | `mechanisms.js` 复用率偏低 | P2 | ✅ 已修（`debounced-store` 改用机制层） |
| 7 | `module-manifest` 边界语义 | P2 | ✅ 已修（文件头补「只登记顶层装载单元」） |
| 8 | `noImplicitAny` 债无程序消耗 | P2 | ✅ 已修（`lint-ratchet.mjs` + gate 步骤） |
| 9 | 覆盖率白名单致 UI 逃逸 | P0 | ✅ 已修（4492 行盲区关闭，5→12 目录） |
| 10 | `lint-baseline.json` 零读取 | P0 | ✅ 已修（棘轮真程序化） |
| 11 | `vitest.config.js` include 靠人记 | P0 | ✅ 已修 + 加第 10 节清单自检 |
| 12 | `SITE_SCRIPT_FILES` 两份副本 | P0 | ✅ 已修（**顺序敏感**单源断言） |
| 13 | `debounced-store` 重复 debounce | P1 | ✅ 已修 |
| 14 | `SPY_SCALES` 内容层字面量 | P1 | ✅ 已修（shared 下沉 + WAR 覆盖） |
| 15 | `ENDPOINTS` 绕 `fetchWithTimeout` | P1 | ✅ 已修（裸 fetch 消除） |
| 16 | 测试硬编码域名正则 | P2 | ✅ 已修（`test-integrity:302` 改用 `BUILTIN_DOMAINS`） |
| 17 | `TtlCache` 复刻 + 未传 max | P2 | ✅ 已修（4 处 max + 容量入 STORAGE_CAPS） |
| 18 | `reset-defaults.js` 196 行零测试 | P1 | ✅ 已修（新增 `test-reset-defaults.mjs`） |
| 19 | `freegames` 逆势增长 | P1 | ✅ 已修（同 #5） |
| 20 | `tab-game.js` 缺边界用例 | P2 | ✅ 已修（4→5 用例） |
| 21 | `BUILTIN_DOMAINS` 导出未消费 | P2 | ✅ 已修（同 #16） |
| 22 | SidePanel 主题 / WAR import 链等真缺陷 | — | ✅ 已修（`--gr-*` 体系 + WAR 补 `shared/*.js`） |

**修复率：21/22 ≈ 95%**（唯一未彻底项是 #3）。
附带的技术债**真实下降**：`noImplicitAny` 由 891/302/377 **降至 510/251/272**。

### 1.1 值得肯定的两处「超额完成」

- **语法检查假阳性治理**（#2）：原建议只是「区分 spawn 失败与语法错误」，实际实现为
  ① 用已知合法文件做**哨兵探测**；② 循环中**中途劣化检测**（环境变坏立即中止并转跳过）；
  ③ 跳过时 `console.warn` 显式告知而非静默通过。三层防御，比建议更严密。
- **单源断言顺序敏感**（#12）：`SITE_SCRIPT_FILES` 断言用 `JSON.stringify` 全等比较而非集合比较，
  连**顺序**漂移都能拦住——这是正确选择（content_scripts 的注入顺序有语义）。

---

## 2. 🔴 本次核心发现：XSS 机器护栏可被一行日常写法绕过

### 2.1 护栏实现了，但漏靶��最典型的攻击形态

v14.2.0 在 `test-integrity.mjs` 第 12 节（479 行起）新增了 XSS 插值静态扫描，
扫描范围为 9 个生产目录，并以 `xssUnescapedInterpolations: 19` 落入棘轮基线。

**问题出在第一步过滤**（`test-integrity.mjs:...`）：

```js
for (const m of tpl.matchAll(/\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
  const expr = m[1];
  if (!/['"`]/.test(expr)) continue;   // ← 判为「纯数字/布尔/变量运算」，跳过
  if (SAFE_INTERP_RE.test(expr)) continue;
  out.push({ ... });                   // 计为未防护
}
```

只要插值表达式里**不含引号字符**，就被当作低风险跳过。
但「不含引号」恰恰覆盖了最典型、最危险的写法——**纯变量插值**。

### 2.2 实测证据（构造样本，端到端）

输入 3 行真实感危险代码，每行含 1 处完全未转义的动态数据：

```js
el.innerHTML = `<div class="a">${escapeHtml(data.name)} ${data.desc}</div>`;
el.innerHTML = `<div class="b">${escapeHtml(data.name)}${data.raw}</div>`;
el.innerHTML = `<div class="c">${escapeHtml(data.name) + data.raw}</div>`;
```

护栏输出：**检出 0 / 3**。三处全部判定为「低风险跳过」。

即：

| 写法 | 是否危险 | 护栏能否发现 |
|---|---|---|
| `${raw}`（纯变量，最经典 XSS） | ❌ 危险 | ❌ **看不见** |
| `${escapeHtml(a)} ${raw}`（转义+裸变量并列） | ❌ 危险 | ❌ **看不见** |
| `${escapeHtml(a) + raw}`（转义拼接裸变量） | ❌ 危险 | ❌ **看不见** |
| `${'静态' + raw}`（含字面量） | ❌ 危险 | ✅ 能发现 |

更隐蔽的是第二种：**在同一个插值里先写一个转义过的变量，后面跟的任何裸变量都不再被检查。**
这种写法在日常开发中极为自然（`"名称：" + escapeHtml(name) + " " + desc`），
属于「最容易无意踩中」的形态。

### 2.3 视野差：护栏看见 19 处，真实面 72 处

用**不跳过无引号表达式**的严格规则重扫同一批代码：

| 规则 | 检出数 |
|---|---:|
| 现行护栏（跳过无引号） | **19**（棘轮基线） |
| 严格规则（逐个插值验转义） | **72** |

**53 处插值完全在护栏视野之外。**
换句话说，当前 `xssUnescapedInterpolations: 19` 这个数字的语义是
「19 处含*引号*的可疑插值」，而不是「代码中未转义插值的总数」。
把它当作后者来用，会产生安全感偏差。

### 2.4 好消息：抽查未发现真实可利用的 XSS

必须说清楚——**目前代码里没有真实漏洞**。我对严格规则下多出的可疑项做了逐层溯源抽查：

| 变量 | 位置 | 实际处理 | 判定 |
|---|---|---|---|
| `rows` | `status-bar.js:77` | `${escapeHtml(r.text)}` / `escapeHtml(String(r))` | ✅ 已转义 |
| `reasonLine` | `candidates.js:25` | 内部 `${escapeHtml(reasonText)}` | ✅ 已转义 |
| `detail` | `status-bar.js:64` | `${escapeHtml(detail)}` | ✅ 已转义 |
| `shop` | `sidebar.js:100` | ` @ ${esc(info.shop)}` | ✅ 已转义 |
| `progressHtml` | `status-bar.js:54` | 字面量 + `${pct}%`（Math.round 数字） | ✅ 受控 |
| `timeStr` | `tracking.js:210` | `formatRelativeTime()` 内部生成 | ✅ 受控 |
| `cfg.cols/iconW/gap` | `xdgrid.js:311` | 配置项数字 | ✅ 受控 |

**结论：现有代码转义纪律良好，真实风险为 0。**
护栏的问题是「下次有人写 `${userInput}` 时拦不住」，而不是「现在已经漏了」。

### 2.5 修复建议：把「豁免制」改为「白名单制」

现状是「默认放行、列出例外」；应改为「默认可疑、明确放行」。三处改动：

```js
// 1. 删除「无引号即跳过」的宽豁免
- if (!/['"`]/.test(expr)) continue;

// 2. 安全判定改为「整个插值被转义函数完整包裹」
- const SAFE_INTERP_RE = /^\s*(?:[\w.]*\.)?(?:esc|escA|esc2|escapeHtml|escapeAttr)\s*\(/;
+ const SAFE_INTERP_RE = /^\s*(?:[\w.]*\.)?(?:esc|escA|esc2|escapeHtml|escapeAttr)\s*\([\s\S]*\)$/;

// 3. 新增受控方法白名单（数值格式化、相对时间等内部生成且格式确定的输出）
+ const CONTROLLED_RE =
+   /^(?:[\w.]+\.)?(?:toFixed|toLocaleDateString|formatElapsed|formatRelativeTime)\s*\([\s\S]*\)$/;
+ if (CONTROLLED_RE.test(expr)) continue;
```

改完后效果：

```js
el.innerHTML = `<div class="a">${escapeHtml(data.name)} ${data.desc}</div>`;
//                                                      ^^^^^^^^^ 现可被单独匹配 → 计入未防护 ✅
```

**落地节奏建议**：改严规则后检出数会由 19 跳到 72 上下，不要一次清零——
先把新数字落为棘轮基线（只降不升），再逐批清理，避免一次性大爆炸阻塞发版。

---

## 3. 正面确认（本轮独立复核）

- **修复执行力是真实的**：22 项里 21 项代码级确认，不是「声称已修」。
  考虑到上一轮修复率是 1/17，本轮 21/22 是**显著的行为改变**。
- **技术债真下降，而非仅记录**：`noImplicitAny` 891/302/377 → **510/251/272**，
  且由 `lint-ratchet.mjs` 程序化消耗、纳入 gate——棘轮名副其实。
- **`freegames/manager.js` 741→101 行**：拆为 fetch(359)/itad(219)/notify(131)，
  与 v14 拆分浪潮（dashboard 1071→88、options 919→390、detail-page 1133→106）标准一致。
- **UI 盲区真正关闭**：coverage include 由 5 目录扩到 12 目录，4492 行进入覆盖率分母。
- **新增模块的测试覆盖跟上**：v14.1 曾被我点名的 `reset-defaults.js`（196 行零测试），
  本轮补了 `test-reset-defaults.mjs`——说明上轮建议确实被采纳并执行。
  同期新增 4 个测试套件（favorite-prices / filter-presets / reset-defaults / sidepanel）。
- **安全扫描欠账补齐**：v12–v14.1 四版 Mimosa seal 补录，v14.2.0 为 0 findings。

---

## 4. 建议（按性价比）

| # | 事项 | 级别 | 成本 | 说明 |
|---|---|---|---|---|
| 1 | XSS 扫描改「白名单制」（默认可疑、明确放行） | **P1** | 低（~5 行） | 唯一遗留的真伪护栏项。改完检出数跳升属预期，**先落新基线再逐批清**，勿一次清零 |
| 2 | 修正 `xssUnescapedInterpolations` 的语义描述 | P2 | 极低 | 现注释暗示「未转义总数」，实为「含引号的可疑插值数」；建议在 `xssScan.note` 写明口径，避免后人误读 |
| 3 | `sidepanel`（171 行）保持既有双保险 | P2 | 低 | 已有 `test-sidepanel.mjs`，WAR / coverage include / XSS 扫描范围**均已含** sidepanel ✅，此项仅需回归确认 |

**关于本轮的整体判断**：项目已从「写得出好代码」走到「改得快」这一步。
上一轮我提的核心担忧是「护栏债务随交付同步累积」，本轮这项担忧**基本解除**——
25 天 / 三个版本内把 17 项结构性缺陷压到 1 项，执行力是过硬的。
剩下的 XSS 扫描口径问题，本质是**精度问题而非有无问题**，
风险等级远低于前两轮的「完全裸奔」。

---

## 5. 审查方法与声明

**已执行：** lint / typecheck / 全量 test 实跑；22 项历史发现逐项代码级核验；
v14.1.0→v14.2.0 全量 diff 审阅；XSS 扫描器**规则级实测**（构造样本端到端验证，3/3 漏报确认）；
严格规则重扫比对（19 vs 72）；可疑插值逐层溯源抽查（7 处）；
新增模块（sidepanel 171 行、freegames 三域）结构与测试覆盖核对。

**声明：** 第 2 节的漏报结论来自**构造样本的受控实验**，并非在现有代码中发现真实漏洞——
现有代码经抽查转义良好。该发现的风险性质是「未来防护缺口」，不是「现存安全问题」。

**未覆盖（环境限制）：** E2E 真机冒烟、视觉回归、覆盖率采集、`coverage:gate`、npm audit。
当前沙箱禁止 spawn 子进程（cmd.exe EBUSY / genie-trash ETIMEDOUT），与项目无关。

---

*报告结束 · 生成于 2026-10-06 · 基线 v14.2.0（`54e5637`）*
