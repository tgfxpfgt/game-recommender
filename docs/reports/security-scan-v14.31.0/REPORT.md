# 安全深度扫描报告 — v14.31.0 完整发版（seal 依据）

> 扫描日期：2026-11-14 · 扫描基线：commit `0d41505`（v14.31.0 发版内容 + 外部引用锁刷新）
> 扫描器：**Semgrep OSS 1.185.0**（规则集 p/javascript + p/owasp-top-ten + p/secrets）
> + **eslint-plugin-security 4.2.1**（精选规则集，已入 eslint.config.js 常态门禁）
> 背景与裁决：Mimosa 钩子禁用（2026-11-14 用户裁决，hooks.json 清空）+ 本轮 Mimosa MCP
> 会话级断连——用户裁决 seal 改由 **Semgrep + ESLint security** 双工具链出具（B+C 方案）。
> 本报告文件 sha256 即本发版 seal（见文末）。

## 1. 扫描范围

- **焦点集（发版改动文件）**：`git diff --name-only 488e887..HEAD -- '*.js'` 业务文件
  31 个（background/steam 管线 ×8、handlers ×3、content detail/list ×9、shared ×1、
  storage ×2、freegames/itad ×1、constants/types ×2、adapters ×若干）——清单 =
  `semgrep-focus.json` 的 `scanned` 字段。
- **全库面**：background / content / shared / popup / options / dashboard / hub /
  freegames / welcome / adapters / data / userscript 共 **196 文件**。

## 2. 结果总览

| 维度 | 规则数 | 发现数 | 明细 |
|---|---|---|---|
| Semgrep 焦点集（31 文件） | 598 registry / 108 适配 | **0** | 零 finding 零 error |
| Semgrep 全库（196 文件） | 598 registry / 115 适配 | **3** | 全部 `raw-html-concat`（content/detail/tracking.js :133/:165/:193），人工定性 = **误报**（见 §3） |
| eslint-plugin-security（全库 JS，常态门禁） | 10 条 error 级 | **0** | lint `--max-warnings 0` 全绿 |

## 3. 全库 3 findings 逐条定性（全部误报）

三处均为同一形态：**HTML 字符串拼接受控片段变量**，Semgrep 无跨变量 taint 追踪能力。
人工核链（铁律 1 防线在位）：

| 位置 | 变量 | 防线（代码内已注明版本） |
|---|---|---|
| tracking.js:133 | `steamJumpHtml` | 构造处 `escapeAttr(u.href)` + `new URL` protocol 白名单 http(s)（v14.22.0）；非法 URL 不渲染 |
| tracking.js:165 | `detailLinkHtml` | `detailHref` 构造处 `escapeAttr(du.href)` + protocol 复核兜底（v14.13.1——防存量恶意规则包 javascript: 伪协议） |
| tracking.js:193 | `linkHtml` | `searchHref` 同上双防线 |

**结论**：三处变量在赋值点已经 `escapeAttr` 转义且仅接受 http(s) 协议——注入链不存在。
不修改代码；已通过本报告定性归档（复扫如仍报此三条，引用本节即可）。

## 4. ESLint security 规则集取舍登记（config 注释同源）

error 级启用（10 条）：bidi-characters / invisible-characters / child-process /
eval-with-expression / new-buffer / non-literal-fs-filename / non-literal-require /
possible-timing-attacks / pseudoRandomBytes / detect-no-csrf-before-method-override 与
buffer-noassert、disable-mustache-escape 不适用 Web 扩展上下文未启用。

off 级（3 条，理由登记于 eslint.config.js）：
- `detect-object-injection`——动态键访问为本库常态（steam-cache 字段路由/注册表/缓存键）
- `detect-non-literal-regexp`——retrieval-vocab 词表编译受控输入构造正则 = 设计用途
- `detect-unsafe-regex`——**初装实测 13 处全为有界量词保守误报**（`{1,3}`/`{0,61}`
  线性形态：sites/search.js 版本提取 ×5、utils.js IPv4、options/sites.js 主机校验、
  match-confidence/orchestrator-shared/page-url/inline-card/steam250 各 1-2）。
  **挂账**：择批经 Semgrep ReDoS 专项规则复核后决定是否局部启用。

## 5. 与既有安全门禁的关系（非替代、是补强）

本双工具链**不替代**既有机器防线，仅为发版 seal 的"深度扫描"证据源：
铁律 1 escape 门禁（test-escape-robust）、铁律 2 SW 静态 import（test-integrity）、
铁律 8 fetchWithTimeout SSRF（outbound-audit + test-security）、铁律 16 外部引用锁
（check:ext-refs --refresh 本发版已真实校验 3 条）。

## 6. Seal

**seal = 本报告文件（REPORT.md）的 sha256**，发布时写入 gh release notes 与
CHANGELOG.md v14.31.0 条目。`semgrep-focus.json` / `semgrep-full.json` 随报告入库
（完整原始输出，供复核）。
