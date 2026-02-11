#!/usr/bin/env bash
# MoA One-Click Installer for macOS / Linux
# Usage: curl -fsSL https://moa.lawith.kr/install.sh | bash

set -euo pipefail

APP_NAME="MoA"
RELEASES_URL="https://github.com/Kimjaechol/MoA/releases/latest/download"

echo ""
echo "  ============================================"
echo "       $APP_NAME - Master of AI Installer"
echo "  ============================================"
echo ""

# Detect OS and architecture
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    PLATFORM="macos"
    INSTALLER_NAME="MoA-latest-mac.dmg"
    echo "  [OK] macOS detected ($ARCH)"
    ;;
  Linux)
    PLATFORM="linux"
    INSTALLER_NAME="MoA-latest-linux.AppImage"
    echo "  [OK] Linux detected ($ARCH)"
    ;;
  *)
    echo "  [!] Unsupported OS: $OS"
    echo "  For Windows, use: powershell -c \"irm https://moa.lawith.kr/install.ps1 | iex\""
    exit 1
    ;;
esac

DOWNLOAD_URL="$RELEASES_URL/$INSTALLER_NAME"
TEMP_DIR="${TMPDIR:-/tmp}"
INSTALLER_PATH="$TEMP_DIR/$INSTALLER_NAME"

# Download
echo ""
echo "  Downloading $APP_NAME..."
if command -v curl &>/dev/null; then
  curl -fSL --progress-bar -o "$INSTALLER_PATH" "$DOWNLOAD_URL"
elif command -v wget &>/dev/null; then
  wget -q --show-progress -O "$INSTALLER_PATH" "$DOWNLOAD_URL"
else
  echo "  [!] Neither curl nor wget found. Please install one."
  exit 1
fi

echo "  [OK] Download complete"

# Install based on platform
if [ "$PLATFORM" = "macos" ]; then
  echo ""
  echo "  Mounting DMG..."
  MOUNT_POINT=$(hdiutil attach -nobrowse "$INSTALLER_PATH" 2>/dev/null | grep "/Volumes/" | awk '{print $NF}')

  if [ -z "$MOUNT_POINT" ]; then
    echo "  [!] Failed to mount DMG. Opening manually..."
    open "$INSTALLER_PATH"
    echo "  Please drag MoA to your Applications folder."
    exit 0
  fi

  # Copy app to Applications
  APP_SOURCE="$MOUNT_POINT/$APP_NAME.app"
  if [ -d "$APP_SOURCE" ]; then
    echo "  Installing to /Applications..."
    cp -R "$APP_SOURCE" /Applications/ 2>/dev/null || {
      echo "  [i] Need permission to install to /Applications"
      sudo cp -R "$APP_SOURCE" /Applications/
    }
    echo "  [OK] Installed to /Applications"
  else
    echo "  [i] Opening DMG. Please drag MoA to Applications."
    open "$MOUNT_POINT"
  fi

  # Cleanup
  hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
  rm -f "$INSTALLER_PATH" 2>/dev/null || true

  # Launch
  echo ""
  echo "  Launching $APP_NAME..."
  open -a "$APP_NAME" 2>/dev/null || true

elif [ "$PLATFORM" = "linux" ]; then
  INSTALL_DIR="$HOME/.local/bin"
  mkdir -p "$INSTALL_DIR"
  FINAL_PATH="$INSTALL_DIR/$APP_NAME.AppImage"

  mv "$INSTALLER_PATH" "$FINAL_PATH"
  chmod +x "$FINAL_PATH"

  echo "  [OK] Installed to $FINAL_PATH"

  # Create desktop entry
  DESKTOP_DIR="$HOME/.local/share/applications"
  mkdir -p "$DESKTOP_DIR"
  cat > "$DESKTOP_DIR/moa.desktop" << DESKTOP_EOF
[Desktop Entry]
Name=MoA - Master of AI
Comment=AI Assistant for all your devices
Exec=$FINAL_PATH
Type=Application
Categories=Utility;
StartupWMClass=MoA
DESKTOP_EOF

  echo "  [OK] Desktop shortcut created"

  # Launch
  echo ""
  echo "  Launching $APP_NAME..."
  nohup "$FINAL_PATH" &>/dev/null &
fi

echo ""
echo "  ============================================"
echo "       $APP_NAME has been installed!"
echo "  ============================================"
echo ""
echo "  Enjoy MoA - Master of AI!"
echo ""
