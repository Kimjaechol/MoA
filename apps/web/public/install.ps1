# MoA One-Click Installer for Windows
# Usage: powershell -c "irm https://mymoa.app/install.ps1 | iex"

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$APP_NAME = "MoA"
$RELEASES_URL = "https://download.mymoa.app/desktop"
$INSTALLER_NAME = "MoA-Setup-latest.exe"
$DOWNLOAD_URL = "$RELEASES_URL/$INSTALLER_NAME"
$TEMP_DIR = [System.IO.Path]::GetTempPath()
$INSTALLER_PATH = Join-Path $TEMP_DIR $INSTALLER_NAME

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "       $APP_NAME - Master of AI Installer" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""

# Check Windows version
$osVersion = [System.Environment]::OSVersion.Version
if ($osVersion.Major -lt 10) {
    Write-Host "  [!] Windows 10 or later is required." -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] Windows $($osVersion.Major).$($osVersion.Minor) detected" -ForegroundColor Green

# Download installer
Write-Host ""
Write-Host "  Downloading $APP_NAME installer..." -ForegroundColor Yellow
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $webClient = New-Object System.Net.WebClient
    $webClient.DownloadFile($DOWNLOAD_URL, $INSTALLER_PATH)
    Write-Host "  [OK] Download complete" -ForegroundColor Green
} catch {
    Write-Host "  [!] Download failed: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Try downloading manually:" -ForegroundColor Yellow
    Write-Host "  $DOWNLOAD_URL" -ForegroundColor White
    exit 1
}

# Verify file exists
if (-not (Test-Path $INSTALLER_PATH)) {
    Write-Host "  [!] Installer file not found after download" -ForegroundColor Red
    exit 1
}

$fileSize = (Get-Item $INSTALLER_PATH).Length / 1MB
Write-Host "  [OK] File size: $([math]::Round($fileSize, 1)) MB" -ForegroundColor Green

# Run installer (NSIS silent install)
Write-Host ""
Write-Host "  Installing $APP_NAME..." -ForegroundColor Yellow
try {
    Start-Process -FilePath $INSTALLER_PATH -ArgumentList "/S" -Wait
    Write-Host "  [OK] Installation complete!" -ForegroundColor Green
} catch {
    # If silent install fails, try normal install
    Write-Host "  [i] Launching installer..." -ForegroundColor Yellow
    Start-Process -FilePath $INSTALLER_PATH
    Write-Host "  [OK] Installer launched. Please follow the on-screen instructions." -ForegroundColor Green
}

# Cleanup
try {
    Remove-Item $INSTALLER_PATH -Force -ErrorAction SilentlyContinue
} catch { }

# Launch app
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "       $APP_NAME has been installed!" -ForegroundColor Green
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  The app will launch automatically." -ForegroundColor White
Write-Host "  You can also find MoA in the Start menu." -ForegroundColor White
Write-Host ""

# Try to launch the app
$appPath = Join-Path $env:LOCALAPPDATA "$APP_NAME\$APP_NAME.exe"
if (Test-Path $appPath) {
    Start-Process -FilePath $appPath
}
