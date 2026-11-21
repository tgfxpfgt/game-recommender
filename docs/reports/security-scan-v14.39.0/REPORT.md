# 安全深度扫描报告 — v14.39.0

- 扫描日期：2026-11-21
- 扫描对象：f603974（feat: CI visual 永久 advisory + sim 诊断快照 + freegames h() 化 + 文案字典首域）
- 工具链：Semgrep OSS（p/javascript + p/owasp-top-ten + p/secrets + .semgrep/gr-dom-sinks.yml，145 规则 / 399 文件）+ eslint-plugin-security（常态入 lint 门禁，零告警）
- 本批焦点文件：shared/ui-text.js、content/list/badges/*、content/list/list-*.js、freegames/freegames.js、tests/sim/sim-harness.mjs、tests/visual-regression.mjs、.github/workflows/ci.yml

## 1. 结果总览

| 项 | 数值 |
|---|---|
| Semgrep findings | 6（全部人工定性为误报/受控形态，零真问题） |
| eslint-plugin-security | 0（lint --max-warnings 0 全绿） |
| 自定义 DOM-sink 规则 | 0 新增（check-dom-sinks 基线 1 = preact-globals vendor 豁免项，本批未触碰） |
| CodeQL | success（CI run 44870176960，本批 push） |

## 2. Findings 逐条定性（铁律：全库 findings 必须逐条核对转义链）

### 2.1 github-actions-mutable-action-tag（1 处，误报）

- `pr-agent.yml:36` — 历史批次入库既有项（非本批改动文件）。该 job 的 action 引用带 commit SHA pin，@v4 形态仅注释性标注。定性：**误报**（SHA 已固定，mutable 风险不成立）。沿用 v14.31.0 报告同条定性。

### 2.2 react-dangerouslysetinnerhtml（5 处，受控 trusted 注入——本批引入，逐一核对）

| 位置 | 数据源 | 转义链核对 | 定性 |
|---|---|---|---|
| content/core/status-bar.js:176（showDebugView） | debug.js buildDebugHtml() 全链 escapeHtml 预转义；另接受 sim 测试直驱注入的片段（受控测试面） | ✅ trusted（v14.28.8 起诊断 HTML 全链转义，tests/unit/test-escape-robust 覆盖） | 误报 |
| content/detail/inline-card.js:202 | detailTemplates.steamInlineSection | ✅ 模板全链 escapeHtml/escapeAttr；tests/unit/test-ui-pure 有 shop/appId 转义断言 | 误报 |
| content/detail/sidebar.js:540 | detailTemplates.steamSidebar | ✅ 同上模板链（浮窗主体），test-ui-pure 7 处断言覆盖 | 误报 |
| dashboard/dash-radar.js:99 | renderProfileRadarSvg 内部 | ✅ 游戏名/数值全 esc() 转义后拼串 | 误报 |
| dashboard/dash-stats.js:194 | 趋势 SVG 串 | ✅ 内插全为 number.toFixed/日期 slice；date 文本显式 escapeHtml | 误报 |

形态说明：v14.38.0 全量迁移将 `.innerHTML =` 赋值 sink（85 处）收敛为
`dangerouslySetInnerHTML` 受控注入（仅 5 处 trusted 助手输出）+ Preact 文本插值
（天然转义）。Semgrep 的 React 规则按 API 形态告警，无法识别我方 trusted
注释链——以上 5 处均为"全链预转义的模板串"或"纯数值内插"，无外部输入直达
sink 的路径。check-dom-sinks 基线锁（增量防护）+ 本报告（存量定性）分工，
与 v14.33.2 设立的 gr-dom-sinks 自定义规则互补。

## 3. 结论

零真问题，无需挂账。

## 4. Seal

**seal = 本报告文件（REPORT.md）的 sha256**，发布时写入 gh release notes 与
CHANGELOG.md v14.39.0 条目。`semgrep-raw.json` 随报告入库（完整原始输出，供复核）。
