// harness pattern TRUE ✓。真实 vitest 8b 链里 items=0 的原因还未定位——
// 但 vitest -t "^8\. " 的断言失败在 86 行 = 徽章渲染了但类名不对？
// **回看：85 waitForSignal children.length>0 通过 + 86 isAllBadge false**。
// 8 节 preset ratings positiveRate 88 + badgeVisibility {recent:false,all:true,update:true,rec:false}
// 探针 49（直调 prependBadge）显示 4 个徽章全渲染（含 score/appstat——badgeVisibility 无 score 键
// 但 DEFAULT_SETTINGS 里有——8 节的 badgeSettings 展开了 DEFAULT_SETTINGS ✓ 含 score:true）。
// **86 isAllBadge=false 的候选**：children.some 里 c.className —— happy-dom className
// 是 SVGAnimatedString? 不。**真正要查的是 vitest 里 a.children 元素的 className**。
// 用 vitest 直接打印——临时在 86 前插 console? 不改文件——改用单测环境快速验证：
// vitest -t "^8\." 时 GR.list.trackListView 走完整真链（batch+push+渲染）。
// waitForSignal(children.length>0) 通过 → 有元素。86 立刻查 some(isAllBadge)=false。
// 可能：children.length>0 由**working badge（等待徽章）**满足而非评分徽章！
// 真实链：先渲染 gr-working-badge（等待），批次完成后替换为评分徽章。
// waitForBatchIdle 后应替换完成——但**idle 信号**在真实 DOM 下可能早于 DOM 替换？
// 打印时机：把 84 waitForBatchIdle 后立即查。旧 FakeEl 下 60051ms 超时的 8b-8e
// 也说明**推荐徽章等待**循环里 children.some(rec)=永不出现。
// 8b 超时在"节8b: 推荐徽章渲染"——推荐徽章渲染依赖 GET_RECOMMENDATIONS preset 返回 results。
// preset 返回 results: [...] ✓（8b 122-132）。但 60s 超时 = fireBatch 的推荐请求没发出或没渲染。
// 结论：真实链路 fireBatch 阶段断——**requestSteamRatings(filteredItems, settings) 内部
// 需要 batchState（initBatchState(settings)）+ ensureNameToImage（querySelectorAll('img')）**。
// qSA('img') 被 harness createElement 桥接返回 __grImgs=[]→ 空 → 无封面 → 正常继续。
// fireBatch 需要 documentMock.body 扫描?（惰性提取）ensureNameToImage(name) →
// 在 makeItem 场景无 img → imageData=null → 照发请求。
// **最可疑**：requestSteamRatings → initBatchState → batchState.queue=processItems…
// → fireBatch → sendMessage GET_STEAM_RATINGS（preset 命中 ✓ ratings 返回）
// → **推送路径**：fireBatch 发送后响应含 ratings → applyRatingsResponse → prependBadge。
// 若 sendMessage 走 chrome.runtime.sendMessage mock ✓（preset）。
// 真正断裂点需在 vitest 里看 sentMessages —— presets['GET_STEAM_RATINGS'] 被调用了吗？
// sentMessages 数组可查——临时用 vitest 单文件跑并 dump。**建一个最小诊断测试文件**（不提交）
