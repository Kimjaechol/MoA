# MoA (Master of AI) Windows Installer
# PowerShell script for one-click installation
#
# Usage: irm https://mymoa.app/install.ps1 | iex

param(
    [string]$PairingCode = "",
    [string]$InstallPath = "$env:LOCALAPPDATA\MoA",
    [switch]$Silent = $false
)

$ErrorActionPreference = "Stop"

# ============================================
# Configuration
# ============================================

$MOA_VERSION = "1.0.0"
$MOA_DOWNLOAD_URL = "https://github.com/Kimjaechol/MoA/releases/download/v$MOA_VERSION"
$MOA_API_URL = "https://mymoa.app/api/relay"

# Colors
function Write-ColorText {
    param([string]$Text, [string]$Color = "White")
    Write-Host $Text -ForegroundColor $Color
}

function Write-Banner {
    Write-ColorText ""
    Write-ColorText "  __  __        _    " "Cyan"
    Write-ColorText " |  \/  | ___  / \   " "Cyan"
    Write-ColorText " | |\/| |/ _ \/ _ \  " "Cyan"
    Write-ColorText " | |  | | (_) / ___ \" "Cyan"
    Write-ColorText " |_|  |_|\___/_/   \_\" "Cyan"
    Write-ColorText ""
    Write-ColorText " Master of AI - Windows Installer" "Yellow"
    Write-ColorText " Version $MOA_VERSION" "DarkGray"
    Write-ColorText ""
}

function Write-Step {
    param([string]$Step, [string]$Description)
    Write-ColorText "[$Step] $Description" "Green"
}

function Write-Error {
    param([string]$Message)
    Write-ColorText "[ERROR] $Message" "Red"
}

# ============================================
# System Requirements Check
# ============================================

function Test-Requirements {
    Write-Step "1/6" "Checking system requirements..."

    # Check Windows version
    $os = Get-CimInstance Win32_OperatingSystem
    $version = [version]$os.Version
    if ($version.Major -lt 10) {
        Write-Error "Windows 10 or later is required."
        exit 1
    }

    # Check PowerShell version
    if ($PSVersionTable.PSVersion.Major -lt 5) {
        Write-Error "PowerShell 5.0 or later is required."
        exit 1
    }

    # Check if running as admin (optional)
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
    if (-not $isAdmin) {
        Write-ColorText "  Note: Running without admin privileges. Some features may be limited." "Yellow"
    }

    Write-ColorText "  System requirements met." "DarkGray"
}

# ============================================
# Installation
# ============================================

function Install-MoA {
    Write-Step "2/6" "Creating installation directory..."

    # Create directory
    if (-not (Test-Path $InstallPath)) {
        New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
    }

    Write-Step "3/6" "Downloading MoA..."

    # Download binary
    $exePath = Join-Path $InstallPath "moa.exe"
    $downloadUrl = "$MOA_DOWNLOAD_URL/moa-windows-x64.exe"

    try {
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $downloadUrl -OutFile $exePath -UseBasicParsing
    }
    catch {
        # If download fails, create a placeholder (for testing)
        Write-ColorText "  Note: Using development mode (binary download skipped)" "Yellow"

        # Check if Node.js is installed
        $node = Get-Command node -ErrorAction SilentlyContinue
        if (-not $node) {
            Write-Error "Node.js is required for development mode. Please install from https://nodejs.org"
            exit 1
        }

        # Create wrapper script
        $wrapperContent = @"
@echo off
node "%~dp0moa.js" %*
"@
        Set-Content -Path $exePath -Value $wrapperContent

        # Create placeholder JS file
        $jsContent = @"
// MoA Development Mode
console.log('MoA is running in development mode');
console.log('Please download the full binary from: $MOA_DOWNLOAD_URL');
"@
        Set-Content -Path (Join-Path $InstallPath "moa.js") -Value $jsContent
    }

    Write-ColorText "  Downloaded to: $exePath" "DarkGray"
}

function Set-Environment {
    Write-Step "4/6" "Configuring environment..."

    # Add to PATH (user level)
    $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    if ($userPath -notlike "*$InstallPath*") {
        [Environment]::SetEnvironmentVariable("PATH", "$userPath;$InstallPath", "User")
        Write-ColorText "  Added to PATH" "DarkGray"
    }

    # Create config directory
    $configDir = Join-Path $env:APPDATA "MoA"
    if (-not (Test-Path $configDir)) {
        New-Item -ItemType Directory -Path $configDir -Force | Out-Null
    }

    # Save config
    $config = @{
        version = $MOA_VERSION
        installPath = $InstallPath
        installedAt = (Get-Date).ToString("o")
        apiUrl = $MOA_API_URL
    }

    $configPath = Join-Path $configDir "config.json"
    $config | ConvertTo-Json | Set-Content -Path $configPath

    Write-ColorText "  Config saved to: $configPath" "DarkGray"
}

function Register-Device {
    param([string]$Code)

    Write-Step "5/6" "Registering device..."

    if ([string]::IsNullOrEmpty($Code)) {
        if (-not $Silent) {
            $Code = Read-Host "Enter pairing code (from KakaoTalk /설치 command)"
        }
        else {
            Write-ColorText "  Skipping device registration (no pairing code)" "Yellow"
            return
        }
    }

    if ([string]::IsNullOrEmpty($Code)) {
        Write-ColorText "  Skipping device registration" "Yellow"
        return
    }

    # Get device info
    $deviceName = $env:COMPUTERNAME
    $deviceType = "desktop"
    $os = Get-CimInstance Win32_OperatingSystem

    $body = @{
        pairingCode = $Code
        deviceName = $deviceName
        deviceType = $deviceType
        platform = "windows"
        osVersion = $os.Caption
        capabilities = @("shell", "file", "process")
    } | ConvertTo-Json

    try {
        $response = Invoke-RestMethod -Uri "$MOA_API_URL/pair" -Method POST -Body $body -ContentType "application/json"

        if ($response.success) {
            # Save device token
            $configDir = Join-Path $env:APPDATA "MoA"
            $tokenPath = Join-Path $configDir "device-token.json"
            @{
                deviceId = $response.deviceId
                deviceToken = $response.deviceToken
                userId = $response.userId
            } | ConvertTo-Json | Set-Content -Path $tokenPath

            Write-ColorText "  Device registered: $deviceName" "Green"
        }
        else {
            Write-ColorText "  Registration failed: $($response.error)" "Yellow"
        }
    }
    catch {
        Write-ColorText "  Could not connect to server. Device will register on first run." "Yellow"
    }
}

function Set-Autostart {
    Write-Step "6/6" "Configuring autostart..."

    # Create startup shortcut
    $startupPath = [Environment]::GetFolderPath("Startup")
    $shortcutPath = Join-Path $startupPath "MoA.lnk"
    $exePath = Join-Path $InstallPath "moa.exe"

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $exePath
    $shortcut.Arguments = "daemon"
    $shortcut.WorkingDirectory = $InstallPath
    $shortcut.Description = "MoA - Master of AI"
    $shortcut.Save()

    Write-ColorText "  Autostart configured" "DarkGray"
}

function Start-MoADaemon {
    Write-ColorText ""
    Write-ColorText "Starting MoA daemon..." "Cyan"

    $exePath = Join-Path $InstallPath "moa.exe"

    # Start as background process
    Start-Process -FilePath $exePath -ArgumentList "daemon" -WindowStyle Hidden

    Write-ColorText "  MoA daemon started" "Green"
}

function Show-Completion {
    Write-ColorText ""
    Write-ColorText "============================================" "Green"
    Write-ColorText " Installation Complete!" "Green"
    Write-ColorText "============================================" "Green"
    Write-ColorText ""
    Write-ColorText "MoA has been installed to: $InstallPath" "White"
    Write-ColorText ""
    Write-ColorText "Next steps:" "Yellow"
    Write-ColorText "  1. Open KakaoTalk and send: /연결상태" "White"
    Write-ColorText "  2. You should see this device as 'online'" "White"
    Write-ColorText "  3. Try sending: @$env:COMPUTERNAME dir" "White"
    Write-ColorText ""
    Write-ColorText "Commands:" "Yellow"
    Write-ColorText "  moa status    - Check connection status" "White"
    Write-ColorText "  moa logs      - View logs" "White"
    Write-ColorText "  moa restart   - Restart daemon" "White"
    Write-ColorText "  moa uninstall - Remove MoA" "White"
    Write-ColorText ""
}

# ============================================
# Main
# ============================================

function Main {
    if (-not $Silent) {
        Write-Banner
    }

    Test-Requirements
    Install-MoA
    Set-Environment
    Register-Device -Code $PairingCode
    Set-Autostart
    Start-MoADaemon
    Show-Completion
}

Main
