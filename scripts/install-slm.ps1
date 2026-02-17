# MoA SLM Installation Script for Windows
# Installs Ollama and Qwen3-0.6B core model only (~400MB)
# All advanced tasks use Gemini 2.0 Flash (cloud)

$ErrorActionPreference = "Stop"

Write-Host "MoA 로컬 AI 설치 스크립트" -ForegroundColor Cyan
Write-Host "================================"
Write-Host ""
Write-Host "Architecture:"
Write-Host "  - Core: Qwen3-0.6B (local, ~400MB) - intent classification, routing, heartbeat"
Write-Host "  - Cloud: Gemini 3.0 Flash (cost-effective) / Claude Opus 4.6 (max performance)"
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

    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -UseBasicParsing -TimeoutSec 2
        Write-Host "✓ Ollama 서버가 이미 실행 중입니다." -ForegroundColor Green
        return $true
    }
    catch {
        # Server not running, start it
    }

    Write-Host "서버 시작 중..."
    Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden

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
# Step 3: Download Core Model (Tier 1 only)
# ============================================

function Download-CoreModel {
    Write-Host ""
    Write-Host "[3/3] MoA 코어 모델 다운로드 중..." -ForegroundColor Yellow
    Write-Host ""

    Write-Host "Qwen3-0.6B-Q4 (코어 게이트키퍼)" -ForegroundColor Blue
    Write-Host "  - 역할: 의도분류, 라우팅, 하트비트 체크, 프라이버시 감지"
    Write-Host "  - 크기: ~400MB (Q4_K_M 양자화)"
    Write-Host ""

    $models = ollama list 2>&1
    if ($models -match "qwen3:0.6b-q4_K_M") {
        Write-Host "✓ qwen3:0.6b-q4_K_M 이미 설치됨" -ForegroundColor Green
    }
    else {
        Write-Host "다운로드 중... (약 400MB)"
        ollama pull qwen3:0.6b-q4_K_M
        Write-Host "✓ qwen3:0.6b-q4_K_M 설치 완료" -ForegroundColor Green
    }

    Write-Host ""
    Write-Host "고급 작업은 클라우드 AI가 처리합니다." -ForegroundColor Blue
    Write-Host "  - 로컬 Tier 2/3 모델은 설치하지 않습니다."
    Write-Host "  - 가성비: Gemini 3.0 Flash / 최고성능: Claude Opus 4.6"
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

    Write-Host "빠른 테스트 (qwen3:0.6b-q4_K_M)..."
    $response = ollama run qwen3:0.6b-q4_K_M "Say 'MoA ready' in Korean" 2>&1 | Select-Object -First 1

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

    Download-CoreModel
    Verify-Installation

    Write-Host ""
    Write-Host "================================"
    Write-Host "MoA 로컬 AI 설치 완료!" -ForegroundColor Green
    Write-Host ""
    Write-Host "설치 구성:"
    Write-Host "  - 코어 AI: qwen3:0.6b-q4_K_M (~400MB, 로컬) - 의도분류/라우팅/하트비트"
    Write-Host "  - 클라우드 AI: Gemini 3.0 Flash (가성비) / Claude Opus 4.6 (최고성능)"
    Write-Host ""
    Write-Host "수동 테스트:"
    Write-Host "  ollama run qwen3:0.6b-q4_K_M '안녕하세요'"
    Write-Host ""
}

Main
