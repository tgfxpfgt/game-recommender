// 节8 场景复刻：setQueryStubs 回 [itemE.li]（裸数组）。GR.list.trackListView(adapter, items, settings)
// 走 list.js 两波。getItemListSmart→trackListView→renderWave1→listBatch
// children.length>0 通过（88 用 waitForSignal 过了）→ 86 行 gr-badge-recent false 期望 → all 徽章是 isAllBadge
// 85/86 失败的是 86 行 expected false to deeply equal true = isAllBadge 未命中
// 看 isAllBadge 定义
