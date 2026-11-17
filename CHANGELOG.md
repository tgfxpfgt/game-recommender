# 更新日志 / Changelog

> v14.28.0 起从 README 拆出（README ≤ 400 行纪律，方案 P2-2）。最新条目在最上方。

### v14.33.1（AI 协作调研落地：AGENTS 收敛 + E2E dist 验收 + Preact 组件三缺陷修复，2026-11-18）

- AGENTS.md 发布流程细节指针化到 playbooks §7（去双源重复）+ 新增「先问再做」边界档（GitHub 2500 仓三级边界经验）
- E2E 验收入口切 e2e:dist（源码树直跑撞 Preact 裸 specifier——阶段 3 遗留）；SW 等待改 Playwright 官方 waitForEvent 事件模式（轮询兜底）
- 构建器修复：.mjs 组件不再并入 classic bundle（require 泄漏防线入 verifyDist）；dash-stats 三连修（h 漏导出/mountAt 参数错位/实参快照陷阱——dashboard 空态真实生产缺陷）

### v14.33.0（提交与版本规范治理，2026-11-17）

- 提交信息升级 Conventional Commits 1.0.0 全量校验（commit-lint.mjs：类型白名单/scope 单词字符集/subject≤72/结尾禁句号/body 空行/! 与 BREAKING CHANGE 一致性）
- bump 支持 auto 级别推导（区间提交类型 semver 推导）+ major + 显式低于推导拦截（--force 兜底）+ CHANGELOG 条目日期化 + 每版一 tag 纪律
- CHANGELOG.md 近 10 版日期回填；补打 v14.31.1~v14.32.3 七个 tag（manifest 变更提交锚定）；CONTRIBUTING 提交规范节 + AGENTS 指针

### v14.32.3（阶段 5 收官：仓库卫生 + AGENTS v15 形态重写，2026-11-17）

- CHANGELOG 拆档（近 10 版主文件 + archive 归档）+ 陈旧脚本清理
- APP_NAME 显示名单源 + background 域 console 前缀接引（数据兼容面标识符冻结）
- AGENTS.md 按 v15 新形态重写（构建形态/happy-dom 测试约定/铁律 19 名字提取防复发）

### v14.32.2（油猴词表同源构建器落地，2026-11-16）

- scripts/build-userscript.mjs：retrieval-vocab 单源→油猴 VOCAB 快照生成（GR-GENERATED 锚点幂等刷新）
- 词表防漂移从手工对齐升级为构建期生成+门禁双保险

### v14.32.1（阶段 3 Preact 化首批落地，2026-11-16）

- UI 设计 token 单源（ui-tokens + tokens.css 构建生成）
- popup API 状态区/dashboard 状态区块 Preact 组件化（innerHTML 8 处退役）
- build 链支持 type=module 页面脚本（esbuild ESM bundle）

### v14.32.0（绿地重构阶段 0：esbuild 构建器落地——dist 产物管线（行为零变化），2026-11-14）

- scripts/build.mjs 双策略构建器：页面顺序 concat（classic 全局语义 100% 保真）+ content ESM 模块图 esbuild bundle（module-loaders 装载桥 19 条相对 import）+ background ESM 单文件；构建 277ms
- dist 镜像：manifest 模板化（WAR 43→1、content_scripts 7×7 文件→7×1）+ HTML script 折叠单 tag + 静态资产镜像；e2e:dist 51/51 全绿（GR_EXTENSION_DIR 参数化 helpers/visual）
- tracker 装载桥单点收敛（5 处 getURL import→loadOne）；sidebar 两处按需 getURL 改静态 import；site-scripts 双模式清单（banner 注入）
- 门禁适配：gen-war 派生含装载桥单源、coverage 豁免生成桥、perf-budget 四处实测重锁、visual 基线重钉、eslint/globals.d.ts 补 banner 全局声明

### v14.31.3（CodeQL 106 条告警全清零：43 处测试桩清理 + 52 处误报 dismiss + 11 处实修，2026-11-14）

- 43 个测试文件删除 ('use strict') 无用表达式（ESM 惰性指令）；orchestrator-detail 删重搜路径无用 appIdTrusted 赋值；search-candidates 去冗余恒真条件；detect-name/search 字符类双单引号 ×4
- test-changed.mjs git() execSync 拼接改 execFileSync 数组参数 + git ref 白名单校验（CLI 注入面消除）；coverage-snapshot TOCTOU 改 try/catch 直读；test-cost-history 临时文件名加随机段
- 52 处误报 dismiss 带理由归档（dashboard 经典脚本跨文件全局 ×19/URL 子串防御检查 ×15/油猴 textContent 边界 ×3/实体单遍解码等）——Security 面板 open 告警清零

### v14.31.2（安全基建增强：CodeQL workflow + ReDoS 实证复核 + gate 信号提额，2026-11-14）

- CodeQL 深度分析（javascript-typescript security-and-quality）随 push/PR/每周自动跑——结果进 GitHub Security 面板，与本地双工具链互补
- detect-unsafe-regex 13 处实证复核：对抗输入实测 11/11 全 SAFE（最坏 0.3ms/446KB，有界量词线性形态）——redos-review.md 入库，规则维持 off 证据在案
- gate GATE_VITEST_ENV 信号超时 20000→30000（满载竞态绷带加固，仍低于 harness 默认 60s）

### v14.31.1（安全扫描链路替代：Semgrep+ESLint security 双工具链（Mimosa 断连期 seal 证据源），2026-11-14）

- eslint-plugin-security 4.2.1 常态入 lint 门禁（精选 10 条 error 规则；object-injection/non-literal-regexp/unsafe-regex 三条 off 理由登记）
- Semgrep OSS 1.185.0 出具 v14.31.0 发版深度扫描报告（焦点 31 文件 0 findings/全库 3 findings 全数定性误报）——seal sha256:e0a98c4d…fab11 补入 release notes 与 CHANGELOG
- AGENTS.md 发布流程第 4 步改写：扫描链路主源改双工具链（Mimosa MCP 可用时保留）；detect-unsafe-regex 13 处有界量词误报挂账择批 ReDoS 复核

### v14.31.0（列表/详情双管线一致性统一：单源化共享层 + 三态结构化 + 防脱节门禁，2026-11-14）

- 置信度字段装配单源 attachMatchConfidence（match-confidence.js——列表 matchConflict 强制降级内聚，两管线同函数装配，新增字段只改一处）
- MC 分级色单源 **GR_PATTERNS**.mcColorFor（列表 gr-mc-badge 与详情 MC 视图同一把尺，两处字面量副本退场）
- 详情 SEARCH_STEAM 未命中响应补结构化 errorType（network/notfound，与列表 networkFailed 哨兵同名同义）——内容侧优先消费结构化字段，reason 正则兼容保留
- 防脱节规则：铁律 18 登记 + playbooks 配方 + test-match-consensus 一致性门禁组（5 用例：同输出/冲突降级/纠正强制确认/色带等价+无双副本/三态源码守卫）；有意差异登记（MC 视图无新游标签、matchConflict 仅列表接线）
- **完整发版（2026-11-14，tag+release，zip 上线）**：触发线（v14.28.10 后插入 +3255 行）→ gate 全量等效全绿（sim-list 满载竞态隔离 3 连绿定性）→ ext-refs --refresh 3 条真实校验。**安全深度扫描 seal `sha256:e0a98c4d5b45c066b80718a8a89a0bd4e408427e3b74c881bab23263168fab11`**（Semgrep OSS 1.185.0 + eslint-plugin-security 4.2.1 双工具链出具——Mimosa 钩子禁用与 MCP 断连后经用户裁决改链；焦点集 31 文件 0 findings / 全库 3 findings 全数定性误报，报告 docs/reports/security-scan-v14.31.0/）

### v14.30.0（主机游戏检索三连修复：MC 域权限根治/详情页平台预检/手动面板机型入口，2026-11-14）

- MC 评分根治：manifest 补 metacritic.com host_permissions（缺失致 MV3 SW fetch 被 CORS 静默拦截，v14.10.0 起功能从未生效）+ 失败 Logger.warn 可诊断 + 超时单源新键 fetchTimeoutMetacriticMs + first-run 真实证据回填
- 详情页平台预检：searchSteamGame 接入 phaseDetailPlatform（与列表 phasePlatform 同优先序：映射>模拟器>主机MC>PC），主机整合/模拟器/移植版条目不再先发整套 Steam 检索；URL 索引先行加平台守卫
- 词表补「移植版/移植」裸段（PC guard 优先不变）；手动选择面板恢复「主机/模拟器」入口按钮（面板内直达机型专页，与 ⚙ 菜单同路径）

---
更早版本（v14.29.0 及前）已迁档：[docs/changelog/archive.md](docs/changelog/archive.md)。
