#!/bin/bash
# MoA (Master of AI) Linux Installer
# Shell script for one-click installation
#
# Usage: curl -fsSL https://moa.example.com/install.sh | bash
# With pairing code: curl -fsSL https://moa.example.com/install.sh | bash -s -- --code ABC123

set -e

# ============================================
# Configuration
# ============================================

MOA_VERSION="1.0.0"
MOA_DOWNLOAD_URL="https://github.com/example/moa/releases/download/v${MOA_VERSION}"
MOA_API_URL="https://moa.example.com/api/relay"
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
    echo -e "${YELLOW} Master of AI - Linux Installer${NC}"
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

# Detect Linux distribution
detect_distro() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        DISTRO=$ID
        DISTRO_VERSION=$VERSION_ID
    elif [ -f /etc/lsb-release ]; then
        . /etc/lsb-release
        DISTRO=$DISTRIB_ID
        DISTRO_VERSION=$DISTRIB_RELEASE
    else
        DISTRO="unknown"
        DISTRO_VERSION="unknown"
    fi
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

    # Check if Linux
    if [[ "$(uname)" != "Linux" ]]; then
        print_error "This script is for Linux only."
        exit 1
    fi

    detect_distro
    print_info "Distribution: ${DISTRO} ${DISTRO_VERSION}"

    # Check architecture
    local arch
    arch=$(uname -m)
    print_info "Architecture: $arch"

    if [[ "$arch" != "x86_64" && "$arch" != "aarch64" ]]; then
        print_error "Unsupported architecture: $arch. Only x86_64 and aarch64 are supported."
        exit 1
    fi

    # Check for required tools
    local missing_tools=()

    if ! command -v curl &> /dev/null; then
        missing_tools+=("curl")
    fi

    if ! command -v jq &> /dev/null; then
        # jq is optional, we'll use grep fallback
        print_warning "jq not found. Using grep fallback for JSON parsing."
    fi

    if [[ ${#missing_tools[@]} -gt 0 ]]; then
        print_error "Missing required tools: ${missing_tools[*]}"
        echo ""
        echo "Install them using:"
        case $DISTRO in
            ubuntu|debian)
                echo "  sudo apt install ${missing_tools[*]}"
                ;;
            fedora|rhel|centos)
                echo "  sudo dnf install ${missing_tools[*]}"
                ;;
            arch|manjaro)
                echo "  sudo pacman -S ${missing_tools[*]}"
                ;;
            *)
                echo "  Use your package manager to install: ${missing_tools[*]}"
                ;;
        esac
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
    local binary_name="moa-linux-x64"

    if [[ "$arch" == "aarch64" ]]; then
        binary_name="moa-linux-arm64"
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
            print_warning "Node.js not found. Installing..."

            case $DISTRO in
                ubuntu|debian)
                    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
                    sudo apt-get install -y nodejs
                    ;;
                fedora|rhel|centos)
                    curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash -
                    sudo dnf install -y nodejs
                    ;;
                arch|manjaro)
                    sudo pacman -S nodejs npm
                    ;;
                *)
                    print_error "Please install Node.js manually from https://nodejs.org"
                    exit 1
                    ;;
            esac
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
    local shell_rc="${HOME}/.bashrc"

    if [[ -n "$ZSH_VERSION" ]] || [[ "$SHELL" == *"zsh"* ]]; then
        shell_rc="${HOME}/.zshrc"
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
    device_name=$(hostname)

    local os_info
    os_info="${DISTRO} ${DISTRO_VERSION}"

    local response
    response=$(curl -s -X POST "${MOA_API_URL}/pair" \
        -H "Content-Type: application/json" \
        -d "{
            \"pairingCode\": \"${PAIRING_CODE}\",
            \"deviceName\": \"${device_name}\",
            \"deviceType\": \"desktop\",
            \"platform\": \"linux\",
            \"osVersion\": \"${os_info}\",
            \"capabilities\": [\"shell\", \"file\", \"process\"]
        }" 2>/dev/null)

    if echo "$response" | grep -q '"success":true'; then
        # Save device token
        echo "$response" > "${CONFIG_DIR}/device-token.json"
        print_info "Device registered: ${device_name}"
    else
        print_warning "Could not connect to server. Device will register on first run."
    fi
}

setup_systemd() {
    print_step "6/6" "Configuring autostart..."

    local service_dir="${HOME}/.config/systemd/user"
    local service_path="${service_dir}/moa.service"

    mkdir -p "$service_dir"

    cat > "$service_path" << EOF
[Unit]
Description=MoA - Master of AI
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${INSTALL_DIR}/moa daemon
Restart=always
RestartSec=10
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
EOF

    # Reload systemd and enable service
    systemctl --user daemon-reload
    systemctl --user enable moa.service 2>/dev/null || true
    systemctl --user start moa.service 2>/dev/null || true

    print_info "Autostart configured via systemd user service"
}

# Fallback for systems without systemd user services
setup_cron_autostart() {
    print_info "Setting up cron-based autostart as fallback..."

    # Add to crontab
    local cron_entry="@reboot ${INSTALL_DIR}/moa daemon > /dev/null 2>&1 &"

    if ! crontab -l 2>/dev/null | grep -q "moa daemon"; then
        (crontab -l 2>/dev/null; echo "$cron_entry") | crontab -
        print_info "Added to crontab for autostart"
    fi
}

start_daemon() {
    echo ""
    echo -e "${CYAN}Starting MoA daemon...${NC}"

    # Check if systemd service is running
    if systemctl --user is-active --quiet moa.service 2>/dev/null; then
        print_info "MoA daemon is running (systemd)"
    else
        # Start manually
        "${INSTALL_DIR}/moa" daemon &
        disown
        print_info "MoA daemon started in background"
    fi
}

show_completion() {
    local device_name
    device_name=$(hostname)

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
    echo -e "${YELLOW}Systemd commands:${NC}"
    echo "  systemctl --user status moa   - Check service status"
    echo "  systemctl --user restart moa  - Restart service"
    echo "  journalctl --user -u moa -f   - View logs"
    echo ""
    echo -e "${YELLOW}Note:${NC} Restart your terminal or run:"
    echo "  source ~/.bashrc  (or ~/.zshrc)"
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

    # Try systemd first, fallback to cron
    if systemctl --user status 2>/dev/null | grep -q "systemd"; then
        setup_systemd
    else
        setup_cron_autostart
    fi

    start_daemon
    show_completion
}

main "$@"
