# 隐私政策 / Privacy Policy

Game Recommender（游戏智能推荐）Chrome 扩展 —— 数据隐私说明（v6.3.2）

## 数据收集与存储

**所有用户数据均存储在本地**（本机浏览器环境），不会上传至任何服务器：

| 数据类型 | 存储位置 | 用途 |
|---|---|---|
| 浏览行为日志（详情页访问/下载点击） | OPFS 文件（`behaviorLog`） | 本地推荐评分计算 |
| 游戏画像与偏好关键词 | OPFS 文件（`gameProfiles`/`keywordWeights`） | 个性化推荐 |
| Steam 缓存（好评率/详情/标签） | OPFS 文件（`steamCache`） | 减少重复请求、徽章展示 |
| 下载站网址映射 | OPFS 文件（`downloadUrls`） | 下载历史记录 |
| 扩展设置 | chrome.storage.local | 配置保存 |

OPFS（Origin Private File System）与 chrome.storage.local 均为浏览器提供的本地存储，
**数据不离开本机**。

## 网络请求

扩展仅向以下服务发起请求（均为功能必需）：

- **Steam 官方 API**（store.steampowered.com / api.steampowered.com）：游戏搜索、详情、好评率、公告
- **SteamSpy**（steamspy.com）：玩家人数/热度补充数据（可关闭？——当前为功能必需）
- **下载站域名**（9 个内置站点）：资源检索
- **限免源**（Epic/GOG/GamerPower）：限免游戏列表
- **本地 LLM 端点**（可选，用户显式配置的 localhost 地址）：AI 推荐评分（默认关闭）

所有请求均经 SSRF 校验（拒绝私有地址/非 http/https）、出站审计与每主机限速。
**扩展不向任何自有服务器发送数据，无广告、无分析追踪。**

## 权限说明

| 权限 | 用途 |
|---|---|
| `storage` | 设置与数据本地存储 |
| `alarms` | 定时刷新限免/备份 |
| `notifications` | 新限免推送提醒 |
| 域名 host 权限（26 个内置域名） | Steam/下载站/限免源请求 |
| 可选域名权限（optional） | 用户添加自定义下载站时按需请求 |

## 数据导出与删除

- 设置页可一键导出/导入全部数据（JSON 备份，备份剔除 API 密钥）
- 卸载扩展即删除全部本地数据（OPFS 随扩展域清理）

## 联系方式

问题反馈：GitHub Issues（仓库 `tgfxpfgt/game-recommender`）。
