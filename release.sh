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
npm test

if [ $? -eq 0 ]; then
  git config --global user.name "chemzqm"
  git config --global user.email "chemzqm@users.noreply.github.com"
  git fetch origin release --depth=1
  commitmsg=$(git log --oneline -1)
  mkdir -p .release
  cp -r .github bin lua build autoload plugin history.md README.md doc .release
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
