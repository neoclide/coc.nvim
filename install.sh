#!/bin/sh

set -o nounset    # error when referencing undefined variable
set -o errexit    # exit when command fails

BLUE="$(tput setaf 4 2>/dev/null || echo '')"
NO_COLOR="$(tput sgr0 2>/dev/null || echo '')"

if [ ! -d "src" ]; then
  echo 'install.sh of coc.nvim not needed any more.'
  exit 0
fi

command_exists() {
  command -v "$1" >/dev/null 2>&1;
}

fetch() {
  local command
  if hash curl 2>/dev/null; then
    set +e
    command="curl --fail -L $1"
    curl --compressed --fail -L "$1"
    rc=$?
    set -e
  else
    if hash wget 2>/dev/null; then
      set +e
      command="wget -O- -q $1"
      wget -O- -q "$1"
      rc=$?
      set -e
    else
      echo "No HTTP download program (curl, wget) found…"
      exit 1
    fi
  fi

  if [ $rc -ne 0 ]; then
    echo "Command failed (exit code $rc): ${BLUE}${command}${NO_COLOR}"
    exit $rc
  fi
}

get_latest_release() {
  fetch "https://api.github.com/repos/neoclide/coc.nvim/releases/latest" |
    grep '"tag_name":' |
    sed -E 's/.*"([^"]+)".*/\1/'
}

if [ $# -eq 0 ]; then
  echo "Fetching latest release."
  tag=$(get_latest_release)
else
  tag=$1
fi

download() {
  mkdir -p build
  cd build
  if [ "$tag" = "nightly" ]; then
    fetch https://raw.githubusercontent.com/neoclide/coc.nvim/release/build/index.js > index.js
    return
  fi
  url="https://github.com/neoclide/coc.nvim/releases/download/$tag/coc.tar.gz"
  echo "Downloading binary from ${url}"
  if fetch "${url}" | tar xzfv -; then
    return
  else
    echo "Release not available for now, please wait for a few minutes."
  fi
}

download
