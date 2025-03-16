#!/bin/sh

set -e
[ "$TRACE" ] && set -x

git checkout master
npm run lint:typecheck
if [ $? -ne 0 ]; then
  echo "tsc 类型检查未通过"
  exit 1
fi

npm run lint
if [ $? -ne 0 ]; then
  echo "eslint 检查未通过"
  exit 1
fi
node --max-old-space-size=4096 --expose-gc ./node_modules/.bin/jest --maxWorkers=2 --forceExit

if [ $? -eq 0 ]; then
  git config --global user.name "GitHub Actions"
  git config --global user.email "actions@github.com"
  git fetch origin release
  commitmsg=$(git log head --oneline | head -1)
  mkdir -p .release
  cp -r .github bin lua build autoload plugin history.md Readme.md doc .release
  git checkout release
  cp -r .release/* .
  nvim -c 'helptags doc|q'

  changes=$(git status --porcelain)
  if [ -n "$changes" ]; then
    git add .
    git commit -m "$commitmsg"
    git push origin release
  else
    echo "No need to commit."
  fi
fi
