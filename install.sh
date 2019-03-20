#!/bin/sh

set -o nounset    # error when referencing undefined variable
set -o errexit    # exit when command fails

BOLD="$(tput bold 2>/dev/null || echo '')"
GREY="$(tput setaf 0 2>/dev/null || echo '')"
BLUE="$(tput setaf 4 2>/dev/null || echo '')"
RED="$(tput setaf 1 2>/dev/null || echo '')"
NO_COLOR="$(tput sgr0 2>/dev/null || echo '')"
YELLOW="$(tput setaf 3 2>/dev/null || echo '')"

command_exists() {
  command -v "$1" >/dev/null 2>&1;
}

error() {
  printf "${RED} $@${NO_COLOR}\n" >&2
}

warn() {
  printf "${YELLOW}! $@${NO_COLOR}\n"
}

info() {
  printf "${BLUE} $@${NO_COLOR}\n"
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
      error "No HTTP download program (curl, wget) found…"
      exit 1
    fi
  fi

  if [ $rc -ne 0 ]; then
    error "Command failed (exit code $rc): ${BLUE}${command}${NO_COLOR}"
    exit $rc
  fi
}

install_yarn() {
  if ! command_exists node && ! command_exists nodejs; then
    info "Nodejs not found, installing latest LTS"
    fetch install-node.now.sh/lts | sh
  fi
  if ! command_exists yarn && ! command_exists yarnpkg; then
    info "Yarn not found, installing yarn."
    fetch https://yarnpkg.com/install.sh | sh
  fi
}

get_latest_release() {
  fetch "https://api.github.com/repos/neoclide/coc.nvim/releases/latest" |
    grep '"tag_name":' |
    sed -E 's/.*"([^"]+)".*/\1/'
}

if [ $# -eq 0 ]; then
  info "Fetching latest release."
  tag=$(get_latest_release)
else
  tag=$1
fi

download() {
  install_yarn
  mkdir -p build
  cd build
  url="https://github.com/neoclide/coc.nvim/releases/download/$tag/${1}"
  info "Downloading binary from ${url}"
  if fetch "${url}" | tar xzfv -; then
    chmod a+x ${1%.tar.gz}
    return
  else
    warn "Binary not available for now, please wait for a few minutes."
  fi
}

try_build() {
  install_yarn
  info "Try build coc.nvim from source code"
  yarnpkg install --frozen-lockfile
}

arch=$(uname -sm)
case "${arch}" in
  "Linux x86_64") download coc-linux.tar.gz ;;
  "Linux i686") download coc-linux.tar.gz ;;
  "Darwin x86_64") download coc-macos.tar.gz ;;
  *) info "No pre-built binary available for ${arch}."; try_build ;;
esac
