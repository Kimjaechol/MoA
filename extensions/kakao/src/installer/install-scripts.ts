/**
 * Dynamic install script generator
 *
 * Generates install.sh, install.ps1, and one-click wrapper files
 * (.bat for Windows, .command for macOS) with correct URLs.
 */

/**
 * Resolve the base URL for API endpoints baked into install scripts.
 * Always use the public domain — Vercel proxies to Railway.
 */
function resolveBaseUrl(_host?: string): string {
  return "https://moa.lawith.kr";
}

/** GitHub releases base URL for binary downloads */
const GITHUB_RELEASES_URL = "https://github.com/Kimjaechol/MoA/releases/download";

/**
 * Generate an install script with correct URLs baked in
 */
export function getInstallScript(
  platform: "unix" | "windows",
  host?: string,
): string {
  const baseUrl = resolveBaseUrl(host);
  const apiUrl = `${baseUrl}/api/relay`;
  const version = "1.0.0";
  const downloadUrl = `${GITHUB_RELEASES_URL}/v${version}`;

  if (platform === "windows") {
    return generateWindowsScript({ version, downloadUrl, apiUrl });
  }
  return generateUnixScript({ version, downloadUrl, apiUrl });
}

interface ScriptVars {
  version: string;
  downloadUrl: string;
  apiUrl: string;
}

function generateUnixScript(vars: ScriptVars): string {
  return `#!/bin/bash
# MoA (Master of AI) Installer for macOS/Linux
# Usage: curl -fsSL <server>/install.sh | bash
# With pairing code: curl -fsSL <server>/install.sh | bash -s -- --code ABC123

set -e

MOA_VERSION="${vars.version}"
MOA_DOWNLOAD_URL="${vars.downloadUrl}"
MOA_API_URL="${vars.apiUrl}"
INSTALL_DIR="\${HOME}/.moa"
CONFIG_DIR="\${HOME}/.config/moa"
PAIRING_CODE=""

RED='\\033[0;31m'; GREEN='\\033[0;32m'; YELLOW='\\033[0;33m'
BLUE='\\033[0;34m'; CYAN='\\033[0;36m'; NC='\\033[0m'

print_banner() {
    echo ""
    echo -e "\${CYAN}  __  __        _    \${NC}"
    echo -e "\${CYAN} |  \\\\/  | ___  / \\\\   \${NC}"
    echo -e "\${CYAN} | |\\\\/| |/ _ \\\\/ _ \\\\  \${NC}"
    echo -e "\${CYAN} | |  | | (_) / ___ \\\\\${NC}"
    echo -e "\${CYAN} |_|  |_|\\\\___/_/   \\\\_\\\\\${NC}"
    echo ""
    echo -e "\${YELLOW} Master of AI - Installer\${NC}"
    echo -e " Version \${MOA_VERSION}"
    echo ""
}

print_step() { echo -e "\${GREEN}[\$1]\${NC} \$2"; }
print_error() { echo -e "\${RED}[ERROR]\${NC} \$1"; }
print_warning() { echo -e "\${YELLOW}[WARNING]\${NC} \$1"; }
print_info() { echo -e "  \${BLUE}→\${NC} \$1"; }

while [[ \$# -gt 0 ]]; do
    case \$1 in
        --code|-c) PAIRING_CODE="\$2"; shift 2 ;;
        --dir|-d) INSTALL_DIR="\$2"; shift 2 ;;
        --help|-h)
            echo "Usage: \$0 [OPTIONS]"
            echo "  --code, -c CODE    Pairing code from KakaoTalk"
            echo "  --dir, -d PATH     Installation directory (default: ~/.moa)"
            exit 0 ;;
        *) print_error "Unknown option: \$1"; exit 1 ;;
    esac
done

check_requirements() {
    print_step "1/5" "Checking system requirements..."
    local os; os=\$(uname)
    if [[ "\$os" != "Darwin" && "\$os" != "Linux" ]]; then
        print_error "Unsupported OS: \$os"; exit 1
    fi
    if ! command -v curl &> /dev/null; then
        print_error "curl is required"; exit 1
    fi
    local arch; arch=\$(uname -m)
    print_info "OS: \$os, Arch: \$arch"
}

install_moa() {
    print_step "2/5" "Installing MoA..."
    mkdir -p "\$INSTALL_DIR" "\$CONFIG_DIR"

    local arch; arch=\$(uname -m)
    local os; os=\$(uname)
    local binary_name="moa-linux-x64"
    if [[ "\$os" == "Darwin" ]]; then
        binary_name="moa-macos-x64"
        [[ "\$arch" == "arm64" ]] && binary_name="moa-macos-arm64"
    else
        [[ "\$arch" == "aarch64" ]] && binary_name="moa-linux-arm64"
    fi

    local binary_path="\${INSTALL_DIR}/moa"
    if curl -fsSL "\${MOA_DOWNLOAD_URL}/\${binary_name}" -o "\$binary_path" 2>/dev/null; then
        chmod +x "\$binary_path"
        print_info "Downloaded MoA binary"
    else
        print_warning "Binary not available yet. Setting up Node.js mode..."
        if ! command -v node &> /dev/null; then
            print_error "Node.js is required. Install from https://nodejs.org"
            exit 1
        fi
        cat > "\$binary_path" << 'WRAPPER'
#!/bin/bash
SCRIPT_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
node "\${SCRIPT_DIR}/moa.js" "\$@"
WRAPPER
        chmod +x "\$binary_path"
        cat > "\${INSTALL_DIR}/moa.js" << JSEOF
console.log('MoA development mode — binary releases coming soon');
console.log('Visit: https://github.com/Kimjaechol/MoA/releases');
JSEOF
        print_info "Development mode configured"
    fi
}

setup_environment() {
    print_step "3/5" "Configuring environment..."
    local shell_rc="\${HOME}/.bashrc"
    [[ "\$SHELL" == *"zsh"* ]] && shell_rc="\${HOME}/.zshrc"
    if ! grep -q "/.moa" "\$shell_rc" 2>/dev/null; then
        echo "" >> "\$shell_rc"
        echo "# MoA - Master of AI" >> "\$shell_rc"
        echo "export PATH=\\"\\\$PATH:\${INSTALL_DIR}\\"" >> "\$shell_rc"
        print_info "Added to PATH in \$shell_rc"
    fi
    cat > "\${CONFIG_DIR}/config.json" << EOF
{"version":"\${MOA_VERSION}","installPath":"\${INSTALL_DIR}","apiUrl":"\${MOA_API_URL}","installedAt":"\$(date -u +"%Y-%m-%dT%H:%M:%SZ")"}
EOF
    print_info "Config saved"
}

register_device() {
    print_step "4/5" "Registering device..."
    if [[ -z "\$PAIRING_CODE" ]]; then
        echo -n "Enter pairing code (from KakaoTalk, or Enter to skip): "
        read -r PAIRING_CODE
    fi
    [[ -z "\$PAIRING_CODE" ]] && { print_warning "Skipping registration"; return; }

    local device_name; device_name=\$(hostname)
    local response
    response=\$(curl -s -X POST "\${MOA_API_URL}/pair" \\
        -H "Content-Type: application/json" \\
        -d "{\\"pairingCode\\":\\"\${PAIRING_CODE}\\",\\"deviceName\\":\\"\${device_name}\\",\\"deviceType\\":\\"desktop\\",\\"platform\\":\\"\$(uname | tr '[:upper:]' '[:lower:]')\\",\\"capabilities\\":[\\"shell\\",\\"file\\",\\"process\\"]}" 2>/dev/null)

    if echo "\$response" | grep -q '"success":true'; then
        echo "\$response" > "\${CONFIG_DIR}/device-token.json"
        print_info "Device registered: \${device_name}"
    else
        print_warning "Server unavailable. Device will register on first run."
    fi
}

show_completion() {
    print_step "5/5" "Done!"
    echo ""
    echo -e "\${GREEN}============================================\${NC}"
    echo -e "\${GREEN} MoA Installation Complete!\${NC}"
    echo -e "\${GREEN}============================================\${NC}"
    echo ""
    echo "Installed to: \${INSTALL_DIR}"
    echo ""
    echo -e "\${YELLOW}Next steps:\${NC}"
    echo "  1. Restart terminal or run: source ~/.zshrc"
    echo "  2. Open KakaoTalk and send: /연결상태"
    echo "  3. Try: @\$(hostname) ls"
    echo ""
}

main() {
    print_banner
    check_requirements
    install_moa
    setup_environment
    register_device
    show_completion
}

main "\$@"
`;
}

/**
 * Generate a one-click wrapper file for the given platform.
 * - Windows: .bat file that runs the PowerShell installer
 * - macOS: .command file that runs the bash installer (double-clickable in Finder)
 * - Linux: same as the .sh install script
 */
export function getOneClickInstaller(
  platform: "windows" | "macos" | "linux",
  host?: string,
  pairingCode?: string,
): string {
  const baseUrl = resolveBaseUrl(host);
  const codeSuffix = pairingCode ? ` -s -- --code ${pairingCode}` : "";
  const codeParam = pairingCode ? ` -PairingCode "${pairingCode}"` : "";

  if (platform === "windows") {
    return `@echo off
chcp 65001 >nul 2>&1
echo.
echo   =============================================
echo     MoA (Master of AI) - Windows Installer
echo   =============================================
echo.
echo   Installing MoA... Please wait.
echo.
powershell -ExecutionPolicy Bypass -Command "& { $ProgressPreference='SilentlyContinue'; irm '${baseUrl}/install.ps1' | iex }${codeParam}"
echo.
echo   Press any key to close...
pause >nul
`;
  }

  if (platform === "macos") {
    return `#!/bin/bash
# MoA (Master of AI) - macOS One-Click Installer
# Double-click this file to install MoA.

clear
echo ""
echo "  ============================================="
echo "    MoA (Master of AI) - macOS Installer"
echo "  ============================================="
echo ""
echo "  Installing MoA... Please wait."
echo ""

curl -fsSL "${baseUrl}/install.sh" | bash${codeSuffix}

echo ""
echo "  Installation complete!"
echo "  You can close this window."
echo ""
read -n 1 -s -r -p "  Press any key to close..."
`;
  }

  // Linux: same as install.sh
  return getInstallScript("unix", host);
}

function generateWindowsScript(vars: ScriptVars): string {
  return `# MoA (Master of AI) Windows Installer
# Usage: irm <server>/install.ps1 | iex

param(
    [string]$PairingCode = "",
    [string]$InstallPath = "$env:LOCALAPPDATA\\MoA",
    [switch]$Silent = $false
)

$ErrorActionPreference = "Stop"
$MOA_VERSION = "${vars.version}"
$MOA_DOWNLOAD_URL = "${vars.downloadUrl}"
$MOA_API_URL = "${vars.apiUrl}"

function Write-ColorText { param([string]$Text, [string]$Color = "White"); Write-Host $Text -ForegroundColor $Color }

function Write-Banner {
    Write-ColorText ""
    Write-ColorText "  __  __        _    " "Cyan"
    Write-ColorText " |  \\/  | ___  / \\   " "Cyan"
    Write-ColorText " | |\\/| |/ _ \\/ _ \\  " "Cyan"
    Write-ColorText " | |  | | (_) / ___ \\" "Cyan"
    Write-ColorText " |_|  |_|\\___/_/   \\_\\" "Cyan"
    Write-ColorText ""
    Write-ColorText " Master of AI - Windows Installer" "Yellow"
    Write-ColorText " Version $MOA_VERSION" "DarkGray"
    Write-ColorText ""
}

function Write-Step { param([string]$Step, [string]$Description); Write-ColorText "[$Step] $Description" "Green" }

function Test-Requirements {
    Write-Step "1/5" "Checking system requirements..."
    $os = Get-CimInstance Win32_OperatingSystem
    $version = [version]$os.Version
    if ($version.Major -lt 10) { Write-ColorText "[ERROR] Windows 10+ required." "Red"; exit 1 }
    Write-ColorText "  System requirements met." "DarkGray"
}

function Install-MoA {
    Write-Step "2/5" "Installing MoA..."
    if (-not (Test-Path $InstallPath)) { New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null }
    $exePath = Join-Path $InstallPath "moa.exe"
    try {
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri "$MOA_DOWNLOAD_URL/moa-windows-x64.exe" -OutFile $exePath -UseBasicParsing
    } catch {
        Write-ColorText "  Binary not available yet. Setting up Node.js mode..." "Yellow"
        $node = Get-Command node -ErrorAction SilentlyContinue
        if (-not $node) { Write-ColorText "[ERROR] Node.js required. Install from https://nodejs.org" "Red"; exit 1 }
        Set-Content -Path $exePath -Value '@echo off\\nnode "%~dp0moa.js" %*'
        Set-Content -Path (Join-Path $InstallPath "moa.js") -Value "console.log('MoA development mode');"
    }
}

function Set-Environment {
    Write-Step "3/5" "Configuring environment..."
    $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    if ($userPath -notlike "*$InstallPath*") {
        [Environment]::SetEnvironmentVariable("PATH", "$userPath;$InstallPath", "User")
    }
    $configDir = Join-Path $env:APPDATA "MoA"
    if (-not (Test-Path $configDir)) { New-Item -ItemType Directory -Path $configDir -Force | Out-Null }
    @{version=$MOA_VERSION; installPath=$InstallPath; apiUrl=$MOA_API_URL; installedAt=(Get-Date).ToString("o")} | ConvertTo-Json | Set-Content -Path (Join-Path $configDir "config.json")
}

function Register-Device {
    param([string]$Code)
    Write-Step "4/5" "Registering device..."
    if ([string]::IsNullOrEmpty($Code) -and -not $Silent) { $Code = Read-Host "Enter pairing code (from KakaoTalk)" }
    if ([string]::IsNullOrEmpty($Code)) { Write-ColorText "  Skipping registration" "Yellow"; return }
    $body = @{pairingCode=$Code; deviceName=$env:COMPUTERNAME; deviceType="desktop"; platform="windows"; capabilities=@("shell","file","process")} | ConvertTo-Json
    try {
        $response = Invoke-RestMethod -Uri "$MOA_API_URL/pair" -Method POST -Body $body -ContentType "application/json"
        if ($response.success) {
            $configDir = Join-Path $env:APPDATA "MoA"
            @{deviceId=$response.deviceId; deviceToken=$response.deviceToken} | ConvertTo-Json | Set-Content -Path (Join-Path $configDir "device-token.json")
            Write-ColorText "  Device registered: $env:COMPUTERNAME" "Green"
        }
    } catch { Write-ColorText "  Server unavailable. Device will register on first run." "Yellow" }
}

function Show-Completion {
    Write-Step "5/5" "Done!"
    Write-ColorText ""
    Write-ColorText "============================================" "Green"
    Write-ColorText " MoA Installation Complete!" "Green"
    Write-ColorText "============================================" "Green"
    Write-ColorText ""
    Write-ColorText "Installed to: $InstallPath"
    Write-ColorText ""
    Write-ColorText "Next steps:" "Yellow"
    Write-ColorText "  1. Open a new terminal"
    Write-ColorText "  2. Open KakaoTalk and send: /연결상태"
    Write-ColorText "  3. Try: @$env:COMPUTERNAME dir"
    Write-ColorText ""
}

function Main {
    if (-not $Silent) { Write-Banner }
    Test-Requirements
    Install-MoA
    Set-Environment
    Register-Device -Code $PairingCode
    Show-Completion
}

Main
`;
}
