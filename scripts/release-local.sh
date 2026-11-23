#!/usr/bin/env bash
# Local release build (brand "release") for Linux and/or Windows (cross-compiled).
# Usage: scripts/release-local.sh [linux|windows|all] [x86_64|aarch64]
# Run from anywhere; builds go to engine/obj-release-<platform>. Windows runs
# after Linux because it appends Windows-only lines to configs/common/mozconfig,
# which this script restores when it finishes.

set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-all}"
ARCH="${2:-x86_64}"
JOBS="${ZENDIA_JOBS:-10}"
OUT="$PWD/dist/release"
BUILT=()

case "$TARGET" in linux | windows | all) ;; *)
  echo "usage: $0 [linux|windows|all] [x86_64|aarch64]" >&2
  exit 1
  ;;
esac

. "$HOME/.cargo/env"
# The release version (surfer.json brands.release.release.displayVersion), put
# in every package name: zendia-<version>.linux-x86_64.tar.xz and so on.
VERSION="$(npm run --silent surfer -- get version 2>/dev/null)"
[ -n "$VERSION" ] || { echo "could not read the version from surfer.json" >&2; exit 1; }
mkdir -p "$OUT"

common_setup() {
  export SURFER_COMPAT="$ARCH" ZEN_RELEASE=1 ZEN_GA_DISABLE_PGO=1 ZENDIA_JOBS="$JOBS"
  npm run surfer -- ci --brand release --display-version "$VERSION"
  npm run import
  sh scripts/download-language-packs.sh
  ulimit -n 4096
}

# Packages are taken from the objdir's dist/, not the top-level dist/: surfer
# copies from the first engine/obj-* folder it finds, which with both release
# objdirs present is obj-release-linux even for Windows. Its last step, the
# update MAR, fails because the updater is disabled (configs/common/mozconfig),
# so a failing `npm run package` is allowed. Old packages are cleared first so
# the copies after this fail if `mach package` didn't produce new ones.
PKG_DIR=""
package() {
  PKG_DIR="engine/$ZENDIA_OBJDIR/dist"
  rm -f "$PKG_DIR"/zendia-*.tar.xz "$PKG_DIR"/zendia-*.zip "$PKG_DIR"/zendia-*.exe
  npm run package || echo "surfer package: update MAR step failed (updater disabled); checking packages"
}

build_linux() {
  export SURFER_PLATFORM=linux ZENDIA_OBJDIR="obj-release-linux"
  unset ZEN_CROSS_COMPILING
  export CC="$HOME/.mozbuild/clang/bin/clang" CXX="$HOME/.mozbuild/clang/bin/clang++"
  rustup target add "$ARCH-unknown-linux-gnu"
  common_setup
  npm run build
  package
  cp "$PKG_DIR"/zendia-*.linux-"$ARCH".tar.xz "$OUT/zendia-$VERSION.linux-$ARCH.tar.xz"
  BUILT+=("$OUT/zendia-$VERSION.linux-$ARCH.tar.xz")
}

build_windows() {
  export SURFER_PLATFORM=win32 ZEN_CROSS_COMPILING=1 ZENDIA_OBJDIR="obj-release-windows"
  unset CC CXX
  local triple="$ARCH-pc-windows-msvc" rs_version rs_dir="$HOME/.mozbuild/windows-rs"
  rustup target add "$triple"
  common_setup

  # CI fetches the windows crate with cargo-download; `mach bootstrap` already
  # put the same version in ~/.mozbuild/windows-rs, so use that.
  rs_version="$(tr -d '[:space:]' <build/windows/.windows-rs-version)"
  if ! grep -q "^version = \"$rs_version\"" "$rs_dir/Cargo.toml"; then
    echo "$rs_dir is not windows-rs $rs_version; run 'cd engine && ./mach bootstrap'" >&2
    exit 1
  fi
  git checkout -- configs/common/mozconfig
  trap 'git checkout -- configs/common/mozconfig' EXIT
  {
    echo "export LIB=\"$(cd "$HOME"/.mozbuild/clang/lib/clang/*/lib/windows && pwd)\""
    echo "export MOZ_WINDOWS_RS_DIR=$rs_dir"
  } >>configs/common/mozconfig
  dos2unix configs/windows/mozconfig

  npm run build
  package
  local suffix=""
  [ "$ARCH" = aarch64 ] && suffix="-aarch64"
  cp "$PKG_DIR"/zendia-*.en-US.win64$suffix.installer.exe "$OUT/zendia-$VERSION.installer-$ARCH.exe"
  cp "$PKG_DIR"/zendia-*.en-US.win64$suffix.zip "$OUT/zendia-$VERSION.win-$ARCH.zip"
  BUILT+=("$OUT/zendia-$VERSION.installer-$ARCH.exe" "$OUT/zendia-$VERSION.win-$ARCH.zip")
}

[ "$TARGET" = linux ] || [ "$TARGET" = all ] && build_linux
[ "$TARGET" = windows ] || [ "$TARGET" = all ] && build_windows
echo
echo "Build complete. Packages:"
for f in "${BUILT[@]}"; do
  printf '  %s  (%s)\n' "$f" "$(du -h "$f" | cut -f1)"
done
echo "Open the folder with: xdg-open $OUT"
