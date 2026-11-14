# 更新日志 / Changelog

> v14.28.0 起从 README 拆出（README ≤ 400 行纪律，方案 P2-2）。最新条目在最上方。

### v14.31.2（安全基建增强：CodeQL workflow + ReDoS 实证复核 + gate 信号提额）

- CodeQL 深度分析（javascript-typescript security-and-quality）随 push/PR/每周自动跑——结果进 GitHub Security 面板，与本地双工具链互补
- detect-unsafe-regex 13 处实证复核：对抗输入实测 11/11 全 SAFE（最坏 0.3ms/446KB，有界量词线性形态）——redos-review.md 入库，规则维持 off 证据在案
- gate GATE_VITEST_ENV 信号超时 20000→30000（满载竞态绷带加固，仍低于 harness 默认 60s）

### v14.31.1（安全扫描链路替代：Semgrep+ESLint security 双工具链（Mimosa 断连期 seal 证据源））

- eslint-plugin-security 4.2.1 常态入 lint 门禁（精选 10 条 error 规则；object-injection/non-literal-regexp/unsafe-regex 三条 off 理由登记）
- Semgrep OSS 1.185.0 出具 v14.31.0 发版深度扫描报告（焦点 31 文件 0 findings/全库 3 findings 全数定性误报）——seal sha256:e0a98c4d…fab11 补入 release notes 与 CHANGELOG
- AGENTS.md 发布流程第 4 步改写：扫描链路主源改双工具链（Mimosa MCP 可用时保留）；detect-unsafe-regex 13 处有界量词误报挂账择批 ReDoS 复核

### v14.31.0（列表/详情双管线一致性统一：单源化共享层 + 三态结构化 + 防脱节门禁）

- 置信度字段装配单源 attachMatchConfidence（match-confidence.js——列表 matchConflict 强制降级内聚，两管线同函数装配，新增字段只改一处）
- MC 分级色单源 **GR_PATTERNS**.mcColorFor（列表 gr-mc-badge 与详情 MC 视图同一把尺，两处字面量副本退场）
- 详情 SEARCH_STEAM 未命中响应补结构化 errorType（network/notfound，与列表 networkFailed 哨兵同名同义）——内容侧优先消费结构化字段，reason 正则兼容保留
- 防脱节规则：铁律 18 登记 + playbooks 配方 + test-match-consensus 一致性门禁组（5 用例：同输出/冲突降级/纠正强制确认/色带等价+无双副本/三态源码守卫）；有意差异登记（MC 视图无新游标签、matchConflict 仅列表接线）
- **完整发版（2026-11-14，tag+release，zip 上线）**：触发线（v14.28.10 后插入 +3255 行）→ gate 全量等效全绿（sim-list 满载竞态隔离 3 连绿定性）→ ext-refs --refresh 3 条真实校验。**安全深度扫描 seal `sha256:e0a98c4d5b45c066b80718a8a89a0bd4e408427e3b74c881bab23263168fab11`**（Semgrep OSS 1.185.0 + eslint-plugin-security 4.2.1 双工具链出具——Mimosa 钩子禁用与 MCP 断连后经用户裁决改链；焦点集 31 文件 0 findings / 全库 3 findings 全数定性误报，报告 docs/reports/security-scan-v14.31.0/）

### v14.30.0（主机游戏检索三连修复：MC 域权限根治/详情页平台预检/手动面板机型入口）

- MC 评分根治：manifest 补 metacritic.com host_permissions（缺失致 MV3 SW fetch 被 CORS 静默拦截，v14.10.0 起功能从未生效）+ 失败 Logger.warn 可诊断 + 超时单源新键 fetchTimeoutMetacriticMs + first-run 真实证据回填
- 详情页平台预检：searchSteamGame 接入 phaseDetailPlatform（与列表 phasePlatform 同优先序：映射>模拟器>主机MC>PC），主机整合/模拟器/移植版条目不再先发整套 Steam 检索；URL 索引先行加平台守卫
- 词表补「移植版/移植」裸段（PC guard 优先不变）；手动选择面板恢复「主机/模拟器」入口按钮（面板内直达机型专页，与 ⚙ 菜单同路径）

### v14.29.1（门禁变更面化提速）

- coverage:gate 改 vitest related（117.7s→24s，补 untracked 漏检）；verify:mutations 按变更面选异（76.9s→0.2-15s，STALE 恒检，full 开关保留）；pre-push 降为 lint+typecheck+test:changed（去与 gate:fast 的重复全量）
- sim-list 节 12 纳入 retry 绷带口径（节 2/2b 同签名竞态）

### v14.29.0（多站排队整队持久化 + 同站 appId 冲突防线）

- 排队检查点升级整队信封：SW 被杀不再丢排队任务（多下载站同开丢队根治）；同 tab 旧任务自动顶替；任务边界实时推送排队位置
- 进度本页视角：等待徽章显示「排队中·前方 N 页·前方约 M 项·本页 N 项」；45s 强制收尾排队感知顺延（帽 10 分钟）+ 旧任务定时器身份校验
- 同站 appId 冲突防线：同站不同页命中同一 appId 判冲突（至少一侧错配）——强制「推测」+ 跳写名称索引；URL 索引仲裁写入（推测不覆盖已有绑定，同标题转载与 DLC 折叠豁免）
- 油猴移植基线 14.14.0 → 14.29.0（用户裁决同步）：移植同站冲突防线/仲裁写入/匹配置信度门（标题+年份；平台门未移植——平台识别子系统不在油猴面）/故障三态网络异常徽章/动态负缓存提示；词表与检索纯函数零改动（test-userscript-pure 28 用例含 3 条新防线锚点）
- 门禁竞态根治：test:sim 拆双进程（sim 车道与 integration 分离——9 文件共跑时调度竞争挤掉 sim-list 异步就绪窗口，升级面五连恒红实证）+ vitest related 阶段排除 sim 套件（归位 B8 两阶段纪律）+ forceTimer 收尾三态感知（仅确认本页任务运行中才收尾，排队/不可知顺延到帽）
- 登记 4 条缺陷回放（整队恢复/同 tab 顶替/推测换绑/冲突固化）；perf-budget 按实测重锁

### v14.28.13（门禁执行历史报告与 coverage:fast 空集跳过）

- E-3 落地：node scripts/test-cost-history.mjs --report 出门禁执行历史战果报告（各步骤次数/失败率/耗时分布——执行分母）
- coverage:gate 空集跳过（gate:fast 推送后确定性空转 112s→0；computeNewFiles 单源导出，行为保持非削弱断言）
- P1-2：人工纠正来源强制 confirmed（rateMatchConfidence 单源分支——用户确认优先于相似度/平台/年份门，两管线同覆盖）
- G-2 收窄：raw 备源真实校验 HEAD 200/20,247,815B 与主源一致（first-run 注记更新；产品回退路径取证仍待真实故障）

### v14.28.12（B-2 故障语义六连清偿）

- 评论获取失败不再固化 72h「无评论」——reviewsFailed 信号透传 + cnReviewsFetchedAt 失败不写标记（恢复后自动回填）+ 浮窗评论区失败行（B2-F1）
- 好评率获取失败与「暂无评测」文案区分（ratingFailed，B2-F5）；ITAD 行四态化——未配置/失效/暂不可用/无记录各有灰行文案（{info,reason}，B2-F3）
- GET_STEAM_BY_APPID 失败响应补 reason（与「无数据」可区分，候选浮窗文案透出，B2-F4）；Steam250 消息级失败渲染保底榜单链接行（B2-F6）；限免页全源失败显示「上次成功数据」提示行（fetchErrorAt 消费，B2-F2）

### v14.28.11（工作完整性纪律与测试开销监控）

- 新增用户指令两条纪律入 AGENTS.md：每批工作闭环做完不留半成品（留未完成须先确认）/ 测试开销要有记录异常及时发现
- gate 每步骤耗时自动记录 scripts/.gate-costs.jsonl（gitignored）+ 收尾滚动中位数对比，超 1.5× 中位数告警（拦静态预算 cap 之下的缓慢漂移）；新套件 test-cost-history 6 用例
- mutation-check 改异步 spawn + 超时进程树击杀（taskkill /T /F）——根治 spawnSync 只杀直属子进程遗留孤儿导致的楔死级联（实测 network 变异间歇 240s 超时 3 次）

### v14.28.10（挂账清偿·miss 分桶·限免写放大治理）

- F-2：全库 v14.29.x 漂移注释归位（批次落地时以 v14.29.x 命名、实际随 v14.28.2–.9 发布；grep 归零验证）+ CHANGELOG 补记 v14.28.8 缓存完整性与 adapter 延迟装配、v14.28.9 A–G 门禁
- P1-1：首波缓存 miss 分桶落证据档案（match.wave1Miss 七类 kind）——热载未命中定位先拿数据再改缓存键
- P2-1：限免刷新节奏分文件 freeGamesMeta（约 20B/次），内容不变跳过 23KB 全量重写；四源失败可见化 + 全源失败保留旧库（B-2 审计链路 2 数据销毁修复）

### v14.28.9（运行时诊断轨迹）

- 阶段/失败类别/缓存层进入诊断包
- 新增首次运行证据门禁
- A–G 制度门禁落地：外部引用锁 / 语料分母 / 缺陷回放 / 套件墙钟预算 / 夹具→套件映射

### v14.28.8（停滞心跳·故障语义·目录源三修复）

- 停滞期进度由约40s提前到约20s（边沿触发，非轮询）
- 断网/限流失败渲染为独立「网络异常」徽章，不再误报「未找到」
- appListIndex 目录源修正为 master 分支并加 raw 备源（附首次成功取用实证）
- 修复详情缓存完整性判定恒假（isDetailCacheComplete 单源 + 模块级部分刷新，缓存先行真正生效）
- 站点 adapter 注册表延迟装配并收敛字段注释（体积净 −4,790B）

### v14.28.7（置信度口径校准：平台优先、详情同尺）

- 重写匹配置信度规则（平台不一致最优先、年份一侧缺失不降级、标题相似度主门槛 0.75 + 序号护栏）
- 详情面板/浮窗/内嵌卡展示推测徽章与依据（命中标题/来源/平台判定），B 项收口

### v14.28.6（R4 四批：匹配三要素、两级看门狗、模块索引、占位门禁）

- 匹配改三要素判定：平台+标题+发行年份一致才「确认」，否则「推测」+ 琥珀徽章与悬停依据
- 单条目两级看门狗：软阈值 20s 只告警留证（条目/阶段/耗时），硬阈值 120s 才放弃并继续队列
- 新增模块索引 docs/modules/INDEX.md（职责/依赖/导出/不变式）与漂移/豁免登记门禁
- 新增 check:stubs 门禁：占位实现与契约→handler 缺口；豁免须带原因标记并登记索引

### v14.28.5（R3 性能与门禁批次）

- LLM 兜底超时降至 25s（避开 MV3 SW 的 30s fetch 终止阈值）并新增超时组静态门禁
- 站点脚本注册移出 SW 冷启动（persistAcrossSessions 默认保留），改锚 onInstalled/onStartup/规则保存
- content_scripts 按站点拆 7 条：单页注入 45.4KB→36.5~38.4KB；perf-budget 改锁单页最坏量
- WAR 覆盖门禁扩展到 module-manifest + getURL 字面量全部动态入口

### v14.28.4（详情浮窗修复与门禁确定性）

- 修复详情浮窗菜单插入崩溃（insertBefore 参照未挂载，v14.24.0 起浮窗不渲染）
- E2E 限免 fixture 主机名对齐 www.*，限免卡片恢复通过
- 日志连续写入落盘上界 10s，防崩溃前整窗日志丢失
- 覆盖率门禁基线改纯 git 推导，release:smoke 去掉 unzip 依赖

### v14.28.3（SW 饱和修复：批量链重试与日志落盘治理）

- 确定性 miss 不再触发第二轮重打，重试轮改退避 6s + 单并发
- 重试轮改传快照副本：修复失败条目无界重打（实测 20 项 233s 未收尾、堆 4GB OOM）
- 日志 flush 批量追加（N 条一次写）并复用日志配置快照
- 单次检索内 Steam 缓存读 3 次降为 1 次；体积预算按实测重锁

### v14.28.2（SW 故障日志并入运行时日志（P3-4））

- Logger warn/error 镜像控制台，替代散落的 console 双写
- service-worker 11 处 console.* 改为 Logger（启动横幅与存储未就绪兜底保留）

### v14.28.1（E2E 抗卡死兜底）

- E2E 全链路 newPage/goto/evaluate/close 加超时兜底（SW 饱和期浏览器失联不再白等 120s）
- 5a/4/5b/终局转储超时用既有断言判红，放宽断言为零

### v14.28.0（S3 文档与门禁批次）

- README 版本流水拆分到 CHANGELOG.md（README 327 行）
- 根目录迭代文档归档 docs/reports/archive/ + docs/INDEX.md 索引
- 新增 check:docs 文档版本/索引门禁与油猴移植基线差距门禁
- 内容白名单补 ⊆ 规则表反向断言
- perf-budget 打印方案目标差距（目标判定不可达，基线锁定实测值）

### v14.27.0（S2 权限收窄与可维护性批次）

- Steam 注入面收窄至 store.steampowered.com，WAR 改为 module-manifest 单源派生（gen-war --check 入门禁/CI）
- 自定义站点按域申请可选权限并在拒绝时降级，删除站点回收该域权限
- api-search 拆分为候选/共识/兜底三模块，导出面与逐值行为不变（golden 测试冻结）
- 新增 options 保存/渲染与 dashboard 诊断 DOM 单测，全局行覆盖 44.7%→46.1%

### v14.26.0（安全与性能加固（S1））

- 日志与诊断包脱敏：URL 裁至 origin+path、递归剔除密钥字段
- 远程 LLM 端点强制 https 且禁止私有地址（本地 Ollama 分支不变）
- localhost/127.0.0.1 改为按需授权（不再安装即持有本机权限）
- ITAD Key 移出 URL 查询参数（改请求头单源构造）
- 内容脚本按页面场景分流装载（列表 258KB / 详情 256KB，原 381KB）
- 消息超时单源化 + 批量评分显式长超时，迟到推送补徽章
- 冷启动故障可观测：Boot 日志 + Dashboard 启动故障计数
- 门禁新增未跟踪静态导入与引用路径存在性检查

### v14.25.0（使用证据档案——本地使用记录机制，优化完善的数据依据）

- 新增使用证据档案（usage-evidence）——三层有界记录全本地：计数器（15 键 allowlist：缓存先行命中/检索命中/未命中/强制刷新/机型声明/手动映射等关键路径累计）、耗时环形（检索/直取 p50/p90）、高信号事件 FIFO（未命中原因/好评率回退层级/评论结构漂移/人工报错，近 7 天分布）
- 读侧：GET_USAGE_EVIDENCE_REPORT（扩展页）+ 一键诊断包同源附带 usageEvidence 字段——后续优化会话读报告即可量化定位问题/调默认参数（docs/playbooks.md §0 已写读法配方）
- 埋点 18 处全在后台（菜单动作经既有 action 落账，内容侧零改动）：SEARCH_STEAM 四出口/直取/强制刷新/名称刷新/重查/强制清页/手动映射/机型声明/人工报错/好评率回退三级+活端点/社区评论成功失败+结构漂移/评论回填/错题采集
- 顺带修真 bug：记录 API fire-and-forget 与 flush 竞态——flush 不等在途 apply 会丢记录（单测实证），apply 串行队列 + flush 先排空（铁律 6 同源）
- 隐私边界：不记录页面 URL 与游戏标题（仅类别/结果码/appId）；有界（计数键 allowlist/环形 50/事件 300）；随清除数据清理、随备份导出

### v14.24.1（极限收敛：token/时间系统性优化（门禁提速 + sim 稳定 + 探索查表化））

- 白名单单源升级改定向验证——related + 扫描器套件（契约/设置同步/完整性）替代全量 npm test（100-270s→~20s），测试基建例外仍全量；大批次 >15 文件仍全量
- coverage:gate 基线标记 .coverage-gate-base（上次已门禁 HEAD）——消除未推送提交堆积导致的每批全量覆盖率重跑（~4min→瞬时）；修复 cmd.exe 吃 ^ 字符致标记恒失效
- gate:fast visual 按变更面跳过（触发面 = 扩展页/样式/图标/shared/manifest——基线只渲染四个扩展页），纯后台/工具批次省 ~30-60s
- sim 信号超时默认 20s→60s（推送抖动 ~40% 假红提额即稳，v14.17 先例）+ 节2/2b retry:2 绷带（Vitest 4 嫌疑专项前保 gate 可用）+ Vitest 4 死配置 poolOptions 清理 + test:sim 固化 include 顺序
- docs/playbooks.md 任务类型配方（浮窗/管线/设置键/action/存储/词表/发版 7 类触点查表）+ AGENTS.md 指针——探索式读码改查表直达

### v14.24.0（详情页浮窗：缓存先行提速 + 动作迁入 ⚙ 菜单 + 评论回填自愈 + 真实清缓存 + 缓存池扩容）

- 浮窗提速（用户报告'有缓存也慢'）——详情页 URL 索引命中路径此前完全绕过缓存每次全量拉取（appdetails×2+商店页+评测+spy+公告 ~6 出站请求），现缓存先行：完整有效条目（含好评率重取/倒挂自愈/评论回填标记/名称相关性四重判定，与列表页 tryCacheServed 同口径）直接合并返回零出站，未命中才转全量
- 动作迁入 ⚙ 菜单（用户需求）——手动更新/重新检索/选择机型三项进右上角菜单（data-menu-action 标记，点击自管 busy 反馈），浮窗底部两按钮移除；'选择主机机型'菜单直达机型专页（candidates 主视图入口按钮同步移除，openPlatformView 参数）
- 评论回填自愈（用户报告'依旧没有具体评论'）——cnReviewsFetchedAt 标记：v14.21.2 前旧缓存条目 reviews 恒空且被缓存命中永久顶住，现缺标记条目自动转完整拉取一次回填社区评论正文（标记在位且 reviews 空 = 确实无评论，不循环重取）
- 真实清缓存（用户需求'重新检索就该清掉缓存即使没找到新信息'）——GET_STEAM_BY_APPID 新增 forceRefresh：手动更新/重新检索带标记跳缓存直取并预删该 appId 缓存，拉取失败也不留旧数据（旧实现缓存有效时直接回旧缓存 = 更新按钮无效）
- 缓存池扩容（用户需求）——STEAM_CACHE_MAX_ENTRIES 1200→3000（4 分文件写放大已控，LRU 语义不变）

### v14.23.1（最小必要收敛：分层门禁 + 受影响测试 + 版本一键 bump）

- 分层门禁——gate:fast 改为受影响测试选择（vitest related + sim 显式路径映射），宽爆炸半径单源白名单（constants/settings/契约/存储层/shared 等）触碰自动升级全量 vitest，全量 gate 保留发布触发点
- 版本四处一键 bump——npm run bump patch|minor "标题" "要点"一次完成 manifest/package/README/welcome 同步（油猴 @version 仍为移植基线不动）
- AGENTS.md 新增最小必要变更纪律（分层门禁/样板一键化/最小 diff）+ 测试最小必要规则（就近回归用例、不三层重复铺）

### v14.23.0（详情页浮窗：⚙ 下拉菜单 + 右缘拖拽调宽 + 折叠回归修复）

- **折叠按钮修复（用户报告"点击无反应"）**：v10.6.0 重构引入回归——切换条件把"当前状态"当"目标状态"传入 `setFolded`（`setFolded(display==='none')` 恒等于设回当前态），折叠按钮自 v10.6.0 起恒无操作；真机复现实证后修复为取反切换，sim F1 回归锁定
- **折叠按钮升级为 ⚙ 下拉菜单（用户需求）**：浮窗标题栏 ▾ 折叠按钮改为 ⚙ 菜单——折叠/展开、内容缩放（80%–140%，步进 10%，body zoom 单点生效——浮窗模板全内联 px 字号）、重置位置与大小；所有 chrome 浮窗统一获得（诊断/下载站面板/下载历史同享），缩放/宽度按浮窗 id 持久化（`grFloatScale`/`grFloatWidth`，chrome.storage.local）
- **右缘拖拽调宽（用户需求）**：浮窗右缘手柄拖拽调整宽度（260–640px 钳位 + 视口右界钳位，手柄右探 3px 避开滚动条）；位置记忆（v11.0）实测有效，本次补恢复时视口钳位（换屏/缩窗后旧坐标出屏防护）
- **菜单缓存信息区（用户需求）**：⚙ 菜单显示当前游戏缓存时间 + Steam 缓存条目/命中/未中 + 负缓存条数——新增轻量只读 action `GET_FLOAT_CACHE_INFO`（区别于 GET_STATS 全量聚合，菜单打开时即时查询）
- **候选浮窗主机机型入口按钮化（用户需求："检索错误再选择主机不直观，直接加一个按钮"，并发批次并入）**：35 个机型按钮从浮窗中部平铺收敛为主视图一个醒目入口按钮（`gr-platform-entry`），点击切换机型选择专页（厂商分组 + 状态行 + 返回按钮/Esc 双出口）——候选搜索视图保持紧凑；专页激活期间候选列表键盘导航停用（列表仅隐藏未销毁），Esc 监听带自清理（面板重渲染后自摘防泄漏，v14.13 B6 同款模式）；两个调用点（未命中/报错重检索）均经同一渲染函数自动受益；XSS 棘轮 73→74（入口按钮三元受控静态片段 +1 入基线）+ 回归守卫 +2 入 test-manual-platforms（commit 53a8f3a）
- 测试：`tests/sim/sim-float-menu.mjs` 新套件 F1–F10（折叠回归/菜单三态/调宽钳位/缩放持久化/外点关闭/恢复钳位/重置/teardown 泄漏）；sim-harness `storage.local` 真实化（内存 store 语义对齐 chrome.storage）+ 文档级监听捕获/计数

### v14.22.2（Steam 浮窗 Steam250 排名行：关 SteamSpy 不再丢失 + 整行可点跳转）

- **排名行与 SteamSpy 模块解耦（用户报告"浮窗缺 Steam250 排名信息"根因）**：`gr-steam250-row`/`gr-series-row`/`gr-itad-row`/`gr-fav-row` 四个异步数据行锚点原嵌在 SteamSpy 块内——options 关闭 SteamSpy 模块（fmSpy）时四行被一并带走（Steam250 排名/系列作品/ITAD 最低价/收藏按钮全消失）；提出为常驻独立块，各行数据源本就独立（各自后台消息）、默认隐藏数据就绪才显示，常驻渲染零视觉成本，SteamSpy 开关回归只管 SteamSpy 本体
- **整行可点跳转 steam250（用户需求）**：排名行/"未入前 250"提示行整体并入 `club.steam250.com/app/<appId>` 游戏专属深链——命中区从尾部 `Steam250 ↗` 小链接扩到整行；快照不可用（抓取失败/解析哨兵拒绝）不再整行静默，保底显示可点"🏆 Steam250 榜单 ↗"行（持续不可达环境下功能入口仍可辨识可触达）
- 测试：test-ui-pure 新增 spy:false 四锚点常驻回归；test-sidebar-rows 新增整行链接/保底行/消息失败三用例

### v14.22.1（Steam 浮窗 Steam250 排名行：跳转升级游戏专属深链）

- **排名行跳转升级（Steam 浮窗 + 内嵌卡双挂点）**：`Steam250 ↗` 链接从通用 top250 榜单页改为该游戏的 steam250 专属页深链（`club.steam250.com/app/<appId>`）——top250 页不含未入榜游戏，专属页实测对未入前 250 的游戏同样提供（含 250 名外扩展排名），入榜游戏落地即其排名锚点；"未入前 250"提示行同步带链接

### v14.22.0（steam250 游戏页接入：下载站检索 + Steam 跳转）

- **steam250 游戏页功能接入（复用 Steam 商品页管线）**：`club.steam250.com/app/<appId>` 游戏详情页现注入下载站资源检索浮窗（缓存优先 + 站内搜索——Steam 商品页同一管线参数化复用零复制），面板头部附 Steam 商店页跳转链接，并同步发送 `CACHE_STEAM_PAGE` 预热（回到下载站列表页徽章即时有数据）；manifest `content_scripts`/`host_permissions`/`web_accessible_resources` 三处新增 `*.steam250.com`
- **页面识别与降级**：真实游戏页在 club 子域（`steam250.com/app/*` 为 404，2026-11 实测）——按 `/app/<digits>` 路径判定；榜单页（top250 等）无单一游戏对象零注入；steam250 为功能页宿主（非追踪站）：不做行为学习、零 TRACK_EVENT，与 Steam 商品页同先例
- **名称提取**：页面 `<h2>` 优先，title 回退并清洗 " – Steam 250" 尾缀（`steam250AppIdFromUrl`/`steam250NameFromTitle` 纯函数，sim 9e 节回归覆盖：面板渲染/预热消息/榜单页早退/名称清洗）

### v14.21.2（浮窗具体评论回归：steamcommunity 评论正文回退源）

- **评论正文替代源上线（用户报告：xdgame 详情页"依旧没有显示具体评论"）**：appreviews 端点 302 死亡后 v14.19/v14.21.1 只补齐了好评率**摘要行**（百分比/评价数），浮窗"简体中文评测"区（评论**文字引用**）一直空着——商店页 SSR 不内嵌评论文本。实测发现 **steamcommunity 评论浏览页仍活着**（免登录，每页 10 条完整评论卡）——新增 `background/steam/api-community-reviews.js`：解析 `apphub_CardTextContent` 评论卡（正文/推荐方向 thumbsUp|Down/日期），DLC 的 reviews URL 自动 302 到本体评论枢纽（评论归属本体语义正确）
- **回退链接入**：`fetchChineseReviews` 死旗标置位（或首次观测 302）即转社区页抓取（独立 'steamcommunity' 熔断域不连坐 store；会话去重 10min TTL；解析零产出置结构变更哨兵本会话跳过——三层护栏与 appreviewsDead 同构）
- **解析鲁棒性**：官方公告卡（无 date_posted，DLC hub 变体页混入）跳过；正文内嵌引用块的中段日期截断/开头日期剥除（防把引用头并入正文）；en 页 `Posted:` 前缀剥除；正文窗口在下卡 vote_header 标记处截断防跨卡污染。2026-11 真实页面双形态验证（正常页 10/10、DLC hub 变体 3/3 全干净）
- 油猴脚本暂不移植（GM 链路另需适配层；扩展侧先行，随下次油猴批次同步）

### v14.21.1（v14.21.0 执行期收尾：TS 收窄 + 并发批次落库）

- api-reviews 商店页解析重构后的 TS 收窄补齐（cnRow.count/allRow.count 解构局部常量——withCount 过滤语义非空但类型不跟随）；版本 14.21.0 → 14.21.1（执行期修正惯例）

### v14.21.0（复古平台补齐 + Steam250 排名回归 + 浮窗评论解析修复）

- **通用组 2 → 9 项**（用户需求：按 M 站分类方式增加平台类型）：GB · GBC · Neo Geo · PC Engine · Mega CD · Atari 2600 · WonderSwan（均系 M 站有独立评分分类而名册缺失的平台）+ 既有其他主机/模拟器 ROM——总名册 28 → **35 项**
- **优雅降级**：M 站无该机型评分的声明（如部分复古平台）自动落纯机型徽章终态（抓分失败不阻断映射）——罗列广度无风险；FC/SFC 与 M 站 NES/SNES 同机不重列（中文站口径）
- **Steam250 排名行回归（详情页浮窗，用户报告看不到排名）**：steam250.com 重建页后旧锚点（`#N` 文本/`N reviews` 关键词）双双失效，解析恒不足 100 条被哨兵拒绝 → 排名行静默消失——`parseSteam250Html` 重写为行容器锚定制（`<div id=N><div class=rank>` + score/votes 专属锚点，兼容排名变化指示 span 变体），2026-11 真实页面 250/250 全解析实测；快照已加载而游戏未入前 250 时显示灰色"未入前 250"提示行（此前与"快照不可用"不可区分，功能存在感为零）
- **浮窗评论解析修复（用户报告"依旧显示评论异常"）**：Steam 商店页服务端渲染已不再输出"全部评测"行（桌面区块仅"最近评测"+"您语言"两行）——旧回退 `|| parsed[0]` 把最近 30 天行误当全时段：总体行 21,141 条 < 简体中文行 208,065 条**评价数倒挂** = 用户所见"评论异常"（v14.19.0 只修了简体中文行，漏了总体行错位）——回退解析重写为行块制 + 行语义三级取用（真·全时段行 → "您语言"行代位：l=schinese 请求下即官方"简体中文评测"全时段精确摘要 → 最近行保底保徽章活性），ratingDesc 改取**所用行块内**官方评语文案（此前恒取最近行的"褒贬不一"张冠李戴），简体中文行 desc 同步接入（"多半好评"）
- **倒挂污染自愈**：`hasInvertedReviewCounts` 指纹（简体中文评测数 > 总数 = 旧回退误写条目，正常数据语言子集恒 ≤ 总数）——detail/list/预载三路径缓存命中判定接入，72h 详情 TTL 内已污染条目自动重取纠正，无需手动清缓存；油猴脚本 fetchReviewSummary 同口径同步（顺修 tooltip 正则 `[ age]*` 无法跨越 href 属性的潜在错配）

### v14.20.0（手动主机机型扩至全主机厂商）

- **名册扩充（用户需求：索尼/微软/任天堂/世嘉全主机类型）**：MANUAL_PLATFORM_OPTIONS 6 → **28 项**，按厂商分组渲染（`MANUAL_PLATFORM_BRANDS` 单源）——任天堂 11（Switch/Switch 2/Wii U/Wii/NGC/N64/SFC/FC/3DS/NDS/GBA）、索尼 7（PS5/PS4/PS3/PS2/PS1/PSP/PSV）、微软 4（Xbox Series X|S/Xbox One/Xbox 360/Xbox）、世嘉 4（DC/SS/MD/GG）+ 其他主机/模拟器 ROM；候选面板按厂商行分组（flex-wrap 自适应）
- **零下游改动**：id 全小写 ASCII（契约 ≤20 字符），声明→抓分→映射→三管线消费链路不变；检测词表此前已含全部对应机型段（整段匹配）

### v14.19.1（修复：报错路径的手动面板没有主机机型选项）

- **根因**：`renderManualSelectPanel` 有**两个调用点**——首次未命中路径（sidebar.js）与"⚠️ 信息有误？重新检索"路径（sidebar-actions.js）。匹配错误的场景（首次检索"成功"匹配到错误 Steam 条目）必经后者，而该调用点 v14.19.0 漏接 `onPickPlatform` 参数——主机选项区不渲染（用户报告）
- **修复**：机型声明回调收口为 `actions.makePickPlatform` 单源工厂（sidebar-actions.js），两个调用点共用——同构闭包漂移面消除；v14.19.0 在 sidebar.js 的内联闭包改为消费同一工厂

### v14.19.0（用户反馈三修：手动主机机型 + 浮窗评论修复 + 列表页错误徽章纠正）

**手动主机机型选择（详情页匹配错误时）**

- **SET_MANUAL_PLATFORM 全链**：候选浮窗新增主机机型选择区（Switch/Switch2/PS5/PS4/Xbox/模拟器 ROM，shared MANUAL_PLATFORM_OPTIONS 单源）——匹配错误且实为主机/模拟器条目时，选机型即转 Metacritic 评分并持久化映射（新存储模块 manual-platforms.json，容量 500 LRU，随备份导出、不随清缓存删除）
- **三管线消费**：列表第一波 cache-only（映射 MC 直返/模拟器打标）、第二波 phasePlatform（映射优先于一切识别与索引）、详情 searchSteamGame（MC 形态数据，浮窗切 MC 视图模板）——错误 Steam 条目随映射消失；名称索引粘性钉住在声明时同步解除
- **浮窗 MC 视图**：MC 徽章（色带同列表页惯例）+ 机型标签 + Metacritic 链接；平台条目跳过 Steam 侧联动（行填充/标签回写/内嵌卡）
- **extractEnNameSegment 修复**：取最长英文段而非首个——"宝可梦传说 阿尔宙斯|v1.1.1|官方中文|Pokemon Legends: Arceus"类标题（咸鱼单机真实形态）首个 ASCII 段是版本号（'v1.1.1' 恰好满足 {3,}），slug='v1-1-1' 必 404；列表管线 MC 命中率同受益

**详情页浮窗 Steam 用户评论修复**

- **根因**：appreviews 端点自 v14.8 起对全参数形态 302 商店首页（Steam 侧变更）——好评率当时加了商店页回退，但**中文摘要与评论文本没接**，fetchChineseReviews 每次仍打死端点、评论文本恒空
- **修复**：fetchChineseReviews 接入同一死亡旗标（置位后跳过死端点，SW 冷启动重新探测）；商店页"您语言"摘要行解析（与全部行同构）经 fetchSteamReviews 合并为 cnReviewSummary 回退；评论文本无 keyless 替代源（商店页不内嵌），端点恢复前按无文本降级（浮窗隐藏该区块）

**列表页错误徽章纠正（106902 案例）**

- **根因**：主机游戏匹配错误后，URL 索引/名称索引钉住的错误 Steam 缓存**先于第二波平台识别**返回——第一波（cache-only）此前无任何平台检查
- **修复**：第一波平台预检（手动映射 → 分类页提示词识别）——映射/模拟器条目第一波即打平台标签或 MC 徽章；RETRY_GAME_LOOKUP 就地重试补平台分支（platformOnly/mcScore 渲染平台徽章，此前落入"仍未找到"）

**测试**：+12（SET_MANUAL_PLATFORM 契约 ×2、manual-platforms 存储往返/容量帽/防御 ×3、处理器全链 ×2、三管线消费 ×4、extractEnNameSegment ×2）——新增 tests/unit/test-manual-platforms.mjs 入 include

### v14.18.0（用户需求：两站真实页面实证——分类页平台提示 + 词表补齐）

依据 [咸鱼单机"模拟器版"分类页](https://www.xianyudanji.gg/pcdj/mnqzh) 与 [XDGAME 模拟器整合分类页](https://www.xdgame.com/game/10/) 实抓数据优化检索机制：

- **分类页平台提示（新机制，规则 `listPlatformHints` 声明）**：两站实证发现主要失败模式——分类标签（"模拟器版"/"模拟器整合"）在列表卡片的**独立元素里**，条目标题完全不含平台标记（如"宝可梦传说：阿尔宙斯|v1.1.1|官方中文|支持手柄|Pokemon Legends: Arceus"），标题级识别必然落空被当 PC 检索。站点规则按 URL 模式声明提示词（咸鱼单机 `/pcdj/mnqzh`→模拟器版；XDGAME `/game/10/`→模拟器整合），当前页 pathname 命中即随评分批次传后台，phasePlatform 与标题拼接为附加段参与识别（PC 守卫仍优先——标题带 steam/pc 段的双平台条目不被提示词带偏）；预载下一页同语义继承；消费侧防御性校验（坏正则/超长/异型条目跳过不抛错）
- **词表补齐（页面实证）**：模拟器产品名 +3（RetroArch/KEmulator/Kawaks——"GBA经典游戏整合包-RetroArch模拟器"等站内整合包标题）；组合段佐证 +整合（语序变体"整合模拟器版"——恸哭奇机等真实标题，与"模拟器整合"仅词序相反）
- **测试 +3**：两站真实标题 golden（无标记标题 × 提示词命中/提示词不压 PC 守卫）+ platformHint 任务级集成（零网络直达 platformOnly 终态）

### v14.17.0（用户反馈双修：民间移植识别增强 + 多标签页排队治理）

**发版记录（v14.17.0 tag+release）**：release 附 zip + 深度扫描 seal sha256:47e5cd0d...3df678d（9 中危=油猴 renderFloat 结构性提示，全部插值经 esc() 转义，appId 来源数值约束——核实记录见 docs/reports/功能建议报告 执行批注）。

**平台识别（问题一：主机/模拟器条目被当 PC 检索）**

- **词表扩充（shared/platform-detect.js）**：模拟器产品名整段标记（yuzu/ryujinx/eden/sudachi/citron/dolphin/pcsx2/rpcs3/ppsspp/cemu 等 18 个——民间移植标题常以模拟器名作独立段）；主机数字版 ROM 格式段（NSP/XCI/NSZ/NRO/WBFS/RVZ/VPK/CHD → console 语义，评分仍试 Metacritic）
- **后缀迭代剥离**：段尾修饰逐层还原到机型词（"switch整合版"→switch、"NS整合包"→ns、"主机游戏移植版"→主机游戏；追加 包/移植/主机/掌机 四个修饰后缀——旧实现只剥一层，"Switch中文版"这类双层修饰整段落空）
- **组合段二级匹配（强佐证制）**："Switch模拟器整合版/yuzu模拟器/ns模拟器"整体一段时经"含'模拟器'＋同段模拟器名子串/短机型前缀佐证"命中——无佐证不命中，《游戏开发模拟器》《Switchball》类 PC 游戏名不误判；PC 优先守卫叠加段首 pc/steam 强词（《PC装机模拟器》护栏保持）
- **EN 段平台词剥离（trimPlatformTokens）**：Metacritic slug 推导前剥尾部平台/模拟器/格式词——"The Legend of Zelda TotK NSP/Ryujinx"类"英文名＋平台标记"标题不剥离则 slug 必 404；测试 +9（词表/组合段/护栏不回归/EN 剥离）

**列表页排队治理（问题二：排队等待后一直卡住）**

- **任务硬截止（PERF_CONFIG.ratingsJobMaxRuntimeMs=5min）**：单任务超时丢项并立即推送 done 终态（内容侧即刻收尾出"未返回·点击重查"徽章，丢项刷新重查自愈）——全局单任务链（v14.8）下后开标签页的等待从"无界"变有界
- **异常降速暂停总额（anomalyPauseTotalCapMs=90s）**：旧实现每波可各暂停 5s/30s，60 项×异常级联可把单任务拖到 15 分钟级；总额耗尽后裸跑剩余项，暂停亦不得跨越硬截止
- **死 tab 中止**：推送失败（tab 关闭/导航中，无接收端）即中止该任务并让位全局链——开跑推送失败跳过、排队任务就地出队、运行中任务清检查点+拆续跑 alarm（不再为死 tab 白跑数分钟）
- **链路异常 done 兜底**：任务体/链路异常同样推送 done 终态（此前内容侧只能等 45s 强制收尾）
- **收尾视觉修复（content/list/list-state.js）**：未返回项的 ⏳ 占位转"未返回·点击重查"可重试徽章——此前占位永远停留在队列文案（跨 tab 排队时队列信息轮询持续重绘，视觉即"卡住"）；转错误徽章后轮询自然停止，迟到推送仍会替换真实徽章；测试 +2（硬截止丢项 done 收尾 / 死 tab 中止出队）

### v14.16.0（功能建议报告第二轮：P2/P3 十二项全落地）

**匹配与管线**

- **目录层受控模糊匹配（O2，v14.6.0 遗留立项）**：精确/去空格变体双层落空后第三层——前 2 字符桶候选 + charBigram Dice≥0.65（社区校准值）+ 覆盖/序号值/长度比三护栏（VI≠V 续作拒）；下架游戏覆盖补齐
- **词表导入回放门（O6）**：规则包词表覆盖导入走两步门——内存热更（PROTECTIVE_TITLES 双防线）→ 错题库 5 锚点离线回放（shared/mismatch-anchors 运行时快照 + fixtures 漂移门禁）→ 不达标回滚内置词表整包拒绝
- **负缓存剩余时间动态化（O3）**：未找到徽章/候选面板显示真实自动重查等待（15min→1h→2h 阶梯——静态"2h"文案失真修复）；SEARCH_STEAM 响应携带 negativeCacheMs

**功能**

- **站内通知中心（N6）**：notifyBase 单源落库环形 50 条（限免/收藏折扣/ITAD 全触发点）+ popup 通知段（未读角标+全部已读）——系统通知即焚的追溯面
- **批量重试失败项（N4）**：列表页收尾后失败 ≥2 出浮条，一键串行重试（≤20 项/次+单飞行+节流管道复用）
- **平台兼容徽章（N2）**：macOS 🍎 / Linux 🐧（appdetails 同响应字段零额外请求）——mac/linux/Deck 用户此前零信号
- **浮窗系列作品行（N10）**：名称索引本地聚合前作/续作/衍生（steam 直达链接，零网络）
- **限免日历 iCal 导出（N7）**：进行中限免生成 VEVENT（截止前 24h 提醒窗）进系统日历

**设置与对齐**

- **内置站独立开关（N9）**：六内置站逐站禁用（关闭=零功能分发；隐私最小化）；settings-sync 门禁实战抓漏
- **油猴-扩展双侧 golden（O8）**：coreTokensOf/matchCandidateScore 逐字对齐扩展完整评分（补包含关系/站点自命名/数字对齐/俗称例外四项）——错题库公共输入集双侧同判门禁
- **油猴徽章 Fragment 批写（O5，执行期修正）**：扩展 prependBadge 早已批量（O5 前提仅对油猴成立）——油猴五处插入改单写
- **油猴扫描增量标记（O10）**：WeakSet 已处理标记（观察器 20 轮 rescan 只碰新增节点）

### v14.15.0（功能建议报告第一轮：P1 七项全落地）

**基建与门禁**

- **版本一致性门禁（O4 执行期修正）**：`npm run release:smoke` 五断言——manifest/package/README/welcome/油猴版本四处同步机器化（v14.6.3 曾漏 README 条目）；CI release-smoke job 同源调用。原建议"CI 接入 E2E"撤销——复核发现 ci.yml 早有 e2e job（调研 grep 窗口过窄漏看，报告已标注）
- **MOCK_RE 覆盖审计（O9）**：integrity 新断言"出站 URL 字面量 ⊆ MOCK_RE ∪ 豁免表"——**落地即抓 4 个真实泄漏**：steam250.com/top250、www.gamerpower.com（www 形态）、steamspy.com/api.php（api.php≠/api/ 形态）、www.gog.com（www 形态），E2E 此前对这四域走真网络
- **油猴自动更新链（N8）**：@updateURL/@downloadURL 接入 Tampermonkey 更新探测

**功能与性能**

- **AppID 手动绑定（N3）**：候选面板直接粘贴纯数字/商店链接绑定（storesearch 搜不到已下架游戏——The Culling 实证的唯一用户兜底），纠正映射语义优先于一切索引；扩展+油猴同 UI
- **纠正映射导出/导入（N5）**：用户劳动成果一键迁移（grEnvelope 信封对齐过滤预设先例）；导入逐条校验+合并 upsert（导入值优先/count 取大/reportedAt 保留更早）
- **好评率走势迷你图（N1）**：评分缓存成功重取追加点（30 点上限），浮窗 SVG sparkline——口碑崩坏/回升可视化，零新增请求
- **一键诊断包（O7）**：设置（stripSecrets 脱敏）+运行指标+API 状态（含失败归因）+出站审计+日志一 JSON 下载，报障 issue 一来一回闭环
- **appdetails 去重（O1）**：直取路径 Phase 0 与组装器同 URL 双往返合并（in-flight+10s 短 TTL，失败不入表）

### v14.14.1（油猴脚本版重制——扩展核心功能移植为单文件 userscript）

- **userscript/game-radar.user.js（~1880 行）**：根据扩展现状重制油猴脚本——列表好评率徽章（总体/近30天/红标题/等待队列/未找到点击重查）、低评测 `#AppID·新游/未发售` 提示、详情 Steam 浮窗（无评价原因行/手动选择键盘导航/30s 自动重查）、匹配管线（storesearch 全词扫描+跨词共识+社区英文兜底+EN 段重搜+DLC 解析）、负缓存分级退避/分域熔断/限速——词表与纯函数自 retrieval-vocab/api-search 逐字移植（错题库锚点测试 14 例沙箱装载全绿）
- **GM 适配层**：chrome.storage→GM_*（TTL 信封+有界压缩）、SW fetch→GM_xmlhttpRequest（跨域直连+限速槽+分域熔断）；商店页三形态评分回退解析直连（appreviews 302 死亡语义对齐）
- 差异记录：扩展页/推荐值/行为统计/二维码/限免/Steam250/ITAD/目录离线索引/Bing·LLM 兜底/Metacritic 未移植（README「与扩展的差异」全列）
- eslint baseGlobals 增补 GM_* 全局；vitest include 注册 test-userscript-pure

### v14.14.0（重构执行序：类型债棘轮全家族 + 三处长函数拆分）

**类型债与测试保真（研究报告 §3.1/§3.3）**

- **类型债棘轮全家族化**：计数从单码 TS7006 扩为隐式 any 全家族 12 码（TS7005/7006/7011/7015/7017/7018/7019/7022/7023/7031/7034/7053）——堵"写 `x: any` 让计数下降而债务未还"的形态绕过；基线 main 675/ui 347/content 356 只降不升，CI 接入棘轮 job
- **storage mock 结构化克隆**：get 返回深克隆对齐真实 chrome.storage 语义（防"就地改值未 set"假绿）；typescript ^7.0.2 → 7.0.2 精确锁版（caret 漂移致基线浮动 ±3）
- **message-contract 表级 @type + 返回形状统一**：61 处规则返回统一 {ok, error} 双键（TS 字面量窄化收口）；data-store.js 全量补 JSDoc（22 处隐式 any 清零）

**长函数拆分（行为不变，锚点全绿）**

- **xdgrid-panel buildUI ~390 行** → createFab/createPanel/buildLayoutTab/buildFilterTab/bindTabsAndFab/bindLayoutReset 六段装配
- **searchSteamGame ~272 行** → tryCacheServed（缓存命中判定+Demo 自愈）/ searchAppIdFlow（目录→三阶段匹配→Bing/LLM 兜底→负缓存）/ fetchDetailsResolveDlc / writeSearchCaches 四模块函数——orchestrator 锚点 13/13 + 匹配管线四门 88/88 全绿
- **createSteamFloat ~263 行** → createFloatShell/createAutoRetry/handleLookupMiss 三工厂提取——sim 全家 20/20 全绿
- 类型债基线下调：main 675→610 / content 356→348（零新增隐式 any）

### v14.13.0（第十三轮：结构优化 + 债清减——三轮收官）

**结构优化（报告 A W1/W2 + B P3）**

- **getSteamPositiveRate 四阶段拆分**：平台预检（phasePlatform）与 appId 解析（phaseSearch：目录/检索/EN 兜底/信号回捞/负缓存记录内聚）独立步函数，对外签名不变——硬验收 = 错题库全套锚点绿（294/294）
- **分层预热协调器 warmup-coordinator**：热/温层 15+7 预热目标单源数组，SW 顶层 import 34→22，后续新增温层模块只改一处；siteAlert 载入下沉 session-persist（消除 background 底层反向 import handlers）
- **交互修复**：候选面板键盘监听累积（每次搜索累积一个全局 keydown 致 ↑/↓ 跳变）——上一任监听器直摘；**过滤恢复修复**：isConnected 判定统一（被过滤项移除祖先容器后 parentNode 误判，调低阈值不再"不重挂"）

**债清减与文档**

- 类型债下调：main 510→495（message-contract 校验助手八函数补类型 + 返回形状统一 {ok, error} 双键）
- 多域名规则往返测试（报告 D"多域名丢失"论断复核：数据层不变，证伪）
- retryThrottle 有界化（cap 500）；浮窗 30 天行标注"近 100 条评测口径"；CONTRIBUTING 补视觉基线维护条目

### v14.12.0（第十二轮：单源纪律加固 + 护栏真实化）

**单源收编（报告 B P2 系列）**

- TTL 配置由 DEFAULT_SETTINGS.cacheTtls 派生（此前同文件双份字面量，新增一类须改两处）
- 推荐引擎 LLM 超时入 PERF_CONFIG 单源（原 30000 死值绕过单源，且暴露铁律 13 扫描盲区——后台文件具名常量赋值形态）
- steamStoreApp 端点收编（background 5 处字面量改 ENDPOINTS 引用）
- LRU 裁剪单源 evictOldestByTs（llm-cache ×2 / search-cache 三份手写排序拷贝收敛）

**护栏真实性（报告 D §2.2/2.3 落地）**

- **reset/flush 对称性断言**：resetInMemoryCaches 与 flushAllCaches 函数名单侧新增即漂移
- **DB_KEYS ⊆ STORAGE_MODULES 断言**：手维护键表与注册表漂移即红（首跑即抓 MANUAL_MAPPINGS legacy 键，注记豁免）
- **settings-utils 导出面 vs 调用点一致性断言**（悬空 API 防复发——D-P0-4 型）
- CI 增 lint-ratchet job

**体验修复（报告 C）**

- popup 刷新按钮失败不再假成功"✅ 已刷新"；权重滑块保存失败不再静默；设置页主题对齐 applyPageTheme 统一入口（定时日夜主题在设置页生效）
- xdgrid host 兜底判定两处粘贴收敛单源

### v14.11.0（第十一轮：门禁止血 + 数据丢失级修复——四份第三方审查报告落地）

**安全与数据丢失（报告 B/C/D 实锤项全数修复）**

- **保存映射三键静默丢弃修复**（24 天未修）：详情浮窗形态/位置、红标题阈值加入保存收集段；新增**写路径双向断言**门禁——每个设置键必须在保存收集段或面板直写豁免清单（防 v6.4.11 同型事故复发）
- **ITAD 密钥泄露修复**：导出/备份此前只剔 llm/steam 密钥，ITAD 单键与多配置 key 明文外流（设置页承诺"自动剔除"未兑现）——stripSecrets 单源两处共用 + 测试钉死
- **规则包 searchUrl javascript: 注入修复**：保存/导入侧 http(s) 协议白名单 + 渲染侧 protocol 复核兜底（存量恶意规则不受保存侧保护）
- **收藏并发丢失修复**：toggleFavorite 无锁 RMW（后写吞前者）→ withLock 串行
- **steam-cache flush 丢失窗口修复**：快照式脏标记 + 脏序号——flush 期间并发更新被抹标记致 SW 重启丢缓存的窗口关闭
- **SW 无限唤醒修复**：批量任务 stale 分支补拆 1 分钟 resume alarm
- **折扣通知防重**：同一折扣不再每 48h 轮询重推

**门禁真实性（报告 B P0/P1 门禁破口收口）**

- E2E 确定性红修复：欢迎页 changelog 断言、1746540 fixture、滚动批 90 项 appId 直取快路径（原 130 项全 miss 检索链结构性超窗）+ 270 个配套 fixtures
- **HTML 重复 id 门禁**：扩展页全部 HTML 零重复 id 断言（ruleList/settingsSearch 双写曾致规则管理面板恒空 24 天）
- **全局覆盖率快照棘轮**：coverage:gate 只查新增文件恒绿——补 unit-only 全局行覆盖棘轮（39.86% 建基线，只降不升）
- ios17 visual 基线刷新 + 单主题阈值 1.0%（system-ui 抗锯齿日级漂移）
- 抗负载基建：fixture 进程内缓存、SW 响应门、设置读回确认、SEARCH_STEAM 生命周期日志

### v14.10.1（详情页浮窗显示无评价原因 + 发售日期）

- **浮窗同样解释"为什么没有好评率"**：低/零评测游戏的 Steam 信息浮窗不再整体缺失评分行——显示灰色"Steam 总体"行，含 Steam 官方语义原因（"需要更多用户评测来生成整体评价"/"无用户评测"）+ 评测条数 + 发售日期
- 与列表页徽章（新游/未发售/无评测/评测少标签）同语义闭环

### v14.10.0（非 PC 平台条目：主机/模拟器识别 + Metacritic 评分源）

- **主机/模拟器条目不再误检**：标题带主机平台段（NS2/PS5/Switch/主机整合等）或模拟器段（模拟器/ROM 整合）的条目，识别后跳过 Steam 检索（模拟器包检索必错配、主机独占 Steam 无数据），显示「主机」/「模拟器」平台标签；游戏名内含标记词的 PC 游戏（如《PC装机模拟器》）分段精确匹配不误判；显式 PC 标记的多平台条目（PC|Xbox）优先走 Steam 管线
- **评分优先 Metacritic**（用户指令）：主机条目从标题英文段推导 Metacritic 规范链接抓取媒体评分（Metascore），显示绿色/黄色/红色 MC 分徽章（≥75/50-74/<50）；无英文名或 Metacritic 无分（新游戏）→ 平台标签即终态；命中缓存 24h/无分负缓存 6h，每任务 8 次预算有界

### v14.9.1（低/零评测徽章可见提示 + 发售日期）

- **为什么只有 AppID 一眼可见**：评测不足 10 篇的游戏徽章追加状态标签——刚发售 90 天内标「新游」、未发售标「未发售」、0 篇评测标「无评测」、老游戏低评测标「评测少」；悬停显示发售日期与 Steam 官方说明（如"需要更多用户评测来生成整体评价"）
- 发售日期随评分数据顺带提取并缓存（后续访问免重复请求）；游戏攒够评测后冷却周期自动拾取，徽章自动变为好评率
- 新增 isNewReleaseDate 纯函数（CN 日期串解析 + 90 天窗口）与 3 组测试

### v14.9.0（跨词共识评分 + 盲区自愈 + 低/零评测游戏评分修复）

**匹配质量（两项专项）**

- **跨词共识评分**：外族前缀跨界条目拒绝——候选名含搜索词但前面还有外族品牌块（如搜索"寂静岭"命中《黎明杀机-寂静岭》联动 DLC 曾解析成黎明杀机）不再参选；同一游戏被多个搜索词共同命中时共识加成，单词高分噪声不再压过正主
- **storesearch 盲区自愈**：新游戏 Steam 检索 0 结果时（泰坦之旅2/深海迷航2 类），自动抓取列表项详情页回捞站点内嵌 AppID 信号，经名称相关性校验后进入常规管线（误标信号会被校验拒绝；每任务 8 次预算有界）

**评分获取（低/零评测游戏修复）**

- 低/新评测游戏（<10 篇）商店页无百分比行——此前解析落空进入"获取失败"重试循环，页面显示裸 AppID。修复：解析升级三形态（完整/低评测/无评测），低评测游戏正确显示评测计数与 Steam 官方语义（"需要更多用户评测来生成整体评价"），悬停可见；游戏攒够评测后自动变为好评率徽章
- appreviews 死亡快路径：观测到端点 302 后本会话直接走商店页回退（每项省 2 次请求）

**版本号纪律**：即日起每次改动即 bump 版本号（本条目对应 ac0b47b+4b40f59 两批），完整发版仍按触发线。

### v14.8.0（第八/九/十轮：自愈体系完成 + 评价数据回退 + 匹配基准校准）

**自愈体系（用户报告修复）**

- **多标签页同时打开不再卡死**：评分任务队列改全局单链（原跨标签页并发使限速窗口失败率翻倍，任务互相挤压停摆）
- **等待检测徽章实时显示队列信息**：「⏳ 等待检索」升级为「⏳ 检索中 12/60 · 排队 1 · 限流降速」——任务开跑/入队即时推送 + 5s 轻量轮询全局队列快照（有界：无等待徽章或 10 分钟即停），跨标签页排队时也能看到前方还有多少任务
- **未找到/等待徽章点击就地重查**（窄化 action 不经 URL 索引记录）；负缓存分级退避（首次 miss 仅 15 分钟）；网络故障期详情页 30s 自动重查；候选浮窗「跳过，稍后自动重试」
- **未命中现场自动采集**进错题样本（dashboard 一键复制入册）

**评价数据回退（Steam 侧变更应对）**

- Steam `appreviews` 评价接口变更为 302 重定向（全参数形态）——好评率数据源断供。修复：回退解析**商店页 HTML** 评价摘要区（全部/近 30 天/您语言三行 + 描述文本），好评率显示不中断
- 批量进度条目级显示 + 降速/熔断明确提示

**匹配基准校准与已知限制**

- 三站列表页第一页基准 36 条（站点内嵌 appid 为 ground-truth，可离线回放）：22 条管线命中正确；14 条记档已知限制（站点胶囊图误标 / storesearch 索引盲区 / 分词碎片与 DLC 家族——跨词共识评分列后续专项）
- EN 提取正则补拉丁扩展区（Bon Appétit 型重音标题完整识别）；DLC/版本条目名（基座 EN 名+后缀）自动排除
- 检索规则词表与代码分离（词表数据层 + 编译 + 校验 + 规则包通道骨架）；`npm run verify:match` 错题库 Top10 检验命令

### v14.7.0（第七轮 13 批次：自愈体系 + 性能与可见性 + R2 词表生态骨架）

**安全扫描（Mimosa 深度扫描）**：0 findings · seal `sha256:7c7ff340ec5613240110287c4711a4d8f1788e4605f8de4425d622175728a4f5`（2026-10-30，第七轮 20 改动文件焦点）——v14.1.0→v14.6.3 断档说明：补扫仅覆盖当前 HEAD，历史版本不追溯

**审查确认修复（批次 1）**

- 元素直取 appId 相关性护栏（fresh-fetch 路径补 namesRelated——错配不再被缓存+索引三层钉死）；变体搜索熔断短路；LLM 超时入单源；熔断器半开改单探测令牌 + DOMAIN_WINDOW 真滑动窗口；fireBatch 失败兜底转错误徽章；in-flight 去重 key 纳入语义参数

**自愈体系（批次 3/4/9）**

- **未找到/等待徽章点击就地重查**（新窄化 action RETRY_GAME_LOOKUP，不经 URL 索引记录防列表页污染）；负缓存分级退避 15min→1h→2h（新游戏上架 15 分钟即可重查）；网络故障期详情页未命中 30s 自动重查；候选浮窗「跳过，稍后自动重试」

**性能与响应（批次 6/7/8/10/11）**

- 批量检索 **worker pool**（3 并发，限速不变等待重叠）；SW **首消息快路径**（早期路由图就绪前排队冲放）；预热分层（热层 meta+rating 先行，detail/spy 惰性）；首波预热竞态修复；目录索引 20MB dump 流式解析（不再阻塞消息处理）+ 空格变体匹配（"GTA5 vs GTA 5" 根治）

**可见性与生态（批次 5/12/13）**

- 批次进度条目级显示 + 降速提示；R2 词表规则包通道（用时取用 + 热更 + 存储下发骨架，校验失败回退内置）；性能基准脚本 perf-bench 入库；门禁抗负载（超时预算可配置化 + gate --continue）

### v14.6.3（全面审查批次 0：匹配护栏收窄 + 内容侧自愈修复 + 错题库上线）

**匹配管线（审查代理 A）**

- **数字对齐放行加护栏**：seqNumsOf 单源（≤2 位序号或标题唯一数字，排除年份噪声）——年份碰撞（"英雄连2 2024版"）与单数字标题（"地铁2号线"）不再错配
- 列表页负缓存网络守卫补齐（此前仅详情页有）；纠正知识库覆盖缓存命中路径（含 cacheOnly）；批量续跑经 startRatingJob 入队串行
- Steam 限速改**预约制 + 突发视界钳制**——并发不再同毫秒放行，槽位债务有界（E2E 批量下 SEARCH_STEAM 超时根治）

**内容侧（审查代理 B）**

- tracker 消息排队冲放还原（B8 排查遗留劫持代码清除）；统计浮窗重显修复；FORCE_FINISH 后批次死锁解除；三处数值转义补齐

**测试基建**

- **错题库上线**：tests/fixtures/mismatch-samples.json（4 样例含逐词 storesearch 回放响应）+ 回放测试——检索算法任何变更命中变差即失败
- 注释/死代码清理；P1×2/P2×7/P3×11 全数核实修复

### v14.6.2（紧急修复：大量"未找到/等待检索"事故 + 硬编码全量消除）

**事故修复（v14.6.0 引入的回归，两处叠加）**

- **根因 1（主因）**：社区搜索兜底（searchCommunityApps）失败被误计入 store 域熔断与 Steam 全局失败统计——steamcommunity.com 慢/失败 5 次即打穿 store 熔断（storesearch 全短路 → **大量"未找到"**）并触发 Steam anomaly 批量降速（2 个/批 + 5s 间隔 → 60 游戏 150s ≫ 45s 收尾 → **"等待检索"徽章大量残留**）。修复：剥离 Steam 全局统计，独立 `steamcommunity` 熔断域——兜底失败只影响自己
- **根因 2（火上浇油）**：目录镜像源 raw.githubusercontent 当前 404（GitHub API 确认文件在，raw CDN 分发故障）+ 大陆访问挂起，"每 SW 生命周期一次"刷新在 SW 频繁冷启动下反复 45-90s 挂起。修复：失败退避 6h（chrome.storage.session 级，浏览器重启后允许再试）+ dump 超时 90s→45s
- 回归锁定：独立域隔离测试（community 失败 ×5 后 store 熔断仍闭合）+ 退避/会话重置测试 ×2

**硬编码全量消除（16 处 + 自动护栏）**

- background 7 处入 PERF_CONFIG 超时单源组；内容侧/页面层 11 处文件顶具名常量；顺手修一处"同主流程"注释与实值漂移（3000→anomalyWaitMs 5000）
- test-integrity 新增自动护栏：≥1000ms 延时与出站超时零字面量（B4 后回流的防线上移到 check）

### v14.6.1（用户反馈修复：系列序号错配 + 更新页改造）

**系列序号错配修复（gamer520 123938 现场回放）**

- 现场："生化危机4 重制版|…|Build.22377325+…"错配到《Resident Evil Requiem》（生化危机最新作），正确应为 Resident Evil 4 (2050650)
- 根因链：Steam schinese 索引对"生化危机4"返回空 → 去数字变体"生化危机"命中系列列表 → 旧"俗称序号例外"只放行**无数字**候选（为"生化危机9→Requiem"设计），带正确序号 4 的正主反被"结果须无数字"规则拒绝
- 修复：**数字对齐放行**——结果名含与标题相同序号是更强同源信号，优先于"无数字"例外；跨语言打分数字对齐加权（2 分 > 无数字 1 分），不受候选顺序波动影响；"生化危机9→Requiem"正例不受影响（回归测试锁定）

**更新页改造（用户反馈：更新后不应打开欢迎导览）**

- 更新（source=update）打开**版本更新记录页**：welcome/changelog.js 单源数据动态渲染——当前版本高亮块 + 近期版本折叠 + 完整记录外链（原 updateSection 为 v7.4.0 硬编码，9 个大版本未更新）；发版流程新增一步：bump 时在 changelog.js 头部插入一条
- 分流收紧：update 但用户从未使用过（无注入痕迹，如装完从未打开浏览器即升级）→ 仍按首次安装显示功能导览；真正首次安装行为不变
- 930 用例 · E2E 51 · visual 11 全绿

### v14.6.0（标题检索升级：全量目录离线索引 + 社区搜索英文兜底）

**调研驱动**（docs/标题检索AppID-准确率与效率调研-2026-10.md，含端点实测）

- **Steam 官方全量清单 API 已移除**（ISteamApps/GetAppList 实测 404，~2025-11 弃用）——经典"下载全量列表建索引"失去官方源；本版采用社区每日镜像 + 官方替代端点双保险
- **在线搜索端点搜不到已下架游戏**（The Culling 实证：storesearch/SearchApps 均无结果）——下载站老游戏的结构性盲区

**全量目录离线索引（appListIndex，核心）**

- 匹配管线在名称索引/纠错之后、storesearch 之前插入归一化精确匹配层：**下架游戏恢复可匹配** + 目录命中免网络往返（大列表批量提速）
- 数据源双保险：jsnli 每日镜像（免 key，~20 万条）→ `IStoreService/GetAppList`（用户提供 Steam API Key 时，`steamApiKey` 设置键复活）；双失败熔断式降级回纯在线管线，不阻塞主流程
- 按需刷新：未命中/过期（7 天）触发后台刷新，每 SW 生命周期至多一次（防 miss 风暴）；冷启动温层仅读盘零网络
- 归一化口径：NFKC（全角→半角）+ 符号归空格 + 压缩空白——目录键与查询共用同一函数

**社区搜索英文兜底（searchCommunityApps）**

- `steamcommunity.com/actions/SearchApps`（免 key、极快；实测仅英文）接入英文重搜阶段、Bing 之前；结果经与 storesearch 同一的相关性校验 + store 域熔断/出站审计

**其他**

- 阈值校准（模糊匹配接入目录层）遗留后续：需以纠错库/franchise 样本实测校准
- 测试：目录索引 7 单测（归一化/命中/排除/持久化/双源降级/分页续传/miss 触发）；sim fetch 桩修复（目录刷新真实网络拉取曾干扰批次时序）；924 用例 · E2E 51 · visual 11

### v14.5.0（第六轮 10 批次：SW 冷启动修复 + 按需加载 + 写合并 + 模块拆分 + 测试基建）

**B2 SW 动态 import 全量失效修复（重大）**

- 真机复证：HTML 规范禁止 ServiceWorkerGlobalScope 使用 import()（w3c/ServiceWorker#1356）——仓库内 4 处动态 import（双层内存预热 / 批量好评率续跑 / 周报 digest）因错误被 allSettled/catch 吞掉而**自 v7.0.4 起静默失效**，本批改静态导入后首次真正生效
- 新增"SW 模块图就绪 Xms"性能基线日志 + test-integrity"后台零动态 import"回归扫描
- AGENTS.md 铁律 2 / CONTRIBUTING 修正并强化（规范依据 + "静态加载+延迟调用"模式）

**B3 内容脚本按需加载**

- 详情页专属 sidebar-rows / inline-card 改首用时加载——列表页/首页/Steam 页零网络请求（-2 请求/页）；内嵌卡按 features.inlineSteamCard 预判

**B5 写合并 + 落盘并发**

- 游戏画像写合并（TRACK_EVENT_BATCH 每批 ≤10 次全量重写 → 2s 防抖单次落盘；写失败回滚重试 + flushAllCaches 纳管 + reset 取消挂起）
- 落盘并发压力测试（3 tab × flushAllCaches，死锁 canary）锁住"逐模块串行无死锁面"保证

**B6 模块拆分（8 文件全部 ≤300 行）**

- badges.js 439 → badges/（core/working/rec/badge-base 四域）；detail-templates.js 440 → 模板入口 + render/（sidebar-html/rating-rows/inline-html）

**B7 内容入口重构**

- tracker.js 436→199：页面检测分派迁 page-init.js、入站消息迁 messages.js（薄监听排队 + boot 后接线）、chrome.storage 直调收敛 common 封装
- sidebar.js 报错重检/手动刷新两闭包统一 createSteamActions 工厂
- **修复推送竞态**：推送类消息就绪快路径同步应用（微任务延迟会让批次收尾抢先终止 job，迟到推送被静默丢弃）

**B8 UI 模式单点化**

- popup 三份控件映射统一 bindSettingControl；options 保存映射微助手+四对象表驱动（铁律 11 逐键核对变表审阅）；cache 任务按钮/防抖搜索单点；LLM 测试 probeEndpoint 统一

**B9 消息管道治理**

- **ratingsBatchSize 设置接线修复**（v10.7.0 起设置键收集但从未被消费，UI 配置静默失效）
- 状态浮窗渲染合并（100ms 窗口，列表流程 ×N→×1）；TRACK_BATCH_CONFIG 单源

**B10 文档**

- KNOWLEDGE.md 新增并发模型与锁策略/性能基线/消息路由三章；AGENTS.md 新增并发与写入纪律

**测试基建**

- npm test 两阶段拆分（unit → sim/integration 分进程）+ sim 前置 + 推送前置 boot 等待 + 两段重试——根治跨文件 fork 复用残留竞态的间歇红
- 新增 12 用例（消息路由 7 / sidebar-actions 5 / 落盘并发 4）；917 用例 · E2E 51 · visual 11

### v14.4.0（第五轮收官：B9 全量拆分 + 主题按需加载 + franchise 匹配策略）

**B9 测试巨文件重组（10/10 批次全落地）**

- test-content-sim.mjs 1451 行 → tests/sim/（sim-harness 共享工具 + sim-list + sim-detail + sim-badges）
- e2e-smoke.mjs 895 行 → tests/e2e/（helpers + run 聚合 + 7 个 section 模块）
- test-integrity.mjs 553 行 → 主册 467 + test-integrity-security 116 + integrity-helpers 24
- vitest include 自检绿 · 894 用例全绿

**主题按需加载（任务 1）**

- themes.css 1438 行拆为 19 套独立文件 + applyTheme 动态 `<link>` 注入
- SidePanel 实时跟随 · integrity 主题变量键一致性断言改扫描拆分后文件

**匹配管线 franchise 区分（P1-A 覆盖判据）**

- orchestrator-detail 阶段 2 交叉验证：零交集判据 → 内容词覆盖判据
- 单调改进护栏 + 单词段不触发 + 等覆盖防抖动
- P2-1 列表页 rawTitle 英文兜底 / P2-2 appId 直取失败落回搜索

**架构介绍页 + 知识库 + 工具**

- docs/architecture.html（SVG 交互图 + 匹配管线动画 + 数据流可视化）
- docs/KNOWLEDGE.md（匹配管线/存储模型/消息契约/单源表）
- gate 新增 architecture 步骤 + npm audit 0 漏洞

### v14.3.1（匹配修复：rawTitle 透传 + 三阶段匹配）

- Steam schinese storesearch 对新游戏中文名返回空——rawTitle 透传 + 英文兜底

### v14.3.0（第五轮 10 批次：拆分/模块化/合并/重组——9/10 落地）

**五大巨石拆分（TOP8 均值 537 → 313，全部 ≤420）**

- B1 content/detail/sidebar.js 653→375（编排壳）+ sidebar-rows.js 103（ITAD/收藏/
  Steam250 异步行填充）+ inline-card.js 204（XDGame 同款内嵌信息卡）
- B2 content/list/xdgrid.js 600→xdgrid-layout.js 178（布局引擎）+
  xdgrid-panel.js 414（双标签面板）+ 壳 40（computeContainerStyle 等经
  re-export 消费面兼容）
- B3 options/panels/settings.js 529→settings-render 281（区渲染器）+
  settings-bind 206（事件绑定）+ settings.js 75（浮窗模块顺序）；cache.js
  510→cache 396 + cache-formatters 137
- B4 steam/orchestrator.js 497→orchestrator-detail 177（详情页管线）+
  orchestrator-list 305（列表页两波查询）+ orchestrator-shared 61（Demo 判定/
  统一命中）+ 壳 15；B5 recommend/engine.js 493→engine-signals 274（零 IO
  信号纯函数）+ engine 壳 227（编排 + LLM）
- B6 popup/popup.js 491→287（壳）+ popup-status 124 + popup-weights 67 +
  popup-search 49（classic 脚本 window 挂载 + /* global */ 声明模式）

**单源归一与地图（B7/B8）**

- steam 域模块地图（README.md：管线/原子层/支撑层职责与边界规则）
- notifyBase 工厂收敛三处通知构造（notify.js/itad.js，B4 拆分后跨文件）
- 重复实现清点报告（docs/reports/重复实现清点-B8-2026-10-07.md：
  5 候选中 1 合并 4 豁免含理由——格式化方言/搜索语义/导出通道/卡片粒度）

**B10 styles 与防线**

- themes.css 文件头变量清单目录；integrity 新增『主题变量键集合一致』断言
  （19 套 --gr-* 全等，新主题漏键即红——SidePanel 主题失效近因防御）

**B9 测试巨文件重组**：唯一延后批（content-sim 模块单例纪律 + e2e runner
耦合需逐节验证，转下一会话首批）

**审查修复（v14.2.0 审查核心发现）**

- XSS 扫描改白名单制（默认可疑/明确放行——原"无引号豁免"漏纯变量形态，
  受控实验 0/3 检出；基线 19→72 重落棘轮）
- coverage-gate 胶水豁免清单（COVERAGE_EXEMPT：纯 DOM 绑定文件 6 个，
  验收通道为 settings-sync/visual/E2E；含逻辑文件不豁免）

**门禁**：888 用例全绿（新增 sidebar-rows 6 例）· E2E 51 · visual 11 ·
lint-ratchet/coverage-gate（23 新文件全检）/release-smoke 全过

### v14.2.0（第四轮 10 批次：架构终态治理 + 全面审计修复）（审查修复大清算：四轮审查 30 项发现全数落地 + 五条新护栏）

**门禁去假象（补充轮 P0×4 + 复审轮 P0×2——"承诺已生效、实际可绕过"全数关闭）**

- 覆盖率门禁目录白名单补齐 UI 全目录（此前 4492 行 UI 代码零覆盖视野）；
  coverage include 同步补齐 + 全局阈值按新分母实测下调并锁棘轮
  （lines 47 / stmts 46 / funcs 43 / branches 42，实测 51.3/50.1/47.9/46.6）
- `scripts/lint-ratchet.mjs` 落地——lint-baseline.json 类型债基线从纯文档变
  程序约束（gate 步骤；本次即抓出拆分引入的 2 处新债并当场修掉），
  基线下调至实测 510/251/272
- vitest include 清单自检测试（漏登记新测试文件 = 静默不跑 → 门禁必拦）
- coverage-gate 三修：捕获退出码（崩溃→可读失败）/ 表格行找不到即失败
  （堵假放行通道）/ 长路径缩写行匹配 + basename 歧义判失败
- `SITE_SCRIPT_FILES` 真单源（export + manifest js 清单顺序敏感深度相等断言）；
  域名三方一致检查改动态 import BUILTIN_DOMAINS（删硬编码 7 域名正则）

**XSS 转义机器护栏（主报告 P1-2——铁律 #1 从"靠自觉"到有牙）**

- test-integrity 新增静态扫描：innerHTML 模板串 `${...}` 插值未经
  esc/escapeHtml/escapeAttr 包裹即计数，实测 19 处（逐条为条件模板噪声）
  落 `xssUnescapedInterpolations` 棘轮基线（只降不升，后续批次清零）

**test-integrity spawn 假阳性根治（主报告 P1-1）**

- 哨兵自检 + 区分 spawn 失败（status=null）与语法错误——沙箱环境不再
  128/128 全盘假红；`Element` 引用改能力探测（测试环境可加载）

**E2E 假绿修复（复审轮 P1-1）**

- 欢迎页断言从"DOM 存在 6 卡片"改为"分步引导可见 + 4 步点完跳转
  dashboard"——v14.1.0 头号功能首次获得真实端到端验证（E2E 50→51 项）

**SidePanel 主题失效修复（复审轮 P1-3——v14.1.0 引入的用户可见缺陷）**

- 内联 `:root` 硬编码色板改用 themes.css 的 `--gr-*` 主题变量体系——
  此前 19 套主题切换对侧栏完全无效；VALID_THEMES 导出单源 +
  welcome"10 套主题"文案修正（实为 20 套）

**welcome 向导不再改写用户设置（复审轮 P1-4）**

- 过滤阈值/主题初始值从 GET_SETTINGS 回填（原硬编码 true/90 与出厂
  语义相反，路过点"下一步"即被静默改写）；删 trackedSitesTouched 死字段

**浮窗模块键 5 份副本归一（复审轮 P1-2）**

- `shared/fm-keys.js` 单源（ESM 导出 + globalThis 双通道）——DEFAULT_SETTINGS
  / types JSDoc / detail-templates / settings 面板 / options 保存映射全部派生；
  order 键入 DEFAULT_SETTINGS
- `shared/spy-scales.js` 刻度单源下沉（content 层 `/7` 字面量与 engine 分裂
  修复，补充轮 P1-2）；分层矩阵开放 core→shared（最底层纯数据方向）

**零散纪律修复（补充轮 P1/P2 + 复审轮 P2）**

- debounced-store 改用 mechanisms.debounce（9 存储模块脱离手写防抖，
  flush 语义保持）；ENDPOINTS 补 bingSearch（ai-fallback 收编）；
  favorites 的 ITAD Key 测试改走后台 TEST_ITAD_KEY（裸 fetch + 端点副本消除，
  铁律 #8）；4 处 TtlCache 补 max（STORAGE_CAPS.itadPriceCache 单源）；
  tab-game 容量入 STORAGE_CAPS.tabGames + 截断长度注释 + at 全等淘汰用例；
  settings-sync 扫描补 reset-defaults.js；manifest refs 校验补 side_panel；
  package.json lint 口径升级 `eslint .`（sidepanel/welcome/scripts 纳入，
  顺修 2 个存量 warning）；module-manifest 边界语义说明
- **31 处 v14.0.0 提交内 v14.1.0 版本注释误标修正**（复审轮 P2-5 计数精确命中）
- content ESM import 链的 shared 依赖纳入 WAR（`shared/*.js`）+
  integrity 新断言守护——spy-scales 下沉曾致真机动态 import 全链失败而
  单测全绿（环境差异型盲区，E2E MOCK 40/51 惨案根因）

**重构 + 新功能测试补齐（主报告 P2-1 + 复审轮 P1-5）**

- `freegames/manager.js` 741 行三域拆分：fetch.js（抓取/分类/Steam 判定）/
  itad.js（ITAD 价格）/ notify.js（通知/角标/领取）+ manager 编排壳
  （101 行）——消费面 re-export 兼容；xdgrid 过滤预设外移
  filter-presets.js 纯函数
- 新增 4 测试套件：filter-presets（重名更新+上限淘汰组合语义）/
  favorite-prices（无 Key 短路/价格归一/TTL 复用）/
  reset-defaults（完整点击委托→resetOne 链路，98.5% 行覆盖）/
  sidepanel（三刷新链路 + 异型守卫，73% 行覆盖）；总计 **887 用例全绿**
- 三个静默 catch 补可观测性 warn（SidePanel 渲染失败/reset 失败）

### v14.1.0（历史路线图收尾：SidePanel 仪表盘 / 浮窗模块排序 / 过滤预设 / 收藏价格列 / 单项恢复默认 / 新手引导）

**B9【功】MV3 SidePanel 仪表盘（第二轮批次 9 补完）**

- chrome.sidePanel（Chrome 114+）承载 dashboard 精简版：当前页游戏 + 收藏 + 限免速览
- 当前页游戏随 tab 联动——检索/直取成功时记录 per-tab 快照（session 持久化，
  LRU 上限 24，GET_TAB_GAME 消息），侧栏切换/导航即刷新
- popup 底部新增「🪟 侧栏」入口；无 sidePanel API 的旧 Chrome 隐藏按钮无感降级

**浮窗模块顺序（第二轮 B4 / 第三轮 B3 延后项补完）**

- 读侧：详情浮窗五信息块（中文支持/用户标签/开发商/简介/SteamSpy）按
  floatModules.order 真正按序装配（此前 order 只计算未使用）
- 写侧：设置页新增「浮窗模块顺序」↑↓ 调整 + 恢复默认；未自定义不写键

**过滤命名预设（第二轮 B8 后半）**

- 列表过滤面板可将当前条件（开关+阈值）存为命名预设一键切换/删除；
  按站点隔离存 chrome.storage.local，跨刷新持久（上限 10 个）

**收藏价格列（第一轮 B3 补完）**

- dashboard 收藏区新增现价/历史最低/折扣率；GET_FAVORITE_PRICES 复用 ITAD
  两处 TTL 缓存（暖会话零请求）；未配置 Key 显示引导不发请求

**每项"恢复默认"微按钮（第一轮 B6 补完）**

- 设置页每个设置行 hover 显现 ↺，单击恢复该键默认值——复用 renderSettings
  作为单源应用器（避免 ~60 控件双源取值逻辑）；按钮绝对定位零布局侵入

**welcome 分步引导（第一轮 B6 补完）**

- 首次安装 4 步引导：追踪站点（一键启用）→ 过滤阈值 → 主题预览 → 备份建议，
  完成直达 dashboard；合并式保存（不整包覆盖并发修改）

**工程**

- 新增 GET_TAB_GAME / GET_FAVORITE_PRICES / GET_DEFAULT_SETTINGS 契约链
  （规则 + handler + 打包清单）；859 测试（+4 tab-game 快照/LRU/契约）

### v14.0.0（第四轮 10 批次：架构终态治理 + 全面审计修复）

**B1-B3【构】三大页面拆分终态**

- dashboard.js 1187→88 行壳（stats/insights/logs/diagnostics/backups/export 六模块）
- options.js 919→390 行壳（search/favorites/sites 三面板独立）
- detail-page.js 1133→106 行壳（candidates/sidebar/tracking 三模块，键盘导航/倒计时芯片齐备）

**B4/B5【构】死代码全清 + 类型完整化**

- export 消费方核对后净删 263 行（未用 CSS/死导出/STORAGE_CAPS 单源化）
- 消除全部 `@type {any}` 断言，AppSettings 对照 DEFAULT_SETTINGS 补全

**B6/B7【稳】content-sim 信号化 + NDJSON 分片写**

- content-sim 移除时间轮询绷带，waitForSignal 显式信号（负载抖动根治）
- steam-cache rating 模块 NDJSON 追加写 + 阈值 compaction（写放大根治，
  旧 JSON 单文件自动迁移兼容）

**B8/B9/B10【稳】错误统一 + lint 棘轮 + handlers 终态**

- toUserMessage 错误归一（去 "Error: " 前缀/翻译超时文案）
- lint 零警告基线锁定 scripts/lint-baseline.json 棘轮
- handlers.js 335→81 行纯分发表；诊断 handler 归位 diag-status.js；
  TRACK_EVENT_BATCH 批量 handler 落地（逐条管线，单条失败不丢整批）

**审计修复（全面审查 2026-10-05 产出的 P2/P3 缺陷全数落地）**

- P2-1：详情浮窗 SteamSpy 区块补 `floatModules.spy` 设置守卫（此前设置静默失效）
- P2-2/P2-3：熔断上报补缺 7 处——api 域（GetNewsForApp）此前恒 unknown；
  api 三文件全部 catch 路径计入 store/api 域熔断（api 域只记 domain 不记全局
  失败率，防大陆常态不可达误触发批量降速）
- P2-4：列表本地排序"取消排序"修复——此前掉入更新日期排序分支；现按
  domOrder 基线恢复原始顺序（自动排序前捕获，5 组回归单测）
- P3：行为事件 pagehide/visibilitychange 卸载兜底 flush；xdgrid 排序回放改
  等批次空闲后执行（刷新后持久化排序不再静默丢失）；面板重复 appendChild 清理
- handlers 用户可见 error 字段统一 toUserMessage（cache/image/stats/data 四处，
  分层矩阵开放 handlers/entry → shared 边）
- 新增单测：本地排序恢复原序 5 项 + TRACK_EVENT_BATCH 管线 5 项（总计 855）

**工程**

- prettier 全仓格式化基线；完整审查报告见
  docs/reports/GameRecommender-全面审查报告-2026-10-05.md

### v13.0.0（第三轮 10 批次落地：熔断联动/sim 信号/无障碍/发售分组/对比增强/排序持久化/周报开关/反馈增强）

**B1【稳】分域熔断可视化联动**

- popup 可达性行显示 per-domain 熔断态细节（⚡熔断中 / ⚡半开探测）
- 熔断恢复事件记入诊断（探测成功闭合可见）

**B2【稳】content-sim 信号收尾**

- 2b 节接入 waitForBatchIdle 信号（批次排空后再断言计数）

**B4【交】候选浮窗无障碍**

- role="dialog"/"listbox"/"option" + aria-label/aria-selected 全套

**B5【功】收藏发售状态三分组**

- dashboard 收藏区按发售状态分组：🚀 即将发售（30 天内）/ 📅 已公布 / ✅ 已发售 /
  ❓ 未公布——组头计数，组内按收藏时间排序

**B6【功】跨站对比增强**

- 对比行附详情页直达链接（已过同域白名单校验的 detailUrl）；空值统一"—"

**B7【易】排序模式持久化**

- 排序模式存 chrome.storage.local（grListSort:<host>），面板打开自动重放；取消清存

**B8【先】过滤面板可达性点灯**

- 面板显示 Steam 商店/API 可达性；store 域 down/熔断时置灰提示"数据可能不完整"
- 白名单守卫实战首功：抓出 GET_API_STATUS 漏登记（xdgrid 面板新调用点）

**B9【工】周报开关 + B10 反馈增强**

- 周报 digest 新增 weeklyDigestEnabled 设置键（默认开，设置 UI + 保存映射全链）
- 反馈预填增加未命中原因 reason（v10.9.3 诊断数据直接进 issue）

**记档**

- B3 模块 order 重排需模板结构重构（风险 > 收益），延后；B4 分片写维持"暂不做"
- Mimosa 扫描器对模板串+变量拼接的 SQL 误报持续存在（3 次阻断记录在案）

841 test · gate 全过（check + E2E MOCK 50/50 + visual 11/11）

### 安全扫描（Mimosa 深度扫描）

- 状态：**已补录（2026-10-05）**——MCP 断连根因修复（node 不在 ZCode 进程
  PATH → 用户 PATH 修复 + 用户级绝对路径注册）后补跑 deep 扫描（以 v14.1.0
  工作区状态，涵盖本版全部代码）：scanId `scan-2026-10-04T19-43-22.337Z-6310ab86514e`，
  **0 findings**（high/medium/low/info 均为 0），依赖扫描 200 包 0 命中，
  seal `sha256:5d6006355635b3366815eae41e2fdff91442de0cf310c60c3b1d2615d26e31c2`。
  runStatus=inconclusive（动态派发调用图缺口）与项目全部历史 seal 扫描一致

### v12.0.0（第二轮 10 批次落地：分域熔断/状态机/请求背压/模块自定义/键盘导航/发售追踪/跨站对比/排序/SidePanel/周报）

> 依据《迭代路线图-第二轮10批次-2026-09.md》全量实施。

**B1【稳】分域熔断 + 半开探测**

- 熔断器从全局改 **per-domain**（store/api 独立——api 域大陆常不可达不再连坐 store 域搜索）
- **半开探测**：熔断到期放行 1 个探测请求，失败立即重开、成功闭合（防雪崩）
- 单测钉死：独立熔断/半开探测/重开/闭合全语义

**B2【稳】content-sim 状态机（E3 终版）**

- list-state 新增 **waitForBatchIdle()** 显式信号（队列排空+推送应用完毕的 Promise）
- 测试 2/2 节接信号替代时间竞争；isolated 连跑全绿

**B3【性】请求去重与消息背压**

- **SEARCH_STEAM in-flight 去重**：同游戏并发请求共享同一 Promise（多标签页同游戏不再 3 倍 Steam 请求）
- **TRACK_EVENT 攒批**：内容侧 500ms 窗口或满 10 条批量发送（click_download 即时不攒批）；
  新 action TRACK_EVENT_BATCH（契约 + 白名单 + 逐条复用管线）

**B4【交】浮窗信息模块自定义**

- 设置项浮窗模块显隐（中文支持/用户标签/开发商/简介/SteamSpy 五块勾选，默认全显）
- floatModules 全链（constants/types/options UI+渲染+保存 → 模板守卫）

**B5【交】候选列表键盘导航 + 无障碍**

- 候选列表 ↑/↓ 移动高亮、Enter 选择、Esc 关闭（面板关闭自动解绑）

**B6【功】发售日追踪与提醒**

- 浮窗 **发售倒计时徽章**（releaseDate 未来日期 ≤30 天显示"X 天后发售"）
- 收藏切换携带 releaseDate；折扣监控轮询同时检查 48h 内发售 → 通知一次（标记防重）

**B7【功】跨站收录对比**

- ≥2 站命中时浮窗显示**对比块**：各站版本/大小/更新时间，**⭐ 最优来源**（更新时间最新）标记

**B8【易】列表本地排序**

- 过滤面板新增排序按钮组：好评率↓ / 更新日期↓（复用 ratingsByName）/ 取消——纯 DOM 重排不发请求

**B10【发】周报 digest + 反馈入口 + 上架准备**

- **周报通知**：每周 alarm 汇总浏览/下载/收录数 → 系统通知
- **浮窗反馈入口**：候选浮窗"💬 反馈问题"→ GitHub Issues 预填（游戏名/页面/版本）
- STORE.md 商店描述更新；diagnostics.js 迁出被扫描器误报 ×3 阻断（记档保留原位）

841 test · gate 全过（check + E2E MOCK 50/50 + visual 11/11）

### 安全扫描（Mimosa 深度扫描）

- 状态：**已补录（2026-10-05）**——同 v13.0.0 节：MCP 断连根因修复后补跑 deep
  扫描（以 v14.1.0 工作区状态，涵盖本版全部代码），scanId
  `scan-2026-10-04T19-43-22.337Z-6310ab86514e`，0 findings，依赖 200 包 0 命中，
  seal `sha256:5d6006355635b3366815eae41e2fdff91442de0cf310c60c3b1d2615d26e31c2`

### v11.0.0（10 批次路线图落地：韧性/可达性/收藏监控/交互/洞察/LLM/工程/发布）

> 依据《迭代路线图-10批次-2026-09.md》全量实施（批次4 经评估降级为"暂不做"，
> 理由见下；批次10 为上架材料准备，提交审核需用户账号）。

**B1【稳】检索韧性**

- **Steam 接口熔断器**：窗口内连续 5 次网络级失败（TCP/超时，HTTP 4xx 不计）→
  熔断 60s——期间搜索短路返回（不再逐个超时拖慢页面），自动恢复；配单测
- **content-sim 负载抖动缓解**：该文件用例 retry 2（CONTRIBUTING 已知问题的过渡
  方案；状态机显式 flush 的深度根治留待后续）

**B2【易】Steam 域可达性可视化**

- api-monitor 新增 **分域名滚动统计**（store/api 两域 + 熔断态），SEARCH_STEAM/
  appdetails/appreviews/GetNewsForApp 调用点分域上报
- **popup 状态区三域点灯**（🟢/🔴/⚪ + 熔断提示）；dashboard 诊断卡新增
  「Steam 域可达性」

**B3【功】收藏折扣监控**

- **watchFavoritePrices**：48h alarm 轮询收藏游戏（上限 50）ITAD 现价，
  现价 ≤ 历史最低 × 阈值 → 系统通知（复用限免通知管线）
- 新设置键：favoritePriceWatch（默认开）/ favoriteDiscountThreshold（50-100，
  默认 80）；无 ITAD Key 时零请求
- 设置页 UI + 保存映射 + 类型声明全链同步

**B5【交】浮窗交互升级**

- **浮窗标题栏拖拽 + 位置记忆**（按浮窗 id 持久化，跨刷新恢复）
- **"更新"徽章深链** → Steam 公告页
- **候选浮窗终兜底**：附"在 Steam 网页搜索"直达链接（自动匹配彻底失败也有出路）

**B6【易】设置中心检索**

- 常规设置面板头新增搜索框：按名称/描述实时过滤设置行与分组（纯前端）

**B7【功】dashboard 洞察增强**

- **标签云可点击** → 按关键词聚合过滤游戏表（再点取消）；标签高亮激活态
- **洞察 JSON 导出**（画像+收藏+周趋势打包，跨设备迁移）

**B8【先】本地 LLM 深化**

- **Ollama format=json** 结构化输出——parseLLMResponse 的正则抽取从"尽力"变"可靠"
- **LLM 推荐理由上浮**：推荐徽章悬停显示 🤖 一句话理由（method=llm 时）

**B9【工】+ B4【性】结论**

- diagnostics.js 迁出**被扫描器误报阻断 ×3**（模板串启发式误判 SQL 注入，已记录）
  ——相关 handler 保留在 handlers.js 原位；B4 分片写经评估**暂不做**（格式迁移风险
  > 剩余收益：C1 分文件 + dirty 跳过 + 变更才落盘已消除主要写放大，metrics 卡可
  > 持续观察，若写指标回升再启动）

**B10【发】**

- STORE.md 商店描述补收藏/折扣监控卖点；G:/Temp 磁盘满事故已清理第三方残留

840 test · gate 全过（check + E2E MOCK 50/50 + visual 11/11）

### 安全扫描（Mimosa 深度扫描，随版本补录）

- scanId: `scan-2026-09-28T17-03-39.475Z-07b2fe46a0f0`
- seal: `sha256:206e8860a7ebf5945a0cfc0826344c6786b3538663b0a6a2bb1357c3194a7f03`
- findings: **0** · 依赖扫描 200 包 0 漏洞匹配

### v10.9.4（用户反馈修复：浮窗标签点击跳到 Steam 首页）

**根因（实测 A/B 确认）**：Steam 标签页路由对语言段**大小写敏感**——
`/tags/zh-CN/多人` → 302 弹回首页（BCP-47 正规大写写法不被识别），而
`/tags/zh-cn/多人` → 正确跳转 `category/multiplayer`。官方商店页自身的标签
锚点用的正是全小写 `zh-cn`（从真实商店页抓取验证）。v10.4.4 引入标签跳转时
用了规范化的 `zh-CN`，所有中文标签点击均落首页。

**修复**：标签链接语言段改为小写 `zh-cn`（与官方商店页锚点一致）；中文 slug
仍全量 encodeURIComponent。回归测试：渲染断言小写段存在、大写段绝迹、每标签
一链接。

839 test · gate 全过（check + E2E MOCK 50/50 + visual 11/11）

### 安全扫描（Mimosa 深度扫描，随版本补录）

- scanId: `scan-2026-09-28T07-12-51.956Z-5147c99b4c33`
- seal: `sha256:5069fdeb4c10f2e03f4c9992fccfc2733161fcc010f1180bc8db27814f192ea5`
- findings: **0** · 依赖扫描 200 包 0 漏洞匹配

### v10.9.3（用户反馈跟进：未命中原因诊断上浮 + 候选浮窗重试按钮）

> v10.9.2 修复后用户机仍失败——管线经真实标题验证全命中，剩余失败原因在用户侧
> 环境（Steam 接口不可达/加速器未开等）不可远程推断。本版把失败原因**显性化**：
> 候选浮窗直接显示后台诊断（not-found / steam-api-unreachable / error 详情），
> 并提供穿透负缓存的重试按钮——用户可据此自查网络/加速器，或确认游戏确实不在 Steam。

**改进**

- **SEARCH_STEAM 响应新增 reason 字段**：区分「确认未找到」/「Steam 接口不可达
  （窗口内 N 次失败）」/「异常详情」——handleSearchSteam try/catch 包裹 + api-monitor
  窗口状态判定
- **候选浮窗原因展示 + 重试按钮**：未命中原因以警示条展示；「🔄 重试自动匹配」穿透
  负缓存重新搜索，成功则整个浮窗切回 Steam 信息视图；报错重检路径同样接入
- 回归测试 ×3（unreachable / not-found / 命中时 reason 为空）——滑动窗口跨用例
  残留以 resetApiMonitor 前置清理

838 test · gate 全过（check + E2E MOCK 50/50 + visual 11/11）

### 安全扫描（Mimosa 深度扫描，随版本补录）

- scanId: `scan-2026-09-27T15-40-26.639Z-893872dccb22`
- seal: `sha256:f0acea50623efa93089a7139560a5301ca9732895524fcff2b30db98222e47f6`
- findings: **0** · 依赖扫描 200 包 0 漏洞匹配

### v10.9.2（用户反馈修复：新游戏自动匹配失败——GetNewsForApp 拖爆搜索预算 + 负缓存自愈）

**根因（用户报告：多站详情页自动匹配失败、总是要求手动选择）**

- **GetNewsForApp 挂起拖爆搜索预算**：「最近更新」徽章数据走 api.steampowered.com
  （大陆网络不可达），默认 15s 超时且被内联 await 在搜索主路径——内容侧 SEARCH_STEAM
  消息默认超时仅 10s，新游戏（无缓存）自动匹配在大陆网络下**必然**超时失败；
  干净环境下不可复现（api 域可达）
- **历史负缓存固化未命中**：既往失败留下的负缓存（24h）瞬时返回 null → 直接弹
  候选浮窗——即使检索管线本身能命中

**修复**

- fetchLastUpdate **4s 硬帽**（"最近更新"仅为角标数据不应主导搜索预算）+ 失败
  24h 负缓存（同游戏会话内不再重复出网）
- **ignoreNegativeCache 全链穿透**：SEARCH_STEAM 消息 → handleSearchSteam →
  searchSteamGame——详情页对未命中**自动重试一次**（穿透负缓存自愈）；手动刷新
  缓存（REFRESH_STEAM_CACHE）强制穿透（刷新语义 = 不接受历史未命中结论）
- 详情页 SEARCH_STEAM 显式 **25s 超时**（对齐 Steam250 查询先例）
- **detectGameName 在克隆上操作**——此前直接 remove() 宿主 h1 内的"版本更新"
  角标元素（咸鱼单机），属宿主页面破坏

**回归测试 ×6**：fetchLastUpdate 4s 帽/负缓存/成功格式 ×3；负缓存穿透全链 ×3
（旧行为复现 → 穿透命中 → 手动刷新穿透）

835 test · gate 全过（check + E2E MOCK 50/50 + visual 11/11）

### 安全扫描（Mimosa 深度扫描，随版本补录）

- scanId: `scan-2026-09-27T14-33-26.388Z-f9978d25ef08`
- seal: `sha256:f34f8d39b9d27d88a1464f500d232b46eef7e8584e227e272d41bec60c4e8381`
- findings: **0** · 依赖扫描 200 包 0 漏洞匹配

### v10.9.1（盲区清零收尾：P3 观感修复 / LLM 解析复核 / 冷门 handler 补测）

**P3 观感修复（Invalid Date / "undefined" / NaN 字面量全清）**

- **日期安全格式化**：dashboard 五处时间渲染（游戏表 lastSeen / 行为日志 / 出站审计 /
  备份列表 / SW 启动耗时悬停）统一 safeDateText 兜底；options 调试日志、备份下拉、
  缓存页 formatTime、common.formatRelativeTime 同步守卫——异型/缺失时间戳显示 "-"，
  不再渲染 "Invalid Date"
- **"undefined" 字面量清零**：缓存页自愈统计/模块统计/分页、dashboard 游戏表 views/
  Steam250 徽标/站点告警计数、Steam250 排名行、设置页站点域名——全部 `?? 默认值`
- **数字防线**：ITAD 价格 isFinite 守卫（异型不再显示 "NaN"，降级隐藏行）、缓存 TTL
  文本 Number 化、推荐徽章防 NaN、popup API 状态文案防 NaN
- **badges lastUpdate** 非字符串守卫（textContent 路径防 "[object Object]"）；
  **ITAD shop 补转义**；dashboard 缓存搜索 query 按契约截断（上一版遗漏项收尾）

**LLM 输出解析复核**：engine.js parseLLMResponse / ai-fallback.js parseLlmMatchResponse
均已有 try/catch + 有限数值/类型校验——**无需修改**，审计确认记录在案

**测试补盲（冷门 handler 链路，"三层全无"清单清零）**

- test-handlers 新增 ×7：LOG_PERF（缺字段不抛错 + 超长契约拒绝）、SITE_ADAPTER_ALERT
  （首次告警/24h 限频/缺字段契约拒绝）、GET_STEAM250_RANK（无快照+拒网返回 null 不抛错）、
  GET_ITAD_LOWEST（无 Key 静默 null）、SEARCH_CACHED_GAMES（空缓存/畸形 query）、
  GET_STORAGE_HEALTH 形状、TOGGLE_FAVORITE/GET_FAVORITES 链路往返
- 契约收紧：IMPORT_DATA 补 data 对象校验（此前大载荷 fail-open——handler 虽兜底，
  契约应前置拒绝）+ 契约用例 ×3

829 test · gate 全过（check + E2E MOCK 50/50 + visual 11/11）

### 安全扫描（Mimosa 深度扫描，随版本补录）

- scanId: `scan-2026-09-27T13-39-37.099Z-543a624d67ef`
- seal: `sha256:9b7ecbabf50d5e676c2014ede6cc363ca0c0a2fa6019ae0c9561f7173a72b2ca`
- findings: **0** · 依赖扫描 200 包 0 漏洞匹配

### v10.9.0（举一反三全面清查：同构盲区消除）

> 由 v10.8.1 候选浮窗 bug 举一反三——三路并行审计（契约 vs 发送方对齐 / 类型边界
> 渲染鲁棒性 / 消息链路测试矩阵）发现并消除三类同构盲区。

**P1 修复（与已报 bug 同构的静默功能失效）**

- **ITAD 最低价行自 v10.6.0 真机恒隐藏**：GET_ITAD_LOWEST 漏登记内容侧白名单，
  真机被 forbidden-sender 静默拒绝（与 QR 契约 bug 同构）——补白名单
- **跨域二维码解码修复不完整**：v10.7.1 只放宽了契约正则、未补 sender 白名单，
  真机仍被拒——补 FETCH_IMAGE_DATA_URL 白名单
- **XD 站过滤滑块设置永不落盘**：内容侧直发全量 SAVE_SETTINGS 被 sender 门禁拒绝
  （特权写不对 web 源开放，属有意设计）——新增窄化 action SAVE_RATING_FILTER_CFG
  （只含 enabled/minRating 两键，后台钳制后落盘），xdgrid 改道接入

**类型边界加固（~30 处，跨边界数据不再做无守卫类型假设）**

- **detail-templates steamSidebar**：reviews/userTags/genres/developers/description
  五字段入口归一化（旧缓存异型数据此前使 Steam 浮窗整条渲染链抛错）
- **domains 簇**：builder.js isImageAppIdEnabled / 设置页站点管理 / 保存映射 /
  自定义站点列表——坏规则包缺 domains 曾同时打崩评分批次与设置页
- **缓存管理页**：formatTypeBadge/formatDownloadUrls/truncateUrl/formatRecBadge
  异型守卫（旧缓存条目渲染高发区）
- **dashboard**：keywords 数组守卫（表格+CSV 导出）、日志 level 兜底、basedOnTags、
  收藏 addedAt null 守卫、标签云权重防 NaN、指标 reduce 防字符串拼接
- **popup/限免页**：freegames games 数组守卫、API 状态文案防 NaN、
  **限免卡片 platform 属性转义**（外部 API 数据，防属性突破）
- **边界防御**：search.js addTerm / title-parser splitTitleSegments 字符串强转；
  dashboard 缓存搜索 query 按 100 字符契约截断（超长不再误导"无匹配"）

**系统性防线（防第三次踩中同一盲区）**

- **integrity 新守卫**：内容侧发送 action ⊆ CONTENT_ALLOWED_ACTIONS 静态扫描——
  白名单漏登记该类回归从此 check 必拦；P0-A 特权断言升级为提取 Set 条目（防注释误触）
- **测试补盲**：test-settings-lite（favorites 往返/数字 appId 规范化/窄化持久化钳制 ×3）、
  detail-templates 异型数据回归 ×2、契约用例 ×5（新 action/空串豁免/ITAD 锚）
- **视觉回归时序根治**：filters 截图锚定"数据已填充+入场动画全部结束"（display:none
  →block 会重启 panel-in/fadeUp 动画，旧固定延时在负载下截到中间态）+ 小差异重试；
  基线以新确定性时序重新生成（连续两轮 11/11）

**边界语义微调**：REPORT_WRONG_APPID 空串 appId 视同缺省（detail-page 无 appId 场景发
'' 表缺省，此前被契约拒绝且静默吞错）

820 test · gate 全过（check + E2E MOCK 50/50 + visual 11/11）

### 安全扫描（Mimosa 深度扫描，随版本补录）

- scanId: `scan-2026-09-27T08-59-14.807Z-9a87cf9a9316`
- seal: `sha256:c954bc57b795654f461ef9fca47afa74a095893551e717a64bd38ba52e67c0c0`
- findings: **0** · 依赖扫描 200 包 0 漏洞匹配

### v10.8.1（用户反馈修复：详情页候选浮窗"搜索失败" TypeError）

**修复**

- **候选游戏浮窗渲染崩溃（用户报告，多站详情页"搜索失败: TypeError: (text || \"\").replace is not a function"）**：
  v10.5.0 安全转义清扫把候选列表渲染改为 `escapeAttr(c.appId)`，而 Steam storesearch 返回的
  `item.id` 是**数字**——数字无 `.replace`，凡 Steam 自动搜索未命中弹出候选浮窗时渲染即崩。
  双层修复：① `escapeAttr` 入参 String 强转（shared/escape.js + content/core/common.js——
  转义是安全防线，不得因数据类型崩溃，顺带兜住全仓其他数字/对象入参场景）；
  ② `handleSearchSteamCandidates` 的 appId 在数据边界规范化为字符串
- 附带语义微调：`escapeAttr(0)` 现输出 "0"（旧 `||` 语义输出空串）——更保真
- e2e 探针新增 hasSearchError/错误文案诊断信号（真机验证"搜索失败"类反馈用）

**回归防线**：test-escape-robust.mjs ×5（数字/对象/null 入参不抛错、转义语义不变、
候选 handler 返回字符串 appId）

810 test · gate 全过（check + E2E MOCK 50/50 + visual 11/11）

### 安全扫描（Mimosa 深度扫描，随版本补录）

- scanId: `scan-2026-09-27T06-57-58.574Z-67fa97dc26fd`
- seal: `sha256:a71739498a8d37fc89e4e65545a8e29ebbf1d7f6371fe9872190cd5a0cf3a464`
- findings: **0** · 依赖扫描 200 包 0 漏洞匹配

### v10.8.0（自检演进：测试防线补齐 / 规则 features 勾选 UI / 纵深防御 / 文档更新）

**新功能**

- **规则编辑器 features 勾选**（F1）：站点规则列表每行新增三个功能勾选（内嵌 Steam 卡 /
  布局定制默认开 / 版本号解析）——勾选即回写编辑器 JSON，保存走原链路；自定义站零代码
  获得与内置站同款能力；字段说明表补 features 行

**纵深防御**

- **features 子键强制布尔**（B-1）：规则校验拒绝 truthy 字符串（如 "false"）误启用功能
- **保存侧数值范围钳制**（B-2）：14 个数值设置键（批次大小/二维码上限/夜间窗口等）后台
  保存时越界回默认（此前仅前端钳制）；纯函数可单测
- **限免源端点收编**（B-3）：manager.js 剩余 8 处端点字面量并入 ENDPOINTS 单源（现 0 散落）

**测试防线（自检缺口 2/4/5/7/8 全部落地）**

- 新套件 ×4：logger 追加路径（探底/追加/截断/失败复位/开关丢弃 ×5）、image-fetch handler
  （https/上限/content-type/异常 ×8）、search-cache 防抖写穿与 reset 取消（×2）、
  metrics 钩子管线（trackOpfsWrite 聚合 + data-store _writeHandle 接线验证 ×2）
- **E2E 补 v10.7.0 新面**：dashboard 运行指标卡渲染、**指标框架存活门禁**（消息计数 +
  OPFS 写计数非零——E1）、新设置键保存往返、加密组件加载检查（E2E 46 → 50）
- 修复：SW 写指标钩子接线由动态 import 改**静态导入 + 顶层调用**（铁律 2；动态版静默
  失败导致 opfs 写计数缺失）

**文档更新（自检欠账清偿）**

- 使用指南.md：版本/权限表（白名单实况，移除 <all_urls> 误导）+ v10.5.4-v10.8.0 用户可见功能
- PRIVACY.md：补 favorites/grMetrics（仅计数无浏览内容）/加密导出/ITAD 展示说明
- STORE.md：描述草稿补 v10.6.0+ 卖点与 localhost host 说明
- README 核心功能节补「收藏与数据洞察」「主题与体验」两节；CONTRIBUTING 补 E2E 浏览器
  安装、content-sim 8b 抖动与判定法、options 页直连 fetch 有意例外说明

**自检勘误**：2026-09-26 报告中 P2-4"coverage 盲区"经实测复核实为误报（陈旧 summary）。

805 test · gate 全过（check + E2E MOCK 50/50 + visual 11/11）

### 安全扫描（Mimosa 深度扫描，随版本补录）

- scanId: `scan-2026-09-26T18-22-05.998Z-543b20d7e444`
- seal: `sha256:7c07f9f62c10b470c32661d598e4d7f12037b98a94f14cb79d566f539426b2bd`
- findings: **0** · 依赖扫描 200 包 0 漏洞匹配

### v10.7.1（自检修复：跨域二维码解码契约失效 / 备份单源闭环 / 写放大回归防线）

**修复**

- **跨域二维码解码失效（P1）**：FETCH_IMAGE_DATA_URL 契约正则字符类排除 `/`，一切带路径的
  图片 URL（即全部真实二维码图）被契约层拒绝、handler 永不执行——自 v10.5.4 引入该规则起
  跨域解码实际失效（同源可解码图不受影响）。放宽为路径允许型（排除空白/引号/尖括号），
  与 handler 的 https 前缀校验对齐；补 7 个契约回归测试钉死
- **备份单源闭环**：BACKUP_CORE_KEYS 的 'manualMappings' 此前为永不匹配死键（不在
  DATA_MODULES）且与注册表 LEGACY_BACKUP_KEYS 导出断裂——现由注册表派生，备份/还原对
  legacy 键（仅 storage.local）显式读写配对；删除 backups.js 冗余 settings 条件

**回归防线（自检缺口 1/3/6）**

- registry dirty 语义：未变更重复 confirm 零落盘、变更路径 lastConfirmed 更新（防写放大事故回归）
- 备份幽灵键排除 + manualMappings 纳入/还原断言
- list-batch 批次容量钳制抽为纯函数 resolveBatchCapacity 并单测（10-200 越界回 60）

**清理**：handlers.js 孤儿注释（已迁出 handler 的过时 3MB 描述）、api-details 重复注释行、
options 主题定时标签写死时段文案、withRetry 标注预留 API、constants 中部 import 置顶。
另：自检 P2-4"coverage 盲区"经实测复核实为误报（陈旧 summary 文件），配置无问题。

779 test · gate 全过（check + E2E MOCK 46/46 + visual 11/11）

### 安全扫描（Mimosa 深度扫描，随版本补录）

- scanId: `scan-2026-09-26T17-52-20.322Z-d28eea5e820d`
- seal: `sha256:cf58fe9f07ce4cccaf886d1c31f854b5347f3f41277f9fcb458c4eef6fb28831`
- findings: **0** · 依赖扫描 200 包 0 漏洞匹配

### v10.7.0（机制与架构优化：四单源化 + 开销治理 + 量化框架）

源自 2026-09 迭代方案研究（见 `迭代方案研究-2026-09-机制与架构.md`）：功能已收敛，
但"接线"仍靠手工同步——三张注册表数字漂移、17 份同构机制实现、~128 处写死值。
本版五个批次（每批 ≤1000 行）以**单源化**为核心，均无用户可见行为变化。

**单源化（消除手工多点同步）**

- **机制工厂四件套**（批次1，`background/core/mechanisms.js` 新增）：`withLock` /
  `debounce` / `TtlCache` / `withRetry` 收编散落的 17 份同构实现（互斥锁 ×5、防抖 ×4、
  Map+TTL 缓存 ×4、散装重试 ×4+）——纯函数工厂 + 可注入时钟，等价替换
- **存储模块注册表**（批次2，`data/storage-registry.js` 新增）：此前 DB_KEYS(26) /
  DATA_MODULES(24) / MODULE_FILES(25) 三张表是同一事实的三份拷贝且已漂移；现由
  `STORAGE_MODULES` 一张表派生 data-store 文件映射、DATA_MODULES、默认备份子集与清除
  范围——新增存储模块成本由 6 文件降为「1 行 + 1 业务文件」。顺带修掉漂移产物的备份
  幽灵键，并把 favorites 纳入默认备份
- **内容模块清单**（批次4，`content/module-manifest.js` 新增）：tracker 装载表 /
  test-content-sim 的 MODULE_FILES / integrity 校验三处手工同步 → `CORE_MODULES`(12 并行)
  - `OPTIONAL_MODULES`(2，按 DEFAULT_SETTINGS 开关键条件加载，禁用 = 代码零加载) 一张表派生
- **站点 features 进规则 schema**（批次4）：内嵌评价卡站点白名单、XDGAME 布局默认值、
  版本号解析三处硬编码收编进 adapters 规则；`web_accessible_resources` 与 content_scripts
  域名一致性进 integrity 护栏（防 WAR 漂移）

**收敛与治理**

- **评分口径下沉**（批次1，`content/core/steam-rating-logic.js` 新增）：消除
  list → detail 跨层依赖；escapeHtml 4 套实现统一为 shared/escape 单一口径
- **常量单源**（批次1）：STORAGE_CAPS（14 处存储容量）/ ENDPOINTS（storesearch ×3 /
  appdetails ×2 / ITAD ×2 / Steam 商店前缀 ×7 重复消除）/ SPY_SCALES（SteamSpy 信号
  归一刻度）三组进 `constants.js`；删除好评率分级色"整份字面量 fallback"（假单源，实为漂移源）
- **开销治理**（批次3）：registry 仅变更时落盘（此前评分批次无变化也整体重写）；兜底
  alarm 5min → 30min（SW 白唤醒 12 次/时 → 2 次/时）；分级预热（温层 8 模块延迟 15s，
  短命 SW 跳过 ~2/3 冷启动 IO）；lastUpdate 会话内去重；searchCache 防抖写穿；
  batchState 硬上限 2000

**量化体系（批次5）**

- **运行指标框架**（`background/core/metrics.js` 新增 + GET_RUNTIME_METRICS）：有界
  计数器（≤64 键）+ 环形直方图（p95/min/max/avg）；消息按 action 计数、OPFS 按模块
  写字节数（data 层钩子注入保持分层纯净）、评分批次耗时/数量埋点
- **dashboard 指标卡 ×3**：评分批次 P95 耗时 / 会话 OPFS 写次数（悬停显累计 MB）/
  会话消息总数——后续每笔优化的收益从"估算"变"读数"

**可调设置（批次5，原写死值提升为设置键）**

- 夜间窗口起止小时（uiThemeNightStart/End，默认 19/7，支持跨零点）
- 评分批次大小 ratingsBatchSize（10-200，默认 60）
- 二维码图片上限 qrImageMaxKb（512-30720，默认 3MB）

**工程**

- 新测试：mechanisms 5 项 / metrics 5 项（环形淘汰与键上限）；integrity 新增
  WAR 覆盖断言与 module-manifest 文件存在性断言；handlers 业务迁出（track-event /
  image-fetch → handlers/ 子目录，407→335 行）
- 页面层统一：applyPageTheme 统一入口（popup/dashboard/hub/freegames 主题探测
  复制粘贴收敛）；freegames/hub 消息封装统一走 shared/msg.js（自带超时）

770 test · gate 全过（check + E2E MOCK 46/46 + visual 11/11 基线更新）

### 安全扫描（Mimosa 深度扫描，随版本补录）

- scanId: `scan-2026-09-26T17-04-08.082Z-3df1ff96781c`
- seal: `sha256:fbe981821fefa7875c7684c30bdac4e16b87f729ebbfcfc2a0e8a262e1af87ea`
- findings: **0** · 依赖扫描 200 包 0 漏洞匹配

### v10.6.0（性能与体验批次 / 收藏·ITAD·主题定时·备份加密 / steam 缓存分文件）

**新功能**

- **视口优先批量调度**（list-batch.js S1）：滚动批次按「距视口距离」排序取批——正在看的区域先出徽章，已在视口上方的沉底
- **列表浮窗合并面板**（xdgrid.js I1）：过滤标签页（开关 + 滑块实时调节好评率过滤，含持久化）与布局标签页（列数/间距，对称扩展）合并进同一齿轮浮窗，替代独立 filter-fab
- **浮窗折叠状态记忆**（floats.js I2）：折叠状态按浮窗 id 存 chrome.storage.local，刷新后保持
- **ITAD 最低价行**（F1）：Steam 浮窗显示 IsThereAnyDeal 历史最低价（12h 缓存，需配置 ITAD API Key）
- **收藏功能**（F2）：详情浮窗 ☆ 一键收藏（上限 500）/ dashboard 收藏区管理 / 收藏游戏进限免时通知标题前缀提示；favorites 独立存储模块（TOGGLE_FAVORITE / GET_FAVORITES）
- **dashboard 离线搜索**（F3）：SEARCH_CACHED_GAMES——已缓存游戏名子串检索，合并评分/排名/收藏信息
- **主题定时切换**（F4）：themeAutoSwitch 总开关 + uiThemeDay/uiThemeNight 双主题（07:00-19:00 日间 / 夜间自动），shared/settings-utils.js resolveTheme 单源，popup/options/dashboard/hub/freegames 五页接入
- **离线备份加密**（F5）：shared/crypto-utils.js（WebCrypto AES-GCM + PBKDF2 15 万次派生，口令不落盘）——数据管理页「🔐 加密导出」勾选 + 口令输入，导入自动识别加密信封（2 次口令重试）；6 个单测
- **会话出网计数**（N1）：api-monitor 新增浏览器会话累计 Steam 请求计数（与 5 分钟滑动窗口分离），popup 状态区显示「本次会话已出网 N 次」——量化缓存策略省下的请求量
- **限免监控总开关**（N4）：freeGamesEnabled——关闭后后台完全不抓取各限免源（页面显示旧数据）

**优化/修复**

- **steam 缓存 4 分文件**（C1）：单文件 steamCache 拆分为 meta/rating/detail/spy 四模块独立持久化——dirtyModules 子集写入（单模块更新不再全量重写）、旧单文件自动迁移（ts 择新合并后移除）、过期清理/清除/重置全链路适配
- **修复推荐徽章污染徽章组标记**（U1）：prependRecBadge 走 createBadge 统一基类后，推荐徽章带上了 gr-rating-badge 组标记——推荐响应先于评分返回时污染防重复守卫，导致好评率徽章可能永久缺失（真机级 bug，content-sim 抓出）；现组外徽章以 base:'gr-badge' 渲染
- **徽章统一**（U1）：rec 徽章并入 createBadge 基类（.gr-badge 统一规格），样式差异收敛到 CSS
- **导出/模块列表体积列**（C5）：GET_DATA_MODULES 返回各模块字节数，数据管理页显示「· x KB」
- **未找到徽章提示**（E1）：tooltip 增加 Alt+Shift+G 强制刷新与负缓存自动重查说明
- **E2E 探针工具化**（E5）：tests/e2e-probe.mjs 参数化（--url/--count/--timeout/--dump-logs/--keep-profile），常驻真机诊断
- **CI 视觉连续失败升级**（E4）：单次失败保持 advisory；连续 2 次失败经 cache 传递标记升级为阻断

758 test · gate 全过（check + E2E MOCK + visual 11/11）

### 安全扫描（Mimosa 深度扫描，随版本补录）

- scanId: `scan-2026-09-12T18-19-37.799Z-465677f556cb`
- seal: `sha256:2da23dc6742e2b48c7e6da2fd3e5936968afe43c4c4faa763b62f54601630c2e`
- findings: **0** · 依赖扫描 200 包 0 漏洞匹配

### v10.5.4（Steam250 排名引入 / gamers520 双域名 + 跨域二维码解码 / tags 页不注入 / 浮窗标签可点击 / 条件加载）

**新功能**

- **Steam250 排名引入**（steam250.js / handlers / detail-templates / detail-page）：后台按 24h 快照抓取 steam250.com/top250（服务端渲染榜单，appId ↔ 排名/评分/评价数映射，数量下限哨兵防结构变更），Steam 浮窗与咸鱼单机/Gamer520 内嵌评价卡新增「🏆 Steam250 排名」行（排名/评分/评价数 + 榜单外链），游戏不在前 250 时自动隐藏。新增 `GET_STEAM250_RANK` 消息（contract 校验）+ `steam250Rank` 存储模块（导出/导入/清除全链路）
- **浮窗用户标签可点击**：Steam 浮窗「热门用户标签」改为链接跳转 Steam 标签页（新窗口，href 全量编码）
- **tracker 条件加载**：qr-unlock / xdgrid / filter-fab 模块按设置**条件导入**——关闭后模块代码完全不加载（降低资源占用）；boot 顺序调整为设置先行（缺失时默认全加载）

**修复**

- **gamers520.com（旧域名）全覆盖**：manifest 注入/WAR/适配器 domains/站点脚本/trackedSites 五处补齐——此前旧域名访问时扩展完全不注入，二维码功能自然失效
- **跨域二维码解码**（qr-unlock / FETCH_IMAGE_DATA_URL）：跨域图片污染 canvas 导致解码跳过——现由后台代取图片（fetchWithTimeout 内建 SSRF 校验，https-only、3MB 上限、image/* 校验）转 dataURL 后解码；contract 新增白名单规则
- **XDGame 链接统一 www**：adapter base/searchUrl 补 www（裸域会 301）
- **Steam 标签页不注入**：store.steampowered.com/tags/* 页 tracker 提前退出（标签聚合页无单一游戏对象）

752 test · gate 全过（check + E2E MOCK + visual）

### 安全扫描（Mimosa 深度扫描，随版本补录）

- scanId: `scan-2026-09-12T16-52-08.863Z-4b094333ff7a`
- seal: `sha256:2d687002fca3bd4e92abcc661189819b9348d8546586b2498e15b9c1fea7d66b`
- findings: **0** · 依赖扫描 200 包 0 漏洞匹配

### v10.5.3（内嵌 Steam 信息区 / 列表页综合评分徽章 / 首页错位修复 / 销量评论数入推荐）

**新功能**

- **列表页综合评分徽章**（badges.js / steam-cache.js / orchestrator.js / 各 UI）：各下载站列表页每个游戏标题最前新增 ⭐ **综合评分徽章**，口径与 XDGame 原生「Steam 玩家评价」完全一致（综合评分 = 修正口碑 ÷ 10；好评率贝叶斯收缩，参数经 XDGame 线上接口回归校准）。悬停显示与 XDGame 卡片一致的明细（评级 / 综合评分 / 修正口碑 / Steam 好评率 / 评测数 / 好评差评 / 结论文案），点击跳转 Steam 详情页，配色取 XDGame 评级胶囊三档（绿 / 黄 / 红）。数据随 Steam 动态缓存 rating 模块存取——新增 `positiveReviews` / `negativeReviews` 原始条数字段，按 appId 多站共用（旧缓存缺失按整数好评率近似回退）；0 评测重搜本体后评测统计统一以新 appId 为准（修复 totalReviews 与新 appId 不一致）。设置页 / 弹窗新增「综合评分」徽章开关（默认开，与三段式徽章开关并列）。
- **销量与评论数参与推荐计算**（engine.js / api-supplement.js）：SteamSpy 补充数据新增原始数值 `totalReviews`（评论总数）与 `ccu`（当前在线），随 spy 模块缓存（7 天 TTL，旧缓存到期自动补齐）。推荐引擎 `steamspyScores` 拆分为四信号：**销量** = owners 区间中点对数 / 7（原"热度"口径本质是销量，移交本信号）；**评论数** = totalReviews 对数 / 5；**热度** 改 CCU 当前在线口径（对数 / 5，真正的"当下热度"）；时长不变。权重默认 `sales: 0.05 / reviews: 0.05`（十项和保持 1.0；未配置新权重的旧调用方贡献恰为 0，行为不变）。设置页 / 弹窗滑块 / 推荐徽章悬停明细全链路同步。

**修复**

- **下载站首页显示错位**（tracker.js / list-page.js）：各下载站首页混排轮播 / 新闻 / 多尺寸卡片，列表功能（徽章插入 / 网格重排 / 过滤控件）会打破站点原生布局。新增 `isHomePageUrl` 判定（根路径或 `/index.html` 且无查询串）：首页暂停列表与详情功能，仅保留下载追踪与二维码转链接；带查询串的根路径（如 WordPress 搜索 `/?s=`）不受影响仍按列表页处理；popup 的推荐刷新消息在首页同样静默跳过。

**界面**

- 设置页"热度权重"说明更新为 CCU 口径（`Heat (SteamSpy CCU)`）；新增"销量权重 / 评论数权重"滑块（0–50%，步进 5，支持手动输入双向绑定）。
- 权重总和指示器修正：此前漏计 v10.1.0 的两项 a-b 权重（默认和显示 0.89 误报 warn），现全量十项合计，默认恰为 1.00。
- 推荐徽章悬停明细新增「📊 销量 · 📝 评论数」一行。

**测试**

- 新增 14 项回归（全量 vitest 748/748 通过）：engine 8 项——四信号归一化（CCU 封顶与刻度 / 缺 CCU 中性不抬热度 / 销量口径 / 评论数刻度 / 非法值回中性）、权重未配置行为不变、满分分量进 breakdown 且提分、缺数据不抬分；content-sim 9a——目标站注入位置与内容、非目标站门控、同游戏幂等、模板降级、站点门控名单源码守护，8d——综合评分徽章渲染（首位置 / ⭐ 8.3 = 修正口碑 83.3÷10 / 悬停明细 / 绿色三档配色 / 显式好评差评缓存字段）与旧缓存无 positiveReviews 字段的整数好评率回退（游戏B ⭐ 5.8）；ui-pure 4 项——修正口碑 XDGame 线上样本回归（7 组 ≤0.5pp）、结论分档阈值边界、评级描述中英映射与回退、信息卡模板口径（综合评分 = 修正口碑 ÷ 10）；handlers——GET_STEAM_RATINGS 缓存命中穿透返回 positiveReviews / negativeReviews（按 appId 多站共用字段）。

### v10.5.2（缓存命中零网络契约修复 / LLM Token 优化 / 无障碍焦点）

**修复（P1）**

- **缓存命中路径零网络契约修复**（orchestrator.js `applyCacheHit`）：此前同步 `await` 名称自愈（最多 2 次 Steam 请求）——列表页第一波 `getSteamRatingsFromCacheOnly` 声明的"零网络请求"契约被打破，Steam 不可达 / 官方无英文名（中文站常见）时**每次缓存命中都阻塞数秒并空耗 API 配额**，慢网下直接拖慢徽章首屏渲染。现自愈改后台执行（不阻塞返回），结果非徽章渲染依赖。
- **名称自愈退避**（api-registry-heal.js）：新增按 appId 的 10 分钟退避——上次尝试无改进（Steam 不可达或官方确无对应语言名）时窗口内不再重复发起注定失败的请求；成功自愈即清除退避。上限 500 条防 Map 无界增长。
- **test-ratings-resume 间歇失败根因修复**：顶层测试在 describe `afterAll`（恢复真实 fetch）之后运行，两个任务经名称自愈路径发起**真实 Steam 请求**（每个 0.5~~7s 网络延迟），负载下超出轮询预算而间歇失败（全量跑失败、单独跑通过的"幽灵"用例）。移入 describe 后 fetch mock 覆盖全部用例（1.4~~4.9s → 63ms），并附根因说明注释。

**性能**

- **下一页预载解析让出主线程**（list-page.js）：整页 HTML 的同步 `DOMParser` 可达数十毫秒，移入 `requestIdleCallback`（无该 API 环境回退 `setTimeout`），不再与页面渲染/交互竞争。
- **分层修复**（recommend/engine.js）：LLM 路径关键词权重此前直读 `dataStore` 绕过缓存层（每次 LLM 调用多一次磁盘 IO），改走 `behavior.js` 内存缓存读取。

**Token 消耗（LLM 评分链路）**

- **输出上限**：Ollama `num_predict: 100` / OpenAI 兼容 `max_tokens: 100`——评分输出只是一小段 JSON，此前无上限时模型可能长篇发挥。
- **输入截断**：prompt 中游戏描述限 100 字——输入 token 随描述线性增长，评分对长描述几乎无贡献。配合既有 7 天评分缓存与自愈退避，重复请求显著减少。

**界面与无障碍（ui-theme.css，惠及 popup/options/dashboard/hub/freegames 全部扩展页）**

- **键盘焦点可见性**：按钮/导航项/开关/复选框补 `:focus-visible` 描边——此前键盘导航无任何视觉反馈（无障碍缺口）；鼠标操作不受影响。
- **prefers-reduced-motion**：尊重系统级"减少动态"偏好，装饰性过渡/动画降为瞬时。
- 滚动条 hover 颜色修正（原误用背景色变量）；清理重复的 `.gr-input:focus` 规则。

**测试**

- 新增 2 项回归（test-orchestrator）：① 缓存命中零网络契约——挂起 fetch mock 下瞬时返回且好评率正确；② 自愈退避——首次尝试后窗口内不重复请求。全量 vitest 734/734、视觉回归 11/11 基线一致。

### v10.5.1（列表页过滤实时控件 / xdgame 布局对称扩展 / CI e2e 修复）

- **列表页好评率过滤悬浮控件**：列表页左下常驻 FAB（🎚），展开含"启用好评率过滤"开关 + 0–100 滑块，**实时**对已渲染项显示/隐藏（复用已取好评率，不重新请求），并同步持久化到全局设置（复用既有 `enableRatingFilter`/`minSteamRatingFilter` 键，不新增设置项、不触发设置同步门禁）。`list-state` 新增 `applyLiveRatingFilter` + 保留完整评分（`ratingsByName`）供实时重算；附回归测试。
- **xdgame 列表布局定制（任务2）**：固定图标宽模式容器改为 `margin-left/right:auto` 水平居中——增加每行列数时容器**向两侧对称扩展**，右列图标不再溢出/被裁、显示完整；自适应模式不变。更新面板提示文案与 `test-wiring` 断言。
- **CI 托管 e2e 红修复（任务3）**：① e2e/视觉改用固定版本 Playwright Chromium（`npx playwright-core install chromium`），规避托管机最新版系统 Chrome 偶发发现不到 MV3 Service Worker（扩展 id=null）导致 e2e 启动即失败的既有问题——e2e 冒烟恢复阻断性通过（46/46）。② 视觉回归拆为**独立 advisory 作业**（`continue-on-error`）：其基线在开发者 Windows 机采集，Linux CI 字体/抗锯齿产生全页 ~3% 均匀像素差、与真实回归无关，故不再阻断流水线，仅上传 diff 供人工审阅；功能门禁仍由 e2e 冒烟承担。

### v10.5.0（安全加固 / 隐私默认 / 测试可信度 / 健壮性——独立审计报告全量落地）

**安全（P0）**

- **消息分发新增 sender 来源门**（`handlers.js` + `message-contract.js`）：非扩展页来源（内容脚本 http 源）仅可发白名单读/埋点 action，被注入内容脚本无法再伪造 `SAVE_SETTINGS`/`CLEAR_DATA`/`IMPORT_DATA`/`SAVE_ADAPTER_RULES` 等特权 action（拒绝返回 `forbidden-sender`）。附伪造 sender 集成回归。
- **内容脚本转义补齐**：详情页 `ratingDesc`/SteamSpy 文本字段、候选项 `data-appid`/价格全部走 `esc`/`escapeAttr`；二维码解码链接改 `new URL` 仅放行 http(s)，杜绝 `javascript:`/`data:` 伪协议跳转。
- **站点域名严格校验（最小权限）**：导入/自定义规则 `domains` 必须为裸主机名（`isValidSiteDomain` 拒绝通配符/协议/路径/端口），`site-scripts` 注册前二次校验、options 添加站点前归一+校验，堵住"加一个站=全站注入"。

**隐私（P1-C）**

- **Bing 搜索兜底默认关闭**（`dataSources.bing:false`）：开启才会把游戏名作为查询发往 cn.bing.com，改为显式启用；PRIVACY 相应说明"已存数据不出本机、仅第三方源查询按需外发"。

**健壮与测试可信度（P1-A/B/D）**

- **OPFS 写路径集成测试**：新增内存假 OPFS 套件真实驱动 `dataStore` 写/追加/删除/损坏恢复（此前单测仅覆盖 storage.local 回退路径）。
- **生命周期兜底落盘**：新增 5 分钟 `grPeriodicFlush` alarm 聚合刷盘；`flushAllCaches` 纳入 app-stats；logger 写失败回滚后重排一次；app-stats 加脏标记（防写放大 + 不拖累批量收尾时序）。
- **覆盖率"去假象"**：vitest `coverage.all:true` 纳入全部源文件 + 设全局硬下限（lines62/stmt60/func60/branch54），CI 新增全量下限步骤与发布 zip 构建冒烟校验步骤；`eslint` 纳入 `.mjs` 测试（错误级正确性规则）。新增备份/导出/导入往返、数据模块清单等集成测试。全量真实覆盖 lines≈67%。

**契约与持久化（P2）**

- **消息契约默认拒绝**：未登记 action 一律拒绝（补 LOG_PERF/OPEN_HUB），`test-integrity` 断言每个 handler 都有契约规则；`SAVE_SETTINGS.weights` 值必须为有限数值。
- **推荐引擎 NaN 防护**：权重/好评率/LLM 分数落库与计算前 `Number.isFinite` 校验，脏数据不再产出 NaN 分。
- **存储模块一致性护栏**：`test-integrity` 断言 DATA_MODULES ⊆ DB_KEYS ∩ MODULE_FILES（新增模块漏同步即失败）；游戏画像 LRU 上限（5000，保留下载/不感兴趣高价值项）。
- **列表消费方不再静默降级**：`GET_STEAM_RATINGS` 被拒/失败时显式告警。

**性能与清理（P2-C/P3）**

- 列表发现观察器跳过扩展自身注入节点（`data-gr-self` 标记，避免反馈回环）。
- **修复 downloadTrackingEnabled 死开关**（v10.4.2 同类）：关闭后不再接线点击/复制追踪。
- hub `message` 监听加同源校验；`goHub` postMessage 目标由 `*` 收敛为扩展自身源。
- vendored 第三方库（qrcode-reader v1.0.0 / Apache-2.0）已有版本与来源标注，保持固定。

**已知取舍 / 后续（诚实记录，未纳入本版）**

- 统一响应信封 `{ok,data|error}`（全量改写 handler + UI 消费方，改动面过大，建议独立版本）；
- 数据层读路径入写队列 / `restoreBackup` 全事务化（核心存储高风险，现有 `.corrupt` 备份 + 恢复前安全网备份已缓解，风险可控，另立专项）；
- 视觉基线跨 OS/字体矩阵（Windows runner 成本对单人项目不划算，维持 Linux CI + 手动 `--update`）；
- 分层依赖 ESLint 化——实际已由 `test-integrity` 的 `ALLOWED` 矩阵（0 违规）强制，未重复实现。

### v10.4.3（修复：a-b 徽章对所有已解析游戏渲染）

- **a-b 徽章此前仅对"有行为记录"的游戏渲染**（appDownloads 字段存在判定）——计数自 v10.1.0 起才积累，多数游戏无记录 → 徽章不显示。现改为**所有已解析 appId 的游戏都渲染**（原始需求「每个游戏链接增加一个徽章」）：无记录显示灰色 0-0，tooltip 提示"打开详情页/下载后开始计数"
- 徽章配色：有下载（a>0）绿 / 只看不下（a=0 且 b>0）橙 / 无记录灰
- 真浏览器探针（内联 mock + 种入统计）端到端验证：徽章渲染、位置、计数链路全部正常

689 test · content-sim 断言同步（节 2 计数 5、isAllBadge 排除 a-b、rec 徽章序位）· gate 全过

### v10.4.2（修复：推荐度徽章开关失效）

- **「关闭推荐度显示」开关此前完全无效**：推荐徽章渲染链路读取的 batchState 从未存储 settings（initBatchState 收到参数但未入对象）→ 门控拿到恒为空的对象、badgeVisibility.rec 判定恒放行 → 推荐徽章无视开关永远渲染。修复后开关生效（刷新页面）
- 该根因同时影响推荐高亮（highlightThreshold 判定同读该 settings 对象），一并修复
- content-sim 补 8c 回归测试（rec=false → 评分徽章正常、推荐徽章不渲染；金标准验证：移除修复必失败）

690 test · gate 全过

### v10.4.1（修复：a-b 徽章位置）

- a-b 徽章此前插在徽章组最左——修正为**两个好评率徽章之后、推荐值徽章之前**（锚点 = 好评率徽章组末尾；推荐值徽章的选择器以 gr-rating-badge 为基类自然接在其后）
- content-sim 补位置断言（appstat 序位 > 近30天徽章）

689 test · gate 全过

### v10.4.0（详情页浮窗设置 / 高分标题变红 / 列表布局定制全站化）

- **详情页浮窗设置**：默认展开/折叠（detailFloatExpanded）+ 浮窗位置左/右（detailFloatSide，默认左上保持原行为）——设置页「常规 → 详情页浮窗」；floats.js 新增 folded 创建选项
- **高分标题变红**：总好评率与 30 天好评率**均大于**阈值（redTitleRating，默认 95，0=关闭）时列表页标题变红（.gr-title-red）——设置页「徽章显示」；红优先于 a-b 绿标题
- **列表布局定制泛化为所有下载站**（原 XDGAME 专属）：不再硬编码站点选择器——经适配器提取列表项、计算最低公共祖先作为列表容器施加 grid 布局；**按站点独立配置**（xdgame 旧配置自动迁移且默认启用；其他站默认关闭，点齿轮启用本站定制）；纯函数可单测
- 设置同步：新增 3 键经 test-settings-sync 强制验证已入 options 层

689 test · E2E 46/46（MOCK + 真实网络）· visual 11/11（基线更新）· lint 0 · typecheck 0

### v10.4.1（修复：a-b 徽章位置）

- a-b 徽章此前插在徽章组最左——修正为**两个好评率徽章之后、推荐值徽章之前**（锚点 = 好评率徽章组末尾；推荐值徽章的选择器以 gr-rating-badge 为基类自然接在其后）
- content-sim 补位置断言（appstat 序位 > 近30天徽章）

689 test · gate 全过

### v10.3.1（流程与规则：设置同步强制化 + 统一门禁 + 平台调研）

- **设置同步强制规则**：新增 test-settings-sync——静态扫描 DEFAULT_SETTINGS 全部键
  （顶层 + badgeVisibility/weights/cacheTtls/dataSources/steamApiModules 嵌套组），
  强制其在设置层（options 层）与 popup 快捷层有引用，漏同步

> game-recommender@10.3.0 check
> npm run lint && npm run typecheck && npm test

> game-recommender@10.3.0 lint
> eslint background content options popup shared tests adapters dashboard data freegames lib hub --no-warn-ignored

> game-recommender@10.3.0 typecheck
> tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.ui.json && tsc --noEmit -p tsconfig.content.json

> game-recommender@10.3.0 test
> vitest run

[1m[30m[46m RUN [49m[39m[22m [36mv4.1.10 [39m[90mF:/data/browser extension/game-recommender[39m

[32m✓[39m tests/integration/test-content-sim.mjs [2m([22m[2m16 tests[22m[2m)[22m[33m 2972[2mms[22m[39m
[33m[2m✓[22m[39m 1. 顶层加载与预热 [33m 460[2mms[22m[39m
[33m[2m✓[22m[39m 3. waitForListItems（AJAX 延迟渲染） [33m 470[2mms[22m[39m
[33m[2m✓[22m[39m 4. 调试视图关闭后不自动复活 [33m 612[2mms[22m[39m
[33m[2m✓[22m[39m 7. FORCE_REFRESH_PAGE（popup 强制刷新） [33m 314[2mms[22m[39m
[33m[2m✓[22m[39m 8. 徽章开关与过滤/高亮联动 [33m 346[2mms[22m[39m
[33m[2m✓[22m[39m 8b. 关全部好评率徽章 → 过滤停用 [33m 344[2mms[22m[39m
[33m[2m✓[22m[39m 9. 详情页报错按钮（人工纠错重新检索） [33m 314[2mms[22m[39m
[32m✓[39m tests/unit/test-ratings-resume.mjs [2m([22m[2m4 tests[22m[2m)[22m[33m 4039[2mms[22m[39m
[33m[2m✓[22m[39m v10.0.0：连续两个任务——第一个 done 后守卫必须复位（滚动衔接第二批回归） [33m 4033[2mms[22m[39m
[32m✓[39m tests/unit/test-properties.mjs [2m([22m[2m10 tests[22m[2m)[22m[32m 26[2mms[22m[39m
[90mstdout[2m | tests/unit/test-storage.mjs
[22m[39m9b. 分模块缓存命中率 getCacheStats

[32m✓[39m tests/unit/test-storage.mjs [2m([22m[2m47 tests[22m[2m)[22m[32m 22[2mms[22m[39m
[32m✓[39m tests/integration/test-handlers.mjs [2m([22m[2m45 tests[22m[2m)[22m[32m 23[2mms[22m[39m
[32m✓[39m tests/unit/test-health.mjs [2m([22m[2m6 tests[22m[2m)[22m[32m 9[2mms[22m[39m
[32m✓[39m tests/unit/test-api-pure.mjs [2m([22m[2m132 tests[22m[2m)[22m[32m 14[2mms[22m[39m
[90mstdout[2m | tests/unit/test-wiring.mjs[2m > [22m[2msite-scripts 动态注册[2m > [22m[2m自定义域名注册 + 幂等重跑不重复 + 内置域跳过
[22m[39m【游戏雷达】 动态注册自定义站点内容脚本: gr-site-example-custom.com

[32m✓[39m tests/unit/test-wiring.mjs [2m([22m[2m21 tests[22m[2m)[22m[32m 9[2mms[22m[39m
[32m✓[39m tests/unit/test-freegames.mjs [2m([22m[2m33 tests[22m[2m)[22m[32m 9[2mms[22m[39m
[32m✓[39m tests/unit/test-engine.mjs [2m([22m[2m36 tests[22m[2m)[22m[32m 9[2mms[22m[39m
[32m✓[39m tests/unit/test-sites.mjs [2m([22m[2m12 tests[22m[2m)[22m[32m 7[2mms[22m[39m
[32m✓[39m tests/unit/test-contract.mjs [2m([22m[2m100 tests[22m[2m)[22m[32m 7[2mms[22m[39m
[32m✓[39m tests/unit/test-outbound.mjs [2m([22m[2m19 tests[22m[2m)[22m[32m 9[2mms[22m[39m
[32m✓[39m tests/unit/test-rules-cleanup.mjs [2m([22m[2m50 tests[22m[2m)[22m[32m 6[2mms[22m[39m
[32m✓[39m tests/unit/test-security.mjs [2m([22m[2m48 tests[22m[2m)[22m[32m 5[2mms[22m[39m
[32m✓[39m tests/unit/test-title-parser.mjs [2m([22m[2m38 tests[22m[2m)[22m[32m 6[2mms[22m[39m
[32m✓[39m tests/integration/test-integrity.mjs [2m([22m[2m21 tests[22m[2m)[22m[32m 6[2mms[22m[39m
[32m✓[39m tests/unit/test-settings-sync.mjs [2m([22m[2m6 tests[22m[2m)[22m[32m 4[2mms[22m[39m
[32m✓[39m tests/unit/test-migrate.mjs [2m([22m[2m5 tests[22m[2m)[22m[32m 4[2mms[22m[39m
[32m✓[39m tests/unit/test-trends.mjs [2m([22m[2m20 tests[22m[2m)[22m[32m 3[2mms[22m[39m
[32m✓[39m tests/unit/test-ui-pure.mjs [2m([22m[2m11 tests[22m[2m)[22m[32m 3[2mms[22m[39m
[32m✓[39m tests/integration/test-orchestrator.mjs [2m([22m[2m10 tests[22m[2m)[22m[32m 2[2mms[22m[39m

[2m Test Files [22m [1m[32m22 passed[39m[22m[90m (22)[39m
[2m Tests [22m [1m[32m690 passed[39m[22m[90m (690)[39m
[2m Start at [22m 12:01:39
[2m Duration [22m 20.28s[2m (transform 1.30s, setup 0ms, import 10.28s, tests 7.20s, environment 1ms)[22m 失败；
历史遗留键入 allowlist（须写明理由，防 stale 豁免）。规则同步写入 AGENTS.md 铁律

- **统一质量门禁**：

> game-recommender@10.3.0 gate
> node scripts/gate.mjs

===== check（lint + typecheck + vitest） =====

> game-recommender@10.3.0 check
> npm run lint && npm run typecheck && npm test

> game-recommender@10.3.0 lint
> eslint background content options popup shared tests adapters dashboard data freegames lib hub --no-warn-ignored

> game-recommender@10.3.0 typecheck
> tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.ui.json && tsc --noEmit -p tsconfig.content.json

> game-recommender@10.3.0 test
> vitest run

[1m[30m[46m RUN [49m[39m[22m [36mv4.1.10 [39m[90mF:/data/browser extension/game-recommender[39m

[32m✓[39m tests/unit/test-ratings-resume.mjs [2m([22m[2m4 tests[22m[2m)[22m[33m 2261[2mms[22m[39m
[33m[2m✓[22m[39m v10.0.0：连续两个任务——第一个 done 后守卫必须复位（滚动衔接第二批回归） [33m 2255[2mms[22m[39m
[32m✓[39m tests/integration/test-content-sim.mjs [2m([22m[2m16 tests[22m[2m)[22m[33m 2953[2mms[22m[39m
[33m[2m✓[22m[39m 1. 顶层加载与预热 [33m 452[2mms[22m[39m
[33m[2m✓[22m[39m 3. waitForListItems（AJAX 延迟渲染） [33m 472[2mms[22m[39m
[33m[2m✓[22m[39m 4. 调试视图关闭后不自动复活 [33m 603[2mms[22m[39m
[33m[2m✓[22m[39m 7. FORCE_REFRESH_PAGE（popup 强制刷新） [33m 313[2mms[22m[39m
[33m[2m✓[22m[39m 8. 徽章开关与过滤/高亮联动 [33m 343[2mms[22m[39m
[33m[2m✓[22m[39m 8b. 关全部好评率徽章 → 过滤停用 [33m 342[2mms[22m[39m
[33m[2m✓[22m[39m 9. 详情页报错按钮（人工纠错重新检索） [33m 316[2mms[22m[39m
[32m✓[39m tests/unit/test-properties.mjs [2m([22m[2m10 tests[22m[2m)[22m[32m 27[2mms[22m[39m
[32m✓[39m tests/integration/test-handlers.mjs [2m([22m[2m45 tests[22m[2m)[22m[32m 21[2mms[22m[39m
[90mstdout[2m | tests/unit/test-storage.mjs
[22m[39m9b. 分模块缓存命中率 getCacheStats

[32m✓[39m tests/unit/test-storage.mjs [2m([22m[2m47 tests[22m[2m)[22m[32m 22[2mms[22m[39m
[32m✓[39m tests/unit/test-api-pure.mjs [2m([22m[2m132 tests[22m[2m)[22m[32m 12[2mms[22m[39m
[32m✓[39m tests/unit/test-freegames.mjs [2m([22m[2m33 tests[22m[2m)[22m[32m 9[2mms[22m[39m
[32m✓[39m tests/unit/test-health.mjs [2m([22m[2m6 tests[22m[2m)[22m[32m 18[2mms[22m[39m
[90mstdout[2m | tests/unit/test-wiring.mjs[2m > [22m[2msite-scripts 动态注册[2m > [22m[2m自定义域名注册 + 幂等重跑不重复 + 内置域跳过
[22m[39m【游戏雷达】 动态注册自定义站点内容脚本: gr-site-example-custom.com

[32m✓[39m tests/unit/test-wiring.mjs [2m([22m[2m21 tests[22m[2m)[22m[32m 10[2mms[22m[39m
[32m✓[39m tests/unit/test-outbound.mjs [2m([22m[2m19 tests[22m[2m)[22m[32m 9[2mms[22m[39m
[32m✓[39m tests/unit/test-engine.mjs [2m([22m[2m36 tests[22m[2m)[22m[32m 8[2mms[22m[39m
[32m✓[39m tests/unit/test-contract.mjs [2m([22m[2m100 tests[22m[2m)[22m[32m 8[2mms[22m[39m
[32m✓[39m tests/unit/test-sites.mjs [2m([22m[2m12 tests[22m[2m)[22m[32m 7[2mms[22m[39m
[32m✓[39m tests/unit/test-title-parser.mjs [2m([22m[2m38 tests[22m[2m)[22m[32m 5[2mms[22m[39m
[32m✓[39m tests/unit/test-rules-cleanup.mjs [2m([22m[2m50 tests[22m[2m)[22m[32m 6[2mms[22m[39m
[32m✓[39m tests/integration/test-integrity.mjs [2m([22m[2m21 tests[22m[2m)[22m[32m 5[2mms[22m[39m
[32m✓[39m tests/unit/test-security.mjs [2m([22m[2m48 tests[22m[2m)[22m[32m 5[2mms[22m[39m
[32m✓[39m tests/unit/test-settings-sync.mjs [2m([22m[2m6 tests[22m[2m)[22m[32m 4[2mms[22m[39m
[32m✓[39m tests/unit/test-migrate.mjs [2m([22m[2m5 tests[22m[2m)[22m[32m 4[2mms[22m[39m
[32m✓[39m tests/unit/test-trends.mjs [2m([22m[2m20 tests[22m[2m)[22m[32m 4[2mms[22m[39m
[32m✓[39m tests/unit/test-ui-pure.mjs [2m([22m[2m11 tests[22m[2m)[22m[32m 3[2mms[22m[39m
[32m✓[39m tests/integration/test-orchestrator.mjs [2m([22m[2m10 tests[22m[2m)[22m[32m 2[2mms[22m[39m

[2m Test Files [22m [1m[32m22 passed[39m[22m[90m (22)[39m
[2m Tests [22m [1m[32m690 passed[39m[22m[90m (690)[39m
[2m Start at [22m 12:02:02
[2m Duration [22m 18.72s[2m (transform 1.15s, setup 0ms, import 10.50s, tests 5.40s, environment 1ms)[22m

✅ check（lint + typecheck + vitest） 通过

===== E2E 冒烟（MOCK 离线） =====

> game-recommender@10.3.0 e2e
> node tests/e2e-smoke.mjs

1. 扩展 **MSG_extName** v10.3.0
   ✅ 扩展后台 Service Worker 已启动
   1b. 欢迎页（首次安装自动打开）
   ✅ 欢迎页功能导览渲染（安装模式）
   ✅ 欢迎页更新模式（What's new 渲染 + 安装区隐藏）
2. popup 冒烟
   ✅ popup 标题渲染
   ✅ popup 版本号显示
   ✅ popup API 状态（v6.4.10 扁平修复后非失效）
   ✅ popup 集中入口（设置中心按钮替代独立入口）
   ✅ popup 全覆盖设置（30天过滤/模式/重排/规则入口/徽章/权重/备份/日志）
   ✅ popup 无 console error
   2a. popup 快速搜索
   ✅ 搜索候选渲染（Steam 检索）
   2b. options 设置页与双向状态一致性
   ✅ options 设置渲染（启用开关+日志上限+自动备份）
   ✅ options 标题
   ✅ options 30 天过滤设置已保存（v6.4.11 修复）
   ✅ options→popup 状态一致（VM 过滤开启）
   ✅ options→popup 状态一致（30 天过滤开启）
   ✅ popup→options 状态一致（VM 过滤回切）
   ✅ options 无 console error
   2b2. 过滤设置全量保存与并发防覆盖
   ✅ 过滤设置全量保存（好评率开+阈值65/关系or）
   ✅ 重开设置页回显（好评率过滤 开+65）
   ✅ 快速连续 3 项修改全部保留（阈值40/关系and/重排开）
   2c. 皮肤系统（Steam/Vista/Win 历代主题）
   ✅ 皮肤选择器（默认 steam + 20 主题 + Vista 入口移除）
   ✅ 皮肤切换立即生效（body[data-theme=ios17]）
   ✅ 皮肤保存并重开生效（uiTheme=ios17）
   ✅ 皮肤系统无 console error
   2d. 设置中心 hub 集中入口
   ✅ hub 渲染（3 个页面入口 + 默认加载设置页）
   ✅ hub 切换到数据分析（iframe 渲染 dashboard）
   ✅ hub 切换到限免游戏
   ✅ 限免页筛选按钮生效（平台+领取方式）
   ✅ 限免游戏卡片渲染（MOCK 回放限免源）
   ✅ hub 无 console error
3. 内容脚本注入（默认禁用状态浮窗，v3.3.15）
   ✅ 状态浮窗默认禁用（不渲染）
   ✅ 无 console error
   3b. 开启状态浮窗后内容脚本注入
   ✅ 开启后状态浮窗渲染
   ✅ 列表页好评率流程已启动（徽章渲染）
   ✅ 无 console error
   3c. 扩展更新自检（版本变化 → toast 提示）
   ✅ 旧版本记录 → 更新提示条出现
   ✅ 版本一致 → 不再提示
4. 详情页报错按钮（真实点击/录制回放）
   ✅ 浮窗报错按钮存在
   ✅ 浮窗显示主内容区游戏（非侧边推荐）
   ✅ 报错重检索流程完成（手动选择或纠正渲染）
   ✅ 报错流程无 console error
5. 滚动批次与 dashboard 趋势图
   ✅ 滚动触发第二批徽章（按需扫描）
   ✅ dashboard 趋势图 SVG 渲染
   ✅ 趋势统计显示浏览数据
6. 重启持久化（保存 → 关闭浏览器 → 同一 profile 重启）
   ✅ 重启后过滤设置持久化（写盘成功）
7. 自定义站点内容脚本动态注册
   ✅ 自定义站点脚本已注册（gr-site-localhost）

===== E2E 冒烟结果 =====
46 通过, 0 失败
✅ E2E 冒烟（MOCK 离线） 通过

===== visual（视觉回归） =====

> game-recommender@10.3.0 visual
> node tests/visual-regression.mjs

视觉回归：扩展 v10.3.0
✅ steam-popup 与基线一致（差异 0.000%）
✅ steam-popup-expanded 与基线一致（差异 0.000%）
✅ steam-options 与基线一致（差异 0.000%）
✅ steam-options-filters 与基线一致（差异 0.000%）
✅ ios17-options 与基线一致（差异 0.000%）
✅ ios17-options-filters 与基线一致（差异 0.000%）
✅ cyberpunk-options 与基线一致（差异 0.000%）
✅ cyberpunk-options-filters 与基线一致（差异 0.000%）
✅ morandi-options 与基线一致（差异 0.000%）
✅ morandi-options-filters 与基线一致（差异 0.000%）
✅ steam-dashboard 与基线一致（差异 0.000%）

===== 视觉回归结果 =====
11 通过, 0 失败
✅ visual（视觉回归） 通过

✅ 全部门禁通过（gate passed）（check + E2E MOCK + visual 一条命令）/ ；
发布流程在 AGENTS.md 固化为 4 步清单

- **平台调研**：新增 平台调研与迭代方案-2026-08.md（官方文档/工具调研——SW 生命周期
  新行为已对齐、userScripts/browser namespace 评估、CWS 上架窗口、P1-P3 迭代建议；2026-09-12 迁入 docs/reports/）

689 test（+6 settings-sync）· gate 全过 · 其余门禁同 v10.3.0

### v10.3.0（设置页全量审计：功能独立开关 + 计算参数可调 + 关断路径加固）

对全部功能做开关/可调项盘点：新增 **6 个独立开关**、**3 个可调计算参数**、**1 个徽章开关**，并逐项验证"关闭后不影响其他功能、显示与运算无异常"。

**新增独立开关**（设置页「常规 → 内容功能开关」+ popup 快捷开关，均可独立关闭）：

- 推荐值计算（关闭后列表页不再请求推荐，评分流程不受影响）
- 下载追踪（网盘点击/复制 → 下载计数 a）
- 下载/浏览统计 a-b（关闭后不计数、徽章无数据不渲染、推荐信号回中性）
- 二维码转链接（不注入观察器、不加载解码器）
- XDGAME 列表布局定制（不应用样式、不注入面板）
- 限免通知推送（限免页与角标不受影响）

**新增可调计算参数**（设置页「推荐」面板，a-b 权重滑块下方）：

- a-b 同站去重窗口（小时，0 = 关闭去重每次都计数；默认 24）
- 下载计数 a 的对数饱和封顶（默认 100）
- 打开计数 b 的对数饱和封顶（默认 100）

**徽章开关补齐**：a-b 徽章纳入 badgeVisibility（badgeAppstat，options + popup）——关闭仅不渲染徽章与绿标题，统计与推荐计算不受影响。

**运算加固**：推荐分 clamp 到 [0,1]——未下载惩罚（负分量）此前可把推荐值推成负数（徽章显示异常）。

**架构修复（设置页审计过程中发现）**：

- 批量好评率任务**按 tab 队列化**：此前单一 in-flight 守卫在多标签页并发时整只丢弃后到任务（对应页面徽章永不渲染）——跨 tab 并发、同 tab 串行，永不丢弃
- **404 ≠ API 失败**（v9.7.0 回归修复）：storesearch 对"搜索无结果"返回 404 被计入失败率，大列表页空结果密集时误判限流（anomaly）→ 30s/批拖垮检索；现仅 429/503/5xx/网络错误计失败
- E2E 3b/滚动节轮询加长（真实网络模式 Bing 兜底链路可超 30s）+ 3b 失败现场 runtimeLog 诊断转储

679→684 test · E2E 46/46（MOCK 多轮 + 真实网络）· visual 11/11（新开关基线更新）· lint 0 · typecheck 0

### v10.2.0（四项需求：xdgame 布局定制 / a-b 计数去重 / 二维码转链接 / AI 协作优化）

- **XDGAME 列表布局自定义**（独立油猴脚本移植进扩展）：新内容模块 `content/list/xdgrid.js`——每行图标数（1-12）、图标宽度（固定/自适应压缩双模式）、封面高度（0=原始比例 92:43）、卡片间距；悬浮齿轮 + 设置面板；设置持久化 chrome.storage.local；模块内按域名早退（其他站零开销）
- **a-b 计数去重**：同一 appId 在**同一站点** 24h 内重复下载/重复打开详情页不再重复计数；**跨站点分别计数**（xdgame 打开 b+1，再开 xianyudanji 的 b 再 +1；下载同理）——条目新增 dlSites/viewSites 每站去重表（LRU 24 站），站点键来自事件 domain（未识别站用 domain 独立去重）
- **二维码转链接**：gamer520 等站以二维码提供网盘链接——新模块 `content/detail/qr-unlock.js` 自动解码页面上的二维码图片（vendored qrcode-reader v1.0.0，Apache-2.0，ESM 包装 lib/vendor/qrcode-reader.js，按需懒加载）并渲染可点击链接 + 一键复制；方形比例启发式过滤（跳过封面/横幅）、每元素仅试解一次、MutationObserver 兜底动态渲染；解码器加载失败才停用模块（画布污染仅跳过单元素）
- **AI 协作 token 优化**：新增仓库级 `AGENTS.md`（浓缩架构铁律/命令/发布流程——AI 助手优先读它而非 141KB README）；项目记忆压缩为状态+教训索引
- 工程配套：lib/vendor 豁免 eslint/prettier/typecheck（压缩产物惯例）；E2E popup 权重滑块断言 6→8（v10.1.0 遗漏同步）

679 test · E2E 46/46（MOCK 三连 + 真实网络）· visual 11/11 · lint 0 · typecheck 0

### v10.1.0（AppID 行为统计：a-b 徽章 + 推荐信号 + 权重可调）

列表页每个游戏链接新增 **"a-b" 徽章**（a = 跨站点下载次数，b = 详情页打开次数），并作为新信号参与推荐值计算。

- **数据层**：新增 appStats 存储模块（OPFS，按 appId 聚合，**永不过期**、不参与 TTL 清理；上限 20000 条按最近活跃淘汰）——不同下载站的下载/详情页打开自动聚合到同一 appId
- **计数接线**：详情页打开（TRACK_DOWNLOAD_SITE_VISIT，先于站点识别——未识别站点/自定义站同样计数）→ b+1；下载点击（TRACK_EVENT click_download，详情页解析出 appId 后经 DOM 数据桥接随事件上报）→ a+1；无 appId 场景（列表页直接点网盘）不计数
- **推荐信号**（appStatScores 纯函数）：a>0 → 正向（对数饱和 a=100 封顶），**b 不参与**；a=0 且 b>0 → 负向（只看不下，b 越大越不推荐，b=100 封顶）；a=b=0 → 中性。负向惩罚不参与权重和归一
- **徽章**：有下载（a>0）绿色、只看不下（a=0 且 b>0）橙色 + tooltip 说明；**a=0 且 b>0 时游戏标题变绿**（.gr-title-green）
- **权重可调**：设置页/popup 新增"下载计数 a"与"未下载惩罚 b"两个权重滑块（八项权重默认和 1.0：原六项微调腾出空间）
- **数据管理**：appStats 纳入模块清单/导出导入/默认备份子集/清除学习数据；统计变化即时推进 dataVersion（缓存面板推荐值缓存即时失效）
- 测试 +8：appStatScores 三分支/加权排序、appStats 递增聚合/重置、click_download 计数接线、content-sim 徽章与绿标题断言（FakeEl classList 升级为真实跟踪）

676 test · E2E 46/46（MOCK+真实网络）· visual 11/11 · lint 0 · typecheck 0

### v10.0.0（大版本：迭代路线全落地——技术债清偿 / MV3 根治 / 产品化）

按 v9.7.0 后制定的迭代路线三阶段全量实施。

**技术债清偿（v9.8 计划项）**：

- tsconfig.ui.json 重复 exclude 键修复（content 双检查根治）；旧 storage.local 迁移残留键一次性清理（迁移成功后 remove，消除内容侧回退链读到陈旧 adapterRules 的隐患）
- 移除 window.open 死代码（隔离世界覆盖对站点自身 JS 无效，下载路径由点击委托/copy 捕获覆盖）
- GET_RECOMMENDATIONS 循环 per-game try/catch（单个畸形画像不再炸整批推荐）
- 诊断数据持久化：API 监控窗口/出站审计环形缓冲/站点告警限频表迁入 chrome.storage.session（新增 background/core/session-persist.js 防抖辅助）——SW 冷启动后限流检测与审计连续
- 覆盖率 63.96%→66%+（+21 测试：data-modules 接线/site-scripts 动态注册/历史记录/行为偏好/健康模块）；handlers.js 覆盖归因伪影定位（原生加载逃逸插桩，真实覆盖远高于读数）——已记录 CONTRIBUTING，修复留专项

**MV3 生命周期根治 + 可观测性（v9.9 计划项）**：

- **批量好评率任务可恢复化**：任务状态经批次边界检查点到 chrome.storage.session，SW 被 Chrome 110+ 的 5 分钟硬上限杀死后由 alarm（每分钟）唤醒新实例从最后边界续跑（done 推送不再丢失）；回归测试覆盖连续任务守卫复位（E2E 滚动节抓出的真实 bug：startRatingJob 未复位 jobRunning，第二批请求被静默丢弃）
- 站点适配器健康模块（background/storage/site-health.js，OPFS 持久化）+ dashboard 健康看板卡片与明细列表——站点改版从"静默失效"变"主动可见"
- 存储健康指标（flush 写失败计数 + OPFS/降级模式态，session 持久化）+ dashboard 卡片
- 写放大实测（scripts/measure-write-amplification.mjs）：满负载单批落盘 ≈1MB，60 游戏会话总写量 1-6MB 可接受——保留每批落盘设计，缓存规模 5-10 倍增长时再做增量优化

**产品化（v10.0 计划项）**：

- 规则包生态：导入侧格式化升级 normalizeImportedRules（旧包 displayName 回填 + version 戳记）、逐站诊断 diagnoseAdapterRules（缺 displayName/过宽正则+fallbackLinks 组合等 warn/info）、规则面板"🩺 健康自检"按钮（配置诊断 × 运行时改版告警逐站展示）、保存后诊断反馈
- 推荐反馈信号：aggregateFeedback 纯函数（dislike 闭环聚合）+ dashboard"🎯 推荐反馈信号"区块（负反馈总量/top 负反馈/top 下载）
- 上架材料：PRIVACY.md 更新（session 存储/ITAD/Bing/新权限说明）、STORE.md 提交状态清单（CWS 开发者账号注册为用户操作项）

**质量门禁**：668 test · E2E 46/46（MOCK 与真实网络双模式）· visual 11/11（dashboard 新卡片基线更新）· lint 0 · typecheck 0 · npm audit 0 · 覆盖率门禁通过

### v9.7.0（全项目自检修复：8 P1 + 20 P2 + 5 P3）

编码模型切换（DeepSeek V4 Flash → GLM-5.3）后的全面自检与修复；完整清单见 `docs/reports/自检报告-2026-08-27.md`。自动化基线 640 test · E2E 46/46 · lint 0 · typecheck 0。

**P1 严重（8 项全部修复）**：

- 删除缓存条目不落盘：registry 删除路径未置 dirty → SW 重启后删除"复活"（新增 deleteGameRegistryEntry 显式置位）
- 手动纠错映射永不保存：SAVE_MANUAL_MAPPING 主路径漏发 gameName 被契约拒绝（detail-page 补发）
- 重置设置 UI 恒报失败：RESET_SETTINGS 响应缺 settings 字段 + 旧 DOM 值可覆盖回默认值；DELETE_ADAPTER_RULES 同类响应混用（统一响应结构 + 补失败反馈分支）
- 适配规则存储分裂：后台写 OPFS、内容脚本读 storage.local 且无镜像——用户导入规则在内容侧永不生效（loadSiteRules 改走 GET_ADAPTER_RULES 消息 + 两级兼容回退）
- 站点推断硬编码 3/6 站：3DM/游侠/游民与自定义站点的下载网址缓存写入全被丢弃（download-sites 按规则 domains 动态推断 + 内置静态兜底；history.js 补全 6 站）
- displayName XSS：下载站面板站点名 / SteamSpy owners 未转义直拼 innerHTML（补 esc；appId 链接 href 统一 escapeAttr）
- URL 索引击穿报错自愈：URL 命中无名称校验 + 报错不清 URL 索引 → 错配永久固化（命中加 namesRelated 校验不相关即清除绑定；报错 handler 接收 sender 清除当前页绑定）
- 通知点击 30 秒后必失效：lastNotifyGames 纯内存（持久化到 chrome.storage.session，getLastNotifyGames 改 async）

**P2 中危（21 项）**：api-monitor 传入 HTTP status（非 2xx 不计成功，429/503 限流可感知）；三处 flush 写失败回滚 dirty 并重试；OPFS 写失败降级前移除旧文件（防两后端脑裂）；removeModule 补 init + 进写队列（清缓存不被在途写复活）；清理过期缓存前先 flushAllCaches；画像/历史/日志 flush 读-改-写加串行锁；refreshFreeGames in-flight 复用；initStorage 与自动恢复串行化（恢复链路被 SW 杀死后可重试）；ITAD 校验补 host permission + 401/403 凭证失效告警；deepMergeSettings null 绕过修复；getAdapter 改规则 domains 匹配（自定义站点适配器可选中）；adapter 补 key 属性（站点失效告警从死代码变可用）；每批落盘（keepAlive 在 Chrome 110+ 失效时损失限单批）；gamer520/咸鱼单机详情正则收窄（含数字的一级路径）；migrate.js 链断开防护 + 迁移函数返回非法数据保留原状；showStatus 参数错位修复；限免日期回退转义；缓存表 colspan 统一；filterRules 转义统一 escapeAttr；网络故障期跳过负缓存固化（窗口内有 API 失败记录时不写 2h 负缓存）。

**P3**：预取改后台分离任务（sendResponse 不再被占住数分钟）；批次观察器重建前断开旧实例；详情模板 appId 链接转义；dashboard reviewSummary 转义（防御未来字段填充）。

### v9.6.0（五项用户需求）

- appid 检索按 type 筛选（DLC/音乐集在存在游戏候选时剔除）；详情页评分区改 Steam 风格条形；数值滑块 + 输入框双向绑定（修复 type="gr-range" 组件化误改）；自动离线备份 + 首次启动优先加载（restoreLatestIfFresh）；dashboard 趋势图渐变/统计卡 hover 美化

### v9.5.0（P2 体验与扩展：批次 C）

- detail 样式迁移收尾（30+ 处行内样式类化，主题变量全量跟随）；UI 单测 +11（freegames 过滤抽纯函数 shared/freegames-filter.js / 串行保存队列 / parseLlmMatchResponse）；E2E fixture 扩充限免源（Epic/GOG/GamerPower）46/46；备份瘦身（默认高价值核心子集，缓存/日志可重建排除）；host_permissions 清理残留域；dashboard 数据管理入口指引收敛

### v9.4.0（P1 架构治理：批次 B）

- 打破 debug↔status-bar 循环依赖（回调注入）；规则新增 displayName 字段消除硬编码站点映射（自定义站点显示名生效）；串行链路并发化（标签推荐条目并发 / 下载站站点间并发）；options 去 8 个 adapters 脚本注入；质量护栏（tsconfig 覆盖补齐 / prettier devDep / 悬空测试条目清理）；storage.local 直操作清理（统一 dataStore.removeModule）

### v9.3.0（P0 数据安全与正确性：批次 A）

- flushAllCaches 聚合落盘补齐（url-index/wrong-reports/learned-noise/logger 纳入，SW 休眠防抖窗口不丢数据；顺带修复 resetUrlIndex 清除后"复活"）；8 文件 55 处裸 sendMessage 全量接入 **GR_MSG** 超时封装；host_permissions 子域修复（www 通配）；站点规则失效告警（提取 0 上报 + 24h 限频落盘）

### v9.2.1（修复：搜索布局 / 限免筛选 / 分级分页）

- popup 搜索框：输入框最大化 + 图标按钮；限免页筛选失效根治（组件化批量替换误改类名——E2E 回归）
- dashboard 分级分页：统计卡分行为/缓存/诊断三组；游戏记录/运行日志/出站审计统一分页（20-50 条/页）

### v9.2.0（20 套差异化主题皮肤 + 布局/带鱼屏优化）

- **20 套主题**（themes.css 全量重写，每套含中文风格说明）：Steam 旧客户端深色工业（默认）/ Vista Aero 玻璃 / iOS6 拟物 / iOS17 扁平 / XP Luna / Win11 云母 Mica / 赛博朋克终端 / macOS Aqua 水晶 / 新拟态软 UI / 90 年代远古网页 / Material You / GTK2 / 蒸汽波 / OLED 纯黑 / 日式和风 / 复古 CRT / Metro 初代扁平 / 莫兰迪 / 哥特羊皮纸 / 北欧原木
- **雷同清理**：win31/95/98 合并清理（netscape 覆盖）、win7→vista、win10→ios17/nordic
- 布局变量（控件高度/间距/字体）主题差异化 + **带鱼屏适配**（≥2000px / 21:9 双列面板、全宽利用）

### v9.1.0（成本搁置方案落地）

- E2E 由 Edge 改为 Chrome（Chrome for Testing 默认 + CI 系统 Chrome）
- 运行时性能基线：SW 启动/内容 boot 耗时落盘 Perf 日志（可脚本分析）+ dashboard 诊断卡
- 设置页搜索框；内容侧类型化全量（tsconfig.content 覆盖 content/**）；visual 交互态基线

### v9.0.0（演进方案全落地）

- content-sim 偶发根治（boot 等待 + 微任务 flush + 20s 余量——10 连跑 0 失败）
- 内容侧类型强化（MODULES typedef + 严格检查）、统一消息层（超时兜底）
- 存储迁移框架、registry/url-index 规模治理、浮窗拖动、发布打包脚本

### v8.1.0（UI 全面重构）

- 设计系统统一（gr-* 组件全量替换）、popup 9→6 分组、options 日志面板内聚
- 内容侧类化（浮窗/徽章/详情）+ 浮窗主题跟随

### v8.0.0（用户体验九项 + 网站范围注入）

- 内容脚本按网站范围注入（自定义站点动态注册）；欢迎页/通知点击/右键菜单/快捷键/搜索/过滤恢复/色盲符号

### v7.1.0（中版本：可观测性与提质增效——报告 v2 方案 P0-P2 全部落地）

- **P0-1 缓存命中率分模块仪表**：getCacheStats 扩展 meta/rating/detail/spy 四模块命中/未命中计数（getSteamCacheEntry 支持 moduleKey），dashboard 新增四模块命中率卡片（hover 显示查询数与 TTL 建议）
- **P0-2 ITAD 凭证卫生**：配置记录创建时间；测试 401/403 时提示"Key 已失效，建议轮换"；后台校验失败日志升 warn
- **P0-3 测试耗时度量**：`npm run test:timed`（scripts/test-timing.mjs）解析 vitest 耗时构成并记录趋势（基线 14.3s，import 占 61%）
- **P1-1 dashboard 自助诊断**：Steam API 限流状态卡（异常/采样中/正常 + 失败率）、网址索引规模、名称负缓存条数、运行日志级别统计
- **P1-2 缓存面板建议刷新**："♻️ 刷新本页过期"按钮（任一信息类型过期即批量刷新，≤10 条/次）+ 信息缓存列 hover 显示 TTL 建议
- **P1-3 测试提速**：新增 `npm run test:changed`（改动相关套件快路径）；**分片实测无收益**（unit 0.64s + integration 13.2s ≈ 全量 14.3s——瓶颈是 content-sim 模块加载，不落地，结论记录 CONTRIBUTING）
- **P1-4 核心契约类型单源**：MessagePayload 精确化（urls/cacheOnly/entries 等字段）+ ratings-batch/download-sites handler 参数标注
- **P1-5 限免源核验**：Amazon Prime / Ubisoft 均需登录无公开 API——**不实施**（核验结论记录）
- **P2-1 正则收敛**：已在 v7.0.2/7.0.3 完成（URL 索引 + 直取优先），无需额外改动；**P2-3 性能预算文档化**（CONTRIBUTING「性能基线」章节：内存换延迟原则/基线数字/分片与限免核验结论）
- **质量**：vitest 593 test（+2）· lint 0 · typecheck 0 · E2E 38/38 · coverage:gate ✅

### v7.0.7（全方位规则优化：本地钩子门禁 + CI 加固 + 安全防线 + 半自动发布）

- **G1 pre-push 门禁**：push 前自动跑 `npm run check`（lint + typecheck + vitest，check 脚本补 typecheck）——坏提交本地拦截，CI 不再首当其冲
- **G2+E1 pre-commit 升级**：暂存 .js/.mjs 三层校验——语法（node --check）+ **eslint** + **prettier --check**（实测即抓出 scripts 格式问题）
- **S1 依赖审计**：`npm run audit`（--audit-level=high）实测 0 漏洞；**S2 Secret 扫描**：CI security job 集成 **gitleaks**（密钥/Token 防泄漏）
- **T1 覆盖率门槛入 CI**：coverage:gate 接入 test job；脚本增加 **HEAD~1 回退**（浅克隆场景不静默跳过）；**T2 CI E2E 改离线模式**（E2E_FAST——真实 Steam 网络段不可控曾致 CI 偶发红；本地仍全量）
- **R1 半自动发布**：`node scripts/release.mjs [版本号]`——版本互比校验 → 门禁全验 → bump → **CHANGELOG 草稿自动生成**（conventional 类型分组）→ commit/tag/push（交互确认）→ release 草稿——**Mimosa seal 流程保留**（脚本提示人工补入）
- **E3 CONTRIBUTING 更新**：新增「工程护栏」章节（钩子/审计/CI/发布脚本用法）
- **质量**：vitest 591 · lint 0 · typecheck 0 · E2E 38/38 · audit 0 · coverage:gate ✅

### v7.0.6（测试体系精简：套件合并 19→15 + eslint 规则去重 + 输出去噪）

- **套件合并**：`test-settings-utils` / `test-url-index` / `test-backups` 并入 **test-storage**（存储层统一套件）；`test-ai-fallback` 并入 **test-handlers**（消息链路统一套件）——测试数不变（591），文件数 19 → 15
- **eslint 规则精简**：tests 专用块 globals 与主块完全重复——去重（块保留仅作测试文件风格豁免）；`eslint .` 全量 0
- **输出去噪**：批量移除测试文件 109 行 `console.log` 节标题（测试名已自解释），vitest 输出更清爽
- **质量**：vitest 591 test / 15 套件 · lint 0（全量）· typecheck 0 · E2E 38/38 · coverage:gate ✅

### v7.0.5（报告建议落地：hub lint 收口 + content-sim 竞态根治 + 推荐可解释 + ReDoS 校验 + 自定义主题 + 覆盖率门槛）

- **A1 hub lint 收口**：eslint 补 `history` 浏览器全局声明（此前误报），hub/ 纳入 lint 扫描目录——`eslint .` 全量 0
- **B2 content-sim 加载竞态根治**：loadModules 全量失败重试 3 次（50ms 退避）——根治全量并行下偶发的 `GR.listBatch` null（此前多次偶发）
- **B3 推荐引擎可解释**：列表页推荐徽章悬停显示**六信号全量明细**（点击率/下载率/关键词/Steam/游玩时长/热度 + 归一化说明）；顺带修正旧 title 字段名错误（keywordMatch/steamRating → keywordScore/steamScore，此前显示 0%）
- **B4 正则 ReDoS 校验**：适配规则导入新增 `hasReDoSRisk` 启发式（嵌套量词 `(a+)+`、交替分组带量词 `(a|b)+`、超长正则拒绝）——防导入规则灾难性回溯（含编译校验已有）
- **C5 核验**：GOG 官方限免源**已存在**（v6.3.3 GOG 官方 ajax + 三类区分）——不重复投入
- **C6 自定义主题 CSS**：设置页可导入本地 .css 覆盖任意主题变量（--gr-bg/--gr-accent 等），即时生效 + 清除；popup/dashboard/freegames 同步应用
- **C7 覆盖率门槛**：`npm run coverage:gate`——对相对 origin/main 的**新增业务文件**跑覆盖率，行覆盖 < 50% 拒绝（防新增代码无测试上线）
- **质量**：vitest 591 test（+7 ReDoS）· lint 0（全量）· typecheck 0 · E2E 38/38 · coverage:gate ✅

### v7.0.4（本地响应提速——内存换延迟：存储预热 + 内存缓存 + 聚合缓存）

- **存储内存预热**：SW 启动时并行加载全部本地存储到内存（steam-cache / 名称索引 / 注册表 / 纠正知识库 / 噪声词 / 网址索引 / 行为数据 / 下载站网址）——**首个列表页/详情页查询零磁盘等待**（失败自动回退惰性加载）
- **行为数据内存化**：行为日志/游戏画像/关键词权重**不再每次读盘**（此前推荐计算、统计每次 readModule）；写操作同步内存缓存（追加后重新读盘保证一致）；`dataVersion` 版本号驱动下游缓存失效
- **下载站网址缓存内存化**：Steam 页缓存优先展示/列表页推送不再每次读盘（读-改-写锁内同一引用，读写一致）
- **统计/趋势聚合缓存**：dashboard/popup 频繁查询不再重复遍历全量行为日志（数据版本未变直接复用，含日/周粒度）
- **推荐值计算缓存**：缓存管理列表按「appId + 数据版本 + 最后确认时间」缓存评分（2000 条上限）——翻页/重复查询不重算
- **修复**：addBehaviorLog 追加后内存缓存同步（直接 push 会漏掉 appendModule 序列化结果——dashboard 趋势图数据缺失回归被 E2E 抓回）
- **质量**：vitest 584 test · lint 0 · typecheck 0 · E2E 38/38

### v7.0.3（检索顺序统一「网址 → 直取 → 标题 → 搜索引擎」+ Steam 页缓存优先展示）

- **检索顺序统一**：详情页直取路径（GET_STEAM_BY_APPID）也接入**网址索引第一候选**——封面提取的 appId 与网址索引不一致时以网址索引为准（URL 优先于直取）；manual（用户手动选择）仍优先于一切；直取匹配成功同样回写网址索引。**完整顺序：网址索引 → 封面直取 → 标题搜索 → 变体 → 搜索引擎（Bing）→ LLM**（列表页阶段 0 已是网址优先）
- **Steam 商品页缓存优先展示**：一个 appId 对应多个下载站不同网址——打开 Steam 商品页时**先按 appId 查缓存并立即展示**各下载站已收录网址（`SEARCH_DOWNLOAD_SITES` 新增 `cacheOnly` 模式，只查缓存不发起站内搜索），再异步站内搜索补充更新
- **单测 +3**：直取路径网址索引优先 / manual 优先于索引 / cacheOnly 多站缓存命中（gamer520 + xdgame 不同网址）
- **质量**：vitest 584 test · lint 0 · typecheck 0 · E2E 38/38

### v7.0.2（详情页网址索引——列表页/详情页统一匹配，网址为检索第一候选）

- **问题**：109515.html 在列表页与详情页对应不同 appid——两条匹配路径独立（列表页标题搜索 + 封面直取 vs 详情页标题搜索），同一网址结果可能分歧
- **修复**：新增**详情页网址 → appId 索引**（`urlAppIdIndex` 存储模块，防抖落盘）——**网址作为检索第一候选**：任一侧匹配成功后记录 URL → appId，另一侧查询时先按网址命中（不再重新标题搜索），彻底统一两条路径
- **接入点**：①详情页 SEARCH_STEAM——按当前页 URL 先查索引，命中直接用该 appId 获取详情（跳过标题搜索），匹配成功后回写 URL → appId；②列表页 GET_STEAM_RATINGS——批次消息新增 `urls`（name → 详情页网址），阶段 0 按 URL 索引命中后直接以该 appId 查缓存/拉取；③列表页 RECORD_DOWNLOAD_URLS_BATCH——匹配成功即写入 URL → appId
- **URL 规范化**：去 hash/query（同一页面同参数变体共享一条记录）
- **新数据模块**：urlAppIdIndex（可备份/导入/导出/清除，DATA_MODULES 注册）
- **单测 +8**：url-index 模块（set/get/规范化/覆盖/reset）+ handlers 链路（SEARCH_STEAM 网址命中不触发搜索 / GET_STEAM_RATINGS urls 直取缓存 / 未命中回退标题搜索）
- **质量**：vitest 581 test · lint 0 · typecheck 0 · E2E 38/38

### v7.0.1（俗称序号匹配支持——官方名无序号 vs 互联网习惯加序号）

- **场景**：封面直取 appId 正确（3764200）但日志显示"与页面标题不相关"被拒（旧版本 Build 噪声 bug，v6.4.17 已修）；用户指出更深语义：**官方名无系列序号（Resident Evil Requiem）而互联网习惯加（生化危机9）**
- **搜索路径俗称序号支持（四层）**：①**去数字变体**——含数字的搜索变体追加去数字版（"生化危机9"→"生化危机"）；②**数字间隔（digitGap）跨语言容忍**——"生化危机9"搜索词后跟数字不再拒绝无数字英文候选（同语言仍拒绝防旧作）；③**变体校验英文例外**——纯英文结果名的中文"其他核心词"跨语言不可比（中文无关结果名仍拒绝，如 Jrago III 夜之安魂曲）；④**候选打分例外**——中文标题含数字 + 英文候选无数字 → 最低 1 分可被采用；**数字一致性改为数字集合交集**（9 vs 4 不同数字不得分）
- **实测**：搜索路径（mock 真实候选序列）直接命中 3764200——无需 Bing/LLM 兜底
- **单测 +7**：俗称序号全场景（digitGap 容忍/同语言拒绝/英文例外/无关结果拒绝/打分/搜索链路）
- **质量**：vitest 573 test · lint 0 · typecheck 0 · E2E 38/38

### v7.0.0（大版本：皮肤系统 + 数据模型重构 + 8 项设置体系升级）

- **① 好评率过滤文案优化**：明确"保留条件/下限"语义（与/或/非/混合四种组合的保留含义逐一说明），消除歧义
- **② 关键词过滤改为纯规则体系**：不再内置任何规则（虚拟机等默认规则移除），全部以规则列表逐条存在（每条：关键词 + 排除误报词）；三处 UI 同步
- **③ 日志查看增强**：显示时间/级别/模块/消息，新增级别筛选 + 关键词搜索
- **④ 皮肤系统（替代独立 Vista 界面）**：menu-vista 移除，改为**可选皮肤**——Steam 深蓝（默认）/ Vista Aero / Win3.1 / Win95 / Win98 / WinXP / Win7 / Win8 Metro / Win10 扁平 / Win11 圆角 共 10 套；CSS 变量主题化（styles/themes.css），各页面 body[data-theme] 切换，设置页即时预览
- **⑤ ITAD 多套配置**：可添加多套 API Key（名称 + 脱敏显示）、切换激活、删除、测试激活项；限免校验使用激活配置（旧单 Key 兼容）
- **⑥ 站点按用途分类管理**：游戏平台（Steam/Epic/GOG/GamerPower）/ 下载站 / 辅助站（Bing 搜索兜底）分组，每条独立开关；关闭的源不再调用其接口；下载站规则编辑器 + 导入导出保留
- **⑦ 缓存管理细化**：Steam 缓存按信息类型（基础/好评率/详情/热度）统计条数与过期数，每条目显示各类型缓存新鲜度标签；TTL 建议在"缓存有效期"设置中展示
- **⑧ Steam API 获取模块开关**：meta（基础）/ rating（好评率）/ detail（详情页信息）/ spy（SteamSpy）独立开关 + 独立缓存 TTL；关闭的模块不调用其接口（缓存数据仍展示）
- **质量**：vitest 566 test · lint 0 · typecheck 0 · E2E 38/38（皮肤切换/保存/生效断言）

### v6.4.18（过滤新增"混合模式"：任一≥高值 或 双≥低值）

- **新过滤关系"混合"**（用户需求：30 天与总好评率**任一 ≥90% 或 双 ≥80% 保留，其余过滤隐藏**）：`ratingFilterMode` 新增 `hybrid` 值——**高值 = 两阈值的较大者（任一达到即保留），低值 = 较小者（两者都达到才保留）**；设置总阈值 90 / 30 天阈值 80 即实现"任一≥90 或 双≥80"；阈值 ≤0 的维度不参与（单阈值退化为该阈值过滤）
- **三处 UI 同步**：设置页过滤面板（含说明文案）/ Vista 菜单 / popup 均新增"混合"选项
- **单测 +7 断言**：用户场景全组合（任高/双低/单高/双不达/无阈值/单阈值退化）
- **质量**：vitest 566 test · lint 0 · typecheck 0 · E2E 42/42

### v6.4.17（搜索引擎兜底 + 直取校验修复——109515 端到端命中 3764200）

- **搜索引擎兜底**（用户要求）：规则匹配失败时用 **Bing 搜索"标题 steam"**，从结果页提取 `store.steampowered.com/app/{id}` 官方链接 → **appdetails 官方名校验 + 标题相关性校验**（防无关链接）→ 采用；成功缓存 7d / 失败 24h（独立 web: 缓存键，与 LLM 兜底互不阻断）；免费无需配置（manifest 新增 `cn.bing.com` host 权限，权限最小化单域）
- **修复直取路径误拒**（109515 真正根因）：标题带 **"Build.22898177"** 噪声——"build" 被算作英文词使标题判为"混合语言"，跨语言信任失效，**封面直取的正确 appid（3764200）被误拒**转标题搜索（中文索引无）→ 未找到。修复：词提取排除下载站噪声词（build/plus/full/crack/repack/update）——封面直取直接命中正确游戏
- **跨语言信任加数字冲突校验**：`namesRelated` 跨语言分支要求双方数字集合不冲突（"生化危机9" vs "Resident Evil 4" 系列旧作被拒；候选无数字放行）
- **兜底链**：规则匹配 → 搜索引擎兜底（Bing）→ AI/LLM 兜底（用户配置时）→ 全部失败显示"未找到"（可报错纠正入黑名单）
- **质量**：vitest 566 test · lint 0 · typecheck 0 · E2E 42/42；端到端实测 109515 浮窗显示 store.steampowered.com/app/3764200 ✅

### v6.4.16（appid 错配根治 + AI/LLM 匹配兜底——真实站点诊断驱动）

- **错配根因**（gamer520 109515"生化危机9 安魂曲"→ 错误匹配 Jrago III 4021140，正确应为 Resident Evil Requiem 3764200）：扩展组合搜索把标题删词成**通用词"安魂曲"**，storesearch 返回名字含"安魂曲"的无关游戏"Jrago III 夜之安魂曲"；`nameMatchesSearch` 只校验"结果名包含搜索词"、**不校验与完整标题相关** → 错配。实测 storesearch：中文索引无"生化危机 安魂曲"，英文"Resident Evil Requiem"正确返回 3764200
- **规则层修复（三层）**：①**跨语言信任收紧**——中文搜索词命中英文结果名不再无条件放行（schinese 搜索的中文词英文结果多为索引噪声），仅当标题含共同英文词才放行；②**删词变体校验** `nameMatchesSearchVariant`——变体搜索的结果名须与标题**其余核心词**有交集（拒"安魂曲"→"Jrago III 夜之安魂曲"）；③**多候选打分排序**——`matchCandidateScore` 按与完整标题的共同核心词评分（英文词权重更高），分数 0 不采用
- **AI/LLM 兜底**（用户要求）：规则匹配全部失败时，若配置了 LLM（useLLM + endpoint）——LLM 从标题提取 Steam 官方名 → **storesearch / appdetails 官方数据校验**（防幻觉）→ 命中才采用；成功缓存 7d、失败缓存 24h（防反复打 LLM）；**未配置 LLM 时显示"未找到"而非错误 appid**（错配比未找到更糟，可走报错纠正黑名单）。端到端实测（mock LLM）：109515 → 3764200 ✅
- **质量**：vitest 556 test（+8 名称匹配/打分 +11 AI 兜底解析/链路）· lint 0 · typecheck 0 · E2E 42/42

### v6.4.15（列表页好评率提速 + 失败固化可恢复——真实站点诊断驱动）

- **真实站点诊断**（xianyudanji.gg/pcdj、gamer520.com/pcplay 实测）：①xianyudanji 100 链接 ≈ 50 游戏，**25 秒只完成 24 个**（3 并发 + 中国网络下 Steam 请求挂起 5-15s）——后半部分长时间无徽章；②gamer520 首访 **16/44 显示 #appid**（好评率获取失败态），12 秒后恢复至 1 个——失败多为暂时性网络/限流
- **修复问题 1（后半部分无徽章）**：`ratings-batch.js` 批量并发**自适应提速**——正常 6 并发（原 3）/ 检测到 Steam 限流异常时降为 2 + 既有降速等待。实测 xianyudanji **25 秒游戏覆盖 24 → 48**（翻倍，50 游戏约 30 秒完成）
- **修复问题 2（大量 #appid 永久失败）**：失败固化（ratingFailCount ≥ 3）原为**永久停止重试**——限流/超时是暂时性的，固化导致游戏永远显示 #appid；改为**长冷却（1 小时）后重置重试**（`needsRatingRefetch` 新分支）；失败徽章提示文案同步为"稍后自动重试"
- **单测 +4**：失败固化长冷却分支（冷却内不重取 / 冷却过后恢复 / 高计数不永久固化）
- **质量**：vitest 535 test · lint 0 · typecheck 0 · E2E 42/42

### v6.4.14（重磅修复：数据持久化失效——v3.4.1 起所有模块写入从未真正落盘）

- **终极根因（三轮"过滤设置无法保存"排查）**：data-store 的原子写用 `move()` 把临时文件移动到目标——**实测 Edge/Chrome 的 `FileSystemHandle.move()` 对"目标已存在"的文件不替换**（源被移除、目标保留原内容）。v3.4.1 引入原子写以来，**所有模块（settings/缓存/注册表/备份等）的写入从未真正持久化**：保存后内存缓存更新"看似成功"，**浏览器重启后全部回退默认值**——设置、Steam 缓存、学习模型每次重启都丢
- **修复**：`_writeHandle` 改为**直接截断覆盖目标文件**（createWritable 默认截断；崩溃留下的半截文件由读取侧 corrupt 备份+重置机制兜底）；新增 **`.tmp` 数据救援**——目标文件缺失时自动尝试读取 `<name>.tmp` 中的有效数据并写回正确位置（历史 move bug 残留的数据可救回）
- **回归防护**：E2E 新增**第 6 节「重启持久化」**——保存设置 → 关闭浏览器 → 同一 profile 重启验证写盘（此前所有 E2E 断言都在同一会话内读内存缓存，永远无法暴露此类问题）
- **排查工具沉淀**：OPFS 目录 dump + move() 语义实验脚本（验证 API 真实行为而非文档假设）
- **质量**：vitest 531 test · lint 0 · typecheck 0 · E2E 42/42（含重启持久化）

### v6.4.13（小版本：修复设置页面板错位——多余 </div> 致面板逃逸容器）

- **修复设置页"过滤类设置页面错位"**：HTML 结构检查发现 panel-general（常规面板）日志查看区块后**多一个 `</div>`**——浏览器按 HTML5 解析时隐式闭合 section/main，**后续全部面板（过滤/推荐/网站/规则/缓存/日志）逃逸出 `.settings-shell` 布局容器**，失去 flex 布局与样式上下文（v6.4.8 引入日志在线查看时遗留）——删除多余闭合标签，7 个面板全部回归内容区
- **好评率过滤保存验证**（真实浏览器复现 8/9）：设置页与 popup 的好评率过滤开关/阈值保存与重开回显全部正常；写盘链路复核（OPFS 写失败自动降级 storage.local，再失败 UI 可见报错）无静默丢失
- **E2E +1 回归**：好评率过滤开关 + 阈值保存往返 + 重开回显断言（41/41）
- **质量**：vitest 531 test · lint 0 · typecheck 0 · E2E 41/41

### v6.4.12（小版本：保存链路加固——串行队列防竞态 + 失败可见 + 过滤保存回归）

- **真实浏览器复现验证**（playwright 六场景 14 项全过）：设置页过滤**全部**控件（总好评/30 天阈值/关系模式/重排/关键词/匹配模式/规则编辑器）经立即保存/自动保存/重开回显三条路径均持久化；popup/Vista 过滤保存往返正常
- **保存链路加固（三处 UI）**：popup/Vista/options 的保存改为**串行队列**——此前快速连续操作（连续开关多项）时并发 GET→SAVE 基于旧快照互相覆盖（"保存了但部分丢失"）；**保存失败可见**（popup 红色提示条 / Vista 状态栏 ✗ 保存失败 / options 保存状态支持错误态）；options"立即保存"改为 await 完成反馈（此前 fire-and-forget，点击后立即关页可能未送达）
- **E2E +2 回归**：过滤设置全量保存往返（阈值/关系/关键词）+ popup 快速连续 3 项修改全部保留
- **质量**：vitest 531 test · lint 0 · typecheck 0 · E2E 40/40

### v6.4.11（小版本触发完整发布：菜单一致性 + 全量覆盖 + 集中入口 + 过滤保存根治）

- **修复过滤设置无法保存（根因根治）**：① **options 保存收集漏读 4 个 DOM 字段**——30 天好评过滤开关/阈值、过滤关系（与/或/非）、按好评率重排（仅绑定事件触发保存，收集阶段从未读取，保存时被旧值覆盖）——补齐；② **Vista 菜单 savePatch 点号键 bug**——`Object.assign` 把 `'badgeVisibility.recent'`/`'llmConfig.*'` 拍平为字面量顶层键，嵌套设置永远写不进——新增 `shared/settings-utils.js`（deepSet/getByPath/applyPatch）三处 UI 共用
- **弹出菜单与设置页一致 + 全覆盖（#1）**：popup 重构为**全量快捷设置**（与设置页同键同名）——常规/好评率过滤（总+30天+关系+重排）/关键词过滤/推荐权重 6 项+LLM/徽章 4 项/自动备份/日志 5 项全部可调；底部"设置/分析"独立入口改为"🏠 设置中心"集中入口
- **设置页覆盖所有选项（#2）**：classic 设置页新增**自动备份**（开关/间隔/保留份数）与**日志条数上限**；Vista 菜单新增**行为记录上限**与**自动备份配置**（此前仅默认值生效、无 UI）
- **集中入口 Hub（#3）**：新建 `hub/` 设置中心——侧栏一键切换**设置（经典）/Vista 菜单/数据分析/限免游戏** 四个页面（iframe 内嵌 + hash 直达 + postMessage 面板联动）；各页面新增"🏠 中心"返回按钮；popup 底部统一经 hub 进入
- **连带修复**：options 规则列表首次加载补渲染（renderSettings 先于 __renderRules 定义）；6 处 `catch (e)` 未用变量 + 1 处 prefer-const（lint 门禁）
- **质量**：vitest 531 test（+9 settings-utils 深路径套件）· lint 0 · typecheck 0 · E2E 38/38（+30 天过滤保存往返 / Vista 徽章嵌套保存 / hub 切换断言）

### v6.4.10（小版本：四项 bug 修复——API 状态/重试机制/过滤/权重归一）

- **修复 Steam API 状态失效**：GET_API_STATUS handler 返回 `{status: {...}}` 嵌套而 popup 读顶层字段——永远显示"采样中"；扁平化返回修复（E2E +1 断言）
- **好评率失败重试机制**：缓存条目新增 `ratingFailCount`——获取失败 +1 / 成功归零；`needsRatingRefetch` 失败固化重试**上限 3 次**（页面刷新触发一次 + 冷却防连打，3 次后停止避免无限请求）
- **修复好评率过滤失效**：30 天过滤（enableRecentFilter）在 `positiveRate` 为 null 时被外层检查整块跳过——过滤判定独立于 positiveRate（任一过滤启用且任一评分有值即判定）
- **推荐权重超 1 归一化**：六项权重和 > 1 时按比例缩放（保证评分 0-100% 有意义；默认 1.0 不变）
- **content-sim 偶发根治**：推送处理错误不再静默（catch 可见）；vitest 串行化（content-sim 高负载与并行竞争）——20 次连跑 0 失败
- **质量**：vitest 522 test · lint 0 · typecheck 0 · E2E 28/28

### v6.4.9（小版本：全面审查修复——菜单一致性 + 交互覆盖）

- **全面审查**（大规模重构后）：基线 516 test + E2E 24/24 + typecheck/lint 全绿确认；代码审查新功能边界（filterRules 空列表兜底/ITAD 脱敏回显/日志空态）无缺陷
- **菜单一致性修复**：**Vista 菜单补齐"追踪站点管理"**（此前 options 有 trackedSites 管理、Vista 遗漏——添加/移除自定义站点 + 权限回收）；**popup 的"虚拟机版过滤"标签改为"关键词过滤"**（通用化语义同步）；规则列表标注"优先于简单关键词"
- **E2E 增强**：Vista 交互覆盖（规则添加编辑器行 / ITAD 保存测试按钮 / 日志查看渲染）——24 → 27
- **质量**：vitest 516 test · lint 0 · typecheck 0 · E2E 27/27

### v6.4.8（小版本：过滤保存修复 + 关键词规则列表 + 缓存/日志增强）

- **修复过滤设置无法保存**：`filterMatchMode` 渲染回显缺失（下拉每次打开显示默认值，保存时覆盖掉用户选择）——补回显（settings.js）
- **关键词过滤规则列表**（v6.4.7 单条升级）：`filterRules` 数组——**每条规则含排除误报词**（如 {keyword:'虚拟机', exclude:'非虚拟机'}：命中关键词且不命中排除词才过滤）；Vista/options 双菜单规则编辑器（添加/删除/失焦保存）；旧 filterKeywords 简单模式兜底
- **缓存管理增强**：列表条目 `downloadUrls` 每站含 **lastCalled（上次调用时间）**——options 表格按站显示"调用时间"、Vista 缓存列表显示好评率 + 按站网址 + 调用时间
- **日志在线查看**：Vista 日志面板 + options 日志面板新增查看区（GET_RUNTIME_LOGS 200 条 + 刷新 + 清空，级别着色）
- **质量**：vitest 516 test · lint 0 · typecheck 0 · E2E 24/24

### v6.4.7（小版本：通用关键词过滤（防误报）+ ITAD Key 保存/测试/脱敏）

- **通用关键词过滤**（旧"虚拟机版过滤"扩展）：`filterKeywords`（逗号分隔任意关键词，兼容旧 `vmFilterKeywords` 字段迁移）+ **防误报 `filterMatchMode`**：
  - `contains` 子串匹配（默认）
  - `exact` 整段匹配——关键词必须是标题完整分段/前缀/后缀（"虚拟机"命中"虚拟机版游戏"但不误伤"虚拟主机"）
- **ITAD API Key 增强**（Vista + options 双菜单）：**保存按钮**（显式保存）+ **测试按钮**（调 ITAD API 验证有效性——401/403=无效/200=有效）+ **脱敏显示**（保存后显示 `••••后4位`，聚焦清空重输；明文不持久显示）
- **测试稳定性根治**：content-sim 偶发失败根因定位——并发下 bootPromise 慢导致节 2 推送时消息监听未注册（推送丢失）——节 1 改为**轮询等待监听器就绪**；推荐徽章/批次请求等待全部 waitFor 化（10 次连跑稳定）
- **质量**：vitest 516 test（10 次连跑稳定）· lint 0 · typecheck 0 · E2E 24/24

### v6.4.6（小版本触发完整发布：Vista Aero 全新菜单 + 新老一键切换）

- **全新 Vista Aero 菜单** `menu-vista/`（零历史包袱独立实现）：Aero 毛玻璃（backdrop-filter）主窗口 + 光泽渐变按钮 + 蓝绿配色 + 高光边缘
- **不遗漏任何功能**（8 面板）：常规（启用/阈值/状态浮窗/调试/扫描上限/徽章×4/重排）、过滤（总+30天+与或非/虚拟机）、推荐（六项权重/AI 全参数/ITAD）、限免（列表/刷新/类型标记/领取）、缓存（TTL×7/缓存管理）、数据（导出/备份/导入/清空）、日志（全参数）、统计（概览/命中率/最近行为）
- **新老菜单一键切换**（双向）：新菜单标题栏"🎨 经典菜单"→ options；经典侧边栏"✨ 新菜单（Vista Aero）"→ menu-vista
- 全新 menu.js（保存前重读合并防快照覆盖）；E2E +3（Vista 渲染/全功能/无错误）
- **质量**：vitest 516 test 全过 · lint 0 · typecheck 0 · E2E 24/24

### v6.4.5（小版本：全 UI 重构——Steam 主页美术风格设计系统）

- **Steam 设计系统** `styles/ui-theme.css`：CSS 变量驱动（深蓝黑背景 #1b2838 / Steam 蓝强调 #66c0f4 / 渐变按钮 #588fe3→#2f6db3 / 卡片 #2a475e / 圆角阴影）+ 组件类（gr-btn/gr-card/gr-tag/gr-switch/gr-range/gr-input）
- **popup 重构**：渐变头部 + 统计卡片（蓝色辉光数字）+ Steam 滑块式开关 + 折叠区块 hover 高亮
- **freegames 重构**：Steam 商店风格横向游戏卡片（封面图 + 平台/类型标签 + 渐变领取按钮）+ 标签式平台筛选
- **dashboard 重构**：渐变横幅 + 数据卡片网格 + 表格行 hover 高亮
- **options 重构**：侧边栏"🔧 高级设置"分组（推荐/缓存/日志归高级）+ 全部设置参数 Steam 化（开关/滑块/输入/按钮）；**常见设置（常规/过滤/网站）直观易得，高级设置（权重/AI/TTL/缓存/日志）一键可达——一切参数可调**
- **兼容**：全部 DOM id 保留（E2E 21/21 验证）；UI 逻辑零改动，纯视觉层
- **质量**：vitest 516 test 全过 · lint 0 · typecheck 0 · E2E 21/21

### v6.4.4（小版本：四项功能——浮窗左侧 / 缓存合并 / 重排序 / 30 天过滤三态）

- **详情页浮窗改左侧**：Steam 信息浮窗从右上 → 左上（floats 新增 TOP_LEFT 分区；下载站面板仍在左下，互不遮挡）
- **缓存合并**：下载站网址缓存与"上次调用"合并——`recordDownloadUrl` 扩展 meta 参数（更新日期/版本/大小/网盘提取码），搜索命中后写入网址缓存条目（`lastCalled` 记录上次调用时间），detail 页二次展示免重抓
- **按好评率重排**（默认关闭）：`enableSortByRating` 设置项——列表页好评率获取完成后按 positiveRate 降序重排 DOM（无评分沉底；评分最高在前）
- **30 天好评率过滤 + 与/或/非关系**：新增 `enableRecentFilter`/`minRecentSteamRatingFilter` + `ratingFilterMode`（and=总与30天都达标 / or=任一达标 / not=仅看30天好评）；`ratingFilterPass` 纯函数导出
- **质量**：vitest 516 test（4 次连跑稳定）· lint 0 · typecheck 0 · E2E 21/21

### v6.4.3（小版本：缓存范围扩充——下载站搜索 / LLM 评分 / Steam 判定）

- **在线数据梳理与扩充**（此前 Steam 数据/限免已有缓存；本次补齐三处未缓存请求）：
  - **下载站搜索结果缓存**（新模块 `storage/search-cache.js`，24h TTL，LRU 200）：搜索是高频操作，此前每次逐站逐词重复请求——命中免请求；siteKeys 变更自动失效
  - **LLM 推荐评分缓存**（新模块 `storage/llm-cache.js`，7d TTL，LRU 300）：列表批量场景每游戏调用 LLM（慢且贵）——命中免计算
  - **Steam 官方判定缓存**（`determineSteamFreeType` 内存缓存，12h TTL）：通知去重，防重复 appdetails+商店页请求
- 新缓存纳入 DATA_MODULES（备份/导出/清除覆盖）+ OPFS MODULE_FILES + resetInMemoryCaches
- **质量**：vitest 515 test 全过 · lint 0 · typecheck 0

### v6.4.2（小版本：限免判定升级——Steam 官方接口区分喜加一 vs 免费周末）

- **determineSteamFreeType**（导出纯函数 + 通知路径接入）：Steam 官方 appdetails 判定 100% OFF 类型——
  - → **f2p**（永久免费，官方权威信号）
  - 原价>0 且现价 0 → **喜加一入库候选**（-100% 促销），**商店页按钮复核**（Play Now「立即游玩」→ 免费周末；Add to Cart → 喜加一）
  - 现价 0 无原价 → **weekend**（Play Now 模式保守处理）
  - 当前非免费 → null（数据过期）
- **通知过滤升级**：Steam 平台通知候选经官方判定——仅【喜加一入库】推送；免费周末/F2P 拦截（ITAD 确认免费 + 官方类型判定双重校验）
- **质量**：vitest 512 test 全过 · lint 0 · typecheck 0

### v6.4.1（小版本：popup/options 状态一致性修复 + options E2E 覆盖）

- **修复快照覆盖**：popup 的 8 处 SAVE_SETTINGS 由加载时快照改为**保存前重读最新设置**（saveSettingsPatch）——后台 saveSettings 替换缓存引用，popup 打开期间 options 的改动会被旧快照覆盖（双向编辑一致性）
- **E2E 增强**：新增 options 设置页冒烟（渲染/标题/无 console error）+ **popup↔options 双向状态一致性**（options 切 VM 过滤 → popup 一致；popup 回切 → options 一致）——E2E 16 → 21 项
- **质量**：vitest 506 test 全过 · lint 0 · typecheck 0 · E2E 21/21

### v6.4.0（中版本：正式更名 游戏雷达 Game Radar）

- **品牌更名**：Game Recommender → **游戏雷达 Game Radar**（111 个文件全库替换：扩展名/页面标题/启动日志/文件头注释）
- 命名结合功能特点：📡 下载站 Steam 好评率徽章（雷达扫描）· 🎯 行为学习智能推荐（雷达锁定）· 🎁 限免监控三类区分（雷达告警）
- GitHub 仓库名 game-recommender 保留（技术标识，不影响克隆/URL）
- **质量**：vitest 506 test 全过 · lint 0 · typecheck 0 · E2E 16/16

### v6.3.3（小版本：限免功能优化——三类区分 + 垃圾 key 过滤 + ITAD 二次校验）

- **限免数据源确认**：Epic 已直连官方接口（freeGamesPromotions，非第三方中转）；Steam/GOG 以 **GamerPower 为主源**（其 end_date 字段分类可靠）+ 官方源（featuredcategories / GOG ajax）补充
- **三类区分**（classifyFreeType 纯函数 + 页面标记）：✅ **limited 限时领取 100% OFF**（通知推送）· ⚠️ **weekend 免费周末**（标记，不推送）· ❌ **f2p 永久免费**（标记，不推送）——GOG 源按原价判定（basePrice=0 永久免费）
- **垃圾 key 活动过滤**：GamerPower 的 thirdparty（key 领取）活动不收录不推送
- **ITAD 二次校验**（可选 key，设置页配置）：Steam 限免通知候选经 isthereanydeal.com 确认当前免费（价格 0），防 GamerPower 数据过期误报；无 key/失败容错放行
- **决策关闭**：i18n / 跨设备云同步 / 跨端适配 / 规则市场——正式不做（记录至 CONTRIBUTING）
- **质量**：vitest 506 test 全过 · lint 0 · typecheck 0 · E2E 16/16

### v6.3.2（中版本：B/C 现代化——UI 类型化 + 可观测 + 限免通知 + 推荐反馈循环）

- **B1 UI 层类型化**：双 tsconfig（主 strict 全量 + tsconfig.ui.json UI 层 strictNullChecks 关闭——DOM 元素存在性由浏览器保证）；全局 d.ts（chrome/**OPTS**/**GR_PATTERNS**/escapeHtml 等 + DOM 宽松化）；**顺带修复 dashboard 真实拼写 bug**（`responsString` → `response.error`，ReferenceError 崩溃）
- **B3 可观测面板**：Steam 缓存命中率埋点（steam-cache hits/misses）+ GET_STATS 暴露 + dashboard 命中率卡片
- **C2 限免推送通知**：manifest `notifications` 权限 + refreshFreeGames 检测新限免聚合通知（防骚扰，+2 test）
- **C3 推荐反馈循环**：推荐徽章 ✕ 按钮 → TRACK_EVENT `dislike_game`（新契约 type）→ 画像 `disliked` 负信号 → 引擎评分归零（method: 'disliked'）；+4 test
- **C1 商店上架准备**：PRIVACY.md（数据全本地声明 + 权限/网络请求说明）+ STORE.md（资产清单/文案/流程）
- **B2 content-sim DOM 评估**：jsdom 迁移收益 < 成本（测试聚焦流程逻辑，FakeEl 工作正常）——决策保留 FakeEl，记录到 CONTRIBUTING
- **偶发根治**：content-sim 固定延时 → 轮询等待（waitFor，推送/批次异步链竞争消除；6 次连跑稳定）
- **质量**：vitest 500 test（6 次连跑稳定）· lint 0 · typecheck 0（双配置）· E2E 16/16

### v6.3.1（小版本：TS strict 全量开启 + 工程护栏）

- **TS strict 全量开启**（`strict: true`，191 → 0 错误）：background + data 全层 strict 编译期防线（null/undefined 类 bug 前置拦截）；修复过程中发现并规避两个回归：`e.message → String(e)`（catch unknown 安全化，仅日志层）、steam-cache `nextModules` 惰性初始化必须保持（类型标注用 optional 而非预初始化）、data-store 的 guard 会破坏 OPFS 不可用时的 storage.local 回退（改用类型断言）
- **A1 CI 补 typecheck 门禁**（此前类型回归 CI 不拦截）
- **A3 adapters 清单一致性断言**（manifest/SW/options.html 三处 + 目录实测防漂移，+2 test）
- **A4 typedef 补全**：MessagePayload 全字段（limit/force/keyword/tag/granularity/rules 等）、AppSettings 精确化（weights 六项/llmConfig/badgeVisibility/trackedSites/maxBehaviorLog）、新增 SteamSearchResult/GameResult/RecommendResult
- **质量**：vitest 496 test（3 次稳定）· lint 0 · typecheck 0（strict）· E2E 16/16

### v6.3.0（中版本：报告路线落地——契约 100% + 类型化全层 + 盲区补强 + 权限收窄）

- **消息契约化 100% 收尾**（52/52）：第四批补 9 个读类 action（GET_TRENDS 校验 granularity day|week）；"渐进式"标签摘除
- **类型化扩展**（core → background 全层）：tsc include 扩至 `background/**`，storage/steam/handlers/recommend 全层 checkJs；修复 engine.js JSDoc 错位绑定（steamspyScores 抢占 computeGameScore 的 JSDoc——JSDoc 必须紧贴函数）
- **测试盲区补强**：新增 test-backups.mjs（备份/恢复/密钥剔除/上限裁剪 6 项）+ test-freegames 主体（四源聚合/缓存判定/force/claim/协议白名单 5 项）+ content-sim 节 10（下载追踪：网盘识别 + window.open 拦截 1 项）；**494 test 全过（3 次稳定）**
- **权限最小化**：host_permissions 从全站收窄到 26 个内置功能域名（Steam API/下载站 9 域/限免源/本地 LLM）+ optional_host_permissions 兜底；options 添加自定义站点时按需请求权限（E2E 16/16 验证）
- **解析结构化收尾（C）**：supported_languages 兜底加 String() 防御（异常响应不再中断搜索链）+ 5 项解析健壮性测试（空 HTML/异常字段/官方字段降级）
- **SW 懒加载评估（结论：不可行）**：MV3 Service Worker 官方不支持动态 import()（仅静态 import，Chrome 文档明确）——E2E 实测懒加载后详情页/dashboard 响应失败，回滚维持静态 import；**冷启动优化需另寻路径（如模块合并）**
- **工程**：CONTRIBUTING.md 新增（架构心智模型/测试体系/代码约定/发布流程/安全基线）；依赖图命令修复（test-layers 并入 test-integrity，`node tests/integration/test-integrity.mjs --print`）
- **质量**：vitest 494 test（3 次稳定）· lint 0 · typecheck 0 · E2E 16/16

### v6.2.1（小版本：官方 API 优先 + 直取优先 + 缓存优先三项优化）

- **移除冗余 english storesearch**（api-search）：schinese 搜索对英文词同样有效，且英文名由 `fetchSteamFullDetailsByAppId` 的 appdetails(english) 官方直取覆盖（buildSteamResult.englishName）——此前每词并行 2 请求，english 结果仅用于被覆盖的英文名占位；**每新游戏搜索省 1 请求**（test-handlers 加防回归断言）
- **rating 模块 TTL 24h → 7 天**（constants 默认 + TTL_CONFIG）：好评率是周级稳定数据，24h 意味着用户每天浏览同一游戏就重新请求 appreviews；7 天大幅减少重复请求（test-rules-cleanup 过期数据同步为 8 天前）
- **移除 SteamDB 网页抓取**（api-supplement/api-assemble）：抓取仅产出展示链接（解析字段从未被消费），链接改模板拼接；每详情抓取省 1 个慢速网页请求（SteamDB 反爬频繁）；SteamSpy 保留（玩家人数/热度无官方替代，spy 模块 7 天缓存）
- **质量**：vitest 15 套件 465 test 全过 · lint 0 · typecheck 0 · E2E 16/16

### v6.2.0（中版本：全局审查落地——单 runner 全量统一 + 契约化收尾 + 接线层测试）

- **全局审查驱动**（2026-08-12）：对项目做全量审查（遗留标记/测试盲区/架构技术债三维扫描 + 实验验证），落地 P0+P1 全部项：
- **单 runner 全量统一**：content-sim 纳入 vitest——`__grImport` 注入（eval 代码里的动态 import() 在 vite-node vm 执行器无回调，字符串替换为全局 provider 后兼容）+ 65 项 check→expect 节级 test 化（11 节，跨节 DOM 变量提升文件级）；`run-tests.js`/`helpers/assert.mjs`（check 体系）退役，`test:sim`/`coverage:node` 删除；CI 只跑 `npm test`
- **测试隔离健康化**：`isolate: true` + 文件级并行（v6.1.1 结构化重写后各套件已自包含，验证 464 test 全过；消除跨文件 chrome mock 泄漏/防抖写竞态）
- **消息契约化收尾**（25 → 38 个）：13 个写/破坏性 action 全量入参校验（RESET_SETTINGS/CLEAR_DATA/CLEAR_GAME_CACHE/DELETE_GAME_CACHE_ENTRY/REFRESH_GAME_CACHE_ENTRY/CACHE_STEAM_PAGE/TRACK_DOWNLOAD_SITE_VISIT/SAVE_ADAPTER_RULES/REPORT_WRONG_APPID 等）
- **接线层测试**：新增 `tests/integration/test-handlers.mjs`（16 项）——mock chrome.storage + fetch 驱动真实 handleMessage 链路（SEARCH_STEAM 全流程/负缓存/REPORT_WRONG_APPID/SAVE_MANUAL_MAPPING/下载站记录/缓存删除/契约拒绝），覆盖 handlers/ 与 orchestrator.searchSteamGame 此前零测试盲区
- **顺带修复真实 bug**：`deleteNameIndexEntry` 只删精确 key、清理名变体残留——报错重检索会被旧映射干扰（test-handlers 集成测试发现，与 recordNameIndex 对称删除修复）
- **去重**：detail-page 第三份噪声词副本删除（content-sim 注入真实 shared/patterns.js 权威源）、评级色 bg fallback 统一 0.15
- **质量**：vitest 15 套件 464 test 全过（3 次稳定）· lint 0 · typecheck 0 · E2E 16/16

### v6.1.1（小版本：4 个状态敏感套件结构化重写，双体系合并）

- **根因定位**：此前"vitest 与 check 双体系"实为**检查点错位**而非实例分裂——check 线性脚本的顶层准备（reset/数据写入）在 vitest 收集阶段全部提前执行，断言延迟到运行阶段，读到的是全部准备完成后的最终状态（探针验证：单 test 场景实例一致，多检查点场景中间状态丢失）
- **结构化重写 4 套件**（api-pure/rules-cleanup/storage/outbound）：顶层状态准备移入各 test（自包含：准备→断言），共享对象原地修改（steam-cache 内存引用）改为 test 内重新获取，storage mock 残留用 `_reset()` 隔离——**断言点 484 与原 check 全量完全等价**（vitest 13 套件 414 test + content-sim 65 项）
- **双体系合并**：`run-tests.js` 注册表仅剩 content-sim；`test:node` 删除（语义并入 `test:sim`）；CI 改 `npm test` + `npm run test:sim`
- **质量**：vitest 13/13 · content-sim 65 项 · lint 0 · typecheck 0

### v6.1.0（中版本：防抖工厂全量迁移 + vitest 断言全量重写）

- **防抖工厂全量迁移**（v5.1.0 仅 wrong-reports/learned-noise 2 个）：steam-cache / registry / name-index / logger 4 个内联防抖块全部改用 `storage/debounced-store.js`（`scheduleWrite`/`flush`/`reset`），每模块删除自维护 timer 与复合 flush 主体；name-index 修复迁移中暴露的缺失 import 与残留 flush 主体
- **vitest 断言全量重写（check → describe/test/expect）**：13 个测试文件的 check/assertThrows/assertAsync 全部转为 vitest 原生断言（419+ 处，文件头引入 `import { test, expect } from 'vitest'`）：
  1. 9 个套件（title-parser/engine/contract/trends/freegames/sites/security + orchestrator/integrity）完成转换由 vitest 直接收集（**243 项**）
  2. **4 个线性状态敏感套件（api-pure/rules-cleanup/storage/outbound）回滚 check 体系**：其顶层线性脚本 + 模块级共享状态（审计缓冲/TTL 配置/模块状态）与 vite-node 的模块执行语义不兼容（顶层写入与 test 闭包读取不同实例，15 项失败无法归因修复）→ 由 `test:node`（node tests/run-tests.js）直跑，语义保持与原 run-tests 一致
  3. `tests/all.test.mjs` 聚合入口删除（import + include 双重收集冲突）；vitest.config include 显式列出 9 文件（排除 5 个 node 套件）【v6.1.1 起 include 为 13 文件全量，v6.2.0 起 14 文件】
- **工具链**：scripts 调整（`test:node` 新增、`test:legacy` 更名、coverage 切 vitest `--coverage` + `coverage:node` 保留 c8）；CI test job 改 `npm test` + `npm run test:node`（此前只跑 test:sim 会漏 4 套件）
- **质量**：484 项单测全过（vitest 243 + node 241，与原 check 全量一致）· lint 0 · typecheck 0 · 深度扫描 0 findings

### v6.0.0（大版本：内容脚本 ESM 化 + vitest runner）

- **内容脚本 ESM 化（动态 import 路径，零构建）**：
  1. **11 个内容模块转 ES module**（去 IIFE 壳 + `__GR__` 全局命名空间退场，模块间依赖由 ESM import 图显式表达）；两个循环依赖（list-page↔list-batch、status-bar↔debug）以调用期引用处理并注释标注
  2. **tracker.js 经典入口重写**：`ensureModules()` 动态 `import(chrome.runtime.getURL('content/...'))` 并行加载 11 模块（Chrome content_scripts 官方不支持原生 ESM——动态 import 是零构建唯一路径）；REQUIRED_KEYS 自检删除（import 失败自然抛错）
  3. **manifest**：content_scripts 裁剪为 shared×2 + adapters×8 + tracker.js；新增 `web_accessible_resources`（content/*.js）
  4. **content-sim 加载器重写**：模块无参动态 import + GR shim 兼容层（测试体 GR.* 引用零改动）+ getURL mock 共享实例；**关键教训**：带 `?t=` 的入口其静态依赖解析为无参 URL 导致实例分裂——必须全部无参导入
- **vitest runner 接入**：5. `npm i -D vitest` + vitest.config（pool forks）+ `tests/all.test.mjs` 聚合 13 套件（check 断言体系保留）；`npm test` = vitest run；`npm run test:sim`（content-sim 直跑——其 eval+动态 import 模拟与 vite-node 运行器不兼容，保持 node 直跑）；`test:legacy`（run-tests.js 全 14 套件）；CI 同步【v6.1.1 起 all.test.mjs 已删、check 全量转 vitest；v6.2.0 起 content-sim 亦纳入 vitest，run-tests.js/test:legacy 退役】
- **质量**：484 项单测全过（node legacy）· vitest 13/13 · E2E 16/16（真实浏览器验证动态 import + WAR）· lint 0 · typecheck 0 · 深度扫描 0 findings

### v5.1.0（中版本：拆分与工具链——用户决策的架构/工程类未做项落地）

- **detail 模板拆分**：detail-page.js 805 → 505 行，新 `GR.detailTemplates.steamSidebar`（纯 HTML 模板，依赖仅 GR.common；评级色顺带单源 **GR_PATTERNS**）
- **list-batch 拆分**：list-page.js 590 → 416 行，新 `GR.listBatch`（批次调度全套）；**状态容器 `GR.list._state`** 替代闭包捕获（ratingsJob/batchState 由 list-page 与 list-batch 共享），`GR.list._internal` 导出状态机函数；GR.list 尾部导出改合并展开（防覆盖 _state）
- **防抖工厂**：新 `storage/debounced-store.js`（scheduleWrite/flush/reset）；wrong-reports 与 learned-noise 已迁移（其余 steam-cache/registry/name-index/logger 因复合 flush 语义留待专项）
- **E2E_FAST 离线开关**：`E2E_FAST=1 npm run e2e` 跳过真实 Steam 网络段（详情页报错），CI/本地快速冒烟
- **prettier 全库格式化**：.prettierrc（2 空格/单引号/120 列）+ 一次性全库格式化（双源一致性提取正则健壮化支持跨行）
- **质量**：484 项单测 · E2E 16/16（E2E_FAST 10 项）· lint 0 · typecheck 0 · 深度扫描 0 findings

### v5.0.0（大版本：三大目录模块化重构 + 类型化基建）

- **background 拆分与解耦**：
  1. **handlers.js（960 行）按领域拆 5 子模块**（`background/handlers/`）：steam（搜索/直取/报错/自愈）、cache-manager（缓存管理 5 handler）、data-modules（导出/导入/备份）、stats（统计/趋势/推荐）、download-sites；handlers.js 保留核心 handler 与 MESSAGE_HANDLERS 聚合
  2. **steam/api.js（858 行）按职能拆 6 子块 + barrel**：api-search / api-details / api-reviews / api-supplement / api-assemble / api-registry-heal；api.js 保留为再导出（调用方与测试零改动）
  3. **去重收敛**：isPlainObject 统一至 core/utils（3 份重复）、flushAllCaches 聚合（6 处 flush 三连）、readProfiles/readKeywordWeights（4 处手写并行读）、orchestrator 缓存命中块抽 applyCacheHit（2 处逐字重复）
  4. **缺陷修复**：resetInMemoryCaches 补 behavior 偏好节流重置（此前导入/恢复后残留）；handleGetSteamRecommendations 内嵌裸 fetch 下沉 api-search
- **content 拆分与去重**：5. **list 徽章拆分为 `GR.badges` 模块**（content/list/badges.js，list-page 823 → 590 行）；prependBadge 的 settings 参数化（脱离 ratingsJob 闭包）；manifest 注入顺序 + tracker 完整性自检键同步 6. **颜色分级单源**：options.html 加载 shared/patterns.js + cache.js 改用 `__GR_PATTERNS__`（消除第 3 份内联色阶）7. **title 清洗链收敛**至 `GR.common.cleanPageTitle`（detail-page 与 tracker 逐字重复消除）
- **options 重构**：8. **TTL 字段单源** `OPTS.TTL_FIELDS`（绑定/保存/渲染三份 id 列表 → 1 份配置）
- **类型化基建（编译期，零运行时）**：9. 新增 `background/core/types.js`（SteamCacheEntry/MessagePayload/AppSettings/TrendBucket/AuditEntry @typedef）+ chrome 全局声明 10. `npm i -D typescript` + tsconfig.json（allowJs + **checkJs core/ 层**）+ `npm run typecheck`（tsc --noEmit 0 错误）
- **质量**：484 项单测 · E2E 16/16 · lint 0 problems · **tsc --noEmit 0 错误** · 深度扫描 0 findings
- **说明**：content 的批次调度（list-batch）与 detail 模板拆分因与闭包状态机/按钮绑定深度交织，留待后续专项（**已于 v5.1.0 完成拆分**：GR.list._state 状态容器 + listBatch/detailTemplates 模块）

### v4.2.0（中版本：测试体系重构）

- **重新排列组合（按领域分组）**：`tests/unit/`（纯函数单测，11 个套件）+ `tests/integration/`（内容脚本模拟/Steam 编排器/项目完整性，3 个套件）——原"名实不符"的 test-cleanup 拆分为 test-api-pure（Steam API 纯函数 93 项）与 test-rules-cleanup（规则与清理 38 项）；test-security 静态扫描节（TDZ/语法/manifest/双源）并入新 test-integrity；test-layers（5 项）与 test-wrong-reports（9 项）并入大套件（文件数 9 → 14，覆盖更清晰）
- **精简**：
  1. **版本断言去硬编码**：manifest 为唯一权威 + 与 package.json 互比（**发版不再需要改测试**）
  2. 修复 test-cleanup 的 `globalThis.chrome` 泄漏（try/finally 与统一 mock）
  3. test-contract §6 按 action 类别分节（6a 批量/6b 列表搜索/6c 日志限免备份）
- **新增测试项目（6 个新套件 +71 项断言）**：4. **test-trends**（18 项）：行为趋势 day/week 粒度、周一桶键、无效时间戳、转化率 5. **test-storage**（21 项）：wrong-reports 吸收 + learned-noise 阈值 3 + registry + behavior 500 上限 + **settings deepMerge 权重 backfill** 6. **test-freegames**（14 项）：限免平台门优先级 + 第三方来源识别（需导出 manager 纯函数）7. **test-sites**（10 项）：详情页元信息提取（fixture HTML 驱动，**顺带修复 gamer520 等站版本标签提取缺失**）8. **test-orchestrator**（10 项）：**两波好评率流程真实后台集成**（此前 content-sim 用 presets 绕过后台，orchestrator 零覆盖）——mock fetch + storage mock 驱动缓存命中/搜索/写缓存链路 9. **test-integrity**（16 项）：依赖分层 + TDZ + 语法 + manifest + 噪声双源
- **新工具与方式**：10. `helpers/storage-mock.mjs` / `helpers/fetch-mock.mjs`：统一 chrome.storage 与 Steam API fetch mock（消除 3 份重复）11. `assertThrows` / `assertAsync`：断言助手增强（消除内联 try/catch）12. **`--grep` 子集运行**：`node tests/run-tests.js --grep trends` 只跑匹配套件13. **覆盖率工具 c8**：`npm run coverage`（当前 67.45% 行覆盖，core 92%）
- **质量**：**484 项单测全过**（+71）· E2E 16/16 · lint 0 problems · 深度扫描 0 findings

### v4.1.2（小版本：测试 / lint / 扫描 / git 规则自动优化）

- **git 规则**：
  1. `.gitignore` 重写（原文件 GBK+BOM+混合 EOL 编码损坏，Read 工具无法解析）→ UTF-8 LF，新增忽略 `GameRecommender-*.html`（根目录报告附件）、`.tmp-*.mjs`、`coverage/`
  2. 新增 `.gitattributes`（`* text=auto eol=lf` + bat/ps1 保留 CRLF + 二进制标记）+ `git add --renormalize`——根治 LF/CRLF 警告（此前 system 级 autocrlf=true 叠加导致每次 add 噪音）
  3. 新增轻量 git 钩子 `.githooks/`（commit-msg 提交信息格式校验 + pre-commit 暂存 JS 语法检查）+ `npm run install-hooks` 一键安装（core.hooksPath，零依赖替代 husky/commitlint）
- **测试规则**：4. 失败明细可观测：`tests/helpers/assert.mjs` 收集 `failures`（名称/实际/期望），`run-tests.js` 失败时汇总输出前 10 条 + 每套件/总耗时 5. `package.json` 补 `engines: node >=18` + `npm run check`（lint + test 聚合入口）
- **CI 修复（此前 8 次全红）**：6. **致命缺陷**：test job 缺 `npm ci` 却跑 lint（无 eslint 必失败）→ 补上 7. setup-node 加 `cache: npm`；`concurrency` 取消组（重复推送自动取消旧运行）
- **lint 增强**：`no-unused-vars` warn → error；补 `eqeqeq(smart)` / `no-var` / `prefer-const`（顺带修 2 处 let）`/ no-extra-semi`；新增 `.editorconfig`（utf-8/lf/2 空格）；curly 因项目单行花括号风格混合未启用
- **扫描**：README 开发说明补"发布前深度扫描"流程（Mimosa seal 记录惯例）
- **质量**：413 项单测 · E2E 16/16 · lint 0 problems

### v4.1.1（小版本：版本后缀补搜修复）

- **修复**：`https://www.gamer520.com/40746.html` 等"增强版/重制版"标题无法正确检索新版 Steam 条目（如 GTA5 增强版 3240220）：
  - **根因**：① 页面 Steam 封面是旧版（40746 封面 271590 = GTA5 传承版），appId 直取命中旧版；② 该类游戏无官方中文名（3240220 索引为英文 "Grand Theft Auto V Enhanced"），中文标题"侠盗猎车手V"在 storesearch 中文索引 0 命中 → 搜索路径全部落空
  - **修复**：新增 `findVersionVariant(appId, title)`——标题含版本后缀词（增强版/重制版/复刻版/豪华版/终极版/年度版/典藏版/黄金版）且直取条目是旧版时，剥离旧版后缀（Legacy/Classic 等）后用"英文名 + 英文版本后缀"补搜（"Grand Theft Auto V" + " Enhanced" → 3240220）；结果须带版本标识（CN/EN 后缀任一）且与标题相关（跨语言信任）；`GET_STEAM_BY_APPID` 命中变体则整体走新版（缓存/注册表/名称索引全部按新版写入）
  - 覆盖场景：旧版封面 + 新版标题；已是新版标题（不重复搜）；无版本后缀（不触发）
- **质量**：新增 mock 单测 3 项 + 真实 API 端到端验证（271590 → 3240220）

### v4.1.0（中版本：全部优化建议落地）

- **性能三件套**：
  1. **推荐流联动滚动**：推荐请求并入批次调度（fireBatch 按批并发 GET_RECOMMENDATIONS），按 name 回填徽章（替代 index 对齐）——滚动批次自动获得推荐徽章/高亮；顺带修复 REFRESH 路径 appId 恒 null 缺陷；prependRecBadge 防重复
  2. **封面提取延迟化**：`extractSteamImageInfo` 从全量提取改为 fireBatch 内惰性提取（500 项列表首屏 DOM 扫描降 ~90%），评分与推荐共用 imageData
  3. **MutationObserver 增量提取**：新增 `GR.builder.findItemsInContainer`（容器级提取，item 结构与全量一致），新增节点不再整页重扫（大列表 O(n) → O(新增)）
- **工程三件套**：4. **eslint 完全清零**：删 4 个未使用 import + 50 处 catch 参数 → optional catch binding（`catch {`），`npm run lint` 0 problems（此前 54 warnings）5. **版本三源断言**：manifest / package.json / 测试断言三者一致（防发布手改遗漏）6. **测试框架统一**：9 个测试文件的重复 check()/计数器抽取为 `tests/helpers/assert.mjs`（createReporter），行为完全一致7. **依赖图自动生成**：`node tests/test-layers.mjs --print` 输出 Mermaid 分层图（含 data/lib 基础层），README 附图，静态断言 CI 拦截回归
- **安全两小项**：manifest 显式声明 CSP（与 MV3 默认一致，基线显式化）；LLM API Key 输入框旁加"仅本机存储、导出/备份/导入剔除"知情提示
- **功能扩展**：8. **详情页综合推荐理由**：浮窗评分区底部显示"综合推荐 X%（好评率 · 中文支持 · 热度 · 平均时长）"（与推荐引擎同源口径，零新调用）9. **趋势周聚合**：`aggregateTrends(log, 'week')`（周桶键=周一）；dashboard 日/周切换10. **出站审计增强**：主机筛选输入框 + 审计 CSV 导出（含筛选结果）11. **限免微软商店**：GamerPower 平台门新增 microsoft 关键字映射（此前 "Microsoft Store" 被丢弃）+ 筛选按钮；itch/Humble 已被 GamerPower 聚合覆盖不重复建设 12. **消息契约全量覆盖**：第二批 13 条规则（GET_RECOMMENDATIONS/GET_STEAM_RATINGS/PREFETCH_STEAM_RATINGS 数组校验、CLEAR_CACHE_FOR_PAGE、GET_GAME_CACHE_LIST 过滤字段、SEARCH_* 必填名、RECORD_DOWNLOAD_URLS_BATCH、limit 范围、moduleKeys 数组、force 布尔），全部 action 契约化完成
- **质量验证**：410 项单测全过（+35）· E2E 16/16（+3：滚动批次/dashboard 趋势）· **eslint 0 problems** · Mimosa 深度扫描 0 findings

### v4.0.0（大版本：按需扫描 + 可视化 + 契约化 + 信号增强）

- **R4 列表按需扫描**（性能）：
  1. 消除 2 处无上限扫描路径（builder 策略 3 fallbackLinks / 通用适配器全量 `a` 扫描，现受 `maxScanLinks` 上限约束）
  2. **批次调度器**：全部 item 提取后每批 60 个名字串行请求（每名字仅请求一次，后台循环无重叠），done 到达后自动衔接下一批
  3. **滚动调度**：IntersectionObserver 底部哨兵（提前 400px）+ MutationObserver 增量发现——无限滚动/分页加载的新增游戏自动入队并获取徽章（此前完全不处理）
  4. 45s 强制收尾随批次重置（最后一批 +45s），保持"不误标未找到"语义；推荐流保持首屏 60
- **R5 Dashboard 趋势可视化 + CSV**：5. 新 action `GET_TRENDS`（后台按天聚合浏览/下载/转化率，纯函数 `aggregateDailyTrends` 可单测）6. 新增「📈 行为趋势」区块：SVG 手绘双柱图 + 转化率折线（零依赖，深色主题）7. 三处 CSV 导出（趋势/游戏明细/行为日志全量），UTF-8 BOM 防 Excel 乱码
- **R6 消息契约化**（安全）：8. 新增 `background/core/message-contract.js` 纯函数校验器，9 个高风险 action 入参白名单：TRACK_EVENT（type 5 值白名单 + gameName 必填 + keywords 数组）、SEARCH_STEAM/REFRESH_STEAM_CACHE（gameName）、GET_STEAM_BY_APPID/SAVE_MANUAL_MAPPING（数字 appId）、CLAIM_FREE_GAME（gameId）、RESTORE/DELETE_BACKUP（backupId）、SAVE_SETTINGS（纯对象）；`handleMessage` 分发前统一校验，违规直接拒绝
- **R7 推荐信号增强**（SteamSpy 时长/热度）：9. `fetchSteamSpyInfo` 新增原始数值字段 `averageForeverMin`/`ownersLow`/`ownersHigh`（此前转成 "X小时"/区间串丢失数值；嵌套对象入 spy 模块，无缓存迁移，7 天 TTL 自动刷新）10. 引擎新增两分量：`playTimeScore`（平均分钟/600 封顶）、`heatScore`（owners 中点对数/7 封顶），缺数据中性 0.3；`steamspyScores` 纯函数可单测11. **权重重排**（六项和 1.0）：点击 0.15 / 下载 0.30 / 关键词 0.20 / 评分 0.15 / 时长 0.10 / 热度 0.10；设置页新增 2 个权重滑块（旧设置经 deepMerge 自动补默认值）；缓存管理页与详情页浮窗同步（详情页 SteamSpy 面板新增"热度"等级）
- **质量验证**：375 项单测全过（+47）· E2E 13/13 · eslint 0 errors
- **升级提示**：大版本建议先在设置页「数据管理」备份数据

### v3.4.1（小版本：报告建议甄别 + 工程与安全加固）

- **报告 7/8 章建议甄别**：对《项目进展与统计报告》24 条演进路线逐条核实（代码/CI/git 实测），确认 17 条准确、7 处不准确（如"chrome.storage 加密区"API 无此能力、LLM 本地化/规则 schema 校验已实现、内容脚本 ESM 化与 v3.3.9 决策矛盾等）；选择真实缺口路线落地（详见提交信息与下文）
- **R1 依赖分层单向校验**：
  1. `title-parser.js` 下沉 `steam/ → core/`（纯函数被 storage 层引用，修复分层违规①）；7 处引用同步
  2. `reset.js` 归位 `core/ → storage/`（聚合各存储模块重置属 storage 层编排，修复分层违规②）
  3. 新增 `tests/test-layers.mjs` 静态扫描全部 import，断言单向分层（core→storage→业务→handlers→入口），CI 拦截分层回归
- **R2 出站请求审计 + 全局限速**（SSRF 校验 v3.4.1 基线之上的安全补强）：4. 新增 `background/core/outbound-audit.js`：300 条环形审计缓冲（主机/耗时/状态/成败）+ 聚合统计 + 每主机 10s/100 次滑动窗口限速（可注入时钟可单测）5. `fetchWithTimeout`（唯一出站通道）全路径接入：成功/网络错误/被拦截/被限速均记录；超限抛 `rate-limited` 6. 新 action `GET_OUTBOUND_AUDIT`/`CLEAR_OUTBOUND_AUDIT`；dashboard 新增"出站请求审计"区块（失败高亮 + 聚合统计 + 清空）
- **R3 CI 补 E2E**：GitHub Actions 新增 `e2e` job（微软官方 apt 源安装 Edge + xvfb 跑非无头冒烟），PR/推送自动拦截浏览器端回归
- **质量验证**：328 项单测全过（+30：分层 5 + 审计 24 + 版本断言）· E2E 13/13 · eslint 0 errors

### v3.4.0（中版本：全面审查与优化）

- **全面审查结论**（技术/工程/安全双维度深度审查）：健康面——无循环依赖、GR 命名空间契约、SSRF/XSS/CSP 系统化、定时器无泄漏、存储模块化；发现并修复 **7 项真实缺陷 + 5 项工程优化**
- **真实缺陷修复**：
  1. **CI 跨平台修复**：测试文件硬编码 Windows 绝对路径 → `import.meta.url` 派生（Linux CI 此前必然失败）
  2. **导入/恢复后纠正知识库内存陈旧**：`resetWrongReports` 接入 `resetInMemoryCaches`；"清除学习数据"语义统一（同时删除 learnedNoise 存储）
  3. **noisePattern 第三副本漂移**：detail-page 降级副本移除（缺 25 词），统一经 `__GR_PATTERNS__` 权威源 + 断言扩展
  4. **名称索引正缓存无界增长**：新增 5000 条 LRU 上限（此前仅负缓存有清理）
  5. **预载下一页安全加固**：同源校验 + 15s 超时（此前可代发请求到任意地址）
  6. **API 密钥泄露面**：导出/备份默认剔除 `llmConfig.apiKey`/`steamApiKey`（备份文件流转不再泄露凭据）
  7. **转义统一**：detail-page 2 处属性值改 escapeAttr；dashboard 2 处补 escapeHtml
- **工程优化**：
  - **列表页 OPFS 写放大下降 ~80%**：批量拉取从每批 flush 3 次全量文件改为每 5 批一次（60 游戏 ≈ 12 次写入）
  - **handlers.js 拆块**（1054 行 → ~800 行）：批量好评率/预载抽为 `steam/ratings-batch.js`
  - 13 处调试 console.log → Logger；死常量 USER_PREFERENCES 清理；过期注释修正
  - 徽章分级色单源化（`__GR_PATTERNS__.ratingColorFor`，列表/详情/缓存页共用）
  - manifest 补 `minimum_chrome_version: "109"`
- 测试：新增路径跨平台/密钥剔除相关；全套 **276 项** + E2E 13/13 + eslint 0 errors

### v3.3.15

- **调试/状态浮窗默认禁用 + 开关**：
  - 根因：`dbg()` 日志的 `scheduleDebugUpdate` → `refreshInBar` → `showDebugView` **无条件显示"🔧 游戏雷达 Game Radar 调试"浮窗**——`showDebugPanel`/`showStatusBar` 开关都关不掉它
  - 修复：`showDebugView` 仅 **debugMode（showDebugPanel）开启**时显示；`showStatusBar` 默认改为 **false**（状态/诊断浮窗默认禁用）
  - **popup 新增"显示状态浮窗"开关**（调试窗口区，控制 showStatusBar）；设置页既有开关保留
- E2E：验证默认禁用（页面无调试浮窗）→ popup 开启后浮窗渲染；全套 **264 项** + E2E 13/13 通过

### v3.3.14

- **修复详情页误检索侧边推荐游戏**（16598 页右侧推荐 119428"轮回之兽"导致浮窗误检索 2001760）：
  - 根因：详情页 appId 提取扫描**全页面图片**——gamer520 侧边推荐的封面是 Steam CDN 图（含 /steam/apps/{id}/），被误当作当前游戏封面直取 appId
  - 修复双层：① appId 提取**限定主内容区**（article/.entry-content/.post-content/main 等），侧边栏/推荐区不再参与；② 后台 `GET_STEAM_BY_APPID` 加 **namesRelated 名称相关性校验**（缓存命中与新拉取都校验，页面标题与图片 appId 的游戏名不相关 → 拒绝并转标题搜索）；手动选择候选传 `manual: true` 跳过校验（用户主动确认）
- E2E：fixture 复刻侧边推荐场景（主区图 1213700 + 侧边图 2001760）——浮窗正确显示主内容区游戏；全套 **264 项** + E2E 11/11 通过

### v3.3.13

- **报错重检索记录（长期有效）+ 据此优化检索匹配**：
  - 新增 `wrongReports` 数据模块（独立持久化，不随缓存清理删除；可导出/备份）——用户点"报错"记录错误 appid，手动选择确认后记录正确 appid（count 累计）
  - **检索优化（人工纠正知识库）**：某标题曾确认正确 appid → 下次检索**纠正优先**（用户确认 > 自动匹配，自动清除该名负缓存）；曾报错的错误 appid 作为**黑名单在搜索结果中排除**（多词搜索逐词过滤）——长期积累自动改善匹配
  - 顺带修复：`learnedNoise` 模块漏注册 MODULE_FILES（此前 OPFS 下读写被静默丢弃）
- 测试：新增报错纠正记录测试文件（9 项：记录/纠正/合并/累计/持久化）；全套 **264 项**通过

### v3.3.12

- **改进报错按钮**：点击"信息有误？重新检索"后，若重新检索结果**仍是同一 appid**（自动纠正失败，如下载站标题本身与 Steam 搜索无稳定正确匹配）→ **自动进入手动选择面板**（不再重复显示同样的错误结果）；重检索纠正为不同 appid 时正常渲染新结果
- E2E 冒烟更新：报错点击后断言"手动选择面板或纠正渲染"流程完成 + 无 console error；全套 **255 项** + E2E 10/10 通过

### v3.3.11

- **下载站详情页浮窗新增"⚠️ 信息有误？重新检索"按钮**（人工纠错）：
  - 用户发现检索到的 Steam 游戏（appid）与实际不符时点击 → 后台清除**错误 appid** 的 Steam 缓存/名称索引（正/负缓存都删，防负缓存拦截重检索）/下载站网址映射（30 天错误映射一并清除，不删注册表）→ 浮窗自动重新检索并渲染正确游戏；仍失败进入手动选择面板
  - 与 v3.3.10 的 namesRelated 校验协同：自动校验推翻错误条目 + 人工报错主动触发
- 测试：内容脚本模拟详情页场景（+4 项）；E2E 冒烟新增真实点击报错按钮流程（扩展加载/SW/popup/列表注入/报错重检索 10 项全过）；全套 **255 项**通过

### v3.3.10

- **修复 1778840↔16598 双向检索错误**（实测根因：名称匹配丢数字 + 名称索引粘性）：
  - 错误 1（Steam 1778840 "Spirit of the North 2" 检索到 gamer520 16598 一代页）：`calcLinkMatchScore` 跨语言段匹配把搜索词 "spiritofthenorth**2**" 的续作数字丢掉 → 一代页 75 分误匹配 → 且当场写入 30 天缓存固化。修复：**数字保护**——搜索词段含数字而链接段不含 → 拒绝（与 nameMatchesSearch 续作防护同思路）；**低分（<80）结果不写缓存**（防脏数据固化）
  - 错误 2（16598 页误匹配 2001760"轮回之兽"）：直接匹配不可能（名称无共同词），为**名称索引粘性**（历史误写钉死 appId，缓存命中不再校验名称）。修复：新增 `namesRelated(title, cachedName)` 纯函数（CJK/英文共同词 + 单语言跨语言信任）——`searchSteamGame` 缓存命中前校验，不相关转重新搜索并覆盖名称索引（**粘性自愈**）
  - 附带：站点后缀（Switch520.com 等）加入噪声词表（双源同步），16598 标题清洗后保留干净候选 "Spirit of the North"/"北方之魂" → 正常匹配一代 1213700
- 测试：新增检索匹配修复用例（9 项）+ 站点后缀噪声（3 项）；全套 **250 项**通过

### v3.3.9

- **8 项隐患核实与优化**（逐项核实后按判定处理）：
  1. **常量单源**：噪声词表抽为 `shared/patterns.js` 唯一权威源（内容脚本引用 + 后台副本交叉注释 + **双源一致性测试**防漂移）；`shared/escape.js` 注入内容脚本，common.js 复用全局实现（单点维护）
  2. 内容脚本全局耦合：核实为 MV3 经典脚本标准模式（隔离 world 无冲突），**不做 ES Module 迁移**——替代：tracker.js 入口加**命名空间完整性自检**（缺失即报错指明加载顺序）
  3. **工程基础**：新增 `package.json`（npm test/e2e/lint）+ `eslint.config.js`——**eslint 立即抓到真实 bug**：api.js `scanAndHealRegistry` 用了未导入的 `getGameRegistry`（批量自愈 ReferenceError，已修复）；核心函数补 JSDoc 类型标注
  4. **parseUserTags 降级**：商店页被拦截时用官方 categories 兜底（"热门用户标签"区块不再消失）
  5. 站点选择器：核实多候选+三级回退已实现；通用适配器路径表提为常量 + **域名段匹配**（xdgame2.com 不再误配 xdgame）
  6. **链接扫描上限可配置**（`maxScanLinks`，默认 500，设置页可调），列表判定与回退提取共用
  7. **浏览器 E2E 冒烟**：`npm run e2e`（playwright-core 复用系统 Edge）——扩展加载/SW 启动/popup/内容脚本注入/列表页流程 7 项全过
  8. i18n 最小化：manifest `default_locale: zh_CN` + `_locales/`（name/description 走 `__MSG_*__`，Chrome 商店多语言受益）；UI 文案 6000+ 字符不迁移（中文站定位）
- 测试：新增噪声双源一致性（2 项）；全套 **241 项**通过；eslint 0 errors

### v3.3.8

- **列表页徽章独立开关**（设置页"徽章显示"区，默认全开）：近30天好评率/全部好评率/最近更新/推荐值各自开关；关闭不影响后台数据获取——关闭"全部好评率"同时**停用好评率过滤**，关闭"推荐值"同时**停用推荐高亮**（用户确认语义）
- **列表页徽章独立获取**：最近更新日期不再依赖详情页访问——`getSteamPositiveRate` 未命中时直接调 GetNewsForApp（api.steampowered.com 独立限流域，不影响商店 API 配额），写入缓存（detail 模块自动路由），列表页首次即显示
- **修复 Windrose 检索失败**（3041230，官方中文名 "Windrose: 风启之旅"）：根因是标题解析的英文子串贪婪匹配出 "Windrose:"（尾随冒号），下载站搜不到——`splitTitleSegments` 增加冒号分段 + 英文候选去尾随标点；实测 "Windrose" 首候选三站直接命中（xdgame 95 分/咸鱼 95 分/gamer520 85 分）
- **修复推荐值徽章顺序不固定**（gamer520）：`prependRecBadge` 原来只插到第一个好评率徽章后（三段式下顺序错乱），改为插入到最后一个徽章之后
- **Steam 商品页缓存预取**：浏览 store.steampowered.com/app/{id}/ 时后台预取该游戏完整数据并写缓存（detail 模块有效则跳过）+ 记录名称索引——回下载站列表页徽章/筛选立即有数据
- 测试：新增冒号分段（5 项）+ 徽章开关/过滤联动（12 项）；全套 **239 项**通过

### v3.3.7

- **Steam 缓存模块化（字段分组 + 独立 TTL + 按需部分刷新）**：
  - 缓存条目改为 `{ modules: { meta, rating, detail, spy } }` 结构，**每个模块独立有效期、独立刷新**——好评率（24h）/详情页信息（72h）/SteamSpy 补充数据（7 天，新增设置）/基础信息（30 天，新增设置），设置页缓存面板均可调（0=长期）
  - 字段归属由 `FIELD_MODULES` 映射表决定——**未来增删字段只需改一行映射**，未知新字段默认进 detail 模块
  - **字段调整不再使整体缓存失效**：废除全局版本号强制失效；旧平铺结构缓存加载时自动迁移为模块结构继续使用；缺失/过期的模块在后续使用中按自身 TTL 自动重新获取（部分刷新），其他模块保留——如好评率 24h 过期只刷新好评率，详情页缓存（72h）与 SteamSpy（7 天）不受影响
  - 读取方全部按模块判定：列表页两波（rating 模块）、详情页（detail 模块 + 完整性）、预载/缓存管理页/推荐引擎（合并视图）；清理仅删除所有模块均过期的条目
- 测试：模块化用例改写与新增（isModuleValid 独立过期/字段归属路由/部分更新保留/旧结构迁移/清理语义）；全套 **228 项**通过

### v3.3.6

- **列表页好评率徽章改为三段式**（依次显示）：
  1. **近 30 天好评率**（浅蓝，悬停显示评论数；无近期评测 → 灰 `—`）
  2. **全部好评率**（原有分级色，悬停显示评论数 + 评价等级，可点击跳转 Steam）
  3. **最近更新日期**（灰 `MM-DD`，悬停显示发行日期；未获取时 → `—`，访问详情页后自动补全）
- **详情页浮窗增强**：
  - 发行日期后显示**最近更新日期**（Steam 无此官方字段，用最新公告日期近似，GetNewsForApp 免费无 key）
  - Steam 总体评价下新增 **"🕒 最近 30 天"** 行（好评率 + 条数）
  - **SteamDB 好评率换成 SteamSpy 数据**（好评率/评测数/当前在线 ccu/拥有者/平均时长；SteamDB 链接保留；SteamSpy 被拦截时显示降级提示）；修复 SteamSpy 字段（实测无 players_2weeks/players_forever，改用 ccu/owners）
- **缓存机制同步**：近 30 天好评率随同一 appreviews 请求获取（filter=recent 评测数组统计，纯函数 `summarizeRecentReviews`）写入缓存；STEAM_CACHE_VERSION 5→6（旧缓存自动失效）；lastUpdate 由详情页全量拉取写入、列表页经缓存合并自动补全（列表页保持请求预算防限流）
- 测试：新增近30天评测统计用例（6 项）+ 三段式徽章断言（9 项）；全套 **215 项**通过

### v3.3.5

- **弹出菜单新增"♻️ 强制刷新"按钮**（刷新当前页并忽视缓存有效期）：
  - 点击后：内容脚本收集当前页全部游戏引用（详情页：游戏名 + 封面 appId；列表页：全部游戏名 + 封面 appId）→ 后台清除对应 Steam 缓存条目与名称索引（**含负缓存**，防止"未找到"记录拦截重新获取）→ 页面重载后全部重新从 Steam 获取（**绕过缓存 TTL 与 0 评测冷却**）
  - 适用场景：好评率/详情显示异常、怀疑缓存过期或固化错误数据时一键全量刷新
  - 新增 `deleteNameIndexEntry`（无条件删除指定名字的正/负缓存条目）、`CLEAR_CACHE_FOR_PAGE` 后台消息
- 测试：新增 FORCE_REFRESH_PAGE 内容脚本消息模拟用例（5 项）；全套 **201 项**通过

### v3.3.4

- **修复详情页"获取详情失败，请重试"（根因：appdetails 字段名不兼容）**：
  - 实测链路：66096（苏丹的游戏 3117820）/57106（刀剑江湖路 2361680）详情页自动匹配失败 → 手动选择正确候选项 → 点击仍"获取详情失败"
  - 根因：`baseAppIdFromDetails` 读取 `data.appid`，但**真实 appdetails 响应的 ID 字段是 `steam_appid`**（v3.2.6 加入校验以来从未兼容）→ type=game/demo 永远解析为 null → `fetchSteamFullDetailsByAppId` 的"非本体无法解析"分支必然触发返回 null → **所有新游戏详情页完整拉取 100% 失败**（只有 v3.2.5 前写入的旧完整缓存能命中显示）；v3.3.3 将列表页轻量缓存命中改为转完整拉取后问题全面暴露
  - 修复：`baseAppIdFromDetails` 兼容 `data.appid || data.steam_appid`（game 保留自身/demo 优先解析本体/DLC 解析 fullgame 本体不变）
  - 实测验证：3117820 → OK（苏丹的游戏，type=game，10 标签，中文支持）；2361680 → OK（刀剑江湖路 72%）；DLC 4145470 → 自动解析本体 3613270（星际采矿公司）
- 测试：新增真实 appdetails 结构用例（5 项：game/demo/独立 demo/dlc/bundle 的 steam_appid 形态）；全套 **196 项**通过

### v3.3.3

- **详情页 Steam 信息缓存命中机制改进**（列表页打开详情页直接用缓存，秒开）：
  - 新增 `isCompleteCacheData` 完整性判定：详情页渲染需要的关键字段（链接/类型/标签/中文支持/发行日期/开发商/简介/封面）齐全才可命中缓存——修复 `SEARCH_STEAM` 回退路径命中列表页轻量缓存导致详情页缺字段渲染残缺的 bug（缺 genres/标签/中文支持/开发商/描述等 19 个字段）
  - `GET_STEAM_BY_APPID` 路径补上 TTL 检查（此前过期缓存也命中）
  - **新增独立设置"详情页 Steam 缓存"有效期**（默认 72 小时，0 = 长期）：详情页两条路径用独立 TTL，列表页好评率缓存保持原 steamDynamic（24h）的新鲜度；设置页缓存面板可调（1 小时 ~ 365 天）
  - 缓存过期清理按两个 TTL 中更长者判定（详情页缓存周期更长，未到期条目保留）
  - 行为：打开过的详情页在设定时间内再次打开直接渲染缓存（零网络请求）；过期或轻量缓存自动转完整拉取
- 测试：新增详情页缓存完整性/独立 TTL/带参缓存有效性用例（12 项）；全套 **191 项**通过

### v3.3.2

- **修复 xianyudanji 列表页大量游戏无好评率（后台批量拉取被 SW 休眠中断）**：
  - 根因（实测验证）：Steam 侧完全正常（50 游戏端到端模拟 49 成功、20 并发 120 请求零限流），问题在**后台批量循环**——MV3 Service Worker 空闲 30 秒即休眠，而中国网络下 Steam 请求常挂起 5-15 秒，5 游戏 × 4 请求的一批在等待 fetch 期间无扩展 API 活动，超过 30 秒即被休眠 → fire-and-forget 批量循环中断 → 剩余游戏永远 pending → 列表页大量游戏无好评率
  - **SW 保活**：批量循环（列表页补拉 + 下一页预载）每 10 秒调用 `chrome.runtime.getPlatformInfo()` 重置空闲计时器，批内 fetch 挂起不再导致 SW 休眠
  - **失败重试**：批内网络失败/限流的游戏自动进入重试队列（最多一轮），单次抖动不再丢失
  - **请求量削减**：appId 校验按需执行——缓存已有 type（此前已校验解析）或游戏名不疑似附属内容时跳过网络校验（省 1 请求/游戏，批量请求量减 ~20%）；0 评测路径英文名可复用时不再并行请求英文详情
  - **限流退避增强**：异常时批次间隔 1.5s → 5s，连续异常暂停 30s 等窗口恢复；批大小 5→3
  - **冷却 10 → 5 分钟**：0 评测游戏更快反映"后来有了评测"
- 测试：全套 **179 项**通过

### v3.3.1

- **修复 xianyudanji 列表页大部分游戏只显示 AppID 无好评率**（缓存机制改进）：
  - 根因：缓存命中判定只对"失败固化"（好评率与描述均空）重新获取，**0 评测或旧数据无好评率的缓存条目直接命中**，一直显示灰 AppID（含新游戏评测增长后仍被旧缓存挡住）
  - 改进 `needsRatingRefetch`：缓存**无好评率**（0 评测/失败固化/旧数据）时重新获取一次——失败固化立即重试；已确认 0 评测的按**冷却期 10 分钟**重试（写缓存时记录 `ratingRetriedAt`，防止每次刷新列表页都请求 Steam 加剧限流，同时保证"刷新列表页能重新获取一次好评率"）；三条缓存命中路径（列表页两波/详情页）统一生效，旧固化数据一次刷新即恢复
- 测试：新增 needsRatingRefetch 用例（6 项：有好评率/失败固化/冷却内/冷却外/无缓存/无记录）；全套 **179 项**通过

### v3.3.0（中版本：第 10 次小迭代触发）

- **Steam API 状态监测与异常提醒**（解决"appid 缓存好评率失败"的限流根源）：
  - 新增 `core/api-monitor.js`：滑动窗口（近 5 分钟）统计 Steam API 调用——成功/失败/限流状态码（429/503），失败率 >40% 且采样 ≥8 次判定**异常/限流状态**；网络异常与限流分开统计
  - 监测接入：商店搜索（中/英）、应用详情、评测汇总等全部 Steam API 调用点记录
  - **自动降速**：列表页批量补拉时检测到异常状态自动拉大批次间隔（+1.5s），避免加剧限流
  - **弹窗提醒**：新增"📡 Steam API 状态"区——状态灯（绿=正常/黄=采样中/红=异常）+ 详情（调用数/失败率/限流次数），异常时给出建议（自动降速已生效、稍后重试）
- 测试：新增 API 监测用例（5 项：空窗口/正常/高频失败判定/小样本不误报/限流码统计）；全套 **173 项**通过

### v3.2.10

- **修复 gamer520 119439（杀死影子）列表页未获好评率、详情页误中 Demo**：
  - 实测根因：列表页封面与详情页首图均为 **Demo 封面（2947640）**，appId 直取提取到 Demo appid；而本体解析规则未处理 demo 类型的 `fullgame`（demo 页面同样携带所属本体，如"杀死影子 Demo"→ 2660230）→ 列表页取 Demo 好评率（少/0，显示 AppID）、详情页显示"杀死影子 Demo"
  - 修复：`baseAppIdFromDetails` 增加 **demo 规则**——demo 含 fullgame 时解析本体（无 fullgame 的独立 Demo 保留自身）；`fetchSteamFullDetailsByAppId` 校验统一走 `baseAppIdFromDetails`（dlc/demo 自动切本体，bundle 等无效）
  - **列表页与详情页一致性**：两页共用同一本体解析函数——封面/截图提取到 dlc/demo appid 时自动解析到本体，列表页好评率（219 条"特别好评"）、详情页信息、下载站检索全部基于同一 appId（2660230）；名称索引/注册表/缓存均写本体，跨页数据同源自愈
- 测试：本体解析 demo 规则更新（demo+fullgame→本体、独立 demo 保留）；全套 **168 项**通过

### v3.2.9

- **修复大量 appid 缓存后只显示 AppID（好评率不展示）**：根因是批量检索时 Steam appreviews API 失败（网络/限流）把 `positiveRate: null` **写入缓存固化**，此后一直显示灰 AppID。修复：`fetchReviewSummary` 网络失败重试一次；获取失败**不写缓存**并返回 `failed` 标记（徽章提示"获取失败，下次访问自动重试"）；新增 `isFailedRatingEntry` 检测（好评率与描述均空的缓存条目视为失败固化，三条缓存命中路径均不命中、自动重新获取）——已固化的旧数据下次访问自动自愈
- **列表页缓存 appId 的 type 处理规则完善**（Steam 全 type）：
  - `game`/`demo` → 正常缓存与展示（demo 由名称词表另行判定）
  - `dlc` → 经 `fullgame` 自动解析本体 appId（game）后缓存
  - `bundle`/`mod`/`music`/`soundtrack`/`video`/`software`/`hardware` 等非本体且无法解析 → 返回 type 值（徽章紫色显示 type，不写下载站网址缓存）
- **缓存信息保存 type 并支持管理页筛选**：Steam 缓存与游戏注册表均持久化 `type` 字段（详情/列表/命中补写三路径写入，旧数据访问时自动补齐）；缓存管理页新增"类型"列（game 蓝/dlc 橙/bundle 紫/其他灰）与类型下拉筛选（game/dlc/demo/bundle/music/mod/video 等）
- 测试：本体解析覆盖全 type（+5）、失败固化检测（+4）；全套 **167 项**通过

### v3.2.8

- **修复推荐值全相同**（根因：推荐计算未使用任何游戏特征——列表页请求 keywords 恒为空、点击/下载率用全站统计，每个游戏得分相同）。重构为 **appId 维度个性化概率预测**：
  - 信号（每个 appId 一个值，预测"点开详情并下载"的概率）：**行为信号**（该游戏详情打开/下载次数占全站最高活跃度比例，归一化）＋ **标签匹配**（注册表 Steam 官方标签 vs 用户偏好关键词权重）＋ **好评率 70% + 中文支持 30%**；设置页算法权重（点击率/下载率/关键词/Steam）仍然生效
  - 数据聚合：列表页请求携带封面 appId 直取；后台按 appId 查注册表（tags）与 Steam 缓存（好评率/中文），行为画像支持精确名/清洗名/注册表变体/规范化模糊匹配（兼容记录名与列表标题格式差异）
  - **缓存管理页新增"推荐值"列**：每个 AppID 显示 🎯 推荐值（分级着色，与列表页一致），悬停显示各分值组成；推荐值随浏览/下载记录与 Steam 信息**动态更新**（无 TTL 的派生数据，从行为画像与 Steam 缓存实时计算）
- 新增测试套件 tests/test-engine.mjs（14 项：个性化差异/信号分量/画像查找）；全套 **159 项**通过

### v3.2.7

- **好评率徽章支持 type 显示**：appId 为合集（bundle）等无法解析本体的条目，徽章直接显示 type 值（紫色 `bundle` 徽章，悬停说明"Steam 条目类型: bundle（合集/非单个游戏本体）"），不再显示"未找到"；此类 appId 不写入下载站网址缓存（无意义）
- **推荐值徽章**（好评率徽章之后新增）：列表页每个游戏显示推荐数值徽章（🎯 XX%），**悬停显示各分值组成**（点击率/下载率/关键词/Steam 评分），**按推荐值分级着色**（≥80% 红 / ≥60% 橙 / ≥40% 黄绿 / 其余灰）；插入顺序保证好评率在前、推荐在后（两种时序均正确）；原链接尾部 🎮 小徽章移除（由新徽章取代）
- 测试：内容模拟新增推荐徽章（顺序/数值/悬停组成）与 type 徽章（样式/取值）用例，测试模拟 DOM 补全 insertBefore 位置插入/firstChild/nextSibling/className 选择器；全套 **145 项**通过

### v3.2.6

- **appId 校验与自动纠错**：检索/直取到的 appId 若为 DLC、合集等非单个游戏本体，判定为检索错误并**自动解析正确本体**——
  - 新增 `baseAppIdFromDetails`（纯函数）：`type=game/demo` 保留自身；`type=dlc` 且含 `fullgame` 时返回所属本体 appId（Steam DLC 页面自带 fullgame 字段，实测 4818690→2389170 华夏史诗、4145470→3613270 星际采矿公司）；bundle/未知类型且无法解析 → 视为无效
  - 详情页路径（`fetchSteamFullDetailsByAppId`，覆盖封面 appId 直取/手动更新）：DLC appId 自动切换本体重新获取（并行中英文），bundle 等返回无效
  - 列表页路径（`getSteamPositiveRate`）：搜索命中与 appId 直取均校验，DLC 自动解析本体（好评率/注册表/名称索引均写入本体），无法解析的 bundle 视为未找到；网络失败保持原值继续（防误杀）
- 测试：新增 baseAppIdFromDetails 用例（6 项）；全套 **140 项**通过

### v3.2.5

- **修复 Steam 页（3064810 Strategos / 2275490 Kaizen）下载站检索全部失败**（重大根因）：
  - 根因：`regexExecAll` 使用 `re[Symbol.exec]`——**`Symbol.exec` 不是标准符号**（标准仅 Symbol.match/matchAll/replace/search/split），表达式恒为 undefined，调用抛 TypeError 被 catch 吞掉 → **所有站内搜索（xdgame/xianyudanji/gamer520）全部静默失败**；此前被"缓存优先/注册表兜底"路径掩盖（访问过下载站才有缓存）。修复为标准符号 `Symbol.matchAll`——实测 Strategos 三站全部命中（xdgame 13184 / xianyudanji 88052 / gamer520 105598），Kaizen 命中 xdgame 11146 / xianyudanji 73257（gamer520 无资源，正确失败）
- **修复 xdgame 列表页 12730/12493/2427 检索错误**（DLC 误匹配 / 找不到本体 / 命中试玩版）：
  - 根因一：xdgame 列表封面用 `data-original`（jQuery lazy）属性存真实图，封面 appId 直取未读取该属性 → 全部落入标题搜索；修复：`extractSteamImageInfo` 增加 `data-original` 支持——3 个游戏封面直取本体 appId（3613270/2806120/1043260）直接命中
  - 根因二：附属词表缺 **"Supporter Pack/支持者包"** 与 **"Prologue/序章/序幕"**（Star Ores Inc - Supporter Pack、Gladiator Guild Manager: Prologue 绕过过滤）；且英文搜索词命中**官方中文名本体**（"角斗士公会经理"/"星际采矿公司"）时被跨语言名称校验跳过，英文 DLC/序章名反而匹配——修复：附属词表补齐；`nameMatchesSearch` 增加**跨语言信任**（一中文一英文时信任 storesearch 索引匹配，数字差异如 1代/2代仍拒绝）
- **版本规则调整**：版本号 X.Y.Z（大.中.小）；中版本触发条件=功能重大调整/小版本累计 10 次/单次变更 >3000 行/累计 >10000 行；每次变更做静态审查+基本测试，中版本变更做深度扫描+全面测试+提交 GitHub+更新说明，大版本在中版本基础上增加清理/优化/美化/深度测试/备份
- 测试：安全存储新增 regexExecAll 用例（3 项）、名称校验新增跨语言用例（3 项）、内容模拟新增 data-original 用例（1 项）；全套 **134 项**通过

### v3.2.4

- **修复 gamer520 109979（华夏史诗 战国）错误匹配到 DLC（4818690 初心请鞭 - 内容包）**：
  - 根因：标题"华夏史诗 战国 支持者版|...Build.24627143+初心请鞭DLC-...|..."中，"支持者版"被"支持/版"噪声拆出垃圾候选"华夏史诗 战国 者"（错失正确搜索词）；版本信息段中的 **DLC 名"初心请鞭"成为搜索候选**，storesearch 命中 DLC《初心请鞭 - 内容包》（storesearch 的 type 字段恒为 "app" 无法区分，且"内容包"不在附属词表、名称校验通过）
  - 修复：噪声词表补充"支持者版"（置于"版"之前优先匹配）；标题解析**整体跳过含 Build/DLC/版本号的版本信息段**（DLC 名不再成为游戏候选）；附属内容词表补充"内容包/扩展包/追加内容/组合包"（纵深防御）——现在正确命中《华夏史诗：战国》（app 2389170）
- 测试：标题解析新增 DLC 名候选用例（3 项）；全套 **127 项**通过

### v3.2.3

- **修复 gamer520 56286（"[顶置]PC近期爆火游戏 汇总贴"）被误匹配到 Steam app 1705180**：
  - 根因：汇总贴/索引页不是单个游戏，但被当作游戏处理——标题垃圾候选"PC"经 storesearch 命中游戏名含 "PC" 的《Gunner, HEAT, PC!》（1705180），名称相关性校验通过（结果名确实含 "pc"）
  - 修复（三层防御）：列表页适配器提取时跳过汇总贴标题（顶置/置顶/汇总贴/汇总/索引）；详情页 `detectGameName` 检测到汇总特征直接返回空（跳过详情处理）；标题解析 junkPattern 过滤 "PC/VR/3D/HD" 等短字母垃圾候选；名称校验对纯短英文词（≤3 字母）要求精确匹配——汇总贴现在正确显示"未找到"
- **修复 Steam 页（app 1705180）下载站检索 xdgame/xianyudanji 失败**（gamer520 成功）：
  - 根因：两站（WordPress）搜索结果链接**文本为空、标题在 `title` 属性**（图片链接），候选提取只取链接文本导致匹配分 0；实测两站站内搜索实际都能命中（xianyudanji 16702.html）
  - 修复：候选链接提取增加 `title` 属性兜底（文本为空时用 title 参与匹配评分）
- 测试：标题解析新增汇总贴/短词用例（3 项），内容模拟新增汇总贴过滤用例（2 项），名称校验新增短英文严格用例（2 项）；全套 **124 项**通过

### v3.2.2

- **修复 gamer520 43259（装机模拟器2）列表页与详情页均检索错误**：
  - 实测确认：PC Building Simulator 2 为 Epic 独占，**Steam 不存在该游戏**（storesearch 全词无匹配）——正确行为应为"未找到"
  - 检索错误的根因是**误匹配**：标题分段产生垃圾候选"全季票"命中《真・三国无双８ 全季票版》、详情页扩展变体"PC Building"命中 1 代《PC Building Simulator》——噪声词表补充"全季票/季票"消除垃圾候选
  - 新增**搜索结果名称相关性校验**（`nameMatchesSearch`）：结果名必须包含搜索词（规范化），且原始标题中搜索词后紧跟数字时结果名必须含数字（防续作/前作误匹配，如 "PC Building Simulator 2" → 1 代；精确匹配同样生效）；静态候选与扩展变体两条路径均接入——无法可靠匹配时返回 null 显示"未找到"，不再给出错误游戏
- 测试：规则与清理新增名称校验用例（7 项）；全套 **117 项**通过

### v3.2.1

- **修复 gamer520 列表页 114933（哥特王朝 重制版 / Gothic 1 Remake）检索不到 Steam**（详情页正常）：
  - 根因一：gamer520 列表封面为 lazyload——`src` 是占位 gif、真实图在 `data-src`，而封面 appId 直取优先读 `src` 导致失效（该游戏官方无中文名"哥特王朝"，标题中文搜索必然失败，只能靠封面 appId 直取）——`extractSteamImageInfo` 改为优先读取 `data-src`/`data-lazy-src` 再回退 `src`
  - 根因二："修改器"不在噪声词表，标题分段产生垃圾候选（"+ + +修改器"）可能在主名搜索失败后匹配到无关游戏——噪声词表与 junkPattern 补充"修改器/加速器/作弊"
- **修复 Steam 页（app 1297900）下载站资源检索不到**（实际存在）：
  - 根因：检索不查下载站网址缓存，且兜底只用注册表官方中英文名（官方名 "Gothic 1 Remake" 与中文站标题"哥特王朝 重制版"跨语言无法匹配）
  - 修复：恢复 `getDownloadUrls(appId)`，Steam 页检索**缓存优先**（列表/详情页访问时已记录的 appId → 下载页地址直接命中，并刷新元信息）；兜底重搜改用注册表官方名 + **下载站标题变体（names）**
- **设置页新增"调试浮窗"开关**（常规设置，默认关闭，控制列表/详情页诊断视图；此前仅弹窗可切换）
- 测试：标题解析新增"修改器噪声"用例（2 项），内容脚本模拟新增"lazyload data-src appId 直取"用例（3 项）；全套 **109 项**通过

### v3.2.0

- **全面审查与优化**（三代理并行审计 + 逐项修复）：
  - **修复重大 bug**：列表页轻量路径缓存命中分支调用已删除的旧函数（ReferenceError，v3.1.0 重构遗漏），缓存命中即时报错回源——现已恢复自愈与封面补写，命中路径真正生效
  - **修复推荐算法**：下载率得分与关键词匹配得分调用同一函数导致两个权重加权同一值（double-count）——下载率改为关键词信号 + 历史下载占比信号
  - **健壮性**：SW 冷启动失败时 init 重试一次；列表页提取对畸形 href 加 try/catch（此前会中断整页初始化）；下载追踪点击委托加 Element 防护；freegames 非法日期回退原文；popup/dashboard 旧设置字段缺失兜底
  - **性能**：HTML 转义复用缓存 div；列表页识别全页链接扫描设上限并达标提前返回；相对时间格式化统一为 `GR.common.formatRelativeTime`（消除 3 处重复实现）；好评率/未找到徽章插入合并为单一实现；VM 过滤与好评率过滤共用 DOM 移除逻辑；封面 appId 提取复用 builder 统一实现
  - **清理死代码**：8 处无引用导出（logSteam/needsReconfirm/getDownloadUrls/getDownloadUrlForSite/sleep 等）、永不触发的 aggressive 缓存清理分支、未使用 import、重复 import、调试面板遗留样式/字段、floats foldAll 脆弱实现等
  - **移除 platforms 规则链**：adapters/platforms/（steam/epic/gog 3 文件）为无消费方的死配置（API 均硬编码），连同 manifest/options/SW 引用一并删除，每个页面少加载 3 个脚本
  - **精简权限**：`permissions` 缩减为 storage+alarms（移除未使用的 activeTab/tabs），host_permissions 移除被 `<all_urls>` 覆盖的 11 条冗余域名与未使用的 api.steampowered.com，移除冗余 web_accessible_resources
  - **删除未引用文件**：icons/generate-icons.html、icons/gen-icons.ps1、git-setup.ps1、push-to-github.bat
- **GitHub 信息更新**：README 全面更新（6 站支持表、10 项核心功能、结构树、权限表、数据源、配置列表）；新增 `.github/workflows/ci.yml`（push/PR 自动跑测试套件）；仓库描述更新
- 测试：全套 **104 项**全部通过

### v3.1.2

- **游戏名检索自动改进机制（自适应检索）**：
  - **扩展组合搜索**：静态候选（parseGameTitle）全部搜索失败时，自动尝试删词变体——尾部逐词删除（≤3 层，噪声多在尾部）、头部删 1 词、已生效动态噪声词直接移除；变体轻量单次中文搜索，每段 ≤4 个、总数 ≤8（防 API 限流）
  - **自动学习噪声词**：扩展搜索成功后，从原始标题中提取"被跳过的词"作为候选噪声词计数（新数据模块 learnedNoise，可随备份导出）；同一词被 ≥3 次不同标题确认后成为"生效噪声词"，用于后续检索的变体清洗；静态表已覆盖的词不重复学习；计数阈值防止把游戏副标题（如"战痕之印"）误学为噪声；词表上限 200（自动淘汰低频词）
  - 所有调用点传入原始标题（详情页搜索/列表页轻量路径/0 评测重搜/手动选择候选）
- 测试：标题解析新增扩展变体（5 项）与噪声提取（5 项）用例；全套 **104 项**通过

### v3.1.1

- **调试浮窗纳入统一管理**："游戏雷达 Game Radar 调试"视图改为经 GR.float 创建（统一 chrome 标题栏，与其他浮窗一致），点击 ✕ 关闭后**不再被日志防抖自动复活**（dismissed 标志）；重新开启调试模式（设置/弹窗）后恢复显示
- **修复 gamer520 119668（幻世录 重制版）搜不到 Steam**：根因是标题"抢先试玩"不在噪声词表，parseGameTitle 首候选生成"幻世录 抢先试玩"导致 Steam 搜索空结果；噪声词表补充"抢先试玩/抢先体验/抢先/试玩/体验版"，中文子串候选同步清洗，首候选回归纯净游戏名"幻世录"（实测命中 appId 4030150；该游戏 0 评测，列表页显示灰色 AppID 徽章，详情页浮窗正常）
- 测试：标题解析新增"抢先试玩噪声"用例（2 项），内容脚本模拟新增"调试视图关闭不复活"用例（4 项）；全套 **94 项**通过

### v3.1.0

- **统一浮窗管理器**（content/core/floats.js，`GR.float`）：工作状态/诊断浮窗、详情页 Steam 信息浮窗、下载站资源面板、下载历史浮窗全部统一管理——分区定位（右上/右下/左下）、同区纵向堆叠防重叠（ResizeObserver 自动重排）、统一折叠/关闭/一键收起；各浮窗内容渲染逻辑不变
- **修复列表页较多"未找到"**（xianyudanji/gamer520）：根因是 v2.1.3 的 15s 强制收尾把仍在后台拉取的游戏误标"未找到"，且后台全部完成后才一次性推送（SW 休眠时结果丢失）。改为**每批完成后立即落盘并推送增量**（含 null 结果）+ done 标记收尾；强制收尾延至 45s 且**不再误标**（未返回的保持空白，后台已落盘缓存，刷新页面第一波即命中）；修复 final 波对波外名字误判的 bug（仅波内名字可判定"未找到"）；Steam 搜索网络失败整体重试一次（抗限流抖动）
- **封面缓存修复**：轻量列表页路径写入注册表/缓存时自动补封面（`coverImageFor`：已有封面优先，否则按 appId 构造 Steam CDN header 图）；缓存命中路径补写缺失封面；缓存管理页封面加载失败自动隐藏
- **中英文名自愈完善**：合并为 `healRegistryNames`（并行获取中英文官方名，一次修复两个字段，Steam 无中文名时保留原值）；新增**批量自愈**（`scanAndHealRegistry`，缓存面板"🩹 修复异常名称"按钮，分批按 appId 修复并显示统计）
- 测试套件：内容脚本模拟新增多波增量推送/未找到判定用例，规则与清理新增 coverImageFor 用例；全套 **88 项**通过

### v3.0.0

- **规则管理器**（设置页新增"规则管理"面板）：查看/编辑下载站适配规则——规则列表（key/name/domains/可检索标识）、JSON 编辑器（格式化/校验/保存）、字段说明表；保存的规则覆盖内置规则（storage.adapterRules，与原结构完全兼容），"恢复内置"一键删除导入规则
- **规则独立导入/导出**：导出生效规则为 JSON 文件，导入文件自动校验后直接生效（不依赖数据模块导出流程，便于站点规则分享）
- **规则安全校验**：后台二次校验（`validateAdapterRules`）——仅接受纯数据 JSON，必填字段（key/name/domains）、类型白名单、拒绝函数注入、规模上限（50 站点/10 域名/20 正则/嵌套 6 层）、key 唯一性；编辑器渲染全部 HTML 转义
- **一键清理过期缓存**（缓存与数据面板"🧹 清理过期缓存"）：按 TTL 清理三类过期条目——Steam 动态缓存（版本不符/超时）、名称负缓存（appId=null 超时）、下载站网址（lastRefreshed 超时），空桶一并移除；0=长期有效的类型跳过时间判定（仅清理无时间戳异常条目）；返回分类清理统计
- 新增测试套件 tests/test-cleanup.mjs（31 项：规则校验 16 + 三类清理 15）；全套测试共 **81 项**全部通过

### v2.1.3

- **列表页零延迟启动**：内容脚本改为 `document_start` 注入，脚本加载后立即在后台并行预热（唤醒 Service Worker + 加载设置/适配规则），DOM 就绪时直接开始工作（去掉原 300ms 延迟）——打开列表页后扩展与页面渲染同步开始，不再等数秒
- **缓存优先两波检索**：`GET_STEAM_RATINGS` 改为两阶段——第一波仅查缓存（零网络），命中徽章即时显示；未命中的后台从 Steam 拉取（忽略负缓存），完成后通过 `STEAM_RATINGS_UPDATE` 推送回页面更新徽章并落盘缓存；3 秒 cacheOnly 兜底重查 + 15 秒强制收尾，任何情况下流程必收敛
- **AJAX 列表页支持**：适配器提取为空时用 MutationObserver 等待列表容器出现（最长 4 秒），页面数据渲染完成即开始处理，不再误报"未提取到游戏项"
- 新增内容脚本模拟测试（tests/test-content-sim.mjs，8 项）：document_start 预热、两波徽章流程、AJAX 等待；测试套件共 50 项

### v2.1.2

- 工作状态浮窗与诊断浮窗合并为同一浮窗（右下角，先后关系）：先显示工作状态与进度条 → 完成后显示统计数据与计时（⏱ xx.xs）→ 3 秒后若调试模式开启自动切换为诊断视图，否则自动隐藏；诊断视图可 ✕ 固定关闭；弹窗"🔧 调试"区新增"📊 显示最近统计"按钮可随时重新显示统计
- 修复 Steam 中文站标题前缀 bug：`store.steampowered.com/app/2239710/` 等页面标题形如"Steam 上的 勇闯死人谷：暗黑之日"时，下载站检索回退名称被前缀污染导致搜不到资源（如 xdgame.com/game/10157.html）；现自动清理"Steam 上的/ on Steam"前缀，且检索全部失败时回退使用注册表中的官方中英文名重试
- 调试面板渲染移入状态浮窗（content/core/debug.js 不再维护独立 DOM，统一经 GR.status.showDebugView 渲染）

### v2.1.1

- 修复游戏缓存管理页封面不显示：详情页（SEARCH_STEAM/GET_STEAM_BY_APPID）与手动更新路径补写封面图（result.headerImage）
- 中文名异常自愈：注册表中文名须含中文字符，发现缺失/被英文占位时自动按 appId 重新获取 Steam 中文名（Steam 本身无中文名时保持原值不覆盖）
- 工作状态浮窗：完成统计显示任务耗时（⏱ xx.xs 计时器）；新增总开关（设置 → 常规 → 工作状态浮窗），关闭后不再显示（弹窗"显示最近统计"显式操作仍可用）

### v2.1.0

- **工作状态浮窗**：所有扩展工作的页面（下载站列表/详情、Steam 页）右下角显示当前工作状态与进度条；完成后显示统计数据（好评率/过滤/未找到、下载站命中数、Steam 评价），3 秒自动消失；弹窗"🔧 调试 → 📊 显示最近统计"可重新显示
- **缓存有效期单位化**：可自定义单位（小时/天/月/年），0 = 长期有效（永不过期）；旧数字格式自动兼容（按类型默认单位）
- **英文名异常自愈**：注册表英文名须含英文字母，发现中文占位等异常时自动按 appId 重新获取 Steam 英文名并更新（缓存命中路径触发）

### v2.0.0

- **全局模块化重构（全局最优拆分/组合）**：
  - content 脚本拆分：core（common 工具/debug 调试）+ adapters/builder（适配器构建）+ list（列表页）+ detail（详情页）+ tracking（下载追踪），tracker.js 仅保留入口（init/启动/监听），经 `__GR__` 命名空间共享
  - options 页面拆分：panels/settings + panels/cache + panels/data-manage，options.js 仅保留入口（状态/事件/自动保存），经 `__OPTS__` 共享
  - shared/escape.js：统一全局转义工具，消除 4 个页面重复实现
- **自动化测试套件**（tests/）：标题解析（10 项，覆盖两字名/×分段/噪声/英文优先）、安全与存储（18 项：SSRF 校验/ND-JSON/TDZ 扫描/语法/manifest 引用），运行 `node tests/run-tests.js`
- 测试驱动修复：parseGameTitle 纯噪声标题残留分隔符、空候选返回 undefined 两个真实 bug
- 模块链验证：SW 模拟加载与 content 脚本模拟（命名空间完整性）全部通过

### v1.12.0

- **service-worker.js 按功能拆分模块化**（约 3400 行 → 22 个模块文件）：
  - `background/core/`：constants（常量/默认设置/TTL 配置）、utils（安全 fetch/正则工具）、settings、rules（适配规则读取）、reset（内存缓存聚合重置）
  - `background/storage/`：logger、steam-cache、registry、name-index、download-urls、behavior、backups、history（各数据模块独立文件）
  - `background/steam/`：title-parser、api、orchestrator（标题解析/Steam API/编排器）
  - `background/recommend/engine.js`、`background/sites/search.js`、`background/freegames/manager.js`
  - `background/handlers.js`（消息处理与分发映射）、`service-worker.js`（仅入口：导入/监听/定时/初始化）
  - 依赖方向单向（core → storage → 业务层 → handlers → 入口），无循环依赖
- 模块链验证：全部 39 个 JS 语法通过、TDZ 扫描无后向引用、import 路径全部存在、SW 模拟加载执行无错误

### v1.11.2

- TDZ 防御加固：DATA_MODULES 的 storageKey 改为字符串字面量（不再引用前向标识符），彻底免疫顶层初始化顺序依赖
- 新增 TDZ 静态扫描脚本验证：全部 JS 文件无顶层后向引用
- 注：v1.11.1 已修复根因（DB_KEYS 前移）；若仍报错请确保 chrome://extensions 中点击"重新加载"且浏览器加载的是最新文件

### v1.11.1

- **修复扩展加载报错（Critical）**：Service Worker 顶层 `DATA_MODULES` 常量在 `DB_KEYS` 声明前初始化，触发 TDZ（Temporal Dead Zone）ReferenceError，导致整个后台加载失败
  - `DB_KEYS` 移至文件最前（import 之后立即声明），消除所有顶层常量初始化顺序依赖
  - 通过 Node 模拟 SW 环境验证：顶层代码执行无错误、OPFS 降级正常、异步无未处理异常
- 全面静态审计：manifest 引用 24 个文件全部存在、19 个 JS 语法全部通过、5 个 HTML 引用全部存在

### v1.11.0

- 缓存有效期自定义：设置页新增"缓存有效期"（Steam 动态缓存小时数、注册表重确认天数、下载站网址天数、名称负缓存小时数），后台 TTL 动态生效
- 设置页重构为 Chrome 设置页风格：左侧分类导航（常规/过滤/推荐算法/网站/缓存与数据/日志）+ 右侧内容面板，响应式适配窄屏
- 弹窗分类分级优化：推荐/过滤/算法/数据/调试分组展示，简洁卡片风格
- 日志功能增强：可配置记录级别（debug/info/warn/error）、保留天数（按时间自动清理）、存储形式（ND-JSON 文件追加 / storage.local 轻量），日志数据截断上限 500 → 1000 字符

### v1.10.0

- **OPFS 数据存储层**：基于 Origin Private File System 的分文件存储，突破 chrome.storage.local 5MB 配额（OPFS 配额为磁盘级）
  - 每个数据模块一个文件：日志类（浏览记录/运行日志）→ **ND-JSON**（追加写入高效），其余 → **JSON**
  - OPFS 不可用（隐私模式等）自动降级 chrome.storage.local；首次启动自动迁移旧数据
- 适配规则目录化重构：
  - `adapters/default.js` 基础共用规则（所有站点/平台合并的默认配置）
  - `adapters/platforms/` 平台独立配置（steam 检索 API/缓存 TTL、epic/gog 限免 API）
  - `adapters/sites/` 每个下载站独立文件（xdgame/xianyudanji/gamer520/3dmgame/ali213/gamersky），每个文件含字段详细说明
  - `adapters/index.js` 聚合入口（合并默认规则，暴露平台规则）

### v1.9.0

- 数据模块化：所有数据按模块组织（扩展配置/浏览记录/游戏画像/推荐模型/Steam 缓存/游戏注册表/名称索引/下载站网址缓存/限免游戏/运行日志/下载历史/适配规则），支持**自定义勾选**参与备份、恢复、导入、导出
- 导出升级：单 JSON 文件（含 format/version/exportedAt/modules 清单），任意工具可读可编辑；导入时校验格式与版本，按勾选模块写入，导入后自动重置内存缓存
- 备份升级：创建/恢复备份支持模块勾选，备份记录包含模块清单（旧备份兼容视为全量）
- 适配规则可迁移：规则可随导出迁移，导入后 storage.adapterRules 优先于内置 sites.js（内容脚本与后台均生效）
- 备份 ID 改用 crypto.randomUUID，提升标识唯一性
- 技术选型说明：MV3 扩展无文件系统/SQLite 原生支持（wasm SQLite 依赖重、配额下无优势），采用 JSON 单文件方案（最通用、可读、可校验）

### v1.8.5

- 图片 appId 直取规则化：各下载站规则显式配置 `imageAppId`（默认启用，可关闭），列表页优先从封面图提取 Steam appId 直取好评率，无法直取（本地图站点如 xdgame/xianyudanji）自动回退标题检索
- 封面图缓存：列表页提取封面图 URL 写入游戏注册表（coverImage），缓存管理页新增"封面"缩略图列
- 下一页预载同步提取封面 appId 与封面图
- 消息格式升级为 imageData（{appId, cover}），兼容旧 appIds 格式

### v1.8.4

- 列表页 Steam 信息检索优化（对齐详情页规则）：列表页为每个游戏提取封面图 Steam appId（gamer520 等站点的 queniuqe CDN 封面含 /steam/apps/{appId}/），后台直接以 appId 查询好评率，绕过标题搜索
  - 大量中文译名游戏（Steam 无中文名，如"地城英雄×龙与地下城 战痕之印"→ appId 3124340）此前列表页搜索失败，现在可直接显示好评率
  - 实测 gamer520 列表页 18/20 游戏带 Steam 封面 appId
  - 下一页预载同步提取 appId，翻页好评率即时显示

### v1.8.3

- **修复"奉魔"徽章不显示的真正根因**：列表项提取的标题最小长度（minLen）为 3，两字游戏名（如"奉魔"）被过滤 → 不在提取列表 → 无徽章且无"未找到"提示
  - 全部站点规则 minLen 3 → 2，默认值兜底同步改为 2
  - 这也解释了为何 xdgame/gamer520 正常：这两站的奉魔标题带后缀（"奉魔/Worship Demon"等）长度 > 3，唯独 xianyudanji 的标题是纯两字"奉魔"
- 诊断条确认"提取 49/50"帮助锁定了该根因

### v1.8.2

- 新增"列表页诊断条"：列表页处理完成后右下角短暂显示统计浮条（提取游戏数/查询数/徽章数/未找到数/后台错误信息 + 未找到名单前 5），8 秒自动消失或点击 ✕ 关闭
  - 请求失败与适配器提取为空时也显示诊断条，可暴露后台错误（如配额超限/内部异常）与页面结构变化
  - 用于精确定位"徽章未显示"问题发生在提取、请求还是数据环节

### v1.8.1

- 修复列表页徽章全部不显示的隐蔽根因：chrome.storage.local 配额（5MB）超限时，批量查询的缓存落盘（flush）抛异常会中断整个 GET_STEAM_RATINGS，导致列表页所有游戏无徽章且无提示
  - 所有 flush 与防抖写入安全化：写入失败仅记录日志（含"可能配额超限"提示），绝不中断主流程；配额超限时自动激进清理缓存后重试
  - Steam 缓存条目上限 2000 → 1200（激进清理 600），控制配额占用
  - 批量查询整体防御：异常时返回已完成部分的结果
- 好评率/AppID 徽章可点击：直接跳转 Steam 游戏详情页（span+click 实现，避免嵌套链接）

### v1.8.0

- 中英文名校验：中文名须含中文、英文名须含英文字母，搜索与注册表写入时排除"原声带/Soundtrack/美术集/Artbook/DLC/OST/壁纸"等附属内容（带单词边界，不误伤 Ghost/Trials 等合法游戏名）
- Steam 详情页浮窗：若游戏为 Demo/试玩版，标题前显示橙色"试玩版 / Demo"标识
- 标题解析支持中文分隔符 ×•·（如"地城英雄×龙与地下城 战痕之印"分段为可搜索词，修复 gamer520 102578 等译名游戏匹配失败）
- 0 评测验证升级：校验失败（附属内容/名称语言不符）时判定无效匹配并重搜游戏本体
- 排查说明："奉魔"在 xdgame/gamer520 正常、xianyudanji 失败——后台对三站逻辑完全同构，该差异指向浏览器内扩展状态（旧版本/旧数据）；v1.7.3 的每游戏状态徽章（未找到/AppID/好评率）可直接观察

### v1.7.3

- 列表页显示机制改进（每个游戏都有可见状态，便于调试）：
  - 未匹配到 Steam 的游戏显示灰色虚线"未找到"徽章（此前静默不显示）
  - 匹配成功但 0 评测/Demo 的游戏显示灰色 AppID 徽章（如 `#4172180`）
  - 未匹配的游戏 3 秒后自动重试一次（瞬时错误兜底），成功后替换为好评率徽章
  - 调试面板日志显示"未找到"的游戏名单（前 5 个）

### v1.7.2

- 弹窗头部显示扩展版本号（vX.Y.Z），便于确认浏览器中加载的版本

### v1.7.1

- 修复列表页好评率不显示的最后屏障：列表页批量查询与下一页预载**忽略搜索负缓存**（用户主动浏览的游戏值得重试，搜索失败会刷新负缓存时间戳，不放大请求量）——此前"曾失败一次"的游戏会因负缓存被长期挡住
- 名称索引加载时自动清理过期负缓存条目，避免索引无限增长
- 好评率查询各失败路径补充运行日志（可在数据分析页查看，便于定位"未找到/负缓存/异常"）

### v1.7.0

- 缓存数据可靠性加固（针对列表页好评率不显示/缓存管理页缺失条目的排查修复）：
  - 缓存命中返回时幂等补写游戏注册表（ensureRegistryEntry），防止"Steam 缓存存在但注册表缺失"导致缓存管理页找不到条目（如旧版本写入的缓存、注册表被清空等场景）
  - 列表页批量查询每批完成后立即落盘（Steam 缓存/名称索引/注册表），Service Worker 中途被终止（MV3 超时/休眠）时已完成批次数据不丢失
  - 名称搜索失败负缓存 TTL 6h → 2h，临时失败的游戏可更快重试
  - Steam 搜索中文请求网络抖动时自动重试一次，避免瞬时错误造成负缓存
  - Steam 动态缓存数据补充官方英文名字段（englishName），缓存命中时可补全注册表英文名

### v1.6.0

- 合并"Steam 详情页资源检索"与"追踪网站管理"为统一的"下载站与追踪管理"区块：每个下载站一行，含"追踪行为"与"Steam 检索"双开关（仅可搜索站点显示 Steam 检索），自定义追踪域名保留
- 修复列表页好评率仍不显示与中英文名缺失（同一根因链）：
  - Steam 搜索并行获取中英文结果（l=schinese + l=english），列表页轻量路径即可记录 Steam 官方英文名（如"奉魔"→ Worship Demon）
  - 0 评测游戏自动轻量获取官方中英文名并验证是否为 Demo/试玩版：是 Demo 则重新搜索完整版（如"奉魔"曾命中 Demo 版），同时把正确中英文名写入游戏注册表
  - 列表页匹配成功的游戏现在都会写入完整的官方中英文名（此前英文名缺失或为中文占位）

### v1.5.0

- 新增配置项"Steam 详情页资源检索"：自定义勾选在 Steam 游戏详情页检索哪些下载站的资源（缓存管理页的下载站地址更新使用相同范围）
- 修复列表页好评率仍不显示的问题：名称索引固化 Demo 版映射且缓存缺失时，现可通过注册表识别 Demo 并自动重搜完整版；搜索失败负缓存 TTL 由 24h 缩短为 6h，避免新游戏临时失败后长时间无法重试
- 游戏缓存管理页增强：
  - AppID 前显示 Steam 好评率徽章（颜色分级，无数据显示"暂无"）
  - AppID 可点击跳转 Steam 详情页
  - AppID 后增加手动更新按钮：重新获取 Steam 官方中英文名/标签并更新下载站地址（检索范围与 Steam 详情页配置一致）
- 游戏缓存记录 Steam 官方类型标签（genres），支持多条件组合检索：关键词 + 好评率 ≥ N% + 标签包含 + 下载站筛选

### v1.4.0

- 列表页即记录/更新 appId → 下载页地址：Steam 信息返回后批量写入下载站网址缓存（一次消息批量更新，缓存管理页即时可见）
- 游戏中英文名以 Steam 官方为准：注册表 cnName/enName 记录 Steam 官方中英文名，下载站标题保留为名称变体（names）用于跨站匹配兼容，旧数据在后续访问时自动修正
- 名称索引规范化：正向映射额外记录清理后的规范名，不同下载站的名称变体（如"铁巢重炮|完整版"与"铁巢重炮|官方中文"）命中同一 appId，Steam 好评率等缓存跨站共享
- 缓存优先：详情页检索放宽缓存命中条件（有 appId+名称即复用），列表页写入的部分缓存（好评率等）可被详情页直接复用，减少 Steam API 调用
- 预载效率提升：后台预载先过滤已有缓存/负缓存期的名称，只请求真正缺失的数据；并发批次 3→6；预载延迟 3s→2s，翻页后好评率几乎全部命中缓存
- 安全加固：下载站网址缓存存储前校验 http/https 且拒绝内网地址（SSRF 纵深防御）

### v1.3.1

- 修复详情页标题提取：移除 h1 内徽章元素（如咸鱼单机"新游发布"span）避免污染标题；按分隔符分段清理噪声词，不再误删噪声段后的英文名
- 修复 Steam 信息缓存：获取英文名（中英文详情并行请求 + 下载站标题英文名优先），游戏注册表正确记录中英文名（如"铁巢重炮 / Iron Nest Heavy Turret Simulator"）
- 修复游戏缓存管理页"上次调用"无记录：详情页访问时新增 TRACK_DOWNLOAD_SITE_VISIT 消息，将当前页面记录到该 appId 的下载站网址缓存并更新 lastAccessed
- 后台标题噪声词表补充"支持手柄/新游发布"等常见修饰词

### v1.3.0

- 修复列表页好评率不显示：Steam 搜索优先排除 Demo/试玩版（如"奉魔 Demo"抢占完整版导致好评率恒为 null），并对已固化的错误映射缓存自动自愈重搜
- 好评率徽章对 0 评测游戏显示灰色"暂无"（此前有 appId 但无评测时静默不显示）
- 下载站网址缓存重构为按站点分桶（v2 结构），各站点独立记录/更新，互不影响；旧版数据自动失效重建
- 下载站适配规则文件化：新增 `adapters/sites.js`，所有站点规则（域名、搜索 URL、列表页识别、列表项提取选择器）集中在规则文件中，添加新站点只需新增一个规则项，便于分享和移植
- 安全加固：所有外部 fetch 增加 host 校验（仅 http/https，拒绝 localhost/环回/私有/保留地址，SSRF 防护）；用户显式配置的本地 LLM 端点（Ollama）作为唯一例外

### v1.2.0

- 新增虚拟机版过滤：列表页隐藏标题含"虚拟机板/虚拟机"的游戏（关键词可自定义）
- 新增游戏缓存管理：设置页 → 游戏缓存标签，支持 AppID/中英文名检索、分页、单个删除、清空全部
- 缓存架构升级为 v5 三层缓存：游戏注册表（appId 唯一标识，永久）+ 名称索引（O(1) 反查）+ 下载站网址缓存（30 天 TTL）
- 详情页 Steam 浮窗自动搜索失败时支持手动选择游戏（候选列表 + 关键词搜索），映射持久化
- 从下载站页面 Steam 图片 URL 提取 appId 直接获取详情，绕过标题搜索，提升准确率
- 列表页预载下一页 Steam 缓存，翻页后好评率过滤秒开
- 性能优化：游戏注册表/名称索引/运行日志均改为内存缓存 + 防抖批量写入，显著减少 storage I/O
- 修复：备份恢复后内存缓存未失效导致读到旧数据
- 修复：仪表盘备份"恢复/删除"按钮使用内联 onclick 被 MV3 CSP 拦截而失效，改为事件绑定
- 修复：偏好模型关键词重复计数（同一游戏多次查看时信号被放大）
- 修复：限免 API 与 LLM 请求无超时可能挂起 Service Worker，统一添加超时
- 安全加固：所有动态内容（URL/关键词/错误消息）统一 HTML 转义，移除全部内联事件处理器
- 全部代码补充中英双语注释

### v1.1.0

- 移除 Steam 详情页浮窗的百度网盘跳转功能，改为仅提供下载站详情页链接
- 修复设置页面好评率过滤设置不加载/不保存的 bug
- 设置页面支持自动保存（800ms 防抖），无需手动点击保存
- 移除不再使用的 `scripting` 权限（最小权限原则）
- 清理约 540 行死代码（深度提取相关函数），提升加载性能
- 修复弹窗刷新按钮文字不一致问题
- 优化 MutationObserver 性能，添加 500ms 防抖
- 更新所有代码注释为中英双语

### v1.0.0

- 初始版本发布
- 浏览行为追踪与智能推荐
- Steam 信息集成（评价、语言、标签）
- 下载站资源检索（XDGame、咸鱼单机、Gamer520）
- 限免游戏监控
- 数据备份与恢复

## 许可证

本项目仅供学习和个人使用。
