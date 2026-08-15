#!/bin/sh
# Game Recommender - 一键安装 git 钩子（v4.1.2）
# Install the lightweight git hooks (commit-msg 格式校验 + pre-commit 语法检查)。
# 用法 / Usage: sh scripts/install-hooks.sh
set -e
cd "$(dirname "$0")/.."

if git config core.hooksPath 2>/dev/null | grep -q .githooks; then
  echo "✅ git 钩子已安装（core.hooksPath = $(git config core.hooksPath)）"
else
  git config core.hooksPath .githooks
  echo "✅ 已安装 git 钩子（core.hooksPath = .githooks）"
fi

# 确保钩子可执行（Git for Windows 依赖 sh 解释器，POSIX 位非必需但保持惯例）
chmod +x .githooks/commit-msg .githooks/pre-commit .githooks/pre-push 2>/dev/null || true
echo "   钩子: .githooks/commit-msg（提交信息格式校验）"
echo "   钩子: .githooks/pre-commit（暂存文件 语法 + eslint + prettier 校验）"
echo "   钩子: .githooks/pre-push（push 前完整门禁 lint+typecheck+vitest）"
echo "   卸载: git config --unset core.hooksPath"
