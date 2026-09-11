# 文档规范基线

> 初始化和常规同步都以这组基线为"尺子"衡量文档质量。
> **CLAUDE.md / AGENTS.md 和 README.md 的板块为必须；docs/ 的规范为建议，项目实际情况不满足时以用户要求为准。**

## CLAUDE.md / AGENTS.md 规范基线

就像给一位聪明但完全不了解项目背景的 AI 新同事写的"入职手册 + 行为准则"——用具体、可执行的语言，把"项目是什么、怎么跑、怎么写代码、绝对不能做什么"一次性说清楚。

**必须包含的 11 个板块**：

| # | 板块 | 内容要求 | 审查要点 |
|---|------|----------|----------|
| 1 | 项目简介与核心目标 | 1-3 行说清项目是什么、解决什么问题 | 零上下文的 AI 能否理解项目定位 |
| 2 | 技术栈与关键依赖 | 语言、框架、数据库、部署方式、核心依赖版本 | 是否与 package.json / go.mod / pyproject.toml 等一致 |
| 3 | 项目结构与架构说明 | 顶层目录职责、模块划分、关键数据流 | 目录描述是否与实际结构一致 |
| 4 | 开发环境搭建 & 常用命令 | install / dev / test / build / deploy 命令速查 | 每条命令是否可执行 |
| 5 | 代码风格与规范 | 命名约定、文件组织、lint 规则、格式化工具 | 是否与实际 lint/format 配置一致 |
| 6 | 测试要求 | 测试框架、覆盖率要求、测试运行方式、写测试的约定 | 测试命令是否可运行 |
| 7 | Git 工作流与提交规范 | 分支策略、commit message 格式、PR 流程 | 是否与 CI/分支保护规则一致 |
| 8 | 关键设计原则与约束 | 硬边界规则、架构约束、禁止事项 | 规则是否具体可执行（不是"注意代码质量"这种废话） |
| 9 | AI 代理行为守则 | AI 在此项目中必须遵守的行为规则、禁止操作 | 是否覆盖了已知的 AI 翻车模式 |
| 10 | 常见陷阱 & 已知问题 | 踩坑警示、已知 bug、临时 workaround | 是否是"下次会踩"的坑而非历史流水账 |
| 11 | 其他 | 项目特有的、不属于以上任何板块的必要信息 | 是否真的必要，还是可以删掉 |

**质量红线**：
- **简练不重复** — AI 靠这个文件指导行为，冗余 = adherence 下降
- **具体可执行** — "禁止裸跑 systemctl stop X" ✅ / "注意服务稳定性" ❌
- **不是变更日志** — 不含历史叙事、不含"详见 docs/X.md"的 blockquote
- **尺寸 ≤ 300 行 / ≤ 15KB**

## README.md 规范基线

优秀的 README 是对读者时间的尊重——用最短的时间让人说"我懂了，这有用"，并给出清晰的下一步。始终站在新手的视角，让它能复制、能运行、能看懂。

**必须包含的 11 个板块**：

| # | 板块 | 内容要求 | 审查要点 |
|---|------|----------|----------|
| 1 | 项目名称与徽章 | 项目名 + 构建/版本/许可证等 badge | badge 链接是否有效 |
| 2 | 简介/概述 | 一句话说清项目是什么、解决什么问题 | 新手能否 5 秒内理解 |
| 3 | 功能特性 | 核心功能列表（3-8 条） | 是否与代码实际功能一致 |
| 4 | 演示 | 截图 / GIF / 在线 demo 链接 | 链接是否可访问 |
| 5 | 快速开始 | install → config → run，命令可直接复制运行 | 每条命令是否可执行、是否指定运行目录 |
| 6 | 使用文档 / API 参考 | 核心用法示例 + 指向 docs/ 的链接 | 示例是否可运行、链接是否有效 |
| 7 | 配置 | 关键配置项说明（如有） | 配置项是否与代码一致 |
| 8 | 开发 / 贡献指南 | 简短的开发指引 + 指向详细文档的链接 | 不与 CLAUDE.md / AGENTS.md 重复，面向人类贡献者 |
| 9 | 许可证 | 开源协议 | 是否与 LICENSE 文件一致 |
| 10 | 致谢 / 相关项目 | 依赖致谢、相关项目链接 | 链接是否有效 |
| 11 | 其他 | 项目特有的必要信息 | 是否真的必要 |

**质量红线**：
- **命令可复制运行** — 每条命令必须指定运行目录
- **不与 CLAUDE.md / AGENTS.md 重复** — README 告诉人"能做什么"，CLAUDE.md / AGENTS.md 告诉 AI"怎么做事"
- **细节链接到 docs/** — README 只放最核心的快速开始，不做详细展开
- **面向新手** — 站在第一次接触项目的人的视角写

## docs/ 目录规范基线

一个规范的 docs 目录，就像一本结构清晰、即时可查的活手册——按角色分层、每个文件专注一个主题、命令可执行、内容与代码同步更新，让使用者和贡献者都能各取所需。

**以下为建议规范，非强制——项目实际情况不满足时，以用户要求为准。**

**目录结构**（两种组织方式，按项目实际情况选择）：

```
方式一：按角色/用途分（适合大多数项目）
docs/
├── index.md                # 文档索引入口
├── architecture.md         # 架构说明
├── getting-started.md      # 本地开发指南
├── api-reference.md        # API 参考
├── CHANGELOG.md            # 变更日志
├── faq-troubleshooting.md  # 常见问题与排错
├── decisions/              # 决策记录 (ADR)
│   └── 001-xxx.md
└── contributing.md         # 贡献指南

方式二：按功能模块分（适合多模块项目）
docs/
├── index.md
├── modules/
│   ├── auth/
│   │   ├── architecture.md
│   │   └── api-reference.md
│   └── payment/
│       ├── architecture.md
│       └── api-reference.md
├── shared/
│   ├── getting-started.md
│   ├── CHANGELOG.md
│   └── faq-troubleshooting.md
└── contributing.md
```

> **索引文件避免使用 README.md**，用 `index.md` 或数字前缀（如 `00-overview.md`），避免与项目根 README.md 混淆。

**文件与命名规范**：

| 规则 | 说明 |
|------|------|
| 文件名用小写+连字符 | `getting-started.md` 而非 `GettingStarted.md`（跨平台兼容） |
| 扩展名统一用 `.md` | Markdown 是事实标准，易渲染、易对比 |
| 用数字前缀排序 | `01-intro.md`, `02-setup.md`，方便自动排序 |
| 每个文件一个主题 | 避免一个文件既讲安装又讲 API 设计 |
| 索引文件命名 | 用 `index.md` 或数字前缀作为目录入口，避免 README.md |

**必须的文档类型**（如有）：

| 文档类型 | 文件名 | 职责 | 适用条件 |
|----------|--------|------|----------|
| 架构说明 | `architecture.md` | 系统如何分层、模块如何通信、关键设计决策 | 所有项目 |
| 本地开发指南 | `getting-started.md` | 环境搭建、依赖、启动命令、调试方法（面向开发者） | 所有项目 |
| API 参考 | `api-reference.md` | 完整的接口说明、字段定义（可从代码生成） | 库或服务型项目 |
| 变更日志 | `CHANGELOG.md` | 遵循 Keep a Changelog 格式，记录版本变更历史 | 有版本发布的项目 |
| 常见问题与排错 | `faq-troubleshooting.md` | 预判用户卡点，减少 issues 重复提问 | 有外部用户的项目 |
| 决策记录 (ADR) | `decisions/` | 记录重大架构选择及其上下文 | 有重大架构决策的项目 |
| 贡献指南 | `contributing.md` | 外部贡献者如何参与 | 有外部贡献者的项目 |

**可选的扩展文档类型**（项目规模变大时按需增加）：

| 文档类型 | 文件名 | 职责 | 与必须文档的区别 |
|----------|--------|------|------------------|
| 集成指南 | `integration-guide.md` | **外部如何接入**：认证流程、SDK 用法、错误码、对接示例 | api-reference 讲"接口字段"，integration-guide 讲"怎么对接" |
| 运维手册 | `operator-runbook.md` | **生产运维**：冒烟命令、故障排查、生产环境变量、回滚流程 | getting-started 面向开发者本地开发，runbook 面向运维生产环境 |
| 交接文档 | `handoff.md` | **现状快照**：当前系统有什么、处于什么状态、待办事项 | CHANGELOG 记录"历史改了什么"，handoff 记录"现在是什么样" |

**文档质量规范**：

| 规则 | 说明 |
|------|------|
| 命令可复制运行 | 必须指定运行目录 |
| 避免重复 | README 只放快速开始，细节链接到 docs/；内部也避免多处描述同一件事，优先用链接 |
| 语言与术语统一 | 全篇用同一种语言，术语表可在 `docs/glossary.md` 维护 |
| 结构标记 | 长文档开头放目录，善用标题层级（不跳级），代码块指定语言 |
| 用 Mermaid 画图 | 流程图、架构图直接写在 Markdown 里，可渲染、可版本管理 |

## Skill 类项目目录规范

> 当项目本身是一个 Agent Skill（根目录或 `skill/` 子目录下有 `SKILL.md`）时，适用本规范，不强制套用上述普通项目的 docs/ 规范。

Skill 类项目的核心是 `SKILL.md`——它是 Agent 读取的入口文档，相当于普通项目中 CLAUDE.md / AGENTS.md + README.md 的合体。`references/` 是详细文档，相当于普通项目的 `docs/`。两者已构成完整文档体系。

**标准目录结构**（运行时文件与开发文件分离）：

```
my-skill/
├── skill/                    # ← Skill 运行时文件（Agent 读取的文件）
│   ├── SKILL.md              # 技能主文件（Agent 入口，相当于 CLAUDE.md / AGENTS.md + README.md）
│   ├── references/           # 详细文档（相当于 docs/）
│   │   ├── *.md              # 各类参考文档
│   │   └── ...
│   ├── tools/                # 工具脚本（如有，.sh + .ps1 跨平台）
│   ├── examples/             # 使用示例（如有）
│   └── assets/               # 静态资源（截图、GIF、图标等，如有）
├── README.md                 # 面向人类读者的项目说明（安装、使用、对比）
├── AGENTS.md                 # AI 开发指引（如有，面向本项目的开发 Agent）
├── LICENSE                   # 开源协议
├── CHANGELOG.md              # 变更日志
├── test-prompts.json         # 测试样例（开发用，非运行时文件）
└── .gitignore
```

**文件分层原则**：

| 层 | 位置 | 文件/目录 | 作用 | 对应普通项目的什么 |
|----|------|----------|------|-------------------|
| Skill 核心 | `skill/` | `SKILL.md` | Agent 读取的入口，定义触发条件、工作流、原则 | CLAUDE.md / AGENTS.md |
| Skill 详细文档 | `skill/` | `references/` | 被引用的参考文档，不进 Agent 上下文 | docs/ |
| Skill 工具 | `skill/` | `tools/` | 辅助脚本 | scripts/ |
| Skill 示例 | `skill/` | `examples/` | 使用示例 | — |
| Skill 资源 | `skill/` | `assets/` | 截图、GIF、图标 | assets/ |
| 项目治理 | 根目录 | `README.md` / `LICENSE` / `CHANGELOG.md` | 面向人类读者的项目说明 | 同名文件 |
| 开发测试 | 根目录 | `test-prompts.json` | 测试样例（开发用，非运行时） | tests/ |
| AI 开发指引 | 根目录 | `AGENTS.md` | 面向本项目的开发 Agent | AGENTS.md |

**审查要点**：
- `SKILL.md` 的 description 是否精简（≤10行），触发词是否在正文有完整列表
- `references/` 中每个文件是否被 `SKILL.md` 引用——没有被引用的文件是孤儿文档
- `README.md` 不应重复 `SKILL.md` 的内容——README 面向人类读者（安装、使用、对比），SKILL.md 面向 Agent（触发、流程、原则）
- **不强制建 `docs/` 目录**——`references/` 已经承担了 docs/ 的角色
- **目录结构检查**：Skill 运行时文件（`SKILL.md`、`references/`、`tools/`、`examples/`、`assets/`）应在 `skill/` 子目录下；开发与治理文件（`README.md`、`AGENTS.md`、`LICENSE`、`test-prompts.json`、`.gitignore`）应在根目录下。发现运行时文件散落在根目录时，在审查报告中标注为 🟡 中，建议迁移到 `skill/` 子目录

## Monorepo 项目文档规范

> 当项目包含 `workspaces` 字段（package.json）、`pnpm-workspace.yaml`、`lerna.json`、`turbo.json` 或顶层 `packages/` + 多个子包 `package.json` 时，判定为 Monorepo 项目，适用本规范。

Monorepo 项目的文档需要兼顾**根级全局视角**和**子包独立视角**两层受众。根级文档描述跨包约定和全局工具链，子包文档描述包内实现细节。

**文档层级结构**：

```
monorepo-project/
├── CLAUDE.md / AGENTS.md      # 全局 AI 行为守则：Monorepo 工具链、子包通信方式、共享依赖管理
├── README.md                  # 全局项目说明：整体架构、快速开始（含 workspace 启动命令）
├── docs/                      # 全局文档（如有）
│   ├── architecture.md        # 整体架构：子包关系图、数据流向
│   └── ...
├── packages/
│   ├── core/
│   │   ├── CLAUDE.md / AGENTS.md  # 子包级 AI 行为守则（如有，只管本包约定）
│   │   └── README.md              # 子包说明（如有）
│   └── api/
│       ├── CLAUDE.md / AGENTS.md  # 子包级 AI 行为守则（如有）
│       └── README.md              # 子包说明（如有）
├── turbo.json / pnpm-workspace.yaml  # Monorepo 工具链配置
└── package.json                      # 根级 scripts + workspaces 声明
```

**审查要点**：
- **根级 CLAUDE.md / AGENTS.md** 必须包含：Monorepo 工具链（turbo / pnpm / nx / lerna）、子包间依赖关系、共享包使用约定、跨包命令（如 `turbo run build`）
- **子包级 CLAUDE.md / AGENTS.md**（如有）只描述本包特有约定，不重复全局规则
- **共享依赖版本一致性**：同一依赖在不同子包的 `package.json` 中版本必须一致（版本不一致 → 🔴 高优先级问题）
- **`workspaces` 声明一致性**：根 `package.json` 的 `workspaces` 字段与实际子包目录结构必须匹配
- **子包间内部 API**：如果子包之间存在导入/调用关系，接口契约应在文档中有说明
- **CHANGELOG 策略**：明确是根级统一 CHANGELOG 还是各子包独立 CHANGELOG（或 Changesets），并在审查时验证记录覆盖了所有子包的变更
