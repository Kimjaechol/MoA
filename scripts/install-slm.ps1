# MoA SLM Installation Script for Windows
# Installs Ollama and downloads Qwen3 models (Q4 quantized)

$ErrorActionPreference = "Stop"

Write-Host "🤖 MoA 로컬 AI 설치 스크립트" -ForegroundColor Cyan
Write-Host "================================"
Write-Host ""

# ============================================
# Step 1: Install Ollama
# ============================================

function Install-Ollama {
    Write-Host "[1/3] Ollama 설치 확인 중..." -ForegroundColor Yellow

    $ollamaPath = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"

    if (Test-Path $ollamaPath) {
        Write-Host "✓ Ollama가 이미 설치되어 있습니다." -ForegroundColor Green
        & $ollamaPath --version
        return $true
    }

    if (Get-Command ollama -ErrorAction SilentlyContinue) {
        Write-Host "✓ Ollama가 이미 설치되어 있습니다." -ForegroundColor Green
        ollama --version
        return $true
    }

    Write-Host "Ollama 다운로드 중..." -ForegroundColor Cyan
    $installerUrl = "https://ollama.com/download/OllamaSetup.exe"
    $installerPath = "$env:TEMP\OllamaSetup.exe"

    try {
        Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing
        Write-Host "설치 프로그램 실행 중..." -ForegroundColor Cyan
        Start-Process -FilePath $installerPath -Wait
        Remove-Item $installerPath -Force -ErrorAction SilentlyContinue
        Write-Host "✓ Ollama 설치 완료" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "✗ Ollama 설치 실패: $_" -ForegroundColor Red
        Write-Host "수동 설치: https://ollama.com/download" -ForegroundColor Yellow
        return $false
    }
}

# ============================================
# Step 2: Start Ollama Server
# ============================================

function Start-OllamaServer {
    Write-Host ""
    Write-Host "[2/3] Ollama 서버 시작 중..." -ForegroundColor Yellow

    # Check if already running
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -UseBasicParsing -TimeoutSec 2
        Write-Host "✓ Ollama 서버가 이미 실행 중입니다." -ForegroundColor Green
        return $true
    }
    catch {
        # Server not running, start it
    }

    # Start server in background
    Write-Host "서버 시작 중..."
    Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden

    # Wait for server to start
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -UseBasicParsing -TimeoutSec 2
            Write-Host "✓ Ollama 서버 시작 완료" -ForegroundColor Green
            return $true
        }
        catch {
            Write-Host "." -NoNewline
        }
    }

    Write-Host ""
    Write-Host "✗ Ollama 서버 시작 실패" -ForegroundColor Red
    return $false
}

# ============================================
# Step 3: Download Models
# ============================================

function Download-Models {
    Write-Host ""
    Write-Host "[3/3] MoA SLM 모델 다운로드 중..." -ForegroundColor Yellow
    Write-Host ""

    # Tier 1: Qwen3-0.6B
    Write-Host "Tier 1: Qwen3-0.6B (에이전트 코어)" -ForegroundColor Blue
    Write-Host "  - 역할: 라우팅, 의도분류, 도구호출, 기본응답"
    Write-Host "  - 크기: ~500MB (Q4 양자화)"
    Write-Host ""

    $models = ollama list 2>&1
    if ($models -match "qwen3:0.6b") {
        Write-Host "✓ qwen3:0.6b 이미 설치됨" -ForegroundColor Green
    }
    else {
        Write-Host "다운로드 중... (약 400MB)"
        ollama pull qwen3:0.6b
        Write-Host "✓ qwen3:0.6b 설치 완료" -ForegroundColor Green
    }

    Write-Host ""

    # Check memory for Tier 2
    $totalMemGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)

    if ($totalMemGB -lt 6) {
        Write-Host "⚠ 메모리 부족 (${totalMemGB}GB) - Tier 2 건너뜀" -ForegroundColor Yellow
        Write-Host "  Tier 2는 6GB 이상의 RAM이 필요합니다."
    }
    else {
        # Tier 2: Qwen3-4B
        Write-Host "Tier 2: Qwen3-4B (고급 처리)" -ForegroundColor Blue
        Write-Host "  - 역할: 오프라인 심층추론, 복잡한 대화"
        Write-Host "  - 크기: ~3.5GB (Q4 양자화)"
        Write-Host ""

        if ($models -match "qwen3:4b") {
            Write-Host "✓ qwen3:4b 이미 설치됨" -ForegroundColor Green
        }
        else {
            Write-Host "다운로드 중... (약 2.6GB)"
            ollama pull qwen3:4b
            Write-Host "✓ qwen3:4b 설치 완료" -ForegroundColor Green
        }
    }
}

# ============================================
# Step 4: Verify Installation
# ============================================

function Verify-Installation {
    Write-Host ""
    Write-Host "설치 확인 중..." -ForegroundColor Yellow
    Write-Host ""

    Write-Host "설치된 모델:"
    ollama list
    Write-Host ""

    Write-Host "빠른 테스트 (qwen3:0.6b)..."
    $response = ollama run qwen3:0.6b "Say 'MoA ready' in Korean" 2>&1 | Select-Object -First 1

    if ($response) {
        Write-Host "✓ 테스트 성공: $response" -ForegroundColor Green
    }
    else {
        Write-Host "⚠ 테스트 응답 없음 (정상일 수 있음)" -ForegroundColor Yellow
    }
}

# ============================================
# Main
# ============================================

function Main {
    Write-Host ""

    if (-not (Install-Ollama)) {
        exit 1
    }

    if (-not (Start-OllamaServer)) {
        exit 1
    }

    Download-Models
    Verify-Installation

    Write-Host ""
    Write-Host "================================"
    Write-Host "🎉 MoA 로컬 AI 설치 완료!" -ForegroundColor Green
    Write-Host ""
    Write-Host "설치된 모델:"
    Write-Host "  • Tier 1: qwen3:0.6b (~500MB) - 항시 실행"
    Write-Host "  • Tier 2: qwen3:4b (~3.5GB) - 온디맨드"
    Write-Host ""
    Write-Host "수동 테스트:"
    Write-Host "  ollama run qwen3:0.6b '안녕하세요'"
    Write-Host ""
}

Main
