# 平台误配夹具补测 Spec

## Why
v14.28.7 的置信度三态修复中，「平台不一致」（`platform-unconfirmed`）是**最优先**判定，
但在既有 42 条实测夹具里一次都没被触发——3 条推测全部是跨语言命名问题。用户反馈的真实
症状是「没识别到主机游戏，一直去匹配 appid 结果错误」，即修复针对的主路径零覆盖，
83.3% 的确认率不能证明该 bug 已修。

## What Changes
- 在既有套件 `tests/unit/test-match-confidence.mjs` 内新增**平台误配夹具组**（6 条），
  逐条断言：判定结果、命中 Steam 条目（appId + 标题）、平台判定字段、理由文案。
- 加载路径改为「名称索引命中错误 appId + Steam 接口 mock」，**不再用缓存 seed**。
  原因：详情链路的缓存命中判定 `isCompleteCacheData(detail)` 要求 `name`，而 `name`
  按 `FIELD_MODULES` 路由到 meta 模块，detail 模块永不含 `name` → 缓存命中恒不成立。
- 新增**对照组** 2 条：多平台正常命中 / 页面显式 PC 标记，均应判 `confirmed`，
  防止规则把正常情况也打成推测。
- 删除临时调试文件 `tests/tmp-probe.mjs`。

**不在本批修复**（如实上报，另行决定）：详情缓存命中链路失效（上述 `name` 归属冲突）。

## Impact
- Affected specs: 匹配置信度三态（v14.28.7 R4-B2/B3）
- Affected code: `tests/unit/test-match-confidence.mjs`（仅测试）；
  `background/steam/match-confidence.js`、`background/shared/platform-detect.js` 只读引用

## ADDED Requirements

### Requirement: 平台误配用例必须逐条断言到具体结果
系统 SHALL 为每条平台误配夹具断言四项：判定（`matchConfidence` / `matchNote`）、
命中条目（`appId` + `name` / `matchName`）、平台判定字段（`matchPlatform`）、
以及平台判定纯函数返回值（`detectOffSteamPlatform(page).kind`）。

#### Scenario: 主机独占标题命中同名不同游戏
- **WHEN** 页面标题为 `猎天使魔女3 Switch|官方中文`，名称索引把该标题绑定到 Steam
  条目 `460790 / 猎天使魔女`（2017 年、另一作品）
- **THEN** 返回命中条目 `460790 / 猎天使魔女`，判定为 `suspected`，
  `matchPlatform` 为 `非 PC（主机/移动/云游戏）`，
  `matchNote` 为 `未能确认是 PC 版本（主机/移动/云游戏同名条目）`

#### Scenario: 同系列不同代（序号差 1）
- **WHEN** 页面为 `斯普拉遁3 Switch|官方中文`，Steam 只有 `斯普拉遁2`
- **THEN** 判定 `suspected`，理由为平台不一致文案，不得为 `confirmed`

#### Scenario: 同系列不同代（序号差 2）
- **WHEN** 页面为 `生化危机9 Switch|官方中文`，Steam 只有 `生化危机7`
- **THEN** 判定 `suspected`，理由为平台不一致文案，不得为 `confirmed`

#### Scenario: 重制版/决定版
- **WHEN** 页面为 `恶魔之魂 PS5|官方中文`，Steam 只有 `恶魔之魂：重制版`
- **THEN** 判定 `suspected`，理由为平台不一致文案，不得为 `confirmed`

#### Scenario: 云游戏标题命中同名条目
- **WHEN** 页面为 `赛博朋克2077 云游戏|官方中文`，Steam 有 `赛博朋克2077`
- **THEN** 判定 `suspected`（`kind=cloud`），不得为 `confirmed`

#### Scenario: 移动端标题命中同名条目
- **WHEN** 页面为 `死亡细胞 安卓版|官方中文`，Steam 有 `死亡细胞`
- **THEN** 判定 `suspected`（`kind=mobile`），不得为 `confirmed`

### Requirement: 对照组不得被平台规则误伤
系统 SHALL 保留两条对照，确认真正的 PC / 多平台作品仍判 `confirmed`。

#### Scenario: 多平台作品、页面无主机标记
- **WHEN** 页面为 `艾尔登法环|官方中文`，Steam 命中同名条目
- **THEN** `detectOffSteamPlatform` 返回 `null`，判定 `confirmed`，
  `matchPlatform` 为 `PC`

#### Scenario: 页面同时含 PC 与主机标记
- **WHEN** 页面为 `艾尔登法环 PC|PS5 官方中文`
- **THEN** 显式 PC 标记优先（`detectOffSteamPlatform` 返回 `null`），判定 `confirmed`

### Requirement: 汇报必须给出逐案结论
系统 SHALL 输出「用例 / 判定 / 命中条目 / 是否达预期」表；任一用例判成 `confirmed`
即视为 B 项未修好，须指出具体用例与原因，且**不得调整阈值掩盖**。
