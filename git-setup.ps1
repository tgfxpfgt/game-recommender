# ============================================================
# Game Recommender - Git/GitHub 版本控制初始化脚本
# 用法：在项目根目录右键"使用 PowerShell 运行"，或执行：
#       powershell -ExecutionPolicy Bypass -File git-setup.ps1
# ============================================================

$ErrorActionPreference = "Stop"
$projectName = "game-recommender"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Game Recommender 版本控制初始化" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 检查 git 是否安装
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
    Write-Host "[错误] 未检测到 Git，请先安装：" -ForegroundColor Red
    Write-Host "  下载地址: https://git-scm.com/download/win" -ForegroundColor Yellow
    Write-Host "  安装后重新运行本脚本。" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "安装 Git 后，你也可以手动执行以下命令：" -ForegroundColor Gray
    Write-Host "  git init" -ForegroundColor Gray
    Write-Host "  git add ." -ForegroundColor Gray
    Write-Host '  git commit -m "Initial commit: Game Recommender Chrome extension"' -ForegroundColor Gray
    Write-Host "  git branch -M main" -ForegroundColor Gray
    Write-Host "  git remote add origin https://github.com/<你的用户名>/$projectName.git" -ForegroundColor Gray
    Write-Host "  git push -u origin main" -ForegroundColor Gray
    Read-Host "按回车键退出"
    exit 1
}

Write-Host "[OK] 已检测到 Git: $(git --version)" -ForegroundColor Green

# 2. 初始化仓库（如果尚未初始化）
if (-not (Test-Path ".git")) {
    Write-Host "[..] 初始化 Git 仓库..." -ForegroundColor Yellow
    git init
    git branch -M main
    Write-Host "[OK] 仓库已初始化 (main 分支)" -ForegroundColor Green
} else {
    Write-Host "[OK] Git 仓库已存在，跳过初始化" -ForegroundColor Green
}

# 3. 配置 .gitignore（已存在则跳过）
if (-not (Test-Path ".gitignore")) {
    Write-Host "[警告] 未找到 .gitignore，请确保已创建" -ForegroundColor Yellow
}

# 4. 添加文件并提交
Write-Host "[..] 添加文件到暂存区..." -ForegroundColor Yellow
git add .

$status = git status --porcelain
if ($status) {
    Write-Host "[..] 创建提交..." -ForegroundColor Yellow
    $commitMsg = @"
Initial commit: Game Recommender Chrome extension

- 行为追踪与Steam标签驱动的推荐算法
- Steam详情浮窗（评分/评测/标签/中文支持）
- Steam页跳转下载站浮窗（xdgame/xianyudanji/gamer520）
- 限免游戏提醒（Epic/Steam/GOG + GamerPower聚合）
- 运行日志系统与自动备份
- 数据分析仪表板
"@
    git commit -m $commitMsg
    Write-Host "[OK] 提交完成" -ForegroundColor Green
} else {
    Write-Host "[OK] 无变更需要提交" -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  下一步：连接到 GitHub" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. 在 GitHub 创建一个空仓库（不要勾选 README/.gitignore）：" -ForegroundColor White
Write-Host "   https://github.com/new" -ForegroundColor Yellow
Write-Host ""
Write-Host "2. 关联远程仓库并推送（替换 <你的用户名>）：" -ForegroundColor White
Write-Host "   git remote add origin https://github.com/<你的用户名>/$projectName.git" -ForegroundColor Yellow
Write-Host "   git push -u origin main" -ForegroundColor Yellow
Write-Host ""
Write-Host "   如果已关联过远程仓库，先移除再添加：" -ForegroundColor Gray
Write-Host "   git remote remove origin" -ForegroundColor Gray
Write-Host ""
Write-Host "提示：推送时可能需要 GitHub 个人访问令牌(Personal Access Token)作为密码。" -ForegroundColor Gray
Write-Host ""
Read-Host "按回车键退出"
