#!/bin/bash
# MoA (Master of AI) macOS Installer
# Shell script for one-click installation
#
# Usage: curl -fsSL https://mymoa.app/install.sh | bash
# With pairing code: curl -fsSL https://mymoa.app/install.sh | bash -s -- --code ABC123

set -e

# ============================================
# Configuration
# ============================================

MOA_VERSION="1.0.0"
MOA_DOWNLOAD_URL="https://github.com/Kimjaechol/MoA/releases/download/v${MOA_VERSION}"
MOA_API_URL="${MOA_API_URL:-https://mymoa.app/api/relay}"
INSTALL_DIR="${HOME}/.moa"
CONFIG_DIR="${HOME}/.config/moa"
PAIRING_CODE=""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ============================================
# Helpers
# ============================================

print_banner() {
    echo ""
    echo -e "${CYAN}  __  __        _    ${NC}"
    echo -e "${CYAN} |  \\/  | ___  / \\   ${NC}"
    echo -e "${CYAN} | |\\/| |/ _ \\/ _ \\  ${NC}"
    echo -e "${CYAN} | |  | | (_) / ___ \\${NC}"
    echo -e "${CYAN} |_|  |_|\\___/_/   \\_\\${NC}"
    echo ""
    echo -e "${YELLOW} Master of AI - macOS Installer${NC}"
    echo -e " Version ${MOA_VERSION}"
    echo ""
}

print_step() {
    echo -e "${GREEN}[$1]${NC} $2"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_info() {
    echo -e "  ${BLUE}→${NC} $1"
}

# ============================================
# Parse Arguments
# ============================================

while [[ $# -gt 0 ]]; do
    case $1 in
        --code|-c)
            PAIRING_CODE="$2"
            shift 2
            ;;
        --dir|-d)
            INSTALL_DIR="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --code, -c CODE    Pairing code from KakaoTalk"
            echo "  --dir, -d PATH     Installation directory (default: ~/.moa)"
            echo "  --help, -h         Show this help message"
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# ============================================
# System Requirements Check
# ============================================

check_requirements() {
    print_step "1/6" "Checking system requirements..."

    # Check macOS version
    if [[ "$(uname)" != "Darwin" ]]; then
        print_error "This script is for macOS only."
        exit 1
    fi

    local macos_version
    macos_version=$(sw_vers -productVersion)
    local major_version
    major_version=$(echo "$macos_version" | cut -d. -f1)

    if [[ "$major_version" -lt 11 ]]; then
        print_error "macOS 11 (Big Sur) or later is required. You have $macos_version"
        exit 1
    fi

    # Check architecture
    local arch
    arch=$(uname -m)
    print_info "Architecture: $arch"
    print_info "macOS version: $macos_version"

    # Check for required tools
    if ! command -v curl &> /dev/null; then
        print_error "curl is required but not installed."
        exit 1
    fi

    print_info "System requirements met"
}

# ============================================
# Installation
# ============================================

install_moa() {
    print_step "2/6" "Creating installation directory..."

    mkdir -p "$INSTALL_DIR"
    mkdir -p "$CONFIG_DIR"

    print_step "3/6" "Downloading MoA..."

    local arch
    arch=$(uname -m)
    local binary_name="moa-macos-x64"

    if [[ "$arch" == "arm64" ]]; then
        binary_name="moa-macos-arm64"
    fi

    local download_url="${MOA_DOWNLOAD_URL}/${binary_name}"
    local binary_path="${INSTALL_DIR}/moa"

    if curl -fsSL "$download_url" -o "$binary_path" 2>/dev/null; then
        chmod +x "$binary_path"
        print_info "Downloaded to: $binary_path"
    else
        print_warning "Binary download failed. Setting up development mode..."

        # Check if Node.js is installed
        if ! command -v node &> /dev/null; then
            print_warning "Node.js not found. Installing via Homebrew..."

            if ! command -v brew &> /dev/null; then
                print_info "Installing Homebrew..."
                /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
            fi

            brew install node
        fi

        # Create wrapper script
        cat > "$binary_path" << 'EOF'
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "${SCRIPT_DIR}/moa.js" "$@"
EOF
        chmod +x "$binary_path"

        # Create placeholder JS file
        cat > "${INSTALL_DIR}/moa.js" << EOF
// MoA Development Mode
console.log('MoA is running in development mode');
console.log('Please download the full binary from: ${MOA_DOWNLOAD_URL}');
EOF

        print_info "Development mode configured"
    fi
}

setup_environment() {
    print_step "4/6" "Configuring environment..."

    # Add to PATH
    local shell_rc=""
    if [[ -n "$ZSH_VERSION" ]] || [[ "$SHELL" == *"zsh"* ]]; then
        shell_rc="${HOME}/.zshrc"
    else
        shell_rc="${HOME}/.bashrc"
    fi

    local path_export="export PATH=\"\$PATH:${INSTALL_DIR}\""

    if ! grep -q "/.moa" "$shell_rc" 2>/dev/null; then
        echo "" >> "$shell_rc"
        echo "# MoA - Master of AI" >> "$shell_rc"
        echo "$path_export" >> "$shell_rc"
        print_info "Added to PATH in $shell_rc"
    fi

    # Save config
    cat > "${CONFIG_DIR}/config.json" << EOF
{
  "version": "${MOA_VERSION}",
  "installPath": "${INSTALL_DIR}",
  "installedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "apiUrl": "${MOA_API_URL}"
}
EOF

    print_info "Config saved to: ${CONFIG_DIR}/config.json"
}

register_device() {
    print_step "5/6" "Registering device..."

    if [[ -z "$PAIRING_CODE" ]]; then
        echo ""
        echo -n "Enter pairing code (from KakaoTalk /설치 command, or press Enter to skip): "
        read -r PAIRING_CODE
    fi

    if [[ -z "$PAIRING_CODE" ]]; then
        print_warning "Skipping device registration"
        return
    fi

    local device_name
    device_name=$(scutil --get ComputerName 2>/dev/null || hostname)

    local os_version
    os_version=$(sw_vers -productVersion)

    local response
    response=$(curl -s -X POST "${MOA_API_URL}/pair" \
        -H "Content-Type: application/json" \
        -d "{
            \"pairingCode\": \"${PAIRING_CODE}\",
            \"deviceName\": \"${device_name}\",
            \"deviceType\": \"desktop\",
            \"platform\": \"macos\",
            \"osVersion\": \"macOS ${os_version}\",
            \"capabilities\": [\"shell\", \"file\", \"process\"]
        }" 2>/dev/null)

    if echo "$response" | grep -q '"success":true'; then
        local device_id
        device_id=$(echo "$response" | grep -o '"deviceId":"[^"]*"' | cut -d'"' -f4)

        # Save device token
        echo "$response" > "${CONFIG_DIR}/device-token.json"
        print_info "Device registered: ${device_name}"
    else
        print_warning "Could not connect to server. Device will register on first run."
    fi
}

setup_launchd() {
    print_step "6/6" "Configuring autostart..."

    local plist_path="${HOME}/Library/LaunchAgents/com.moa.daemon.plist"

    mkdir -p "${HOME}/Library/LaunchAgents"

    cat > "$plist_path" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.moa.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>${INSTALL_DIR}/moa</string>
        <string>daemon</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${HOME}/Library/Logs/moa.log</string>
    <key>StandardErrorPath</key>
    <string>${HOME}/Library/Logs/moa.error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
EOF

    # Load the daemon
    launchctl unload "$plist_path" 2>/dev/null || true
    launchctl load "$plist_path"

    print_info "Autostart configured via launchd"
}

start_daemon() {
    echo ""
    echo -e "${CYAN}Starting MoA daemon...${NC}"

    if launchctl list | grep -q "com.moa.daemon"; then
        print_info "MoA daemon is running"
    else
        "${INSTALL_DIR}/moa" daemon &
        disown
        print_info "MoA daemon started in background"
    fi
}

show_completion() {
    local device_name
    device_name=$(scutil --get ComputerName 2>/dev/null || hostname)

    echo ""
    echo -e "${GREEN}============================================${NC}"
    echo -e "${GREEN} Installation Complete!${NC}"
    echo -e "${GREEN}============================================${NC}"
    echo ""
    echo "MoA has been installed to: ${INSTALL_DIR}"
    echo ""
    echo -e "${YELLOW}Next steps:${NC}"
    echo "  1. Open KakaoTalk and send: /연결상태"
    echo "  2. You should see this device as 'online'"
    echo "  3. Try sending: @${device_name} ls"
    echo ""
    echo -e "${YELLOW}Commands:${NC}"
    echo "  moa status    - Check connection status"
    echo "  moa logs      - View logs"
    echo "  moa restart   - Restart daemon"
    echo "  moa uninstall - Remove MoA"
    echo ""
    echo -e "${YELLOW}Note:${NC} Restart your terminal or run:"
    echo "  source ~/.zshrc  (or ~/.bashrc)"
    echo ""
}

# ============================================
# Main
# ============================================

main() {
    print_banner
    check_requirements
    install_moa
    setup_environment
    register_device
    setup_launchd
    start_daemon
    show_completion
}

main "$@"
