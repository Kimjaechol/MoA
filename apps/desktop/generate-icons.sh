#!/bin/bash
# Generate MoA desktop app icons from SVG
# Prerequisites: Inkscape or ImageMagick (convert)
#
# Usage: bash generate-icons.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SVG="$SCRIPT_DIR/icons/icon.svg"
ICONS_DIR="$SCRIPT_DIR/icons"

echo "Generating MoA desktop app icons..."

# Check for available tools
if command -v magick &>/dev/null; then
  CONVERT="magick"
elif command -v convert &>/dev/null; then
  CONVERT="convert"
else
  echo "Error: ImageMagick not found. Install with:"
  echo "  macOS:   brew install imagemagick"
  echo "  Ubuntu:  sudo apt install imagemagick"
  echo "  Windows: choco install imagemagick"
  exit 1
fi

# Generate PNG icons at various sizes
for size in 16 32 48 64 128 256 512 1024; do
  $CONVERT -background none -resize ${size}x${size} "$SVG" "$ICONS_DIR/icon-${size}.png"
  echo "  Created icon-${size}.png"
done

# Main icon.png (256x256)
cp "$ICONS_DIR/icon-256.png" "$ICONS_DIR/icon.png"

# Tray icon (16x16)
cp "$ICONS_DIR/icon-16.png" "$SCRIPT_DIR/tray-icon.png"

# Windows ICO (multi-size)
if [[ "$CONVERT" == "magick" ]] || command -v convert &>/dev/null; then
  $CONVERT "$ICONS_DIR/icon-16.png" "$ICONS_DIR/icon-32.png" "$ICONS_DIR/icon-48.png" \
           "$ICONS_DIR/icon-64.png" "$ICONS_DIR/icon-128.png" "$ICONS_DIR/icon-256.png" \
           "$ICONS_DIR/icon.ico"
  echo "  Created icon.ico (Windows)"
fi

# macOS ICNS (if iconutil available)
if command -v iconutil &>/dev/null; then
  ICONSET="$ICONS_DIR/icon.iconset"
  mkdir -p "$ICONSET"
  cp "$ICONS_DIR/icon-16.png" "$ICONSET/icon_16x16.png"
  cp "$ICONS_DIR/icon-32.png" "$ICONSET/icon_16x16@2x.png"
  cp "$ICONS_DIR/icon-32.png" "$ICONSET/icon_32x32.png"
  cp "$ICONS_DIR/icon-64.png" "$ICONSET/icon_32x32@2x.png"
  cp "$ICONS_DIR/icon-128.png" "$ICONSET/icon_128x128.png"
  cp "$ICONS_DIR/icon-256.png" "$ICONSET/icon_128x128@2x.png"
  cp "$ICONS_DIR/icon-256.png" "$ICONSET/icon_256x256.png"
  cp "$ICONS_DIR/icon-512.png" "$ICONSET/icon_256x256@2x.png"
  cp "$ICONS_DIR/icon-512.png" "$ICONSET/icon_512x512.png"
  cp "$ICONS_DIR/icon-1024.png" "$ICONSET/icon_512x512@2x.png"
  iconutil -c icns "$ICONSET" -o "$ICONS_DIR/icon.icns"
  rm -rf "$ICONSET"
  echo "  Created icon.icns (macOS)"
fi

echo "Done! Icons generated in $ICONS_DIR"
