#!/bin/sh

set -e
[ "$TRACE" ] && set -x

git config --global user.name "GitHub Actions"
git config --global user.email "actions@github.com"
git fetch origin release
git checkout master
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
