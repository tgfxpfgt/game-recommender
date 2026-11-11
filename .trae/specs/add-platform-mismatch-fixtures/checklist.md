# Checklist

- [x] 6 条平台误配夹具全部存在，且每条断言了判定 / 命中条目 / 平台字段 / 理由文案
- [x] 6 条夹具的 `detectOffSteamPlatform(page).kind` 分别为 console×4、cloud×1、mobile×1
- [x] 6 条夹具的判定均为 `suspected`，`matchNote` 为平台不一致文案（无一为 `confirmed`）
- [x] 每条夹具断言了命中条目的 `appId` 与标题（`name` / `matchName`）
- [x] 2 条对照组判 `confirmed`，`matchPlatform` 为 `PC`
- [x] 第一波用例（主机 → null；云游戏/移动 → suspected）保持通过
- [x] `tests/tmp-probe.mjs` 已删除
- [x] `npx vitest run tests/unit/test-match-confidence.mjs` 全绿（25/25）
- [x] 门禁：lint（eslint 0 warning）、typecheck（3 个 tsconfig）、test-changed（related + 直跑 + sim 全通过）、lint-ratchet 均通过
- [x] 已输出逐案汇报表（交付给用户）
