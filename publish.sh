#!/bin/sh

set -e
[ "$TRACE" ] && set -x

echo "Creating release for release branch"
revision=$(git rev-parse HEAD)
# build and upload assets
webpack
mv build/index.js ..
git checkout release
mv ../index.js .
git add .
git commit -a -m "release $revision"
git push origin release
git checkout master
