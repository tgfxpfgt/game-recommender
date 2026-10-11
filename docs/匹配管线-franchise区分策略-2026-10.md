# 匹配管线：franchise 内错配区分策略（设计稿）

> 2026-10-11 · 第五轮 B9 专项会话实测产出 · 状态：**设计（未实施）**
> 实测工具：`tests/e2e-probe.mjs --live`（v14 B9 新增 --live 开关）+ `diagnose-matching.mjs`
> 建议落地批次：v14.3.2（附回归测试；diagnose-matching.mjs 的 TESTS 数组即用例骨架）

## 1. 实测证据（2026-10-11，真实站点 + 真实 Steam API）

| 页面 | 路径 | 结果 |
|---|---|---|
| `xianyudanji.gg/pcdj`（列表页） | 列表批量检索 | **215 个徽章渲染**；日志尾窗 30 条全为"列表页搜索未找到"（含 极限竞速：地平线6 / 光与影：33号远征队 / 英雄传说：创之轨迹 等标题带英文段的在售游戏） |
| `99778.html` 龙之信条2 | 封面 appId 直取 | `通过 appId 2054970 直接获取: Dragon's Dogma 2` ✓（搜索链被旁路——站点页面普遍嵌 Steam CDN 截图，appId 直取按设计主导） |
| `103325.html` 极速俱乐部：无限3 | appId 直取 → Steam appdetails **超时** | 浮窗停在"查询失败: 操作超时（GET_STEAM_BY_APPID）"，**无标题搜索兜底**（观测缺口 P2-3） |
| `103459.html` 永冻纪元 | 正文截图 appId 直取 | `appId 2254990 直接获取: 永冻纪元 - Permafrost` ✓ |
| diagnose-matching D&D 用例 | 全搜索链（handleSearchSteam） | **错配复现**：`龙与地下城：无冬之夜2增强版` → 命中 `Demeo x Dungeons & Dragons: Battlemarked`（3124340）✗ 期望 `D&D Neverwinter Nights 2: Enhanced Edition`（2738630） |

### 关键交叉验证数据（D&D 错配案例）

```
raw 英文段:        "Dungeons & Dragons Neverwinter Nights 2: Enhanced Edition"
中文命中名:        "Demeo x Dungeons & Dragons: Battlemarked"
enWordsOf 命中名:  { demeo, dungeons, dragons, battlemarked }
enWordsOf 英文段:  { dungeons, dragons, neverwinter, nights, enhanced, edition }
词交集:            { dungeons, dragons }  → 2 ≠ 0
v14.3.1 交叉验证:  交集 = 0 才英文重搜 → **未触发**，错配直通
英文重搜(l=english): 直接命中 2738630 ✓（实测）
```

**结论**：v14.3.1 的零交集判据只防"跨 franchise 错配"（如 战争机器 → Metal Force），
防不了"**franchise 内错配**"——兄弟篇游戏天然共享 franchise 词（dungeons/dragons），
交集恒 > 0。

## 2. 区分策略设计

### P1-A 内容词覆盖判据（替代零交集判据，orchestrator-detail.js 阶段 2）

核心洞察：正确命中名会覆盖 raw 英文段的**全部内容词**；franchise 兄弟篇只覆盖
franchise 头词、缺失特征词（本例缺失 neverwinter / nights）。

```js
// 版本级噪声词（中文命中名的英文名常缺省版本后缀，不计入覆盖判据）
const EDITION_WORDS = new Set([
  'edition', 'enhanced', 'deluxe', 'upgrade', 'remastered', 'remaster',
  'definitive', 'complete', 'goty', 'bundle', 'collection', 'demo', 'trial'
]);
const rawWords = [...enWordsOf(enSegment)].filter((w) => !EDITION_WORDS.has(w));
const coverOf = (name) => rawWords.filter((w) => enWordsOf(name).has(w)).length;

// 触发英文重搜：零交集（现规则保留）或 内容词未全覆盖（franchise 兄弟篇信号）
// rawWords.length >= 2 护栏：单词段（permafrost/drowse 类）区分度不足，不触发
const hitCover = coverOf(searchResult.name);
const needEn = searchResult && enSegment && rawWords.length >= 2 &&
  (hitCover === 0 || hitCover < rawWords.length);
if (needEn) {
  const enResult = await searchSteamAppId([enSegment], options.rawTitle, excludeAppId, 'english');
  // 单调改进护栏：仅当英文结果覆盖**严格更优**才替换——重搜失败/等覆盖时
  // 保留中文命中（与现"英文重搜未命中 → 保留中文结果"语义一致）
  if (enResult && coverOf(enResult.name) > hitCover) {
    Logger.info('Steam', `交叉验证升级: "${searchResult.name}"(覆盖 ${hitCover}/${rawWords.length}) → 英文重搜 "${enResult.name}"`);
    searchResult = enResult;
  }
}
```

D&D 案例走查：rawWords = {dungeons, dragons, neverwinter, nights}（enhanced/edition
入噪声表）→ 命中覆盖 2/4 < 4 → 触发英文重搜 → 2738630 覆盖 4/4 > 2/4 → 替换 ✓。

**护栏组合的防误伤论证**：
- 单词段不触发（permafrost / drowse / invokyr 类小站游戏，中文命中即可信）；
- 全覆盖不触发（绝大多数正常命中）；
- 重搜失败保留中文命中（现状语义）；
- 等覆盖不替换（英文段本身拼写噪声时防抖动）；
- 每次替换有 Logger.info 轨迹（E2E --dump-logs 可审计）。

### P1-B 版本号失配信号（可选增强，同判据内叠加）

`"EA SPORTS FC 25"` 命中 `"EA SPORTS FC 24"` 这类**词全同、仅版本号不同**的错配
覆盖判据失效（覆盖相等不触发）。补一条：从英文段与命中名各提取独立数字 token
（`\b\d+\b`），raw 有而命中没有（或相异）→ 同样视为覆盖缺失计入 `needEn`。
需自带回归用例（FIFA/FC 年货、文明 6/7、如龙 0/7），P1-A 不依赖它，可分开落地。

### P2 观测缺口（实测发现，独立小批次）

1. **列表页无 rawTitle 英文兜底**：v14.3.1 三阶段匹配只落在 orchestrator-detail；
   列表页（orchestrator-list.js）实测对 标题带英文段 的在售游戏批量"搜索未找到"
   （Forza Horizon 6 / Clair Obscur 33 等）。方向：GET_STEAM_RATINGS 批次透传
   rawTitle（列表项已有原始标题），列表侧复用同一 enSegment 兜底。注意 message
   契约（铁律 7）与批次体积（ratingsBatchSize=60 × 标题长度）。
2. **appId 直取失败无搜索兜底**：GET_STEAM_BY_APPID 超时 → 浮窗直接"查询失败"
   （103325 实测）。方向：直取失败（超时/网络错）时落回标题搜索链路，而非终止。
3. **diagnose-matching.mjs 父模式在 Windows 失效**：execSync 内嵌
   `node --input-type=module -e` 的引号在 git-bash/win 下全部丢失 → 0/5 假失败；
   子进程直调正常。落地 P1 时顺手修（改用临时文件或 --eval-file）。

## 3. 回归用例骨架（落地时进 test-orchestrator.mjs / diagnose TESTS）

```js
// franchise 兄弟篇（P1-A 主目标）
{ cn: '龙与地下城：无冬之夜2增强版', en: 'Dungeons & Dragons Neverwinter Nights 2: Enhanced Edition', appId: '2738630' },
// 词全同版本失配（P1-B）
{ cn: 'XX 25', en: 'EA SPORTS FC 25', appId: '<FC25>' },
// 不得误伤（覆盖护栏）
{ cn: '永冻纪元', en: 'Permafrost', appId: '2254990' },          // 单词段
{ cn: '勇敢者之试炼', en: 'Invokyr', appId: '<invokyr>' },        // 单词段
{ cn: '艾尔登法环', en: 'Elden Ring', appId: '1245620' },         // 全覆盖直通
```
