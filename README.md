# Game Recommender - 游戏智能推荐

基于浏览行为学习的 Chrome 浏览器扩展，自动预判游戏下载概率、集成 Steam 评分系统，并支持多下载站资源智能检索与一键获取百度网盘直链。

## 核心功能

### 1. 浏览行为追踪与智能推荐
- 自动追踪用户在下载站（XDGame、咸鱼单机、Gamer520）的浏览行为
- 基于浏览历史学习用户偏好，智能推荐相关游戏
- 在列表页实时显示推荐分数徽章

### 2. Steam 信息集成
- 在下载站详情页自动注入 Steam 信息浮窗
- 显示 Steam 总体评价、简体中文评价、SteamDB 评分三重评价体系
- 展示中文支持情况（简/繁体中文、音频、字幕）
- 显示热门用户标签、发行日期、开发商等信息
- 展示简体中文评测摘要

### 3. 下载站资源检索
- 在 Steam 游戏详情页自动搜索三大下载站的对应资源
- 显示资源更新日期、版本、文件大小等元信息
- 支持跨语言标题匹配（中英文独立匹配算法）

### 4. 百度网盘直链一键获取
- **XDGame**：通过后台标签页提取 JavaScript 动态加载的下载链接
- **咸鱼单机**：跟踪 `/goto?down=` 跳转链接，获取真实百度网盘地址
- **Gamer520**：多步导航（获取资源 → 立即下载 → 二维码页面），自动提取网盘链接
- 百度网盘提取码自动拼接为 `?pwd=xxxx` 格式，打开后自动填充
- 点击按钮后自动在新标签页打开最终百度网盘链接

### 5. 限免游戏监控
- 自动监控 Epic Games、GOG、GamerPower 等平台的限免游戏
- 每日自动刷新，支持一键领取跳转
- 浏览器扩展图标角标显示未领取数量

### 6. 数据管理
- 支持数据备份与恢复（JSON 格式）
- 可配置的日志记录系统
- 调试面板（开发模式）

## 安装方式

### 开发者模式加载
1. 下载本项目代码到本地
2. 打开 Chrome 浏览器，访问 `chrome://extensions/`
3. 开启右上角"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择项目根目录文件夹

### 权限说明
| 权限 | 用途 |
|------|------|
| `storage` | 存储用户偏好、浏览记录、缓存数据 |
| `activeTab` | 访问当前标签页内容 |
| `tabs` | 后台标签页提取下载链接 |
| `scripting` | 在下载站页面注入提取脚本 |
| `alarms` | 定时刷新限免游戏 |

## 项目结构

```
game-recommender/
├── manifest.json              # 扩展配置文件（Manifest V3）
├── background/
│   └── service-worker.js      # 后台服务工作者（核心逻辑）
├── content/
│   └── tracker.js             # 内容脚本（页面注入与浮窗渲染）
├── styles/
│   └── content.css            # 内容样式
├── popup/
│   ├── popup.html             # 工具栏弹窗
│   ├── popup.css              # 弹窗样式
│   └── popup.js               # 弹窗逻辑
├── options/
│   ├── options.html           # 设置页面
│   ├── options.css            # 设置样式
│   └── options.js             # 设置逻辑
├── dashboard/
│   ├── dashboard.html         # 推荐仪表盘
│   ├── dashboard.css          # 仪表盘样式
│   └── dashboard.js           # 仪表盘逻辑
├── freegames/
│   ├── freegames.html         # 限免游戏页面
│   ├── freegames.css          # 限免页面样式
│   └── freegames.js           # 限免页面逻辑
└── icons/                     # 扩展图标资源
```

## 技术架构

### 后台服务工作者 (service-worker.js)
- **Steam API 编排器**：搜索游戏 → 获取详情 → 解析语言支持 → 获取评测 → SteamDB/SteamSpy 数据
- **下载站搜索引擎**：多搜索词策略 + 跨语言匹配算法 + 链接匹配度评分
- **深度链接提取器**：基于 `chrome.tabs` + `chrome.scripting` 的站点特定提取器
- **缓存系统**：带版本控制和 TTL 的 Steam 数据缓存，避免重复 API 调用
- **安全验证**：URL 白名单机制，防止 SSRF 攻击和恶意链接注入

### 内容脚本 (tracker.js)
- **页面适配器模式**：支持多下载站的页面结构适配
- **浮窗 UI**：仿 Steam 风格的信息浮窗，支持展开/收起
- **异步消息通信**：与后台服务工作者通过 Chrome Messaging API 通信
- **内存管理**：定期清理无效的 DOM 引用，防止内存泄漏

### 安全设计
- 下载站 URL 域名白名单验证
- 网盘链接域名白名单验证（百度网盘、阿里云盘、115网盘等）
- 所有用户输入经 HTML 转义防 XSS
- 后台标签页静默打开，提取完成后立即关闭

## 支持的下载站

| 站点 | 域名 | 提取方式 |
|------|------|----------|
| XDGame | xdgame.com | JavaScript 动态加载，需登录 |
| 咸鱼单机 | xianyudanji.gg | 静态跳转链接 `/goto?down=`，需登录 |
| Gamer520 | gamer520.com | 多步导航 + 二维码，需登录 |

## 数据源

- **Steam Store API**：游戏搜索、应用详情、评测数据
- **SteamDB**：评分、在线人数、历史最低价
- **SteamSpy**：SteamDB 被拦截时的补充数据
- **Epic Games API**：限免游戏信息
- **GOG API**：限免游戏信息

## 配置与设置

在扩展设置页面（右键扩展图标 → 选项）可配置：
- 推荐算法参数（最小置信度、最小支持度）
- 日志开关与详细程度
- 调试面板显示
- 自动备份开关与备份间隔

## 开发说明

### 本地开发
```bash
# 语法检查
node --check background/service-worker.js
node --check content/tracker.js

# 加载到 Chrome 进行调试
# 访问 chrome://extensions/ → 开发者模式 → 加载已解压的扩展程序
```

### 缓存版本控制
修改 `STEAM_CACHE_VERSION` 常量可强制使旧缓存失效，用于发布数据结构变更后的强制刷新。

## 许可证

本项目仅供学习和个人使用。
