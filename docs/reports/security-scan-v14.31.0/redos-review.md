# ReDoS 实证复核 — detect-unsafe-regex 13 处挂账（v14.31.2 增补）

> 复核日期：2026-11-14 · 方法：**对抗输入实测回溯耗时**（`G:\Temp\redos-probe.mjs`
> 所用用例已内嵌本文件附录；registry `p/redos` 集 404 不存在，故弃静态规则改实证）。
> 背景：eslint security/detect-unsafe-regex 初装标记 13 处（见 REPORT.md §4 off 登记）。
> 本文件独立于 REPORT.md（其 sha256 = 已发布 seal，不改）。

## 方法

对每条被标记正则构造**对抗输入**（50KB 级、针对失败路径与嵌套量词形态：
长数字点串 / 长无分隔符串 / 长属性串 / 尾锚 miss 输入），Node 22 直接执行并计时。
判定线：≥100ms = 可疑；<100ms = 线性安全。11 用例覆盖全部 13 处标记
（match-confidence.js:108 一行两条正则分列、search.js 三段分列）。

## 结果：11/11 全 SAFE（最坏 0.3ms / 446KB 输入）

| 用例 | 输入长度 | 耗时 | 判定 |
|---|---|---|---|
| utils.js:109 IPv4（尾锚 miss） | 50,008 | 0.0ms | SAFE |
| search.js:134 版本介绍段（未闭合长文） | 60,024 | 0.2ms | SAFE |
| search.js:142 版本号提取（嵌套点串命中） | 60,000 | 0.0ms | SAFE |
| search.js:150 版本标签（前缀 miss） | 36,005 | 0.1ms | SAFE |
| match-confidence.js:108 版本剥离 1（命中） | 60,001 | 0.0ms | SAFE |
| match-confidence.js:108 版本剥离 2（命中） | 48,001 | 0.2ms | SAFE |
| orchestrator-shared.js:35 日期（CJK 分隔 miss 延伸） | 40,000 | 0.1ms | SAFE |
| steam250.js:45 榜单行（属性串展开 446KB） | 446,000 | 0.2ms | SAFE |
| page-url.js:30 首页（尾锚 miss） | 50,001 | 0.0ms | SAFE |
| inline-card.js:135 rgba（参数串 miss） | 32,010 | 0.0ms | SAFE |
| options/sites.js:77 主机校验（61+dot 串 miss） | 24,800 | 0.3ms | SAFE |

## 结论与处置

1. 13 处 detect-unsafe-regex 标记全部为**有界量词保守误报**（`{1,3}`/`{0,61}`/
   `(?:\.\d+)+` 等互斥字符类 + 有界形态，实测线性）。
2. `detect-unsafe-regex` 维持 **off**（保守规则对本库形态噪音大于信号），本文件
   即复核证据；后续新增正则若涉及外部输入 + 无界嵌套量词，人工评估后仍可用本
   探针方法实证。
3. Semgrep p/redos registry 集不存在（HTTP 404）——ReDoS 面以本实证方法为准，
   Semgrep 三规则集（javascript/owasp/secrets）未涵盖 ReDoS 专项。
