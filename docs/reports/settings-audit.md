# 设置键审计（2026-11-22）

> 机器生成：node scripts/audit-settings.mjs——键 × 代码消费 × 面板 UI 三面交叉。
> leaf 名粗粒度匹配（保守）：DEAD/FAKE_UI 需人工复核后处置。

- 总键数（含嵌套）: 126
- OK: 122　NO_UI（脱控）: 4　DEAD（死键）: 0　FAKE_UI（假开关）: 0

## NO_UI — 有消费但面板无开关（实际不受设置控制）

- `steamApiKey`（代码引用 5 处）
- `vmFilterKeywords`（代码引用 4 处）
- `filterKeywords`（代码引用 3 处）
- `filterMatchMode`（代码引用 3 处）

## DEAD — 无任何消费

（无）

## FAKE_UI — 面板有开关但无消费

（无）

## 人工复核结论（v14.42.6，2026-11-22）

- **0 真死键、0 假开关**——设置面整体健康。
- 4 个 NO_UI 复核：
  - `steamApiKey`：types.js 已登记历史遗留键（无 UI 无消费方，仅数据兼容保留）——维持不动。
  - `vmFilterKeywords`/`filterKeywords`/`filterMatchMode`：filterRules（规则列表，**有完整 UI**）为空时的回退默认值——语义已被规则列表 UI 覆盖，补参数 UI 反而制造冗余（议题②反向应用：不加重复开关）。维持不动。
- 结论：用户观感的「功能失效/不受面板控制」实态 = 功能运行被**设置态**卡住（总开关/徽章可见性/导入规则包），已由 dashboard 🩺运行自检卡 + 一键修复（v14.42.6）承接。
