#!/bin/sh

set -e
[ "$TRACE" ] && set -x

echo "Creating release for release branch"
revision=$(git rev-parse HEAD)
# build and upload assets
webpack
cd .release
cp ../build/index.js .
git add .
git commit -a -m "release $revision"
git push origin release
