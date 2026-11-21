#!/bin/bash
# 锁契 · PACT — 部署脚本
# 把本地 dist 内容发布到 GitHub Pages（gh-pages 分支）
# 用法：改完代码先 pnpm build，再运行 ./deploy.sh

set -e

REPO="heitaoplay/PACT"
TOKEN=$(cat ~/.workbuddy/github_pat)
DIR="$(cd "$(dirname "$0")" && pwd)"
TMP="$DIR/.deploy-tmp"

echo "==> 构建"
cd "$DIR"
pnpm build

echo "==> 准备 gh-pages 工作目录"
rm -rf "$TMP"
mkdir -p "$TMP"
cp dist/bundle.js dist/bundle.js.map "$TMP/"
cp -r dist/localization "$TMP/"

echo "==> 克隆 gh-pages 分支"
cd "$TMP"
git init -q
git remote add origin "https://x-access-token:${TOKEN}@github.com/${REPO}.git"
git fetch -q origin gh-pages
# 清掉工作区已有文件再 checkout，避免与远端文件冲突
find . -mindepth 1 -maxdepth 1 -not -name .git -exec rm -rf {} +
git checkout -q -B gh-pages FETCH_HEAD

echo "==> 同步文件"
# 清掉旧的部署文件，保留分支上其它内容
rm -rf bundle.js bundle.js.map localization
cp "$DIR/dist/bundle.js" "$DIR/dist/bundle.js.map" ./
cp -r "$DIR/dist/localization" ./

echo "==> 提交并推送"
git config user.name "heitaoplay"
git config user.email "200667840@qq.com"
git add -A
if git diff --cached --quiet; then
  echo "无变化，跳过"
else
  git commit -q -m "deploy: $(date '+%Y-%m-%d %H:%M')"
  git push -q origin gh-pages
  echo "==> 已发布到 https://heitaoplay.github.io/PACT/"
fi

cd "$DIR"
rm -rf "$TMP"
