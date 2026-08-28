# Chrome Web Store 上架清单 / Store Submission Checklist

v6.3.2（C1：商店上架准备）。本项目为自用扩展，上架为非必须项；如需发布到
Chrome Web Store / Edge Add-ons，按本清单准备。

## 必填资产

| 资产 | 规格 | 状态 |
|---|---|---|
| 扩展名称 | ≤ 45 字符（中文推荐："游戏推荐：Steam 好评率与限免助手"） | 待定稿 |
| 简要描述 | ≤ 132 字符（一句话：下载站页面显示 Steam 好评率徽章、智能推荐与限免监控） | 待定稿 |
| 详细描述 | 功能亮点 + 权限说明 + 数据本地声明（引用 PRIVACY.md） | 待定稿 |
| 图标 128x128 | `icons/icon128.png`（现有图标，上架前建议设计稿优化） | ✅ 存在 |
| 截图（5 张） | 1280x800 或 640x400：列表页徽章 / 详情页浮窗 / 设置页 / Dashboard / 限免页 | 待制作 |
| 隐私政策 URL | 托管 PRIVACY.md（GitHub Pages 或仓库 raw） | 待发布 |
| 开发者账号 | Chrome Web Store 一次性 $5 注册费 | 待办 |

## 描述文案（草稿）

**简要**：在下载站页面显示 Steam 好评率徽章，智能推荐你可能会喜欢的游戏，并监控 Epic/GOG 限免。

**详细**（要点）：
- 🏷️ 列表页自动注入 Steam 好评率/近 30 天评价/最近更新徽章，支持按好评率过滤
- 🤖 基于浏览与下载行为的本地智能推荐（数据不出本机，OPFS 本地存储）
- 🎮 Steam 页面反向检索下载站资源
- 🎁 Epic/GOG/GamerPower 限免监控与推送提醒
- 🔒 所有数据本地存储，无自有服务器，SSRF 校验 + 出站审计

## 上架流程

1. 定稿文案 + 制作截图
2. 隐私政策托管（PRIVACY.md → GitHub Pages）
3. 开发者账号注册（$5）→ 开发者信息完善
4. 打包 zip（`dist/` 或仓库源码 + icons + _locales）——**注意**：当前零构建，直接压缩仓库必要文件
5. 提交审核（Chrome Web Store 审核通常 1-5 个工作日；权限最小化（v6.3.0）有利过审）
6. Edge Add-ons：Edge 商店可一键导入 Chrome 扩展

## 审核注意事项

- 权限说明已最小化；**notifications 权限（v6.3.2 C2）需在描述中说明用途**；`scripting`/`contextMenus`（v7.4.0）需说明"仅用于用户自定义站点的注入"与"右键搜索"
- host 权限清单随版本演进：v9.7.0 增 `api.isthereanydeal.com`（限免二次校验，用户配置 Key 时才发请求）；v9.5.0 清理了 fitgirl/rutracker/yystv 残留域——提交前以 manifest.json 当前内容为准
- 数据本地声明（PRIVACY.md，v10.0.0 更新）满足"仅收集必要数据"审核要点
- 若审核要求最小权限：`notifications` 可改为可选（仅在用户开启限免通知时请求）

## 提交状态（v10.0.0 更新）

- ✅ 代码与数据面就绪：数据安全自检修复（v9.7.0）、深度扫描 0 findings、密钥不导出、权限最小化
- ⏳ 待用户操作项（需开发者账号，无法自动完成）：
  1. Chrome Web Store 开发者账号注册（$5 一次性）
  2. 商店素材定稿（名称/描述/5 张截图 1280x800）
  3. 隐私政策托管为公开 URL（GitHub Pages 或 raw）
  4. 上传 `release/game-recommender-vX.Y.Z.zip` 提交审核
