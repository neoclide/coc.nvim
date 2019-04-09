#!/bin/sh

set -e
[ "$TRACE" ] && set -x

# Create tag and push
git add package.json history.md
tag=v$(json -f package.json version)
git commit -a -m "Release $tag" &> /dev/null
git tag -a "$tag" -m "Release $tag"
git push
git push --tags

GH_API="https://api.github.com"
GH_REPO="$GH_API/repos/neoclide/coc.nvim"
GH_TAGS="$GH_REPO/releases/tags/$tag"
AUTH="Authorization: token $GITHUB_API_TOKEN"

echo "Creating release for $tag"
curl -X POST -H "Authorization: token $GITHUB_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data "{\"tag_name\":\"$tag\"}" \
  "$GH_REPO/releases"

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
