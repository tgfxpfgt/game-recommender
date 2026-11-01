# Game Radar（game-recommender）浏览器扩展 · 代码审查与优化方案

> 审查对象：`F:\data\browser extension\game-recommender` v14.9.1（Chrome MV3，零构建）· 2026-10-31 → 11-01
> 方式：四路并行静态审计（架构 / 安全 / 功能数据流 / 质量 UX）+ 独立行号级复核 · 全链路模型 **zai/zai_auto**（AutoGLM），编排 AutoClaw（OpenClaw 2026.6.8）
> 配套精排版报告：同目录 `game-recommender-审查与优化报告.html`

## 一、执行摘要

总体判断：**工程质量中上，明显高于同体量业余扩展的平均线**——单源注册表纪律、真实的 MV3 深坑修复履历、fail-closed 消息门禁、出站 SSRF 加固；**未发现高危安全漏洞，无远程代码加载**。主要债务：① 设置 UI「三页三套」复制同步 → HTML id 卫生问题（已形成 1 个功能性 bug）；② 新增密钥字段未纳入密钥剔除清单，且设置页 UI 明文承诺与代码行为矛盾（虚假安全声明）；③ 两处长周期路径小泄漏（alarm 不拆除、折扣通知重复）。

规模：manifest 只声明 12 个 JS，实际约 **147 个已验证文件**（shared 7 / adapters 8 / content 22 / background 56 / 页面 38 / data+lib 4 / 样式主题 20+ / manifest+i18n+icons 5）。

## 二、环境限制（影响交付形态）

- 本机 exec 全局不可用（审批路径含符号链接）→ 无 lint/单测/运行时验证/截图，全部结论为静态审查；**docx 依赖脚本执行 → 本报告以 HTML + Markdown 交付**
- 制图链路（charts/seedream）同依赖 exec → 数据流图以文本图呈现
- Chrome Web Store 政策联网核实失败 → 权限/远程代码结论为代码核查而非条文比对
- 两次用户中止致任务重派，子代理累计 11 个（超 L2 编制理由记录于工作台）

## 三、关键发现

### P1（尽快修，合计 ≈2.5h）

| ID | 级别 | 位置 | 问题 | 修复 | 工作量 |
|---|---|---|---|---|---|
| P1-01 | 功能缺陷 | `options/options.html:738,1246` + `panels/search.js:35` + `panels/rules.js:62` | `ruleList` 重复 id 双写 → 规则管理面板恒空、关键词规则 UI 被覆盖 | 过滤面板改 id `keywordRuleList` 并同步 JS | 30min |
| P1-02 | 安全·中危 | `data-modules.js:57-73` · `backups.js:53-59` · `options.html:1131-1133` | 导出/备份不剔 ITAD API Key（只剔 llmConfig.apiKey + steamApiKey），而设置页明文承诺「导出/备份/导入自动剔除」——虚假安全声明 | 两处补剔除 itadProfiles/itadApiKey，抽公共 sanitize 函数 | 30min |
| P1-03 | 安全·中危 | `rules.js:66,188-212` · `tracking.js:138` · `escape.js:20-26` | 恶意规则包 `searchUrl` 无协议校验 → 浮窗「去搜索」`href` 可注入 `javascript:` 链接（escapeAttr 不拦伪协议） | 保存侧 http(s) 白名单（仿 rules.js:396 endpoint 校验）+ 渲染侧协议兜底 | 45min |
| P1-04 | 结构错位 | `options.html:482-517` | 「限免监控」行内嵌套「收藏折扣监控」「折扣阈值」两行，开关与标签分离 | 平铺嵌套行 | 15min |
| P1-05 | 资源泄漏 | `ratings-batch.js:117,259,269-272` | 批量任务陈旧（>1h）后 stale 分支只清任务不拆 1min resume alarm → SW 无限每分钟唤醒 | stale 分支补 `teardownResumeAlarm()` | 10min |
| P1-06 | 通知骚扰 | `itad.js:120,134-144` | 收藏折扣提醒无防重标记（发售提醒有 `grReleaseNotified:`），同一折扣每 48h 重推 | 仿发售提醒加已通知标记 | 15min |

### P2（近期修，约 3-5h）

| ID | 位置 | 问题 | 修复 |
|---|---|---|---|
| P2-01 | `options.html:25,59` + `search.js:18` | settingsSearch 重复 id → 面板头搜索框死控件 | 去重或双绑 |
| P2-02 | `popup.js:225-235` | refreshBtn 吞错后仍显示「✅ 已刷新」 | 失败显示「⚠️ 页面不支持」（对齐 238-254） |
| P2-03 | `popup-weights.js:44-54` | 权重保存无 try/catch，失败无提示 | 包裹 + 复用 saveFailHint |
| P2-04 | `popup-status.js:88-99` | 统计加载失败静默显示 0 | 加降级文案/错误态 |
| P2-05 | `options/options.js:88-89` | 绕过 applyPageTheme → 定时日夜主题在设置页不生效 | 对齐统一入口 |
| P2-06 | `tracker.js:187` | EXT_VER_KEY 键名含省略号字符（U+2026） | 改正常名（一次性重置已读版本提示，可接受） |
| P2-07 | `popup-weights/options/options.html` + `settings-utils.js:~215` | 同批设置三页三套（DOM/绑定/收集三张表）+ saveQueue 注释漂移 | 设置键表 shared 单源化（仿 module-manifest）、popup 复用工厂 |

### P3（择机）

| ID | 位置 | 问题 |
|---|---|---|
| P3-01 | `popup.css:55-90,128-147` · `popup.html:44` | 重复 .gr-switch 块、浅色残留（深色主题对比度 ~3:1）、.hidden 未定义 |
| P3-02 | `manifest.json:4-7` + 各页面 | 仅 manifest 两键走 i18n，页面双语副标签是「国际化错觉」→ 决策 |
| P3-03 | `floats.js:90-100` 等 | 浮层折叠/关闭为 span 不可键盘达；label 未关联控件（正面：ui-theme 有完整 focus-visible + reduced-motion） |
| P3-04 | `settings-utils.js:52` · `popup.js:35-43` | 死代码：goHub 'vista'、Object.assign 兜底（可腐蚀设置）、三级主题 fallback |
| P3-05 | `manifest.json` WAR · `sidebar.js` | WAR 通配含无需暴露的 lib/ndjson.js；grAppId 向宿主页暴露扩展存在 |
| P3-06 | `constants.js` | appStats 20000 条永不过期 + urlIndex 5000，随导出带走浏览足迹（叠加 P1-02） |
| P3-07 | `api-reviews.js:151,118-137` | 30 天好评率基于「最新 100 条」自算，热门游戏偏离 Steam 官方 30 天聚合（全时段口径与官方一致 ✓） |
| P3-08 | `utils.js:209-232` | `pattern[Symbol.match]` 计算属性规避静态扫描（注释自述）→ 未来审计应知晓 |

### 通过项（正面确认，可复用为商店审核材料）

1. **消息门禁 fail-closed**：`handlers.js:51-56` + `message-contract.js:246-293`——非扩展 origin 仅白名单 action，SAVE_SETTINGS/IMPORT_DATA/RESTORE_BACKUP/CLEAR_DATA 等特权写全拒；无 onMessageExternal/externally_connectable
2. **无远程代码**：eval/new Function 抽查干净（范围见复核记录）；动态 import 全指向打包内路径；CSP `script-src 'self'`
3. **SSRF 加固**：`utils.js:130-149,185-207`——私网/环回/CGNAT/IPv6 全谱拦截 + redirect:'manual' 逐跳复检（≤5 跳）+ 每主机限速 + 出站审计
4. **权限最小化**：无 tabs；scripting 仅用于用户授权站点动态注册（域名过滤 + 手势内 request）；localhost 服务于自配 LLM 端点
5. **存储有界**：steam-cache 四模块 TTL（meta 30d/rating 7d/detail 72h/spy 7d）+ LRU 1200 + 全局 STORAGE_CAPS；限免库整体替换
6. **SW 生命周期工程**：early-message-router 排队冲放、检查点续跑、alarm 幂等创建、写失败回滚重调度、备份恢复串行化
7. **列表页四态闭环**：等待/成功/未找到（可点击穿透重查）/失败（悬停说明），45s 强制收尾不误标
8. **负缓存网络守卫**：`orchestrator-list.js:284-300` 熔断期不固化「未找到」
9. **content.css 宿主隔离**：全 gr-* 前缀、无裸标签选择器、!important 仅 6 处必要

### 架构要点

- 四层：adapters 规则（纯数据，双端消费）→ content 采集渲染 → SW handlers 领域编排 → data/storage 持久化（根级 OPFS）
- 五处单源注册表：module-manifest / storage-registry / message-contract / fm-keys / steam-rating-logic
- 零构建双轨：内容侧经典装载器 + 动态 import ESM；扩展页面经典脚本共享全局（`/* global */` 约定，弱项）
- 弱项：全局共享靠注释约定、data/lib 根级分层无机制强制、SW 内动态 import 历史坑已修复（service-worker.js:18-29）

## 四、优化路线图（每阶段独立 commit，验收不过 revert 即回滚）

1. **快赢 ≈2.5h**：P1-01…06 + P2-01/02/05/06。验收：规则面板出现列表；导出 JSON 检索不到 ITAD 密钥；`javascript:` searchUrl 被拒；SW 停止无限唤醒；同一折扣只推一次
2. **反馈与样式 ≈1h**：P2-03/04 + P3-01。验收：断网下无静默归零/假成功；深色主题无浅色残留
3. **结构加固 ≈0.5-1 天**：P2-07 + P3-04。验收：新增一个权重键只改 1-2 处；全仓无第二份键表
4. **产品化收尾 ≈1 天 + 决策**：P3-02/03/05/06/07/08 + 4.3 节通过项整理为商店审核答复材料

## 五、工具与模型标注

| 环节 | 工具 | 模型 |
|---|---|---|
| 目标确认/编排/综合 | get_goal · session_status · write/edit 工作台 | zai/zai_auto（主会话） |
| 环境诊断 | nodes · gateway config.schema.lookup · exec（被环境拒绝） | — |
| 读取通路探针 | sessions_spawn + read | zai/zai_auto |
| 代码审计 ×4（架构/安全/功能/质量） | sessions_spawn 并行 + read（只读） | zai/zai_auto ×4 |
| 事实复核 ×1（16 项行号抽核） | sessions_spawn + read | zai/zai_auto |
| 过程状态检查 | subagents（按需） | — |

运行环境：OpenClaw 2026.6.8 (669b1dc) · host FFF2024 · Windows · 2026-10-31 → 11-01。

## 六、风险、假设与复核

- 假设：附加文件夹即审查对象全集；「标注工具模型」= 专章 + 全程记录
- 局限：静态审查 ≠ 运行验证（P1-01/04、P2-01 等现象类发现需加载扩展确认）；eval 检查为抽检（无 grep）；未逐一打开文件清单与商店政策缺口见 HTML 版第 10 节
- **复核结论：16 项抽核 15 完全确认 + 1 部分确认（仅函数位置标注偏差），总体置信高**；复核新增发现（UI 虚假声明、死控件后果、Symbol.match 写法等 5 条）已并入正文
- 工作台（过程可追溯）：`F:\data\AutoClaw\.cluster\4afe89fa\`（plan / brief / subagent_01-04 原始回传 / review 复核记录）
