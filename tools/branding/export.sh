#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Turns the masters generate.py writes into every branding file:
#   configs/branding/{release,twilight}   the brands surfer builds
#   src/browser/branding/{release,twilight}   files in a brand's subfolders,
#                                             which surfer copies over the brand
#   src/toolkit/mozapps/installer/windows/nsis/setup.ico   the installer's icon
# Anything a brand does not provide, surfer fills in from Firefox's own
# branding, so every file the Windows installer and package use is made here.
#
# Needs rsvg-convert and ImageMagick.  Run generate.py first.

set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

png() { rsvg-convert -w "$2" -h "${3:-$2}" "$here/$1" -o "$4"; }
ico() { # ico <master> <out> <sizes...>
  local master=$1 out=$2; shift 2
  local list=()
  for s in "$@"; do png "$master" "$s" "$s" "$tmp/ico-$s.png"; list+=("$tmp/ico-$s.png"); done
  magick "${list[@]}" "$out"
}
bmp() { # bmp <master> <width> <height> <out>
  png "$1" "$2" "$3" "$tmp/bmp.png"
  magick "$tmp/bmp.png" -type TrueColorAlpha "BMP3:$4"
}

for channel in release twilight; do
  brand="$repo/configs/branding/$channel"
  extra="$repo/src/browser/branding/$channel"
  sfx=""; [ "$channel" = twilight ] && sfx="-twilight"
  mkdir -p "$brand/content" "$extra/stubinstaller" "$extra/msix/Assets"

  # The app's icons.
  for s in 16 22 24 32 48 64 128 256 512 1024; do png "logo$sfx.svg" "$s" "$s" "$brand/logo$s.png"; done
  cp "$brand/logo1024.png" "$brand/logo.png"
  png "logo-mac$sfx.svg" 1024 1024 "$brand/logo-mac.png"
  ico "logo$sfx.svg" "$brand/firefox.ico" 256 64 48 32 16
  cp "$brand/firefox.ico" "$brand/firefox64.ico"
  for s in 16 32 64 128 256 512 1024; do png "logo-mac$sfx.svg" "$s" "$s" "$tmp/mac-$s.png"; done
  python3 "$here/icns.py" "$brand/firefox.icns" \
    icp4="$tmp/mac-16.png" icp5="$tmp/mac-32.png" icp6="$tmp/mac-64.png" ic07="$tmp/mac-128.png" \
    ic08="$tmp/mac-256.png" ic09="$tmp/mac-512.png" ic10="$tmp/mac-1024.png" ic11="$tmp/mac-32.png" \
    ic12="$tmp/mac-64.png" ic13="$tmp/mac-256.png" ic14="$tmp/mac-512.png"

  # The about dialog.
  cp "$here/about-logo.svg" "$brand/content/about-logo.svg"
  png "logo$sfx.svg" 512 512 "$brand/content/about-logo.png"
  png "logo$sfx.svg" 1024 1024 "$brand/content/about-logo@2x.png"

  # Private browsing and documents.
  cp "$here/private.svg" "$brand/content/about-logo-private.svg"
  png private.svg 192 192 "$brand/content/about-logo-private.png"
  png private.svg 384 384 "$brand/content/about-logo-private@2x.png"
  png private.svg 270 270 "$brand/PrivateBrowsing_150.png"
  png private.svg 126 126 "$brand/PrivateBrowsing_70.png"
  ico private.svg "$brand/pbmode.ico" 16 32 48 64 128 256
  ico document.svg "$brand/document.ico" 16 32 48 64 128 256
  ico document_pdf.svg "$brand/document_pdf.ico" 16 32 48 64 128 256

  # Windows: the Start tile, and the installer's side image and header strip.
  png "visual-$channel.svg" 1042 1046 "$brand/VisualElements_150.png"
  cp "$brand/VisualElements_150.png" "$brand/VisualElements_70.png"
  bmp "watermark-$channel.svg" 164 314 "$brand/wizWatermark.bmp"
  bmp installer-header.svg 150 57 "$brand/wizHeader.bmp"
  bmp installer-header-rtl.svg 150 57 "$brand/wizHeaderRTL.bmp"
  # The online installer's background, and the Windows package's logos.
  png installer-background.svg 1344 822 "$tmp/bg.png"
  magick "$tmp/bg.png" -quality 92 "$extra/stubinstaller/bgstub.jpg"
  assets="$extra/msix/Assets"
  png mark-padded.svg 44 44 "$assets/Document44x44.png"
  png mark-padded.svg 88 88 "$assets/Square44x44Logo.scale-200.png"
  for f in Square44x44Logo.targetsize-256 Square44x44Logo.altform-unplated_targetsize-256 Square44x44Logo.altform-lightunplated_targetsize-256; do
    png mark-padded.svg 256 256 "$assets/$f.png"
  done
  png mark-padded.svg 100 100 "$assets/StoreLogo.scale-200.png"
  png mark-padded.svg 142 142 "$assets/SmallTile.scale-200.png"
  png mark-padded.svg 300 300 "$assets/MedTile.scale-200.png"
  png mark-padded.svg 300 300 "$assets/Square150x150Logo.scale-200.png"
  png mark-padded.svg 620 620 "$assets/LargeTile.scale-200.png"
  png wide-tile.svg 620 300 "$assets/Wide310x150Logo.scale-200.png"

  # The macOS installer's banner.
  cp "$here/MacOSInstaller.svg" "$brand/MacOSInstaller.svg"
done

# The installer's own icon, on its window and on setup.exe.
ico logo.svg "$repo/src/toolkit/mozapps/installer/windows/nsis/setup.ico" 256 48 32 16
echo "exported the branding"
