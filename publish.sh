#!/bin/sh

set -e
[ "$TRACE" ] && set -x

tag=nightly
GH_API="https://api.github.com"
GH_REPO="$GH_API/repos/neoclide/coc.nvim"
GH_TAGS="$GH_REPO/releases/tags/$tag"
AUTH="Authorization: token $GITHUB_API_TOKEN"
echo "Creating release for nightly"

# build and upload assets
webpack
cd ./build
tar -zcf coc.tar.gz index.js
zip coc.zip index.js

declare -a files=("coc.zip" "coc.tar.gz")

# Validate token.
curl -o /dev/null -sH "$AUTH" $GH_REPO || { echo "Error: Invalid repo, token or network issue!";  exit 1; }

# Read asset tags.
response=$(curl -sH "$AUTH" $GH_TAGS)

# Get ID of the asset based on given filename.
eval $(echo "$response" | grep -m 1 "id.:" | grep -w id | tr : = | tr -cd '[[:alnum:]]=')
[ "$id" ] || { echo "Error: Failed to get release id for tag: $tag"; echo "$response" | awk 'length($0)<100' >&2; exit 1; }

# Get list of assets
curl $GH_REPO/releases/$id/assets | json -Ma id | while read -r line ; do
  curl -X DELETE -H "$AUTH" $GH_REPO/releases/assets/$line
done

# Upload asset
for filename in "${files[@]}"
do
  GH_ASSET="https://uploads.github.com/repos/neoclide/coc.nvim/releases/$id/assets?name=$filename"
  echo "Uploading $filename"
  curl -X POST -H "Authorization: token $GITHUB_API_TOKEN" \
    -H "Content-Type: application/octet-stream" \
    --data-binary @"$filename" \
    $GH_ASSET
done
