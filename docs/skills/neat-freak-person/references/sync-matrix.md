# 变更影响矩阵

遇到不确定"这次改动要同步哪些文件"时查这张表。**两个方向都要查**：补漏（加到哪些文件）+ 防膨胀（应该从哪些文件删）。

## 初始化场景：代码事实 → 首次应写入哪些文档板块

初始化时，从代码中识别到的事实应写入对应的文档板块。**注意：初始化时先审查出报告，等用户确认后再写入。**

| 代码中识别到的事实 | CLAUDE.md / AGENTS.md 对应板块 | README.md 对应板块 | docs/ 对应文档 |
|---|---|---|---|
| 项目定位（从 README/package.json 推断） | 1. 项目简介与核心目标 | 2. 简介/概述 | `architecture.md` 项目背景 |
| 语言、框架、数据库、部署方式 | 2. 技术栈与关键依赖 | — | `getting-started.md` 环境要求 |
| 顶层目录职责 | 3. 项目结构与架构说明 | — | `architecture.md` 目录结构 |
| install/dev/test/build/deploy 命令 | 4. 开发环境搭建 & 常用命令 | 5. 快速开始 | `getting-started.md` 命令速查 |
| lint/format 配置 | 5. 代码风格与规范 | — | `contributing.md` 代码规范 |
| 测试框架和运行方式 | 6. 测试要求 | — | `getting-started.md` 测试 |
| 分支策略、CI 配置 | 7. Git 工作流与提交规范 | 8. 开发/贡献指南 | `contributing.md` |
| 架构约束、禁止事项 | 8. 关键设计原则与约束 | — | `architecture.md` 设计决策 |
| AI 行为红线 | 9. AI 代理行为守则 | — | — |
| 已知 bug、踩坑点 | 10. 常见陷阱 & 已知问题 | — | `faq-troubleshooting.md` |
| API 端点 | — | 6. 使用文档 / API 参考 | `api-reference.md` |
| 环境变量 | 4. 开发环境搭建 & 常用命令（环境变量表） | 7. 配置 | `getting-started.md` 配置说明 |
| 数据模型 | 3. 项目结构与架构说明（数据层） | — | `architecture.md` Data Model |
| 开源协议 | — | 9. 许可证 | — |
| 重大架构决策 | 8. 关键设计原则与约束 | — | `decisions/` ADR |
| 配置文件内容（.env.example / docker-compose / Dockerfile / tsconfig 等） | 4. 开发环境搭建 & 常用命令（配置相关部分） | 7. 配置（如有） | `getting-started.md` 配置说明、`operator-runbook.md` 生产配置（如有） |
| CI/CD 配置（GitHub Actions / GitLab CI / Jenkinsfile 等） | 7. Git 工作流与提交规范（CI 相关部分） | — | `contributing.md` CI 流程、`operator-runbook.md` 部署流水线（如有） |
| 项目元数据（package.json description/keywords/engines/repository 等） | 2. 技术栈与关键依赖 | 2. 简介/概述（项目描述一致性） | — |
| 代码逻辑与设计文档一致性 | 8. 关键设计原则与约束 | — | `architecture.md` 数据流 / 模块调用 / 状态机是否与实际代码匹配 |

**初始化时的写入顺序**：docs/ → CLAUDE.md/AGENTS.md → README.md。先动外部优先级最高的。

## 反向：哪些信息该从 CLAUDE.md / AGENTS.md / 记忆里删除

CLAUDE.md / AGENTS.md 不是变更日志（完整规则见 SKILL.md「CLAUDE.md / AGENTS.md 是规则手册，不是变更日志」）。发现以下反模式就删 / 迁：

| 反模式 | 处理 |
|---|---|
| "X 时刻起 Y 功能上线，详见 docs/Z.md" 形式的 blockquote | 删除——指针角色已经被「深入文档」指针表占掉，叙事归 git log / `/changelog` / `docs/CHANGES.md` |
| 在 CLAUDE.md / AGENTS.md 里抄 docs/ 已有的详细机制 / 数据流 / 评分公式 | 删除——AI 改到这块自然会读 docs，CLAUDE.md / AGENTS.md 只留"边界规则" |
| 已经稳定 ≥ 7 天的"新功能上线"叙事 | 该融入项目概览的融入；纯历史的删 |
| 一次性事故的复盘细节（"X 时 Y 服务挂了 30min 因为 Z"） | 留 1 行红线规则（"不要再裸跑 systemctl stop X"），事故详情归 docs/faq-troubleshooting.md 或删 |
| 已被新版本取代的"中间态"叙事（"5/6 改了 X，5/8 又改成 Y"） | 只留最终态规则；中间历史删 |
| 单条 memory > 100 行 + 全是事故复盘 | 提炼成一条 ≤ 30 行的"规则 + Why + How to apply"；多余的删 |
| 记忆条目里"已被 X 取代" / "已废弃" / "保留作历史" 字样 | 99% 真的可以删，docs 已经是权威 |

判断标准：**这条信息在下次 AI 写代码时如果没看到，会犯错吗？** 不会就删 / 迁。

## 代码层变更 → 文档层变更

> 文档命名以 SKILL.md 的「docs/ 目录规范基线」为准：必须文档 `architecture.md` / `getting-started.md` / `api-reference.md` / `faq-troubleshooting.md` / `contributing.md` / `CHANGELOG.md`；扩展文档 `integration-guide.md` / `operator-runbook.md` / `handoff.md`（项目规模变大时按需增加）。

| 本次对话发生的事 | 要改的文件(按受众) |
|---|---|
| 新增 API / 路由 | 项目根 markdown 路由清单 · `docs/api-reference.md` 接口字段 · `docs/integration-guide.md` 对接示例（如有）· `docs/architecture.md` Routes 小节 |
| 新增 / 改名 环境变量 | 项目根 markdown 环境变量表 · `docs/operator-runbook.md` 生产环境变量（如有）· `docs/getting-started.md` 本地环境变量 · `docs/integration-guide.md`(如果下游要配，如有) |
| 新增数据库表 / 列 | 项目根 markdown 数据库表 · `docs/architecture.md` Data Model |
| 新增 / 改动 用户流程 | 项目根 markdown 用户流程 · README 相关命令行示例 · `docs/handoff.md` What Exists Today（如有） |
| 新增大特性(能跨多文件) | 以上全部 + `docs/architecture.md` 新增章节 + `docs/handoff.md` 已完成清单（如有）+ `docs/CHANGELOG.md` 版本记录 |
| 新增术语 / 改命名 | `docs/integration-guide.md` 术语表(如果有)+ 全局搜索旧术语替换 |
| 部署参数 / 基础设施变化 | `docs/operator-runbook.md`（如有）· `docs/getting-started.md` · 项目根 markdown 部署章节 |
| 下游项目接入方式变化 | 下游项目的 `docs/integration-guide.md`（如有）· 上游项目的 `integration-guide.md` |
| 配置文件变更（.env / docker-compose / Dockerfile / tsconfig 等） | 项目根 markdown 环境变量表 / 配置章节 · `docs/getting-started.md` 本地配置 · `docs/operator-runbook.md` 生产配置（如有） |
| CI/CD 配置变更（workflow / pipeline / 部署目标） | 项目根 markdown CI 相关描述 · CLAUDE.md / AGENTS.md Git 工作流板块 · `docs/contributing.md` CI 流程 · `docs/operator-runbook.md` 部署流水线（如有） |
| 项目元数据变更（package.json description / engines / keywords 等） | README 简介 / 技术栈描述 · CLAUDE.md / AGENTS.md 技术栈板块（如有涉及） |
| CHANGELOG 新增条目 | 反向检查：声称的功能/修复是否在代码中真实落地；`docs/handoff.md` 现状描述（如有） |
| 代码逻辑 / 架构偏差修正 | `docs/architecture.md` 数据流 / 模块调用 / 状态机描述 · CLAUDE.md / AGENTS.md 设计原则板块 |

## 记忆层变更

| 情况 | 处理方式 |
|---|---|
| 过期事实 | 改记忆文件,同时更新索引(如 MEMORY.md)的 description |
| 相对时间("今天"、"最近") | 全部转成绝对日期(`2026-04-29` 而非"今天") |
| 重复记录(多条说同一件事) | 合并为一条,改索引 |
| 已完成的待办 | 删除——知识库不是历史档案 |
| 推翻的决策 | 删除旧条目,留新决策 |
| 跨会话只用一次的临时上下文 | 删除 |

## 跨项目影响检查

最容易漏改的场景:

- **上游 API 变了 → 下游 SDK 文档**:协议变化必须两边对齐
- **共享子域 / 路由 / 环境变量改了 → 所有 consumer 项目的 setup 文档**
- **认证中台变更 → 所有接入应用的 integration-guide**
- **公共组件 / 基础设施 升级 → 各项目的 operator-runbook 提及版本号的地方**

判断方法:这次改的东西有没有 SDK、子域、共享配置、跨进程协议?有就要在所有依赖项目里搜一遍提到这件事的文档。

- **Monorepo 共享包变更** → 所有依赖该包的 workspace 子包文档都要检查
- **Monorepo 根级配置变更**（turbo.json / pnpm-workspace.yaml / 根 package.json）→ 各子包的 CLAUDE.md / AGENTS.md 和 README 中关于工具链的描述

## 文档结构通用约定

新增一个能力(API、flow、特性)的标准动作是**四处都补**:

1. **integration-guide / api-reference**:怎么用(curl / SDK 示例 / 错误码)
2. **architecture**:怎么工作(数据流、状态机、设计取舍)
3. **operator-runbook / getting-started**:怎么运维和开发(冒烟命令、故障排查、环境变量)
4. **handoff / CHANGELOG**:已完成（handoff 记现状，CHANGELOG 记版本历史）

API 速查表、环境变量表、术语表是高频查询的结构化信息,**必须保持"所见即最新"**。
