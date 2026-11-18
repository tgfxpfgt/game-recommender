# Chrome 官方安全清单对照审计（2026-11-19，v14.33.2）

> 来源：developer.chrome.com/docs/extensions/develop/security-privacy/stay-secure 官方指导 +
> MV3 迁移清单（web_accessible_resources/权限最小化）。本报告为一次性对照审计（调研落地
> C3），机器防线不随本报告退役——常态拦截见「防线」列。审计基线 = manifest v14.33.1。

## 对照矩阵

| #   | 官方要求                        | 现状                                                                                                                                                                    | 结论                      | 常态防线                                                                         |
| --- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------- |
| 1   | 保护开发者账号                  | GitHub 单人直推（git user: GameRecommender）；无第三方 CI 密钥注入发版                                                                                                  | ✅ 达标                   | —                                                                                |
| 2   | **永不使用 HTTP**               | 出站 API 全 `https://`（constants.js ENDPOINTS 单源）；`host_permissions` 含 12 组 `http://*.下载站` **为 content script 注入 http 站点所需**（功能性注入，非出站传输） | ⚠️ 有意保留（见观察 O-1） | ENDPOINTS 单源 + check:ext-refs 锁                                               |
| 3   | **请求最小权限**                | `permissions` 6 项：storage/alarms/notifications/scripting/contextMenus/sidePanel——无 tabs/downloads/history/cookies 等高危项                                           | ✅ 达标                   | 权限面收窄先例（v6.3.0）                                                         |
| 4   | 限制 manifest 字段              | `optional_host_permissions` = `http://*/*`+`https://*/*`（自定义站点按需授权，options 添加时经 chrome.permissions.request 用户批准——MV3 optional 模式）                 | ⚠️ 见观察 O-2             | 用户批准面                                                                       |
| 5   | **显式 CSP**                    | `content_security_policy.extension_pages = "script-src 'self'; object-src 'self'"`——显式声明，无 unsafe-inline/eval                                                     | ✅ 达标                   | 铁律 1（禁内联事件处理器）+ 代码约定                                             |
| 6   | web_accessible_resources 最小化 | 43 resources / 1 组（全部 content/ 模块——content script 动态 import(getURL) 装载所需）；v14.32.0 起 gen-war 单源派生（WAR 43→1 组折叠）                                 | ✅ 达标（结构最小化）     | `gen-war` 派生一致性门禁（gate 步骤）                                            |
| 7   | content script 注入面           | content_scripts 仅下载站 7 域匹配（非 `<all_urls>`）；7×1 折叠注入（v14.32.0）                                                                                          | ✅ 达标                   | module-manifest 清单派生                                                         |
| 8   | **消息通道 sender 校验**        | `message-contract.js` web-origin 白名单 + 特权 action trusted 门（无 sender.url 或扩展页外来源 → handlers.js 拒绝并 Logger.warn）                                       | ✅ 达标（超出一般实践）   | test-contract 契约门禁                                                           |
| 9   | 出站请求安全                    | 全部经 `fetchWithTimeout`（core/utils.js）：SSRF 私有地址校验 + redirect:'manual' 逐跳复检（v3.4.1——302 穿透防线）+ 每主机限速 + 出站审计                               | ✅ 达标                   | `fetchWithTimeout` 强制（铁律 8）+ test-outbound                                 |
| 10  | XSS / DOM 注入                  | 铁律 1：动态内容一律 escapeHtml/escapeAttr；Preact 组件文本插值天然转义（innerHTML 12 处已退役）；**本批新增基线锁**（121 sink 只减不增）                               | ✅ 达标                   | `check:dom-sinks` 基线锁（gate:fast 新增）+ `.semgrep/gr-dom-sinks.yml` 发版扫描 |

## 观察（O-1/O-2，均经核实为功能性权衡，非缺陷）

- **O-1 http 下载站注入域**：12 组 `http://*.下载站` host_permissions 用于在 http 页面
  注入徽章（下载站用户群体常访问 http 站）；content script 注入面 ≠ 出站传输面
  （出站 API 全 https）。收敧行为 = 放弃 http 站用户群覆盖，保持现状并登记。
- **O-2 全域 optional_host_permissions**：`http://*/*` 是用户添加任意自定义站点时的
  批准面（MV3 optional 权限 = 显式用户批准才生效），为「自定义站点」功能设计所需。
  收敧行为 = 限制自定义站点白名单，属功能裁剪，保持现状并登记。

## 本批新增防线（v14.33.2）

1. `check:agents-docs`——活规则文件保鲜（AGENTS/CONTRIBUTING/playbooks 引用的命令与
   路径存在性 53 处；负例自证：typo 命令精准拦截到行号）。防「AI 带失效指令工作」。
2. `check:dom-sinks`——DOM sink 基线锁（29 文件/121 点只减不增；负例自证：存量文件
   加 sink 即红）。铁律 1 的机器化常态防线。
3. `.semgrep/gr-dom-sinks.yml`——Semgrep 自定义规则（发版深度扫描补充配置，playbooks
   §7 扫描命令已接入）：非字面量 sink 赋值 80 findings（78 innerHTML/outerHTML +
   2 insertAdjacentHTML）供发版时逐条人工定性——与基线锁分工：锁增量、扫存量。

## 调研项未采纳说明

- **B4 dependency-review action**：GitHub 官方 PR 依赖 diff 审计——本项目单人 main
  直推**无 PR 流程，action 永不触发 = 装饰性 job**（铁律 15「机制必须绑定可见输出」
  反例），不采纳。供应链防线现状：npm audit（CI security job）+ gitleaks + devDeps
  仅 16 项（低依赖面）。
- **knip 死代码盘点**：需新增 devDep（先问再做纪律——依赖决策留用户明示），未实施。

## 结论

官方清单 10 项全部达标（2 项功能性权衡已登记）；新增机器防线 2 门禁 1 规则。审计
分母：manifest v14.33.1 全字段 + 出站链路（ENDPOINTS/fetchWithTimeout）+ 消息通道
（message-contract/handlers）+ DOM 注入面（121 sink 点全量）。
