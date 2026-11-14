# game-radar v2 — 绿地重写（next/）

> 约束仅一条：**功能等价**。架构、UI、样式、命名、协议、测试全部从零设计，
> 旧树（仓库根）仅作行为对照基准，全功能对齐后整体删除。

## 已裁决的技术形态

| 维度 | v2 形态                                                    | 旧形态（对照）                                         |
| ---- | ---------------------------------------------------------- | ------------------------------------------------------ |
| 语言 | TypeScript strict（noUncheckedIndexedAccess 等全套）       | JSDoc + 三份 tsconfig checkJs                          |
| 构建 | esbuild（SW esm 单文件 / content iife / 页面 iife 各一）   | 零构建：ESM 动态 import + classic IIFE 双形态          |
| UI   | Preact + TSX（声明式，innerHTML 归零）                     | 模板串 innerHTML / createElement 两派并存              |
| 样式 | tokens.ts 单源 → 生成 CSS vars；主题 = token override 数据 | 347 处内联 style + 19 个手写主题 CSS                   |
| 文案 | locales/zh-CN.ts typed 字典（编译期键检查）                | 约 25,600 处散落 CJK 串，i18n 0 使用                   |
| 协议 | 命名空间 action + MessageMap 双端类型绑定                  | SCREAMING_CASE 散动作 + 手写校验器                     |
| 测试 | colocate *.test.ts + happy-dom 真 DOM                      | 自研 FakeEl（161 行）+ eval 装载 + 37 处源码字符串守卫 |
| 命名 | game-radar 唯一标识符；动词优先导出                        | 三套项目名并行；名词化导出混用                         |

## 垂直切片（已验证，E2E 8/8 真实 Chromium）

**列表徽章全链**：内容扫描（`[data-gr-entry]`/`[data-gr-title]` 约定）→ 类型化消息
（`badges/resolve`）→ 统一管线（平台识别零网络短路 → TTL 缓存 → 评分提供方）→
Preact Badge 三态渲染（steam 命中含推测标注 / 平台 / 未找到 / 失败重试）。
fixture 提供方（确定性数据表）与未来 Steam 真源同接口（`RatingProvider`）。

运行：`npm run build && npm run e2e`（真实 Chromium，host 映射 www.xianyudanji.gg）。

## 保留的行为语义（功能等价锚点）

- **三态语义**：命中 / 确认无（not-found，可负缓存）/ 失败未知（failed，禁渲染成未找到）——判别联合类型强制。
- **平台识别**：PC 显式标记优先；整段匹配防游戏名误伤；模拟器优先于主机。
- **fail-closed 协议**：未知 action 默认拒绝；内容侧白名单。
- **管线统一**：list/detail 共用一条管线（旧世界双编排器漂移的根治形态）。

## 迭代路线（每步功能等价验收）

1. ✅ 骨架 + 构建器 + 徽章垂直切片（fixture 供配商）
2. Steam 真源供配商（storesearch/appdetails/appreviews 重写，含限速/熔断/负缓存）
3. 详情浮窗（Float.tsx：信息行/推荐/评测/内嵌卡）+ 手动机型声明（MC）
4. 页面层（popup/options/dashboard/hub/free-games/welcome/sidepanel）Preact 重写
5. 19 主题全量数据化 + 视觉回归（基线去版本号）
6. 站点适配器 v2 格式（6 站 typed 数据）+ 词表全量移植
7. 油猴同源产物（gm-adapter ~300 行）+ 旧树退役 + 仓库定名 game-radar

## 已知差异（有意）

- 图标资产暂复用旧 PNG（美术批次重绘）。
- 主题首批 3 个（steam-dark/ios17/nordic），其余 16 个在主题数据化批次补齐。
- 油猴 @version 待同源产物批次自动注入。
