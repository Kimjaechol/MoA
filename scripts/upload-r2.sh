#!/usr/bin/env bash
# Upload MoA desktop installers to Cloudflare R2
#
# Prerequisites:
#   - AWS CLI v2 installed (used for S3-compatible R2 API)
#   - Environment variables set:
#       R2_ACCOUNT_ID        — Cloudflare account ID
#       R2_ACCESS_KEY_ID     — R2 API token access key
#       R2_SECRET_ACCESS_KEY — R2 API token secret key
#       R2_BUCKET_NAME       — R2 bucket name (default: moa-releases)
#
# Usage:
#   ./scripts/upload-r2.sh                         # upload all platforms
#   ./scripts/upload-r2.sh --platform win          # upload Windows only
#   ./scripts/upload-r2.sh --platform mac          # upload macOS only
#   ./scripts/upload-r2.sh --platform linux        # upload Linux only

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RELEASE_DIR="$SCRIPT_DIR/../apps/desktop/release"
BUCKET_NAME="${R2_BUCKET_NAME:-moa-releases}"
PLATFORM="${2:-all}"

# Validate environment
for var in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do
  if [ -z "${!var:-}" ]; then
    echo "  [!] Missing environment variable: $var"
    exit 1
  fi
done

R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

# Parse --platform flag
while [[ $# -gt 0 ]]; do
  case $1 in
    --platform) PLATFORM="$2"; shift 2 ;;
    *) shift ;;
  esac
done

echo ""
echo "  ============================================"
echo "       MoA → Cloudflare R2 Uploader"
echo "  ============================================"
echo ""
echo "  Bucket:   $BUCKET_NAME"
echo "  Endpoint: $R2_ENDPOINT"
echo "  Platform: $PLATFORM"
echo ""

# Configure AWS CLI for R2
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="auto"

upload_file() {
  local file="$1"
  local key="$2"
  local content_type="${3:-application/octet-stream}"

  if [ ! -f "$file" ]; then
    echo "  [!] File not found: $file"
    return 1
  fi

  local size
  size=$(du -h "$file" | cut -f1)
  echo "  Uploading $key ($size)..."

  aws s3 cp "$file" "s3://${BUCKET_NAME}/${key}" \
    --endpoint-url "$R2_ENDPOINT" \
    --content-type "$content_type" \
    --no-progress

  echo "  [OK] $key uploaded"
}

# Upload platform-specific files
upload_win() {
  local exe
  exe=$(find "$RELEASE_DIR" -maxdepth 1 -name "MoA-Setup-*.exe" | head -1)
  if [ -n "$exe" ]; then
    upload_file "$exe" "desktop/MoA-Setup-latest.exe" "application/x-msdownload"
  else
    echo "  [!] No Windows installer found in $RELEASE_DIR"
  fi
}

upload_mac() {
  local dmg
  dmg=$(find "$RELEASE_DIR" -maxdepth 1 -name "MoA-*.dmg" | head -1)
  if [ -n "$dmg" ]; then
    upload_file "$dmg" "desktop/MoA-latest-mac.dmg" "application/x-apple-diskimage"
  else
    echo "  [!] No macOS DMG found in $RELEASE_DIR"
  fi
}

upload_linux() {
  local appimage
  appimage=$(find "$RELEASE_DIR" -maxdepth 1 -name "MoA-*.AppImage" | head -1)
  if [ -n "$appimage" ]; then
    upload_file "$appimage" "desktop/MoA-latest-linux.AppImage" "application/x-executable"
  else
    echo "  [!] No Linux AppImage found in $RELEASE_DIR"
  fi
}

# Upload latest.yml for electron-updater (auto-update metadata)
upload_update_metadata() {
  for yml in "$RELEASE_DIR"/latest*.yml; do
    if [ -f "$yml" ]; then
      local basename
      basename=$(basename "$yml")
      upload_file "$yml" "desktop/${basename}" "text/yaml"
    fi
  done
}

case "$PLATFORM" in
  win|windows)  upload_win ;;
  mac|macos)    upload_mac ;;
  linux)        upload_linux ;;
  all)
    upload_win
    upload_mac
    upload_linux
    upload_update_metadata
    ;;
  *)
    echo "  [!] Unknown platform: $PLATFORM"
    echo "  Use: win, mac, linux, or all"
    exit 1
    ;;
esac

echo ""
echo "  ============================================"
echo "       Upload complete!"
echo "  ============================================"
echo ""
echo "  Files are available at:"
echo "    https://download.moa.lawith.kr/desktop/"
echo ""
