# 安全深度扫描报告 — v14.37.3 聚合发版

> 2026-11-21。扫描链路（playbooks §7）：Semgrep OSS（p/javascript + p/owasp-top-ten +
> p/secrets + .semgrep/gr-dom-sinks.yml 自定义规则）全库一轮 + eslint-plugin-security
> （gate lint 常态步骤，本次 gate 全量绿）。发版范围 = v14.31.0..v14.37.3（+12,000 行）。

## 结果

**findings 98 条，0 条新增逃逸、0 条密钥泄露**——分布与定性：

| 类别 | 条数 | 性质 | 防线 |
|---|---|---|---|
| gr-innerhtml-dynamic-assignment（自定义） | 69 | innerHTML/outerHTML 非字面量赋值已知存量——铁律 1 escapeHtml 消费纪律管理中，Preact 组件渐进迁移计划内（v14.35.1/37.1 已退役批次） | check:dom-sinks 基线锁（29 文件/121 点只减不增） |
| gr-insertadjacentHTML（自定义） | 2 | 同上 | 同上 |
| raw-html-concat（p/javascript 官方） | 3 | content/detail/tracking.js——同文件已被基线锁与自定义规则双覆盖 | 同上 |
| github-actions-mutable-action-tag（p/secrets 集） | 24 | **加固建议非漏洞**：Actions 以 `@v4` 可变 tag 引用（未 pin commit SHA）——供应链纵深防御建议（Scorecard 同款检查项）；单人仓库维护成本权衡 | 挂账择批（pin-to-SHA 迁移） |

- **JS 注入类 74 条的基线覆盖证明**：全部 findings 文件均在 scripts/dom-sinks-baseline.json
  文件级计数清单内（98-24=74，issubset 验证 True）——新增逃逸会被基线锁在 gate:fast
  当批拦截，本报告存量逐条定性 = 迁移计划管理面
- **密钥泄露 0 条**（p/secrets 集中 24 条为 Actions 引用形态建议，非泄露）
- eslint-plugin-security：gate lint 步骤本次全绿（常态防线）

## 挂账

- Actions pin-to-SHA 迁移（24 处）——择批实施（上游 action 版本更新时顺手 pin，
  或一次性脚本化）

原始 JSON：semgrep-raw.json（本目录）。
